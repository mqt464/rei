const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-performance-check-'))
  const env = { ...process.env, REI_PERFORMANCE_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  let result
  try {
    result = require('node:child_process').spawnSync(require('electron'), [__filename], {
      env,
      stdio: 'inherit',
      timeout: 60000,
      windowsHide: true
    })
    if (result.error) console.error(result.error)
  } finally {
    assert.ok(path.resolve(profile).startsWith(path.join(os.tmpdir(), 'rei-performance-check-')))
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 })
  }
  process.exit(result.status ?? 1)
} else {
  const { app, BaseWindow, safeStorage } = require('electron')
  const { createServer } = require('node:http')
  const Module = require('node:module')
  const profile = process.env.REI_PERFORMANCE_PROFILE
  fs.mkdirSync(path.join(profile, 'temp'))
  app.setPath('userData', profile)
  app.setPath('temp', path.join(profile, 'temp'))
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
  const bundlePath = path.resolve(__dirname, '../out/main/index.js')
  const browserModule = new Module(bundlePath, module)
  browserModule.filename = bundlePath
  browserModule.paths = Module._nodeModulePaths(path.dirname(bundlePath))
  browserModule._compile(
    `const Date = class extends globalThis.Date { static now() { return globalThis.__reiClock ? globalThis.__reiClock() : super.now() } };\n${fs.readFileSync(bundlePath, 'utf8').split('function createWindow(')[0]}\nmodule.exports = { attachBrowser, SearchStore, parsePreferences, TabSnapshotStore }`,
    bundlePath
  )

  async function waitFor(check, message) {
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      if (await check()) return
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert.fail(message)
  }
  const pause = () => new Promise((resolve) => setTimeout(resolve, 150))

  app
    .whenReady()
    .then(async () => {
      const { attachBrowser, SearchStore, parsePreferences, TabSnapshotStore } =
        browserModule.exports
      assert.equal(parsePreferences({}).tabSleepMinutes, 3.5)
      assert.equal(parsePreferences({}).tabSleeping, true)
      assert.equal(parsePreferences({}).tabDiscardMinutes, 30)
      assert.equal(parsePreferences({ tabSleepMinutes: 0 }).tabSleeping, false)
      assert.equal(parsePreferences({ tabSleeping: false, tabSleepMinutes: 30 }).tabSleepMinutes, 0)
      assert.equal(parsePreferences({ tabSleeping: true }).tabSleepMinutes, 3.5)
      assert.equal(
        parsePreferences({ tabSleeping: true }, parsePreferences({ tabSleepMinutes: 0 }))
          .tabSleepMinutes,
        3.5
      )
      assert.equal(parsePreferences({ tabDiscardMinutes: 0 }).tabDiscardMinutes, 0)
      assert.throws(() => parsePreferences({ tabDiscardMinutes: -1 }))
      assert.throws(() => parsePreferences({ tabDiscardMinutes: 361 }))
      assert.throws(() => parsePreferences({ tabSleepMinutes: Infinity }))
      assert.equal(parsePreferences({ tabSleepMinutes: 1 / 60 }).tabSleepMinutes, 1 / 60)
      assert.equal(parsePreferences({ tabDiscardMinutes: 360 }).tabDiscardMinutes, 360)
      assert.deepEqual(
        parsePreferences({ tabDiscardExceptions: ['EXAMPLE.COM', 'example.com'] })
          .tabDiscardExceptions,
        ['example.com']
      )
      assert.ok(safeStorage.isEncryptionAvailable(), 'encrypted restore storage must be available')

      const requests = []
      const server = createServer((request, response) => {
        requests.push(request.url)
        response.setHeader('Content-Type', 'text/html')
        response.end(
          `<title>Performance fixture</title><input value="unchanged">${request.url === '/frame' ? '' : '<iframe src="/frame"></iframe>'}<div style="height:4000px"></div><script>window.liveToken='retained';document.addEventListener('freeze',()=>window.freezeSeen=true);document.addEventListener('resume',()=>window.resumeSeen=true)</script>`
        )
      })
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
      const base = `http://127.0.0.1:${server.address().port}`
      fs.writeFileSync(
        path.join(profile, 'preferences.json'),
        JSON.stringify({
          startup: 'pages',
          startupPages: [`${base}/first`, `${base}/second`],
          tabSleepMinutes: 1440,
          tabDiscardMinutes: 720
        })
      )
      const window = new BaseWindow({ width: 1200, height: 900, show: false })
      const store = new SearchStore(':memory:')
      const originalNow = Date.now
      let offset = 0
      global.__reiClock = () => originalNow() + offset
      const originalInterval = global.setInterval
      let checkMemory
      global.setInterval = (callback, milliseconds, ...args) => {
        if (milliseconds === 15000) checkMemory = callback
        return originalInterval(callback, milliseconds, ...args)
      }
      let chrome
      try {
        chrome = attachBrowser(window, store)
      } finally {
        global.setInterval = originalInterval
      }
      const read = (script) => chrome.executeJavaScript(script)
      try {
        await chrome.loadFile(path.resolve(__dirname, '../out/renderer/index.html'))
        assert.equal(
          await read('window.api.getPreferences().then(value=>value.tabSleepMinutes)'),
          360
        )
        assert.equal(
          await read('window.api.getPreferences().then(value=>value.tabDiscardMinutes)'),
          360
        )
        await read('void window.api.onState(state => window.testState = state)')
        const state = () => read('window.testState')
        await waitFor(
          async () =>
            (await state())?.tabs.length === 2 && (await state()).tabs.every((tab) => !tab.loading),
          'startup pages must load'
        )
        const [first, second] = (await state()).tabs
        const secondState = async () => (await state()).tabs.find((tab) => tab.id === second.id)
        let secondView = window.contentView.children.find(
          (view) => view.webContents?.getURL() === second.url
        )
        assert.ok(secondView)
        const originalContents = secondView.webContents

        await read(
          'window.api.setPreferences({tabSleepMinutes:1,tabSleepExceptions:["127.0.0.1"]})'
        )
        offset += 61000
        checkMemory()
        await pause()
        assert.ok(!(await secondState()).sleeping, 'sleep exception must stay active')
        await read('window.api.setPreferences({tabSleepExceptions:[]})')
        await originalContents.executeJavaScript('document.querySelector("input").value="unsaved"')
        checkMemory()
        await pause()
        assert.ok(!(await secondState()).sleeping, 'edited forms must not sleep')
        await originalContents.executeJavaScript(
          'document.querySelector("input").value="unchanged";window.liveToken="custom-live-state"'
        )
        const beforeFreeze = requests.length
        checkMemory()
        await waitFor(async () => (await secondState()).sleeping, 'background tab must sleep')
        assert.equal(originalContents.getURL(), second.url)
        assert.equal(originalContents.isDestroyed(), false)
        await read(`window.api.switchTab(${JSON.stringify(second.id)})`)
        await waitFor(
          async () => !(await secondState()).sleeping,
          'selecting must thaw sleeping tab'
        )
        assert.equal(
          await originalContents.executeJavaScript('window.liveToken'),
          'custom-live-state'
        )
        assert.equal(
          await originalContents.executeJavaScript('window.freezeSeen && window.resumeSeen'),
          true
        )
        assert.equal(requests.length, beforeFreeze, 'sleep/wake must not reload')

        await originalContents.loadURL(`${base}/third`)
        await waitFor(
          async () =>
            (await secondState()).url === `${base}/third` && !(await secondState()).loading,
          'second navigation must settle'
        )
        originalContents.setAudioMuted(true)
        originalContents.setZoomFactor(1.25)
        await originalContents.executeJavaScript('scrollTo(0,700)')
        await read(`window.api.switchTab(${JSON.stringify(first.id)})`)
        await read(
          'window.api.setPreferences({tabSleepMinutes:0,tabDiscardMinutes:1,tabDiscardExceptions:["127.0.0.1"]})'
        )
        offset += 61000
        checkMemory()
        await pause()
        assert.ok(!(await secondState()).discarded, 'discard exception must retain live page')
        await read('window.api.setPreferences({tabDiscardExceptions:[]})')
        const frame = originalContents.mainFrame.frames[0]
        await frame.executeJavaScript('document.querySelector("input").value="unsaved frame"')
        checkMemory()
        await pause()
        assert.ok(!(await secondState()).discarded, 'edited iframe forms must not discard')
        await frame.executeJavaScript('document.querySelector("input").value="unchanged"')

        const originalSave = TabSnapshotStore.prototype.save
        TabSnapshotStore.prototype.save = () => {
          throw new Error('Simulated disk failure')
        }
        checkMemory()
        await pause()
        assert.equal(
          originalContents.isDestroyed(),
          false,
          'failed disk write must not destroy page'
        )
        assert.ok(!(await secondState()).discarded)
        TabSnapshotStore.prototype.save = originalSave

        checkMemory()
        await waitFor(async () => (await secondState()).discarded, 'background tab must discard')
        assert.equal(originalContents.isDestroyed(), true, 'discard must close web contents')
        assert.ok(!window.contentView.children.includes(secondView), 'discard must remove view')
        const cache = fs
          .readdirSync(path.join(profile, 'temp'))
          .find((name) => name.startsWith('rei-tab-cache-'))
        assert.ok(cache)
        const file = path.join(profile, 'temp', cache, `${second.id}.bin`)
        assert.ok(fs.existsSync(file), 'restore data must reach disk')
        assert.equal(
          fs.readFileSync(file).includes(Buffer.from(`${base}/third`)),
          false,
          'restore data must be encrypted'
        )
        await read(`window.api.switchTab(${JSON.stringify(second.id)})`)
        await waitFor(
          async () => !(await secondState()).discarded && !(await secondState()).loading,
          'discarded tab must restore'
        )
        secondView = window.contentView.children.find(
          (view) => view.webContents?.getURL() === `${base}/third`
        )
        assert.ok(secondView)
        assert.notEqual(secondView.webContents.id, originalContents.id)
        assert.equal(secondView.webContents.isAudioMuted(), true)
        assert.equal(secondView.webContents.getZoomFactor(), 1.25)
        assert.ok(secondView.webContents.navigationHistory.canGoBack(), 'back history must restore')
        await waitFor(
          async () =>
            Math.abs((await secondView.webContents.executeJavaScript('scrollY')) - 700) < 3,
          'scroll must restore'
        )
        assert.equal(fs.existsSync(file), false, 'waking must clear restore data')

        await read(`window.api.switchTab(${JSON.stringify(first.id)})`)
        await read('window.api.setPreferences({tabSleepMinutes:1,tabDiscardMinutes:2})')
        offset += 61000
        checkMemory()
        await waitFor(async () => (await secondState()).sleeping, 'first timer must freeze')
        const frozenContents = secondView.webContents
        offset += 61000
        checkMemory()
        await waitFor(
          async () => (await secondState()).discarded,
          'second timer must discard frozen page'
        )
        assert.equal(frozenContents.isDestroyed(), true)
        await read(`window.api.switchTab(${JSON.stringify(second.id)})`)
        await waitFor(
          async () => !(await secondState()).discarded && !(await secondState()).loading,
          'frozen-then-discarded tab must restore'
        )

        await read(`window.api.switchTab(${JSON.stringify(first.id)})`)
        await read('window.api.setPreferences({tabSleepMinutes:1,tabDiscardMinutes:0})')
        offset += 61000
        checkMemory()
        await waitFor(
          async () => (await secondState()).sleeping,
          'sleep must work with discard disabled'
        )
        await read('window.api.setPreferences({tabSleepMinutes:0})')
        await waitFor(
          async () => !(await secondState()).sleeping,
          'disabling sleep must thaw existing sleepers'
        )

        secondView = window.contentView.children.find(
          (view) => view.webContents?.getURL() === `${base}/third`
        )
        const debuggerClient = secondView.webContents.debugger
        const sendCommand = debuggerClient.sendCommand.bind(debuggerClient)
        let releaseFreeze
        debuggerClient.sendCommand = async (method, parameters) => {
          if (method === 'Page.setWebLifecycleState' && parameters.state === 'frozen')
            await new Promise((resolve) => {
              releaseFreeze = resolve
            })
          return sendCommand(method, parameters)
        }
        await read('window.api.setPreferences({tabSleepMinutes:1})')
        checkMemory()
        await waitFor(() => releaseFreeze, 'freeze command must start')
        await read(`window.api.switchTab(${JSON.stringify(second.id)})`)
        releaseFreeze()
        await waitFor(
          async () => !(await secondState()).sleeping && !debuggerClient.isAttached(),
          'switch during freeze must leave selected tab awake'
        )
        debuggerClient.sendCommand = sendCommand
        await read('window.api.setPreferences({tabSleepMinutes:0,tabDiscardMinutes:1})')
        await read(`window.api.switchTab(${JSON.stringify(first.id)})`)
        offset += 61000
        checkMemory()
        await waitFor(
          async () => (await secondState()).discarded,
          'tab must discard before navigation race'
        )
        await read(
          `window.api.switchTab(${JSON.stringify(second.id)});window.api.navigate(${JSON.stringify(`${base}/latest`)})`
        )
        await waitFor(
          async () =>
            (await secondState()).url === `${base}/latest` && !(await secondState()).loading,
          'new navigation during restoration must win'
        )

        await read('window.api.navigate("rei://settings/performance")')
        await waitFor(
          () => read('!!document.querySelector("#tab-discard-minutes")'),
          'Performance page must mount'
        )
        assert.equal(await read('document.querySelector("#tab-sleep-minutes").min'), '0')
        assert.equal(await read('document.querySelector("#tab-discard-minutes").min'), '0')
        assert.equal(await read('!!document.querySelector(".performance-help")'), false)
        assert.deepEqual(
          await read(
            'Array.from(document.querySelectorAll(".settings-content .rei-description"), element => element.textContent.trim())'
          ),
          ['Freezes tabs, partially reducing memory', 'Unload tabs, maximizing memory reduction']
        )
        const durationOutputWidth = await read(
          'getComputedStyle(document.querySelector(\'output[for="tab-sleep-minutes"]\')).minWidth'
        )
        assert.equal(
          await read('document.querySelectorAll(".settings-content .rei-row").length'),
          4
        )
        for (const mode of ['sleep', 'discard']) {
          const selector = `#tab-${mode}-minutes`
          const key = mode === 'sleep' ? 'tabSleepMinutes' : 'tabDiscardMinutes'
          assert.equal(await read(`document.querySelector('${selector}').max`), '21600')
          assert.equal(await read(`document.querySelector('${selector}').step`), '1')
          const initialTrack = await read(
            `(() => { const bounds = document.querySelector('${selector}').getBoundingClientRect(); return { left: bounds.left, width: bounds.width } })()`
          )
          for (const [seconds, label] of [
            [1, '1s'],
            [60, '1m'],
            [3661, '1h 1m 1s'],
            [21599, '5h 59m 59s'],
            [21600, '6h'],
            [0, 'Off']
          ]) {
            await read(
              `document.querySelector('${selector}').value='${seconds}';document.querySelector('${selector}').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('${selector}').dispatchEvent(new Event('change',{bubbles:true}))`
            )
            await waitFor(
              () => read(`window.api.getPreferences().then(value=>value.${key}===${seconds / 60})`),
              'duration must save in minutes'
            )
            assert.equal(
              await read(`document.querySelector('${selector}').getAttribute('aria-valuetext')`),
              label
            )
            const track = await read(
              `(() => { const bounds = document.querySelector('${selector}').getBoundingClientRect(); return { left: bounds.left, width: bounds.width } })()`
            )
            assert.ok(
              Math.abs(track.left - initialTrack.left) < 0.5,
              'slider must not shift when its value grows'
            )
            assert.ok(
              Math.abs(track.width - initialTrack.width) < 0.5,
              'slider width must stay fixed while sliding'
            )
            assert.equal(
              await read(
                `(() => { const output = document.querySelector('output[for="tab-${mode}-minutes"]'); return (output.querySelector('[torph-sr]') ?? output).textContent.trim() })()`
              ),
              label
            )
          }
        }
        await read(
          'document.querySelector("#tab-discard-minutes").value="0";document.querySelector("#tab-discard-minutes").dispatchEvent(new Event("input",{bubbles:true}));document.querySelector("#tab-discard-minutes").dispatchEvent(new Event("change",{bubbles:true}))'
        )
        await waitFor(
          () => read('window.api.getPreferences().then(value=>value.tabDiscardMinutes===0)'),
          'zero must disable discard'
        )
        assert.equal(
          await read(
            'document.querySelector("#tab-discard-minutes").getAttribute("aria-valuetext")'
          ),
          'Off'
        )
        await read('window.api.navigate("rei://settings/browser")')
        await waitFor(
          () => read('!!document.querySelector("#startup-behaviour")'),
          'Browsing page must mount'
        )
        assert.equal(await read('!!document.querySelector("#tab-sleep-minutes")'), false)
        assert.equal(
          await read(
            'getComputedStyle(document.querySelector(\'output[for="default-zoom"]\')).minWidth'
          ),
          durationOutputWidth,
          'duration values must use the same reserved width as other sliders'
        )
        offset += 86400000
        checkMemory()
        await pause()
        assert.ok(
          (await state()).tabs.every((tab) => !tab.sleeping && !tab.discarded),
          'zero timers must keep tabs live'
        )
        console.log(
          'PASS: preferences migration, independent exceptions, edited forms, seamless freeze/thaw, encrypted discard, disk failure safety, history/scroll/mute/zoom restoration, cache cleanup, Performance settings and zero-disable'
        )
      } finally {
        window.destroy()
        assert.ok(
          fs
            .readdirSync(path.join(profile, 'temp'))
            .every((name) => !name.startsWith('rei-tab-cache-')),
          'closing must clear cache'
        )
        store.close()
        server.closeAllConnections()
        await new Promise((resolve) => server.close(resolve))
      }
    })
    .then(() => app.exit(0))
    .catch((error) => {
      console.error(error)
      app.exit(1)
    })
}
