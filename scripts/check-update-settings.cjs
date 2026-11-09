const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-updates-check-'))
  const env = { ...process.env, REI_UPDATES_CHECK_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
    env,
    stdio: 'inherit',
    timeout: 30000,
    windowsHide: true
  })
  assert.ok(path.resolve(profile).startsWith(path.join(os.tmpdir(), 'rei-updates-check-')))
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 })
  if (result.error) console.error(result.error.message)
  process.exit(result.status ?? 1)
}

const Module = require('node:module')
const { app, BaseWindow } = require('electron')
app.setPath('userData', process.env.REI_UPDATES_CHECK_PROFILE)
const bundlePath = path.resolve(__dirname, '../out/main/index.js')
const browserModule = new Module(bundlePath, module)
browserModule.filename = bundlePath
browserModule.paths = Module._nodeModulePaths(path.dirname(bundlePath))
browserModule._compile(
  `${fs.readFileSync(bundlePath, 'utf8').split('function createWindow(')[0]}\nmodule.exports = { attachBrowser, SearchStore }`,
  bundlePath
)

async function waitFor(check, message) {
  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.fail(message)
}

app.whenReady().then(async () => {
  const store = new browserModule.exports.SearchStore(':memory:')
  const window = new BaseWindow({ width: 1000, height: 760, show: true })
  try {
    const chrome = browserModule.exports.attachBrowser(window, store)
    await chrome.loadFile(path.resolve(__dirname, '../out/renderer/index.html'))
    const read = (script) => chrome.executeJavaScript(script)
    await read('window.api.navigate("rei://settings/updates")')
    await waitFor(
      () =>
        read(
          'document.querySelector("#automatic-updates") && document.querySelector(".settings-content .rei-description")?.textContent.includes("Version ")'
        ),
      'updates page must load the installed version'
    )
    assert.equal(await read('document.querySelector(".update-status")'), null)
    assert.equal(
      await read(
        'document.querySelector("#automatic-updates").closest(".rei-row").querySelector(".rei-description")'
      ),
      null
    )
    assert.equal(
      await read('document.querySelector(".settings-content .rei-button").disabled'),
      true
    )
    await read('document.querySelector("#automatic-updates").click()')
    await waitFor(
      () => read('window.api.getPreferences().then(value => value.automaticUpdates === false)'),
      'automatic update preference must persist'
    )
    await chrome.reload()
    await waitFor(() => read('!!window.api'), 'preload must reload')
    await read('window.api.navigate("rei://settings/updates")')
    await waitFor(
      () =>
        read(
          'document.querySelector("#automatic-updates")?.getAttribute("aria-checked") === "false"'
        ),
      'automatic update preference must survive renderer reload'
    )

    const state = { currentVersion: '1.0.0', version: '1.1.0', progress: 42, message: '' }
    for (const [status, text] of [
      ['checking', 'Checking for updates'],
      ['downloading', 'Downloading update'],
      ['ready', 'Update ready to install'],
      ['current', 'Rei is up to date'],
      ['error', 'Update failed']
    ]) {
      chrome.send('updates:changed', { ...state, status })
      await waitFor(
        () =>
          read(
            `document.querySelector('[role="status"]')?.textContent.includes(${JSON.stringify(text)})`
          ),
        text
      )
      if (status === 'downloading') {
        assert.equal(await read('document.querySelector("progress").value'), 42)
        assert.equal(
          await read('document.querySelector("progress").getAttribute("aria-label")'),
          'Update download progress'
        )
        assert.equal(
          await read('document.querySelector(".settings-content .rei-button").disabled'),
          true
        )
      }
      if (status === 'ready') {
        assert.equal(
          await read('document.querySelector(".settings-content .rei-button").disabled'),
          false
        )
        assert.match(
          await read('document.querySelector(".settings-content .rei-button").textContent'),
          /Restart to update/
        )
      }
    }
    for (const width of [1800, 1000, 480]) {
      window.setSize(width, 760)
      window.emit('resize')
      await waitFor(
        () =>
          read(
            `innerWidth === ${window.contentView.children.find((view) => view.webContents === chrome).getBounds().width}`
          ),
        'settings must resize'
      )
      assert.equal(
        await read(
          'document.querySelector(".settings-page").scrollWidth <= document.querySelector(".settings-page").clientWidth'
        ),
        true
      )
    }
    console.log(
      'PASS: update settings deep link, persisted switch, async states, accessible progress and compact layouts'
    )
    window.destroy()
    store.close()
    app.exit(0)
  } catch (error) {
    console.error('FAIL:', error.stack)
    if (!window.isDestroyed()) window.destroy()
    store.close()
    app.exit(1)
  }
})
