const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '../src/main/extensions.ts'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText

async function check({ readyAfter = 1, loading = true, changedId = false } = {}) {
  let clock = 0
  let probes = 0
  let loadingChecks = 0
  const removed = []
  const entry = { id: 'fkgkibajhfbepljeaefdnfnegdcjomkh', bundled: true, path: '/ublock' }
  const extension = { id: changedId ? 'different' : entry.id, url: 'chrome-extension://ublock/' }
  const session = {
    extensions: {
      loadExtension: async () => extension,
      removeExtension: (id) => removed.push(id)
    }
  }
  const background = {
    session,
    getURL: () => `${extension.url}background.html`,
    isLoading: () => {
      loadingChecks++
      return loading
    },
    executeJavaScript: async (script) => {
      assert.equal(script, 'globalThis.\u00b5Block?.readyToFilter === true')
      probes++
      return probes >= readyAfter
    }
  }
  const context = vm.createContext({
    exports: {},
    Date: class extends Date {
      static now() {
        return clock
      }
    },
    setTimeout: (resolve) => {
      clock += 1000
      resolve()
    },
    require: (name) => {
      if (name === 'electron') return { webContents: { getAllWebContents: () => [background] } }
      if (name.startsWith('node:')) return require(name)
      return {}
    }
  })
  vm.runInContext(compiled, context)
  const runtime = Object.assign(Object.create(context.exports.ExtensionRuntime.prototype), {
    session,
    installed: new Map([[entry.id, entry]]),
    describe: () => entry
  })
  if (changedId) {
    await assert.rejects(runtime.loadExtension(entry), /Extension ID changed/)
    assert.deepEqual(removed, ['different'])
    assert.equal(probes, 0)
  } else if (readyAfter === Infinity) {
    await assert.rejects(runtime.loadExtension(entry), /did not finish starting/)
    assert.deepEqual(removed, [entry.id])
    assert.ok(probes > 0, 'filtering readiness must be checked before timeout')
  } else {
    await runtime.loadExtension(entry)
    assert.equal(probes, readyAfter, 'wait for filtering readiness, not document loading state')
    assert.deepEqual(removed, [])
    assert.equal(loadingChecks, 0, 'document loading state must not gate filtering readiness')
  }
}

async function main() {
  await check()
  await check({ readyAfter: 3 })
  await check({ loading: false })
  await check({ readyAfter: Infinity })
  await check({ changedId: true })
  console.log('Extension startup readiness contracts passed.')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
