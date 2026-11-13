import { app } from 'electron'

export function configureCookieProtection(enabled: boolean): boolean {
  const managed = ['ForceThirdPartyCookieBlockingEnabled', 'ThirdPartyStoragePartitioning']
  const active = (name: string): string[] =>
    app.commandLine.getSwitchValue(name).split(',').filter(Boolean)
  const originalEnabled = active('enable-features')
  const originalDisabled = active('disable-features')
  const has = (features: string[], name: string): boolean =>
    features.some((entry) => entry.split(/[<:]/, 1)[0] === name)
  if (
    has(originalEnabled, 'ThirdPartyStoragePartitioning') &&
    !has(originalDisabled, 'ThirdPartyStoragePartitioning') &&
    has(enabled ? originalEnabled : originalDisabled, 'ForceThirdPartyCookieBlockingEnabled') &&
    !has(enabled ? originalDisabled : originalEnabled, 'ForceThirdPartyCookieBlockingEnabled')
  )
    return true
  const unmanaged = (features: string[]): string[] =>
    features.filter((entry) => !managed.includes(entry.split(/[<:]/, 1)[0]))
  const enable = [...unmanaged(originalEnabled), 'ThirdPartyStoragePartitioning']
  const disable = unmanaged(originalDisabled)
  ;(enabled ? enable : disable).push('ForceThirdPartyCookieBlockingEnabled')
  const args = process.argv
    .slice(1)
    .filter((value) => !/^--(?:enable|disable)-features(?:=|$)/.test(value))
  args.push(`--enable-features=${enable.join(',')}`)
  if (disable.length) args.push(`--disable-features=${disable.join(',')}`)
  app.relaunch({ args })
  return false
}
