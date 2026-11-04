const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const source = fs.readFileSync(
  require('node:path').join(__dirname, '../src/shared/keyboard.ts'),
  'utf8'
)
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
})
const keyboard = {}
new Function('exports', compiled.outputText)(keyboard)
const { defaultKeybindings, parseKeybindings, keyStroke, createKeybindMatcher } = keyboard
const input = (key, modifiers = {}) => ({
  key,
  control: false,
  meta: false,
  alt: false,
  shift: false,
  ...modifiers
})
assert.deepEqual(parseKeybindings({}), defaultKeybindings)
assert.deepEqual(defaultKeybindings.findInPage, ['Mod+F'])
assert.deepEqual(defaultKeybindings.history, ['Mod+H'])
assert.deepEqual(parseKeybindings({ newTab: ['Mod+T'] }).history, ['Mod+H'])
assert.throws(() => parseKeybindings({ history: ['Ctrl+L'] }), /conflicts/)
assert.deepEqual(defaultKeybindings.newIncognitoTab, ['Mod+Shift+N'])
assert.deepEqual(parseKeybindings({ newTab: ['Mod+T'] }).newIncognitoTab, ['Mod+Shift+N'])
assert.deepEqual(parseKeybindings({ newTab: ['Mod+T'] }).findInPage, ['Mod+F'])
assert.throws(() => parseKeybindings({ findInPage: ['Ctrl+L'] }), /conflicts/)
assert.throws(() => parseKeybindings(null), /Invalid/)
assert.throws(() => parseKeybindings({ unknown: [] }), /Unknown/)
assert.throws(() => parseKeybindings({ newTab: ['Ctrl+W'] }), /conflicts/)
assert.throws(() => parseKeybindings({ newTab: ['Meta+W'] }), /conflicts/)
assert.doesNotThrow(() => parseKeybindings({ newTab: ['Ctrl+K'], closeTab: ['Meta+K'] }))
assert.throws(() => parseKeybindings({ newTab: ['T'] }), /Start with/)
assert.throws(() => parseKeybindings({ newTab: ['Ctrl+Ctrl+T'] }), /Invalid/)
assert.throws(() => parseKeybindings({ newTab: ['Ctrl+K', 'Enter'] }), /modifier/)
assert.throws(() => parseKeybindings({ newTab: ['Ctrl+K', 'C', 'C', 'C', 'C'] }), /four/)
assert.throws(
  () => parseKeybindings({ newTab: ['Ctrl+K'], closeTab: ['Ctrl+K', 'C'] }),
  /conflicts/
)
assert.equal(keyStroke(input('Control', { control: true })), null)
assert.equal(keyStroke(input('Dead')), null)
assert.equal(keyStroke(input('t', { control: true, shift: true })), 'Ctrl+Shift+T')
assert.equal(
  keyStroke(input('{', { code: 'BracketLeft', control: true, shift: true })),
  'Ctrl+Shift+['
)
const matcher = createKeybindMatcher()
assert.equal(matcher.match(input('h', { control: true }), defaultKeybindings).action, 'history')
assert.equal(matcher.match(input('h', { meta: true }), defaultKeybindings).action, 'history')
assert.equal(
  matcher.match(input('h', { control: true }), parseKeybindings({ history: [] })).consumed,
  false
)
assert.equal(
  matcher.match(input('n', { control: true, shift: true }), defaultKeybindings).action,
  'newIncognitoTab'
)
assert.equal(
  matcher.match(input('n', { meta: true, shift: true }), defaultKeybindings).action,
  'newIncognitoTab'
)
assert.equal(matcher.match(input('f', { control: true }), defaultKeybindings).action, 'findInPage')
assert.equal(matcher.match(input('f', { meta: true }), defaultKeybindings).action, 'findInPage')
assert.equal(
  matcher.match(input('f', { control: true }), parseKeybindings({ findInPage: [] })).consumed,
  false
)
assert.equal(
  matcher.match(input('F3'), parseKeybindings({ findInPage: ['F3'] })).action,
  'findInPage'
)
assert.equal(matcher.match(input('t', { control: true }), defaultKeybindings).action, 'newTab')
assert.equal(matcher.match(input('t', { meta: true }), defaultKeybindings).action, 'newTab')
assert.equal(
  matcher.match(input('t', { control: true, shift: true }), defaultKeybindings).action,
  'reopenTab'
)
assert.equal(
  matcher.match(input('t', { meta: true, shift: true }), defaultKeybindings).action,
  'reopenTab'
)
assert.throws(() => parseKeybindings({ newTab: ['Ctrl+Shift+T'] }), /conflicts/)
assert.equal(
  matcher.match(input('t', { control: true, shift: true }), parseKeybindings({ reopenTab: [] }))
    .consumed,
  false
)
assert.equal(
  matcher.match(input('y', { control: true }), parseKeybindings({ reopenTab: ['Ctrl+Y'] })).action,
  'reopenTab'
)
assert.equal(
  matcher.match(input('Tab', { control: true, shift: true }), defaultKeybindings).action,
  'previousTab'
)
assert.equal(matcher.match(input('[', { control: true }), defaultKeybindings).action, 'back')
assert.equal(matcher.match(input(']', { control: true }), defaultKeybindings).action, 'forward')
const bindings = parseKeybindings({ newTab: ['Ctrl+K', 'Ctrl+C'], closeTab: ['Ctrl+K', 'W'] })
assert.equal(matcher.match(input('t', { control: true }), bindings).consumed, false)
assert.deepEqual(matcher.match(input('k', { control: true }), bindings, 100), {
  consumed: true,
  action: undefined
})
assert.equal(matcher.match(input('Control', { control: true }), bindings, 110).consumed, false)
assert.equal(matcher.match(input('c', { control: true }), bindings, 200).action, 'newTab')
matcher.match(input('k', { control: true }), bindings, 300)
assert.equal(matcher.match(input('w'), bindings, 400).action, 'closeTab')
matcher.match(input('k', { control: true }), bindings, 500)
assert.equal(matcher.match(input('c', { control: true }), bindings, 1800).consumed, false)
matcher.match(input('k', { control: true }), bindings, 2000)
matcher.reset()
assert.equal(matcher.match(input('c', { control: true }), bindings, 2100).consumed, false)
matcher.match(input('k', { control: true }), bindings, 2200)
assert.equal(matcher.match(input('l', { control: true }), bindings, 2300).action, 'focusAddress')
assert.equal(
  matcher.match(input('t', { control: true }), parseKeybindings({ newTab: [] })).consumed,
  false
)
assert.equal(matcher.match(input('F6'), parseKeybindings({ newTab: ['F6'] })).action, 'newTab')
console.log(
  'PASS: keybind validation, modifiers, conflicts, sequences, timeout, reset, disabled actions and defaults'
)
