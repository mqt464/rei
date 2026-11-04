const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-shortcut-check-'))
  const env = { ...process.env, REI_SHORTCUT_CHECK_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
    env,
    stdio: 'inherit',
    timeout: 30000,
    windowsHide: true
  })
  assert.ok(path.resolve(profile).startsWith(path.join(os.tmpdir(), 'rei-shortcut-check-')))
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 })
  if (result.error) console.error(result.error.message)
  process.exit(result.status ?? 1)
}

const Module = require('node:module')
const { createServer } = require('node:http')
const { app, BaseWindow, webContents } = require('electron')
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const bundlePath = path.resolve(__dirname, '../out/main/index.js')
const bundle = fs.readFileSync(bundlePath, 'utf8').split('function createWindow(')[0]
const browserModule = new Module(bundlePath, module)
browserModule.filename = bundlePath
browserModule.paths = Module._nodeModulePaths(path.dirname(bundlePath))
browserModule._compile(`${bundle}\nmodule.exports = { attachBrowser, SearchStore }`, bundlePath)
app.setPath('userData', process.env.REI_SHORTCUT_CHECK_PROFILE)

async function waitFor(check, message) {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    if (await check()) return
    await delay(20)
  }
  assert.fail(message)
}

app.whenReady().then(async () => {
  const store = new browserModule.exports.SearchStore(':memory:')
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end(`<!doctype html><title>Keyboard fixture</title><script>
      window.shortcutEvents = [];
      window.addEventListener('keydown', event => {
        if (event.ctrlKey && event.key !== 'Control') window.shortcutEvents.push(event.key.toLowerCase());
      });
    </script>`)
  })
  let window
  try {
    window = new BaseWindow({ width: 900, height: 670 })
    Object.defineProperty(app, 'isPackaged', { value: true })
    const chrome = browserModule.exports.attachBrowser(window, store)
    await chrome.loadFile(path.resolve(__dirname, '../out/renderer/index.html'))
    const sidebar = window.contentView.children[0].webContents
    await waitFor(() => !sidebar.isLoading() && sidebar.getURL(), 'sidebar must load')
    await chrome.executeJavaScript('void window.api.onState(state => window.shortcutState = state)')
    const state = () => chrome.executeJavaScript('window.shortcutState')
    const pills = () =>
      sidebar.executeJavaScript('document.querySelectorAll(".tab-shortcut").length')
    await waitFor(async () => (await state())?.tabs.length === 1, 'initial tab must load')
    window.show()
    window.focus()
    chrome.focus()

    const send = async (type, keyCode, modifiers = []) => {
      const focused = webContents.getFocusedWebContents() || chrome
      focused.sendInputEvent({ type, keyCode, modifiers })
      await delay(30)
    }
    const press = async (key, modifiers = ['control']) => {
      await send('keyDown', key, modifiers)
      await send('keyUp', key, modifiers)
    }
    const record = async (...keys) => {
      await send('keyDown', 'Control', ['control'])
      for (const key of keys) await press(key)
      await send('keyUp', 'Control')
    }
    const hold = async () => {
      await send('keyDown', 'Control', ['control'])
      await waitFor(async () => (await pills()) > 0, 'Control down must show pills')
    }
    const release = async (label) => {
      await send('keyUp', 'Control')
      await waitFor(
        async () => (await pills()) === 0,
        `${label}: Control up must hide pills without another input`
      )
      assert.equal((await state()).controlHeld, false, `${label}: main state must clear`)
    }
    const checkShortcut = async (key, check, modifiers = ['control']) => {
      await hold()
      await press(key, modifiers)
      await waitFor(check, `${key}: shortcut action must run`)
      assert.ok(await pills(), `${key}: pills must remain while Control held`)
      await release(key)
    }

    await press('T', ['control', 'shift'])
    assert.equal((await state()).tabs.length, 1, 'reopen with no closed tabs must do nothing')
    await hold()
    await release('baseline')
    await checkShortcut('T', async () => (await state()).tabs.length === 2)
    for (let index = 2; index < 9; index++) await chrome.executeJavaScript('window.api.newTab()')
    await waitFor(async () => (await state()).tabs.length === 9, 'nine tabs must exist')
    const ids = (await state()).tabs.map((tab) => tab.id)
    for (let index = 0; index < ids.length; index++) {
      await checkShortcut(String(index + 1), async () => (await state()).activeTabId === ids[index])
    }
    await checkShortcut('Tab', async () => (await state()).activeTabId === ids[0])
    await checkShortcut('Tab', async () => (await state()).activeTabId === ids[8], [
      'control',
      'shift'
    ])
    await checkShortcut('L', async () => webContents.getFocusedWebContents() === chrome)
    await checkShortcut('R', async () => webContents.getFocusedWebContents() === chrome)
    assert.equal(
      await chrome.executeJavaScript(`
      window.dispatchEvent(new KeyboardEvent('keydown', {key: 'r', ctrlKey: true, cancelable: true}))
    `),
      false,
      'packaged browser chrome must still block reload'
    )
    await hold()
    await press('T')
    await press('T')
    assert.equal((await state()).tabs.length, 11, 'repeated Ctrl+T must create tabs')
    await press('W')
    await press('W')
    assert.equal((await state()).tabs.length, 9, 'repeated Ctrl+W must close tabs')
    assert.ok(await pills(), 'repeated shortcuts must preserve held state')
    await release('repeated shortcuts')
    await hold()
    await press('B')
    await press('B')
    await release('sidebar toggle')

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${server.address().port}/`
    await chrome.executeJavaScript(`window.api.navigate(${JSON.stringify(url)})`)
    let page
    await waitFor(() => {
      page = webContents.getAllWebContents().find((contents) => contents.getURL() === url)
      return page && !page.isLoading()
    }, 'sandboxed page must load')
    const pageTabId = (await state()).activeTabId
    await page.executeJavaScript(`new Promise(resolve => {
      const frame = document.createElement('iframe');
      frame.onload = () => resolve();
      frame.src = '/frame';
      document.body.append(frame);
    })`)
    assert.equal(
      await page.executeJavaScript(`
      const frame = window.frames[0];
      const event = new frame.KeyboardEvent('keydown', {key: 't', ctrlKey: true, cancelable: true});
      frame.dispatchEvent(event);
      event.defaultPrevented
    `),
      true,
      'iframe browser shortcuts must also be cancelled'
    )
    const focusPage = async () => {
      await chrome.executeJavaScript(`window.api.switchTab(${JSON.stringify(pageTabId)})`)
      await waitFor(() => webContents.getFocusedWebContents() === page, 'page tab must have focus')
    }
    assert.equal(
      await page.executeJavaScript('typeof window.frames[0].require'),
      'undefined',
      'iframe must not receive Node APIs'
    )
    assert.equal(
      await page.executeJavaScript('typeof window.frames[0].api'),
      'undefined',
      'iframe must not receive browser API'
    )
    assert.equal(page.getLastWebPreferences().sandbox, true, 'renderer sandbox must stay enabled')
    if (process.platform === 'win32' || process.platform === 'darwin') {
      assert.equal(
        app.getAppMetrics().find((metric) => metric.pid === page.getOSProcessId())?.sandboxed,
        true,
        'renderer must remain sandboxed at OS level'
      )
    }
    assert.equal(
      await page.executeJavaScript('typeof window.api'),
      'undefined',
      'page must not receive browser API'
    )
    assert.equal(
      await page.executeJavaScript('typeof require'),
      'undefined',
      'page must remain sandboxed'
    )
    assert.deepEqual(
      await page.executeJavaScript(`
      ['t', 'w', 'l', 'Tab', 'b', '1', '9'].map(key => {
        const event = new KeyboardEvent('keydown', { key, ctrlKey: true, cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      })
    `),
      Array(7).fill(true),
      'sandboxed preload must block browser shortcut defaults'
    )
    await focusPage()
    await checkShortcut('L', async () => webContents.getFocusedWebContents() === chrome)
    await focusPage()
    await checkShortcut('T', async () => (await state()).tabs.length === 10)
    assert.deepEqual(
      await page.executeJavaScript('window.shortcutEvents'),
      [],
      'browser shortcuts must not reach site handlers'
    )
    await focusPage()
    assert.equal(
      await page.executeJavaScript(`
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true }))
    `),
      true,
      'unhandled site shortcut must not be cancelled'
    )
    assert.deepEqual(
      await page.executeJavaScript('window.shortcutEvents'),
      ['k'],
      'unhandled shortcut must reach site handlers'
    )
    await focusPage()
    const secondUrl = url + 'second'
    await chrome.executeJavaScript(`window.api.navigate(${JSON.stringify(secondUrl)})`)
    await waitFor(
      () => page.getURL() === secondUrl && !page.isLoading(),
      'second navigation must load'
    )
    await press('[')
    await waitFor(() => page.getURL() === url && !page.isLoading(), 'Ctrl+[ must go back')
    await press(']')
    await waitFor(() => page.getURL() === secondUrl && !page.isLoading(), 'Ctrl+] must go forward')
    const zoom = page.getZoomFactor()
    await press('=')
    assert.ok(page.getZoomFactor() > zoom, 'Ctrl+= must zoom in')
    await press('0')
    assert.equal(page.getZoomFactor(), zoom, 'Ctrl+0 must reset zoom')
    await press('M', ['control', 'shift'])
    assert.equal(page.isAudioMuted(), true, 'Ctrl+Shift+M must mute page')
    await page.executeJavaScript(`new Promise(resolve => {
      const frame = document.createElement('iframe');
      frame.onload = resolve;
      frame.src = '/frame';
      document.body.append(frame);
    })`)
    await chrome.executeJavaScript(
      `window.api.setPreferences({keybindings: {newTab: ['Ctrl+K', 'Ctrl+C']}})`
    )
    await waitFor(
      async () =>
        JSON.stringify(
          await page.executeJavaScript(`['k', 't'].map(key => {
      const event = new KeyboardEvent('keydown', {key, ctrlKey: true, cancelable: true});
      window.frames[0].dispatchEvent(event);
      return event.defaultPrevented;
    })`)
        ) === '[true,false]',
      'existing iframe must use updated bindings, not old defaults'
    )
    await focusPage()
    const count = (await state()).tabs.length
    await press('K')
    assert.equal((await state()).tabs.length, count, 'sequence prefix must not run action')
    await press('C')
    await waitFor(
      async () => (await state()).tabs.length === count + 1,
      'sequence must create tab from a website'
    )
    await focusPage()
    await chrome.executeJavaScript(`window.api.navigate('rei://settings/keybinds')`)
    await waitFor(
      () => chrome.executeJavaScript(`!!document.querySelector('#keybind-newTab')`),
      'keybind settings must render'
    )
    chrome.focus()
    assert.equal(
      await chrome.executeJavaScript(`!!document.querySelector('#keybind-help')`),
      false,
      'instruction paragraph must be removed'
    )
    assert.equal(
      await chrome.executeJavaScript(`document.querySelectorAll('.keybind-field button').length`),
      0,
      'recorder must have no action buttons'
    )
    assert.equal(
      await chrome.executeJavaScript(`(() => {
      const short = document.querySelector('#keybind-newTab');
      const long = document.querySelector('#keybind-previousTab');
      const style = getComputedStyle(short);
      return short.getBoundingClientRect().width !== long.getBoundingClientRect().width && style.paddingLeft === style.paddingRight;
    })()`),
      true,
      'fields must fit their contents with equal horizontal padding'
    )
    await chrome.executeJavaScript(
      `document.querySelector('#keybind-newTab').focus(); document.querySelector('#keybind-newTab').click()`
    )
    assert.equal(
      await chrome.executeJavaScript(`document.querySelector('#keybind-newTab').value`),
      '...',
      'click must show recording placeholder'
    )
    const captureCount = (await state()).tabs.length
    await send('keyDown', 'Control', ['control'])
    assert.equal(
      await chrome.executeJavaScript(`document.querySelector('#keybind-newTab').value`),
      'Ctrl',
      'modifier must appear while held'
    )
    await send('keyDown', 'L', ['control'])
    assert.equal(
      await chrome.executeJavaScript(`document.querySelector('#keybind-newTab').value`),
      'Ctrl + L',
      'keydown must show the current combination immediately'
    )
    await send('keyUp', 'L', ['control'])
    await send('keyUp', 'Control')
    assert.equal(
      (await state()).tabs.length,
      captureCount,
      'recorder must suppress browser actions'
    )
    assert.equal(
      await chrome.executeJavaScript('document.activeElement.id'),
      'keybind-newTab',
      'recording Ctrl+L must not focus address bar'
    )
    await press('Escape', [])
    assert.equal(
      await chrome.executeJavaScript(`document.querySelector('#keybind-newTab').value`),
      'Ctrl + K then Ctrl + C',
      'Escape must restore original binding'
    )
    await chrome.executeJavaScript(`document.querySelector('#keybind-newTab').click()`)
    await record('T')
    await waitFor(
      async () =>
        (await chrome.executeJavaScript('window.api.getPreferences()')).keybindings.newTab[0] ===
        'Ctrl+T',
      'key release must automatically save captured keybind'
    )
    await chrome.executeJavaScript(
      `document.querySelector('#keybind-newTab').focus(); document.querySelector('#keybind-newTab').click()`
    )
    await record('W')
    await waitFor(
      () =>
        chrome.executeJavaScript(
          `document.querySelector('#keybind-error')?.textContent.includes('conflicts')`
        ),
      'duplicate binding must show inline error'
    )
    await press('Escape', [])
    assert.equal(
      await chrome.executeJavaScript(`document.querySelector('#keybind-newTab').value`),
      'Ctrl + T',
      'Escape after conflict must restore saved binding'
    )
    await chrome.executeJavaScript(
      `document.querySelector('#keybind-newTab').focus(); document.querySelector('#keybind-newTab').click()`
    )
    await record('K')
    await send('keyDown', 'Control', ['control'])
    await send('keyDown', 'C', ['control'])
    assert.equal(
      await chrome.executeJavaScript(`document.querySelector('#keybind-newTab').value`),
      'Ctrl + K then Ctrl + C',
      'sequence must extend live before key release'
    )
    await send('keyUp', 'C', ['control'])
    await send('keyUp', 'Control')
    await waitFor(
      async () =>
        (await chrome.executeJavaScript('window.api.getPreferences()')).keybindings.newTab
          .length === 2,
      'recorder must save sequences'
    )
    const saved = JSON.parse(
      fs.readFileSync(path.join(app.getPath('userData'), 'preferences.json'), 'utf8')
    )
    assert.deepEqual(saved.keybindings.newTab, ['Ctrl+K', 'Ctrl+C'], 'binding must persist on disk')
    await chrome.executeJavaScript(
      `document.querySelector('#keybind-newTab').focus(); document.querySelector('#keybind-newTab').click()`
    )
    await press('Delete', [])
    await waitFor(
      async () =>
        (await chrome.executeJavaScript('window.api.getPreferences()')).keybindings.newTab
          .length === 0,
      'Delete release must disable binding'
    )
    await chrome.executeJavaScript(`document.querySelector('.reset-action button').click()`)
    await waitFor(
      async () =>
        (await chrome.executeJavaScript('window.api.getPreferences()')).keybindings.newTab[0] ===
        'Mod+T',
      'Restore defaults must restore binding'
    )
    assert.ok(
      await chrome.executeJavaScript(`!!document.querySelector('#keybind-reopenTab')`),
      'reopen action must appear in keybind settings'
    )
    const settingsTab = (await state()).activeTabId
    const settingsIndex = (await state()).tabs.findIndex((tab) => tab.id === settingsTab)
    await press('W')
    await press('T', ['control', 'shift'])
    await waitFor(
      () => chrome.executeJavaScript(`!!document.querySelector('#keybind-reopenTab')`),
      'default shortcut must reopen closed settings tab'
    )
    assert.equal(
      (await state()).tabs[settingsIndex].id,
      (await state()).activeTabId,
      'reopened tab must return to its original position'
    )
    chrome.focus()
    await chrome.executeJavaScript(
      `document.querySelector('#keybind-reopenTab').focus(); document.querySelector('#keybind-reopenTab').click()`
    )
    await record('Y')
    await waitFor(
      async () =>
        (await chrome.executeJavaScript('window.api.getPreferences()')).keybindings.reopenTab[0] ===
        'Ctrl+Y',
      'reopen binding must be editable in settings'
    )
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'preferences.json'), 'utf8'))
        .keybindings.reopenTab,
      ['Ctrl+Y'],
      'custom reopen binding must persist on disk'
    )
    const restoredSettingsTab = (await state()).activeTabId
    await chrome.executeJavaScript('window.api.newTab()')
    await chrome.executeJavaScript(`window.api.navigate(${JSON.stringify(url)})`)
    await waitFor(async () => (await state()).url === url, 'fixture tab must navigate')
    const closedPage = (await state()).activeTabId
    await chrome.executeJavaScript(`window.api.closeTab(${JSON.stringify(restoredSettingsTab)})`)
    await press('W')
    const closedCount = (await state()).tabs.length
    await press('T', ['control', 'shift'])
    assert.equal((await state()).tabs.length, closedCount, 'old binding must stop working')
    await press('Y')
    await waitFor(async () => (await state()).url === url, 'custom binding must reopen latest tab')
    assert.notEqual((await state()).activeTabId, closedPage, 'reopen must create a new page')
    await press('Y')
    await waitFor(
      () => chrome.executeJavaScript(`!!document.querySelector('#keybind-reopenTab')`),
      'successive reopen must restore tabs in reverse close order'
    )
    chrome.focus()
    await chrome.executeJavaScript(
      `document.querySelector('#keybind-reopenTab').focus(); document.querySelector('#keybind-reopenTab').click()`
    )
    await press('Delete', [])
    await waitFor(
      async () =>
        (await chrome.executeJavaScript('window.api.getPreferences()')).keybindings.reopenTab
          .length === 0,
      'reopen binding must be clearable'
    )
    const disabledCount = (await state()).tabs.length
    await press('Y')
    assert.equal((await state()).tabs.length, disabledCount, 'cleared reopen binding must not run')
    await chrome.executeJavaScript(`document.querySelector('.reset-action button').click()`)
    await waitFor(
      async () =>
        (await chrome.executeJavaScript('window.api.getPreferences()')).keybindings.reopenTab[0] ===
        'Mod+Shift+T',
      'Restore defaults must restore reopen binding'
    )
    const lastState = await state()
    for (const tab of lastState.tabs.filter((tab) => tab.id !== lastState.activeTabId)) {
      await chrome.executeJavaScript(`window.api.closeTab(${JSON.stringify(tab.id)})`)
    }
    await press('W')
    await waitFor(
      async () => (await state()).tabs.length === 1,
      'closing last tab must leave a new tab'
    )
    await press('T', ['control', 'shift'])
    await waitFor(
      async () => (await state()).tabs.length === 2 && (await state()).url === lastState.url,
      'last closed tab must remain reopenable'
    )
    console.log(
      'PASS: existing shortcuts, reopen order and position, navigation, zoom, mute, sequences, recorder, conflicts, persistence, sandbox and DOM default blocking'
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
