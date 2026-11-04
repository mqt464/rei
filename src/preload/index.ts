import { contextBridge, ipcRenderer } from 'electron'
import { injectBrowserAction } from 'electron-chrome-extensions/browser-action'
import type { ExtensionState } from '../shared/extensions'
import { electronAPI } from '@electron-toolkit/preload'
import type { BrowserAPI, BrowserState, FindState, SearchUpdate } from '../shared/browser'
import type { Theme } from '../shared/theme'
import type { Preferences } from '../shared/preferences'
import type { ContextMenuState } from '../shared/context-menu'
import type { SearchShortcut } from '../shared/search'
import { setKeybindCapture } from './keyboard'
import type { DownloadRecord } from '../shared/downloads'
import type { CommandsState } from '../shared/commands'

if (
  (location.hash === '' || location.hash === '#tabs') &&
  !localStorage.getItem('rei:ui-storage-migrated')
) {
  const saved = ipcRenderer.sendSync('ui:legacy-storage') as Record<string, string>
  for (const key of ['rei:suggestions', 'rei:shortcuts'])
    if (typeof saved?.[key] === 'string' && localStorage.getItem(key) === null)
      localStorage.setItem(key, saved[key])
  localStorage.setItem('rei:ui-storage-migrated', 'true')
}

if (process.argv.includes('--rei-disable-reload')) {
  window.addEventListener(
    'keydown',
    (event) => {
      if (document.activeElement?.hasAttribute('data-keybind-input')) return
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'r') return
      event.preventDefault()
      event.stopImmediatePropagation()
    },
    true
  )
}

// Custom APIs for renderer
const api: BrowserAPI = {
  getWebsitePermissions: (scope) => ipcRenderer.invoke('website-permissions:get', scope),
  resetWebsitePermission: (decision, scope) =>
    ipcRenderer.invoke('website-permissions:reset', decision, scope),
  onWebsitePermissions: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('website-permissions:changed', listener)
    return () => ipcRenderer.removeListener('website-permissions:changed', listener)
  },
  getCommands: () => ipcRenderer.invoke('commands:get'),
  toggleCommand: (id, enabled) => ipcRenderer.invoke('commands:enabled', id, enabled),
  setCommandPermission: (id, permission, granted) =>
    ipcRenderer.invoke('commands:permission', id, permission, granted),
  openCommandsFolder: () => ipcRenderer.invoke('commands:folder'),
  revealCommand: (id) => ipcRenderer.invoke('commands:reveal', id),
  removeCommand: (id) => ipcRenderer.invoke('commands:remove', id),
  runCommand: (id) => ipcRenderer.invoke('commands:run', id),
  onCommands: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: CommandsState): void =>
      callback(state)
    ipcRenderer.on('commands:changed', listener)
    return () => ipcRenderer.removeListener('commands:changed', listener)
  },
  getHistory: (query) => ipcRenderer.invoke('history:get', query),
  removeHistory: (removal) => ipcRenderer.invoke('history:remove', removal),
  openHistory: () => ipcRenderer.send('browser:tab', 'history'),
  openHistoryVisit: (id, target) => ipcRenderer.invoke('history:open', id, target),
  copyHistoryVisit: (id) => ipcRenderer.invoke('history:copy', id),
  onHistory: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('history:changed', listener)
    return () => ipcRenderer.removeListener('history:changed', listener)
  },
  getDownloads: () => ipcRenderer.invoke('downloads:get'),
  downloadAction: (id, action) => ipcRenderer.invoke('downloads:action', id, action),
  clearDownloads: () => ipcRenderer.invoke('downloads:clear'),
  openDownloadFolder: () => ipcRenderer.invoke('downloads:folder'),
  openDownloads: () => ipcRenderer.send('browser:tab', 'downloads'),
  onDownloads: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, records: DownloadRecord[]): void =>
      callback(records)
    ipcRenderer.on('downloads:changed', listener)
    return () => ipcRenderer.removeListener('downloads:changed', listener)
  },
  getFindState: () => ipcRenderer.invoke('find:get'),
  findInPage: (query, forward) => ipcRenderer.send('find:query', query, forward),
  dismissFind: (close) => ipcRenderer.send('find:dismiss', close),
  onFindState: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: FindState): void => callback(state)
    ipcRenderer.on('find:state', listener)
    return () => ipcRenderer.removeListener('find:state', listener)
  },
  onFocusFind: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('find:focus', listener)
    return () => ipcRenderer.removeListener('find:focus', listener)
  },
  getExtensions: () => ipcRenderer.invoke('extensions:get'),
  toggleExtension: (id, enabled) => ipcRenderer.invoke('extensions:toggle', id, enabled),
  removeExtension: (id) => ipcRenderer.invoke('extensions:remove', id),
  openExtensionOptions: (id) => ipcRenderer.invoke('extensions:options', id),
  openExtensionStore: () => ipcRenderer.invoke('extensions:store'),
  openExtensions: () => ipcRenderer.send('browser:tab', 'extensions'),
  onExtensions: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: ExtensionState): void =>
      callback(state)
    ipcRenderer.on('extensions:changed', listener)
    return () => ipcRenderer.removeListener('extensions:changed', listener)
  },
  setKeybindCapture,
  getContextMenu: () => ipcRenderer.invoke('context-menu:get'),
  onContextMenu: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: ContextMenuState): void =>
      callback(state)
    ipcRenderer.on('context-menu:changed', listener)
    return () => ipcRenderer.removeListener('context-menu:changed', listener)
  },
  dismissContextMenu: (id) => ipcRenderer.invoke('context-menu:dismiss', id),
  selectContextMenu: (id, itemId) => ipcRenderer.invoke('context-menu:select', id, itemId),
  chooseWallpaperFolder: () => ipcRenderer.invoke('theme:wallpaper-folder'),
  wallpaperImage: (index) => ipcRenderer.invoke('theme:wallpaper-image', index),
  getPreferences: () => ipcRenderer.invoke('preferences:get'),
  setPreferences: (patch) => ipcRenderer.invoke('preferences:set', patch),
  chooseDownloadFolder: () => ipcRenderer.invoke('preferences:download-folder'),
  onPreferences: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: Preferences): void =>
      callback(value)
    ipcRenderer.on('preferences:changed', listener)
    return () => ipcRenderer.removeListener('preferences:changed', listener)
  },
  openThemeFile: () => ipcRenderer.invoke('theme:open-file'),
  onThemeError: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string): void => callback(message)
    ipcRenderer.on('theme:error', listener)
    return () => ipcRenderer.removeListener('theme:error', listener)
  },
  getTheme: () => ipcRenderer.invoke('theme:get'),
  setTheme: (patch) => ipcRenderer.invoke('theme:set', patch),
  onTheme: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, theme: Theme): void => callback(theme)
    ipcRenderer.on('theme:changed', listener)
    return () => ipcRenderer.removeListener('theme:changed', listener)
  },
  navigate: (input) => ipcRenderer.send('browser:navigate', input),
  activate: (result, query) => ipcRenderer.send('browser:activate', result, query),
  clearSearchData: () => ipcRenderer.invoke('browser:clear-search-data'),
  suggest: (query, mode, requestId, online = true) =>
    ipcRenderer.invoke('browser:suggest', query, mode, requestId, online),
  newTab: () => ipcRenderer.send('browser:tab', 'new'),
  newIncognitoTab: () => ipcRenderer.send('browser:tab', 'incognito'),
  openSettings: () => ipcRenderer.send('browser:tab', 'settings'),
  switchTab: (id) => ipcRenderer.send('browser:tab', 'switch', id),
  closeTab: (id) => ipcRenderer.send('browser:tab', 'close', id),
  toggleMute: (id) => ipcRenderer.send('browser:tab', 'mute', id),
  reorderTab: (id, targetId) => ipcRenderer.send('browser:tab', 'reorder', id, targetId),
  getShortcuts: (legacy) => ipcRenderer.invoke('site-search:get', legacy),
  openShortcutsFile: () => ipcRenderer.invoke('site-search:open-file'),
  onShortcuts: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: SearchShortcut[]): void =>
      callback(value)
    ipcRenderer.on('site-search:changed', listener)
    return () => ipcRenderer.removeListener('site-search:changed', listener)
  },
  onShortcutsError: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string): void => callback(message)
    ipcRenderer.on('site-search:error', listener)
    return () => ipcRenderer.removeListener('site-search:error', listener)
  },
  favicon: (source) => ipcRenderer.invoke('browser:favicon', source),
  onSearchUpdate: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, update: SearchUpdate): void =>
      callback(update)
    ipcRenderer.on('browser:search-update', listener)
    return () => ipcRenderer.removeListener('browser:search-update', listener)
  },
  onSearchDataCleared: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('browser:search-data-cleared', listener)
    return () => ipcRenderer.removeListener('browser:search-data-cleared', listener)
  },
  onFocusAddress: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('browser:focus-address', listener)
    return () => ipcRenderer.removeListener('browser:focus-address', listener)
  },
  setOverlayHeight: (height) => ipcRenderer.send('browser:overlay', height),
  onTopbarHover: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, hovered: boolean): void =>
      callback(hovered)
    ipcRenderer.on('browser:topbar-hover', listener)
    return () => ipcRenderer.removeListener('browser:topbar-hover', listener)
  },
  onPageFocus: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('browser:page-focus', listener)
    return () => ipcRenderer.removeListener('browser:page-focus', listener)
  },
  onState: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: BrowserState): void =>
      callback(state)
    ipcRenderer.on('browser:state', listener)
    ipcRenderer.send('browser:ready')
    return () => ipcRenderer.removeListener('browser:state', listener)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (location.hash === '#tabs') injectBrowserAction()
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
