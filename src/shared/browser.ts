import type { SearchMode, SearchResponse, SearchResult, SearchShortcut } from './search'
import type { Theme, ThemePatch } from './theme'
import type { Preferences } from './preferences'
import type { UpdateState } from './updates'
import type { ContextMenuState } from './context-menu'
import type { ExtensionState } from './extensions'
import type { DownloadAction, DownloadRecord } from './downloads'
import type { CommandPermission, CommandsState } from './commands'
import type { HistoryPage, HistoryQuery, HistoryRemoval } from './history'
import type { WebsitePermissionDecision, WebsitePermissionScope } from './website-permissions'

export interface BrowserTab {
  id: string
  incognito?: boolean
  url: string
  title: string
  loading: boolean
  error: string
  favicon?: string
  audible?: boolean
  muted?: boolean
  sleeping?: boolean
  discarded?: boolean
}

export interface BrowserState {
  url: string
  loading: boolean
  error: string
  activeTabId: string
  activeWebContentsId?: number
  controlHeld: boolean
  tabs: BrowserTab[]
}

export interface SearchUpdate {
  requestId: number
  response: SearchResponse
  pending: boolean
}

export interface BrowserAPI {
  makeDefaultBrowser: () => Promise<void>
  getUpdates: () => Promise<UpdateState>
  checkForUpdates: () => Promise<UpdateState>
  installUpdate: () => Promise<void>
  onUpdates: (callback: (state: UpdateState) => void) => () => void
  getWebsitePermissions: (scope?: WebsitePermissionScope) => Promise<WebsitePermissionDecision[]>
  resetWebsitePermission: (
    decision: WebsitePermissionDecision,
    scope?: WebsitePermissionScope
  ) => Promise<WebsitePermissionDecision[]>
  onWebsitePermissions: (callback: () => void) => () => void
  getHistory: (query: HistoryQuery) => Promise<HistoryPage>
  removeHistory: (removal: HistoryRemoval) => Promise<boolean>
  openHistory: () => void
  openHistoryVisit: (id: number, target: 'tab' | 'background' | 'incognito') => Promise<void>
  copyHistoryVisit: (id: number) => Promise<void>
  onHistory: (callback: () => void) => () => void
  getCommands: () => Promise<CommandsState>
  toggleCommand: (id: string, enabled: boolean) => Promise<CommandsState>
  setCommandPermission: (
    id: string,
    permission: CommandPermission,
    granted: boolean
  ) => Promise<CommandsState>
  openCommandsFolder: () => Promise<void>
  revealCommand: (id: string) => Promise<void>
  removeCommand: (id: string) => Promise<CommandsState>
  runCommand: (id: string) => Promise<void>
  onCommands: (callback: (state: CommandsState) => void) => () => void
  getDownloads: () => Promise<DownloadRecord[]>
  downloadAction: (id: string, action: DownloadAction) => Promise<void>
  clearDownloads: () => Promise<void>
  openDownloadFolder: () => Promise<void>
  openDownloads: () => void
  onDownloads: (callback: (records: DownloadRecord[]) => void) => () => void
  getFindState: () => Promise<FindState>
  findInPage: (query: string, forward?: boolean) => void
  dismissFind: (close: boolean) => void
  onFindState: (callback: (state: FindState) => void) => () => void
  onFocusFind: (callback: () => void) => () => void
  getExtensions: () => Promise<ExtensionState>
  toggleExtension: (id: string, enabled: boolean) => Promise<ExtensionState>
  removeExtension: (id: string) => Promise<ExtensionState>
  openExtensionOptions: (id: string) => Promise<void>
  openExtensionStore: () => Promise<void>
  openExtensions: () => void
  onExtensions: (callback: (state: ExtensionState) => void) => () => void
  setKeybindCapture: (active: boolean) => void
  getContextMenu: () => Promise<ContextMenuState | null>
  onContextMenu: (callback: (state: ContextMenuState) => void) => () => void
  dismissContextMenu: (id: number) => Promise<void>
  selectContextMenu: (id: number, itemId: number) => Promise<void>
  chooseWallpaperFolder: () => Promise<Theme>
  wallpaperImage: (index: number) => Promise<string | null>
  getPreferences: () => Promise<Preferences>
  setPreferences: (patch: Partial<Preferences>) => Promise<Preferences>
  chooseDownloadFolder: () => Promise<Preferences>
  onPreferences: (callback: (value: Preferences) => void) => () => void
  openThemeFile: () => Promise<void>
  onThemeError: (callback: (message: string) => void) => () => void
  getTheme: () => Promise<Theme>
  setTheme: (patch: ThemePatch) => Promise<Theme>
  onTheme: (callback: (theme: Theme) => void) => () => void
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
  newIncognitoTab: () => void
  openSettings: () => void
  switchTab: (id: string) => void
  closeTab: (id: string) => void
  toggleMute: (id: string) => void
  reorderTab: (id: string, targetId: string) => void
  getShortcuts: (legacy?: string | null) => Promise<SearchShortcut[]>
  openShortcutsFile: () => Promise<void>
  onShortcuts: (callback: (value: SearchShortcut[]) => void) => () => void
  onShortcutsError: (callback: (message: string) => void) => () => void
  favicon: (source: string) => Promise<string | null>
  onSearchUpdate: (callback: (update: SearchUpdate) => void) => () => void
  onSearchDataCleared: (callback: () => void) => () => void
  onFocusAddress: (callback: () => void) => () => void
  onTopbarHover: (callback: (hovered: boolean) => void) => () => void
  setOverlayHeight: (height: number) => void
  onPageFocus: (callback: () => void) => () => void
  onState: (callback: (state: BrowserState) => void) => () => void
}

export interface FindState {
  query: string
  activeMatchOrdinal: number
  matches: number
}
