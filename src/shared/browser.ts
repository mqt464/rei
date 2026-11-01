import type { SearchMode, SearchResponse, SearchResult, SearchShortcut } from './search'

export interface BrowserTab {
  id: string
  url: string
  title: string
  loading: boolean
  error: string
  favicon?: string
}

export interface BrowserState {
  url: string
  loading: boolean
  error: string
  activeTabId: string
  controlHeld: boolean
  tabs: BrowserTab[]
}

export interface SearchUpdate {
  requestId: number
  response: SearchResponse
  pending: boolean
}

export interface BrowserAPI {
  navigate: (input: string) => void
  activate: (result: SearchResult, query: string) => void
  clearSearchData: () => Promise<boolean>
  suggest: (
    query: string,
    mode: SearchMode,
    requestId?: number,
    online?: boolean
  ) => Promise<SearchResponse>
  newTab: () => void
  switchTab: (id: string) => void
  closeTab: (id: string) => void
  reorderTab: (id: string, targetId: string) => void
  setShortcuts: (shortcuts: SearchShortcut[]) => void
  favicon: (source: string) => Promise<string | null>
  onSearchUpdate: (callback: (update: SearchUpdate) => void) => () => void
  onSearchDataCleared: (callback: () => void) => () => void
  onFocusAddress: (callback: () => void) => () => void
  setOverlayHeight: (height: number) => void
  onPageFocus: (callback: () => void) => () => void
  onState: (callback: (state: BrowserState) => void) => () => void
}
