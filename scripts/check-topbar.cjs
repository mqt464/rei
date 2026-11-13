const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-topbar-check-'))
  const env = { ...process.env, REI_TOPBAR_CHECK_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
    env,
    stdio: 'inherit',
    timeout: 30000,
    windowsHide: true
  })
  assert.ok(path.resolve(profile).startsWith(path.join(os.tmpdir(), 'rei-topbar-check-')))
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
  const server = createServer((_request, response) => response.end('<title>Topbar test</title>'))
  const originalCursor = screen.getCursorScreenPoint
  let cursor = { x: -10000, y: -10000 }
  let focused = true
  screen.getCursorScreenPoint = () => cursor
  window.isFocused = () => focused
  window.isVisible = () => true
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const chrome = browserModule.exports.attachBrowser(window, store)
    await chrome.loadFile(path.resolve(__dirname, '../out/renderer/index.html'))
    await chrome.insertCSS('.topbar { transition: none !important; }')
    const read = (script) => chrome.executeJavaScript(script)
    await read(`window.api.navigate('http://127.0.0.1:${server.address().port}/')`)
    const isPage = (view) => view.webContents.getURL().startsWith('http://127.0.0.1:')
    await waitFor(() => window.contentView.children.some(isPage), 'page must exist')
    const chromeView = window.contentView.children.find((view) => view.webContents === chrome)
    const page = window.contentView.children.find(isPage)
    await waitFor(
      () =>
        page.webContents.getURL().startsWith('http://127.0.0.1:') && !page.webContents.isLoading(),
      'page must load'
    )
    await read('document.activeElement.blur()')
    await waitFor(() => chromeView.getBounds().height <= 4, 'bar must hide')
    const failures = []
    if (page.getBounds().y !== 0)
      failures.push(`hidden page starts at ${page.getBounds().y}px, not 0px`)
    if (chromeView.getBounds().height !== 0) failures.push('hidden chrome still reserves a strip')
    const bounds = window.getContentBounds()
    cursor = { x: bounds.x + 300, y: bounds.y + 12 }
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.equal(
      chromeView.getBounds().height,
      0,
      '12px boundary must remain outside the reveal zone'
    )
    cursor.y = bounds.y + 11
    try {
      await waitFor(
        () => read('document.querySelector(".topbar").classList.contains("revealed")'),
        'moving within 12px of the top must reveal the bar without DOM mouse events'
      )
    } catch (error) {
      failures.push(error.message)
    }
    assert.deepEqual(failures, [])
    await waitFor(() => page.getBounds().y === 38, 'revealing must expand chrome')
    await waitFor(
      () => read('document.querySelector(".topbar").getBoundingClientRect().top === 0'),
      'bar must finish revealing before clicking text'
    )
    const textHitbox = await read(`(() => {
      const input = document.querySelector('input');
      const bounds = input.getBoundingClientRect();
      const style = getComputedStyle(input);
      const context = document.createElement('canvas').getContext('2d');
      context.font = style.font;
      const blank = document.elementFromPoint(bounds.right + 20, bounds.y + bounds.height / 2);
      return {
        x: Math.round(bounds.x + bounds.width / 2),
        y: Math.round(bounds.y + bounds.height / 2),
        width: bounds.width,
        textWidth: Math.ceil(context.measureText(input.value || input.placeholder).width),
        blankRegion: getComputedStyle(blank).webkitAppRegion,
        textRegion: style.webkitAppRegion
      };
    })()`)
    assert.equal(textHitbox.width, textHitbox.textWidth, 'idle hitbox must cover only text')
    assert.equal(textHitbox.textRegion, 'no-drag', 'text must receive clicks')
    assert.equal(textHitbox.blankRegion, 'drag', 'blank space beside text must drag the window')
    chrome.focus()
    chrome.sendInputEvent({
      type: 'mouseDown',
      x: textHitbox.x,
      y: textHitbox.y,
      button: 'left',
      clickCount: 1
    })
    chrome.sendInputEvent({
      type: 'mouseUp',
      x: textHitbox.x,
      y: textHitbox.y,
      button: 'left',
      clickCount: 1
    })
    await waitFor(
      () =>
        read(`(() => {
      const input = document.querySelector('input');
      return document.activeElement === input && input.selectionStart === 0 && input.selectionEnd === input.value.length;
    })()`),
      'clicking text must focus and select the whole address'
    )
    await read('document.activeElement.blur()')
    await read(`
      const input = document.querySelector('input');
      input.value = 'https://example.com/' + 'long-path/'.repeat(100);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    `)
    await waitFor(
      () =>
        read(`(() => {
      const input = document.querySelector('input').getBoundingClientRect();
      const bar = document.querySelector('.topbar').getBoundingClientRect();
      return bar.right - input.right >= 80;
    })()`),
      'long URLs must leave at least 80px of draggable topbar'
    )
    assert.equal(
      await read(`getComputedStyle(document.querySelector('.topbar')).transform`),
      'none',
      'native drag region must not be inside a transformed topbar'
    )
    assert.equal(
      await read(`getComputedStyle(document.querySelector('.address-bar')).webkitAppRegion`),
      'drag',
      'reserved topbar space must allow native window dragging'
    )
    cursor.y = bounds.y + 25
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.equal(
      await read('document.querySelector(".topbar").classList.contains("revealed")'),
      true
    )
    cursor.y = bounds.y + 100
    await waitFor(() => page.getBounds().y === 0, 'leaving the bar must hide it without a strip')
    assert.equal(chromeView.getBounds().height, 0)
    cursor = { x: bounds.x + 100, y: bounds.y }
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.equal(chromeView.getBounds().height, 0, 'sidebar edge must not reveal the address bar')
    focused = false
    cursor.x = bounds.x + 300
    await waitFor(() => page.getBounds().y === 38, 'inactive window must reveal at its top edge')
    assert.equal(focused, false, 'hover must not require window focus')
    cursor.y = bounds.y + 25
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.equal(page.getBounds().y, 38, 'inactive window must retain hover within the bar')
    cursor.y = bounds.y + 100
    await waitFor(() => page.getBounds().y === 0, 'leaving the inactive bar must hide it')
    focused = true
    cursor.y = bounds.y
    await waitFor(() => page.getBounds().y === 38, 'active window must reveal at its top edge')
    chrome.focus()
    await read('document.querySelector("input").focus()')
    await waitFor(
      () => read('document.querySelector(".address-bar").classList.contains("focused")'),
      'address must receive focus'
    )
    cursor.y = bounds.y + 100
    await waitFor(
      () => read('!document.querySelector(".topbar").classList.contains("revealed")'),
      'moving away must clear hover'
    )
    assert.equal(page.getBounds().y, 38, 'focused address must stay visible without hover')
    await read('document.activeElement.blur()')
    await waitFor(() => page.getBounds().y === 0, 'blurring address must hide it again')
    await read('window.api.newTab()')
    await waitFor(
      () => read('document.activeElement.tagName === "INPUT"'),
      'new tab must focus address'
    )
    assert.ok(chromeView.getBounds().height >= 38)
    console.log(
      'PASS: 12px reveal zone, no hidden strip, reserved drag space for long URLs, hover retention, inactive-window hover, leave-to-hide, keyboard focus'
    )
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
