import { defaultKeybindings, parseKeybindings } from './keyboard'
import type { Keybindings } from './keyboard'

export const searchEngines = {
  google: { label: 'Google', url: 'https://www.google.com/search?q=' },
  duckduckgo: { label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  bing: { label: 'Bing', url: 'https://www.bing.com/search?q=' },
  brave: { label: 'Brave Search', url: 'https://search.brave.com/search?q=' }
}

export interface Preferences {
  keybindings: Keybindings
  searchEngine: keyof typeof searchEngines
  newTabUrl: string
  defaultZoom: number
  spellcheck: boolean
  autoHideTopbar: boolean
  backgroundTabs: boolean
  contextMenuStyle: 'rei' | 'native'
  contextMenuIcons: boolean
  confirmClose: boolean
  downloadPrompt: boolean
  downloadDirectory: string
  downloadHistory: boolean
  historyEnabled: boolean
  doNotTrack: boolean
  startup: 'blank' | 'restore' | 'pages'
  startupPages: string[]
  tabSleeping: boolean
  tabSleepMinutes: number
  tabSleepExceptions: string[]
  tabDiscardMinutes: number
  tabDiscardExceptions: string[]
}

export const defaultPreferences: Preferences = {
  keybindings: defaultKeybindings,
  searchEngine: 'google',
  newTabUrl: '',
  defaultZoom: 100,
  spellcheck: true,
  autoHideTopbar: true,
  backgroundTabs: false,
  contextMenuStyle: 'rei',
  contextMenuIcons: true,
  confirmClose: false,
  downloadPrompt: true,
  downloadDirectory: '',
  downloadHistory: true,
  historyEnabled: true,
  doNotTrack: false,
  startup: 'blank',
  startupPages: [],
  tabSleeping: true,
  tabSleepMinutes: 3.5,
  tabSleepExceptions: [],
  tabDiscardMinutes: 30,
  tabDiscardExceptions: []
}

export function searchUrl(query: string, engine: Preferences['searchEngine'] = 'google'): string {
  return searchEngines[engine].url + encodeURIComponent(query.trim())
}

export function parsePreferences(value: unknown, current = defaultPreferences): Preferences {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid browser preferences.')
  const next = { ...current }
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'incognitoUseNewTabUrl') {
      continue
    } else if (key === 'keybindings') {
      next.keybindings = parseKeybindings(entry)
    } else if (key === 'contextMenuStyle') {
      if (entry !== 'rei' && entry !== 'native') throw new Error('Choose a context menu style.')
      next.contextMenuStyle = entry
    } else if (key === 'startup') {
      if (!['blank', 'restore', 'pages'].includes(entry as string))
        throw new Error('Choose a startup behaviour.')
      next.startup = entry as Preferences['startup']
    } else if (key === 'startupPages') {
      if (
        !Array.isArray(entry) ||
        entry.length > 50 ||
        entry.some((address) => typeof address !== 'string' || address.length > 8192)
      )
        throw new Error('Choose up to 50 startup pages.')
      next.startupPages = entry.map((address) => {
        const parsed = parsePreferences({ newTabUrl: address }).newTabUrl
        if (!parsed) throw new Error('Startup pages must have an HTTP or HTTPS address.')
        return parsed
      })
    } else if (key === 'tabSleepMinutes' || key === 'tabDiscardMinutes') {
      if (typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0 || entry > 360)
        throw new Error('Tab delay must be between 0 and 360 minutes (6 hours).')
      next[key] = entry
    } else if (key === 'tabSleepExceptions' || key === 'tabDiscardExceptions') {
      if (
        !Array.isArray(entry) ||
        entry.length > 200 ||
        entry.some(
          (host) =>
            typeof host !== 'string' ||
            host.length > 253 ||
            !/^(?:localhost|(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)*[a-z\d](?:[a-z\d-]*[a-z\d])?)$/i.test(
              host
            )
        )
      )
        throw new Error('Use one hostname per line, without paths or protocols.')
      next[key] = [...new Set(entry.map((host) => host.toLowerCase()))]
    } else if (key === 'searchEngine') {
      if (typeof entry !== 'string' || !Object.hasOwn(searchEngines, entry))
        throw new Error('Choose an available search engine.')
      next.searchEngine = entry as Preferences['searchEngine']
    } else if (key === 'newTabUrl') {
      if (typeof entry !== 'string' || entry.length > 8192)
        throw new Error('Enter a valid homepage address.')
      if (!entry.trim()) next.newTabUrl = ''
      else {
        let address: URL
        try {
          address = new URL(entry)
        } catch {
          throw new Error('Include https:// or http:// in the homepage address.')
        }
        if (!['https:', 'http:'].includes(address.protocol) || address.username || address.password)
          throw new Error('Use an HTTP or HTTPS address without a username or password.')
        next.newTabUrl = address.href
      }
    } else if (key === 'downloadDirectory') {
      if (typeof entry !== 'string' || entry.length > 8192 || entry.includes('\0'))
        throw new Error('Choose a valid download folder.')
      next.downloadDirectory = entry
    } else if (key === 'defaultZoom') {
      if (typeof entry !== 'number' || !Number.isInteger(entry) || entry < 50 || entry > 200)
        throw new Error('Page zoom must be between 50 and 200%.')
      next.defaultZoom = entry
    } else if (
      Object.hasOwn(defaultPreferences, key) &&
      typeof defaultPreferences[key as keyof Preferences] === 'boolean'
    ) {
      if (typeof entry !== 'boolean') throw new Error('Browser switches must be on or off.')
      Object.assign(next, { [key]: entry })
    } else throw new Error('Unknown browser preference.')
  }
  if ('tabSleeping' in value) {
    if (value.tabSleeping === false) next.tabSleepMinutes = 0
    else if (!('tabSleepMinutes' in value) && next.tabSleepMinutes === 0)
      next.tabSleepMinutes = defaultPreferences.tabSleepMinutes
  }
  next.tabSleeping = next.tabSleepMinutes > 0
  return next
}
