const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-appearance-check-'))
  let status = 0
  try {
    for (const phase of ['chosen', 'restore', 'blank']) {
      const env = { ...process.env, REI_APPEARANCE_PROFILE: profile, REI_APPEARANCE_PHASE: phase }
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
  } finally {
    assert.ok(path.resolve(profile).startsWith(path.join(os.tmpdir(), 'rei-appearance-check-')))
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 })
  }
  process.exit(status)
} else {
  const { app, BaseWindow, dialog, shell, nativeTheme } = require('electron')
  const { createServer } = require('node:http')
  const Module = require('node:module')
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
  app.setPath('userData', process.env.REI_APPEARANCE_PROFILE)
  const bundlePath = path.resolve(__dirname, '../out/main/index.js')
  const browserModule = new Module(bundlePath, module)
  browserModule.filename = bundlePath
  browserModule.paths = Module._nodeModulePaths(path.dirname(bundlePath))
  browserModule._compile(
    `const Date = class extends globalThis.Date { static now() { return globalThis.__reiClock ? globalThis.__reiClock() : super.now() } };\n${fs.readFileSync(bundlePath, 'utf8').split('function createWindow(')[0]}\nmodule.exports = { attachBrowser, SearchStore, defaultTheme, parseTheme, themeColors, parsePreferences }`,
    bundlePath
  )

  async function waitFor(check, message) {
    const deadline = Date.now() + 6000
    while (Date.now() < deadline) {
      if (await check()) return
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.fail(message)
  }

  app
    .whenReady()
    .then(async () => {
      const profile = app.getPath('userData')
      const phase = process.env.REI_APPEARANCE_PHASE
      const preferencesFile = path.join(profile, 'preferences.json')
      const existing = fs.existsSync(preferencesFile)
        ? JSON.parse(fs.readFileSync(preferencesFile))
        : null
      const server = createServer((request, response) => {
        response.setHeader('Content-Type', 'text/html')
        response.end(
          `<title>Appearance fixture</title><body><p>Readable text</p><input value="unchanged"><select><option>Default</option><option>Other</option></select>${request.url === '/embedded' ? '' : '<iframe src="/embedded"></iframe>'}<div style="height:2000px"></div></body>`
        )
      })
      await new Promise((resolve) =>
        server.listen(existing ? new URL(existing.startupPages[0]).port : 0, '0.0.0.0', resolve)
      )
      const firstUrl = `http://127.0.0.1:${server.address().port}/first`
      const secondUrl = `http://localhost:${server.address().port}/second`
      if (!existing)
        fs.writeFileSync(
          preferencesFile,
          JSON.stringify({ startup: 'pages', startupPages: [firstUrl, secondUrl] })
        )
      const window = new BaseWindow({ width: 1400, height: 900, show: true })
      const store = new browserModule.exports.SearchStore(':memory:')
      const originalNow = Date.now
      let offset = 0
      global.__reiClock = () => originalNow() + offset
      let sleepCheck
      const originalInterval = global.setInterval
      global.setInterval = (callback, milliseconds, ...args) => {
        if (milliseconds === 15000) sleepCheck = callback
        return originalInterval(callback, milliseconds, ...args)
      }
      try {
        const chrome = browserModule.exports.attachBrowser(window, store)
        global.setInterval = originalInterval
        await chrome.loadFile(path.resolve(__dirname, '../out/renderer/index.html'))
        const read = (script) =>
          Promise.race([
            chrome.executeJavaScript(script),
            new Promise((_, reject) => {
              const timer = setTimeout(() => reject(new Error(`Renderer stalled: ${script}`)), 6000)
              timer.unref()
            })
          ])
        await read('void window.api.onState(state => window.testState = state)')
        const state = () => read('window.testState')
        await waitFor(async () => (await state())?.tabs.length > 0, 'startup tabs must publish')
        if (phase === 'blank') {
          assert.equal((await state()).tabs.length, 1)
          assert.equal((await state()).url, '')
          console.log('PASS: blank startup ignores custom new-tab URL')
          return
        }
        await waitFor(
          async () => (await state()).tabs.every((tab) => !tab.loading),
          'startup pages must load'
        )
        const tabs = (await state()).tabs
        assert.deepEqual(
          tabs.map((tab) => tab.url),
          [firstUrl, secondUrl]
        )
        if (phase === 'restore') {
          assert.equal((await state()).url, secondUrl, 'active tab must restore')
          const saved = await read('window.api.getTheme()')
          assert.equal(saved.wallpaperBottomFade, 65)
          assert.equal(saved.wallpaperDither, true)
          assert.equal(saved.sidebarWidth, 260)
          await read('window.api.setPreferences({startup:"blank",newTabUrl:"https://example.com"})')
          console.log('PASS: previous URLs, ordering, active tab and appearance survive restart')
          return
        }
        console.log('PASS: chosen startup pages')
        const { defaultTheme, parseTheme, themeColors, parsePreferences } = browserModule.exports
        for (const invalid of [
          { sidebarWidth: 1 },
          { wallpaperBottomFade: 101 },
          { wallpaperDither: 'yes' },
          { themeSchedule: 'unknown' },
          { fontWeight: 0 }
        ])
          assert.throws(() => parseTheme(invalid))
        for (const invalid of [
          { startupPages: ['javascript:alert(1)'] },
          { tabSleepExceptions: ['https://example.com/path'] },
          { tabSleepMinutes: -1 },
          { tabDiscardMinutes: 361 },
          { tabDiscardExceptions: ['https://example.com'] }
        ])
          assert.throws(() => parsePreferences(invalid))
        const migrated = parseTheme({
          themeSchedule: 'time',
          lightStart: '07:00',
          darkStart: '19:00',
          colors: { accent: '#123456' }
        })
        assert.equal(migrated.paletteMode, 'custom')
        assert.equal(themeColors(migrated, false).accent, '#123456')
        assert.equal(Object.hasOwn(migrated, 'lightStart'), false)
        assert.equal(Object.hasOwn(migrated, 'darkStart'), false)
        const system = parseTheme({ themeSchedule: 'system' })
        assert.equal(themeColors(system, false).background, '#faf7fa')
        assert.equal(themeColors(system, true).background, defaultTheme.colors.background)

        const patch = {
          density: 'custom',
          spacing: 16,
          sidebarWidth: 260,
          tabHeight: 40,
          tabIconSize: 20,
          tabIndicator: 'line',
          tabCloseButton: 'always',
          addressBarHeight: 48,
          addressBarOpacity: 75,
          addressBarRadius: 12,
          addressBarAlignment: 'center',
          scrollbarWidth: 9,
          scrollbarVisibility: 'always',
          edgeFade: 50,
          hoverOpacity: 40,
          hoverRadius: 8,
          hoverSpeed: 150,
          fontWeight: 500,
          lineHeight: 170,
          webpageFont: 'georgia',
          webpageFontSize: 20,
          webpageLineHeight: 180
        }
        await read(`window.api.setTheme(${JSON.stringify(patch)})`)
        await waitFor(
          () =>
            read(
              'document.documentElement.style.getPropertyValue("--rei-topbar-height") === "48px"'
            ),
          'appearance tokens must update'
        )
        const sidebarView = window.contentView.children[0]
        assert.equal(sidebarView.getBounds().width, 260)
        await waitFor(
          () =>
            sidebarView.webContents.executeJavaScript(
              'getComputedStyle(document.querySelector(".tab-select")).height === "40px"'
            ),
          'tab height must apply'
        )
        const firstView = window.contentView.children.find(
          (view) => view.webContents?.getURL() === firstUrl
        )
        await waitFor(
          () =>
            firstView.webContents.executeJavaScript(
              'getComputedStyle(document.querySelector("p")).fontSize === "20px"'
            ),
          'website typography must apply'
        )
        await read('window.api.setTheme({sidebarIconsOnly:true})')
        await waitFor(
          () => sidebarView.getBounds().width === 52,
          'icon sidebar must resize native view'
        )
        await read('window.api.setTheme({sidebarIconsOnly:false})')
        console.log('PASS: native sidebar sizing, tab dimensions and website typography')

        await read(
          'window.api.setPreferences({tabSleeping:true,tabSleepMinutes:1,tabSleepExceptions:["localhost"]})'
        )
        offset += 61000
        sleepCheck()
        await new Promise((resolve) => setTimeout(resolve, 100))
        assert.equal(
          (await state()).tabs.find((tab) => tab.id === tabs[1].id).sleeping,
          false,
          'exception must stay awake'
        )
        await read('window.api.setPreferences({tabSleepExceptions:[]})')
        const secondView = window.contentView.children.find(
          (view) => view.webContents?.getURL() === secondUrl
        )
        await secondView.webContents.executeJavaScript(
          'document.querySelector("input").value="unsaved"'
        )
        sleepCheck()
        await new Promise((resolve) => setTimeout(resolve, 100))
        assert.equal(
          (await state()).tabs.find((tab) => tab.id === tabs[1].id).sleeping,
          false,
          'edited forms must stay awake'
        )
        await secondView.webContents.executeJavaScript(
          'document.querySelector("input").value="unchanged"'
        )
        const frame = secondView.webContents.mainFrame.frames[0]
        await frame.executeJavaScript('document.querySelector("input").value="unsaved frame"')
        sleepCheck()
        await new Promise((resolve) => setTimeout(resolve, 100))
        assert.equal(
          (await state()).tabs.find((tab) => tab.id === tabs[1].id).sleeping,
          false,
          'edited iframe forms must stay awake'
        )
        await frame.executeJavaScript('document.querySelector("input").value="unchanged"')
        sleepCheck()
        await waitFor(
          async () => (await state()).tabs.find((tab) => tab.id === tabs[1].id).sleeping,
          'inactive page must sleep'
        )
        assert.equal(
          secondView.webContents.getURL(),
          secondUrl,
          'sleeping page must retain its document'
        )
        assert.equal((await state()).tabs.find((tab) => tab.id === tabs[1].id).url, secondUrl)
        assert.equal(
          (await state()).tabs.find((tab) => tab.id === tabs[0].id).sleeping,
          false,
          'active tab must stay awake'
        )
        await read(`window.api.switchTab(${JSON.stringify(tabs[1].id)})`)
        await waitFor(
          () => secondView.webContents.getURL() === secondUrl,
          'selecting sleeping tab must reload'
        )
        await waitFor(
          async () => !(await state()).tabs.find((tab) => tab.id === tabs[1].id).loading,
          'woken page must finish loading'
        )
        console.log('PASS: tab sleeping, site exceptions, form protection, freezing and wake')

        await read('window.api.openSettings()')
        await waitFor(
          () => read('!!document.querySelector("#theme-density")'),
          'appearance controls must mount'
        )
        assert.equal(
          await read('document.querySelectorAll(".rei-card .rei-card, select").length'),
          0
        )
        const capture = async (name, scroll = false) => {
          if (!process.env.REI_THEME_CAPTURES) return
          await read('document.fonts.ready')
          if (scroll)
            await read(`document.querySelector('#theme-density').scrollIntoView({block:'start'})`)
          await new Promise((resolve) => setTimeout(resolve, 250))
          fs.mkdirSync(process.env.REI_THEME_CAPTURES, { recursive: true })
          fs.writeFileSync(
            path.join(process.env.REI_THEME_CAPTURES, `${name}.png`),
            (await chrome.capturePage()).toPNG()
          )
        }
        await capture('appearance-layout', true)
        await read('window.api.navigate("rei://settings/wallpaper")')
        await waitFor(
          () => read('!!document.querySelector("#wallpaperBottomFade")'),
          'wallpaper controls must mount'
        )
        const image = await read(
          `(() => { const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;const context=canvas.getContext('2d');const gradient=context.createLinearGradient(0,0,128,128);gradient.addColorStop(0,'#255681');gradient.addColorStop(1,'#dbb2cc');context.fillStyle=gradient;context.fillRect(0,0,128,128);return canvas.toDataURL() })()`
        )
        await read(
          `window.api.setTheme({wallpaper:${JSON.stringify(image)},wallpaperBottomFade:0,wallpaperDither:false,wallpaperBlur:2,wallpaperPosition:'top'})`
        )
        await read(
          'document.querySelector("#wallpaperBottomFade").value="65";document.querySelector("#wallpaperBottomFade").dispatchEvent(new Event("input",{bubbles:true}));document.querySelector("#wallpaperBottomFade").dispatchEvent(new Event("change",{bubbles:true}));document.querySelector("#wallpaper-dither").click()'
        )
        await waitFor(
          () =>
            read(
              `window.api.getTheme().then(theme => theme.wallpaperBottomFade === 65 && theme.wallpaperDither && !!document.querySelector('.wallpaper-preview img') && document.querySelector('.wallpaper-preview img').src !== ${JSON.stringify(image)})`
            ),
          'processed wallpaper preview must load'
        )
        const processed = await read('document.querySelector(".wallpaper-preview img").src')
        assert.notEqual(processed, image, 'dithering must transform actual image pixels')
        const colors = await read(
          `(async () => {const image=document.querySelector('.wallpaper-preview img');await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d');context.drawImage(image,0,0);const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;return [...new Set([...pixels].filter((_,index)=>index%4!==3))]})()`
        )
        assert.ok(
          colors.every((value) => value % 85 === 0),
          'ordered dither must quantize colours'
        )
        await capture('wallpaper-effects')
        await read('window.api.newTab()')
        await waitFor(
          () => read('!!document.querySelector(".blank-page")'),
          'blank tab must display wallpaper'
        )
        const blankId = (await state()).activeTabId
        assert.equal(
          await read(
            'getComputedStyle(document.querySelector(".blank-page"),"::before").backgroundImage.includes("linear-gradient")'
          ),
          true
        )
        assert.equal(
          await read(
            'getComputedStyle(document.querySelector(".blank-page"),"::before").backdropFilter'
          ),
          'blur(2px)'
        )
        await capture('blank-wallpaper-effects')
        await read(`window.api.closeTab(${JSON.stringify(blankId)})`)
        await waitFor(
          () => read('!!document.querySelector("#wallpaperBottomFade")'),
          'closing blank tab must restore settings'
        )
        const folder = path.join(profile, 'wallpapers')
        fs.mkdirSync(folder)
        fs.writeFileSync(path.join(folder, '01.png'), Buffer.from(image.split(',')[1], 'base64'))
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
        const picked = await read('window.api.chooseWallpaperFolder()')
        assert.equal(picked.wallpaperFolder, folder)
        assert.equal(await read('window.api.wallpaperImage(0)'), image)
        assert.equal(await read('window.api.wallpaperImage(1)'), image)
        await read('window.api.setTheme({wallpaperFolder:""})')
        let opened
        shell.openPath = async (file) => {
          opened = file
          return ''
        }
        await read('window.api.openThemeFile()')
        assert.equal(opened, path.join(profile, 'theme.json'))
        const json = JSON.parse(fs.readFileSync(opened))
        for (const key of Object.keys(defaultTheme))
          assert.ok(Object.hasOwn(json, key), `${key} must be in theme JSON`)
        for (const [key, value] of Object.entries(patch)) assert.deepEqual(json[key], value)
        await read('window.api.setTheme({paletteMode:"system"})')
        nativeTheme.themeSource = 'light'
        await waitFor(
          () =>
            read(
              `document.documentElement.style.getPropertyValue('--rei-background') === '#faf7fa'`
            ),
          'system light palette must apply'
        )
        nativeTheme.themeSource = 'dark'
        await waitFor(
          () =>
            read(
              `document.documentElement.style.getPropertyValue('--rei-background') === ${JSON.stringify(defaultTheme.colors.background)}`
            ),
          'system dark palette must apply'
        )
        await read('window.api.setTheme({paletteMode:"custom"})')
        await read('window.api.navigate("rei://settings/browser")')
        await waitFor(
          () => read('!!document.querySelector("#startup-behaviour")'),
          'startup controls must mount'
        )
        await capture('startup-sleeping')
        await read(
          'document.querySelector("#startup-pages").value="javascript:alert(1)";document.querySelector("#startup-pages").dispatchEvent(new Event("change",{bubbles:true}))'
        )
        await waitFor(
          () =>
            read(
              'document.querySelector("#startup-pages").getAttribute("aria-invalid") === "true"'
            ),
          'invalid startup addresses must show feedback'
        )
        await read(
          `document.querySelector('#startup-pages').value=${JSON.stringify(firstUrl + '\n' + secondUrl)};document.querySelector('#startup-pages').dispatchEvent(new Event('change',{bubbles:true}))`
        )
        await waitFor(
          () =>
            read(
              'document.querySelector("#startup-pages").getAttribute("aria-invalid") === "false" && !document.querySelector("#startup-pages-error")'
            ),
          'corrected startup addresses must clear feedback'
        )
        window.setSize(480, 900)
        window.emit('resize')
        await waitFor(() => read('innerWidth < 400'), 'narrow content must resize')
        assert.equal(
          await read(
            'document.querySelector(".settings-content").scrollWidth <= document.querySelector(".settings-content").clientWidth'
          ),
          true
        )
        await capture('startup-sleeping-narrow')
        await read('window.api.navigate("rei://settings/wallpaper")')
        await waitFor(
          () => read('!!document.querySelector("#wallpaperBottomFade")'),
          'narrow wallpaper controls must mount'
        )
        assert.equal(
          await read(
            'document.querySelector(".settings-content").scrollWidth <= document.querySelector(".settings-content").clientWidth'
          ),
          true
        )
        await capture('wallpaper-effects-narrow')
        const settingsId = (await state()).activeTabId
        await read(
          `window.api.closeTab(${JSON.stringify(settingsId)});window.api.switchTab(${JSON.stringify(tabs[1].id)})`
        )
        await waitFor(
          async () => (await state()).tabs.length === 2 && (await state()).url === secondUrl,
          'restore fixture must be saved'
        )
        await read('window.api.setPreferences({startup:"restore",tabSleeping:false})')
        console.log(
          'PASS: appearance tokens/native layout, page typography, image dithering/fade, folder selection, palettes, JSON completeness and controls'
        )
      } finally {
        global.setInterval = originalInterval
        delete global.__reiClock
        window.close()
        store.close()
        server.close()
        server.closeAllConnections()
      }
    })
    .then(() => {
      app.exit(0)
    })
    .catch((error) => {
      console.error(error)
      app.exit(1)
    })
}
