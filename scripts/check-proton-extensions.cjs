const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-proton-check-'))
  const env = { ...process.env, REI_PROTON_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
    env,
    encoding: 'utf8',
    timeout: 90000,
    windowsHide: true
  })
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')
  assert.ok(path.resolve(profile).startsWith(path.join(os.tmpdir(), 'rei-proton-check-')))
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 })
  if (result.error) console.error(result.error.message)
  if (result.status === 0) {
    assert.doesNotMatch(
      result.stderr || '',
      /Unchecked runtime\.lastError|MaxListenersExceededWarning/
    )
    console.log('PASS: real Proton startup has no unchecked runtime errors or listener warnings')
  }
  process.exit(result.status ?? 1)
}

const Module = require('node:module')
const { createServer } = require('node:http')
const { app, BaseWindow, BrowserWindow, dialog, screen, session } = require('electron')
app.setPath('userData', process.env.REI_PROTON_PROFILE)
app.on('window-all-closed', () => {})
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1')
const bundlePath = path.resolve(__dirname, '../out/main/index.js')
const bundle = fs.readFileSync(bundlePath, 'utf8').split('function createWindow(')[0]
const browserModule = new Module(bundlePath, module)
browserModule.filename = bundlePath
browserModule.paths = Module._nodeModulePaths(path.dirname(bundlePath))
browserModule._compile(
  `${bundle}\nmodule.exports = { ExtensionRuntime, attachBrowser, SearchStore, extensionOriginCovered }`,
  bundlePath
)
const { ExtensionRuntime, attachBrowser, SearchStore, extensionOriginCovered } =
  browserModule.exports
const extensionRoot =
  process.env.REI_PROTON_EXTENSIONS || path.join(process.env.APPDATA, 'rei/Extensions')
const vpnId = 'jplgfhpmjnbigmhklmmbgecoobifkmpa'
const passId = 'ghmbeldphafepmbegfdlkpapadhbakde'
const errors = []
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (event) => {
    if (event.message.startsWith('Uncaught')) errors.push(event.message.slice(0, 350))
  })
})

async function waitFor(check, message) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(message)
}

app.whenReady().then(async () => {
  try {
    for (const [grant, request, expected] of [
      ['https://*/*', 'https://account.proton.me/*', true],
      ['https://*.proton.me/*', 'https://proton.me/*', true],
      ['https://*.proton.me/*', 'https://account.proton.me/*', true],
      ['https://*.proton.me/*', 'https://evilproton.me/*', false],
      ['https://*.proton.me/*', 'https://proton.me.evil.test/*', false],
      ['https://account.proton.me/*', 'https://*/*', false],
      ['http://*/*', 'https://account.proton.me/*', false],
      ['*://*/*', 'https://account.proton.me/*', true],
      ['*://*/*', 'ftp://example.com/*', false],
      ['<all_urls>', 'https://account.proton.me/*', true],
      ['<all_urls>', 'chrome-extension://example/*', false]
    ])
      assert.equal(extensionOriginCovered(grant, request), expected, `${grant} covers ${request}`)
    const runtime = new ExtensionRuntime()
    await runtime.initialize()
    const window = new BaseWindow({ show: false, width: 1100, height: 760 })
    const store = new SearchStore(':memory:')
    const chrome = attachBrowser(window, store, runtime)
    await chrome.loadFile(path.resolve(__dirname, '../out/renderer/index.html'))
    const read = (script) => chrome.executeJavaScript(script)
    await read('void window.api.onState(state => window.protonState = state)')
    const sidebar = window.contentView.children[0].webContents
    await waitFor(
      () => sidebar.executeJavaScript('!!document.querySelector(".sidebar-extensions")'),
      'sidebar'
    )
    for (const id of [vpnId, passId]) {
      const root = path.join(extensionRoot, id)
      assert.ok(fs.existsSync(root), `Missing installed extension package: ${id}`)
      const version = fs
        .readdirSync(root)
        .filter((name) => fs.existsSync(path.join(root, name, 'manifest.json')))
        .sort()
        .at(-1)
      const destination = path.join(app.getPath('userData'), 'Extensions', id, version)
      fs.cpSync(path.join(root, version), destination, { recursive: true })
      if (id === vpnId)
        fs.writeFileSync(
          path.join(destination, 'rei-check.js'),
          `
          (async () => {
            const required = {permissions:['proxy'],origins:['https://account.proton.me/*','http://*/*','ftp://*/*','wss://*/*']};
            globalThis.reiPermissionCheck = {
              contains: await browser.permissions.contains(required),
              requested: await browser.permissions.request({permissions:['proxy'],origins:['https://account.proton.me/*']}),
              undeclared: await browser.permissions.contains({permissions:['nativeMessaging']}),
              proxy: await browser.proxy.settings.get({incognito:false})
            };
          })().catch(error => { globalThis.reiPermissionCheck = {error:String(error)}; });
        `
        )
      assert.equal((await session.defaultSession.extensions.loadExtension(destination)).id, id)
      assert.match(
        runtime.state().extensions.find((extension) => extension.id === id)?.icon || '',
        /^data:image\/png;base64,/
      )
    }
    await sidebar.executeJavaScript('window.api.openExtensions()')
    await waitFor(
      () => read('document.querySelectorAll(".extension-entry").length === 3'),
      'installed extension rows'
    )
    assert.equal(
      await read('document.querySelectorAll("fieldset .rei-card").length'),
      1,
      'extensions share one card'
    )
    assert.equal(
      await read('document.querySelectorAll(".extension-entry .rei-row").length'),
      0,
      'no extra enabled/description rows'
    )
    assert.equal(
      await read('document.querySelectorAll(".extension-heading [role=switch]").length'),
      3,
      'toggles belong in headings'
    )
    await waitFor(
      () =>
        read(
          'Array.from(document.querySelectorAll(".extension-heading img")).length === 3 && Array.from(document.querySelectorAll(".extension-heading img")).every(image => image.complete && image.naturalWidth > 0)'
        ),
      'real extension icons'
    )
    const openPopup = async (id) => {
      if (!(await sidebar.executeJavaScript('!!document.querySelector("#extensions-panel")')))
        await sidebar.executeJavaScript('document.querySelector(".sidebar-extensions").click()')
      await waitFor(
        () =>
          sidebar.executeJavaScript(
            `!!document.querySelector('browser-action-list')?.shadowRoot.querySelector('[id="${id}"]')`
          ),
        'extension toolbar action'
      )
      const created = new Promise((resolve) =>
        runtime.api.once('browser-action-popup-created', resolve)
      )
      await sidebar.executeJavaScript(
        `document.querySelector('browser-action-list').shadowRoot.querySelector('[id="${id}"]').click()`
      )
      const popup = await created
      await popup.whenReady()
      return popup
    }
    const pass = await openPopup(passId)
    console.log('CHECK: grouped settings and real extension icons')
    const passContents = pass.browserWindow.webContents
    await waitFor(
      () =>
        passContents.executeJavaScript('document.body.innerText.includes("Sign in with Proton")'),
      'Proton Pass sign-in controls must render'
    )
    assert.equal(await passContents.executeJavaScript('typeof window.api'), 'undefined')
    assert.equal(await passContents.executeJavaScript('typeof require'), 'undefined')
    console.log('CHECK: Proton Pass APIs')
    const popupEvent = { type: 'frame', sender: passContents }
    assert.equal(
      await runtime.api.ctx.router.onExtensionMessage(popupEvent, passId, 'tabs.getCurrent'),
      undefined,
      'an extension popup is not a browser tab'
    )
    const registeredTab = [...runtime.api.ctx.store.tabs][0]
    assert.ok(registeredTab, 'the browser must have a registered tab')
    const currentTab = await runtime.api.ctx.router.onExtensionMessage(
      { type: 'frame', sender: registeredTab },
      passId,
      'tabs.getCurrent'
    )
    assert.equal(currentTab.id, registeredTab.id, 'a tab must receive its own details')
    const passWorker = await runtime.session.serviceWorkers.startWorkerForScope(
      `chrome-extension://${passId}/`
    )
    assert.equal(
      await runtime.api.ctx.router.onExtensionMessage(
        { type: 'service-worker', serviceWorker: passWorker, session: runtime.session },
        passId,
        'tabs.getCurrent'
      ),
      undefined,
      'a background worker is not a browser tab'
    )
    assert.notEqual(
      await passContents.executeJavaScript(
        'getComputedStyle(document.documentElement).getPropertyValue("--popup-width").trim()'
      ),
      '100%',
      'Proton Pass must not mistake its popup for an expanded browser tab'
    )
    assert.equal(
      await passContents.executeJavaScript('document.body.innerText.includes("Grant permissions")'),
      false,
      'declared wildcard permissions cover Proton account hosts'
    )
    await waitFor(() => {
      const bounds = pass.browserWindow.getBounds()
      return bounds.width >= 350 && bounds.height >= 300
    }, 'Proton Pass must not collapse to an unusable box')
    const bounds = pass.browserWindow.getBounds()
    const area = screen.getDisplayMatching(bounds).workArea
    assert.ok(bounds.x >= area.x && bounds.y >= area.y)
    assert.ok(
      bounds.x + bounds.width <= area.x + area.width &&
        bounds.y + bounds.height <= area.y + area.height
    )
    await passContents.executeJavaScript(
      `Array.from(document.querySelectorAll('button, a')).find(element => element.textContent.includes('Sign in with Proton')).click()`
    )
    await waitFor(
      () =>
        read(
          'window.protonState.tabs.some(tab => tab.url.startsWith("https://account.proton.me/"))'
        ),
      'Proton Pass sign-in must open a Rei tab'
    )
    if (!pass.isDestroyed()) pass.destroy()
    console.log('CHECK: Proton Pass popup and sign-in tab')
    const vpn = await openPopup(vpnId)
    const vpnContents = vpn.browserWindow.webContents
    await waitFor(
      () => vpnContents.executeJavaScript('document.body.innerText.length > 30'),
      'Proton VPN controls'
    )
    let prompts = 0
    dialog.showMessageBox = async () => {
      prompts++
      return { response: 0, checkboxChecked: false }
    }
    await vpnContents.executeJavaScript(
      `(() => { const script = document.createElement('script'); script.src = '/rei-check.js'; document.body.append(script); })()`
    )
    await waitFor(
      () => vpnContents.executeJavaScript('!!globalThis.reiPermissionCheck'),
      'VPN permission API check'
    )
    assert.deepEqual(await vpnContents.executeJavaScript('globalThis.reiPermissionCheck'), {
      contains: true,
      requested: true,
      undeclared: false,
      proxy: { value: { mode: 'system' }, levelOfControl: 'controllable_by_this_extension' }
    })
    assert.equal(prompts, 0, 'already granted required permissions need no additional prompt')
    await waitFor(
      () =>
        vpnContents.executeJavaScript('!document.body.innerText.includes("Allow VPN permissions")'),
      'VPN must advance beyond permission onboarding'
    )
    let routed = 0
    const proxy = createServer((request, response) => {
      assert.equal(new URL(request.url).hostname, 'rei-proton-probe.invalid')
      routed++
      response.end('proton-extension-proxy-route')
    })
    await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve))
    const port = proxy.address().port
    await vpnContents.executeJavaScript(`chrome.proxy.settings.set({value: {
      mode: 'fixed_servers', rules: {singleProxy: {scheme: 'http', host: '127.0.0.1', port: ${port}}}
    }})`)
    assert.equal(
      await runtime.session.resolveProxy('http://rei-proton-probe.invalid/traffic'),
      `PROXY 127.0.0.1:${port}`
    )
    const traffic = new BrowserWindow({ show: false, webPreferences: { session: runtime.session } })
    await traffic.loadURL('http://rei-proton-probe.invalid/traffic')
    assert.equal(
      await traffic.webContents.executeJavaScript('document.body.innerText'),
      'proton-extension-proxy-route'
    )
    assert.ok(routed > 0, 'the real Proton extension context must control actual browsing traffic')
    traffic.destroy()
    await vpnContents.executeJavaScript('chrome.proxy.settings.clear({})')
    await new Promise((resolve) => proxy.close(resolve))
    assert.ok(
      runtime
        .state()
        .extensions.find((entry) => entry.id === vpnId)
        .compatibilityWarnings.some((warning) => warning.includes('not a system VPN'))
    )
    console.log('CHECK: real Proton extension context routes browser traffic through a local proxy')
    const workers = Object.values(session.defaultSession.serviceWorkers.getAllRunning())
    for (const id of [vpnId, passId])
      assert.ok(
        workers.some((worker) => worker.scope === `chrome-extension://${id}/`),
        'MV3 background worker must stay running'
      )
    assert.deepEqual(errors, [], 'extension controls must not throw')
    vpn.destroy()
    await read(`window.api.toggleExtension('${vpnId}', false)`)
    assert.match(
      runtime.state().extensions.find((extension) => extension.id === vpnId).icon,
      /^data:image\/png;base64,/
    )
    window.destroy()
    store.close()
    console.log(
      'PASS: grouped settings, header toggles, installed/disabled icons, Proton Pass popup and sign-in, VPN permission onboarding, MV3 workers'
    )
    app.exit(0)
  } catch (error) {
    console.error('FAIL:', error.stack, errors)
    app.exit(1)
  }
})
