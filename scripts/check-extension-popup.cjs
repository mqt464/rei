const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const ts = require('typescript')

const noop = () => undefined
const extensionSession = Object.assign(new EventEmitter(), {
  extensions: new EventEmitter(),
  unregisterPreloadScript: noop,
  registerPreloadScript: noop
})
class ExtensionAPI extends EventEmitter {
  static handleCRXProtocol = noop
}
const electron = {
  app: Object.assign(new EventEmitter(), { getPath: () => __dirname }),
  session: { defaultSession: extensionSession, fromPartition: () => extensionSession },
  screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) }
}
const source = fs.readFileSync(path.join(__dirname, '../src/main/extensions.ts'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const context = vm.createContext({
  exports: {},
  __dirname,
  require(name) {
    if (name === 'electron') return electron
    if (name === 'electron-chrome-extensions')
      return { ElectronChromeExtensions: ExtensionAPI, setSessionPartitionResolver: noop }
    if (name === 'electron-chrome-web-store') return {}
    if (name === './extension-compatibility') return { installExtensionCompatibility: noop }
    if (name === './extension-proxy') return { ExtensionProxy: class {} }
    if (name === '../shared/extension-permissions') return {}
    if (name === '../shared/privacy') return { cleanTrackingUrl: (value) => value }
    return require(name)
  }
})
vm.runInContext(compiled, context)
const runtime = new context.exports.ExtensionRuntime()

for (const origin of [
  { x: 2100, y: 140 },
  { x: -1500, y: 140 },
  { x: 140, y: -1100 },
  { x: 140, y: 1200 },
  { x: 140, y: 140 }
]) {
  let area = { ...origin, width: 900, height: 700 }
  let bounds = { x: 500, y: 200, width: 320, height: 400 }
  let destroyed = false
  const popup = Object.assign(new EventEmitter(), {
    parent: { getContentBounds: () => area, isDestroyed: () => destroyed },
    browserWindow: { getBounds: () => bounds, isDestroyed: () => false }
  })
  runtime.api.emit('browser-action-popup-created', popup)
  const position = { x: area.x + 16, y: area.y + area.height - 40 }
  popup.emit('will-move', position)
  assert.deepEqual(position, { x: area.x + 16, y: area.y + area.height - bounds.height })
  const outside = { x: area.x - 300, y: area.y - 200 }
  popup.emit('will-move', outside)
  assert.deepEqual(outside, { x: area.x, y: area.y })
  area = { ...origin, width: 280, height: 260 }
  const size = { width: 800, height: 600 }
  popup.emit('will-resize', size)
  assert.deepEqual(size, { width: 280, height: 260 })
  bounds = { ...bounds, ...size }
  const placeholder = { width: 25, height: 25 }
  popup.emit('will-resize', placeholder)
  assert.deepEqual(placeholder, size)
  const resizedPosition = { x: area.x + 100, y: area.y + 100 }
  popup.emit('will-move', resizedPosition)
  assert.deepEqual(resizedPosition, { x: area.x, y: area.y })
  destroyed = true
  const unchanged = { x: 123, y: 456 }
  popup.emit('will-move', unchanged)
  assert.deepEqual(unchanged, { x: 123, y: 456 })
}
console.log('PASS: extension popups stay inside their host on every monitor and after resizing')
