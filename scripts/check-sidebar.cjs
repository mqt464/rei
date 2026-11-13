const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-sidebar-check-'))
  const env = { ...process.env, REI_TOPBAR_CHECK_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
    env,
    stdio: 'inherit',
    timeout: 30000,
    windowsHide: true
  })
  assert.ok(path.resolve(profile).startsWith(path.join(os.tmpdir(), 'rei-sidebar-check-')))
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 })
  if (result.error) console.error(result.error.message)
  process.exit(result.status ?? 1)
}

const Module = require('node:module')
const { app, BaseWindow, screen } = require('electron')
const { createServer } = require('node:http')
const bundlePath = path.resolve(__dirname, '../out/main/index.js')
const bundle = fs.readFileSync(bundlePath, 'utf8').split('function createWindow(')[0]
const browserModule = new Module(bundlePath, module)
browserModule.filename = bundlePath
browserModule.paths = Module._nodeModulePaths(path.dirname(bundlePath))
browserModule._compile(`${bundle}\nmodule.exports = { attachBrowser, SearchStore }`, bundlePath)
app.setPath('userData', process.env.REI_TOPBAR_CHECK_PROFILE)

async function waitFor(check, message) {
  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.fail(message)
}

app.whenReady().then(async () => {
  const store = new browserModule.exports.SearchStore(':memory:')
  const window = new BaseWindow({ width: 1000, height: 760, show: false, frame: false })
  const server = createServer((_request, response) => response.end('<title>Sidebar test</title>'))
  const originalCursor = screen.getCursorScreenPoint
  let cursor = { x: -10000, y: -10000 }
  let focused = true
  screen.getCursorScreenPoint = () => cursor
  window.isFocused = () => focused
  window.isVisible = () => true
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const chrome = browserModule.exports.attachBrowser(window, store)
    chrome.setBackgroundThrottling(false)
    await chrome.loadFile(path.resolve(__dirname, '../out/renderer/index.html'))
    const read = (script) => chrome.executeJavaScript(script)
    await read(`window.api.navigate('http://127.0.0.1:${server.address().port}/')`)
    const isPage = (view) => view.webContents.getURL().startsWith('http://127.0.0.1:')
    await waitFor(() => window.contentView.children.some(isPage), 'page must exist')
    const page = window.contentView.children.find(isPage)
    await waitFor(
      () =>
        page.webContents.getURL().startsWith('http://127.0.0.1:') && !page.webContents.isLoading(),
      'page must load'
    )
    const bounds = window.getContentBounds()
    await read('document.activeElement.blur()')
    const sidebar = window.contentView.children[0]
    const sidebarWidth = sidebar.getBounds().width
    const toggleSidebar = () => {
      chrome.emit(
        'before-input-event',
        { preventDefault: () => undefined },
        {
          type: 'keyDown',
          key: 'b',
          code: 'KeyB',
          control: process.platform !== 'darwin',
          meta: process.platform === 'darwin',
          shift: false,
          alt: false,
          isAutoRepeat: false,
          isComposing: false
        }
      )
    }
    cursor = { x: bounds.x + 300, y: bounds.y + 100 }
    toggleSidebar()
    await waitFor(() => !sidebar.getVisible(), 'shortcut must hide pinned sidebar')
    assert.equal(page.getBounds().x, 0, 'hidden sidebar must reserve no space')
    cursor.x = bounds.x + 12
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.equal(sidebar.getVisible(), false, '12px boundary must not reveal sidebar')
    cursor.x = bounds.x + 11
    await waitFor(() => sidebar.getBounds().width === sidebarWidth, 'left edge must reveal sidebar')
    cursor.x = bounds.x + sidebarWidth - 1
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.equal(sidebar.getVisible(), true, 'sidebar must remain open while hovered')
    cursor.x = bounds.x + sidebarWidth
    await waitFor(() => !sidebar.getVisible(), 'leaving sidebar must hide it')
    cursor.x = bounds.x
    await waitFor(
      () => sidebar.getBounds().width === sidebarWidth,
      'edge must reveal sidebar again'
    )
    toggleSidebar()
    cursor.x = bounds.x + 300
    await new Promise((resolve) => setTimeout(resolve, 350))
    assert.equal(sidebar.getBounds().width, sidebarWidth, 'shortcut must pin hovered sidebar')
    toggleSidebar()
    await waitFor(() => !sidebar.getVisible(), 'shortcut must unpin and hide sidebar again')
    console.log('PASS: sidebar edge reveal, hover retention, leave-to-hide, shortcut pin/unpin')
    window.close()
    store.close()
    server.close()
    screen.getCursorScreenPoint = originalCursor
    app.exit(0)
  } catch (error) {
    console.error('FAIL:', error.stack)
    if (!window.isDestroyed()) window.close()
    store.close()
    server.close()
    screen.getCursorScreenPoint = originalCursor
    app.exit(1)
  }
})
