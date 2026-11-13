const fs = require('node:fs')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')

if (process.versions.electron) {
  const { app } = require('electron')
  app.setName(require('../package.json').name)
  let blocked = true
  try {
    const saved = JSON.parse(
      fs.readFileSync(path.join(app.getPath('userData'), 'preferences.json'), 'utf8')
    )
    if (typeof saved.blockThirdPartyCookies === 'boolean') blocked = saved.blockThirdPartyCookies
  } catch {
    blocked = true
  }
  process.stdout.write(`REI_COOKIE_POLICY=${JSON.stringify(blocked)}\n`)
  app.exit(0)
} else {
  const args = JSON.parse(process.env.ELECTRON_CLI_ARGS || '[]')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const probe = spawnSync(require('electron'), [__filename, ...args], {
    env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000
  })
  const policy = probe.stdout?.match(/^REI_COOKIE_POLICY=(true|false)$/m)
  if (probe.error || probe.status !== 0 || !policy) {
    console.error(probe.error || probe.stderr || 'Could not read the native cookie policy.')
    process.exit(1)
  }
  const managed = ['ForceThirdPartyCookieBlockingEnabled', 'ThirdPartyStoragePartitioning']
  const features = (switchName) =>
    args
      .filter((value) => value.startsWith(`--${switchName}=`))
      .flatMap((value) => value.slice(value.indexOf('=') + 1).split(','))
      .filter((value) => value && !managed.includes(value.split(/[<:]/, 1)[0]))
  const enabled = [...features('enable-features'), 'ThirdPartyStoragePartitioning']
  const disabled = features('disable-features')
  ;(policy[1] === 'true' ? enabled : disabled).push('ForceThirdPartyCookieBlockingEnabled')
  const launchArgs = args.filter((value) => !/^--(?:enable|disable)-features(?:=|$)/.test(value))
  launchArgs.push(`--enable-features=${enabled.join(',')}`)
  if (disabled.length) launchArgs.push(`--disable-features=${disabled.join(',')}`)
  env.ELECTRON_CLI_ARGS = JSON.stringify(launchArgs)
  const cli = path.join(
    path.dirname(require.resolve('electron-vite/package.json')),
    'bin/electron-vite.js'
  )
  const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
    env,
    stdio: 'inherit',
    windowsHide: true
  })
  child.on('error', (error) => {
    console.error(error)
    process.exitCode = 1
  })
  child.on('exit', (code) => {
    process.exitCode = code ?? 1
  })
}
