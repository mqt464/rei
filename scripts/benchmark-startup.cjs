const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const { createHash } = require('node:crypto')
const buildRoot = path.resolve(
  process.argv.find((argument) => argument.startsWith('--build-root='))?.slice(13) ||
    path.join(__dirname, '../out')
)
const bundlePath = path.join(buildRoot, 'main/index.js')
const buildHash = () => createHash('sha256').update(fs.readFileSync(bundlePath)).digest('hex')

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process')
  const output = path.resolve(process.argv[2] || '.cache/startup/latest.json')
  const runs = Number(process.argv[3] || 5)
  const warmComparison = process.argv.includes('--warm-comparison')
  const startupBudget = Number(
    process.argv.find((argument) => argument.startsWith('--max-startup-ms='))?.slice(17) || Infinity
  )
  assert.ok(startupBudget > 0, 'startup budget must be positive')
  assert.ok(
    !warmComparison || !process.argv.includes('--baseline-startup'),
    'warm comparison selects its own baseline'
  )
  assert.ok(Number.isInteger(runs) && runs > 0 && runs <= 50, 'runs must be 1-50')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-startup-'))
  const samples = []
  const expectedHash = buildHash()
  try {
    for (let index = 0; index < runs; index++) {
      const profile = path.join(directory, `profile-${index}`)
      fs.mkdirSync(profile)
      const phases = warmComparison
        ? [
            'seed',
            'seed-repeat',
            ...(index % 2
              ? ['fixed-repeat', 'baseline-repeat']
              : ['baseline-repeat', 'fixed-repeat'])
          ]
        : ['fresh', 'repeat']
      for (const phase of phases) {
        const resultPath = path.join(directory, 'result.json')
        fs.rmSync(resultPath, { force: true })
        const env = {
          ...process.env,
          REI_STARTUP_PROFILE: profile,
          REI_STARTUP_RESULT: resultPath,
          REI_STARTUP_START: String(performance.timeOrigin + performance.now())
        }
        delete env.ELECTRON_RUN_AS_NODE
        delete env.ELECTRON_RENDERER_URL
        const arguments_ = [
          __filename,
          '--enable-features=ForceThirdPartyCookieBlockingEnabled,ThirdPartyStoragePartitioning',
          ...process.argv.slice(4)
        ]
        if (phase === 'baseline-repeat') arguments_.push('--baseline-startup')
        const result = spawnSync(require('electron'), arguments_, {
          env,
          encoding: 'utf8',
          timeout: 45000,
          windowsHide: true
        })
        if (result.error)
          throw new Error(`${result.error.message}\n${result.stderr}\n${result.stdout}`)
        assert.equal(result.status, 0, result.stderr || result.stdout)
        assert.ok(fs.existsSync(resultPath), 'startup must reach a visible, rendered window')
        const sample = { phase, run: index + 1, ...JSON.parse(fs.readFileSync(resultPath)) }
        assert.equal(sample.buildSha256, expectedHash, 'build changed during benchmark; rerun')
        assert.equal(sample.filteringReady, true, 'uBlock filtering must be ready at startup')
        assert.deepEqual(sample.extensionErrors, [], 'extensions must start without errors')
        samples.push(sample)
        console.log(`${phase} ${index + 1}: ${sample.marks['shell-ready'].toFixed(1)} ms`)
      }
    }
    const summary = {}
    for (const phase of new Set(samples.map((sample) => sample.phase))) {
      const selected = samples.filter((sample) => sample.phase === phase)
      summary[phase] = {}
      for (const key of new Set(selected.flatMap((sample) => Object.keys(sample.marks)))) {
        const values = selected
          .map((sample) => sample.marks[key])
          .filter(Number.isFinite)
          .sort((left, right) => left - right)
        const middle = Math.floor(values.length / 2)
        summary[phase][key] = {
          count: values.length,
          median: values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2,
          min: values[0],
          max: values.at(-1)
        }
      }
    }
    fs.mkdirSync(path.dirname(output), { recursive: true })
    fs.writeFileSync(
      output,
      JSON.stringify(
        {
          platform: process.platform,
          arch: process.arch,
          cpu: os.cpus()[0].model,
          versions: {
            node: process.versions.node,
            electron: require('electron/package.json').version
          },
          buildSha256: expectedHash,
          buildRoot,
          endpoint: 'Main window shown, shell did-finish-load, and renderer DOM verified',
          scope:
            'Production build; isolated blank profiles; bundled extensions enabled; OS caches not flushed',
          offline: process.argv.includes('--offline'),
          baselineStartup: process.argv.includes('--baseline-startup'),
          warmComparison,
          backgroundUnthrottled: process.argv.includes('--unthrottled-background'),
          traceBackground: process.argv.includes('--trace-background'),
          runs,
          summary,
          samples
        },
        null,
        2
      ) + '\n'
    )
    console.log(JSON.stringify(summary, null, 2))
    console.log(output)
    if (Number.isFinite(startupBudget))
      assert.ok(
        samples.every(
          (sample) =>
            sample.marks['shell-ready'] <= startupBudget &&
            Number.isFinite(sample.marks['extension-filtering-ready'])
        ),
        `startup exceeded ${startupBudget} ms or failed to confirm filtering before shell startup; see ${output}`
      )
  } finally {
    assert.equal(path.dirname(directory), os.tmpdir())
    assert.ok(path.basename(directory).startsWith('rei-startup-'))
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  }
} else {
  const { app, BaseWindow, dialog, webContents } = require('electron')
  const Module = require('node:module')
  app.setPath('userData', process.env.REI_STARTUP_PROFILE)
  if (process.argv.includes('--offline'))
    app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1')
  const marks = {}
  const mark = (name) => {
    marks[name] = performance.timeOrigin + performance.now() - Number(process.env.REI_STARTUP_START)
  }
  mark('electron-entry')
  const backgroundEvents = []
  app.on('web-contents-created', (_event, contents) => {
    if (
      !process.argv.includes('--trace-background') &&
      !process.argv.includes('--unthrottled-background')
    )
      return
    if (contents.getType() !== 'backgroundPage') return
    const record = (event) =>
      backgroundEvents.push({
        event,
        id: contents.id,
        elapsed: performance.timeOrigin + performance.now() - Number(process.env.REI_STARTUP_START),
        url: contents.getURL(),
        throttled: contents.getBackgroundThrottling()
      })
    record('created')
    const execute = contents.executeJavaScript.bind(contents)
    contents.executeJavaScript = (...arguments_) => {
      if (arguments_[0] !== 'globalThis.\u00b5Block?.readyToFilter === true')
        return execute(...arguments_)
      record('readiness-probe')
      return execute(...arguments_).then((ready) => {
        if (!contents.isDestroyed()) record(ready ? 'filtering-ready' : 'filtering-pending')
        return ready
      })
    }
    if (process.argv.includes('--unthrottled-background')) contents.setBackgroundThrottling(false)
    for (const event of ['dom-ready', 'did-finish-load', 'did-stop-loading'])
      contents.on(event, () => record(event))
  })
  app.whenReady().then(() => mark('app-ready'))
  dialog.showErrorBox = (title, content) => {
    console.error(title, content)
    app.exit(1)
  }
  const show = BaseWindow.prototype.show
  BaseWindow.prototype.show = function () {
    show.call(this)
    if (!marks['first-window-show']) mark('first-window-show')
  }
  globalThis.__reiStartupVisible = (chrome) => {
    mark('window-show')
    chrome
      .executeJavaScript(
        `new Promise(resolve => {
      const ready = () => document.querySelector('#app')?.children.length > 0;
      if (ready()) return resolve(true);
      const observer = new MutationObserver(() => {
        if (!ready()) return;
        observer.disconnect();
        resolve(true);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); resolve(false); }, 10000);
    })`
      )
      .then(async (rendered) => {
        assert.ok(rendered, 'browser chrome must contain rendered UI')
        mark('shell-ready')
        const extensions = JSON.parse(
          fs.readFileSync(path.join(app.getPath('userData'), 'extensions.json'))
        )
        const background = webContents
          .getAllWebContents()
          .find((contents) => contents.getURL().endsWith('/background.html'))
        const filteringReady =
          !!background &&
          (await background
            .executeJavaScript('globalThis.\u00b5Block?.readyToFilter === true')
            .catch(() => false))
        fs.writeFileSync(
          process.env.REI_STARTUP_RESULT,
          JSON.stringify({
            marks,
            backgroundEvents,
            buildSha256: buildHash(),
            filteringReady,
            extensionErrors: extensions.filter((entry) => entry.error).map((entry) => entry.error)
          })
        )
        app.quit()
      })
      .catch((error) => {
        console.error(error)
        app.exit(1)
      })
  }
  let source = fs.readFileSync(bundlePath, 'utf8')
  if (process.argv.includes('--baseline-startup')) {
    const sequence =
      /const extensions = new ExtensionRuntime\(\);\s*await Promise.all\(\[prepareUIStorage\(\), extensions.initialize\(\)\]\);/
    assert.ok(sequence.test(source))
    source = source.replace(
      sequence,
      'await prepareUIStorage(); const extensions = new ExtensionRuntime(); await extensions.initialize();'
    )
  }
  if (process.argv.includes('--baseline-startup')) {
    const gate = 'background && await background.executeJavaScript('
    assert.equal(source.split(gate).length, 2)
    source = source.replace(
      gate,
      'background && !background.isLoading() && await background.executeJavaScript('
    )
  }
  assert.equal(source.split('mainWindow.show();').length, 2)
  source = source.replace(
    'mainWindow.show();',
    'mainWindow.show(); globalThis.__reiStartupVisible(chrome);'
  )
  const needle = 'function createWindow('
  assert.equal(source.split(needle).length, 2, 'startup instrumentation must match exactly once')
  source = source.replace(
    needle,
    `
globalThis.__reiStartupMark('imports-ready');
const originalPrepareUIStorage = prepareUIStorage;
prepareUIStorage = async (...arguments_) => {
  globalThis.__reiStartupMark('storage-start');
  await originalPrepareUIStorage(...arguments_);
  globalThis.__reiStartupMark('storage-ready');
};
const originalInitialize = ExtensionRuntime.prototype.initialize;
const originalLoadExtension = ExtensionRuntime.prototype.loadExtension;
ExtensionRuntime.prototype.loadExtension = async function (entry) {
  globalThis.__reiStartupMark('extension-load-start');
  await originalLoadExtension.call(this, entry);
  globalThis.__reiStartupMark('extension-filtering-ready');
};
ExtensionRuntime.prototype.initialize = async function (...arguments_) {
  globalThis.__reiStartupMark('extensions-start');
  await originalInitialize.apply(this, arguments_);
  globalThis.__reiStartupMark('extensions-ready');
};
${needle}`
  )
  globalThis.__reiStartupMark = mark
  const entry = new Module(bundlePath, module)
  entry.filename = bundlePath
  entry.paths = Module._nodeModulePaths(path.dirname(bundlePath))
  entry._compile(source, bundlePath)
}
