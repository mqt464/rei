const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const ts = require('typescript')

const ipcRenderer = new EventEmitter()
const sent = []
ipcRenderer.send = (...args) => sent.push(args)
const exposed = {}
const context = vm.createContext({
  location: { hash: '#find' },
  process: { argv: [], contextIsolated: true },
  console
})
function load(file) {
  const exports = {}
  const source = fs.readFileSync(file, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const requireModule = (name) => {
    if (name === 'electron')
      return {
        ipcRenderer,
        contextBridge: { exposeInMainWorld: (key, value) => (exposed[key] = value) }
      }
    if (name === 'electron-chrome-extensions/browser-action') return {}
    if (name === '@electron-toolkit/preload') return { electronAPI: {} }
    if (name === './keyboard') return { setKeybindCapture: () => undefined }
    assert.ok(name.startsWith('./'), `Unexpected dependency: ${name}`)
    return load(path.resolve(path.dirname(file), `${name}.ts`))
  }
  vm.compileFunction(compiled, ['exports', 'require'], { parsingContext: context })(
    exports,
    requireModule
  )
  return exports
}
load(path.resolve(__dirname, '../src/preload/index.ts'))

const valueEvents = {
  onUpdates: 'updates:changed',
  onCommands: 'commands:changed',
  onDownloads: 'downloads:changed',
  onFindState: 'find:state',
  onExtensions: 'extensions:changed',
  onContextMenu: 'context-menu:changed',
  onPreferences: 'preferences:changed',
  onThemeError: 'theme:error',
  onTheme: 'theme:changed',
  onShortcuts: 'site-search:changed',
  onShortcutsError: 'site-search:error',
  onSearchUpdate: 'browser:search-update',
  onTopbarHover: 'browser:topbar-hover',
  onState: 'browser:state'
}
const signalEvents = {
  onWebsitePermissions: 'website-permissions:changed',
  onHistory: 'history:changed',
  onFocusFind: 'find:focus',
  onSearchDataCleared: 'browser:search-data-cleared',
  onFocusAddress: 'browser:focus-address',
  onPageFocus: 'browser:page-focus'
}
const api = exposed.api
assert.deepEqual(
  Object.keys(api)
    .filter((name) => name.startsWith('on'))
    .sort(),
  [...Object.keys(valueEvents), ...Object.keys(signalEvents)].sort()
)
const event = { sender: 'must not reach renderer callbacks' }
const payload = { value: 'payload identity must survive' }
for (const [name, channel] of Object.entries({ ...valueEvents, ...signalEvents })) {
  const calls = []
  const callback = (...args) => calls.push(args)
  const unsubscribe = api[name](callback)
  const unsubscribeSecond = api[name](callback)
  assert.equal(ipcRenderer.listenerCount(channel), 2, `${name}: independent listeners`)
  ipcRenderer.emit(channel, event, payload, 'extra argument must not leak')
  assert.equal(calls.length, 2, name)
  for (const args of calls) {
    assert.equal(args.length, name in signalEvents ? 0 : 1, `${name}: callback arity`)
    if (name in valueEvents) assert.equal(args[0], payload, `${name}: payload identity`)
  }
  unsubscribe()
  unsubscribe()
  calls.length = 0
  ipcRenderer.emit(channel, event, false)
  assert.equal(calls.length, 1, `${name}: removing one listener leaves the other`)
  if (name in valueEvents) assert.equal(calls[0][0], false, `${name}: falsy payload`)
  unsubscribeSecond()
  assert.equal(ipcRenderer.listenerCount(channel), 0, `${name}: no leaked listeners`)
}
assert.deepEqual(sent, [['browser:ready'], ['browser:ready']])
ipcRenderer.send = (channel) => {
  assert.equal(channel, 'browser:ready')
  assert.equal(ipcRenderer.listenerCount('browser:state'), 1, 'Subscribe before ready')
  ipcRenderer.emit('browser:state', event, payload)
}
let initialState
const unsubscribe = api.onState((state) => (initialState = state))
assert.equal(initialState, payload, 'Synchronous initial state must not be lost')
unsubscribe()
context.window = {}
context.process.contextIsolated = false
load(path.resolve(__dirname, '../src/preload/index.ts'))
assert.deepEqual(Object.keys(context.window.api), Object.keys(api))
let fallbackState
const unsubscribeFallback = context.window.api.onState((state) => (fallbackState = state))
assert.equal(fallbackState, payload, 'Non-isolated fallback must preserve subscriptions')
unsubscribeFallback()
console.log('Preload event contracts passed.')
