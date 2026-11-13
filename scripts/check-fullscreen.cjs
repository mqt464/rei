const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-fullscreen-check-'))
  const env = { ...process.env, REI_FULLSCREEN_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
    env,
    stdio: 'inherit',
    timeout: 45000,
    windowsHide: true
  })
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 })
  if (result.error) console.error(result.error.message)
  process.exit(result.status ?? 1)
}

const Module = require('node:module')
const { createServer } = require('node:http')
const { app, BaseWindow, webContents } = require('electron')
const bundlePath = path.resolve(__dirname, '../out/main/index.js')
const browserModule = new Module(bundlePath, module)
browserModule.filename = bundlePath
browserModule.paths = Module._nodeModulePaths(path.dirname(bundlePath))
browserModule._compile(
  `${fs.readFileSync(bundlePath, 'utf8').split('function createWindow(')[0]}\nmodule.exports = { attachBrowser, SearchStore };`,
  bundlePath
)
app.setPath('userData', process.env.REI_FULLSCREEN_PROFILE)
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
  const { attachBrowser, SearchStore } = browserModule.exports
  const store = new SearchStore(':memory:')
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end('<title>Fullscreen test</title><video controls></video>')
  })
  let window
  let failed = false
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    window = new BaseWindow({ width: 900, height: 670 })
    const chrome = attachBrowser(window, store)
    for (const view of window.contentView.children)
      view.webContents.ipc.handle('extensions:get', () => ({
        extensions: [],
        chromeWebStore: true
      }))
    await chrome.loadFile(path.resolve(__dirname, '../out/renderer/index.html'))
    await waitFor(() => chrome.getURL() && !chrome.isLoading(), 'browser UI must load')
    await chrome.executeJavaScript(
      'void window.api.onState(state => window.fullscreenState = state)'
    )
    const state = () => chrome.executeJavaScript('window.fullscreenState')
    await waitFor(async () => (await state())?.activeTabId, 'initial tab must load')
    await chrome.executeJavaScript('window.api.setPreferences({autoHideTopbar:false})')
    await chrome.executeJavaScript(
      `window.api.navigate('http://127.0.0.1:${server.address().port}/')`
    )
    await waitFor(
      async () => (await state())?.activeWebContentsId && !(await state()).loading,
      'page must load'
    )
    const contents = webContents.fromId((await state()).activeWebContentsId)
    const page = window.contentView.children.find((view) => view.webContents === contents)
    const sidebar = window.contentView.children[0]
    const toolbar = window.contentView.children.find((view) => view.webContents === chrome)
    contents.focus()
    await waitFor(() => contents.isFocused(), 'page must have focus')
    await contents.executeJavaScript('document.querySelector("video").requestFullscreen()', true)
    await waitFor(() => window.isFullScreen(), 'media must enter native fullscreen')
    await waitFor(() => {
      const { width, height } = window.getContentBounds()
      const bounds = page.getBounds()
      return bounds.x === 0 && bounds.y === 0 && bounds.width === width && bounds.height === height
    }, 'fullscreen media must fill the entire window')
    assert.equal(sidebar.getVisible(), false)
    assert.equal(toolbar.getVisible(), false)
    await contents.executeJavaScript('document.exitFullscreen()')
    await waitFor(() => !window.isFullScreen(), 'exit must restore native window')
    await waitFor(() => page.getBounds().y > 0, 'exit must restore browser layout')
    assert.equal(toolbar.getVisible(), true)
    await contents.executeJavaScript('document.querySelector("video").requestFullscreen()', true)
    await waitFor(() => window.isFullScreen(), 'media must re-enter fullscreen')
    contents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    contents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await waitFor(() => !window.isFullScreen(), 'Escape must exit fullscreen')
    console.log('Media fullscreen, full-window layout, exit, and Escape passed.')
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
