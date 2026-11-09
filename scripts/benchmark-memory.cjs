const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const output = path.resolve(process.argv[2] || '.cache/memory/latest.json')
const extensionsEnabled = !process.argv.includes('--no-extensions')
const buildRoot = path.resolve(
  process.argv.find((argument) => argument.startsWith('--build-root='))?.slice(13) ||
    path.join(__dirname, '../out')
)
const rendererRoot = path.resolve(
  process.argv.find((argument) => argument.startsWith('--renderer-root='))?.slice(16) ||
    path.join(buildRoot, 'renderer')
)
if (process.argv.includes('--generate-wallpaper')) {
  assert.ok(process.versions.electron, 'wallpaper generation requires Electron')
  const { app, nativeImage } = require('electron')
  app.setPath('userData', process.env.REI_MEMORY_PROFILE)
  app
    .whenReady()
    .then(() => {
      const width = 3840
      const height = 2160
      const pixels = Buffer.alloc(width * height * 4)
      for (let row = 0; row < height; row++) {
        for (let column = 0; column < width; column++) {
          const offset = (row * width + column) * 4
          pixels[offset] = (column >>> 4) & 255
          pixels[offset + 1] = (row >>> 3) & 255
          pixels[offset + 2] = ((row + column) >>> 4) & 255
          pixels[offset + 3] = 255
        }
      }
      fs.writeFileSync(output, nativeImage.createFromBitmap(pixels, { width, height }).toPNG())
      app.quit()
    })
    .catch((error) => {
      console.error(error)
      app.exit(1)
    })
} else if (!process.versions.electron) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-memory-'))
  const env = { ...process.env, REI_MEMORY_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  try {
    if (process.argv.includes('--wallpaper')) {
      const fixture = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, path.join(profile, 'benchmark-wallpaper.png'), '--generate-wallpaper'],
        { env, stdio: 'inherit', timeout: 30000, windowsHide: true }
      )
      if (fixture.error) throw fixture.error
      assert.equal(fixture.status, 0, 'wallpaper fixture helper must succeed')
    }
    const result = require('node:child_process').spawnSync(
      require('electron'),
      [__filename, output, ...process.argv.slice(3)],
      { env, stdio: 'inherit', timeout: 180000, windowsHide: true }
    )
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
    if (result.status === 0 && process.argv.includes('--warm')) {
      const warm = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, output.replace(/\.json$/, '-warm.json'), ...process.argv.slice(3)],
        { env, stdio: 'inherit', timeout: 180000, windowsHide: true }
      )
      if (warm.error) throw warm.error
      process.exitCode = warm.status ?? 1
    }
  } finally {
    assert.equal(path.dirname(profile), os.tmpdir())
    assert.ok(path.basename(profile).startsWith('rei-memory-'))
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
} else {
  const { app, BaseWindow, webContents } = require('electron')
  const { createServer } = require('node:http')
  const Module = require('node:module')
  app.setPath('userData', process.env.REI_MEMORY_PROFILE)
  const bundlePath = path.join(buildRoot, 'main/index.js')
  const browserModule = new Module(bundlePath, module)
  browserModule.filename = bundlePath
  browserModule.paths = Module._nodeModulePaths(path.dirname(bundlePath))
  const bundle = fs.readFileSync(bundlePath, 'utf8')
  let source = bundle.split('function createWindow(')[0]
  const baselineInternal = process.argv.includes('--baseline-internal')
  if (baselineInternal) {
    const guard = 'if (tab.view.webContents.getURL())'
    assert.equal(source.split(guard).length, 2, 'baseline patch must match exactly once')
    source = source.replace(guard, '')
  }
  if (process.argv.includes('--lifecycle'))
    source = `const Date = class extends globalThis.Date { static now() { return globalThis.__reiMemoryNow ? globalThis.__reiMemoryNow() : super.now() } };\n${source}`
  browserModule._compile(
    `${source}\nmodule.exports = { attachBrowser, SearchStore, ExtensionRuntime, prepareUIStorage }`,
    bundlePath
  )
  const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  async function waitFor(check, message) {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      if (await check()) return
      await pause(25)
    }
    assert.fail(message)
  }
  const median = (values) =>
    [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)]
  app
    .whenReady()
    .then(async () => {
      const { attachBrowser, SearchStore, ExtensionRuntime, prepareUIStorage } =
        browserModule.exports
      fs.writeFileSync(
        path.join(app.getPath('userData'), 'preferences.json'),
        JSON.stringify({
          startup: 'newtab',
          newTabUrl: '',
          tabSleepMinutes: 0,
          tabDiscardMinutes: 0
        })
      )
      if (process.argv.includes('--wallpaper')) {
        const image = `data:image/png;base64,${fs.readFileSync(path.join(app.getPath('userData'), 'benchmark-wallpaper.png')).toString('base64')}`
        fs.writeFileSync(
          path.join(app.getPath('userData'), 'theme.json'),
          JSON.stringify({ wallpaper: image, wallpaperDither: true })
        )
      }
      const server = createServer((_request, response) => {
        response.setHeader('Content-Type', 'text/html')
        response.end(
          '<!doctype html><title>RAM fixture</title><input value="unchanged"><script>window.retained = Array.from({length:10000}, (_, index) => ({index, text:"fixture-"+index}));</script>Local benchmark page'
        )
      })
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
      const base = `http://127.0.0.1:${server.address().port}`
      await prepareUIStorage()
      const extensions = extensionsEnabled ? new ExtensionRuntime() : undefined
      if (extensions) await extensions.initialize()
      if (extensions)
        await waitFor(async () => {
          const background = webContents
            .getAllWebContents()
            .find((contents) => contents.getURL().endsWith('/background.html'))
          return (
            background && background.executeJavaScript('!!globalThis.\u00b5Block?.readyToFilter')
          )
        }, 'uBlock filtering ready')
      const store = new SearchStore(path.join(app.getPath('userData'), 'search.sqlite'))
      const window = new BaseWindow({ width: 900, height: 670, show: false })
      let offset = 0
      globalThis.__reiMemoryNow = () => Date.now() + offset
      const originalInterval = globalThis.setInterval
      let checkMemory
      globalThis.setInterval = (callback, milliseconds, ...args) => {
        if (milliseconds === 15000) checkMemory = callback
        return originalInterval(callback, milliseconds, ...args)
      }
      let chrome
      try {
        chrome = attachBrowser(window, store, extensions)
      } finally {
        globalThis.setInterval = originalInterval
      }
      if (!extensions) {
        for (const contents of [chrome, window.contentView.children[0].webContents])
          contents.ipc.handle('extensions:get', () => ({ extensions: [], error: '' }))
      }
      const stages = []
      const consoleProbes = []
      let startupMs
      let settingsOpenMs
      const read = (script) => chrome.executeJavaScript(script)
      try {
        const startup = performance.now()
        await chrome.loadFile(path.join(rendererRoot, 'index.html'))
        window.show()
        await read('void window.api.onState(state => window.benchmarkState = state)')
        const state = () => read('window.benchmarkState')
        await waitFor(async () => (await state())?.tabs.length === 1, 'initial state')
        await waitFor(() => read('!!document.querySelector(".blank-page")'), 'new tab mounted')
        await waitFor(
          () =>
            window.contentView.children[0].webContents.executeJavaScript(
              '!!document.querySelector("aside")'
            ),
          'sidebar mounted'
        )
        startupMs = performance.now() - startup
        if (process.argv.includes('--wallpaper')) {
          try {
            await waitFor(
              () =>
                read(
                  'document.documentElement.style.getPropertyValue("--rei-wallpaper").startsWith("url(")'
                ),
              'dithered wallpaper rendered'
            )
          } catch (error) {
            console.error(
              'Wallpaper readiness diagnostic:',
              await read(`(async () => {
              const theme = await window.api.getTheme()
              const image = new Image()
              image.src = theme.wallpaper || ''
              let decoded = false
              try { await image.decode(); decoded = true } catch {}
              return { hash: location.hash, themeWallpaperLength: theme.wallpaper?.length,
                dither: theme.wallpaperDither, decoded, width: image.naturalWidth,
                cssLength: document.documentElement.style.getPropertyValue('--rei-wallpaper').length,
                motion: document.documentElement.dataset.motion }
            })()`)
            )
            throw error
          }
        }
        async function sample(name) {
          await pause(1800)
          const heaps = []
          for (const contents of webContents.getAllWebContents()) {
            if (!contents.getOSProcessId()) continue
            const attached = contents.debugger.isAttached()
            if (!attached) contents.debugger.attach('1.3')
            try {
              heaps.push({
                id: contents.id,
                pid: contents.getOSProcessId(),
                ...(await contents.debugger.sendCommand('Runtime.getHeapUsage')),
                ...(await contents.debugger.sendCommand('Memory.getDOMCounters'))
              })
            } finally {
              if (!attached) contents.debugger.detach()
            }
          }
          const samples = []
          for (let index = 0; index < 5; index++) {
            const metrics = app.getAppMetrics()
            const contents = webContents.getAllWebContents().map((contents) => ({
              id: contents.id,
              pid: contents.getOSProcessId(),
              role:
                contents === chrome
                  ? 'chrome'
                  : contents.getURL().includes('#tabs')
                    ? 'sidebar'
                    : contents.getURL().startsWith('chrome-extension:')
                      ? 'extension'
                      : contents.getURL().startsWith(base)
                        ? 'fixture'
                        : 'blank'
            }))
            samples.push({
              workingSetKiB: metrics.reduce((sum, metric) => sum + metric.memory.workingSetSize, 0),
              privateKiB: metrics.reduce(
                (sum, metric) => sum + (metric.memory.privateBytes ?? 0),
                0
              ),
              processes: metrics.map((metric) => ({
                pid: metric.pid,
                type: metric.type,
                name: metric.name,
                memory: metric.memory
              })),
              contents,
              systemMemory: process.getSystemMemoryInfo?.(),
              mainHeap: process.memoryUsage()
            })
            await pause(200)
          }
          const result = {
            name,
            tabs: (await state()).tabs.length,
            workingSetMiB: median(samples.map((sample) => sample.workingSetKiB)) / 1024,
            privateMiB: median(samples.map((sample) => sample.privateKiB)) / 1024,
            samples,
            heaps
          }
          if (['blank-1', 'idle-15s', 'settings', 'pages-closed'].includes(name)) {
            result.renderers = []
            for (const [role, contents] of [
              ['chrome', chrome],
              ['sidebar', window.contentView.children[0].webContents]
            ]) {
              const resources = []
              const listener = (_event, method, details) => {
                if (method === 'Debugger.scriptParsed') resources.push(details.url)
              }
              contents.debugger.attach('1.3')
              contents.debugger.on('message', listener)
              try {
                await contents.debugger.sendCommand('Debugger.enable')
              } finally {
                contents.debugger.off('message', listener)
                contents.debugger.detach()
              }
              const scripts = [...new Set(resources)]
                .filter((resource) => resource.startsWith('file:') && resource.endsWith('.js'))
                .map((resource) => {
                  const file = require('node:url').fileURLToPath(resource)
                  const text = fs.readFileSync(file, 'utf8')
                  return {
                    file: path.relative(rendererRoot, file),
                    bytes: Buffer.byteLength(text),
                    sha256: require('node:crypto').createHash('sha256').update(text).digest('hex'),
                    surfaces: ['App', 'Settings', 'Sidebar', 'ContextMenu', 'FindInPage'].filter(
                      (surface) =>
                        text.includes(`function ${surface}(`) &&
                        (surface !== 'Settings' || text.includes('settings-panel-'))
                    )
                  }
                })
              const layout = await contents.executeJavaScript(`(() => {
                const selectors = ['body', '.topbar', '.address-bar', '.blank-page', 'aside',
                  '.sidebar-footer', '.settings-layout', '.settings-sidebar', '.settings-content'];
                return selectors.map(selector => {
                  const element = document.querySelector(selector);
                  if (!element) return {selector};
                  const style = getComputedStyle(element);
                  const bounds = element.getBoundingClientRect();
                  return {selector, bounds: [bounds.x, bounds.y, bounds.width, bounds.height],
                    styles: Object.fromEntries(['display', 'color', 'backgroundColor', 'fontFamily',
                      'fontSize', 'padding', 'gap', 'borderRadius'].map(key => [key, style[key]]))};
                });
              })()`)
              const wallpaperLength = await contents.executeJavaScript(
                'document.documentElement.style.getPropertyValue("--rei-wallpaper").length'
              )
              result.renderers.push({ role, scripts, layout, wallpaperLength })
            }
          }
          stages.push(result)
          if (process.argv.includes('--assert-wallpaper-scope') && name === 'blank-1') {
            assert.ok(
              result.renderers.find((renderer) => renderer.role === 'chrome').wallpaperLength > 4
            )
            assert.equal(
              result.renderers.find((renderer) => renderer.role === 'sidebar').wallpaperLength,
              0,
              'sidebar must not render an invisible wallpaper'
            )
          }
          if (process.argv.includes('--assert-settings-lazy') && name === 'blank-1')
            for (const renderer of result.renderers)
              assert.ok(
                !renderer.scripts.some((script) => script.surfaces.includes('Settings')),
                `${renderer.role} eagerly loads settings`
              )
          if (process.argv.includes('--assert-ui-split') && name === 'blank-1') {
            for (const renderer of result.renderers) {
              const surfaces = renderer.scripts.flatMap((script) => script.surfaces)
              assert.ok(renderer.scripts.length > 0, 'loaded script inventory must not be empty')
              assert.ok(!surfaces.includes('ContextMenu'), `${renderer.role} eagerly loads menu`)
              assert.ok(!surfaces.includes('FindInPage'), `${renderer.role} eagerly loads find`)
              if (renderer.role === 'sidebar')
                assert.ok(!surfaces.includes('App'), 'sidebar eagerly loads browser UI')
            }
          }
          if (process.argv.includes('--capture') && ['blank-1', 'settings'].includes(name)) {
            result.captures = []
            for (const [role, contents] of [
              ['chrome', chrome],
              ['sidebar', window.contentView.children[0].webContents]
            ]) {
              await contents.executeJavaScript(
                'document.activeElement?.blur(); document.fonts.ready.then(() => true)'
              )
              let image
              try {
                image = await contents.capturePage()
              } catch (error) {
                result.captures.push({ role, error: error.message })
                continue
              }
              const file = output.replace(/\.json$/, `-${name}-${role}.png`)
              fs.mkdirSync(path.dirname(file), { recursive: true })
              fs.writeFileSync(file, image.toPNG())
              result.captures.push({
                role,
                file,
                size: image.getSize(),
                pixelSha256: require('node:crypto')
                  .createHash('sha256')
                  .update(image.toBitmap())
                  .digest('hex')
              })
            }
          }
          console.log(
            `${name}: private=${result.privateMiB.toFixed(1)} MiB working-set=${result.workingSetMiB.toFixed(1)} MiB contents=${samples[0].contents.length} processes=${samples[0].processes.length}`
          )
        }
        async function addTab(url) {
          const previous = (await state()).tabs.map((tab) => tab.id)
          await read('window.api.newTab()')
          await waitFor(async () => {
            const current = await state()
            return (
              current.tabs.length === previous.length + 1 && !previous.includes(current.activeTabId)
            )
          }, 'new tab created and selected')
          const id = (await state()).activeTabId
          if (url) {
            await read(`window.api.navigate(${JSON.stringify(url)})`)
            await waitFor(async () => {
              const current = await state()
              const active = current.tabs.find((tab) => tab.id === current.activeTabId)
              const contents = webContents.fromId(current.activeWebContentsId)
              return (
                active.id === id &&
                active.url === url &&
                !active.loading &&
                contents?.getURL() === url &&
                !contents.isLoadingMainFrame() &&
                contents.getTitle() === 'RAM fixture'
              )
            }, 'fixture navigation')
          }
        }
        async function closeExtras() {
          for (const tab of (await state()).tabs.slice(1))
            await read(`window.api.closeTab(${JSON.stringify(tab.id)})`)
          await waitFor(async () => (await state()).tabs.length === 1, 'tabs closed')
          await waitFor(
            () =>
              !webContents
                .getAllWebContents()
                .some((contents) => contents.getURL().startsWith(base)),
            'website WebContents destroyed'
          )
        }
        if (process.argv.includes('--settle')) await pause(65000)
        await sample('blank-1')
        if (process.argv.includes('--idle')) {
          await pause(15000)
          await sample('idle-15s')
        }
        if (process.argv.includes('--console-probe')) {
          for (const contents of webContents.getAllWebContents()) {
            if (!contents.getURL().startsWith('chrome-extension:')) continue
            contents.debugger.attach('1.3')
            const counts = { messages: 0, objects: 0, bridgeMessages: 0 }
            const listener = (_event, method, details) => {
              if (method !== 'Runtime.consoleAPICalled') return
              counts.messages++
              counts.objects += details.args.filter((argument) => argument.objectId).length
              if (/^(tabs|windows|webNavigation|webRequest|runtime)\./.test(details.args[0]?.value))
                counts.bridgeMessages++
            }
            contents.debugger.on('message', listener)
            try {
              await contents.debugger.sendCommand('Runtime.enable')
              await contents.debugger.sendCommand('HeapProfiler.collectGarbage')
              const before = await contents.debugger.sendCommand('Runtime.getHeapUsage')
              await contents.debugger.sendCommand('Runtime.discardConsoleEntries')
              await contents.debugger.sendCommand('HeapProfiler.collectGarbage')
              const after = await contents.debugger.sendCommand('Runtime.getHeapUsage')
              consoleProbes.push({ id: contents.id, counts, before, after })
            } finally {
              contents.debugger.off('message', listener)
              contents.debugger.detach()
            }
          }
          console.log('Console retention probe:', JSON.stringify(consoleProbes))
        }
        for (let index = 0; index < 9; index++) await addTab()
        await sample('blank-10')
        if (extensions) {
          const background = webContents
            .getAllWebContents()
            .find((contents) => contents.getURL().endsWith('/background.html'))
          const extensionTabs = await background.executeJavaScript(
            'chrome.tabs.query({}).then(tabs => tabs.map(tab => tab.id))'
          )
          const blanks = webContents.getAllWebContents().filter((contents) => !contents.getURL())
          assert.equal(blanks.length, 10)
          assert.ok(
            blanks.every((contents) => extensionTabs.includes(contents.id)),
            'extensions must still enumerate every blank tab'
          )
        }
        await closeExtras()
        await sample('blank-closed')
        const settingsStart = performance.now()
        await read('window.api.navigate("rei://settings")')
        await waitFor(
          async () => (await state()).tabs[0].url === 'rei://settings',
          'settings opened'
        )
        await waitFor(() => read('!!document.querySelector(".settings-page")'), 'settings mounted')
        settingsOpenMs = performance.now() - settingsStart
        await sample('settings')
        for (let index = 0; index < 9; index++) await addTab(`${base}/page-${index}`)
        await sample('pages-9')
        const fixtures = webContents
          .getAllWebContents()
          .filter((contents) => contents.getURL().startsWith(base))
        assert.equal(fixtures.length, 9)
        assert.equal(await fixtures[0].executeJavaScript('window.retained.length'), 10000)
        if (process.argv.includes('--lifecycle')) {
          assert.equal(typeof checkMemory, 'function')
          await read('window.api.setPreferences({tabSleepMinutes:1,tabDiscardMinutes:0})')
          offset += 61000
          checkMemory()
          await waitFor(
            async () => (await state()).tabs.filter((tab) => tab.sleeping).length === 8,
            'eight background pages frozen'
          )
          await sample('pages-8-frozen')
          await read('window.api.setPreferences({tabSleepMinutes:0,tabDiscardMinutes:1})')
          checkMemory()
          await waitFor(
            async () => (await state()).tabs.filter((tab) => tab.discarded).length === 8,
            'eight background pages discarded'
          )
          await sample('pages-8-discarded')
          const restore = (await state()).tabs.find((tab) => tab.discarded)
          await read(`window.api.switchTab(${JSON.stringify(restore.id)})`)
          await waitFor(async () => {
            const tab = (await state()).tabs.find((tab) => tab.id === restore.id)
            return !tab.discarded && !tab.loading
          }, 'discarded page restored')
          const restored = webContents
            .getAllWebContents()
            .find((contents) => contents.getURL() === restore.url)
          assert.equal(await restored.executeJavaScript('window.retained.length'), 10000)
          await sample('page-restored')
          await read('window.api.setPreferences({tabSleepMinutes:0,tabDiscardMinutes:0})')
        }
        await closeExtras()
        await sample('pages-closed')
        if (process.argv.includes('--cycles')) {
          for (let cycle = 1; cycle <= 3; cycle++) {
            for (let index = 0; index < 9; index++) await addTab(`${base}/cycle-${cycle}-${index}`)
            await closeExtras()
            await sample(`cycle-${cycle}-closed`)
          }
        }
        if (process.argv.includes('--gc')) {
          for (const contents of webContents.getAllWebContents()) {
            if (!contents.getOSProcessId()) continue
            contents.debugger.attach('1.3')
            try {
              await contents.debugger.sendCommand('HeapProfiler.collectGarbage')
            } finally {
              contents.debugger.detach()
            }
          }
          await sample('diagnostic-after-gc')
        }
        if (process.argv.includes('--assert-internal')) {
          for (const name of ['blank-1', 'blank-10', 'settings']) {
            assert.ok(
              stages
                .find((stage) => stage.name === name)
                .samples.every((sample) =>
                  sample.contents
                    .filter((contents) => contents.role === 'blank')
                    .every((contents) => contents.pid === 0)
                ),
              'new blank and internal tabs must not launch website renderers'
            )
            assert.equal(
              stages
                .find((stage) => stage.name === name)
                .samples[0].contents.filter((contents) => contents.role === 'blank').length,
              stages.find((stage) => stage.name === name).tabs,
              'blank and internal tab placeholders must remain available'
            )
          }
        }
      } finally {
        const wallpaperOutputs = []
        if (process.argv.includes('--wallpaper'))
          for (const [role, contents] of [
            ['chrome', chrome],
            ['sidebar', window.contentView.children[0].webContents]
          ]) {
            const image = await contents.executeJavaScript(
              'document.documentElement.style.getPropertyValue("--rei-wallpaper")'
            )
            wallpaperOutputs.push({
              role,
              length: image.length,
              sha256: require('node:crypto').createHash('sha256').update(image).digest('hex')
            })
          }
        fs.mkdirSync(path.dirname(output), { recursive: true })
        fs.writeFileSync(
          output,
          JSON.stringify(
            {
              timestamp: new Date().toISOString(),
              platform: process.platform,
              architecture: process.arch,
              cpu: os.cpus()[0].model,
              totalMemory: os.totalmem(),
              versions: process.versions,
              bundleSha256: require('node:crypto')
                .createHash('sha256')
                .update(bundle)
                .digest('hex'),
              baselineInternal,
              extensionsEnabled,
              settled: process.argv.includes('--settle'),
              options: process.argv.slice(3),
              fixture: '9 same-origin local pages, 10000 retained objects each',
              startupMs,
              settingsOpenMs,
              rendererRoot,
              buildRoot,
              wallpaperOutputs,
              wallpaperGeneration: process.argv.includes('--wallpaper')
                ? 'separate helper process'
                : undefined,
              consoleProbes,
              stages
            },
            null,
            2
          )
        )
        window.destroy()
        store.close()
        await new Promise((resolve) => server.close(resolve))
      }
      app.quit()
    })
    .catch((error) => {
      console.error(error)
      app.exit(1)
    })
}
