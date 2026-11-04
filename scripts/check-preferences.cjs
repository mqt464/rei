const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-preferences-check-'))
  let status = 0
  for (const phase of ['write', 'restart']) {
    const env = { ...process.env, REI_PREFERENCES_PROFILE: profile, REI_PREFERENCES_PHASE: phase }
    delete env.ELECTRON_RUN_AS_NODE
    const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
      env,
      stdio: 'inherit',
      timeout: 45000,
      windowsHide: true
    })
    if (result.error) console.error(result.error)
    if (result.status !== 0) {
      status = result.status ?? 1
      break
    }
  }
  assert.ok(path.resolve(profile).startsWith(path.join(os.tmpdir(), 'rei-preferences-check-')))
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 })
  process.exit(status)
}
const Module = require('node:module')
const { createServer } = require('node:http')
const { app, BaseWindow, dialog, shell } = require('electron')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.setPath('userData', process.env.REI_PREFERENCES_PROFILE)
const bundlePath = path.resolve(__dirname, '../out/main/index.js')
const browserModule = new Module(bundlePath, module)
browserModule.filename = bundlePath
browserModule.paths = Module._nodeModulePaths(path.dirname(bundlePath))
browserModule._compile(
  fs.readFileSync(bundlePath, 'utf8').split('function createWindow(')[0] +
    '\nmodule.exports = { attachBrowser, SearchStore, ExtensionRuntime, currentPreferences, setExtensionDoNotTrack }',
  bundlePath
)
async function waitFor(check, message) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.fail(message)
}
app.whenReady().then(async () => {
  const store = new browserModule.exports.SearchStore(':memory:')
  const window = new BaseWindow({ width: 1500, height: 900, show: true })
  const requests = []
  const server = createServer((request, response) => {
    requests.push({ url: request.url, dnt: request.headers.dnt })
    if (request.url === '/download') {
      response.setHeader('Content-Disposition', 'attachment; filename="fixture.txt"')
      response.end('download fixture')
    } else {
      response.setHeader('Content-Type', 'text/html')
      response.end(
        '<!doctype html><title>Preference fixture</title><body><a target="_blank" href="/child">Child</a><textarea>spellcheck</textarea></body>'
      )
    }
  })
  let other
  try {
    browserModule.exports.setExtensionDoNotTrack(
      browserModule.exports.currentPreferences().doNotTrack
    )
    const extensions = new browserModule.exports.ExtensionRuntime()
    await extensions.initialize()
    const chrome = browserModule.exports.attachBrowser(window, store, extensions)
    await chrome.loadFile(path.resolve(__dirname, '../out/renderer/index.html'))
    const read = (script) => chrome.executeJavaScript(script)
    await waitFor(() => read('!!document.querySelector(".blank-page")'), 'UI must mount')
    await read('void window.api.onState(value => window.testState = value)')
    const prefs = () => read('window.api.getPreferences()')
    const theme = () => read('window.api.getTheme()')
    const choose = async (id, value) => {
      await read(`document.getElementById('${id}').click()`)
      await waitFor(() => read(`!!document.getElementById('${id}-list')`), 'custom menu must open')
      await read(`document.querySelector('#${id}-list [data-value="${value}"]').click()`)
    }
    const page = async (id) => {
      await read(`document.getElementById('settings-tab-${id}').click()`)
      await waitFor(
        () =>
          read(
            `document.getElementById('settings-tab-${id}').getAttribute('aria-selected') === 'true'`
          ),
        'settings page must open'
      )
      assert.equal(
        await read('document.querySelectorAll(".rei-card .rei-card").length'),
        0,
        'cards must never nest'
      )
      assert.equal(
        await read('document.querySelectorAll("select").length'),
        0,
        'dropdowns must use shared custom control'
      )
    }
    const capture = async (name) => {
      if (!process.env.REI_THEME_CAPTURES) return
      await read('document.fonts.ready')
      await read(
        'Promise.all(document.getAnimations().filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})))'
      )
      fs.mkdirSync(process.env.REI_THEME_CAPTURES, { recursive: true })
      fs.writeFileSync(
        path.join(process.env.REI_THEME_CAPTURES, `${name}.png`),
        (await chrome.capturePage()).toPNG()
      )
    }
    if (process.env.REI_PREFERENCES_PHASE === 'restart') {
      assert.equal((await prefs()).searchEngine, 'duckduckgo')
      assert.equal((await prefs()).defaultZoom, 130)
      assert.equal((await prefs()).historyEnabled, false)
      assert.equal((await prefs()).spellcheck, false)
      assert.equal((await theme()).caretStyle, 'underline')
      assert.equal((await theme()).animationSpeed, 150)
      console.log(
        'PASS: browser preferences, external JSON edits, caret and motion survive restart'
      )
    } else {
      const initial = await prefs()
      for (const value of [
        null,
        [],
        { searchEngine: 'unknown' },
        { defaultZoom: 0 },
        { newTabUrl: 'javascript:alert(1)' },
        { spellcheck: 'off' },
        { downloadDirectory: 'relative' },
        { unknown: true }
      ])
        assert.equal(
          await read(
            `window.api.setPreferences(${JSON.stringify(value)}).then(()=>true,()=>false)`
          ),
          false
        )
      assert.deepEqual(await prefs(), initial)
      for (const value of [
        { caretStyle: 'triangle' },
        { motion: 'wild' },
        { animationSpeed: 0 },
        { caretWidth: 99 },
        { caretBlink: 1 },
        { radius: -1 }
      ])
        assert.equal(
          await read(`window.api.setTheme(${JSON.stringify(value)}).then(()=>true,()=>false)`),
          false
        )
      await read('window.api.openSettings()')
      await waitFor(() => read('!!document.querySelector("#theme-font")'), 'appearance must mount')
      await read('document.querySelector("#theme-font").click()')
      await waitFor(() => read('!!document.querySelector("#theme-font-list")'), 'font menu opens')
      assert.equal(
        await read(
          '!!document.querySelector("#theme-font-list .scroll-area .fluid-hover [data-fluid-selected]")'
        ),
        true,
        'dropdown must reuse custom scrolling and fluid selection'
      )
      await read(
        'document.querySelector("#theme-font-list").dispatchEvent(new KeyboardEvent("keydown",{key:"End",bubbles:true,cancelable:true}))'
      )
      await waitFor(
        () =>
          read(`(() => {
          const menu = document.querySelector('#theme-font-list');
          const option = menu.querySelector('[data-fluid-selected]');
          const indicator = menu.querySelector('.fluid-hover-indicator.selected');
          const expected = option.getBoundingClientRect().top - option.closest('.fluid-hover').getBoundingClientRect().top;
          return option.id === menu.getAttribute('aria-activedescendant') &&
            Math.abs(parseFloat(indicator.style.getPropertyValue('--fluid-hover-y')) - expected) < 1;
        })()`),
        'keyboard navigation must move the shared indicator'
      )
      await capture('custom-dropdown')
      await read(
        'document.querySelector("#theme-font-list").dispatchEvent(new KeyboardEvent("keydown",{key:"End",bubbles:true,cancelable:true}));document.querySelector("#theme-font-list").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}))'
      )
      await waitFor(async () => (await theme()).font === 'mono', 'keyboard must select last font')
      assert.equal(
        await read('document.activeElement.id'),
        'theme-font',
        'selection restores trigger focus'
      )
      await read('document.querySelector("#theme-font").click()')
      await waitFor(() => read('!!document.querySelector("#theme-font-list")'), 'font menu reopens')
      await read(
        'document.querySelector("#theme-font-list").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))'
      )
      assert.equal((await theme()).font, 'mono', 'Escape does not change selection')
      await read('document.querySelector("#theme-size").focus()')
      chrome.sendInputEvent({ type: 'keyDown', keyCode: 'Right' })
      chrome.sendInputEvent({ type: 'keyUp', keyCode: 'Right' })
      await waitFor(
        async () => (await theme()).fontSize === 13,
        'custom slider must retain native keyboard behavior'
      )
      await read('window.api.setTheme({fontSize:12})')
      await page('caret')
      await choose('caret-style', 'underline')
      await read(
        'document.querySelector("#caretWidth").value="7";document.querySelector("#caretWidth").dispatchEvent(new Event("input",{bubbles:true}));document.querySelector("#caretWidth").dispatchEvent(new Event("change",{bubbles:true}));document.querySelector("#caret-blink").click()'
      )
      await waitFor(
        async () => (await theme()).caretWidth === 7 && !(await theme()).caretBlink,
        'caret controls must save'
      )
      assert.equal(
        await read('document.documentElement.style.getPropertyValue("--rei-caret-height")'),
        '2px'
      )
      assert.equal(
        await read('document.documentElement.style.getPropertyValue("--rei-caret-width")'),
        '7px'
      )
      await read(
        'document.querySelector(".caret-preview input").focus();document.querySelector(".caret-preview input").value="Rei";document.querySelector(".caret-preview input").setSelectionRange(3,3);document.querySelector(".caret-preview input").dispatchEvent(new Event("input",{bubbles:true}))'
      )
      await waitFor(
        () =>
          read(`(() => {
          const input = document.querySelector('.caret-preview input')
          const style = getComputedStyle(input)
          const context = document.createElement('canvas').getContext('2d')
          context.font = style.font
          const expected = parseFloat(style.paddingLeft) + context.measureText(input.value).width - input.scrollLeft
          const actual = parseFloat(document.querySelector('.caret-preview .custom-caret').style.getPropertyValue('--caret-x'))
          return Math.abs(actual - expected) < 1
        })()`),
        'preview caret must follow actual text position'
      )
      await capture('caret-controls')
      await page('motion')
      await choose('theme-motion', 'none')
      assert.equal(await read('document.documentElement.dataset.motion'), 'none')
      await read('document.querySelectorAll(".rei-button")[0].click()')
      assert.equal(
        await read(
          'getComputedStyle(document.querySelector(".motion-track span")).transitionDuration'
        ),
        '0s'
      )
      await choose('theme-motion', 'system')
      await read('window.api.setTheme({animationSpeed:150})')
      await capture('motion-controls')
      let openedFile
      shell.openPath = async (file) => {
        openedFile = file
        return ''
      }
      await page('appearance')
      await read(
        '[...document.querySelectorAll(".rei-button")].find(button=>button.textContent.includes("Open theme.json")).click()'
      )
      await waitFor(
        () => openedFile === path.join(app.getPath('userData'), 'theme.json'),
        'JSON action must open actual theme file'
      )
      assert.equal(fs.existsSync(openedFile), true)
      const validTheme = await theme()
      fs.writeFileSync(openedFile, '{broken JSON')
      await waitFor(
        () => read('document.querySelector("#theme-error")?.textContent.includes("invalid")'),
        'invalid external edits must show feedback'
      )
      assert.deepEqual(await theme(), validTheme, 'invalid JSON keeps last valid theme')
      fs.writeFileSync(
        openedFile,
        JSON.stringify(
          { ...validTheme, colors: { ...validTheme.colors, accent: '#edb5ff' } },
          null,
          2
        )
      )
      await waitFor(
        async () => (await theme()).colors.accent === '#edb5ff',
        'external JSON edits must apply live'
      )
      await waitFor(
        () => read('!document.querySelector("#theme-error")'),
        'corrected JSON clears error'
      )
      await page('wallpaper')
      assert.equal(
        await read(
          'document.querySelector(".settings-content").textContent.includes("Websites stay unchanged")'
        ),
        false,
        'wallpaper descriptions must omit redundant scope notes'
      )
      await capture('wallpaper-empty')
      await page('search')
      await choose('search-engine', 'duckduckgo')
      await waitFor(
        async () => (await prefs()).searchEngine === 'duckduckgo',
        'engine menu must save'
      )
      const result = await read('window.api.suggest("preference query","all",111,false)')
      await capture('search-options')
      assert.ok(
        result.results.some(
          (entry) => entry.kind === 'search' && entry.title.includes('DuckDuckGo')
        )
      )
      await page('browser')
      await read(
        'document.querySelector("#new-tab-url").value="javascript:alert(1)";document.querySelector("#new-tab-url").dispatchEvent(new Event("change",{bubbles:true}))'
      )
      await waitFor(
        () =>
          read('document.querySelector("#new-tab-url").getAttribute("aria-invalid") === "true"'),
        'invalid homepage must show an accessible error'
      )
      await read(
        'document.querySelector("#new-tab-url").value="";document.querySelector("#new-tab-url").dispatchEvent(new Event("change",{bubbles:true}))'
      )
      await waitFor(
        () =>
          read(
            '!document.querySelector("#homepage-error") && document.querySelector("#new-tab-url").getAttribute("aria-invalid") === "false"'
          ),
        'homepage correction must clear both error and invalid state'
      )
      await read(
        'document.querySelector("#spellcheck").click();document.querySelector("#autoHideTopbar").click();document.querySelector("#default-zoom").value="130";document.querySelector("#default-zoom").dispatchEvent(new Event("input",{bubbles:true}));document.querySelector("#default-zoom").dispatchEvent(new Event("change",{bubbles:true}))'
      )
      await waitFor(
        async () =>
          !(await prefs()).spellcheck &&
          !(await prefs()).autoHideTopbar &&
          (await prefs()).defaultZoom === 130,
        'browser controls must save'
      )
      assert.equal(chrome.session.isSpellCheckerEnabled(), false)
      assert.equal(
        await read('document.querySelector(".settings-page").getBoundingClientRect().top'),
        38,
        'persistent topbar must not cover settings headings'
      )
      await capture('browsing-options')
      await page('downloads')
      const directory = path.join(app.getPath('userData'), 'downloads')
      fs.mkdirSync(directory)
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
      await read(
        '[...document.querySelectorAll(".rei-button")].find(button=>button.textContent.includes("Change folder")).click()'
      )
      await waitFor(
        async () => (await prefs()).downloadDirectory === directory,
        'folder chooser must save'
      )
      await read('document.querySelector("#download-prompt").click()')
      await waitFor(async () => !(await prefs()).downloadPrompt, 'download prompt toggle must save')
      await page('privacy')
      await read(
        'document.querySelector("#history-enabled").click();document.querySelector("#do-not-track").click()'
      )
      await waitFor(
        async () => !(await prefs()).historyEnabled && (await prefs()).doNotTrack,
        'privacy controls must save'
      )
      other = new BaseWindow({ width: 900, height: 700, show: false })
      const otherChrome = browserModule.exports.attachBrowser(other, store, extensions)
      await otherChrome.loadFile(path.resolve(__dirname, '../out/renderer/index.html'))
      assert.equal(
        await otherChrome.executeJavaScript(
          'window.api.getPreferences().then(value=>value.searchEngine)'
        ),
        'duckduckgo'
      )
      await read('window.api.setPreferences({defaultZoom:140})')
      await waitFor(
        () =>
          otherChrome.executeJavaScript(
            'window.api.getPreferences().then(value=>value.defaultZoom===140)'
          ),
        'preferences must sync across windows'
      )
      await read('window.api.setPreferences({defaultZoom:130})')
      other.close()
      other = undefined
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
      const address = `http://127.0.0.1:${server.address().port}`
      await read(
        `window.api.setPreferences({newTabUrl:${JSON.stringify(address + '/home')},backgroundTabs:true})`
      )
      await read('window.api.newTab()')
      let site
      await waitFor(() => {
        site = window.contentView.children.find(
          (view) => view.webContents.getURL() === address + '/home'
        )?.webContents
        return site && !site.isLoading()
      }, 'new tabs must load custom homepage')
      assert.equal(site.getZoomFactor(), 1.3)
      await read('window.api.setPreferences({defaultZoom:140})')
      assert.equal(site.getZoomFactor(), 1.4, 'zoom changes must reach already-open pages')
      await read('window.api.setPreferences({defaultZoom:130})')
      assert.equal(requests.find((entry) => entry.url === '/home').dnt, '1')
      assert.equal(
        store.history('').some((entry) => entry.url === address + '/home'),
        false,
        'history-off must not save visits'
      )
      assert.equal(
        await site.executeJavaScript('typeof window.api'),
        'undefined',
        'sites must not access settings IPC'
      )
      const active = await read('window.testState.activeTabId')
      await site.executeJavaScript('document.querySelector("a").click()')
      await waitFor(
        () =>
          read(`window.testState.tabs.some(tab=>tab.url===${JSON.stringify(address + '/child')})`),
        'website-created tab must open'
      )
      assert.equal(
        await read('window.testState.activeTabId'),
        active,
        'background tabs must preserve active tab'
      )
      fs.writeFileSync(path.join(directory, 'fixture.txt'), 'existing file')
      site.downloadURL(address + '/download')
      await waitFor(
        () => fs.existsSync(path.join(directory, 'fixture (1).txt')),
        'automatic downloads must avoid overwriting existing files'
      )
      assert.equal(fs.readFileSync(path.join(directory, 'fixture.txt'), 'utf8'), 'existing file')
      await read('window.api.setPreferences({newTabUrl:"",confirmClose:true})')
      let confirmations = 0
      dialog.showMessageBox = async () => {
        confirmations++
        return { response: 1 }
      }
      window.close()
      await waitFor(() => confirmations === 1, 'closing multiple tabs must ask')
      assert.equal(window.isDestroyed(), false, 'cancel must keep window open')
      await read('window.api.setPreferences({confirmClose:false})')
      console.log(
        'PASS: custom dropdown keyboard/focus, sliders, caret, motion, JSON open/live validation, search engine, new-tab URL, zoom, spellcheck, background tabs, download folder/collision, history, DNT, close confirmation, sync'
      )
    }
    window.close()
    store.close()
    server.close()
    app.exit(0)
  } catch (error) {
    console.error('FAIL:', error.stack)
    if (other && !other.isDestroyed()) other.close()
    if (!window.isDestroyed()) {
      await window.contentView.children
        .find((view) => view.webContents.getURL().endsWith('index.html'))
        ?.webContents.executeJavaScript('window.api.setPreferences({confirmClose:false})')
        .catch(() => {})
      window.close()
    }
    store.close()
    server.close()
    app.exit(1)
  }
})
