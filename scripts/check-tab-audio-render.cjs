const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-audio-check-'))
  const env = { ...process.env, REI_AUDIO_CHECK_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
    env,
    stdio: 'inherit',
    timeout: 30000,
    windowsHide: true
  })
  assert.ok(path.resolve(profile).startsWith(path.join(os.tmpdir(), 'rei-audio-check-')))
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 })
  if (result.error) console.error(result.error.message)
  process.exit(result.status ?? 1)
}

const Module = require('node:module')
const { app, BaseWindow, webContents } = require('electron')
const bundlePath = path.resolve(__dirname, '../out/main/index.js')
const bundle = fs.readFileSync(bundlePath, 'utf8').split('function createWindow(')[0]
const browserModule = new Module(bundlePath, module)
browserModule.filename = bundlePath
browserModule.paths = Module._nodeModulePaths(path.dirname(bundlePath))
browserModule._compile(`${bundle}\nmodule.exports = { attachBrowser, SearchStore }`, bundlePath)
app.setPath('userData', process.env.REI_AUDIO_CHECK_PROFILE)
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

app.whenReady().then(async () => {
  const store = new browserModule.exports.SearchStore(':memory:')
  const window = new BaseWindow({ width: 900, height: 670, show: false })
  try {
    const chrome = browserModule.exports.attachBrowser(window, store)
    for (const view of window.contentView.children) view.webContents.setBackgroundThrottling(false)
    await chrome.loadFile(path.resolve(__dirname, '../out/renderer/index.html'))
    const sidebar = window.contentView.children[0].webContents
    await chrome.executeJavaScript(
      'void window.api.onState(state => window.audioCheckState = state)'
    )
    let contents
    for (let attempt = 0; attempt < 100; attempt++) {
      const state = await chrome.executeJavaScript('window.audioCheckState')
      if (state?.activeWebContentsId && !sidebar.isLoading()) {
        contents = webContents.fromId(state.activeWebContentsId)
        break
      }
      await delay(20)
    }
    assert.ok(contents, 'browser must be ready')
    const visible = () => sidebar.executeJavaScript('!!document.querySelector(".tab-audio")')
    contents.emit('audio-state-changed', { audible: true })
    await delay(100)
    assert.ok(await visible(), 'audio must appear immediately')
    contents.emit('audio-state-changed', { audible: false })
    await delay(500)
    assert.ok(await visible(), 'short silence must not hide the icon')
    await delay(700)
    assert.ok(!(await visible()), 'icon must disappear after one second without switching tabs')
    console.log('Tab audio render check passed')
    window.close()
    store.close()
    app.exit(0)
  } catch (error) {
    console.error(error)
    if (!window.isDestroyed()) window.close()
    store.close()
    app.exit(1)
  }
})
