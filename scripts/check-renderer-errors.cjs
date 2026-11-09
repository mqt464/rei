const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '../src/renderer/src/errors.ts'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const context = vm.createContext({ exports: {}, Error, TypeError })
vm.runInContext(compiled, context)
const { actionError } = context.exports
const fallback = 'Action-specific fallback.'
for (const [failure, expected] of [
  [new Error('Plain error.'), 'Plain error.'],
  [new Error("Error invoking remote method 'theme:set': Error: Invalid theme."), 'Invalid theme.'],
  [new Error("Error invoking remote method 'commands:run': Denied."), 'Denied.'],
  [new TypeError('Wrong type.'), 'Wrong type.'],
  [new Error(''), ''],
  [
    new Error("Prefix Error invoking remote method 'test': Error: Keep prefix."),
    "Prefix Error invoking remote method 'test': Error: Keep prefix."
  ],
  [undefined, fallback],
  [null, fallback],
  ['Rejected string', fallback],
  [{ message: 'Not an Error' }, fallback]
]) {
  assert.equal(actionError(failure, fallback), expected)
}
console.log('Renderer error formatting contracts passed.')
