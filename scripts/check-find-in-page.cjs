const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-find-check-'))
  const env = { ...process.env, REI_FIND_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
    env,
    stdio: 'inherit',
    timeout: 45000,
    windowsHide: true
  })
  assert.ok(path.resolve(profile).startsWith(path.join(os.tmpdir(), 'rei-find-check-')))
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 })
  if (result.error) console.error(result.error)
  process.exit(result.status ?? 1)
}

const Module = require('node:module')
const { createServer } = require('node:http')
const { app, BaseWindow, webContents } = require('electron')
process.on('uncaughtException', (error) => {
  console.error(error.stack)
  app.exit(1)
})
process.on('unhandledRejection', (error) => {
  console.error(error)
  app.exit(1)
})
app.setPath('userData', process.env.REI_FIND_PROFILE)
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
const bundlePath = path.resolve(__dirname, '../out/main/index.js')
const browserModule = new Module(bundlePath, module)
browserModule.filename = bundlePath
browserModule.paths = Module._nodeModulePaths(path.dirname(bundlePath))
browserModule._compile(
  fs.readFileSync(bundlePath, 'utf8').split('function createWindow(')[0] +
    '\nmodule.exports = { attachBrowser, SearchStore }',
  bundlePath
)

async function waitFor(check, message) {
  const deadline = Date.now() + 6000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.fail(message)
}

async function press(contents, keyCode, modifiers = []) {
  contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
  contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
}

app.whenReady().then(async () => {
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end(
      '<!doctype html><title>Finder fixture</title><p>needle NEEDLE needle</p><p>other</p>'
    )
  })
  const store = new browserModule.exports.SearchStore(':memory:')
  const window = new BaseWindow({ width: 1000, height: 700 })
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${server.address().port}/`
    const chrome = browserModule.exports.attachBrowser(window, store)
    await chrome.loadFile(path.resolve(__dirname, '../out/renderer/index.html'))
    const readChrome = (script) => chrome.executeJavaScript(script)
    await readChrome('void window.api.onState(state => window.findTestState = state)')
    await waitFor(() => readChrome('!!window.findTestState'), 'initial state')
    await readChrome(`window.api.navigate(${JSON.stringify(url)})`)
    let page
    await waitFor(() => {
      page = webContents.getAllWebContents().find((contents) => contents.getURL() === url)
      return page && !page.isLoading()
    }, 'fixture loads')
    window.show()
    window.focus()
    page.focus()
    const pageView = window.contentView.children.find((view) => view.webContents === page)
    const bounds = pageView.getBounds()
    await press(page, 'F', ['control'])
    let finder
    await waitFor(async () => {
      finder = webContents
        .getAllWebContents()
        .find((contents) => contents.getURL().endsWith('#find'))
      return finder && (await finder.executeJavaScript('!!document.querySelector(".finder input")'))
    }, 'Ctrl+F opens finder from webpage')
    const read = (script) =>
      finder.executeJavaScript(script).catch((error) => {
        throw new Error(`Finder script failed: ${script}`, { cause: error })
      })
    const state = () => read('window.api.getFindState()')
    const visible = () =>
      window.contentView.children.find((view) => view.webContents === finder).getVisible()
    await waitFor(
      () =>
        read('document.activeElement === document.querySelector("input") && document.hasFocus()'),
      'finder focuses input'
    )
    assert.deepEqual(pageView.getBounds(), bounds, 'finder must overlay, not resize page')
    assert.equal(await read('!!document.querySelector(".field .text-overlay .custom-caret")'), true)
    await read(
      'document.querySelector("input").value = "needle"; document.querySelector("input").dispatchEvent(new Event("input", { bubbles: true }))'
    )
    await waitFor(
      async () => (await state()).matches === 3,
      'typing finds case-insensitive page matches'
    )
    const first = (await state()).activeMatchOrdinal
    await press(finder, 'Enter')
    await waitFor(async () => (await state()).activeMatchOrdinal !== first, 'Enter advances match')
    await press(finder, 'Enter', ['shift'])
    await waitFor(
      async () => (await state()).activeMatchOrdinal === first,
      'Shift+Enter returns to match'
    )
    await press(finder, 'Escape')
    await waitFor(() => page.isFocused(), 'Escape returns focus to page')
    assert.equal(visible(), true, 'Escape unfocuses without closing')
    assert.equal((await state()).matches, 3, 'Escape preserves search highlights')
    await press(page, 'F', ['control'])
    await waitFor(
      () => read('document.activeElement.selectionEnd === 6 && document.hasFocus()'),
      'Ctrl+F refocuses and selects query'
    )
    await read(
      'document.querySelector("input").value = "absent"; document.querySelector("input").dispatchEvent(new Event("input", { bubbles: true }))'
    )
    await waitFor(
      async () => (await state()).query === 'absent' && (await state()).matches === 0,
      'no-match query clears count'
    )
    await read(
      'document.querySelector("input").value = ""; document.querySelector("input").dispatchEvent(new Event("input", { bubbles: true }))'
    )
    await waitFor(async () => (await state()).query === '', 'empty query clears highlights')
    await read(`document.querySelector('button[aria-label="Close find in page"]').click()`)
    await waitFor(
      () => !visible() && page.isFocused(),
      'close hides finder and restores page focus'
    )
    await readChrome('window.api.setPreferences({keybindings: {findInPage: ["F3"]}})')
    await press(page, 'F', ['control'])
    assert.equal(visible(), false, 'old shortcut disabled after remap')
    await press(page, 'F3')
    await waitFor(() => visible() && finder.isFocused(), 'custom shortcut opens finder')
    await read('window.api.findInPage("needle")')
    await waitFor(async () => (await state()).matches === 3, 'remapped finder searches same page')
    await page.reload()
    await waitFor(() => !visible() && !page.isLoading(), 'navigation dismisses finder')
    await press(page, 'F3')
    await waitFor(() => visible() && finder.isFocused(), 'finder reopens after navigation')
    assert.equal((await state()).query, '', 'navigation clears old query')
    await readChrome('window.api.setTheme({ motion: "reduced", caretMoveDuration: 120 })')
    await waitFor(
      () => read('document.documentElement.dataset.motion === "reduced"'),
      'finder follows reduced motion settings'
    )
    assert.equal(
      await read('getComputedStyle(document.querySelector(".finder")).animationName'),
      'none'
    )
    assert.equal(
      await read(
        'getComputedStyle(document.documentElement).getPropertyValue("--rei-caret-move-duration").trim()'
      ),
      '120ms'
    )
    await readChrome('window.api.newTab()')
    await waitFor(() => !visible(), 'tab switch dismisses old page search')
    await readChrome('window.api.openSettings()')
    await waitFor(() => readChrome('!!document.querySelector(".settings-page")'), 'settings opens')
    await readChrome('window.api.navigate("rei://settings/keybinds")')
    await waitFor(
      () => readChrome('document.body.textContent.includes("Find in page")'),
      'keybind settings lists finder'
    )
    console.log(
      'PASS: finder shortcut/settings/remap, overlay bounds, focus/Escape, smooth caret, live matches, next/previous, empty/no results, close and tab isolation'
    )
  } catch (error) {
    console.error(error.stack)
    process.exitCode = 1
  } finally {
    window.destroy()
    store.close()
    server.close()
    app.exit(process.exitCode || 0)
  }
})
