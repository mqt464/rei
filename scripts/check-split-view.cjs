const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-split-check-'))
  const env = { ...process.env, REI_SPLIT_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
    env,
    stdio: 'inherit',
    timeout: 90000,
    windowsHide: true
  })
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 })
  if (result.error) console.error(result.error.message)
  process.exit(result.status ?? 1)
}

const Module = require('node:module')
const { createServer } = require('node:http')
const { app, BaseWindow, nativeImage } = require('electron')
const bundlePath = path.resolve(__dirname, '../out/main/index.js')
const browserModule = new Module(bundlePath, module)
browserModule.filename = bundlePath
browserModule.paths = Module._nodeModulePaths(path.dirname(bundlePath))
browserModule._compile(
  `${fs.readFileSync(bundlePath, 'utf8').split('function createWindow(')[0]}\nmodule.exports = { attachBrowser, SearchStore, splitGeometry, startupSession, resetStartupSession: () => { startupClaimed = false } };`,
  bundlePath
)
app.setPath('userData', process.env.REI_SPLIT_PROFILE)
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
async function waitFor(check, message) {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    if (await check()) return
    await delay(25)
  }
  assert.fail(message)
}

app.whenReady().then(async () => {
  const { attachBrowser, SearchStore, splitGeometry, startupSession, resetStartupSession } =
    browserModule.exports
  const store = new SearchStore(':memory:')
  const server = createServer((request, response) => {
    const reference = request.url === '/reference'
    response.setHeader('Content-Type', 'text/html')
    response.end(`<!doctype html><html><head><title>${reference ? 'Design reference' : 'Project notes'}</title>
      <style>body{margin:0;padding:44px;background:#fbfaf7;color:#252c2a;font:15px/1.7 system-ui}
      main{max-width:540px;margin:auto}small{font-size:11px;letter-spacing:.12em;color:#78847d}
      h1{font-size:32px;font-weight:550;letter-spacing:-.04em;line-height:1.2;margin:20px 0}
      p{color:#626f67}article{padding:18px 0;border-top:1px solid #dfe3dc}h2{font-size:16px;font-weight:550}
      .tile{background:#e9eee6;border-radius:8px;padding:24px;margin:26px 0;height:105px}
      </style></head><body><main><small>REI / ${reference ? 'REFERENCE' : 'WORKSPACE'}</small>
      <h1>${reference ? 'A little room to think.' : 'Keep the good parts together.'}</h1>
      <p>${reference ? 'A reference on one side. Your work on the other.' : 'Notes for a calmer, more useful browsing space.'}</p>
      <div class="tile">${reference ? 'Quiet surfaces. Clear relationships.' : 'Two pages. One train of thought.'}</div>
      <article><h2>${reference ? 'Make room for focus' : 'A shared space'}</h2><p>Keep context close without losing your place.</p></article>
      <article><h2>Small, deliberate details</h2><p>Useful controls stay close to the work.</p></article>
      <video controls></video></main></body></html>`)
  })
  let window
  let failed = false
  try {
    for (const width of [0, 1, 2, 80, 320, 600, 895, 1280]) {
      for (const ratio of [-1, 0, 0.2, 0.5, 0.9, 1, Infinity, NaN]) {
        const geometry = splitGeometry(width, ratio)
        assert.equal(geometry.leftWidth + geometry.rightWidth, Math.max(0, width - 2))
        assert.ok(geometry.leftWidth >= 0 && geometry.rightWidth >= 0)
        if (width >= 322) assert.ok(geometry.leftWidth >= 160 && geometry.rightWidth >= 160)
      }
    }
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    window = new BaseWindow({ width: 1120, height: 760, title: 'Rei split view check' })
    const chrome = attachBrowser(window, store)
    for (const view of window.contentView.children) {
      view.webContents.setBackgroundThrottling(false)
      view.webContents.ipc.handle('extensions:get', () => ({
        extensions: [],
        chromeWebStore: true
      }))
    }
    await chrome.loadFile(path.resolve(__dirname, '../out/renderer/index.html'))
    await chrome.executeJavaScript('void window.api.onState(state => window.splitState = state)')
    const state = () => chrome.executeJavaScript('window.splitState')
    const call = (expression) => chrome.executeJavaScript(expression)
    const origin = `http://127.0.0.1:${server.address().port}`
    const pageView = (id) =>
      window.contentView.children.find((view) =>
        view.webContents?.getURL().startsWith(`${origin}/${id}`)
      )
    await waitFor(async () => (await state())?.activeTabId, 'initial tab must load')
    await call(`window.api.navigate('${origin}/notes')`)
    await waitFor(async () => (await state()).tabs[0]?.title === 'Project notes', 'notes must load')
    const leftId = (await state()).activeTabId
    await call('window.api.newTab()')
    await waitFor(async () => (await state()).tabs.length === 2, 'second tab must open')
    await call(`window.api.navigate('${origin}/reference')`)
    await waitFor(
      async () => (await state()).tabs[1]?.title === 'Design reference',
      'reference must load'
    )
    const rightId = (await state()).activeTabId
    const leftView = pageView('notes')
    const rightView = pageView('reference')
    const sidebar = window.contentView.children.find((view) =>
      view.webContents.getURL().endsWith('#tabs')
    )
    const splitBar = window.contentView.children.find((view) =>
      view.webContents.getURL().endsWith('#split')
    )
    const divider = window.contentView.children.find((view) =>
      view.webContents.getURL().endsWith('#split-divider')
    )
    await waitFor(
      async () => sidebar && !(await sidebar.webContents.isLoading()),
      'sidebar must load'
    )
    await call(`window.api.switchTab('${leftId}')`)
    await waitFor(async () => (await state()).activeTabId === leftId, 'notes must activate')
    await sidebar.webContents.executeJavaScript(
      `document.querySelector('[data-tab-id="${rightId}"]').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true,clientX:100,clientY:85}))`
    )
    const context = () =>
      window.contentView.children.find((view) =>
        view.webContents?.getURL().endsWith('#context-menu')
      )
    await waitFor(() => context()?.getVisible(), 'tab menu must open')
    context().webContents.setBackgroundThrottling(false)
    await waitFor(
      async () =>
        (await context().webContents.executeJavaScript('document.body.innerText')).includes(
          'Split view with current tab'
        ),
      'split menu action must appear'
    )
    await context().webContents.executeJavaScript(
      `Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes('Split view with current tab')).click()`
    )
    await waitFor(async () => (await state()).split?.rightId === rightId, 'menu must create split')
    await waitFor(
      () => rightView.getBounds().width > 350 && leftView.getBounds().width < 500,
      'panes must animate into place'
    )
    await delay(350)
    assert.equal(leftView.getVisible(), true)
    assert.equal(rightView.getVisible(), true)
    assert.equal(splitBar.getVisible(), true)
    assert.equal(
      leftView.getBounds().width + rightView.getBounds().width + 2,
      window.getContentBounds().width - leftView.getBounds().x
    )
    await waitFor(
      async () =>
        (await sidebar.webContents.executeJavaScript(
          'document.querySelectorAll(".split-badge").length'
        )) === 2,
      'both tabs need paired badges'
    )
    await waitFor(
      async () =>
        (await splitBar.webContents.executeJavaScript(
          'document.querySelectorAll(".pane-title").length'
        )) === 2,
      'both panes need labeled focus controls'
    )
    const artifacts = path.resolve(__dirname, '../.cache/split-view')
    fs.mkdirSync(artifacts, { recursive: true })
    const capture = async (name) => {
      await fs.promises.writeFile(
        path.join(artifacts, 'sidebar.png'),
        (await sidebar.webContents.capturePage()).toPNG()
      )
      await fs.promises.writeFile(
        path.join(artifacts, 'toolbar.png'),
        (await splitBar.webContents.capturePage()).toPNG()
      )
      const { width, height } = window.getContentBounds()
      const pixels = Buffer.alloc(width * height * 4)
      for (const view of window.contentView.children) {
        const bounds = view.getBounds()
        if (!view.getVisible() || !bounds.width || !bounds.height) continue
        const image = (await view.webContents.capturePage()).resize({
          width: bounds.width,
          height: bounds.height
        })
        const bitmap = image.toBitmap()
        for (let row = 0; row < bounds.height; row++) {
          for (let column = 0; column < bounds.width; column++) {
            const source = (row * bounds.width + column) * 4
            const target = ((bounds.y + row) * width + bounds.x + column) * 4
            const alpha = bitmap[source + 3] / 255
            if (!alpha) continue
            for (let channel = 0; channel < 3; channel++)
              pixels[target + channel] = Math.round(
                bitmap[source + channel] * alpha + pixels[target + channel] * (1 - alpha)
              )
            pixels[target + 3] = 255
          }
        }
      }
      fs.writeFileSync(
        path.join(artifacts, `${name}.png`),
        nativeImage.createFromBitmap(pixels, { width, height }).toPNG()
      )
    }
    try {
      await capture('split-view')
    } catch (error) {
      console.warn('Screenshot unavailable:', error.message)
    }
    rightView.webContents.focus()
    await waitFor(
      async () => (await state()).activeTabId === rightId,
      'clicking right pane must update active tab'
    )
    assert.equal(
      await splitBar.webContents.executeJavaScript(
        'document.querySelectorAll(".split-actions").length'
      ),
      0
    )
    window.focus()
    const input = (contents, type, x, y) =>
      contents.sendInputEvent({
        type,
        x: Math.round(x),
        y: Math.round(y),
        button: 'left',
        modifiers: type === 'mouseMove' ? ['leftButtonDown'] : [],
        clickCount: 1
      })
    const headerDrag = async (cancel = false, destination = 0.8) => {
      input(splitBar.webContents, 'mouseDown', 120, 16)
      input(splitBar.webContents, 'mouseMove', 130, 18)
      await waitFor(async () => (await state()).split?.gesture === 'move', 'header drag must start')
      assert.equal(
        splitBar.getBounds().height,
        window.getContentBounds().height - splitBar.getBounds().y
      )
      const targetX = splitBar.getBounds().width * destination
      input(splitBar.webContents, 'mouseMove', targetX, 110)
      await delay(40)
      assert.ok(
        await splitBar.webContents.executeJavaScript('document.querySelector(".drop-target")')
      )
      if (!cancel && destination === 0.8) {
        await delay(200)
        await capture('drag-placement')
      }
      if (cancel) splitBar.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
      input(splitBar.webContents, 'mouseUp', targetX, 110)
      await waitFor(async () => !(await state()).split?.gesture, 'header drag must finish')
    }
    await headerDrag(true)
    assert.equal((await state()).split.leftId, leftId, 'Escape must cancel moving')
    await headerDrag(false, 0.2)
    assert.equal((await state()).split.leftId, leftId, 'same-side drop must not swap')
    await headerDrag()
    await waitFor(async () => (await state()).split?.leftId === rightId, 'drag must swap sides')
    await delay(350)
    assert.ok(rightView.getBounds().x < leftView.getBounds().x)
    assert.equal(divider.getBounds().width, 12)
    const originalRatio = (await state()).split.ratio
    input(divider.webContents, 'mouseDown', 6, 120)
    await waitFor(
      async () => (await state()).split?.gesture === 'resize',
      'divider drag must start'
    )
    const expandedWidth = divider.getBounds().width
    input(divider.webContents, 'mouseMove', expandedWidth * 0.66, 120)
    await waitFor(async () => (await state()).split.ratio > 0.64, 'divider must resize pages live')
    const headerX = await splitBar.webContents.executeJavaScript(
      'document.querySelectorAll(".pane-heading")[1].getBoundingClientRect().left'
    )
    assert.ok(
      Math.abs(headerX - (rightView.getBounds().width + 2)) <= 1,
      'header must track divider without animation lag'
    )
    await capture('resizing')
    assert.equal(rightView.getBounds().width + 2 + leftView.getBounds().width, expandedWidth)
    divider.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    input(divider.webContents, 'mouseUp', expandedWidth * 0.66, 120)
    await waitFor(async () => !(await state()).split.gesture, 'resize cancellation must finish')
    assert.ok(
      Math.abs((await state()).split.ratio - originalRatio) < 0.002,
      'Escape must restore widths'
    )
    input(divider.webContents, 'mouseDown', 6, 120)
    await waitFor(
      async () => (await state()).split?.gesture === 'resize',
      'second resize must start'
    )
    input(divider.webContents, 'mouseMove', expandedWidth * 0.62, 120)
    await delay(60)
    input(divider.webContents, 'mouseUp', expandedWidth * 0.62, 120)
    await waitFor(
      async () => !(await state()).split.gesture && (await state()).split.ratio > 0.6,
      'resize must persist after drop'
    )
    await divider.webContents.executeJavaScript(
      'document.querySelector("[role=separator]").dispatchEvent(new KeyboardEvent("keydown",{key:"End",bubbles:true}))'
    )
    await waitFor(
      async () => (await state()).split.ratio >= 0.8,
      'divider End must clamp at maximum'
    )
    assert.ok(leftView.getBounds().width >= 160, 'minimum pane width must hold')
    await divider.webContents.executeJavaScript(
      'document.querySelector("[role=separator]").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}))'
    )
    await waitFor(
      async () => Math.abs((await state()).split.ratio - 0.5) < 0.002,
      'Enter must balance panes'
    )
    window.setContentSize(620, 550)
    await waitFor(() => rightView.getBounds().width < 300, 'split must adapt to a narrow window')
    assert.equal(rightView.getBounds().x + rightView.getBounds().width + 2, leftView.getBounds().x)
    assert.equal(leftView.getBounds().x + leftView.getBounds().width, 620)
    await call('window.api.setTheme({sidebarIconsOnly:true})')
    await waitFor(() => rightView.getBounds().x === 52, 'split must adapt to icon-only sidebar')
    await call('window.api.setTheme({sidebarIconsOnly:false})')
    window.setContentSize(1104, 695)
    await waitFor(() => rightView.getBounds().width > 350, 'split must recover its full width')
    rightView.webContents.emit('enter-html-full-screen')
    await waitFor(() => !splitBar.getVisible(), 'fullscreen must hide split controls')
    assert.equal(leftView.getVisible(), false)
    rightView.webContents.emit('leave-html-full-screen')
    await waitFor(
      () => splitBar.getVisible() && leftView.getVisible(),
      'fullscreen exit must restore both panes'
    )
    await call('window.api.newTab()')
    await waitFor(async () => !(await state()).split, 'unrelated tab must hide pair')
    assert.equal(leftView.getVisible(), false)
    assert.equal(rightView.getVisible(), false)
    await call(`window.api.switchTab('${leftId}')`)
    await waitFor(async () => !!(await state()).split, 'returning to paired tab must restore split')
    await call(`window.api.setPreferences({startup:'restore'})`)
    await divider.webContents.executeJavaScript(
      'document.querySelector("[role=separator]").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}))'
    )
    await waitFor(
      async () => (await state()).split.ratio > 0.51,
      'keyboard resize must update restored pair'
    )
    await delay(350)
    const saved = JSON.parse(
      fs.readFileSync(path.join(process.env.REI_SPLIT_PROFILE, 'session.json'), 'utf8')
    )
    assert.deepEqual(
      saved.splits.map((pair) => pair.slice(0, 2)),
      [[1, 0]]
    )
    assert.ok(Math.abs(saved.splits[0][2] - (await state()).split.ratio) < 0.002)
    const sessionPath = path.join(process.env.REI_SPLIT_PROFILE, 'session.json')
    for (const [splits, expected] of [
      [[[0, 1]], [[0, 1]]],
      [[[0, 1, 0.67]], [[0, 1, 0.67]]],
      [
        [
          [0, 1, 0],
          [0, 1, 1],
          [0, 1, null],
          [0, 8, 0.5],
          [1, 1]
        ],
        []
      ]
    ]) {
      fs.writeFileSync(sessionPath, JSON.stringify({ urls: saved.urls, active: 0, splits }))
      resetStartupSession()
      assert.deepEqual(
        startupSession({ startup: 'restore' }).splits,
        expected,
        'session reader must validate ratios and accept legacy pairs'
      )
    }
    fs.writeFileSync(sessionPath, JSON.stringify(saved))
    await call(`window.api.unsplitTab('${leftId}')`)
    await waitFor(async () => !(await state()).split, 'separate must keep both tabs open')
    assert.equal((await state()).tabs.length, 3)
    await call(`window.api.setTheme({motion:'none'})`)
    await call(`window.api.splitTab('${rightId}')`)
    await waitFor(async () => !!(await state()).split, 'pair must be reusable')
    assert.ok(rightView.getBounds().width > 350)
    await call(`window.api.closeTab('${leftId}')`)
    await waitFor(
      async () => (await state()).activeTabId === rightId && !(await state()).split,
      'closing focused pane must preserve and focus partner'
    )
    assert.equal(rightView.getVisible(), true)
    await call('window.api.newIncognitoTab()')
    await waitFor(
      async () => (await state()).tabs.some((tab) => tab.incognito),
      'private tab must open'
    )
    await call(`window.api.navigate('${origin}/private')`)
    await waitFor(async () => !(await state()).loading, 'private page must load')
    await call(`window.api.splitTab('${rightId}')`)
    await delay(100)
    assert.equal((await state()).split, undefined, 'private and normal tabs must not pair')
    await call(`window.api.switchTab('${rightId}')`)
    const blank = (await state()).tabs.find((tab) => !tab.url)
    assert.ok(blank)
    await call(`window.api.splitTab('${blank.id}')`)
    await delay(100)
    assert.equal((await state()).split, undefined, 'empty pages must not pair')
    console.log(
      'Tab menus, split layout, badges, focus, drag placement, resize, cancellation, keyboard, fullscreen, session save, separation, reduced motion, close, and privacy checks passed.'
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
