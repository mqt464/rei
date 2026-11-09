import { contextBridge, ipcRenderer } from 'electron'
import { injectBrowserAction } from 'electron-chrome-extensions/browser-action'
import { electronAPI } from '@electron-toolkit/preload'
import type { BrowserAPI } from '../shared/browser'
import { setKeybindCapture } from './keyboard'
import { subscribeSignal, subscribeValue } from './events'

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

const api: BrowserAPI = {
  makeDefaultBrowser: () => ipcRenderer.invoke('browser:make-default'),
  getUpdates: () => ipcRenderer.invoke('updates:get'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdates: (callback) => subscribeValue('updates:changed', callback),
  getWebsitePermissions: (scope) => ipcRenderer.invoke('website-permissions:get', scope),
  resetWebsitePermission: (decision, scope) =>
    ipcRenderer.invoke('website-permissions:reset', decision, scope),
  onWebsitePermissions: (callback) => subscribeSignal('website-permissions:changed', callback),
  getCommands: () => ipcRenderer.invoke('commands:get'),
  toggleCommand: (id, enabled) => ipcRenderer.invoke('commands:enabled', id, enabled),
  setCommandPermission: (id, permission, granted) =>
    ipcRenderer.invoke('commands:permission', id, permission, granted),
  openCommandsFolder: () => ipcRenderer.invoke('commands:folder'),
  revealCommand: (id) => ipcRenderer.invoke('commands:reveal', id),
  removeCommand: (id) => ipcRenderer.invoke('commands:remove', id),
  runCommand: (id) => ipcRenderer.invoke('commands:run', id),
  onCommands: (callback) => subscribeValue('commands:changed', callback),
  getHistory: (query) => ipcRenderer.invoke('history:get', query),
  removeHistory: (removal) => ipcRenderer.invoke('history:remove', removal),
  openHistory: () => ipcRenderer.send('browser:tab', 'history'),
  openHistoryVisit: (id, target) => ipcRenderer.invoke('history:open', id, target),
  copyHistoryVisit: (id) => ipcRenderer.invoke('history:copy', id),
  onHistory: (callback) => subscribeSignal('history:changed', callback),
  getDownloads: () => ipcRenderer.invoke('downloads:get'),
  downloadAction: (id, action) => ipcRenderer.invoke('downloads:action', id, action),
  clearDownloads: () => ipcRenderer.invoke('downloads:clear'),
  openDownloadFolder: () => ipcRenderer.invoke('downloads:folder'),
  openDownloads: () => ipcRenderer.send('browser:tab', 'downloads'),
  onDownloads: (callback) => subscribeValue('downloads:changed', callback),
  getFindState: () => ipcRenderer.invoke('find:get'),
  findInPage: (query, forward) => ipcRenderer.send('find:query', query, forward),
  dismissFind: (close) => ipcRenderer.send('find:dismiss', close),
  onFindState: (callback) => subscribeValue('find:state', callback),
  onFocusFind: (callback) => subscribeSignal('find:focus', callback),
  getExtensions: () => ipcRenderer.invoke('extensions:get'),
  toggleExtension: (id, enabled) => ipcRenderer.invoke('extensions:toggle', id, enabled),
  removeExtension: (id) => ipcRenderer.invoke('extensions:remove', id),
  openExtensionOptions: (id) => ipcRenderer.invoke('extensions:options', id),
  openExtensionStore: () => ipcRenderer.invoke('extensions:store'),
  openExtensions: () => ipcRenderer.send('browser:tab', 'extensions'),
  onExtensions: (callback) => subscribeValue('extensions:changed', callback),
  setKeybindCapture,
  getContextMenu: () => ipcRenderer.invoke('context-menu:get'),
  onContextMenu: (callback) => subscribeValue('context-menu:changed', callback),
  dismissContextMenu: (id) => ipcRenderer.invoke('context-menu:dismiss', id),
  selectContextMenu: (id, itemId) => ipcRenderer.invoke('context-menu:select', id, itemId),
  chooseWallpaperFolder: () => ipcRenderer.invoke('theme:wallpaper-folder'),
  wallpaperImage: (index) => ipcRenderer.invoke('theme:wallpaper-image', index),
  getPreferences: () => ipcRenderer.invoke('preferences:get'),
  setPreferences: (patch) => ipcRenderer.invoke('preferences:set', patch),
  chooseDownloadFolder: () => ipcRenderer.invoke('preferences:download-folder'),
  onPreferences: (callback) => subscribeValue('preferences:changed', callback),
  openThemeFile: () => ipcRenderer.invoke('theme:open-file'),
  onThemeError: (callback) => subscribeValue('theme:error', callback),
  getTheme: () => ipcRenderer.invoke('theme:get'),
  setTheme: (patch) => ipcRenderer.invoke('theme:set', patch),
  onTheme: (callback) => subscribeValue('theme:changed', callback),
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
  onShortcuts: (callback) => subscribeValue('site-search:changed', callback),
  onShortcutsError: (callback) => subscribeValue('site-search:error', callback),
  favicon: (source) => ipcRenderer.invoke('browser:favicon', source),
  onSearchUpdate: (callback) => subscribeValue('browser:search-update', callback),
  onSearchDataCleared: (callback) => subscribeSignal('browser:search-data-cleared', callback),
  onFocusAddress: (callback) => subscribeSignal('browser:focus-address', callback),
  setOverlayHeight: (height) => ipcRenderer.send('browser:overlay', height),
  onTopbarHover: (callback) => subscribeValue('browser:topbar-hover', callback),
  onPageFocus: (callback) => subscribeSignal('browser:page-focus', callback),
  onState: (callback) => {
    const unsubscribe = subscribeValue('browser:state', callback)
    ipcRenderer.send('browser:ready')
    return unsubscribe
  }
}

if (location.hash === '#tabs') injectBrowserAction()
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
