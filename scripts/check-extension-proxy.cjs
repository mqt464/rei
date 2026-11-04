const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { generateKeyPairSync } = require('node:crypto')

if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-proxy-check-'))
  const env = { ...process.env, REI_PROXY_PROFILE: profile }
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
          timeout: 60000,
          windowsHide: true
        }
      )
      if (result.error) console.error(result.error.message)
      if (result.status !== 0) {
        status = result.status ?? 1
        break
      }
    }
  } finally {
    assert.ok(path.resolve(profile).startsWith(path.join(os.tmpdir(), 'rei-proxy-check-')))
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 })
  }
  process.exit(status)
}

const Module = require('node:module')
const { createServer } = require('node:http')
const { app, BrowserWindow } = require('electron')
app.setPath('userData', process.env.REI_PROXY_PROFILE)
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1')
app.on('window-all-closed', () => {})
const bundlePath = path.resolve(__dirname, '../out/main/index.js')
const bundle = fs.readFileSync(bundlePath, 'utf8').split('function createWindow(')[0]
const runtimeModule = new Module(bundlePath, module)
runtimeModule.filename = bundlePath
runtimeModule.paths = Module._nodeModulePaths(path.dirname(bundlePath))
runtimeModule._compile(`${bundle}\nmodule.exports = { ExtensionRuntime };`, bundlePath)
const { ExtensionRuntime } = runtimeModule.exports

async function waitFor(check, message) {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(message)
}

function fixture(name, permissions, version = 3) {
  const directory = path.join(app.getPath('userData'), 'Extensions', name)
  if (fs.existsSync(directory)) return directory
  fs.mkdirSync(directory, { recursive: true })
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 1024 })
  fs.writeFileSync(
    path.join(directory, 'manifest.json'),
    JSON.stringify({
      name,
      version: '1.0',
      manifest_version: version,
      key: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
      permissions: [...permissions, ...(version === 2 ? ['<all_urls>'] : [])],
      ...(version === 3 ? { host_permissions: ['<all_urls>'] } : {}),
      background: version === 3 ? { service_worker: 'worker.js' } : { scripts: ['worker.js'] },
      ...(version === 3
        ? { action: { default_popup: 'popup.html' } }
        : { browser_action: { default_popup: 'popup.html' } })
    })
  )
  fs.writeFileSync(
    path.join(directory, 'popup.html'),
    '<!doctype html><script src="popup.js" defer></script><p>Proxy test</p>'
  )
  fs.writeFileSync(
    path.join(directory, 'popup.js'),
    `
    globalThis.proxyCommand = (operation, details = {}) => chrome.proxy.settings[operation](details);
    globalThis.workerCommand = (operation, details = {}) => chrome.runtime.sendMessage({operation, details});
    globalThis.callbackError = () => new Promise(resolve => chrome.proxy.settings.set(
      {value: {mode: 'invalid'}}, () => resolve(chrome.runtime.lastError?.message || null)));
    globalThis.proxyChanges = [];
    chrome.proxy?.settings.onChange.addListener(change => proxyChanges.push(change));
    globalThis.proxyReady = true;
  `
  )
  fs.writeFileSync(
    path.join(directory, 'worker.js'),
    `
    chrome.runtime.onMessage.addListener((message, _sender, respond) => {
      if (!message.operation) return;
      const run = async () => {
        if (message.operation === 'rtc') return await chrome.privacy.network.webRTCIPHandlingPolicy.get({});
        return await chrome.proxy.settings[message.operation](message.details);
      };
      run().then(value => respond({value}), error => respond({error: error.message}));
      return true;
    });
    chrome.webRequest?.onAuthRequired?.addListener((details, respond) => {
      if (details.isProxy && details.url.startsWith('http://rei-proxy-test.invalid/'))
        respond({authCredentials: {username: 'fixture-user', password: 'synthetic-password'}});
      else respond({cancel: true});
    }, {urls: ['<all_urls>']}, ['asyncBlocking']);
  `
  )
  return directory
}

app.whenReady().then(async () => {
  try {
    const runtime = new ExtensionRuntime()
    await runtime.initialize()
    const permissions = ['proxy', 'webRequest', 'webRequestAuthProvider', 'privacy']
    const extension = await runtime.session.extensions.loadExtension(
      fixture('proxy-v3', permissions)
    )
    const window = new BrowserWindow({ show: false, webPreferences: { session: runtime.session } })
    await window.loadURL(`${extension.url}popup.html`)
    const read = (code) => window.webContents.executeJavaScript(code)
    await waitFor(() => read('!!globalThis.proxyReady'), 'extension proxy fixture must start')
    const initial = await read('proxyCommand("get")')
    assert.equal(
      initial.levelOfControl,
      process.argv[2] === 'restart'
        ? 'controlled_by_this_extension'
        : 'controllable_by_this_extension',
      'proxy control must be real and persist'
    )
    let authenticated = 0
    const proxy = createServer((request, response) => {
      assert.equal(new URL(request.url).hostname, 'rei-proxy-test.invalid')
      const expected = `Basic ${Buffer.from('fixture-user:synthetic-password').toString('base64')}`
      if (request.headers['proxy-authorization'] !== expected) {
        response.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="rei-proxy-test"' })
        response.end()
        return
      }
      authenticated++
      response.end('authenticated-proxy-response')
    })
    await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve))
    const port = proxy.address().port
    const value = {
      mode: 'fixed_servers',
      rules: { singleProxy: { scheme: 'http', host: '127.0.0.1', port } }
    }
    const workerSet = await read(`workerCommand('set', ${JSON.stringify({ value })})`)
    assert.ok(!workerSet.error, workerSet.error)
    assert.equal((await read('proxyCommand("get")')).levelOfControl, 'controlled_by_this_extension')
    assert.equal(
      await runtime.session.resolveProxy('http://rei-proxy-test.invalid/fixed'),
      `PROXY 127.0.0.1:${port}`
    )
    const network = new BrowserWindow({ show: false, webPreferences: { session: runtime.session } })
    await network.loadURL('http://rei-proxy-test.invalid/fixed')
    assert.equal(
      await network.webContents.executeJavaScript('document.body.innerText'),
      'authenticated-proxy-response'
    )
    assert.ok(authenticated > 0, 'MV3 worker must provide real proxy credentials')
    const worker = Object.entries(runtime.session.serviceWorkers.getAllRunning()).find(
      ([, entry]) => entry.scope === extension.url
    )
    assert.ok(worker, 'proxy authentication worker must be running')
    network.webContents.debugger.attach('1.3')
    await network.webContents.debugger.sendCommand('ServiceWorker.enable')
    await network.webContents.debugger.sendCommand('ServiceWorker.stopWorker', {
      versionId: worker[0]
    })
    await waitFor(
      () =>
        !Object.values(runtime.session.serviceWorkers.getAllRunning()).some(
          (entry) => entry.scope === extension.url
        ),
      'authentication worker must stop'
    )
    await runtime.session.clearAuthCache()
    await runtime.session.closeAllConnections()
    await network.loadURL('http://rei-proxy-test.invalid/woken')
    assert.equal(
      await network.webContents.executeJavaScript('document.body.innerText'),
      'authenticated-proxy-response',
      'proxy challenges must wake stopped MV3 authentication workers'
    )
    network.webContents.debugger.detach()
    console.log('CHECK: MV3 settings, real routing, and authenticated browser traffic')
    const pac = {
      mode: 'pac_script',
      pacScript: {
        data: `function FindProxyForURL(url, host) { return host === 'rei-proxy-test.invalid' ? 'PROXY 127.0.0.1:${port}' : 'DIRECT'; }`
      }
    }
    await read(`proxyCommand('set', ${JSON.stringify({ value: pac })})`)
    assert.equal(
      await runtime.session.resolveProxy('http://rei-proxy-test.invalid/pac'),
      `PROXY 127.0.0.1:${port}`
    )
    assert.equal(await runtime.session.resolveProxy('http://not-proxied.invalid/'), 'DIRECT')
    await network.loadURL('http://rei-proxy-test.invalid/pac')
    assert.equal(
      await network.webContents.executeJavaScript('document.body.innerText'),
      'authenticated-proxy-response'
    )
    const callbackError = await read('callbackError()')
    assert.match(callbackError, /proxy|mode/i)
    assert.equal(await read('chrome.runtime.lastError?.message ?? null'), null)
    const rejected = await read(
      'proxyCommand("set", {value: {mode:"invalid"}}).then(() => false, () => true)'
    )
    assert.equal(rejected, true, 'Promise callers must see failures')
    assert.deepEqual(
      (await read('proxyCommand("get")')).value,
      pac,
      'invalid settings cannot change routing'
    )
    await waitFor(() => read('proxyChanges.length > 0'), 'proxy change events')
    const before = await read('proxyChanges.length')
    await read(`proxyCommand('set', ${JSON.stringify({ value: pac })})`)
    assert.equal(
      await read('proxyChanges.length'),
      before,
      'unchanged settings must not emit changes'
    )
    assert.equal(
      await read('proxyCommand("get", {incognito:true}).then(() => false, () => true)'),
      true,
      'incognito must not claim protection'
    )
    const setProxy = runtime.session.setProxy.bind(runtime.session)
    runtime.session.setProxy = async (config) => {
      if (config.mode === 'auto_detect') throw new Error('Synthetic native proxy failure')
      return setProxy(config)
    }
    assert.equal(
      await read('proxyCommand("set", {value:{mode:"auto_detect"}}).then(() => false, () => true)'),
      true,
      'native proxy failures must reach the extension'
    )
    runtime.session.setProxy = setProxy
    assert.deepEqual(
      (await read('proxyCommand("get")')).value,
      pac,
      'failed updates must roll back'
    )
    assert.equal(
      await runtime.session.resolveProxy('http://rei-proxy-test.invalid/rollback'),
      `PROXY 127.0.0.1:${port}`
    )
    await read(
      'chrome.privacy.network.webRTCIPHandlingPolicy.set({value:"disable_non_proxied_udp"})'
    )
    assert.equal(network.webContents.getWebRTCIPHandlingPolicy(), 'disable_non_proxied_udp')
    const rtcWindow = new BrowserWindow({
      show: false,
      webPreferences: { session: runtime.session }
    })
    assert.equal(rtcWindow.webContents.getWebRTCIPHandlingPolicy(), 'disable_non_proxied_udp')
    assert.equal((await read('workerCommand("rtc")')).value.value, 'disable_non_proxied_udp')
    await read('chrome.privacy.network.webRTCIPHandlingPolicy.clear({})')
    assert.equal(network.webContents.getWebRTCIPHandlingPolicy(), 'default')
    assert.equal(rtcWindow.webContents.getWebRTCIPHandlingPolicy(), 'default')
    rtcWindow.destroy()
    await read('proxyCommand("clear")')
    assert.equal(
      (await read('proxyCommand("get")')).levelOfControl,
      'controllable_by_this_extension'
    )
    const second = await runtime.session.extensions.loadExtension(fixture('proxy-v2', ['proxy'], 2))
    const secondWindow = new BrowserWindow({
      show: false,
      webPreferences: { session: runtime.session }
    })
    await secondWindow.loadURL(`${second.url}popup.html`)
    await waitFor(
      () => secondWindow.webContents.executeJavaScript('!!globalThis.proxyReady'),
      'MV2 fixture'
    )
    await read(`proxyCommand('set', ${JSON.stringify({ value })})`)
    await secondWindow.webContents.executeJavaScript('proxyCommand("set", {value:{mode:"direct"}})')
    assert.equal(
      (await read('proxyCommand("get")')).levelOfControl,
      'controlled_by_other_extensions'
    )
    await read(`proxyCommand('set', ${JSON.stringify({ value })})`)
    assert.equal(
      await runtime.session.resolveProxy('http://rei-proxy-test.invalid/priority'),
      'DIRECT',
      'lower-priority extension cannot steal control'
    )
    runtime.session.setProxy = async () => {
      throw new Error('Synthetic restore failure')
    }
    runtime.session.extensions.removeExtension(second.id)
    await assert.rejects(runtime.proxy.whenReady(), /Synthetic restore failure/)
    assert.equal(
      await read('proxyCommand("get").then(() => false, () => true)'),
      true,
      'failed restores cannot claim working protection'
    )
    runtime.session.setProxy = setProxy
    await read(`proxyCommand('set', ${JSON.stringify({ value })})`)
    await runtime.proxy.remove(second.id)
    assert.equal(
      await runtime.session.resolveProxy('http://rei-proxy-test.invalid/restore'),
      `PROXY 127.0.0.1:${port}`
    )
    const denied = await runtime.session.extensions.loadExtension(fixture('proxy-denied', []))
    const deniedWindow = new BrowserWindow({
      show: false,
      webPreferences: { session: runtime.session }
    })
    await deniedWindow.loadURL(`${denied.url}popup.html`)
    const forged = await runtime.proxy.request(
      {
        type: 'frame',
        sender: deniedWindow.webContents,
        senderFrame: deniedWindow.webContents.mainFrame
      },
      extension.id,
      'rei.proxy.get',
      {}
    )
    assert.equal(forged.ok, false, 'an extension cannot impersonate the controller')
    const noPermission = await runtime.proxy.request(
      {
        type: 'frame',
        sender: deniedWindow.webContents,
        senderFrame: deniedWindow.webContents.mainFrame
      },
      denied.id,
      'rei.proxy.get',
      {}
    )
    assert.equal(noPermission.ok, false, 'proxy permission is mandatory')
    assert.ok(
      !fs
        .readFileSync(path.join(app.getPath('userData'), 'extension-proxy.json'), 'utf8')
        .includes('synthetic-password'),
      'proxy credentials must never be saved'
    )
    secondWindow.destroy()
    deniedWindow.destroy()
    network.destroy()
    window.destroy()
    proxy.closeAllConnections()
    await new Promise((resolve) => proxy.close(resolve))
    console.log(
      `PASS (${process.argv[2]}): proxy routing, authentication, PAC, rollback, WebRTC, callbacks, events, priority, cleanup, and permissions`
    )
    app.exit(0)
  } catch (error) {
    console.error('FAIL:', error.stack)
    app.exit(1)
  }
})
