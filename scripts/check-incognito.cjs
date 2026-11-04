const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-incognito-check-'))
  const env = { ...process.env, REI_INCOGNITO_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
    env,
    stdio: 'inherit',
    timeout: 45000,
    windowsHide: true
  })
  assert.ok(path.resolve(profile).startsWith(path.join(os.tmpdir(), 'rei-incognito-check-')))
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 })
  if (result.error) console.error(result.error.message)
  process.exit(result.status ?? 1)
}

const Module = require('node:module')
const { createServer } = require('node:http')
const { app, BaseWindow, session, webContents } = require('electron')
const bundlePath = path.resolve(__dirname, '../out/main/index.js')
const bundle = fs.readFileSync(bundlePath, 'utf8').split('function createWindow(')[0]
const browserModule = new Module(bundlePath, module)
browserModule.filename = bundlePath
browserModule.paths = Module._nodeModulePaths(path.dirname(bundlePath))
browserModule._compile(
  `${bundle}\nmodule.exports = { attachBrowser, SearchStore, SearchService, TabSnapshotStore, flush };`,
  bundlePath
)
app.setPath('userData', process.env.REI_INCOGNITO_PROFILE)
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
async function waitFor(check, message) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (await check()) return
    await delay(25)
  }
  assert.fail(message)
}

app.whenReady().then(async () => {
  const { attachBrowser, SearchStore, SearchService, TabSnapshotStore, flush } =
    browserModule.exports
  const store = new SearchStore(':memory:')
  const server = createServer((request, response) => {
    if (request.url === '/download') {
      response.setHeader('Content-Disposition', 'attachment; filename=private.txt')
      response.end('private download')
      return
    }
    response.setHeader('Content-Type', 'text/html')
    response.end(`<title>${request.url}</title><a target="_blank" href="/private-child">Child</a>`)
  })
  let window
  let failed = false
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    window = new BaseWindow({ width: 900, height: 670 })
    const chrome = attachBrowser(window, store)
    for (const contents of [chrome, window.contentView.children[0].webContents]) {
      contents.ipc.handle('extensions:get', () => ({ extensions: [], error: '' }))
    }
    await chrome.loadFile(path.resolve(__dirname, '../out/renderer/index.html'))
    const sidebar = window.contentView.children[0].webContents
    sidebar.on('console-message', (_event, details) => {
      if (details.level === 'error') console.error('Sidebar:', details.message)
    })
    await waitFor(() => sidebar.getURL() && !sidebar.isLoading(), 'sidebar must load')
    const read = async (script) => {
      try {
        return await chrome.executeJavaScript(script)
      } catch (error) {
        throw new Error(`${script}\n${error.message}`, { cause: error })
      }
    }
    await read('void window.api.onState(state => window.privateState = state)')
    const state = () => read('window.privateState')
    await waitFor(async () => (await state())?.tabs.length === 1, 'initial tab must load')
    const normalId = (await state()).activeTabId
    await read(`window.api.navigate('${origin}/normal')`)
    await waitFor(
      () => store.history('normal').some((entry) => entry.url === `${origin}/normal`),
      'normal history must still work'
    )
    await session.defaultSession.cookies.set({ url: origin, name: 'normal', value: 'secret' })
    window.show()
    window.focus()
    chrome.focus()
    chrome.sendInputEvent({ type: 'keyDown', keyCode: 'N', modifiers: ['control', 'shift'] })
    chrome.sendInputEvent({ type: 'keyUp', keyCode: 'N', modifiers: ['control', 'shift'] })
    await waitFor(async () => (await state()).tabs.length === 2, 'incognito shortcut must work')
    let current = await state()
    assert.equal(current.tabs.find((tab) => tab.id === current.activeTabId).incognito, true)
    assert.equal(current.url, '')
    const privateId = current.activeTabId
    await read(`window.api.navigate('${origin}/private')`)
    await waitFor(
      async () => (await state()).url === `${origin}/private` && !(await state()).loading,
      'private page must load'
    )
    current = await state()
    const privateContents = webContents.fromId(current.activeWebContentsId)
    const privateSession = privateContents.session
    assert.notEqual(privateSession, session.defaultSession)
    assert.equal(privateSession.isPersistent(), false)
    assert.deepEqual(await privateSession.cookies.get({ url: origin }), [])
    await privateSession.cookies.set({ url: origin, name: 'private', value: 'secret' })
    assert.deepEqual(await session.defaultSession.cookies.get({ url: origin, name: 'private' }), [])
    assert.equal(
      await sidebar.executeJavaScript(
        '!!document.querySelector("[aria-label=\\"New incognito tab\\"]")'
      ),
      false,
      'sidebar must not have an incognito button'
    )
    await read('window.api.newIncognitoTab()')
    await waitFor(
      async () => (await state()).tabs.length === 3,
      'API must create incognito tabs'
    )
    current = await state()
    const secondId = current.activeTabId
    assert.equal(webContents.fromId(current.activeWebContentsId).session, privateSession)
    await read(`window.api.switchTab('${privateId}')`)
    await privateContents.executeJavaScript('document.querySelector("a").click()')
    await waitFor(async () => (await state()).tabs.length === 4, 'popup must create a tab')
    current = await state()
    const childId = current.activeTabId
    assert.equal(current.tabs.find((tab) => tab.id === childId).incognito, true)
    assert.equal(webContents.fromId(current.activeWebContentsId).session, privateSession)
    await waitFor(async () => !(await state()).loading, 'popup must finish loading')
    assert.deepEqual(
      store.history('private').filter((entry) => entry.url.includes('/private')),
      []
    )
    flush()
    const saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'session.json')))
    assert.deepEqual(saved.urls, [`${origin}/normal`])
    const service = new SearchService(store)
    const forbidden = new Proxy(store, {
      get(target, key) {
        if (['history', 'cached', 'cache'].includes(key))
          throw new Error(`private search used ${key}`)
        return Reflect.get(target, key)
      }
    })
    const privateSearch = new SearchService(forbidden)
    for (const mode of ['all', 'history', 'websites', 'search']) {
      await privateSearch.search(
        'private',
        mode,
        new AbortController().signal,
        [],
        true,
        () => {},
        true
      )
    }
    service.visit({ url: `${origin}/private-test`, title: 'private', incognito: true })
    service.metadata({ url: `${origin}/private-test`, title: 'private', incognito: true })
    assert.deepEqual(
      store.history('private').filter((entry) => entry.url.includes('/private')),
      []
    )
    const snapshots = new TabSnapshotStore()
    const snapshot = {
      entries: [{ url: `${origin}/private`, title: 'private' }],
      index: 0,
      scroll: [0, 0],
      zoom: 1,
      muted: false
    }
    snapshots.save('1', snapshot, true)
    assert.equal(snapshots.directory, undefined)
    assert.deepEqual(snapshots.read('1'), snapshot)
    snapshots.remove('1')
    assert.equal(snapshots.memory.size, 0)
    const downloadFolder = path.join(app.getPath('userData'), 'private-downloads')
    fs.mkdirSync(downloadFolder)
    await read(
      `window.api.setPreferences(${JSON.stringify({ downloadPrompt: false, downloadDirectory: downloadFolder })})`
    )
    const downloaded = new Promise((resolve, reject) =>
      privateSession.once('will-download', (_event, item) => {
        item.once('done', (_done, status) =>
          status === 'completed' ? resolve() : reject(new Error(status))
        )
      })
    )
    privateContents.downloadURL(`${origin}/download`)
    await downloaded
    assert.equal(fs.existsSync(path.join(downloadFolder, 'private.txt')), true)
    assert.deepEqual(await read('window.api.getDownloads()'), [])
    await read(`window.api.switchTab('${normalId}')`)
    const normalResults = await read('window.api.suggest("private", "tabs", 1, false)')
    assert.deepEqual(normalResults.results, [])
    for (const id of [privateId, secondId, childId]) await read(`window.api.closeTab('${id}')`)
    await waitFor(async () => (await state()).tabs.length === 1, 'private tabs must close')
    await waitFor(
      async () => !(await privateSession.cookies.get({ url: origin })).length,
      'closing last private tab must clear cookies'
    )
    assert.equal(
      (await session.defaultSession.cookies.get({ url: origin, name: 'normal' }))[0].value,
      'secret'
    )
    chrome.focus()
    chrome.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers: ['control', 'shift'] })
    chrome.sendInputEvent({ type: 'keyUp', keyCode: 'T', modifiers: ['control', 'shift'] })
    await delay(100)
    assert.equal((await state()).tabs.length, 1, 'private tabs must not reopen')
    await read('window.api.newIncognitoTab()')
    await waitFor(async () => (await state()).tabs.length === 2, 'new private group must open')
    current = await state()
    assert.notEqual(webContents.fromId(current.activeWebContentsId).session, privateSession)
    await read(
      `window.api.setPreferences(${JSON.stringify({ newTabUrl: `${origin}/homepage`, incognitoUseNewTabUrl: true })})`
    )
    await read('window.api.newIncognitoTab()')
    await waitFor(
      async () => (await state()).url === '',
      'private tabs must stay blank even when old preference is present'
    )
    const beforeRebind = (await state()).tabs.length
    await read('window.api.setPreferences({ keybindings: { newIncognitoTab: ["Mod+Alt+N"] } })')
    chrome.focus()
    chrome.sendInputEvent({ type: 'keyDown', keyCode: 'N', modifiers: ['control', 'alt'] })
    chrome.sendInputEvent({ type: 'keyUp', keyCode: 'N', modifiers: ['control', 'alt'] })
    await waitFor(
      async () => (await state()).tabs.length === beforeRebind + 1,
      'rebound incognito shortcut must work'
    )
    current = await state()
    assert.equal(current.tabs.find((tab) => tab.id === current.activeTabId).incognito, true)
    assert.equal(current.url, '')
    await read(`window.api.navigate('${origin}/private-rebound')`)
    await waitFor(
      async () => (await state()).url === `${origin}/private-rebound` && !(await state()).loading,
      'private page must load before testing rebound shortcut'
    )
    const focusedPage = webContents.fromId((await state()).activeWebContentsId)
    focusedPage.focus()
    focusedPage.sendInputEvent({ type: 'keyDown', keyCode: 'N', modifiers: ['control', 'alt'] })
    focusedPage.sendInputEvent({ type: 'keyUp', keyCode: 'N', modifiers: ['control', 'alt'] })
    await waitFor(
      async () => (await state()).tabs.length === beforeRebind + 2,
      'rebound incognito shortcut must work from a private page'
    )
    current = await state()
    assert.equal(current.tabs.find((tab) => tab.id === current.activeTabId).incognito, true)
    assert.equal(current.url, '')
    await read('window.api.openSettings()')
    await waitFor(
      () => read('!!document.querySelector("#settings-tab-privacy")'),
      'settings must render'
    )
    await read('document.querySelector("#settings-tab-privacy").click()')
    assert.equal(await read('!!document.querySelector("#incognito-homepage")'), false)
    await read('document.querySelector("#settings-tab-keybinds").click()')
    await waitFor(
      () => read('document.body.textContent.includes("New incognito tab")'),
      'incognito binding must appear in settings'
    )
    console.log(
      'Incognito isolation, shortcut, sidebar button removal, popups, persistence, downloads, and settings passed.'
    )
  } catch (error) {
    console.error(error)
    failed = true
  } finally {
    window?.destroy()
    store.close()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    app.exit(failed ? 1 : 0)
  }
})
