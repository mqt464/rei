const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-middle-click-check-'))
  const env = { ...process.env, REI_MIDDLE_CLICK_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
    env,
    stdio: 'inherit',
    timeout: 30000,
    windowsHide: true
  })
  assert.ok(path.resolve(profile).startsWith(path.join(os.tmpdir(), 'rei-middle-click-check-')))
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 })
  if (result.error) console.error(result.error.message)
  process.exit(result.status ?? 1)
}

const Module = require('node:module')
const { createServer } = require('node:http')
const { app, BaseWindow } = require('electron')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
process.on('uncaughtException', (error) => {
  console.error(error.stack)
  app.exit(1)
})
process.on('unhandledRejection', (error) => {
  console.error(error)
  app.exit(1)
})
const bundlePath = path.resolve(__dirname, '../out/main/index.js')
const bundle = fs.readFileSync(bundlePath, 'utf8').split('function createWindow(')[0]
const browserModule = new Module(bundlePath, module)
browserModule.filename = bundlePath
browserModule.paths = Module._nodeModulePaths(path.dirname(bundlePath))
browserModule._compile(bundle + '\nmodule.exports = { attachBrowser, SearchStore }', bundlePath)
app.setPath('userData', process.env.REI_MIDDLE_CLICK_PROFILE)

async function waitFor(check, message) {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.fail(message)
}

app.whenReady().then(async () => {
  const store = new browserModule.exports.SearchStore(':memory:')
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end(
      '<!doctype html><title>Middle-click fixture</title><a href="/target">Open link</a>'
    )
  })
  let window
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const url = 'http://127.0.0.1:' + server.address().port
    Object.defineProperty(app, 'isPackaged', { value: true })
    window = new BaseWindow({ width: 900, height: 670 })
    const chrome = browserModule.exports.attachBrowser(window, store)
    await chrome.loadFile(path.resolve(__dirname, '../out/renderer/index.html'))
    await chrome.executeJavaScript(
      'void window.api.onState(state => window.middleClickState = state)'
    )
    const state = () => chrome.executeJavaScript('window.middleClickState')
    await waitFor(async () => (await state())?.tabs.length === 1, 'initial tab must load')
    const originalTab = (await state()).activeTabId
    await chrome.executeJavaScript('window.api.navigate(' + JSON.stringify(url) + ')')
    const contents = window.contentView.children.find(
      (view) =>
        view.webContents && view.webContents !== chrome && view !== window.contentView.children[0]
    ).webContents
    await waitFor(
      () => contents.getURL().startsWith(url) && !contents.isLoading(),
      'fixture must load'
    )
    await chrome.executeJavaScript('window.api.newTab()')
    await waitFor(async () => (await state()).tabs.length === 2, 'trailing tab must exist')
    const trailingTab = (await state()).activeTabId
    await chrome.executeJavaScript('window.api.switchTab(' + JSON.stringify(originalTab) + ')')
    await waitFor(async () => (await state()).activeTabId === originalTab, 'source must be active')

    for (const backgroundTabs of [false, true]) {
      await chrome.executeJavaScript(
        'window.api.setPreferences({backgroundTabs:' + backgroundTabs + '})'
      )
      const before = await state()
      window.show()
      window.focus()
      contents.focus()
      await waitFor(() => contents.isFocused(), 'source page must have focus before clicking')
      await contents.executeJavaScript(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
      )
      const point = await contents.executeJavaScript(
        '(() => { const rect = document.querySelector("a").getBoundingClientRect(); return {x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2)}; })()'
      )
      contents.sendInputEvent({ type: 'mouseDown', button: 'middle', clickCount: 1, ...point })
      contents.sendInputEvent({ type: 'mouseUp', button: 'middle', clickCount: 1, ...point })
      await waitFor(
        async () => (await state()).tabs.length === before.tabs.length + 1,
        'middle-click must create a tab'
      )
      const after = await state()
      const opened = after.tabs.find(
        (tab) => !before.tabs.some((previous) => previous.id === tab.id)
      )
      assert.equal(after.activeTabId, originalTab, 'middle-click must keep the source active')
      assert.equal(
        after.tabs[1].id,
        opened.id,
        'middle-click must insert directly below the active tab'
      )
      assert.equal(
        after.tabs.at(-1).id,
        trailingTab,
        'existing trailing tabs must keep their order'
      )
      await waitFor(
        async () =>
          (await state()).tabs.find((tab) => tab.id === opened.id).url === url + '/target',
        'new tab must load the destination'
      )
      await waitFor(
        () =>
          window.contentView.children.some(
            (view) =>
              view.webContents?.getURL() === url + '/target' && !view.webContents.isLoading()
          ),
        'destination must finish loading'
      )
    }
    console.log(
      'PASS: middle-click opens directly below the active tab without activation, with either background-tabs preference'
    )
    window.close()
    store.close()
    server.close()
    app.exit(0)
  } catch (error) {
    console.error('FAIL:', error.stack)
    if (window && !window.isDestroyed()) window.close()
    store.close()
    server.close()
    app.exit(1)
  }
})
