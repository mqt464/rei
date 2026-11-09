import { searchUrl } from './preferences'
import type { Preferences } from './preferences'

export const settingsUrl = 'rei://settings'
export const downloadsUrl = 'rei://downloads'
export const historyUrl = `${settingsUrl}/history`

export function isInternalUrl(url: string | undefined): boolean {
  return url === downloadsUrl || isSettingsUrl(url)
}

export const settingsPages = [
  { id: 'appearance', title: 'Appearance', url: settingsUrl },
  { id: 'wallpaper', title: 'Wallpaper', url: `${settingsUrl}/wallpaper` },
  { id: 'caret', title: 'Caret', url: `${settingsUrl}/caret` },
  { id: 'motion', title: 'Motion', url: `${settingsUrl}/motion` },
  { id: 'browser', title: 'Browsing', url: `${settingsUrl}/browser` },
  { id: 'performance', title: 'Performance', url: `${settingsUrl}/performance` },
  { id: 'search', title: 'Search', url: `${settingsUrl}/search` },
  { id: 'shortcuts', title: 'Site search', url: `${settingsUrl}/shortcuts` },
  { id: 'keybinds', title: 'Keybinds', url: `${settingsUrl}/keybinds` },
  { id: 'commands', title: 'Commands', url: `${settingsUrl}/commands` },
  { id: 'downloads', title: 'Downloads', url: `${settingsUrl}/downloads` },
  { id: 'history', title: 'History', url: historyUrl },
  { id: 'extensions', title: 'Extensions', url: `${settingsUrl}/extensions` },
  { id: 'updates', title: 'Updates', url: `${settingsUrl}/updates` },
  { id: 'privacy', title: 'Privacy', url: `${settingsUrl}/privacy` }
] as const

export function isSettingsUrl(url: string | undefined): boolean {
  return settingsPages.some((page) => page.url === url)
}

export function resolveAddress(
  input: string,
  engine: Preferences['searchEngine'] = 'google'
): string | null {
  const address = input.trim()
  if (!address) return null
  if (address.startsWith('/'))
    throw new Error('Run slash commands from the address bar. Manage them in Settings → Commands.')

  const internalAddress = address.toLowerCase().replace(/\/$/, '')
  if (isInternalUrl(internalAddress)) return internalAddress
  if (/^rei:/i.test(address)) throw new Error('Unknown Rei page. Try rei://settings.')

  if (/^https?:\/\//i.test(address)) return new URL(address).href

  if (/^(?:javascript|data|file|vbscript|about):/i.test(address)) {
    throw new Error('Only HTTP and HTTPS addresses are supported.')
  }

  if (
    /^(?:localhost|(?:[^\s./:?#]+\.)+[^\s./:?#]+|\[[\da-f:]+\])(?::\d+)?(?:[/?#]|$)/i.test(address)
  ) {
    return new URL(`https://${address}`).href
  }

  return searchUrl(address, engine)
}
