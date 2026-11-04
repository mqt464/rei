const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-theme-check-'))
  let status = 0
  for (const phase of ['write', 'restart']) {
    const env = { ...process.env, REI_THEME_PROFILE: profile, REI_THEME_PHASE: phase }
    delete env.ELECTRON_RUN_AS_NODE
    const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
      env,
      stdio: 'inherit',
      timeout: 30000,
      windowsHide: true
    })
    if (result.error) console.error(result.error.message)
    if (result.status !== 0) {
      status = result.status ?? 1
      break
    }
  }
  assert.ok(path.resolve(profile).startsWith(path.join(os.tmpdir(), 'rei-theme-check-')))
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 })
  process.exit(status)
}

const Module = require('node:module')
const { createServer } = require('node:http')
const { app, BaseWindow, nativeImage } = require('electron')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
const bundlePath = path.resolve(__dirname, '../out/main/index.js')
const bundle = fs.readFileSync(bundlePath, 'utf8').split('function createWindow(')[0]
const browserModule = new Module(bundlePath, module)
browserModule.filename = bundlePath
browserModule.paths = Module._nodeModulePaths(path.dirname(bundlePath))
browserModule._compile(`${bundle}\nmodule.exports = { attachBrowser, SearchStore }`, bundlePath)
app.setPath('userData', process.env.REI_THEME_PROFILE)

async function waitFor(check, message) {
  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.fail(message)
}

const colors = {
  background: '#10151c',
  surface: '#18212e',
  sidebar: '#111a24',
  topbar: '#202a39',
  input: '#101721',
  button: '#263348',
  hover: '#314463',
  selection: '#263b50',
  border: '#40516a',
  text: '#eef5ff',
  muted: '#b0bfd2',
  accent: '#d3a6ff',
  accentText: '#241436',
  error: '#ffaaaa',
  caret: '#f0d0ff',
  focus: '#cbaaff',
  scrollbar: '#a0b1c3'
}

app.whenReady().then(async () => {
  const store = new browserModule.exports.SearchStore(':memory:')
  const window = new BaseWindow({ width: 1500, height: 900, show: true })
  let otherWindow
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end(
      '<!doctype html><title>Unstyled by Rei</title><body style="background:rgb(234,231,220);color:rgb(20,30,40)">Website fixture</body>'
    )
  })
  try {
    const chrome = browserModule.exports.attachBrowser(window, store)
    const renderer = path.resolve(__dirname, '../out/renderer/index.html')
    await chrome.loadFile(renderer)
    const sidebar = window.contentView.children[0].webContents
    const read = (script) => chrome.executeJavaScript(script)
    await waitFor(() => read('!!document.querySelector(".blank-page")'), 'blank tab must mount')
    await waitFor(
      () => sidebar.executeJavaScript('!!document.querySelector(".tab-sidebar")'),
      'sidebar must mount'
    )
    await read('void window.api.onState(state => window.themeState = state)')
    const getTheme = () => read('window.api.getTheme()')
    const select = async (id, value) => {
      await read(`document.getElementById(${JSON.stringify(id)}).click()`)
      await waitFor(
        () => read(`!!document.getElementById(${JSON.stringify(id + '-list')})`),
        'custom menu must open'
      )
      await read(
        `document.querySelector(${JSON.stringify('#' + id + '-list [data-value="' + value + '"]')}).click()`
      )
    }
    const variable = (name) =>
      read(`document.documentElement.style.getPropertyValue(${JSON.stringify(name)})`)
    const capture = async (name) => {
      if (!process.env.REI_THEME_CAPTURES) return
      await read('document.fonts.ready')
      await read(
        'Promise.all(document.getAnimations().filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})))'
      )
      await new Promise((resolve) => setTimeout(resolve, 150))
      fs.mkdirSync(process.env.REI_THEME_CAPTURES, { recursive: true })
      fs.writeFileSync(
        path.join(process.env.REI_THEME_CAPTURES, `${name}.png`),
        (await chrome.capturePage()).toPNG()
      )
    }

    if (process.env.REI_THEME_PHASE === 'restart') {
      assert.deepEqual(
        await read('window.api.getShortcuts()'),
        [{ keyword: 'docs', title: 'Documentation', url: 'https://example.com/search?q={query}' }],
        'site search JSON must survive a real process restart'
      )
      const restored = await getTheme()
      assert.deepEqual(restored.colors, colors)
      assert.equal(restored.font, 'georgia')
      assert.equal(restored.fontSize, 16)
      assert.equal(restored.wallpaperFit, 'contain')
      assert.equal(restored.wallpaperDim, 35)
      assert.ok(restored.wallpaper.startsWith('data:image/png;base64,'))
      assert.equal(await variable('--rei-sidebar'), colors.sidebar)
      assert.equal(
        await read(
          'getComputedStyle(document.querySelector(".blank-page")).backgroundImage.includes("data:image/png")'
        ),
        true
      )
      await read('window.api.openSettings()')
      await waitFor(
        () => read('!!document.querySelector("#theme-font")'),
        'appearance editor must mount'
      )
      assert.equal(await read('document.querySelector("#theme-font").value'), 'georgia')
      await read(
        '[...document.querySelectorAll("button")].find(button => button.textContent.includes("Reset appearance")).click()'
      )
      await waitFor(
        async () => (await getTheme()).colors.background === '#141414',
        'reset must restore default colours'
      )
      assert.equal(
        (await getTheme()).wallpaper,
        restored.wallpaper,
        'appearance reset must preserve wallpaper'
      )
      console.log('PASS: theme and wallpaper survive a real process restart; reset keeps wallpaper')
    } else {
      const initial = await getTheme()
      await read('window.api.openSettings()')
      await waitFor(() => read('!!document.querySelector("#theme-font")'), 'appearance must mount')
      await capture('appearance-default')
      await read('window.api.newTab()')
      for (const bad of [
        null,
        [],
        { colors: { accent: 'red;display:none' } },
        { colors: { unknown: '#123456' } },
        { font: 'url(https://example.com)' },
        { fontSize: 200 },
        { wallpaper: 'data:image/svg+xml;base64,PHN2Zy8+' },
        { wallpaper: 'https://example.com/image.png' },
        { wallpaperFit: 'stretch' },
        { wallpaperDim: -1 },
        { unknown: true }
      ]) {
        assert.equal(
          await read(`window.api.setTheme(${JSON.stringify(bad)}).then(() => true, () => false)`),
          false,
          'invalid theme must be rejected'
        )
      }
      assert.deepEqual(await getTheme(), initial, 'invalid input must not alter preferences')
      await read(
        `window.api.setTheme(${JSON.stringify({ colors, font: 'georgia', fontSize: 16 })})`
      )
      for (const [key, color] of Object.entries(colors)) {
        const token = `--rei-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`
        assert.equal(await variable(token), color)
        await waitFor(
          () =>
            sidebar.executeJavaScript(
              `document.documentElement.style.getPropertyValue(${JSON.stringify(token)}) === ${JSON.stringify(color)}`
            ),
          'every colour must reach the sidebar renderer'
        )
      }
      assert.equal(
        await sidebar.executeJavaScript(
          'getComputedStyle(document.querySelector(".tab-sidebar")).backgroundColor'
        ),
        'rgb(17, 26, 36)'
      )
      assert.ok(
        (
          await sidebar.executeJavaScript(
            'getComputedStyle(document.querySelector(".tab-select")).fontFamily'
          )
        ).includes('Georgia')
      )
      assert.equal(
        await read('getComputedStyle(document.querySelector(".address-bar")).backgroundColor'),
        'rgb(32, 42, 57)'
      )

      otherWindow = new BaseWindow({ width: 900, height: 670, show: false })
      const otherChrome = browserModule.exports.attachBrowser(otherWindow, store)
      await otherChrome.loadFile(renderer)
      const siteFixture = [
        { keyword: 'docs', title: 'Documentation', url: 'https://example.com/search?q={query}' }
      ]
      fs.writeFileSync(
        path.join(app.getPath('userData'), 'site-search.json'),
        JSON.stringify(siteFixture)
      )
      await waitFor(async () => {
        const result = await otherChrome.executeJavaScript(
          'window.api.suggest("docs reference", "all", 1, false)'
        )
        return result.results[0]?.url === 'https://example.com/search?q=reference'
      }, 'site search edits must update other windows')
      await waitFor(
        () =>
          otherChrome.executeJavaScript(
            'document.documentElement.style.getPropertyValue("--rei-accent") === "#d3a6ff"'
          ),
        'new windows must inherit theme'
      )
      await sidebar.executeJavaScript('window.api.setTheme({colors:{accent:"#fedcba"}})')
      await waitFor(
        () =>
          otherChrome.executeJavaScript(
            'document.documentElement.style.getPropertyValue("--rei-accent") === "#fedcba"'
          ),
        'changes must broadcast across windows'
      )
      await read('window.api.setTheme({colors:{accent:"#d3a6ff"}})')
      otherWindow.close()

      await read('window.api.openSettings()')
      await waitFor(
        () => read('!!document.querySelector("#color-accent")'),
        'theme editor must render'
      )
      assert.equal(
        await read('document.querySelectorAll("input[type=color]").length'),
        Object.keys(colors).length
      )
      await capture('appearance-custom')
      await read(
        'document.querySelector(".hex-input").value="oops";document.querySelector(".hex-input").dispatchEvent(new Event("change",{bubbles:true}))'
      )
      await waitFor(
        () => read('!!document.querySelector(".colour-error")'),
        'invalid hex must show feedback'
      )
      await select('theme-font', 'mono')
      await waitFor(async () => (await getTheme()).font === 'mono', 'font control must save')
      assert.equal(
        await read('!!document.querySelector(".colour-error")'),
        true,
        'other edits must not hide invalid-colour feedback'
      )
      assert.equal(
        await read(
          'document.fonts.load("12px \'JetBrains Mono Variable\'").then(fonts => fonts.length > 0)'
        ),
        true,
        'bundled font must load under CSP'
      )
      await read(
        `document.querySelector(".hex-input").value=${JSON.stringify(colors.background)};document.querySelector(".hex-input").dispatchEvent(new Event("change",{bubbles:true}))`
      )
      await waitFor(
        () =>
          read(
            '!document.querySelector("[aria-invalid=true]") && !document.querySelector(".colour-error")'
          ),
        'corrected colour must clear error and invalid state'
      )
      await read('window.api.setTheme({font:"georgia"})')
      await read(
        'document.querySelector("#color-accent").value="#abcdef";document.querySelector("#color-accent").dispatchEvent(new Event("change",{bubbles:true}))'
      )
      await waitFor(
        async () => (await getTheme()).colors.accent === '#abcdef',
        'colour picker must save'
      )
      await read('window.api.setTheme({colors:{accent:"#d3a6ff"}})')
      await read('document.querySelector("#settings-tab-wallpaper").click()')
      await waitFor(
        () => read('!!document.querySelector("#wallpaper-file")'),
        'wallpaper page must render'
      )
      const bitmap = Buffer.alloc(320 * 180 * 4)
      for (let row = 0; row < 180; row++) {
        for (let column = 0; column < 320; column++) {
          const offset = (row * 320 + column) * 4
          bitmap[offset] = 50 + Math.round(column / 2)
          bitmap[offset + 1] = 35 + Math.round(row / 3)
          bitmap[offset + 2] = 30 + Math.round(row / 2)
          bitmap[offset + 3] = 255
        }
      }
      const png = nativeImage
        .createFromBitmap(bitmap, { width: 320, height: 180 })
        .toPNG()
        .toString('base64')
      await read(`{
        const bytes = Uint8Array.from(atob(${JSON.stringify(png)}), character => character.charCodeAt(0));
        const transfer = new DataTransfer();
        transfer.items.add(new File([bytes], 'wallpaper.png', {type:'image/png'}));
        const input = document.querySelector('#wallpaper-file');
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', {bubbles:true}));
      }`)
      await waitFor(
        async () => (await getTheme()).wallpaper !== null,
        'uploaded wallpaper must save'
      )
      assert.equal(await read('!!document.querySelector(".wallpaper-preview img")'), true)
      await capture('wallpaper-editor')
      await select('wallpaper-fit', 'contain')
      await read(
        'document.querySelector("#wallpaper-dim").value="35";document.querySelector("#wallpaper-dim").dispatchEvent(new Event("input",{bubbles:true}));document.querySelector("#wallpaper-dim").dispatchEvent(new Event("change",{bubbles:true}))'
      )
      await waitFor(async () => (await getTheme()).wallpaperDim === 35, 'dimming must save')
      assert.equal(
        (await getTheme()).wallpaperFit,
        'contain',
        'concurrent patches must not overwrite each other'
      )
      const wallpaper = (await getTheme()).wallpaper
      await read('window.api.newTab()')
      await waitFor(
        () => read('!!document.querySelector(".blank-page")'),
        'new blank tab must render'
      )
      assert.equal(
        await read(
          'getComputedStyle(document.querySelector(".blank-page")).backgroundImage.includes("data:image/png")'
        ),
        true
      )
      assert.equal(
        await read('getComputedStyle(document.querySelector(".blank-page")).backgroundSize'),
        'contain'
      )
      assert.equal(
        await read('getComputedStyle(document.querySelector(".blank-page"),"::after").opacity'),
        '0.35'
      )
      await capture('blank-wallpaper')

      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
      const address = `http://127.0.0.1:${server.address().port}/`
      await read(`window.api.navigate(${JSON.stringify(address)})`)
      let site
      await waitFor(() => {
        site = window.contentView.children.find(
          (view) => view.webContents?.getURL() === address
        )?.webContents
        return site && !site.isLoading()
      }, 'fixture site must load')
      assert.equal(
        await site.executeJavaScript('getComputedStyle(document.body).backgroundColor'),
        'rgb(234, 231, 220)',
        'theme must not modify websites'
      )
      assert.equal(
        await site.executeJavaScript('typeof window.api'),
        'undefined',
        'websites must not receive theme IPC'
      )
      assert.equal(
        await read('!!document.querySelector(".blank-page")'),
        false,
        'wallpaper must disappear on websites'
      )
      await read('window.api.openSettings()')
      await waitFor(
        () => read('!!document.querySelector("#wallpaper-file")'),
        'wallpaper settings must reopen'
      )
      assert.equal(
        await read('getComputedStyle(document.querySelector(".settings-page")).backgroundImage'),
        'none',
        'wallpaper must not cover settings'
      )
      await read(
        '[...document.querySelectorAll("button")].find(button => button.textContent.trim() === "Remove").click()'
      )
      await waitFor(async () => (await getTheme()).wallpaper === null, 'remove wallpaper must save')
      await read(`window.api.setTheme({wallpaper:${JSON.stringify(wallpaper)}})`)

      const temporary = path.join(app.getPath('userData'), 'theme.json.tmp')
      assert.equal(fs.existsSync(temporary), false)
      fs.mkdirSync(temporary)
      assert.equal(
        await read('window.api.setTheme({colors:{text:"#123456"}}).then(() => true, () => false)'),
        false,
        'failed persistence must reject'
      )
      assert.equal(
        (await getTheme()).colors.text,
        colors.text,
        'failed save must not alter live theme'
      )
      fs.rmdirSync(temporary)
      assert.deepEqual(
        JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'theme.json'), 'utf8')),
        await getTheme()
      )
      console.log(
        'PASS: every theme token, font, editor controls, multi-window sync, wallpaper upload/fit/dim/removal, website isolation, validation, atomic save failure'
      )
    }
    window.close()
    store.close()
    server.close()
    app.exit(0)
  } catch (error) {
    console.error('FAIL:', error.stack)
    if (otherWindow && !otherWindow.isDestroyed()) otherWindow.close()
    if (!window.isDestroyed()) window.close()
    store.close()
    server.close()
    app.exit(1)
  }
})
