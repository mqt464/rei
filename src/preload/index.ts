import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { BrowserAPI, BrowserState, SearchUpdate } from '../shared/browser'

// Custom APIs for renderer
const api: BrowserAPI = {
  navigate: (input) => ipcRenderer.send('browser:navigate', input),
  activate: (result, query) => ipcRenderer.send('browser:activate', result, query),
  clearSearchData: () => ipcRenderer.invoke('browser:clear-search-data'),
  suggest: (query, mode, requestId, online = true) =>
    ipcRenderer.invoke('browser:suggest', query, mode, requestId, online),
  newTab: () => ipcRenderer.send('browser:tab', 'new'),
  switchTab: (id) => ipcRenderer.send('browser:tab', 'switch', id),
  closeTab: (id) => ipcRenderer.send('browser:tab', 'close', id),
  reorderTab: (id, targetId) => ipcRenderer.send('browser:tab', 'reorder', id, targetId),
  setShortcuts: (shortcuts) => ipcRenderer.send('browser:shortcuts', shortcuts),
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
