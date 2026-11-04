const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-ublock-prototype-'))
  const env = { ...process.env, REI_EXTENSION_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
    env,
    stdio: 'inherit',
    timeout: 60000,
    windowsHide: true
  })
  assert.ok(path.resolve(profile).startsWith(path.join(os.tmpdir(), 'rei-ublock-prototype-')))
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 })
  process.exit(result.status ?? 1)
}

const { app, BrowserWindow, session, webContents } = require('electron')
const { ElectronChromeExtensions } = require('electron-chrome-extensions')
app.enableSandbox()
app.setPath('userData', process.env.REI_EXTENSION_PROFILE)
app.on('window-all-closed', () => {})
app
  .whenReady()
  .then(async () => {
    new ElectronChromeExtensions({ session: session.defaultSession })
    const preloadSource = fs.readFileSync(
      require.resolve('electron-chrome-extensions/preload'),
      'utf8'
    )
    const preloadPath = path.join(app.getPath('userData'), 'prototype-api.cjs')
    fs.writeFileSync(
      preloadPath,
      preloadSource.replace(
        '    injectExtensionAPIs();',
        `    document.addEventListener('readystatechange', () => { if (document.readyState === 'interactive') injectExtensionAPIs() }, {once: true});`
      )
    )
    session.defaultSession.unregisterPreloadScript('crx-mv2-preload')
    session.defaultSession.registerPreloadScript({
      id: 'prototype-compat',
      type: 'frame',
      filePath: preloadPath
    })
    app.on('web-contents-created', (_event, contents) => {
      contents.on('console-message', (event) =>
        console.log('extension:', event.message, event.sourceId, event.lineNumber)
      )
      if (contents.getType() === 'backgroundPage')
        contents.once('did-finish-load', async () => {
          console.log(
            'Background APIs',
            await contents.executeJavaScript(
              'JSON.stringify({chrome:Object.keys(chrome),browser:Object.keys(globalThis.browser||{}),runtime:chrome.runtime?.id})'
            )
          )
        })
    })
    const extension = await session.defaultSession.extensions.loadExtension(
      path.resolve(__dirname, '../resources/extensions/uBlock0.chromium')
    )
    console.log('Loaded', extension.id, extension.version)
    const deadline = Date.now() + 8000
    let background
    while (Date.now() < deadline) {
      background = webContents
        .getAllWebContents()
        .find(
          (contents) => contents.getURL() === `chrome-extension://${extension.id}/background.html`
        )
      if (
        background &&
        (await background
          .executeJavaScript(
            'typeof globalThis.\u00b5Block === "object" && \u00b5Block.readyToFilter'
          )
          .catch(() => false))
      )
        break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.ok(background)
    console.log(
      'uBlock state',
      await background.executeJavaScript(
        'JSON.stringify({ready: globalThis.\u00b5Block?.readyToFilter, keys: Object.keys(globalThis).filter(key => /block|vapi/i.test(key))})'
      )
    )
    assert.equal(await background.executeJavaScript('\u00b5Block.readyToFilter'), true)
    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    await window.loadURL(`chrome-extension://${extension.id}/popup-fenix.html`)
    console.log('Popup loaded', await window.webContents.executeJavaScript('document.title'))
    app.exit(0)
  })
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
