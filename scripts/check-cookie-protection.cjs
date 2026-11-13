const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const compiled = ts.transpileModule(
  fs.readFileSync(path.resolve(__dirname, '../src/main/cookie-protection.ts'), 'utf8'),
  {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }
).outputText

function load(app, argv) {
  const exports = {}
  vm.runInNewContext(compiled, {
    exports,
    require: (name) => {
      assert.equal(name, 'electron')
      return { app }
    },
    process: { argv }
  })
  return exports.configureCookieProtection
}

if (process.versions.electron) {
  const { app } = require('electron')
  app.setPath('userData', process.env.REI_COOKIE_BOOT_PROFILE)
  const configure = load(app, process.argv)
  if (!configure(process.env.REI_COOKIE_BOOT_BLOCKED === 'true')) app.exit(0)
  else
    app.whenReady().then(() => {
      fs.writeFileSync(
        process.env.REI_COOKIE_BOOT_RESULT,
        JSON.stringify({
          enabled: app.commandLine.getSwitchValue('enable-features'),
          disabled: app.commandLine.getSwitchValue('disable-features')
        })
      )
      app.exit(0)
    })
} else {
  const force = 'ForceThirdPartyCookieBlockingEnabled'
  const storage = 'ThirdPartyStoragePartitioning'
  const check = (blocked, enabled = '', disabled = '') => {
    const launches = []
    const app = {
      commandLine: { getSwitchValue: (name) => (name === 'enable-features' ? enabled : disabled) },
      relaunch: (options) => launches.push(options)
    }
    const argv = [
      'electron.exe',
      'rei',
      'https://example.com/?launch=kept',
      '--other-switch=value',
      `--enable-features=${enabled}`,
      `--disable-features=${disabled}`
    ]
    return { ready: load(app, argv)(blocked), launches }
  }
  for (const blocked of [true, false]) {
    const result = check(
      blocked,
      blocked ? `${force},${storage},Unrelated` : `${storage},Unrelated`,
      blocked ? 'OtherDisabled' : `${force},OtherDisabled`
    )
    assert.equal(result.ready, true)
    assert.equal(result.launches.length, 0)
  }
  for (const blocked of [true, false]) {
    const result = check(blocked, `Unrelated,${force}`, `${storage},OtherDisabled`)
    assert.equal(result.ready, false)
    assert.equal(result.launches.length, 1)
    const args = result.launches[0].args
    assert.ok(args.includes('rei'))
    assert.ok(args.includes('https://example.com/?launch=kept'))
    assert.ok(args.includes('--other-switch=value'))
    assert.equal(args.filter((value) => value.startsWith('--enable-features=')).length, 1)
    const enabled = args.find((value) => value.startsWith('--enable-features='))
    const disabled = args.find((value) => value.startsWith('--disable-features='))
    assert.ok(enabled.includes(storage))
    assert.ok(enabled.includes('Unrelated'))
    assert.ok(disabled.includes('OtherDisabled'))
    assert.equal(enabled.includes(force), blocked)
    assert.equal(disabled.includes(force), !blocked)
    assert.equal(disabled.includes(storage), false)
  }

  async function main() {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-cookie-bootstrap-'))
    const resultPath = path.join(profile, 'result.json')
    try {
      for (const blocked of [true, false]) {
        const env = {
          ...process.env,
          REI_COOKIE_BOOT_PROFILE: profile,
          REI_COOKIE_BOOT_RESULT: resultPath,
          REI_COOKIE_BOOT_BLOCKED: String(blocked)
        }
        delete env.ELECTRON_RUN_AS_NODE
        fs.writeFileSync(
          path.join(profile, 'preferences.json'),
          JSON.stringify({ blockThirdPartyCookies: blocked })
        )
        const launcher = path.resolve(__dirname, 'launch.cjs')
        const probe = require('node:child_process').spawnSync(
          require('electron'),
          [launcher, `--user-data-dir=${profile}`],
          {
            env,
            encoding: 'utf8',
            timeout: 15000,
            windowsHide: true
          }
        )
        if (probe.error) throw probe.error
        assert.equal(probe.status, 0, probe.stderr)
        assert.ok(
          probe.stdout.includes(`REI_COOKIE_POLICY=${blocked}`),
          'Development launcher must read the selected Electron profile'
        )
        let launched
        const originalArgs = [
          `--user-data-dir=${profile}`,
          '--enable-features=Unrelated',
          '--disable-features=OtherDisabled'
        ]
        vm.runInNewContext(fs.readFileSync(launcher, 'utf8'), {
          __filename: launcher,
          process: {
            versions: {},
            execPath: process.execPath,
            argv: ['node', launcher, 'dev'],
            env: { ELECTRON_CLI_ARGS: JSON.stringify(originalArgs) }
          },
          console,
          require: Object.assign(
            (name) =>
              name === 'node:child_process'
                ? {
                    spawnSync: () => ({ status: 0, stdout: `REI_COOKIE_POLICY=${blocked}\n` }),
                    spawn: (executable, args, options) => {
                      launched = { executable, args, options }
                      return {
                        on() {
                          return undefined
                        }
                      }
                    }
                  }
                : require(name),
            { resolve: require.resolve }
          )
        })
        const launchArgs = JSON.parse(launched.options.env.ELECTRON_CLI_ARGS)
        assert.ok(launchArgs.includes(originalArgs[0]))
        assert.ok(launched.args.includes('dev'))
        assert.equal(launchArgs.filter((value) => value.startsWith('--enable-features=')).length, 1)
        assert.equal(
          launchArgs.find((value) => value.startsWith('--enable-features=')).includes(force),
          blocked
        )
        assert.equal(
          launchArgs.find((value) => value.startsWith('--disable-features=')).includes(force),
          !blocked
        )
        assert.ok(launchArgs.some((value) => value.includes('Unrelated')))
        assert.ok(launchArgs.some((value) => value.includes('OtherDisabled')))
        const child = require('node:child_process').spawnSync(require('electron'), [__filename], {
          env,
          stdio: 'inherit',
          timeout: 15000,
          windowsHide: true
        })
        if (child.error) throw child.error
        assert.equal(child.status, 0)
        const deadline = Date.now() + 12000
        while (!fs.existsSync(resultPath) && Date.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 30))
        assert.ok(
          fs.existsSync(resultPath),
          'Native cookie-policy bootstrap must relaunch successfully'
        )
        const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'))
        assert.ok(result.enabled.includes(storage))
        assert.equal(result.enabled.includes(force), blocked)
        assert.equal(result.disabled.includes(force), !blocked)
        fs.unlinkSync(resultPath)
      }
      console.log(
        'PASS: native cookie flags, development launcher profiles, preserved launch arguments, real startup relaunch, no relaunch loop, enabled/disabled modes'
      )
    } finally {
      assert.equal(path.dirname(profile), os.tmpdir())
      assert.ok(path.basename(profile).startsWith('rei-cookie-bootstrap-'))
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 })
    }
  }
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
