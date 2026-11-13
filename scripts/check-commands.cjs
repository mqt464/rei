const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-commands-check-'))
  for (const phase of ['write', 'restart']) {
    const env = { ...process.env, REI_COMMANDS_PROFILE: profile, REI_COMMANDS_PHASE: phase }
    delete env.ELECTRON_RUN_AS_NODE
    const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
      env,
      stdio: 'inherit',
      windowsHide: true,
      timeout: 90000
    })
    if (result.error) console.error(result.error)
    if (result.status !== 0) process.exit(result.status ?? 1)
  }
  console.log(`Command test profile: ${profile}`)
  process.exit(0)
}

const { app, BaseWindow, shell } = require('electron')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const { createServer } = require('node:http')
const Module = require('node:module')
app.setPath('userData', process.env.REI_COMMANDS_PROFILE)
const downloadDirectory = path.join(app.getPath('userData'), 'downloads')
fs.mkdirSync(downloadDirectory, { recursive: true })
app.setPath('downloads', downloadDirectory)
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
const engineCalls = []
const toolBytes = Buffer.from('Verified downloader fixture')
const toolRequests = []
const originalFetch = global.fetch
global.fetch = async (url, options) => {
  if (url === 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest') {
    toolRequests.push(url)
    const name =
      process.platform === 'win32'
        ? process.arch === 'arm64'
          ? 'yt-dlp_arm64.exe'
          : 'yt-dlp.exe'
        : process.platform === 'darwin'
          ? 'yt-dlp_macos'
          : process.arch === 'arm64'
            ? 'yt-dlp_linux_aarch64'
            : 'yt-dlp_linux'
    return Response.json({
      assets: [
        {
          name,
          size: toolBytes.length,
          digest: `sha256:${require('node:crypto').createHash('sha256').update(toolBytes).digest('hex')}`,
          browser_download_url:
            'https://github.com/yt-dlp/yt-dlp/releases/download/fixture/downloader'
        }
      ]
    })
  }
  if (url === 'https://github.com/yt-dlp/yt-dlp/releases/download/fixture/downloader') {
    toolRequests.push(url)
    return new Response(toolBytes)
  }
  return originalFetch(url, options)
}
let failEngine = false
const bundlePath = path.resolve(__dirname, '../out/main/index.js')
const browserModule = new Module(bundlePath, module)
browserModule.filename = bundlePath
browserModule.paths = Module._nodeModulePaths(path.dirname(bundlePath))
const originalRequire = browserModule.require.bind(browserModule)
browserModule.require = (name) => {
  if (name !== 'node:child_process') return originalRequire(name)
  return {
    ...require(name),
    spawn(engine, args, options) {
      if (!path.basename(engine).startsWith('yt-dlp'))
        return require(name).spawn(engine, args, options)
      engineCalls.push({ engine, args, options })
      const child = new EventEmitter()
      child.stdout = new PassThrough()
      child.stderr = new PassThrough()
      child.kill = () => true
      const shouldFail = failEngine
      failEngine = false
      setTimeout(() => {
        if (shouldFail) {
          child.stderr.write('Fixture extraction failed.')
          child.emit('close', 1)
          return
        }
        const directory = path.dirname(args[args.indexOf('--output') + 1])
        const file = path.join(directory, `fixture-${engineCalls.length}.wav`)
        fs.writeFileSync(file, 'fixture media')
        child.stderr.write(
          'rei-progress:{"status":"downloading","downloaded_bytes":13,"total_bytes":13,"speed":13}\n'
        )
        child.stdout.write(`rei-file:${JSON.stringify(file)}\n`)
        child.emit('close', 0)
      }, 150)
      return child
    }
  }
}
browserModule._compile(
  fs.readFileSync(bundlePath, 'utf8').split('function createWindow(')[0] +
    '\nmodule.exports = { attachBrowser, SearchStore, commandsRuntime, CommandRuntime, parseCommandMetadata, currentPlayingMedia, mediaDownloadUrl, resolveAddress }',
  bundlePath
)

async function waitFor(check, message) {
  const deadline = Date.now() + 12000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.fail(message)
}

function commandFile(directory, id, body, intent = {}) {
  fs.writeFileSync(
    path.join(directory, `${id}.ts`),
    `import { defineCommand } from 'rei/commands'
export default defineCommand({ name: '${id}', command: '${id}', description: 'Test command.', intent: ${JSON.stringify(intent)}, async run(context) { ${body} } })`
  )
}

app
  .whenReady()
  .then(async () => {
    const api = browserModule.exports
    const runtime = api.commandsRuntime()
    let window
    let store
    const server = createServer((request, response) => {
      if (request.url.startsWith('/tone.wav')) {
        const samples = 8000
        const wave = Buffer.alloc(44 + samples * 2)
        wave.write('RIFF', 0)
        wave.writeUInt32LE(wave.length - 8, 4)
        wave.write('WAVEfmt ', 8)
        wave.writeUInt32LE(16, 16)
        wave.writeUInt16LE(1, 20)
        wave.writeUInt16LE(1, 22)
        wave.writeUInt32LE(8000, 24)
        wave.writeUInt32LE(16000, 28)
        wave.writeUInt16LE(2, 32)
        wave.writeUInt16LE(16, 34)
        wave.write('data', 36)
        wave.writeUInt32LE(samples * 2, 40)
        response.setHeader('Content-Type', 'audio/wav')
        response.end(wave)
        return
      }
      response.setHeader('Content-Type', 'text/html')
      response.end(
        '<title>Playing media fixture</title><audio id="first" src="/tone.wav?first" loop controls></audio><audio id="second" src="/tone.wav?second" loop controls></audio>'
      )
    })
    try {
      const state = await runtime.initialize()
      if (process.env.REI_COMMANDS_PHASE === 'restart') {
        assert.ok(!state.commands.some((command) => command.id === 'download.ts'))
        assert.equal(state.commands.find((command) => command.id === 'guard.ts').enabled, true)
        assert.equal(state.commands.find((command) => command.id === 'read.ts').grants.length, 0)
        console.log('PASS: commands restart, deletion, and grant persistence')
        return
      }
      const bundled = state.commands.find((command) => command.id === 'download.ts')
      assert.ok(bundled && !bundled.error, bundled?.error)
      assert.equal(bundled.enabled, false)
      assert.deepEqual(bundled.grants, [])
      assert.throws(() => api.resolveAddress('/download'), /slash commands/)
      await checkRuntime(api, runtime)
      await checkBrowser(api, runtime, server, (value) => {
        window = value.window
        store = value.store
      })
    } finally {
      runtime.destroy()
      if (window && !window.isDestroyed()) window.destroy()
      store?.close()
      if (server.listening) await new Promise((resolve) => server.close(resolve))
    }
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })

async function checkRuntime(api, runtime) {
  const bundled = (await runtime.refresh()).commands.find((command) => command.id === 'download.ts')
  assert.throws(
    () => api.parseCommandMetadata({ ...bundled, intent: { filesystem: 'Read everything' } }),
    /Unknown intent/
  )
  assert.throws(() => api.parseCommandMetadata({ ...bundled, command: 'Not valid' }), /lowercase/)
  assert.throws(
    () => api.parseCommandMetadata({ ...bundled, intent: { 'activeTab.media': '' } }),
    /short reason/
  )
  commandFile(
    runtime.directory,
    'guard',
    `
    if (typeof process !== 'undefined' || typeof require !== 'undefined') throw new Error('Node leaked');
    if (typeof document !== 'undefined' || typeof RTCPeerConnection !== 'undefined') throw new Error('DOM leaked');
    let blocked = false;
    try { await fetch('https://example.com/'); } catch { blocked = true; }
    if (!blocked) throw new Error('Network leaked');
  `
  )
  await runtime.refresh()
  await runtime.update('guard.ts', true)
  await runtime.run('guard.ts')
  commandFile(runtime.directory, 'undeclared', 'await context.activeTab.media.current()')
  await runtime.refresh()
  await runtime.update('undeclared.ts', true)
  await assert.rejects(runtime.run('undeclared.ts'), /permission denied/)
  commandFile(runtime.directory, 'read', 'await context.activeTab.media.current()', {
    'activeTab.media': 'Read current media.'
  })
  await runtime.refresh()
  await runtime.update('read.ts', true)
  assert.deepEqual(
    (await runtime.refresh()).commands.find((command) => command.id === 'read.ts').grants,
    ['activeTab.media']
  )
  await assert.rejects(runtime.run('read.ts'), /Play a video/)
  commandFile(runtime.directory, 'read', '', {
    'activeTab.media': 'Changed purpose requires a new grant.'
  })
  const state = await runtime.refresh()
  assert.deepEqual(state.commands.find((command) => command.id === 'read.ts').grants, [])
  assert.equal(state.commands.find((command) => command.id === 'read.ts').enabled, false)
}

async function checkBrowser(api, runtime, server, onCreated) {
  process.env.PATH = ''
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const store = new api.SearchStore(':memory:')
  const window = new BaseWindow({ width: 1100, height: 800, show: false })
  onCreated({ window, store })
  const chrome = api.attachBrowser(window, store)
  window.contentView.children[0].webContents.ipc.handle('extensions:get', () => ({
    extensions: [],
    error: ''
  }))
  const read = async (script) => {
    try {
      return await chrome.executeJavaScript(script)
    } catch (failure) {
      throw new Error(`${script}\n${failure.message}`, { cause: failure })
    }
  }
  await chrome.loadFile(path.resolve(__dirname, '../out/renderer/index.html'))
  await read('void window.api.onState(state => window.commandState = state)')
  await waitFor(() => read('!!window.commandState?.tabs.length'), 'initial tab state loads')
  await read('window.api.navigate("rei://settings/commands")')
  await waitFor(
    () => read('!!document.querySelector("#settings-panel-commands h2")'),
    'Commands settings renders'
  )
  assert.equal(
    await read('document.querySelector("#settings-tab-commands").getAttribute("aria-selected")'),
    'true'
  )
  assert.equal(
    await read('document.getElementById("command-download.ts").getAttribute("aria-checked")'),
    'false'
  )
  await read('document.getElementById("command-download.ts").click()')
  await waitFor(
    async () =>
      (await runtime.refresh()).commands.find((command) => command.id === 'download.ts').enabled,
    'enable control persists'
  )
  assert.deepEqual(
    (await runtime.refresh()).commands.find((command) => command.id === 'download.ts').grants,
    ['activeTab.media', 'downloads.enqueue']
  )
  assert.equal(await read('!!document.querySelector("#settings-panel-commands details")'), false)
  await checkPlayback(api, runtime, read, chrome, window, origin)
}

async function checkPlayback(api, runtime, read, chrome, window, origin) {
  const captures = path.resolve(__dirname, '../out/commands-check')
  fs.mkdirSync(captures, { recursive: true })
  window.showInactive()
  await new Promise((resolve) => setTimeout(resolve, 200))
  fs.writeFileSync(
    path.join(captures, 'settings-desktop.png'),
    (await chrome.capturePage()).toPNG()
  )
  window.setSize(600, 800)
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.ok(
    await read('document.documentElement.scrollWidth <= innerWidth'),
    'narrow settings must not overflow'
  )
  fs.writeFileSync(path.join(captures, 'settings-narrow.png'), (await chrome.capturePage()).toPNG())
  window.setSize(1100, 800)
  window.hide()
  await read(`window.api.navigate(${JSON.stringify(origin)})`)
  let page
  await waitFor(() => {
    page = window.contentView.children.find((view) =>
      view.webContents?.getURL().startsWith(origin)
    )?.webContents
    return page && !page.isLoading()
  }, 'media fixture opens')
  await page.executeJavaScript('document.getElementById("first").play()', true)
  await waitFor(
    () => api.currentPlayingMedia(page)?.sourceUrl.endsWith('?first'),
    'playback is detected'
  )
  await new Promise((resolve) => setTimeout(resolve, 40))
  await page.executeJavaScript('document.getElementById("first").pause()')
  await page.executeJavaScript('document.getElementById("second").play()', true)
  await page.executeJavaScript('document.getElementById("second").pause()')
  await waitFor(
    () => api.currentPlayingMedia(page)?.sourceUrl.endsWith('?second'),
    'most recently played media survives pause and address focus'
  )
  const selected = api.currentPlayingMedia(page)
  assert.equal(api.mediaDownloadUrl(selected), `${origin}/tone.wav?second`)
  assert.equal(
    api.mediaDownloadUrl({
      ...selected,
      url: 'https://www.youtube.com/watch?v=abc123&list=ignored',
      sourceUrl: 'blob:foo'
    }),
    'https://www.youtube.com/watch?v=abc123'
  )
  assert.equal(
    api.mediaDownloadUrl({
      ...selected,
      url: 'https://www.tiktok.com/@person/video/123',
      sourceUrl: 'blob:foo'
    }),
    'https://www.tiktok.com/@person/video/123'
  )
  assert.equal(
    api.mediaDownloadUrl({
      ...selected,
      url: 'https://x.com/person/status/123',
      sourceUrl: 'blob:foo'
    }),
    'https://x.com/person/status/123'
  )
  assert.throws(
    () => api.mediaDownloadUrl({ ...selected, sourceUrl: 'blob:foo' }),
    /individual video or audio page/
  )
  chrome.focus()
  await read(
    `(() => { const input = document.querySelector('.address-bar input'); input.focus(); input.dispatchEvent(new FocusEvent('focus')); input.value = '/download'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`
  )
  await waitFor(
    () => read('document.querySelector(".result-title")?.textContent === "/download"'),
    'slash command appears in existing picker'
  )
  assert.equal(
    await read('document.querySelector(".suggestion-option .result-url")?.textContent.trim()'),
    'Download media playing in the active tab.'
  )
  await runtime.update('download.ts', false)
  await waitFor(
    () =>
      read(
        '!Array.from(document.querySelectorAll(".result-title")).some(title => title.textContent === "/download")'
      ),
    'disabled commands disappear from the picker'
  )
  await runtime.update('download.ts', true)
  await waitFor(
    () => read('document.querySelector(".result-title")?.textContent === "/download"'),
    're-enabled commands return to the picker'
  )
  await read('document.querySelector(".address-bar").requestSubmit()')
  await waitFor(() => engineCalls.length > 0, 'slash command starts download without confirmation')
  assert.equal(toolRequests.length, 2, 'first download installs a verified release')
  assert.deepEqual(
    fs.readFileSync(engineCalls[0].engine),
    toolBytes,
    'verified bytes become the managed executable'
  )
  assert.equal(
    await read('!!document.querySelector(".suggestion-panel")'),
    false,
    'no success confirmation remains'
  )
  await read(`window.api.navigate(${JSON.stringify(`${origin}/another`)})`)
  assert.equal(
    engineCalls[0].args.at(-1),
    `${origin}/tone.wav?second`,
    'queued target is bound before tab navigation'
  )
  assert.ok(engineCalls[0].args.includes('--no-playlist'))
  assert.ok(engineCalls[0].args.includes('--ignore-config'))
  assert.ok(engineCalls[0].args.includes('--no-plugin-dirs'))
  assert.ok(!engineCalls[0].args.some((argument) => argument.startsWith('--cookies')))
  await waitFor(
    async () =>
      (await read('window.api.getDownloads()')).some((record) => record.status === 'completed'),
    'media job completes in existing Downloads'
  )
  await checkQueue(api, runtime, read, selected, origin)
}

async function checkQueue(api, runtime, read, selected, origin) {
  failEngine = true
  await runtime.run('download.ts', {
    ...selected,
    id: 'failure',
    sourceUrl: `${origin}/tone.wav?failure`
  })
  await waitFor(
    async () =>
      (await read('window.api.getDownloads()')).some((record) =>
        record.error?.includes('Fixture extraction failed')
      ),
    'extraction failures remain in download queue'
  )
  const failed = (await read('window.api.getDownloads()')).find((record) => record.error)
  await read(`window.api.downloadAction(${JSON.stringify(failed.id)}, 'retry')`)
  await waitFor(
    async () =>
      (await read('window.api.getDownloads()')).find((record) => record.id === failed.id)
        ?.status === 'completed',
    'retry uses saved media snapshot'
  )
  await runtime.update('read.ts', false, 'activeTab.media')
  commandFile(runtime.directory, 'invalid', '', { filesystem: 'Not an exposed capability.' })
  let state = await runtime.refresh()
  assert.ok(state.commands.find((command) => command.id === 'invalid.ts').error)
  await assert.rejects(runtime.run('invalid.ts'), /no longer exists/)
  const originalTrash = shell.trashItem
  shell.trashItem = async (filename) =>
    fs.renameSync(filename, path.join(app.getPath('userData'), 'removed-download.ts'))
  try {
    await read('window.api.removeCommand("download.ts")')
  } finally {
    shell.trashItem = originalTrash
  }
  state = await runtime.refresh()
  assert.ok(!state.commands.some((command) => command.id === 'download.ts'))
  assert.ok(!fs.existsSync(path.join(runtime.directory, 'download.ts')))
  console.log(
    'PASS: metadata, sandbox, permissions, Settings, media context, queue, failure, retry, and removal'
  )
}
