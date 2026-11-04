const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-context-menu-check-'))
  const env = { ...process.env, REI_CONTEXT_MENU_CHECK_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
    env,
    stdio: 'inherit',
    timeout: 60000,
    windowsHide: true
  })
  assert.ok(path.resolve(profile).startsWith(path.join(os.tmpdir(), 'rei-context-menu-check-')))
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 })
  if (result.error) console.error(result.error.message)
  process.exit(result.status ?? 1)
}

const Module = require('node:module')
const { createServer } = require('node:http')
const { app, BaseWindow, Menu, nativeTheme } = require('electron')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
const bundlePath = path.resolve(__dirname, '../out/main/index.js')
const bundle = fs.readFileSync(bundlePath, 'utf8').split('function createWindow(')[0]
const browserModule = new Module(bundlePath, module)
browserModule.filename = bundlePath
browserModule.paths = Module._nodeModulePaths(path.dirname(bundlePath))
browserModule._compile(`${bundle}\nmodule.exports = { attachBrowser, SearchStore }`, bundlePath)
app.setPath('userData', process.env.REI_CONTEXT_MENU_CHECK_PROFILE)

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
  const imageBytes = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64'
  )
  const server = createServer((request, response) => {
    if (request.url === '/image.gif') {
      response.setHeader('Content-Type', 'image/gif')
      response.end(imageBytes)
      return
    }
    if (request.url === '/missing.gif') {
      response.writeHead(404)
      response.end()
      return
    }
    response.setHeader('Content-Type', 'text/html')
    response.end(`<!doctype html><title>Context menu fixture</title>
      <style>body{margin:20px}a,img,input,video{display:block;width:150px;height:40px;margin:10px}</style>
      <a id='link' href='/target'>Video link</a>
      <img id='image' src='/image.gif'>
      <input id='input' value='Editable text'>
      <video id='video' src='/video.webm'></video>
      <a id='linked-image' href='/target'><img src='/image.gif'></a>
      <img id='broken-image' src='/missing.gif'>`)
  })
  const popup = Menu.prototype.popup
  let shown
  Menu.prototype.popup = function (options) {
    shown = { menu: this, options }
  }
  let window
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${server.address().port}`
    window = new BaseWindow({ width: 900, height: 670, show: true })
    const chrome = browserModule.exports.attachBrowser(window, store)
    await chrome.loadFile(path.resolve(__dirname, '../out/renderer/index.html'))
    await chrome.executeJavaScript('void window.api.onState(state => window.menuState = state)')
    const state = () => chrome.executeJavaScript('window.menuState')
    await waitFor(async () => (await state())?.tabs.length === 1, 'initial tab must load')
    const originalTab = (await state()).activeTabId
    assert.equal(
      await chrome.executeJavaScript(
        'window.api.getPreferences().then(value => value.contextMenuStyle)'
      ),
      'rei'
    )
    await assert.rejects(
      chrome.executeJavaScript('window.api.setPreferences({contextMenuStyle:"invalid"})'),
      /Choose a context menu style/
    )
    await assert.rejects(
      chrome.executeJavaScript('window.api.setPreferences({contextMenuIcons:"yes"})'),
      /Browser switches must be on or off/
    )
    const sidebar = window.contentView.children[0].webContents
    const contents = window.contentView.children.find(
      (view) => view.webContents && view.webContents !== chrome && view.webContents !== sidebar
    ).webContents
    await chrome.executeJavaScript(`window.api.navigate(${JSON.stringify(url)})`)
    await waitFor(
      () => contents.getURL().startsWith(url) && !contents.isLoading(),
      'fixture must load'
    )
    let overlay
    let menuState
    const readMenu = (script) => overlay.webContents.executeJavaScript(script)
    const dismiss = async () => {
      if (!overlay?.getVisible()) return
      await readMenu(
        'window.api.getContextMenu().then(menu => window.api.dismissContextMenu(menu.id))'
      )
      await waitFor(() => !overlay.getVisible(), 'dismiss must hide menu')
    }
    const rightClick = async (selector, native = false, target = contents) => {
      await dismiss()
      shown = undefined
      target.focus()
      await target.executeJavaScript(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
      )
      const point = selector
        ? await target.executeJavaScript(`(() => {
            const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
            return {x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2)};
          })()`)
        : { x: 400, y: 300 }
      const zoom = target.getZoomFactor()
      point.x = Math.round(point.x * zoom)
      point.y = Math.round(point.y * zoom)
      target.focus()
      target.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, ...point })
      target.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, ...point })
      if (native) {
        await waitFor(() => shown, 'native preference must show system menu')
        assert.equal(shown.options.window, window, 'native menu must belong to the BaseWindow')
        return shown.menu
      }
      await waitFor(
        () => {
          overlay = window.contentView.children.find((view) =>
            view.webContents?.getURL().endsWith('#context-menu')
          )
          return overlay?.getVisible()
        },
        `${selector || 'page'}: right-click must show Rei context menu`
      )
      await waitFor(
        () => readMenu('!!document.querySelector("[role=menuitem]")'),
        'menu must render'
      )
      menuState = await readMenu('window.api.getContextMenu()')
      await waitFor(
        () =>
          readMenu(
            `document.querySelector('[role=menu]')?.dataset.menuId === '${menuState.id}' && document.activeElement?.getAttribute('role') === 'menu'`
          ),
        'current menu must render and receive keyboard focus'
      )
      assert.equal(shown, undefined, 'Rei mode must not show a native menu')
      assert.equal(
        window.contentView.children.at(-1),
        overlay,
        'menu must be above all browser views'
      )
      const bounds =
        target === contents
          ? window.contentView.children.find((view) => view.webContents === target).getBounds()
          : { x: 0, y: 0 }
      if (target === contents) {
        assert.equal(
          menuState.x,
          bounds.x + point.x,
          'menu anchor must include website view offset and zoom'
        )
        assert.equal(menuState.y, bounds.y + point.y)
      }
      return menuState
    }
    const item = (menu, label) => {
      const found = menu.items.find((entry) => entry.label === label)
      assert.ok(found, `${label} must be present`)
      return found
    }
    item(await rightClick('#input'), 'Paste')
    assert.ok(
      await readMenu(
        'parseFloat(getComputedStyle(document.querySelector("[role=menu]")).animationDuration) <= 0.06'
      ),
      'menu entry animation must be very fast'
    )
    await readMenu(
      'window.menuExitFinished = false; document.addEventListener("animationend", event => { if (event.animationName.includes("menu-out")) window.menuExitFinished = true; })'
    )
    const key = async (keyCode) => {
      overlay.webContents.sendInputEvent({ type: 'keyDown', keyCode })
      overlay.webContents.sendInputEvent({ type: 'keyUp', keyCode })
      await new Promise((resolve) => setTimeout(resolve, 30))
    }
    await key('End')
    assert.equal(
      await readMenu(
        'document.getElementById(document.querySelector("[role=menu]").getAttribute("aria-activedescendant")).textContent.trim()'
      ),
      'Inspect'
    )
    await key('Escape')
    await waitFor(() => !overlay.getVisible(), 'Escape must dismiss the menu')
    assert.equal(
      await readMenu('window.menuExitFinished'),
      true,
      'menu must finish its exit animation before hiding the view'
    )
    assert.ok(contents.isFocused(), 'Escape must return focus to the website')
    item(await rightClick(), 'Reload')
    const disabled = menuState.items.find((entry) => !entry.enabled && !entry.separator)
    await readMenu(`window.api.selectContextMenu(${menuState.id}, ${disabled.id})`)
    assert.ok(overlay.getVisible(), 'disabled actions must be ignored')
    const hover = async (label) => {
      const point = await readMenu(`(() => {
        const item = [...document.querySelectorAll('[role=menuitem]')].find(element => element.textContent.trim().startsWith(${JSON.stringify(label)}));
        const bounds = item.getBoundingClientRect();
        window.menuPointerMoved = false;
        window.addEventListener('pointermove', () => window.menuPointerMoved = true, {once:true});
        return {x:Math.round(bounds.x + bounds.width / 2), y:Math.round(bounds.y + bounds.height / 2)};
      })()`)
      overlay.webContents.sendInputEvent({ type: 'mouseMove', ...point })
      await waitFor(() => readMenu('window.menuPointerMoved'), 'hover input must reach menu')
    }
    await hover('Back')
    assert.equal(
      await readMenu('!!document.querySelector(".fluid-hover-indicator.active")'),
      false,
      'disabled rows must not attract fluid hover'
    )
    await hover('Reload')
    await waitFor(
      () => readMenu('!!document.querySelector(".fluid-hover-indicator.active")'),
      'enabled rows must use fluid hover'
    )
    await hover('Back')
    assert.equal(
      await readMenu('document.querySelectorAll(".menu-item.active").length'),
      0,
      'disabled hover must clear the previous text highlight'
    )
    await hover('Reload')
    const mouseColour = await readMenu(
      'getComputedStyle([...document.querySelectorAll("[role=menuitem]")].find(item => item.textContent.trim().startsWith("Reload"))).color'
    )
    await key('Home')
    assert.equal(
      mouseColour,
      await readMenu(
        'getComputedStyle(document.getElementById(document.querySelector("[role=menu]").getAttribute("aria-activedescendant"))).color'
      ),
      'mouse and keyboard selection must use the same text colour'
    )
    await key('Down')
    assert.equal(
      await readMenu(
        'document.getElementById(document.querySelector("[role=menu]").getAttribute("aria-activedescendant")).textContent.trim()'
      ),
      'Inspect'
    )
    item(await rightClick('#video'), 'Copy video address')
    item(await rightClick('#image'), 'Copy image address')
    item(menuState, 'Copy image')
    item(menuState, 'Save image as\u2026')
    assert.ok(
      await readMenu('document.querySelector("[role=menu]").getBoundingClientRect().width <= 240'),
      'default menu must be compact'
    )
    assert.ok(
      await readMenu('document.querySelector(".menu-item").getBoundingClientRect().height <= 26'),
      'default rows must be compact'
    )
    const sourceBounds = window.contentView.children
      .find((view) => view.webContents === contents)
      .getBounds()
    const expectedCopyPoint = { x: menuState.x - sourceBounds.x, y: menuState.y - sourceBounds.y }
    const copyImageAt = contents.copyImageAt.bind(contents)
    let copyPoint
    contents.copyImageAt = (x, y) => {
      copyPoint = { x, y }
    }
    try {
      await readMenu(
        '[...document.querySelectorAll("[role=menuitem]")].find(item => item.textContent.trim() === "Copy image").click()'
      )
      await waitFor(() => copyPoint, 'Copy image must call the source image clipboard API')
      assert.deepEqual(copyPoint, expectedCopyPoint)
    } finally {
      contents.copyImageAt = copyImageAt
    }
    await rightClick('#image')
    await chrome.executeJavaScript(
      `window.api.setPreferences({downloadPrompt:false,downloadDirectory:${JSON.stringify(app.getPath('userData'))}})`
    )
    let downloadState
    contents.session.once('will-download', (_event, download) => {
      download.once('done', (_event, state) => {
        downloadState = state
      })
    })
    await readMenu(
      '[...document.querySelectorAll("[role=menuitem]")].find(item => item.textContent.trim().startsWith("Save image as")).click()'
    )
    await waitFor(() => downloadState, 'Save image must complete a download')
    assert.equal(downloadState, 'completed')
    assert.deepEqual(
      fs.readFileSync(path.join(app.getPath('userData'), 'image.gif')),
      imageBytes,
      'image download must use configured download folder'
    )
    const linkedImage = await rightClick('#linked-image img')
    for (const label of [
      'Open link in new tab',
      'Open image in new tab',
      'Copy image address',
      'Copy image',
      'Save image as\u2026'
    ])
      item(linkedImage, label)
    const brokenImage = await rightClick('#broken-image')
    assert.equal(
      item(brokenImage, 'Copy image').enabled,
      false,
      'unloaded images must not offer working clipboard actions'
    )
    const imageMenu = await rightClick('#image')
    if (process.env.REI_MENU_CAPTURE) {
      await readMenu(
        'Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))).then(() => undefined)'
      )
      fs.writeFileSync(
        path.join(os.tmpdir(), 'rei-context-menu-default.png'),
        (await overlay.webContents.capturePage()).toPNG()
      )
    }
    await chrome.executeJavaScript(
      'window.api.setTheme({fontSize:16,fontWeight:600,radius:14,hoverRadius:12,hoverOpacity:70,hoverSpeed:150,motion:"none",density:"comfortable",colors:{input:"#242126",text:"#fff1f5",accent:"#ffb4ce"}})'
    )
    await waitFor(
      () => readMenu('getComputedStyle(document.querySelector("[role=menu]")).fontSize === "16px"'),
      'theme must sync to open menu'
    )
    assert.equal(
      await readMenu('getComputedStyle(document.querySelector("[role=menu]")).backgroundColor'),
      'rgb(36, 33, 38)'
    )
    assert.equal(await readMenu('document.documentElement.dataset.motion'), 'none')
    assert.equal(
      await readMenu(
        'getComputedStyle(document.querySelector(".fluid-hover-indicator")).transitionDuration'
      ),
      '0s'
    )
    assert.equal(
      (await overlay.webContents.capturePage()).toBitmap()[3],
      0,
      'theme updates must keep overlay transparent'
    )
    await chrome.executeJavaScript('window.api.setTheme({paletteMode:"light"})')
    const lightInput = await chrome.executeJavaScript(
      'getComputedStyle(document.documentElement).getPropertyValue("--rei-input").trim()'
    )
    await waitFor(
      () =>
        readMenu(
          `getComputedStyle(document.documentElement).getPropertyValue('--rei-input').trim() === '${lightInput}'`
        ),
      'light palette must sync'
    )
    nativeTheme.themeSource = 'light'
    await chrome.executeJavaScript('window.api.setTheme({paletteMode:"system"})')
    nativeTheme.themeSource = 'dark'
    await waitFor(
      () =>
        readMenu(
          `getComputedStyle(document.documentElement).getPropertyValue('--rei-input').trim() !== '${lightInput}'`
        ),
      'system palette changes must update open menu'
    )
    nativeTheme.themeSource = 'system'
    await chrome.executeJavaScript('window.api.setTheme({paletteMode:"custom"})')
    await chrome.executeJavaScript('window.api.setPreferences({contextMenuIcons:false})')
    await waitFor(
      () => readMenu('document.querySelectorAll(".menu-item svg").length === 0'),
      'icon preference must sync'
    )
    await chrome.executeJavaScript(
      'window.api.setPreferences({contextMenuIcons:true,backgroundTabs:true})'
    )
    await waitFor(
      () => readMenu('document.querySelectorAll(".menu-item svg").length > 0'),
      'icons must return'
    )
    const staleItem = item(imageMenu, 'Open image in new tab').id
    const linkMenu = await rightClick('#link')
    await readMenu(`window.api.selectContextMenu(${imageMenu.id}, ${staleItem})`)
    assert.equal((await state()).tabs.length, 1, 'stale actions must be ignored')
    await readMenu(
      `window.api.selectContextMenu(${linkMenu.id}, ${linkMenu.items.find((entry) => entry.separator).id})`
    )
    assert.ok(overlay.getVisible(), 'separator actions must be ignored')
    await assert.rejects(
      chrome.executeJavaScript('window.api.selectContextMenu(1,0)'),
      /No handler registered/
    )
    assert.equal(
      await contents.executeJavaScript('typeof window.api'),
      'undefined',
      'websites must not get privileged menu APIs'
    )
    item(linkMenu, 'Open link in new tab')
    await key('Home')
    await key('Return')
    await waitFor(async () => (await state()).tabs.length === 2, 'link must open a new Rei tab')
    assert.equal(
      (await state()).activeTabId,
      originalTab,
      'background-tab preference must keep source active'
    )
    assert.equal((await state()).tabs[0].url, `${url}/`, 'source tab must stay on its page')
    await waitFor(
      () =>
        window.contentView.children.some(
          (view) => view.webContents?.getURL() === `${url}/target` && !view.webContents.isLoading()
        ),
      'new tab must load link destination'
    )
    const next = window.contentView.children.find(
      (view) => view.webContents?.getURL() === `${url}/target`
    ).webContents
    assert.equal(next.listenerCount('context-menu'), 1, 'new tabs must also get context menus')
    await rightClick('#link')
    overlay.webContents.sendInputEvent({
      type: 'mouseDown',
      button: 'left',
      clickCount: 1,
      x: 5,
      y: 5
    })
    overlay.webContents.sendInputEvent({
      type: 'mouseUp',
      button: 'left',
      clickCount: 1,
      x: 5,
      y: 5
    })
    await waitFor(() => !overlay.getVisible(), 'outside click must dismiss')
    await rightClick('#image')
    window.setSize(480, 400)
    await waitFor(() => !overlay.getVisible(), 'resize must dismiss')
    await rightClick('#input')
    await key('End')
    assert.ok(
      await readMenu(
        '(() => { const menu = document.querySelector("[role=menu]").getBoundingClientRect(); const item = document.getElementById(document.querySelector("[role=menu]").getAttribute("aria-activedescendant")).getBoundingClientRect(); return item.top >= menu.top && item.bottom <= menu.bottom; })()'
      ),
      'keyboard navigation must reveal items in a short viewport'
    )
    const menuBounds = await readMenu(
      '(() => { const rect = document.querySelector("[role=menu]").getBoundingClientRect(); return {left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:innerWidth,height:innerHeight}; })()'
    )
    assert.ok(
      menuBounds.left >= 8 &&
        menuBounds.top >= 8 &&
        menuBounds.right <= menuBounds.width - 7 &&
        menuBounds.bottom <= menuBounds.height - 7,
      'menu must stay inside small viewport'
    )
    await dismiss()
    window.setSize(900, 670)
    await chrome.executeJavaScript('window.api.setPreferences({defaultZoom:150})')
    item(await rightClick('#input'), 'Paste')
    assert.equal(
      await readMenu('getComputedStyle(document.querySelector("[role=menu]")).fontSize'),
      '16px',
      'website zoom must not resize menu typography'
    )
    await dismiss()
    await chrome.executeJavaScript(
      'window.api.setPreferences({defaultZoom:100,contextMenuStyle:"native"})'
    )
    item(await rightClick('#link', true), 'Copy link address')
    const nativeImageMenu = await rightClick('#image', true)
    item(nativeImageMenu, 'Copy image')
    item(nativeImageMenu, 'Save image as\u2026')
    await chrome.executeJavaScript('window.api.setPreferences({contextMenuStyle:"rei"})')
    await dismiss()
    overlay.webContents.close()
    overlay = undefined
    const getRendererUrl = chrome.getURL.bind(chrome)
    chrome.getURL = () => 'file:///rei-missing-menu-renderer.html'
    try {
      item(await rightClick('#link', true), 'Copy link address')
    } finally {
      chrome.getURL = getRendererUrl
    }
    await rightClick('#image')
    await chrome.executeJavaScript(
      `window.api.switchTab(${JSON.stringify((await state()).tabs[1].id)})`
    )
    await waitFor(() => !overlay.getVisible(), 'tab switch must dismiss')
    await rightClick('#image', false, next)
    overlay.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers: ['control'] })
    overlay.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'T', modifiers: ['control'] })
    overlay.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Control' })
    await waitFor(
      async () => (await state()).tabs.length === 3,
      'browser shortcuts must work while menu is open'
    )
    assert.equal(overlay.getVisible(), false, 'browser shortcut must dismiss menu')
    await chrome.executeJavaScript('window.api.openSettings()')
    await waitFor(
      () => chrome.executeJavaScript('!!document.querySelector("#settings-tab-browser")'),
      'settings must render'
    )
    await chrome.executeJavaScript('document.querySelector("#settings-tab-browser").click()')
    await waitFor(
      () => chrome.executeJavaScript('!!document.querySelector("#context-menu-style")'),
      'context menu settings must appear'
    )
    assert.ok(await chrome.executeJavaScript('!!document.querySelector("#context-menu-icons")'))
    if (process.env.REI_MENU_CAPTURE) {
      await chrome.executeJavaScript(
        'document.querySelector("#context-menu-style").closest(".rei-card").scrollIntoView({block:"center"})'
      )
      await chrome.executeJavaScript(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
      )
      fs.writeFileSync(
        path.join(os.tmpdir(), 'rei-context-menu-settings.png'),
        (await chrome.capturePage()).toPNG()
      )
      fs.writeFileSync(
        path.join(os.tmpdir(), 'rei-context-menu-sidebar.png'),
        (await sidebar.capturePage()).toPNG()
      )
    }
    await chrome.executeJavaScript('document.querySelector("#context-menu-style").click()')
    await waitFor(
      () => chrome.executeJavaScript('!!document.querySelector("#context-menu-style-option-1")'),
      'style options must open'
    )
    await chrome.executeJavaScript('document.querySelector("#context-menu-style-option-1").click()')
    await waitFor(
      () => chrome.executeJavaScript('!document.querySelector("#context-menu-icons")'),
      'native style must hide custom-only settings'
    )
    const saved = JSON.parse(
      fs.readFileSync(path.join(app.getPath('userData'), 'preferences.json'), 'utf8')
    )
    assert.equal(saved.contextMenuStyle, 'native', 'menu preference must persist')
    assert.equal(saved.contextMenuIcons, true)
    console.log(
      'PASS: mouse/keyboard colours, compact menus, fast entry/exit, image copy wiring/downloads, linked/broken images, native menus, theme/settings, secure actions, zoom/focus'
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
  } finally {
    Menu.prototype.popup = popup
  }
})
