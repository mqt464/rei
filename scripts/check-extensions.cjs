const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-extensions-check-'))
  if (process.env.REI_EXTENSION_SEED_PROFILE) {
    const extensionId = 'fkgkibajhfbepljeaefdnfnegdcjomkh'
    for (const relative of [
      `Local Extension Settings/${extensionId}`,
      `IndexedDB/chrome-extension_${extensionId}_0.indexeddb.leveldb`,
      `IndexedDB/chrome-extension_${extensionId}_0.indexeddb.blob`
    ]) {
      const source = path.join(process.env.REI_EXTENSION_SEED_PROFILE, relative)
      if (fs.existsSync(source))
        fs.cpSync(source, path.join(profile, relative), {
          recursive: true,
          filter: (file) => path.basename(file) !== 'LOCK'
        })
    }
  }
  const env = { ...process.env, REI_EXTENSION_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  let status = 0
  try {
    for (const phase of ['install', 'restart']) {
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, phase],
        {
          env,
          stdio: 'inherit',
          timeout: 90000,
          windowsHide: true
        }
      )
      if (result.error) console.error(result.error)
      if (result.status !== 0) {
        status = result.status ?? 1
        break
      }
    }
  } finally {
    assert.ok(path.resolve(profile).startsWith(path.join(os.tmpdir(), 'rei-extensions-check-')))
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 })
  }
  process.exit(status)
}

const Module = require('node:module')
const { createServer } = require('node:http')
const { app, BaseWindow, dialog, session, webContents, WebContentsView } = require('electron')
const packageRoot = process.env.REI_EXTENSION_PACKAGE_ROOT
if (packageRoot) {
  Object.defineProperty(app, 'isPackaged', { value: true })
  Object.defineProperty(process, 'resourcesPath', { value: path.join(packageRoot, 'resources') })
}
process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT:', error)
  process.exit(1)
})
process.on('unhandledRejection', (error) => {
  console.error('UNHANDLED:', error)
  process.exit(1)
})
app.setPath('userData', process.env.REI_EXTENSION_PROFILE)
if (!process.env.REI_EXTENSION_ONLINE)
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1')
app.on('window-all-closed', () => {})
const bundlePath = packageRoot
  ? path.join(packageRoot, 'resources/app.asar/out/main/index.js')
  : path.resolve(__dirname, '../out/main/index.js')
const rendererPath = packageRoot
  ? path.join(packageRoot, 'resources/app.asar/out/renderer/index.html')
  : path.resolve(__dirname, '../out/renderer/index.html')
const bundle = fs.readFileSync(bundlePath, 'utf8').split('function createWindow(')[0]
const browserModule = new Module(bundlePath, module)
browserModule.filename = bundlePath
browserModule.paths = Module._nodeModulePaths(path.dirname(bundlePath))
let beforeStoreInstall
const originalLoad = Module._load
Module._load = function (request, ...args) {
  const exports = originalLoad.call(this, request, ...args)
  if (request !== 'electron-chrome-web-store') return exports
  return {
    ...exports,
    installChromeWebStore: async (options) => {
      beforeStoreInstall = options.beforeInstall
      return exports.installChromeWebStore(options)
    }
  }
}
try {
  browserModule._compile(
    `${bundle}\nmodule.exports = { attachBrowser, SearchStore, ExtensionRuntime, currentPreferences, setExtensionDoNotTrack, prepareUIStorage }`,
    bundlePath
  )
} finally {
  Module._load = originalLoad
}
const {
  attachBrowser,
  SearchStore,
  ExtensionRuntime,
  currentPreferences,
  setExtensionDoNotTrack,
  prepareUIStorage
} = browserModule.exports
const ublockId = 'fkgkibajhfbepljeaefdnfnegdcjomkh'
const phase = process.argv[2]
const requests = []
const consoleErrors = []
let checkingRuntime = false
app.on('web-contents-created', (_event, contents) => {
  if (!checkingRuntime) return
  contents.on('console-message', (event) => {
    if (event.message?.startsWith('Uncaught')) consoleErrors.push(event.message)
  })
})

async function waitFor(check, message) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`${message}\n${consoleErrors.join('\n')}`)
}

app
  .whenReady()
  .then(async () => {
    const server = createServer((request, response) => {
      requests.push({ url: request.url, dnt: request.headers.dnt })
      response.setHeader('Cache-Control', 'no-store')
      if (request.url.endsWith('.js')) {
        response.setHeader('Content-Type', 'text/javascript')
        response.end(
          request.url === '/rei-blocked-ad.js'
            ? 'window.blockedScript = true'
            : 'window.allowedScript = true'
        )
      } else {
        response.setHeader('Content-Type', 'text/html')
        response.end(
          '<!doctype html><title>Extension fixture</title><div class="rei-ad">Ad</div><p>Article</p><script src="/rei-allowed.js"></script><script src="/rei-blocked-ad.js"></script>'
        )
      }
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = `http://127.0.0.1:${server.address().port}`
    const store = new SearchStore(path.join(app.getPath('userData'), 'search.sqlite'))
    let window
    try {
      if (phase === 'install') {
        const legacy = new WebContentsView({ webPreferences: { sandbox: true } })
        await legacy.webContents.loadFile(rendererPath)
        await legacy.webContents.executeJavaScript(
          "localStorage.setItem('rei:suggestions', 'off'); localStorage.setItem('rei:shortcuts', 'zz | Example | https://example.com/?q={query}'); localStorage.setItem('website-secret', 'not-ui-data')"
        )
        legacy.webContents.close()
        await session.defaultSession.cookies.set({
          url: address,
          name: 'session',
          value: 'preserved',
          expirationDate: Date.now() / 1000 + 3600
        })
      }
      await prepareUIStorage()
      checkingRuntime = true
      setExtensionDoNotTrack(currentPreferences().doNotTrack)
      const runtime = new ExtensionRuntime()
      await runtime.initialize()
      window = new BaseWindow({ show: false, width: 1100, height: 760 })
      console.log('CHECK: runtime initialized')
      const originalPrompt = dialog.showMessageBox
      dialog.showMessageBox = async () => {
        throw new Error('Store installation must not show a native confirmation')
      }
      try {
        assert.deepEqual(
          await beforeStoreInstall({
            localizedName: 'Store fixture',
            manifest: { permissions: ['storage'], host_permissions: ['https://*/*'] }
          }),
          { action: 'allow' }
        )
      } finally {
        dialog.showMessageBox = originalPrompt
      }
      assert.equal(runtime.state().error, '')
      const bundled = runtime.state().extensions.find((entry) => entry.id === ublockId)
      assert.ok(bundled)
      assert.equal(bundled.bundled, true)
      assert.equal(bundled.version, '1.75.0')
      assert.equal(bundled.error, undefined)
      assert.equal(bundled.enabled, phase === 'install', 'disabled choice must survive restart')
      const chrome = attachBrowser(window, store, runtime)
      await chrome.loadFile(rendererPath)
      const read = (script) => chrome.executeJavaScript(script)
      await read('void window.api.onState(state => window.extensionBrowserState = state)')
      const state = () => read('window.extensionBrowserState')
      await waitFor(async () => (await state())?.tabs.length, 'initial browser state')
      const sidebar = window.contentView.children[0].webContents
      await waitFor(
        () =>
          sidebar && sidebar.executeJavaScript('!!document.querySelector(".sidebar-extensions")'),
        'extensions button'
      )
      console.log('CHECK: isolated UI loaded')
      assert.notEqual(
        chrome.session,
        session.defaultSession,
        'privileged UI must be isolated from extensions'
      )
      assert.equal(chrome.session.extensions.getAllExtensions().length, 0)
      assert.equal(
        await read("localStorage.getItem('rei:suggestions')"),
        phase === 'install' ? 'off' : 'on',
        'legacy consent must migrate once without overwriting new choices'
      )
      assert.equal(
        await read("localStorage.getItem('website-secret')"),
        null,
        'website storage must not be copied to UI'
      )
      assert.equal(
        (await session.defaultSession.cookies.get({ url: address }))[0]?.value,
        'preserved'
      )
      assert.equal(
        await sidebar.executeJavaScript(`(() => {
      const settings = document.querySelector('.sidebar-settings').getBoundingClientRect()
      const extensions = document.querySelector('.sidebar-extensions').getBoundingClientRect()
      return extensions.left >= settings.right && extensions.top === settings.top
    })()`),
        true,
        'extensions button belongs immediately right of Settings'
      )
      if (phase === 'restart') {
        await read(`window.api.toggleExtension('${ublockId}', true)`)
      }
      const background = webContents
        .getAllWebContents()
        .find((contents) => contents.getURL() === `chrome-extension://${ublockId}/background.html`)
      assert.ok(background)
      assert.equal(await background.executeJavaScript('globalThis.\u00b5Block.readyToFilter'), true)
      assert.equal(
        await background.executeJavaScript('chrome.storage.managed !== chrome.storage.local'),
        true,
        'managed storage must not alias local storage and recursively cache user settings'
      )
      assert.equal(
        await background.executeJavaScript(
          "chrome.storage.local.get('cachedManagedStorage').then(result => Object.hasOwn(result.cachedManagedStorage || {}, 'cachedManagedStorage'))"
        ),
        false,
        'obsolete managed-storage cache must not contain a recursive copy of itself'
      )
      assert.ok(
        await background.executeJavaScript(
          'Object.values(\u00b5Block.availableFilterLists).reduce((total, list) => total + (list.entryUsedCount || 0), 0) > 1000'
        ),
        'bundled default filter lists must load without Internet access'
      )
      if (phase === 'install') {
        await read("localStorage.setItem('rei:suggestions', 'on')")
        await background.executeJavaScript(
          `\u00b5Block.appendUserFilters(${JSON.stringify('/rei-blocked-ad.js$script\n127.0.0.1##.rei-ad')})`
        )
      }
      console.log('CHECK: filters ready')
      await read(`window.api.navigate('${address}/article')`)
      await waitFor(
        async () => (await state()).url === `${address}/article` && !(await state()).loading,
        'fixture page'
      )
      let site = webContents.fromId((await state()).activeWebContentsId)
      await waitFor(
        () => site.executeJavaScript('window.allowedScript === true'),
        'ordinary scripts must still load'
      )
      assert.equal(await site.executeJavaScript('window.blockedScript'), undefined)
      assert.equal(
        requests.filter((entry) => entry.url === '/rei-blocked-ad.js').length,
        0,
        'uBlock must block actual network traffic'
      )
      await waitFor(
        () =>
          site.executeJavaScript(
            'getComputedStyle(document.querySelector(".rei-ad")).display === "none"'
          ),
        'cosmetic content script must work'
      )
      console.log('CHECK: network and cosmetic filtering passed')
      assert.equal(await site.executeJavaScript('typeof window.api'), 'undefined')
      assert.equal(await site.executeJavaScript('typeof require'), 'undefined')
      await read('window.api.setPreferences({doNotTrack:true,confirmClose:false})')
      await site.loadURL(`${address}/dnt`)
      assert.equal(
        requests.find((entry) => entry.url === '/dnt')?.dnt,
        '1',
        'DNT must coexist with uBlock'
      )
      assert.equal(requests.filter((entry) => entry.url === '/rei-blocked-ad.js').length, 0)
      await sidebar.executeJavaScript('document.querySelector(".sidebar-extensions").click()')
      await waitFor(
        () => sidebar.executeJavaScript('document.activeElement?.id === "extensions-panel"'),
        'extension panel must receive keyboard focus'
      )
      await sidebar.executeJavaScript(
        'window.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape", bubbles:true}))'
      )
      assert.equal(
        await sidebar.executeJavaScript(
          'document.activeElement?.classList.contains("sidebar-extensions") && !document.querySelector("#extensions-panel")'
        ),
        true,
        'Escape must close the panel and return focus'
      )
      await sidebar.executeJavaScript('document.querySelector(".sidebar-extensions").click()')
      await waitFor(
        () =>
          sidebar.executeJavaScript(
            '!!document.querySelector("browser-action-list")?.shadowRoot.querySelector("button")'
          ),
        'extension action must render'
      )
      const popupCreated = new Promise((resolve) =>
        runtime.api.once('browser-action-popup-created', resolve)
      )
      await sidebar.executeJavaScript(
        'document.querySelector("browser-action-list").shadowRoot.querySelector("button").click()'
      )
      const popup = await Promise.race([
        popupCreated,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Popup not created')), 10000))
      ])
      await popup.whenReady()
      assert.ok(popup.browserWindow.webContents.getURL().endsWith('/popup-fenix.html'))
      await waitFor(
        () =>
          popup.browserWindow.webContents.executeJavaScript(
            'document.body.textContent.includes("127.0.0.1")'
          ),
        'uBlock popup must target active website'
      )
      popup.destroy()
      await sidebar.executeJavaScript('window.api.openExtensions()')
      await waitFor(
        () => read('!!document.querySelector("#settings-tab-extensions[aria-selected=true]")'),
        'Extensions settings route'
      )
      await waitFor(
        () => read(`!!document.getElementById('extension-${ublockId}')`),
        'bundled extension settings'
      )
      assert.equal(
        await read('document.body.textContent.includes("uBlock Origin comes with Rei.")'),
        false,
        'extension settings must not contain the removed intro'
      )
      assert.equal(
        await read(`document.getElementById('extension-${ublockId}').getAttribute('aria-checked')`),
        'true'
      )
      await assert.rejects(
        read(`window.api.removeExtension('${ublockId}')`),
        /disabled, not removed/
      )
      await read(`window.api.openExtensionOptions('${ublockId}')`)
      await waitFor(
        async () => (await state()).url === `chrome-extension://${ublockId}/dashboard.html`,
        'uBlock dashboard must open inside Rei'
      )
      const optionsContents = webContents.fromId((await state()).activeWebContentsId)
      await read(`window.api.closeTab('${(await state()).activeTabId}')`)
      await waitFor(() => optionsContents.isDestroyed(), 'options tab must close')
      await sidebar.executeJavaScript('window.api.openExtensions()')
      await waitFor(
        () => read(`!!document.getElementById('extension-${ublockId}')`),
        'extension switch must render'
      )
      if (phase === 'install')
        await background.executeJavaScript(
          'chrome.storage.local.set({ cachedManagedStorage: { cachedManagedStorage: {} } })'
        )
      await read(`document.getElementById('extension-${ublockId}').click()`)
      await waitFor(
        () =>
          read(
            `document.getElementById('extension-${ublockId}')?.getAttribute('aria-checked') === 'false' && !document.querySelector('fieldset')?.disabled`
          ),
        'settings switch must disable uBlock'
      )
      assert.ok(!session.defaultSession.extensions.getExtension(ublockId))
      await read(`window.api.navigate('${address}/disabled')`)
      await waitFor(
        async () => (await state()).url === `${address}/disabled` && !(await state()).loading,
        'unprotected fixture page'
      )
      site = webContents.fromId((await state()).activeWebContentsId)
      await waitFor(
        () => site.executeJavaScript('window.blockedScript === true'),
        'disabled uBlock must stop blocking'
      )
      assert.equal(requests.filter((entry) => entry.url === '/rei-blocked-ad.js').length, 1)
      assert.equal(requests.find((entry) => entry.url === '/disabled').dnt, '1')
      if (phase === 'install') {
        await sidebar.executeJavaScript('window.api.openExtensions()')
        await waitFor(
          () =>
            read(
              `document.getElementById('extension-${ublockId}')?.getAttribute('aria-checked') === 'false'`
            ),
          'disabled setting must sync'
        )
      }
      assert.equal(
        JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'extensions.json'))).find(
          (entry) => entry.id === ublockId
        ).enabled,
        false
      )
      assert.deepEqual(consoleErrors, [], 'extension pages must not throw')
      console.log(
        `PASS (${phase}): bundled MV2 uBlock, real network/cosmetic blocking, DNT coexistence, isolated UI, button placement, popup, dashboard, disable, saved filters/state`
      )
      window.close()
      store.close()
      server.close()
      app.exit(0)
    } catch (error) {
      console.error('FAIL:', error.stack, consoleErrors)
      app.exit(1)
    }
  })
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
