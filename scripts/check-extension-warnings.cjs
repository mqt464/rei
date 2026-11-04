const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

if (!process.versions.electron) {
  const { compile } = require('svelte/compiler')
  for (const name of ['Sidebar.svelte', 'components/ScrollArea.svelte']) {
    const filename = path.resolve(__dirname, '../src/renderer/src', name)
    const result = compile(fs.readFileSync(filename, 'utf8'), { filename })
    const warnings = result.warnings.filter((warning) => warning.code.startsWith('a11y_'))
    console.log(
      `${name}: ${warnings.map((warning) => warning.code).join(', ') || 'no accessibility warnings'}`
    )
    if (warnings.length) process.exitCode = 1
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-warning-check-'))
  const env = { ...process.env, REI_WARNING_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
    env,
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true
  })
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')
  assert.ok(path.resolve(profile).startsWith(path.join(os.tmpdir(), 'rei-warning-check-')))
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 })
  if (result.error) console.error(result.error.message)
  if (result.status === 0)
    assert.doesNotMatch(
      result.stderr || '',
      /Unchecked runtime\.lastError|MaxListenersExceededWarning/
    )
  process.exit(result.status || process.exitCode || (result.error ? 1 : 0))
}

const Module = require('node:module')
const { EventEmitter } = require('node:events')
const { app, BrowserWindow } = require('electron')
app.setPath('userData', process.env.REI_WARNING_PROFILE)
app.on('window-all-closed', () => {})
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1')
const bundlePath = path.resolve(__dirname, '../out/main/index.js')
const bundle = fs.readFileSync(bundlePath, 'utf8').split('function createWindow(')[0]
const runtimeModule = new Module(bundlePath, module)
runtimeModule.filename = bundlePath
runtimeModule.paths = Module._nodeModulePaths(path.dirname(bundlePath))
runtimeModule._compile(`${bundle}\nmodule.exports = { ExtensionRuntime };`, bundlePath)

app.whenReady().then(async () => {
  try {
    const runtime = new runtimeModule.exports.ExtensionRuntime()
    await runtime.initialize()
    const router = runtime.api.ctx.router
    const host = new EventEmitter()
    host.id = 987654
    host.getURL = () => 'chrome-extension://fixture/popup.html'
    for (let index = 0; index < 30; index++) router.observeListenerHost(host)
    console.log(
      `Host cleanup registrations after 30 observations: ${host.listenerCount('destroyed')}`
    )
    assert.equal(host.listenerCount('destroyed'), 1, 'one destruction cleanup per extension host')
    router.listeners.set('rei-warning-fixture', [{ type: 'frame', host }])
    host.emit('destroyed')
    assert.equal(
      router.listeners.has('rei-warning-fixture'),
      false,
      'destroy removes extension listeners'
    )
    console.log('PASS: extension host cleanup stays bounded and removes subscriptions')
    const directory = path.join(app.getPath('userData'), 'Extensions', 'warning-fixture')
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(
      path.join(directory, 'manifest.json'),
      JSON.stringify({
        name: 'Warning fixture',
        version: '1.0',
        manifest_version: 3,
        permissions: ['storage', 'privacy', 'notifications', 'contextMenus', 'webNavigation']
      })
    )
    fs.writeFileSync(
      path.join(directory, 'popup.html'),
      '<!doctype html><script src="popup.js" defer></script>'
    )
    fs.writeFileSync(
      path.join(directory, 'popup.js'),
      `
      globalThis.checkWarnings = async () => {
        await chrome.storage.local.set({localSecret: 'fixture-local-only'});
        const managed = await new Promise(resolve => chrome.storage.managed.get(null, value =>
          resolve({value, error: chrome.runtime.lastError?.message || null})));
        const message = chrome.runtime.sendMessage({probe: true});
        const promise = !!message && typeof message.then === 'function';
        const messageError = promise ? await message.then(() => null, error => error.message) : null;
        const callbackError = await new Promise(resolve => chrome.runtime.sendMessage({probe: true},
          () => resolve(chrome.runtime.lastError?.message || null)));
        const managedDefaults = await chrome.storage.managed.get({localSecret: 'default-only'});
        const managedWriteError = await chrome.storage.managed.set({blocked: true}).then(() => null, error => error.message);
        const managedCallbackError = await new Promise(resolve => chrome.storage.managed.clear(
          () => resolve(chrome.runtime.lastError?.message || null)));
        const privacyError = await chrome.privacy.network.networkPredictionEnabled.set({value: false}).then(() => null, error => error.message);
        const privacyCallbackError = await new Promise(resolve => chrome.privacy.services.passwordSavingEnabled.get({},
          () => resolve(chrome.runtime.lastError?.message || null)));
        const notificationPermission = await chrome.notifications.getPermissionLevel();
        const menu = await new Promise(resolve => chrome.contextMenus.create({id: 'warning-menu', title: 'Fixture', contexts: ['page']}, () => resolve(chrome.runtime.lastError?.message || 'created')));
        await chrome.contextMenus.remove('warning-menu');
        await chrome.privacy.network.webRTCIPHandlingPolicy.set({value: 'disable_non_proxied_udp'});
        return {managed, promise, messageError, callbackError, managedDefaults, managedWriteError,
          managedCallbackError, privacyError, privacyCallbackError, notificationPermission, menu,
          lastErrorAfterCallback: chrome.runtime.lastError?.message || null,
          proxyExposed: !!chrome.proxy};
      };
    `
    )
    const extension = await runtime.session.extensions.loadExtension(directory)
    const window = new BrowserWindow({ show: false, webPreferences: { session: runtime.session } })
    await window.loadURL(`${extension.url}popup.html`)
    const result = await window.webContents.executeJavaScript('checkWarnings()')
    console.log('Native API probe:', JSON.stringify(result))
    assert.match(
      result.callbackError || '',
      /Receiving end does not exist/,
      'native callback errors survive API injection'
    )
    assert.deepEqual(
      result.managed,
      { value: {}, error: null },
      'unconfigured managed storage is empty, not local storage'
    )
    assert.equal(result.promise, true, 'messaging without a callback must return a Promise')
    assert.match(result.messageError, /Receiving end does not exist/)
    assert.deepEqual(result.managedDefaults, { localSecret: 'default-only' })
    assert.match(result.managedWriteError, /read-only/)
    assert.match(result.managedCallbackError, /read-only/)
    assert.match(result.privacyError, /not supported/)
    assert.match(result.privacyCallbackError, /not supported/)
    assert.ok(['granted', 'denied'].includes(result.notificationPermission))
    assert.equal(result.menu, 'created')
    assert.equal(result.lastErrorAfterCallback, null)
    assert.equal(result.proxyExposed, false, 'privacy permission must not expose proxy controls')
    assert.equal(
      window.webContents.getWebRTCIPHandlingPolicy(),
      'disable_non_proxied_udp',
      'privacy-only extensions enforce a real policy'
    )
    const page = new BrowserWindow({ show: false, webPreferences: { session: runtime.session } })
    runtime.api.addTab(page.webContents, page)
    await page.loadURL('data:text/html,<title>Navigation fixture</title>')
    const frames = await window.webContents.executeJavaScript(
      `chrome.webNavigation.getAllFrames({tabId: ${page.webContents.id}})`
    )
    assert.ok(frames.some((frame) => frame.frameId === 0 && frame.url.includes('Navigation')))
    const notices = runtime
      .state()
      .extensions.find((entry) => entry.id === extension.id).compatibilityWarnings
    assert.ok(notices.some((notice) => notice.includes('Other privacy controls')))
    page.destroy()
    window.destroy()
    console.log(
      'PASS: managed isolation, callback/Promise failures, context menus, notifications, navigation, real WebRTC policy, and compatibility notices'
    )
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
