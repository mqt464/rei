const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-privacy-check-'))
  let status = 0
  for (const phase of ['write', 'restart']) {
    const env = { ...process.env, REI_PRIVACY_PROFILE: profile, REI_PRIVACY_PHASE: phase }
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
  assert.equal(path.dirname(profile), os.tmpdir())
  assert.ok(path.basename(profile).startsWith('rei-privacy-check-'))
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 })
  process.exit(status)
}

const Module = require('node:module')
const { createServer } = require('node:http')
const { app, BaseWindow, session } = require('electron')
app.setPath('userData', process.env.REI_PRIVACY_PROFILE)
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
  const deadline = Date.now() + 7000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.fail(message)
}

app.whenReady().then(async () => {
  const store = new browserModule.exports.SearchStore(':memory:')
  const window = new BaseWindow({ show: false })
  const requests = []
  const snapshot = '({gpc:navigator.globalPrivacyControl,dnt:navigator.doNotTrack})'
  const server = createServer((request, response) => {
    requests.push({ url: request.url, gpc: request.headers['sec-gpc'], dnt: request.headers.dnt })
    response.setHeader('Content-Type', 'text/html')
    response.end(
      `<script>window.initialSignals=${snapshot}</script>` +
        (request.url === '/frame'
          ? ''
          : `<iframe src="/frame"></iframe><iframe srcdoc='<script>window.initialSignals=${snapshot}</script>'></iframe>`)
    )
  })
  try {
    const initial = browserModule.exports.currentPreferences()
    browserModule.exports.setExtensionDoNotTrack(initial.doNotTrack, initial.globalPrivacyControl)
    const extensions = new browserModule.exports.ExtensionRuntime()
    await extensions.initialize()
    const chrome = browserModule.exports.attachBrowser(window, store, extensions)
    await chrome.loadFile(path.resolve(__dirname, '../out/renderer/index.html'))
    const read = (script) => chrome.executeJavaScript(script)
    await waitFor(() => read('!!window.api'), 'UI must mount')
    const restarting = process.env.REI_PRIVACY_PHASE === 'restart'
    assert.equal(initial.globalPrivacyControl, true)
    assert.equal(initial.doNotTrack, restarting)
    if (!restarting) {
      await read('window.api.setPreferences({globalPrivacyControl:false})')
      assert.equal(
        await read(
          'window.api.setPreferences({globalPrivacyControl:"yes"}).then(()=>true,()=>false)'
        ),
        false
      )
      await read('window.api.navigate("rei://settings/privacy")')
      await waitFor(
        () => read('!!document.getElementById("global-privacy-control")'),
        'GPC toggle must mount'
      )
      assert.equal(
        await read('document.querySelector("label[for=global-privacy-control]").textContent'),
        'Do not sell or share my data'
      )
      await read(
        'document.getElementById("global-privacy-control").click();document.getElementById("do-not-track").click()'
      )
      await waitFor(
        () =>
          read(
            'window.api.getPreferences().then(value=>value.globalPrivacyControl && value.doNotTrack)'
          ),
        'toggles must save'
      )
    }
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = `http://127.0.0.1:${server.address().port}`
    for (const incognito of [false, true]) {
      const previous = new Set(window.contentView.children.map((view) => view.webContents.id))
      await read(incognito ? 'window.api.newIncognitoTab()' : 'window.api.newTab()')
      let site
      await waitFor(() => {
        site = window.contentView.children.find(
          (view) => !previous.has(view.webContents.id)
        )?.webContents
        return !!site
      }, 'browsing tab must open')
      assert.equal(site.session === session.defaultSession, !incognito)
      for (const [gpc, dnt] of restarting
        ? [[true, true]]
        : [
            [false, false],
            [true, false],
            [false, true],
            [true, true]
          ]) {
        await read(
          `window.api.setPreferences(${JSON.stringify({ globalPrivacyControl: gpc, doNotTrack: dnt })})`
        )
        const expected = { gpc, dnt: dnt ? '1' : null }
        if (site.getURL().startsWith(address)) {
          await waitFor(async () => {
            const values = await site.executeJavaScript(
              `[${snapshot},...Array.from(document.querySelectorAll('iframe'),frame=>({gpc:frame.contentWindow.navigator.globalPrivacyControl,dnt:frame.contentWindow.navigator.doNotTrack}))]`
            )
            return (
              values.length === 3 &&
              values.every((value) => value.gpc === gpc && value.dnt === expected.dnt)
            )
          }, 'signals must update live in every frame')
        }
        const requestPath = `/page-${incognito}-${gpc}-${dnt}`
        await site.loadURL(address + requestPath)
        const request = requests.find((entry) => entry.url === requestPath)
        assert.equal(request.gpc, gpc ? '1' : undefined)
        assert.equal(request.dnt, dnt ? '1' : undefined)
        assert.deepEqual(await site.executeJavaScript('window.initialSignals'), expected)
        await waitFor(
          () =>
            site.executeJavaScript(
              'Array.from(document.querySelectorAll("iframe")).every(frame=>!!frame.contentWindow.initialSignals)'
            ),
          'frame scripts must run'
        )
        const frameSignals = await site.executeJavaScript(
          'Array.from(document.querySelectorAll("iframe"),frame=>frame.contentWindow.initialSignals)'
        )
        assert.deepEqual(frameSignals, [expected, expected])
        const count = requests.length
        await site.executeJavaScript('fetch("/fetch-check").then(response=>response.text())')
        assert.equal(requests[count].gpc, gpc ? '1' : undefined)
        assert.equal(requests[count].dnt, dnt ? '1' : undefined)
        assert.equal(await site.executeJavaScript('typeof window.api'), 'undefined')
      }
    }
    console.log(
      `PASS: privacy ${restarting ? 'restart persistence' : 'UI, validation, independent signals, live changes'}, normal/private headers, early scripts, frames, fetch, IPC isolation`
    )
    window.close()
    store.close()
    server.close()
    app.exit(0)
  } catch (error) {
    console.error('FAIL:', error.stack)
    if (!window.isDestroyed()) window.close()
    store.close()
    server.close()
    app.exit(1)
  }
})
