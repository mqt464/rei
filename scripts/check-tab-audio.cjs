const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const source = fs.readFileSync('src/renderer/src/Sidebar.svelte', 'utf8')
let mount, update
let now = 0
let timerId = 0
const timers = new Map()
const context = vm.createContext({
  activeDownloads: [],
  downloadTotal: 0,
  downloadReceived: 0,
  downloadProgress: null,
  downloadStatus: '',
  downloadLabel: '',
  exports: {},
  require: (name) =>
    name === 'svelte/reactivity'
      ? { SvelteMap: Map, SvelteSet: Set }
      : name === 'svelte'
        ? {
            onMount: (callback) => {
              mount = callback
            }
          }
        : { watchExtensions: () => () => {} },
  window: {
    api: {
      onDownloads: () => () => {},
      getDownloads: () => Promise.resolve([]),
      onPageFocus: () => () => {},
      onState: (callback) => {
        update = (tabs) => callback({ tabs })
        return () => {}
      }
    }
  },
  setTimeout: (callback, delay) => {
    timers.set(++timerId, { callback, at: now + delay })
    return timerId
  },
  clearTimeout: (timer) => timers.delete(timer)
})
vm.runInContext(
  ts.transpileModule(source.match(/<script lang="ts">([\s\S]*?)<\/script>/)[1], {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText,
  context
)
const cleanup = mount()
const visible = (id = 'one') =>
  vm.runInContext(
    `typeof audibleTabIds === 'undefined' ? tabs.some(tab => tab.id === '${id}' && tab.audible) : audibleTabIds.has('${id}')`,
    context
  )
function advance(milliseconds) {
  now += milliseconds
  for (const [timer, pending] of timers)
    if (pending.at <= now) {
      timers.delete(timer)
      pending.callback()
    }
}
update([{ id: 'one', audible: true }])
assert.ok(visible(), 'show immediately')
update([{ id: 'one', audible: false }])
advance(500)
assert.ok(visible(), 'stay visible through short silence')
update([{ id: 'one', audible: false }])
advance(500)
assert.ok(!visible(), 'hide after 1000ms; unrelated updates do not reset delay')
update([{ id: 'one', audible: true }])
update([{ id: 'one', audible: false }])
advance(500)
update([{ id: 'one', audible: true }])
advance(1000)
assert.ok(visible(), 'resumed audio cancels hide')
update([
  { id: 'one', audible: false },
  { id: 'two', audible: true }
])
advance(1000)
assert.ok(!visible() && visible('two'), 'independent indicators')
update([{ id: 'two', audible: false }])
update([])
assert.equal(timers.size, 0, 'closed tabs clear timers')
assert.ok(!visible('two'), 'closed tabs clear indicators')
update([{ id: 'one', audible: true }])
update([{ id: 'one', audible: false }])
cleanup()
assert.equal(timers.size, 0, 'unmount clears timers')
assert.ok(source.indexOf('class="tab-audio-space"') > source.indexOf('<SiteIcon src={tab.favicon}'))
assert.ok(source.indexOf('class="tab-audio-space"') < source.indexOf('<span class="tab-title"'))
console.log('Tab audio checks passed')
