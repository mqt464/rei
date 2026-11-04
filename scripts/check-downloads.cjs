const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-downloads-check-'))
  let status = 0
  try {
    for (const phase of ['write', 'restart']) {
      const env = { ...process.env, REI_DOWNLOAD_PROFILE: profile, REI_DOWNLOAD_PHASE: phase }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
        env,
        stdio: 'inherit',
        timeout: 60000,
        windowsHide: true
      })
      if (result.error) console.error(result.error)
      if (result.status !== 0) {
        status = result.status ?? 1
        break
      }
    }
  } finally {
    assert.ok(path.resolve(profile).startsWith(path.join(os.tmpdir(), 'rei-downloads-check-')))
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 })
  }
  process.exit(status)
}

const { app, BaseWindow, session, shell } = require('electron')
const { createServer } = require('node:http')
const Module = require('node:module')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.setPath('userData', process.env.REI_DOWNLOAD_PROFILE)
const bundlePath = path.resolve(__dirname, '../out/main/index.js')
const browserModule = new Module(bundlePath, module)
browserModule.filename = bundlePath
browserModule.paths = Module._nodeModulePaths(path.dirname(bundlePath))
browserModule._compile(
  fs.readFileSync(bundlePath, 'utf8').split('function createWindow(')[0] +
    '\nmodule.exports = { attachBrowser, SearchStore, parsePreferences, resolveAddress }',
  bundlePath
)

async function waitFor(check, message) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
  assert.fail(message)
}

app
  .whenReady()
  .then(async () => {
    const store = new browserModule.exports.SearchStore(':memory:')
    const window = new BaseWindow({ width: 1300, height: 850, show: true })
    const server = createServer((request, response) => {
      if (request.url === '/') {
        response.setHeader('Content-Type', 'text/html')
        response.end('<title>Download fixture</title><a href="/file">Download</a>')
        return
      }
      const slow = request.url === '/slow'
      const total = slow ? 4 * 1024 * 1024 : 1024
      const offset = Number((request.headers.range || '').match(/bytes=(\d+)/)?.[1] || 0)
      response.statusCode = offset ? 206 : 200
      response.setHeader('Content-Type', 'application/octet-stream')
      response.setHeader('Content-Disposition', 'attachment; filename="fixture.txt"')
      response.setHeader('Accept-Ranges', 'bytes')
      response.setHeader('Content-Length', total - offset)
      if (offset) response.setHeader('Content-Range', `bytes ${offset}-${total - 1}/${total}`)
      if (!slow) {
        response.end(Buffer.alloc(total))
        return
      }
      let sent = offset
      const timer = setInterval(() => {
        const bytes = Math.min(16384, total - sent)
        response.write(Buffer.alloc(bytes))
        sent += bytes
        if (sent === total) {
          clearInterval(timer)
          response.end()
        }
      }, 50)
      response.on('close', () => clearInterval(timer))
    })
    try {
      const chrome = browserModule.exports.attachBrowser(window, store)
      const sidebar = window.contentView.children.find(
        (view) => view.webContents && view.webContents !== chrome
      )
      sidebar.webContents.ipc.handle('extensions:get', () => ({ extensions: [], error: '' }))
      await chrome.loadFile(path.resolve(__dirname, '../out/renderer/index.html'))
      await sidebar.webContents.loadFile(path.resolve(__dirname, '../out/renderer/index.html'), {
        hash: 'tabs'
      })
      const read = (script) => chrome.executeJavaScript(script)
      const readSidebar = (script) => sidebar.webContents.executeJavaScript(script)
      await waitFor(() => read('!!document.querySelector(".blank-page")'), 'UI mounts')
      console.log('Downloads check: UI mounted')
      await read('void window.api.onState(value => window.testState = value)')
      assert.equal(browserModule.exports.resolveAddress('rei://downloads/'), 'rei://downloads')
      assert.equal(
        browserModule.exports.parsePreferences({ downloadHistory: false }).downloadHistory,
        false
      )
      assert.throws(() => browserModule.exports.parsePreferences({ downloadHistory: 'yes' }))
      await read('window.api.openDownloads()')
      await waitFor(
        () => read('!!document.querySelector(".downloads-page")'),
        'Downloads page opens'
      )
      console.log('Downloads check: page opened')
      const downloads = () => read('window.api.getDownloads()')
      assert.equal(
        await read('document.body.textContent.includes("Your files, in one place.")'),
        false
      )
      assert.equal(
        await read('document.body.textContent.includes("Files you download will appear here.")'),
        false
      )
      await waitFor(
        () => readSidebar('!!document.querySelector(".sidebar-downloads")'),
        'Sidebar mounts'
      )
      assert.equal(
        await readSidebar('!!document.querySelector(".download-badge")'),
        false,
        'No idle badge'
      )
      if (process.env.REI_DOWNLOAD_PHASE === 'restart') {
        const records = await downloads()
        assert.equal(records.length, 1)
        assert.equal(records[0].status, 'completed')
        assert.equal(records[0].active, false)
        await read('window.api.setPreferences({ downloadHistory: false })')
        assert.equal((await downloads()).length, 0)
        assert.deepEqual(
          JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'downloads.json'))),
          []
        )
        console.log('Download history restart and privacy checks passed.')
        return
      }
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
      const origin = `http://127.0.0.1:${server.address().port}`
      const directory = app.getPath('userData')
      await read(
        `window.api.setPreferences({ downloadPrompt: false, downloadDirectory: ${JSON.stringify(directory)} })`
      )
      const action = (id, value) =>
        read(`window.api.downloadAction(${JSON.stringify(id)}, ${JSON.stringify(value)})`)
      session.defaultSession.downloadURL(`${origin}/file`)
      console.log('Downloads check: first transfer started')
      await waitFor(
        async () => (await downloads()).some((record) => record.status === 'completed'),
        'Download completes'
      )
      let complete = (await downloads())[0]
      assert.equal(fs.statSync(complete.path).size, 1024)
      session.defaultSession.downloadURL(`${origin}/file`)
      await waitFor(
        async () =>
          (await downloads()).filter((record) => record.status === 'completed').length === 2,
        'Second download completes'
      )
      assert.notEqual(
        (await downloads())[0].path,
        complete.path,
        'Existing files are never overwritten'
      )
      assert.equal((await downloads())[0].filename, 'fixture (1).txt', 'Show the saved filename')
      const opened = []
      shell.openPath = async (value) => {
        opened.push(value)
        return ''
      }
      shell.showItemInFolder = (value) => opened.push(value)
      await action(complete.id, 'open')
      await action(complete.id, 'reveal')
      await read('window.api.openDownloadFolder()')
      assert.deepEqual(opened, [complete.path, complete.path, directory])
      await assert.rejects(action('missing', 'open'))
      await assert.rejects(action(complete.id, 'pause'))
      session.defaultSession.downloadURL(`${origin}/slow`)
      await waitFor(
        async () =>
          (await downloads()).some(
            (record) => record.active && record.received > 0 && record.speed > 0
          ),
        'Live progress is reported'
      )
      const slow = (await downloads()).find((record) => record.active)
      await waitFor(
        () => readSidebar('document.querySelector(".download-badge")?.textContent === "1"'),
        'Live sidebar badge'
      )
      await waitFor(
        () =>
          readSidebar('Number(document.querySelector(".download-progress").dataset.progress) > 0'),
        'Live sidebar progress'
      )
      await action(slow.id, 'pause')
      assert.equal((await downloads()).find((record) => record.id === slow.id).status, 'paused')
      await waitFor(
        () =>
          readSidebar(
            'document.querySelector(".sidebar-downloads").getAttribute("aria-label").includes("paused")'
          ),
        'Paused sidebar state'
      )
      const samples = [
        { ...slow, id: 'sample-one', received: 60, total: 100, status: 'progressing' },
        { ...slow, id: 'sample-two', received: 140, total: 200, status: 'progressing' }
      ]
      sidebar.webContents.send('downloads:changed', samples)
      await waitFor(
        () => readSidebar('document.querySelector(".download-badge")?.textContent === "2"'),
        'Multiple transfer badge'
      )
      assert.ok(
        Math.abs(
          (await readSidebar(
            'Number(document.querySelector(".download-progress").dataset.progress)'
          )) -
            2 / 3
        ) < 0.001,
        'Aggregate progress is byte-weighted'
      )
      if (process.env.REI_DOWNLOAD_CAPTURES) {
        fs.mkdirSync(process.env.REI_DOWNLOAD_CAPTURES, { recursive: true })
        await readSidebar(
          'Promise.all(document.getAnimations().filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})))'
        )
        await readSidebar(
          'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
        )
        fs.writeFileSync(
          path.join(process.env.REI_DOWNLOAD_CAPTURES, 'sidebar-downloading.png'),
          (await sidebar.webContents.capturePage()).toPNG()
        )
        const paletteMode = await read('(window.api.getTheme()).then(theme => theme.paletteMode)')
        const darkBackground = await readSidebar(
          'getComputedStyle(document.querySelector("aside")).backgroundColor'
        )
        await read('window.api.setTheme({ paletteMode: "light" })')
        await waitFor(
          () =>
            readSidebar(
              `getComputedStyle(document.querySelector("aside")).backgroundColor !== ${JSON.stringify(darkBackground)}`
            ),
          'Light theme reaches sidebar'
        )
        await readSidebar(
          'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
        )
        fs.writeFileSync(
          path.join(process.env.REI_DOWNLOAD_CAPTURES, 'sidebar-downloading-light.png'),
          (await sidebar.webContents.capturePage()).toPNG()
        )
        await read(`window.api.setTheme({ paletteMode: ${JSON.stringify(paletteMode)} })`)
      }
      sidebar.webContents.send('downloads:changed', [{ ...slow, total: 0 }])
      await waitFor(
        () => readSidebar('!!document.querySelector(".download-progress.indeterminate")'),
        'Unknown-size progress'
      )
      await readSidebar('document.documentElement.dataset.motion = "reduced"')
      assert.equal(
        await readSidebar(
          'getComputedStyle(document.querySelector(".download-progress-fill")).animationName'
        ),
        'none',
        'Reduced motion stops indeterminate animation'
      )
      await readSidebar('document.documentElement.dataset.motion = "full"')
      sidebar.webContents.send(
        'downloads:changed',
        Array.from({ length: 100 }, (_, index) => ({ ...slow, id: `sample-${index}` }))
      )
      await waitFor(
        () => readSidebar('document.querySelector(".download-badge")?.textContent === "99+"'),
        'Large counts remain compact'
      )
      sidebar.webContents.send('downloads:changed', await downloads())
      await read('window.api.clearDownloads()')
      assert.equal((await downloads()).length, 1, 'Clear history keeps active transfers')
      assert.ok(fs.existsSync(complete.path), 'Clear history keeps files')
      await action(slow.id, 'resume')
      await waitFor(
        async () =>
          (await downloads()).find((record) => record.id === slow.id).status === 'progressing',
        'Transfer resumes'
      )
      await action(slow.id, 'cancel')
      await waitFor(
        async () =>
          (await downloads()).find((record) => record.id === slow.id).status === 'cancelled',
        'Transfer cancels'
      )
      await waitFor(
        () =>
          readSidebar(
            '!document.querySelector(".download-badge") && !document.querySelector(".download-progress")'
          ),
        'Inactive indicators removed'
      )
      await action(slow.id, 'retry')
      await waitFor(
        async () => (await downloads()).some((record) => record.active),
        'Retry starts another transfer'
      )
      const retry = (await downloads()).find((record) => record.active)
      await action(retry.id, 'cancel')
      await action(slow.id, 'remove')
      assert.ok(!(await downloads()).some((record) => record.id === slow.id))
      await read('window.api.clearDownloads()')
      session.defaultSession.downloadURL(`${origin}/file`)
      await waitFor(
        async () => (await downloads()).some((record) => record.status === 'completed'),
        'Fixture for restart completes'
      )
      await waitFor(
        () => read('document.querySelectorAll(".download-entry").length === 1'),
        'UI shows completed download'
      )
      await sidebar.webContents.executeJavaScript(
        'document.querySelector("button[aria-label=Downloads]").click()'
      )
      const state = await read('window.testState')
      assert.equal(
        state.tabs.filter((tab) => tab.url === 'rei://downloads').length,
        1,
        'Sidebar reuses downloads tab'
      )
      assert.equal(state.tabs.find((tab) => tab.url === 'rei://downloads').title, 'Downloads')
      await read(
        'document.querySelector("input[type=search]").value = "absent"; document.querySelector("input[type=search]").dispatchEvent(new Event("input", { bubbles: true }))'
      )
      await waitFor(
        () => read('document.querySelector(".empty h2")?.textContent === "No matching downloads"'),
        'Search filters history'
      )
      await read(
        'document.querySelector("input[type=search]").value = ""; document.querySelector("input[type=search]").dispatchEvent(new Event("input", { bubbles: true }))'
      )
      for (const width of [1300, 780, 440]) {
        window.setSize(width, 850)
        await read(
          'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
        )
        assert.equal(
          await read(
            'document.querySelector(".downloads-scroll .scroll-area").scrollWidth <= document.querySelector(".downloads-scroll .scroll-area").clientWidth'
          ),
          true,
          `No horizontal overflow at ${width}`
        )
      }
      if (process.env.REI_DOWNLOAD_CAPTURES) {
        fs.mkdirSync(process.env.REI_DOWNLOAD_CAPTURES, { recursive: true })
        window.setSize(1300, 850)
        await read('document.fonts.ready')
        await read(
          'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
        )
        fs.writeFileSync(
          path.join(process.env.REI_DOWNLOAD_CAPTURES, 'downloads.png'),
          (await chrome.capturePage()).toPNG()
        )
      }
      await read('window.api.navigate("rei://settings/downloads")')
      await waitFor(
        () => read('!!document.getElementById("download-history")'),
        'Download preferences integrated'
      )
      if (process.env.REI_DOWNLOAD_CAPTURES) {
        await read(
          'Promise.all(document.getAnimations().filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})))'
        )
        await read(
          'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
        )
        fs.writeFileSync(
          path.join(process.env.REI_DOWNLOAD_CAPTURES, 'download-settings.png'),
          (await chrome.capturePage()).toPNG()
        )
        fs.writeFileSync(
          path.join(process.env.REI_DOWNLOAD_CAPTURES, 'sidebar.png'),
          (await sidebar.webContents.capturePage()).toPNG()
        )
      }
      chrome.focus()
      chrome.sendInputEvent({ type: 'keyDown', keyCode: 'J', modifiers: ['control'] })
      chrome.sendInputEvent({ type: 'keyUp', keyCode: 'J', modifiers: ['control'] })
      await waitFor(
        () => read('!!document.querySelector(".downloads-page")'),
        'Ctrl+J opens downloads'
      )
      console.log(
        'Download progress, pause/resume, cancel/retry, collisions, file actions, search, sidebar, and responsive layout checks passed.'
      )
    } finally {
      server.closeAllConnections()
      server.close()
      window.destroy()
      store.close()
    }
  })
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
