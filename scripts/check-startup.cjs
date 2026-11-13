const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '../src/main/index.ts'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText

function pending() {
  let resolve
  let reject
  const promise = new Promise((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}

async function check(first, fail = false) {
  const storage = pending()
  const extensions = pending()
  const events = []
  const app = Object.assign(new EventEmitter(), {
    whenReady: async () => {},
    getPath: () => '/isolated-startup-test',
    setAppUserModelId: () => {},
    quit: () => events.push('quit')
  })
  const modules = {
    electron: { app, dialog: { showErrorBox: () => events.push('error') } },
    path,
    'node:fs': { mkdirSync: () => {} },
    '@electron-toolkit/utils': { is: { dev: false } },
    './browser': {},
    './cookie-protection': { configureCookieProtection: () => true },
    './search-store': {
      SearchStore: class {
        close() {
          events.push('store-close')
        }
      }
    },
    './extensions': {
      setExtensionDoNotTrack: () => {},
      ExtensionRuntime: class {
        initialize() {
          events.push('extensions-start')
          return extensions.promise
        }
      }
    },
    './preferences': { currentPreferences: () => ({}) },
    './ui-storage': {
      prepareUIStorage: () => {
        events.push('storage-start')
        return storage.promise
      }
    },
    './updates': { initializeUpdates: () => events.push('updates') },
    './default-browser': {
      startLinkRouting: () => true,
      finishLinkRouting: () => events.push('window')
    }
  }
  const context = vm.createContext({
    exports: {},
    process: { platform: 'win32', env: {} },
    require: (name) => {
      if (name.endsWith('?asset')) return { default: 'icon' }
      assert.ok(Object.hasOwn(modules, name), `unexpected startup dependency: ${name}`)
      return modules[name]
    }
  })
  vm.runInContext(compiled, context)
  const tick = () => new Promise(setImmediate)
  await tick()
  assert.ok(events.includes('storage-start'), 'storage migration must start')
  assert.ok(
    events.includes('extensions-start'),
    'extensions must start without waiting for storage'
  )
  assert.ok(!events.includes('window'), 'do not expose startup pages before initialization')
  const leading = first === 'storage' ? storage : extensions
  const trailing = first === 'storage' ? extensions : storage
  if (fail) leading.reject(new Error('Startup fixture failure'))
  else leading.resolve()
  await tick()
  assert.ok(!events.includes('window'), 'both startup tasks must finish before opening pages')
  trailing.resolve()
  await tick()
  if (fail) assert.deepEqual(events.slice(-2), ['error', 'quit'])
  else assert.deepEqual(events.slice(-2), ['window', 'updates'])
}

async function main() {
  await check('storage')
  await check('extensions')
  await check('storage', true)
  await check('extensions', true)
  console.log('Startup concurrency and readiness contracts passed.')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
