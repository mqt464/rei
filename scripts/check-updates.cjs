const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const ts = require('typescript')

function compile(file, require, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const context = vm.createContext({ exports: {}, require, ...globals })
  vm.runInContext(compiled, context)
  return context.exports
}

function setup({ packaged = true, platform = 'win32', appImage = false } = {}) {
  const updater = new EventEmitter()
  let checks = 0
  let installs = 0
  let response = 1
  let automatic = true
  let check = async () => {
    updater.emit('update-not-available')
    return {}
  }
  updater.checkForUpdates = () => {
    checks += 1
    return check()
  }
  updater.quitAndInstall = (...args) => {
    assert.deepEqual(args, [false, true])
    installs += 1
  }
  const app = Object.assign(new EventEmitter(), { isPackaged: packaged, getVersion: () => '1.0.0' })
  const dialog = {
    showMessageBox: async (_window, options) => {
      assert.equal(options.cancelId, 1)
      assert.equal(options.defaultId, 1)
      assert.match(options.detail, /Save your work/)
      return { response }
    }
  }
  const timers = []
  const timer = (callback, delay) => {
    const entry = {
      callback,
      delay,
      unref() {
        return this
      }
    }
    timers.push(entry)
    return entry
  }
  const cleared = []
  const api = compile(
    'src/main/updates.ts',
    (name) => {
      if (name === 'electron') return { app, dialog }
      if (name === 'electron-updater') return { autoUpdater: updater }
      if (name === './preferences')
        return { currentPreferences: () => ({ automaticUpdates: automatic }) }
      throw new Error(`Unexpected import: ${name}`)
    },
    {
      process: { platform, env: appImage ? { APPIMAGE: '/tmp/rei.AppImage' } : {} },
      setTimeout: timer,
      setInterval: timer,
      clearTimeout: (entry) => cleared.push(entry),
      clearInterval: (entry) => cleared.push(entry)
    }
  )
  const handlers = new Map()
  const sent = []
  const contents = Object.assign(new EventEmitter(), {
    ipc: { handle: (name, handler) => handlers.set(name, handler) },
    isDestroyed: () => false,
    send: (name, state) => sent.push({ name, state })
  })
  api.initializeUpdates()
  api.registerUpdates(contents, { isDestroyed: () => false }, (event) => event.trusted)
  const invoke = (name, trusted = true) => handlers.get(`updates:${name}`)({ trusted })
  return {
    updater,
    isInstallingUpdate: api.isInstallingUpdate,
    app,
    contents,
    sent,
    timers,
    cleared,
    invoke,
    get checks() {
      return checks
    },
    get installs() {
      return installs
    },
    set response(value) {
      response = value
    },
    set automatic(value) {
      automatic = value
    },
    set check(value) {
      check = value
    }
  }
}

async function main() {
  const keyboard = compile('src/shared/keyboard.ts', require)
  const { parsePreferences } = compile('src/shared/preferences.ts', () => keyboard)
  assert.equal(parsePreferences({}).automaticUpdates, true)
  assert.equal(parsePreferences({ automaticUpdates: false }).automaticUpdates, false)
  assert.throws(() => parsePreferences({ automaticUpdates: 'true' }))

  for (const options of [{ packaged: false }, { platform: 'linux' }]) {
    const test = setup(options)
    assert.equal(test.invoke('get').status, 'unsupported')
    await test.invoke('check')
    assert.equal(test.checks, 0)
    assert.equal(test.timers.length, 0)
  }
  for (const options of [{ platform: 'darwin' }, { platform: 'linux', appImage: true }])
    assert.equal(setup(options).invoke('get').status, 'idle')

  const test = setup()
  assert.equal(test.updater.autoInstallOnAppQuit, false)
  assert.equal(test.updater.autoDownload, true)
  assert.equal(test.updater.allowPrerelease, false)
  assert.equal(test.updater.allowDowngrade, false)
  for (const name of ['get', 'check'])
    assert.throws(() => test.invoke(name, false), /access denied/)
  await assert.rejects(test.invoke('install', false), /access denied/)
  await test.invoke('install')
  assert.equal(test.installs, 0)
  assert.equal((await test.invoke('check')).status, 'current')

  test.check = async () => {
    throw new Error('offline')
  }
  assert.equal((await test.invoke('check')).status, 'error')
  assert.match(test.invoke('get').message, /connection/)
  test.check = async () => ({ downloadPromise: Promise.reject(new Error('checksum mismatch')) })
  assert.equal((await test.invoke('check')).status, 'error')

  let finish
  test.check = async () => {
    test.updater.emit('update-available', { version: '1.1.0' })
    return {
      downloadPromise: new Promise((resolve) => {
        finish = resolve
      })
    }
  }
  const downloading = test.invoke('check')
  await Promise.resolve()
  const previousChecks = test.checks
  await test.invoke('check')
  assert.equal(test.checks, previousChecks, 'overlapping checks must coalesce')
  assert.equal(test.invoke('get').status, 'available')
  test.updater.emit('download-progress', { percent: 38.9 })
  assert.equal(test.invoke('get').progress, 38)
  const previousEvents = test.sent.length
  test.updater.emit('download-progress', { percent: 38.95 })
  assert.equal(test.sent.length, previousEvents, 'progress must be throttled to whole percentages')
  test.updater.emit('update-downloaded', { version: '1.1.0' })
  finish([])
  assert.equal((await downloading).status, 'ready')
  assert.equal(test.invoke('get').progress, 100)
  await test.invoke('check')
  assert.equal(test.checks, previousChecks, 'ready updates must not be replaced by new checks')
  await test.invoke('install')
  assert.equal(test.installs, 0, 'cancel must not install')
  assert.equal(test.isInstallingUpdate(), false)
  test.response = 0
  await test.invoke('install')
  assert.equal(test.installs, 1)
  assert.equal(
    test.isInstallingUpdate(),
    true,
    'confirmed update must bypass the normal tab-close prompt'
  )
  await test.invoke('install')
  assert.equal(test.installs, 1, 'installation must not start twice')
  test.updater.emit('error', new Error('installer failed'))
  assert.equal(
    test.isInstallingUpdate(),
    false,
    'installer failure must restore normal close confirmation'
  )

  const scheduled = setup()
  assert.deepEqual(
    scheduled.timers.map((entry) => entry.delay),
    [15_000, 21_600_000]
  )
  scheduled.automatic = false
  scheduled.timers[0].callback()
  scheduled.timers[1].callback()
  assert.equal(scheduled.checks, 0)
  scheduled.automatic = true
  scheduled.timers[1].callback()
  await Promise.resolve()
  assert.equal(scheduled.checks, 1)
  scheduled.app.emit('will-quit')
  assert.equal(scheduled.cleared.length, 2)
  scheduled.contents.emit('destroyed')
  const previousSent = scheduled.sent.length
  scheduled.updater.emit('error', new Error('offline'))
  assert.equal(scheduled.sent.length, previousSent)
  console.log(
    'PASS: updater preferences, platform gates, trusted IPC, checks, retries, progress, download completion, confirmed install, scheduling and cleanup'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
