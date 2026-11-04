const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const { createServer } = require('node:http')

if (!process.versions.electron) {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
    env,
    stdio: 'inherit',
    windowsHide: true,
    timeout: 90000
  })
  if (result.error) console.error(result.error)
  process.exit(result.status ?? 1)
}

const { app, BaseWindow } = require('electron')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-permissions-ui-'))
const captures = path.resolve(__dirname, '../out/permissions-check')
app.setPath('userData', profile)
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
fs.writeFileSync(path.join(profile, 'theme.json'), JSON.stringify({ font: 'mono' }))
fs.writeFileSync(path.join(profile, 'preferences.json'), JSON.stringify({ autoHideTopbar: false }))
const bundlePath = path.resolve(__dirname, '../out/main/index.js')
const loaded = new Module(bundlePath, module)
loaded.filename = bundlePath
loaded.paths = Module._nodeModulePaths(path.dirname(bundlePath))
loaded._compile(
  fs.readFileSync(bundlePath, 'utf8').split('function createWindow(')[0] +
    '\nmodule.exports = { attachBrowser, SearchStore }',
  bundlePath
)

async function waitFor(check, message) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
  assert.fail(message)
}

app
  .whenReady()
  .then(async () => {
    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html')
      response.end('<title>Permission fixture</title><p>Site fixture</p>')
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    fs.writeFileSync(
      path.join(profile, 'website-permissions.json'),
      JSON.stringify([
        {
          origin: 'https://discord.com',
          topOrigin: 'https://discord.com',
          permission: 'microphone',
          allowed: true
        },
        { origin, topOrigin: origin, permission: 'camera', allowed: true },
        { origin, topOrigin: origin, permission: 'location', allowed: false }
      ])
    )
    const store = new loaded.exports.SearchStore(':memory:')
    const window = new BaseWindow({ width: 1100, height: 780, show: false })
    try {
      const chrome = loaded.exports.attachBrowser(window, store)
      window.contentView.children[0].webContents.ipc.handle('extensions:get', () => ({
        extensions: [],
        error: ''
      }))
      const read = (expression) => chrome.executeJavaScript(expression)
      const capture = async (name) => {
        fs.mkdirSync(captures, { recursive: true })
        window.showInactive()
        await new Promise((resolve) => setTimeout(resolve, 120))
        const image = await chrome.capturePage(undefined, { stayHidden: true, stayAwake: true })
        fs.writeFileSync(path.join(captures, `${name}.png`), image.toPNG())
      }
      await chrome.loadFile(path.resolve(__dirname, '../out/renderer/index.html'))
      await read('void window.api.onState(state => window.permissionState = state)')
      await waitFor(() => read('!!window.permissionState?.tabs.length'), 'Initial state loads')
      await read('window.api.navigate("rei://settings/privacy")')
      await waitFor(() => read('!!document.querySelector(".permission-group")'), 'Privacy renders')
      assert.equal(await read('document.querySelector(".permission-group").open'), false)
      assert.equal(
        await read(
          'document.querySelector(".permission-group > summary").innerText.includes("2 sites")'
        ),
        true
      )
      await capture('privacy-collapsed')
      await read('document.querySelector(".permission-group > summary").focus()')
      assert.equal(await read('document.activeElement.tagName'), 'SUMMARY')
      await read('document.querySelector(".permission-group > summary").click()')
      await read(
        '[...document.querySelectorAll(".site-group > summary")].find(summary => summary.innerText.includes("discord.com")).click()'
      )
      assert.equal(
        await read('document.querySelector(".site-group[open]").innerText.includes("Microphone")'),
        true
      )
      assert.equal(
        await read('document.querySelector(".site-group[open]").innerText.includes("Allowed")'),
        true
      )
      await capture('privacy-expanded')
      window.setSize(600, 780)
      await capture('privacy-narrow')
      assert.equal(await read('document.documentElement.scrollWidth <= innerWidth'), true)
      window.setSize(1100, 780)
      await read(`window.api.navigate(${JSON.stringify(origin)})`)
      await waitFor(
        () =>
          read(
            '!!document.querySelector(".site-permissions-button") && !window.permissionState.loading'
          ),
        'Site loads'
      )
      await read('document.querySelector(".site-permissions-button").click()')
      await waitFor(
        () =>
          read(
            'document.querySelectorAll(".site-permissions-panel .permission-state").length === 2'
          ),
        'Current-site permissions load'
      )
      assert.equal(await read('document.activeElement.id'), 'site-permissions-panel')
      assert.equal(
        await read(
          'document.querySelector(".site-permissions-panel").innerText.includes("discord.com")'
        ),
        false
      )
      await capture('site-permissions')
      window.setSize(600, 780)
      await capture('site-permissions-narrow')
      assert.equal(
        await read(
          'document.querySelector(".site-permissions-panel").getBoundingClientRect().right <= innerWidth'
        ),
        true
      )
      window.setSize(1100, 780)
      await waitFor(async () => {
        const bottom = await read(
          'Math.ceil(document.querySelector(".site-permissions-panel").getBoundingClientRect().bottom)'
        )
        return (
          window.contentView.children.find((view) => view.webContents === chrome).getBounds()
            .height >= bottom
        )
      }, 'Overlay resizes to fit the panel')
      await read(
        'window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))'
      )
      assert.equal(await read('!!document.querySelector(".site-permissions-panel")'), false)
      assert.equal(
        await read('document.activeElement.classList.contains("site-permissions-button")'),
        true
      )
      await read('document.querySelector(".site-permissions-button").click()')
      await waitFor(
        () =>
          read(
            'document.querySelectorAll(".site-permissions-panel .permission-state").length === 2'
          ),
        'Panel reopens'
      )
      await read(
        'document.querySelector(".site-permissions-panel button").focus(); document.querySelector(".site-permissions-panel button").click()'
      )
      await waitFor(
        () =>
          read(
            'document.querySelectorAll(".site-permissions-panel .permission-state").length === 1'
          ),
        'Reset updates current site'
      )
      assert.equal(await read('document.activeElement.tagName'), 'SUMMARY')
      await read('window.api.navigate("rei://settings/privacy")')
      await waitFor(() => read('!!document.querySelector(".settings-page")'), 'Return to settings')
      assert.equal(await read('!!document.querySelector(".site-permissions-panel")'), false)
      await read('window.api.newIncognitoTab()')
      await waitFor(
        () =>
          read(
            '!!window.permissionState?.tabs.find(tab => tab.id === window.permissionState.activeTabId)?.incognito'
          ),
        'Incognito tab opens'
      )
      await read(
        `document.querySelector('.address-bar input').blur(); window.api.navigate(${JSON.stringify(origin)})`
      )
      await waitFor(
        () =>
          read(
            '!!document.querySelector(".site-permissions-button") && !window.permissionState.loading'
          ),
        'Private site loads'
      )
      await read('document.querySelector(".site-permissions-button").click()')
      await waitFor(
        () =>
          read(
            'document.querySelector(".site-permissions-panel")?.innerText.includes("Ask before access")'
          ),
        'Private panel excludes normal choices'
      )
      assert.equal(
        await read(
          'document.querySelector(".site-permissions-panel").innerText.includes("Incognito")'
        ),
        true
      )
      await capture('site-permissions-private')
      const sources = [
        'src/renderer/src/WebsitePermissions.svelte',
        'src/renderer/src/WebsitePermissionRows.svelte',
        'src/renderer/src/App.svelte',
        'src/renderer/src/assets/main.css'
      ]
      fs.writeFileSync(
        path.join(captures, 'verification.json'),
        JSON.stringify(
          {
            checkedAt: new Date().toISOString(),
            windowSizes: ['1100x780', '600x780'],
            checks: [
              'disclosure focus',
              'site scoping',
              'reset focus',
              'Escape',
              'navigation dismissal',
              'incognito isolation',
              'narrow layout'
            ],
            sources: Object.fromEntries(
              sources.map((source) => [
                source,
                require('node:crypto')
                  .createHash('sha256')
                  .update(fs.readFileSync(path.resolve(__dirname, '..', source)))
                  .digest('hex')
              ])
            )
          },
          null,
          2
        )
      )
      console.log(
        `Permission UI passed: collapsed groups, current-site scope, reset, Escape/focus, navigation, private isolation, and narrow layout. Captures: ${captures}`
      )
    } finally {
      window.destroy()
      store.close()
      server.close()
    }
    app.quit()
  })
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
