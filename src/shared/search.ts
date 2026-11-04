import { resolveAddress } from './navigation'
import { searchEngines } from './preferences'
import type { Preferences } from './preferences'

export const searchModes = [
  { id: 'all', label: 'All' },
  { id: 'search', label: 'Search engine' },
  { id: 'websites', label: 'Websites' },
  { id: 'tabs', label: 'Opened tabs' },
  { id: 'history', label: 'History' }
] as const

export type SearchMode = (typeof searchModes)[number]['id']

export type SearchResult = {
  id: string
  title: string
  favicon?: string
  description?: string
  source?: 'history'
  keyword?: string
} & (
  | { kind: 'search'; query: string }
  | { kind: 'website'; url: string }
  | { kind: 'tab'; tabId: string; url: string }
)

export interface SearchShortcut {
  keyword: string
  title: string
  url: string
}

export const defaultShortcuts: SearchShortcut[] = [
  { keyword: 'yt', title: 'YouTube', url: 'https://www.youtube.com/results?search_query={query}' },
  { keyword: 'gh', title: 'GitHub', url: 'https://github.com/search?q={query}' },
  {
    keyword: 'wiki',
    title: 'Wikipedia',
    url: 'https://en.wikipedia.org/w/index.php?search={query}'
  }
]

export function parseShortcuts(value: unknown): SearchShortcut[] {
  if (!Array.isArray(value) || value.length > 30) throw new Error('Use an array of up to 30 sites.')
  const keywords = new Set<string>()
  return value.map((entry) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof entry.keyword !== 'string' ||
      typeof entry.title !== 'string' ||
      typeof entry.url !== 'string'
    )
      throw new Error('Each site needs a keyword, title and URL.')
    const keyword = entry.keyword.trim()
    const title = entry.title.trim()
    const url = entry.url.trim()
    if (!/^[a-z0-9_-]{1,20}$/.test(keyword) || keywords.has(keyword))
      throw new Error(
        'Use unique keywords of 1-20 lowercase letters, numbers, hyphens or underscores.'
      )
    if (!title || title.length > 80) throw new Error('Site titles must be 1-80 characters.')
    let validUrl: boolean
    try {
      validUrl = ['https:', 'http:'].includes(new URL(url).protocol)
    } catch {
      validUrl = false
    }
    if (!validUrl || url.length > 2048 || !url.includes('{query}'))
      throw new Error('Use an HTTP(S) search URL containing {query}, up to 2048 characters.')
    keywords.add(keyword)
    return { keyword, title, url }
  })
}

export function shortcutResult(
  query: string,
  shortcuts: SearchShortcut[]
): SearchResult | undefined {
  const match = /^(\S+)\s+(.+)$/.exec(query.trim())
  if (!match) return undefined
  const shortcut = shortcuts.find((entry) => entry.keyword === match[1].toLowerCase())
  if (!shortcut) return undefined
  const url = shortcut.url.replaceAll('{query}', encodeURIComponent(match[2]))
  return {
    id: `website:${url}`,
    kind: 'website',
    title: `Search ${shortcut.title} for "${match[2]}"`,
    url
  }
}

export function cleanUrl(value: string): string {
  try {
    const url = new URL(value)
    return `${url.host.replace(/^www\./, '')}${url.pathname === '/' ? '' : url.pathname}${url.search}`
  } catch {
    return value
  }
}

export function matchScore(query: string, text: string): number {
  query = query.trim().toLowerCase()
  text = text.toLowerCase()
  if (!query) return 0
  if (text === query) return 240
  if (text.startsWith(query)) return 160
  const terms = query.match(/[\p{L}\p{N}]+/gu) ?? []
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? []
  if (!terms.length) return 0
  if (terms.length > 1) {
    const scores = terms.map((term) => Math.max(0, ...words.map((word) => matchScore(term, word))))
    return scores.every((score) => score > 0) ? Math.min(100, ...scores) : 0
  }
  if (words.some((word) => word === query || word.startsWith(query))) return 100
  if (
    words.some((word) => {
      if (query.length < 2 || word.length > query.length * 4) return false
      let cursor = 0
      for (const character of word) if (character === query[cursor]) cursor += 1
      return cursor === query.length
    })
  )
    return 30
  if (query.length < 3) return 0
  const limit = query.length > 8 ? 2 : 1
  for (const word of words) {
    if (Math.abs(word.length - query.length) > limit) continue
    let previous = Array.from({ length: word.length + 1 }, (_, index) => index)
    for (let row = 1; row <= query.length; row += 1) {
      const current = [row]
      for (let column = 1; column <= word.length; column += 1) {
        current[column] = Math.min(
          current[column - 1] + 1,
          previous[column] + 1,
          previous[column - 1] + (query[row - 1] === word[column - 1] ? 0 : 1)
        )
      }
      previous = current
    }
    if (previous[word.length] <= limit) return 40
  }
  return 0
}

export function resultScore(query: string, result: SearchResult): number {
  query = query.trim().toLowerCase()
  if (!query) return 0
  if (result.kind === 'search') return result.query.toLowerCase() === query ? 150 : 0
  let url: URL
  try {
    url = new URL(result.url)
    if (!['http:', 'https:'].includes(url.protocol)) return 0
  } catch {
    return 0
  }
  const learnedScore = result.keyword?.toLowerCase() === query ? 260 : 0
  const domain = url.hostname.replace(/^www\./, '')
  const address = query.replace(/\/$/, '')
  if (
    [url.href, cleanUrl(url.href)].some(
      (value) => value.toLowerCase().replace(/\/$/, '') === address
    )
  )
    return 400
  const domainScore = Math.max(
    matchScore(query, domain),
    ...domain
      .split('.')
      .slice(0, -1)
      .map((label) => matchScore(query, label))
  )
  const depth = url.pathname.split('/').filter(Boolean).length
  const identityScore =
    domainScore >= 160 && query.length >= 3
      ? domainScore + 80 - Math.min(20, depth * 4 + (url.search ? 4 : 0))
      : Math.min(100, domainScore)
  const terms = searchTerms(url)
  if (terms || /(?:^|\/)(?:search|results)(?:\/|$)/i.test(url.pathname)) {
    return Math.max(
      identityScore,
      learnedScore,
      (result.kind === 'tab' || result.source === 'history') && terms
        ? Math.min(120, matchScore(query, terms))
        : 0
    )
  }
  if (result.kind === 'website' && result.source !== 'history') {
    const homepageName = url.pathname === '/' && result.title.trim().toLowerCase() === query
    return Math.max(identityScore, learnedScore, homepageName ? 300 : 0)
  }
  const titleScore = matchScore(query, result.title)
  const strongTitle =
    titleScore === 240 ||
    (titleScore === 160 && query.split(/\s+/).length > 1) ||
    (query.length >= 3 && titleScore >= 100 && result.title.toLowerCase().includes(query))
  let pathname = url.pathname
  try {
    pathname = decodeURIComponent(pathname)
  } catch {
    pathname = url.pathname
  }
  return Math.max(
    identityScore,
    learnedScore,
    strongTitle ? Math.max(220, titleScore + 60) : Math.min(120, titleScore),
    Math.min(100, matchScore(query, pathname))
  )
}

function searchTerms(url: URL): string | undefined {
  for (const [key, value] of url.searchParams) {
    if (/^(?:q|query|search_query|search|s|text|keywords?)$/i.test(key) && value.trim())
      return value.trim()
  }
  return undefined
}

export function rankSearchResults(
  query: string,
  results: SearchResult[],
  preference: (result: SearchResult) => number = () => 0
): SearchResult[] {
  query = query.trim()
  if (!query) return []
  const destinations = new Map<string, SearchResult>()
  const searches = new Map<string, SearchResult>()
  const hasSearchAction = results.some(
    (result) =>
      result.kind === 'search' && result.query.trim().toLowerCase() === query.toLowerCase()
  )
  let expectedSearch: URL | undefined
  try {
    const destination = resolveAddress(query)
    if (destination) expectedSearch = new URL(destination)
  } catch {
    expectedSearch = undefined
  }
  for (const result of results) {
    if (result.kind === 'search') {
      const key = result.query.trim().toLowerCase()
      if (!searches.has(key)) searches.set(key, result)
      continue
    }
    if (resultScore(query, result) <= 0) continue
    const url = new URL(result.url)
    url.hostname = url.hostname.replace(/^www\./, '')
    if (
      hasSearchAction &&
      expectedSearch &&
      searchTerms(expectedSearch) &&
      url.hostname === expectedSearch.hostname.replace(/^www\./, '') &&
      url.pathname === expectedSearch.pathname &&
      searchTerms(url)?.toLowerCase() === query.toLowerCase()
    )
      continue
    if (!/^#!?\//.test(url.hash)) url.hash = ''
    url.pathname = url.pathname.replace(/\/$/, '') || '/'
    url.searchParams.sort()
    const key = url.href
    const previous = destinations.get(key)
    if (
      !previous ||
      (result.kind === 'tab' && previous.kind !== 'tab') ||
      (result.kind === previous.kind && resultScore(query, result) > resultScore(query, previous))
    ) {
      destinations.set(key, result)
    }
  }
  const score = (result: SearchResult): number =>
    resultScore(query, result) + Math.max(0, Math.min(80, preference(result)))
  const navigation = [...destinations.values()].sort((left, right) => {
    const leftScore = score(left)
    const rightScore = score(right)
    return (
      Number(rightScore >= 200) - Number(leftScore >= 200) ||
      rightScore - leftScore ||
      Number(right.kind === 'tab') - Number(left.kind === 'tab')
    )
  })
  const exact = searches.get(query.toLowerCase())
  searches.delete(query.toLowerCase())
  const primary =
    exact && navigation[0] && score(navigation[0]) >= 200 ? navigation.shift() : undefined
  return [
    ...(primary ? [primary] : []),
    ...(exact ? [exact] : []),
    ...navigation,
    ...searches.values()
  ].slice(0, 24)
}

export interface SearchResponse {
  results: SearchResult[]
  warning?: string
}

export function localSearchResults(
  query: string,
  mode: SearchMode,
  engine: Preferences['searchEngine'] = 'google'
): SearchResult[] {
  query = query.trim()
  if (!query || mode === 'tabs' || mode === 'history') return []
  try {
    const url = resolveAddress(query)
    if (url && !url.startsWith('https://www.google.com/search?q=') && mode !== 'search') {
      return [{ id: `website:${url}`, kind: 'website', title: `Open ${url}`, url }]
    }
    if (mode === 'websites') return []
    return [
      {
        id: `search:${query}`,
        kind: 'search',
        title: `Search ${searchEngines[engine].label} for "${query}"`,
        query
      }
    ]
  } catch {
    return []
  }
}
