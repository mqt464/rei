const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function load(source, globals = {}) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const context = vm.createContext({ exports: {}, ...globals })
  vm.runInContext(compiled, context)
  return context.exports
}

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
}

const { defaultTheme, parseTheme } = load(read('src/shared/theme.ts'))
const { textMorphCategories, textMorphOptions } = load(read('src/shared/textMorph.ts'))
const restored = parseTheme(JSON.parse(JSON.stringify({ fontSize: 14 })))
assert.equal(restored.textMorphing, true)
assert.equal(restored.textMorphStyle, 'balanced')
assert.equal(restored.fontSize, 14)
assert.equal(parseTheme({ textMorphing: false }).textMorphing, false)
assert.throws(() => parseTheme({ textMorphing: 'yes' }))
assert.throws(() => parseTheme({ textMorphStyle: 'bouncy' }))
for (const { key } of textMorphCategories) {
  assert.equal(restored[key], true)
  assert.equal(parseTheme({ [key]: false })[key], false)
  assert.throws(() => parseTheme({ [key]: 1 }))
  assert.equal(textMorphOptions({ ...defaultTheme, [key]: false }, 'counter', key).disabled, true)
}
for (const style of ['subtle', 'balanced', 'expressive']) {
  const persisted = parseTheme(JSON.parse(JSON.stringify({ textMorphStyle: style })))
  assert.equal(persisted.textMorphStyle, style)
  for (const preset of ['counter', 'status', 'action', 'title']) {
    const options = textMorphOptions(persisted, preset, 'textMorphCounters')
    assert.equal(options.disabled, false)
    assert.equal(options.numbers, preset === 'counter')
    assert.equal(options.scale, preset === 'action' && style !== 'subtle')
    assert.equal(
      typeof options.ease,
      preset === 'action' && style !== 'subtle' ? 'object' : 'string'
    )
    assert.equal(options.respectReducedMotion, true)
    for (const motion of ['reduced', 'none'])
      assert.equal(
        textMorphOptions({ ...persisted, motion }, preset, 'textMorphCounters').disabled,
        true
      )
    assert.equal(textMorphOptions(persisted, preset, 'textMorphCounters', true).disabled, true)
    assert.equal(
      textMorphOptions({ ...persisted, textMorphing: false }, preset, 'textMorphCounters').disabled,
      true
    )
  }
}
const normal = textMorphOptions(defaultTheme, 'counter', 'textMorphCounters')
const fast = textMorphOptions(
  { ...defaultTheme, animationSpeed: 200 },
  'counter',
  'textMorphCounters'
)
assert.equal(fast.duration, normal.duration / 2)
const spring = textMorphOptions(defaultTheme, 'action', 'textMorphActions').ease
const fastSpring = textMorphOptions(
  { ...defaultTheme, animationSpeed: 200 },
  'action',
  'textMorphActions'
).ease
assert.equal(fastSpring.stiffness, spring.stiffness * 4)
assert.equal(fastSpring.damping, spring.damping * 2)

const component = read('src/renderer/src/components/Morph.svelte')
const script = component.match(/<script lang="ts">([\s\S]*?)<\/script>/)[1]
const parsed = ts.createSourceFile('Morph.ts', script, ts.ScriptTarget.Latest, true)
const actionSource = parsed.statements
  .find((node) => ts.isFunctionDeclaration(node) && node.name.text === 'morph')
  .getText(parsed)
let now = 0
let nextTimer = 0
let resize
let disconnected = false
const timers = new Map()
const instances = []
class MockMorph {
  constructor(options) {
    this.options = options
    this.updates = []
    instances.push(this)
  }
  update(text) {
    this.updates.push(text)
    this.options.element.textContent = text
    this.options.element.scrollWidth = text.length * 8
  }
  destroy() {
    this.destroyed = true
  }
}
const { morph } = load(`export ${actionSource}`, {
  TextMorph: MockMorph,
  performance: { now: () => now },
  setTimeout: (callback) => {
    timers.set(++nextTimer, callback)
    return nextTimer
  },
  clearTimeout: (id) => timers.delete(id),
  ResizeObserver: class {
    constructor(callback) {
      this.callback = callback
      resize = callback
    }
    observe(target) {
      this.target = target
    }
    disconnect() {
      disconnected = true
    }
  }
})
const node = { textContent: '', scrollWidth: 0, parentElement: { clientWidth: 1000 } }
const args = { text: '100', options: normal, throttle: 200 }
const action = morph(node, args)
assert.equal(node.textContent, '100')
assert.equal(instances.length, 1)
action.update({ ...args, text: '101' })
action.update({ ...args, text: '102' })
assert.equal(timers.size, 1)
assert.equal(node.textContent, '100')
now = 200
Array.from(timers.values())[0]()
assert.equal(timers.size, 0)
assert.equal(node.textContent, '102')
action.update({ ...args, text: '103' })
action.update({ ...args, text: '104', options: { ...normal, disabled: true } })
assert.equal(node.textContent, '104')
assert.equal(timers.size, 0)
assert.equal(instances[0].destroyed, true)
action.update({ ...args, text: '', throttle: 0 })
assert.deepEqual(Array.from(instances.at(-1).updates), ['\u200b', ''])
action.update({ ...args, text: 'Saved', throttle: 0 })
assert.equal(instances.at(-1).updates.at(-1), 'Saved')
node.parentElement.clientWidth = 10
resize()
assert.equal(node.textContent, 'Saved')
assert.equal(instances.at(-1).destroyed, true)
action.update({ ...args, text: 'A'.repeat(161), throttle: 0 })
assert.equal(node.textContent, 'A'.repeat(161))
assert.equal(instances.length, 2)
node.parentElement.clientWidth = 1000
action.update({ ...args, text: '105', throttle: 0 })
action.update({ ...args, text: '106' })
assert.equal(timers.size, 1)
action.destroy()
assert.equal(timers.size, 0)
assert.equal(instances.at(-1).destroyed, true)
assert.equal(disconnected, true)
console.log(
  'Text morph checks passed: theme validation, presets, motion, speed, throttling, overflow, and cleanup.'
)
