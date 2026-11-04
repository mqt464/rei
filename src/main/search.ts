import { resolveAddress } from '../shared/navigation'
import {
  defaultShortcuts,
  localSearchResults,
  rankSearchResults,
  resultScore,
  shortcutResult
} from '../shared/search'
import type { SearchMode, SearchResponse, SearchResult, SearchShortcut } from '../shared/search'
import type { BrowserTab } from '../shared/browser'
import type { SearchStore } from './search-store'
import { getSuggestions } from './suggestions'
import { getWebsites } from './websites'
import { currentPreferences } from './preferences'

export class SearchService {
  shortcuts: SearchShortcut[] = defaultShortcuts

  constructor(private store: SearchStore) {}

  visit(tab: BrowserTab, typed = false): void {
    if (!tab.incognito && !tab.error && currentPreferences().historyEnabled)
      this.store.visit(tab.url, tab.title || tab.url, tab.favicon, typed)
  }

  metadata(tab: BrowserTab): void {
    if (!tab.incognito && !tab.error && currentPreferences().historyEnabled)
      this.store.metadata(tab.url, tab.title || tab.url, tab.favicon)
  }

  select(result: SearchResult, query: string): void {
    if (result.kind !== 'search' && currentPreferences().historyEnabled)
      this.store.select(query, result.url)
  }

  async search(
    query: string,
    mode: SearchMode,
    signal: AbortSignal,
    tabs: BrowserTab[],
    online: boolean,
    update: (response: SearchResponse, pending: boolean) => void,
    incognito = false
  ): Promise<SearchResponse> {
    if (signal.aborted) return { results: [] }
    query = query.trim()
    if (query.startsWith('/')) return { results: [] }
    const shortcut = shortcutResult(query, this.shortcuts)
    if (!query || (shortcut && mode !== 'tabs' && mode !== 'history')) {
      const response = { results: shortcut ? [shortcut] : [] }
      update(response, false)
      return response
    }
    const generation = this.store.generation
    const cancelled = (): boolean => signal.aborted || generation !== this.store.generation
    const local = localSearchResults(query, mode, currentPreferences().searchEngine)
    const history = incognito || mode === 'search' ? [] : this.store.history(query)
    const known = new Map(history.map((entry) => [entry.url, entry]))
    if (mode === 'all' || mode === 'tabs') {
      for (const tab of tabs) {
        const entry = known.get(tab.url)
        const result: SearchResult = {
          id: `tab:${tab.id}`,
          kind: 'tab',
          tabId: tab.id,
          title: tab.title,
          url: tab.url,
          favicon: tab.favicon,
          keyword: entry && entry.queryUses >= 2 ? query : undefined
        }
        if (resultScore(query, result) > 0) local.push(result)
      }
    }
    if (mode === 'all' || mode === 'history' || mode === 'websites') {
      for (const entry of history) {
        const result: SearchResult = {
          id: `website:${entry.url}`,
          kind: 'website',
          source: 'history',
          title: entry.title,
          url: entry.url,
          favicon: entry.favicon ?? undefined,
          keyword: entry.queryUses >= 2 ? query : undefined
        }
        if (resultScore(query, result) > 0) local.push(result)
      }
    }
    const preference = (result: SearchResult): number => {
      const entry = result.kind !== 'search' ? known.get(result.url) : undefined
      return (
        (entry
          ? Math.min(20, Math.log2(entry.visits + 1) * 4) +
            Math.min(30, entry.typedVisits * 10) +
            Math.max(0, 15 - (Date.now() - entry.lastVisit) / 86400000) +
            Math.min(40, Math.log2(entry.selections + 1) * 10)
          : 0) + (result.kind === 'tab' ? 8 : 0)
      )
    }
    const rank = (results: SearchResult[]): SearchResult[] =>
      rankSearchResults(query, results, preference)
    let results = rank(local)
    let warning: string | undefined
    const response = (): SearchResponse => ({
      results: [...results],
      warning: [warning, this.store.warning].filter(Boolean).join(' ') || undefined
    })
    const provider = mode === 'websites' || mode === 'search' ? mode : undefined
    let eligible = !!provider && query.length >= 2 && query.length <= 256 && !shortcut
    try {
      eligible &&= !!resolveAddress(query)?.startsWith('https://www.google.com/search?q=')
    } catch {
      eligible = false
    }
    if (incognito || !provider || !eligible) {
      update(response(), false)
      return response()
    }
    const cached = this.store.cached(provider, query)
    if (cached) results = rank([...local, ...cached])
    const pending = online && !cached
    update(response(), pending)
    if (!pending) return response()
    try {
      const incoming: SearchResult[] =
        provider === 'websites'
          ? await getWebsites(query, signal)
          : (await getSuggestions(query, signal)).map((suggestion) => ({
              id: `search:${suggestion}`,
              kind: 'search',
              title: suggestion,
              query: suggestion
            }))
      if (cancelled()) return { results: [] }
      this.store.cache(provider, query, incoming)
      results = rank([...local, ...incoming])
    } catch {
      if (cancelled()) return { results: [] }
      warning =
        provider === 'websites'
          ? 'Website results unavailable. Google may require verification.'
          : 'Search suggestions unavailable.'
    }
    if (cancelled()) return { results: [] }
    update(response(), false)
    return response()
  }
}
