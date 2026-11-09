const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const output = path.resolve(process.argv[2] || '.cache/memory/pinned-build')
const source = path.resolve(process.argv[3] || 'out')
assert.ok(!fs.existsSync(output), 'Choose a new, absent output directory')
const relativeOutput = path.relative(source, output)
assert.ok(
  relativeOutput.startsWith(`..${path.sep}`) || path.isAbsolute(relativeOutput),
  'Output must be outside the build'
)
fs.mkdirSync(output, { recursive: true })
for (const directory of ['main', 'preload', 'renderer'])
  fs.cpSync(path.join(source, directory), path.join(output, directory), { recursive: true })

const baseline = path.join(output, 'renderer-baseline')
fs.cpSync(path.join(output, 'renderer'), baseline, { recursive: true })
const assets = path.join(baseline, 'assets')
const guard =
  /\tif \(\[\s*"#tabs",\s*"#context-menu",\s*"#find"\s*\]\.includes\(location\.hash\)\) return;\r?\n/g
const candidates = fs
  .readdirSync(assets)
  .filter((file) => file.endsWith('.js'))
  .map((file) => {
    const filename = path.join(assets, file)
    const code = fs.readFileSync(filename, 'utf8')
    return { filename, code, matches: [...code.matchAll(guard)].length }
  })
  .filter((item) => item.matches)
assert.equal(
  candidates.length,
  1,
  'Expected one compiled wallpaper guard; inspect changed build output'
)
assert.equal(candidates[0].matches, 1, 'Wallpaper guard must be unique')
const original = candidates[0]
fs.writeFileSync(original.filename, original.code.replace(guard, ''))

const hashes = (directory) =>
  Object.fromEntries(
    fs
      .readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const file = path.join(entry.parentPath, entry.name)
        return [
          path.relative(directory, file),
          crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
        ]
      })
  )
const before = hashes(baseline)
const after = hashes(path.join(output, 'renderer'))
assert.deepEqual(Object.keys(before), Object.keys(after), 'Renderer inventories must match')
const changed = Object.keys(before).filter((file) => before[file] !== after[file])
assert.deepEqual(changed, [path.relative(baseline, original.filename)])
fs.writeFileSync(
  path.join(output, 'benchmark-manifest.json'),
  JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      derivation: 'Identical pinned build; baseline removes only the compiled wallpaper guard',
      changedRendererFiles: changed,
      files: hashes(output)
    },
    null,
    2
  ) + '\n'
)
console.log('Pinned build:', output)
console.log('Baseline changes only:', changed[0])
