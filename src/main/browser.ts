import { dialog, ipcMain, View, WebContentsView } from 'electron'
import { join } from 'node:path'
import type { BaseWindow, IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron'
import type { BrowserState, BrowserTab } from '../shared/browser'
import { resolveAddress } from '../shared/navigation'
import { SearchService } from './search'
import type { SearchStore } from './search-store'
import { getFavicon } from './favicons'
import { searchModes } from '../shared/search'
import type { SearchMode, SearchResponse, SearchShortcut } from '../shared/search'

export function attachBrowser(window: BaseWindow, store: SearchStore): WebContents {
  const chrome = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false
    }
  })
  const sidebar = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false
    }
  })
  const tabs = new Map<
    string,
    { state: BrowserTab; view: WebContentsView; typed: boolean; query?: string }
  >()
  const search = new SearchService(store)
  let activeTabId = ''
  let nextTab = 0
  let overlayHeight = 38
  let sidebarVisible = true
  let controlHeld = false
  let suggestionRequest: AbortController | undefined
  window.setContentView(new View())
  window.contentView.addChildView(sidebar)
  window.contentView.addChildView(chrome)

  function resize(): void {
    const { width, height } = window.getContentBounds()
    const sideWidth = sidebarVisible ? (width < 620 ? 150 : 208) : 0
    sidebar.setBounds({ x: 0, y: 0, width: sideWidth, height })
    for (const tab of tabs.values())
      tab.view.setBounds({
        x: sideWidth,
        y: 38,
        width: Math.max(0, width - sideWidth),
        height: Math.max(0, height - 38)
      })
    const active = tabs.get(activeTabId)?.state
    chrome.setBounds({
      x: sideWidth,
      y: 0,
      width: Math.max(0, width - sideWidth),
      height: active?.url && !active.error ? Math.min(height, overlayHeight) : height
    })
  }

  function publish(): void {
    if (window.isDestroyed()) return
    for (const [id, tab] of tabs)
      tab.view.setVisible(id === activeTabId && !!tab.state.url && !tab.state.error)
    resize()
    const active = tabs.get(activeTabId)?.state
    const state: BrowserState = {
      url: active?.url ?? '',
      loading: active?.loading ?? false,
      error: active?.error ?? '',
      activeTabId,
      controlHeld,
      tabs: [...tabs.values()].map((tab) => ({ ...tab.state }))
    }
    chrome.webContents.send('browser:state', state)
    if (!sidebar.webContents.isDestroyed()) sidebar.webContents.send('browser:state', state)
  }

  function focusAddress(): void {
    chrome.webContents.focus()
    chrome.webContents.send('browser:focus-address')
  }

  function switchTab(id: string, focusPage = true): void {
    if (!tabs.has(id)) return
    activeTabId = id
    publish()
    if (!focusPage) return
    const tab = tabs.get(id)!
    if (tab.state.url) tab.view.webContents.focus()
    else focusAddress()
  }

  function keyboard(contents: WebContents): void {
    contents.on('before-input-event', (event, input) => {
      const controlKey = input.key.toLowerCase().startsWith('control') || input.code.startsWith('Control')
      const held = controlKey ? input.type === 'keyDown' : input.control
      if (controlHeld !== held) {
        controlHeld = held
        publish()
      }
      if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return
      const key = input.key.toLowerCase()
      if (input.control && /^[1-9]$/.test(key)) {
        event.preventDefault()
        const tab = [...tabs.values()][Number(key) - 1]
        if (tab) switchTab(tab.state.id)
        return
      }
      if (!['t', 'w', 'l', 'tab', 'b'].includes(key)) return
      event.preventDefault()
      if (key === 't') newTab()
      else if (key === 'w') closeTab(activeTabId)
      else if (key === 'l') focusAddress()
      else if (key === 'b') {
        sidebarVisible = !sidebarVisible
        sidebar.setVisible(sidebarVisible)
        resize()
      } else {
        const ids = [...tabs.keys()]
        switchTab(
          ids[(ids.indexOf(activeTabId) + (input.shift ? -1 : 1) + ids.length) % ids.length]
        )
      }
    })
  }

  function load(url: string, id = activeTabId, typed = false, query?: string): void {
    const tab = tabs.get(id)
    if (!tab) return
    tab.typed = typed
    tab.query = query
    tab.state.url = url
    tab.state.title = new URL(url).hostname
    tab.state.favicon = undefined
    tab.state.error = ''
    publish()
    void tab.view.webContents.loadURL(url).catch(() => {})
  }

  function newTab(url?: string): void {
    const id = String(++nextTab)
    const view = new WebContentsView({
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
    })
    const tab: BrowserTab = { id, url: url ?? '', title: 'New tab', loading: false, error: '' }
    const entry = { state: tab, view, typed: false, query: undefined as string | undefined }
    tabs.set(id, entry)
    window.contentView.addChildView(view)
    window.contentView.addChildView(chrome)
    view.setVisible(false)
    const contents = view.webContents
    let recorded = false
    function recordVisit(): void {
      if (recorded || tab.error) return
      search.visit(tab, entry.typed)
      if (entry.query)
        search.select(
          { id: `website:${tab.url}`, kind: 'website', title: tab.title, url: tab.url },
          entry.query
        )
      entry.typed = false
      entry.query = undefined
      recorded = true
    }
    keyboard(contents)
    contents.on('did-start-loading', () => {
      tab.loading = true
      tab.error = ''
      publish()
    })
    contents.on('did-stop-loading', () => {
      tab.loading = false
      publish()
    })
    contents.on('focus', () => {
      if (!window.isDestroyed()) chrome.webContents.send('browser:page-focus')
    })
    contents.on('did-navigate', (_, destination) => {
      recorded = false
      tab.url = destination
      tab.title = new URL(destination).hostname
      tab.favicon = undefined
      publish()
    })
    contents.on('did-navigate-in-page', (_, destination, mainFrame) => {
      if (mainFrame && tab.url !== destination) {
        recorded = false
        tab.url = destination
        recordVisit()
        publish()
      }
    })
    contents.on('page-title-updated', (_, title) => {
      if (contents.getURL() !== tab.url) return
      tab.title = title
      search.metadata(tab)
      publish()
    })
    contents.on('page-favicon-updated', (_, icons) => {
      if (contents.getURL() !== tab.url) return
      tab.favicon = icons.find((icon) => /^https?:\/\//i.test(icon))
      search.metadata(tab)
      publish()
    })
    contents.on('did-finish-load', () => {
      if (contents.getURL() !== tab.url || tab.error) return
      tab.title = contents.getTitle() || new URL(tab.url).hostname
      publish()
      if (recorded) search.metadata(tab)
      else recordVisit()
    })
    contents.on('did-fail-load', (_, code, description, destination, mainFrame) => {
      if (!mainFrame || code === -3) return
      tab.url = destination
      tab.loading = false
      tab.error = `Could not load this page: ${description}`
      publish()
    })
    contents.on('render-process-gone', () => {
      tab.loading = false
      tab.error = 'This page stopped responding. Enter its address to reload.'
      publish()
    })
    contents.on('will-navigate', (event, destination) => {
      if (!/^https?:\/\//i.test(destination)) event.preventDefault()
    })
    contents.on('will-redirect', (event, destination) => {
      if (!/^https?:\/\//i.test(destination)) event.preventDefault()
    })
    contents.setWindowOpenHandler(({ url: destination }) => {
      if (/^https?:\/\//i.test(destination)) newTab(destination)
      return { action: 'deny' }
    })
    switchTab(id)
    if (url) load(url, id)
  }

  function closeTab(id: string): void {
    const tab = tabs.get(id)
    if (!tab) return
    const ids = [...tabs.keys()]
    const index = ids.indexOf(id)
    tabs.delete(id)
    window.contentView.removeChildView(tab.view)
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
    if (!tabs.size) newTab()
    else if (activeTabId === id) switchTab(ids[index + 1] ?? ids[index - 1])
    else publish()
  }

  function reorderTab(id: string, targetId: string): void {
    const entries = [...tabs.entries()]
    const from = entries.findIndex(([tabId]) => tabId === id)
    const target = entries.findIndex(([tabId]) => tabId === targetId)
    if (from < 0 || target < 0 || from === target) return
    const [entry] = entries.splice(from, 1)
    entries.splice(target > from ? target - 1 : target, 0, entry)
    tabs.clear()
    for (const [tabId, tab] of entries) tabs.set(tabId, tab)
    publish()
  }

  function isTrusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    return [chrome.webContents, sidebar.webContents].some(
      (contents) =>
        !contents.isDestroyed() &&
        event.sender === contents &&
        event.senderFrame === contents.mainFrame
    )
  }

  function navigate(event: IpcMainEvent, input: unknown): void {
    if (!isTrusted(event) || typeof input !== 'string' || input.length > 8192) return
    try {
      const url = resolveAddress(input)
      if (url)
        load(url, activeTabId, !url.startsWith('https://www.google.com/search?q='), input.trim())
    } catch (error) {
      tabs.get(activeTabId)!.state.error =
        error instanceof Error ? error.message : 'Invalid address.'
      publish()
    }
  }

  function activate(event: IpcMainEvent, result: unknown, query: unknown): void {
    if (!isTrusted(event) || !result || typeof result !== 'object' || !('kind' in result)) return
    if (typeof query !== 'string' || query.length > 8192) return
    if (result.kind === 'tab' && 'tabId' in result && typeof result.tabId === 'string') {
      const tab = tabs.get(result.tabId)?.state
      if (tab) {
        search.select(
          {
            id: `tab:${tab.id}`,
            kind: 'tab',
            tabId: tab.id,
            title: tab.title,
            url: tab.url
          },
          query
        )
        switchTab(tab.id)
      }
    } else if (
      result.kind === 'search' &&
      'query' in result &&
      typeof result.query === 'string' &&
      result.query.trim() &&
      result.query.length <= 2048
    ) {
      load(`https://www.google.com/search?q=${encodeURIComponent(result.query.trim())}`)
    } else if (
      result.kind === 'website' &&
      'url' in result &&
      typeof result.url === 'string' &&
      result.url.length <= 8192
    ) {
      try {
        const url = new URL(result.url)
        if (!['http:', 'https:'].includes(url.protocol)) return
        load(url.href, activeTabId, resolveAddress(query) === url.href, query)
      } catch {
        return
      }
    }
  }

  async function suggest(
    event: IpcMainInvokeEvent,
    query: unknown,
    mode: unknown,
    requestId: unknown,
    online: unknown
  ): Promise<SearchResponse> {
    if (!isTrusted(event)) return { results: [] }
    suggestionRequest?.abort()
    suggestionRequest = undefined
    if (
      typeof query !== 'string' ||
      query.length > 256 ||
      !searchModes.some((source) => source.id === mode)
    )
      return { results: [] }
    if (typeof requestId !== 'number' || !Number.isSafeInteger(requestId)) return { results: [] }
    const controller = new AbortController()
    suggestionRequest = controller
    return search.search(
      query,
      mode as SearchMode,
      controller.signal,
      [...tabs.values()].map((tab) => tab.state),
      online === true,
      (response, pending) => {
        if (!controller.signal.aborted && !event.sender.isDestroyed())
          event.sender.send('browser:search-update', { requestId, response, pending })
      }
    )
  }

  function overlay(event: IpcMainEvent, height: unknown): void {
    if (!isTrusted(event) || typeof height !== 'number' || !Number.isFinite(height)) return
    overlayHeight = Math.max(38, Math.min(900, Math.ceil(height)))
    resize()
  }
  function tabAction(event: IpcMainEvent, action: unknown, id: unknown, targetId: unknown): void {
    if (!isTrusted(event)) return
    if (action === 'new') newTab()
    else if (action === 'reorder' && typeof id === 'string' && typeof targetId === 'string')
      reorderTab(id, targetId)
    else if (typeof id === 'string') {
      if (action === 'switch') switchTab(id, event.sender !== sidebar.webContents)
      else if (action === 'close') closeTab(id)
    }
  }
  function shortcuts(event: IpcMainEvent, value: unknown): void {
    if (!isTrusted(event) || !Array.isArray(value) || value.length > 30) return
    const valid: SearchShortcut[] = []
    for (const entry of value) {
      if (
        !entry ||
        typeof entry.keyword !== 'string' ||
        !/^[a-z0-9_-]{1,20}$/.test(entry.keyword) ||
        typeof entry.title !== 'string' ||
        !entry.title ||
        entry.title.length > 80 ||
        typeof entry.url !== 'string' ||
        entry.url.length > 2048 ||
        !entry.url.includes('{query}')
      )
        return
      try {
        if (!['http:', 'https:'].includes(new URL(entry.url).protocol)) return
      } catch {
        return
      }
      if (valid.some((shortcut) => shortcut.keyword === entry.keyword)) return
      valid.push({ keyword: entry.keyword, title: entry.title, url: entry.url })
    }
    search.shortcuts = valid
  }
  function ready(event: IpcMainEvent): void {
    if (isTrusted(event)) publish()
  }
  const listeners = {
    'browser:navigate': navigate,
    'browser:activate': activate,
    'browser:overlay': overlay,
    'browser:tab': tabAction,
    'browser:shortcuts': shortcuts,
    'browser:ready': ready
  }
  for (const [channel, listener] of Object.entries(listeners)) ipcMain.on(channel, listener)
  chrome.webContents.ipc.handle('browser:suggest', suggest)
  for (const contents of [chrome.webContents, sidebar.webContents]) {
    contents.ipc.handle('browser:favicon', (event, source: unknown) => {
      if (!isTrusted(event) || typeof source !== 'string') return null
      return getFavicon(source)
    })
  }
  keyboard(chrome.webContents)
  keyboard(sidebar.webContents)
  sidebar.webContents.on('will-navigate', (event) => event.preventDefault())
  sidebar.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  chrome.webContents.once('did-finish-load', () => {
    const url = new URL(chrome.webContents.getURL())
    url.hash = 'tabs'
    void sidebar.webContents.loadURL(url.href).catch(() => {})
    focusAddress()
  })
  const cleared = (): void => {
    suggestionRequest?.abort()
    for (const tab of tabs.values()) {
      tab.query = undefined
      tab.typed = false
    }
    if (!chrome.webContents.isDestroyed()) chrome.webContents.send('browser:search-data-cleared')
  }
  store.on('cleared', cleared)
  for (const contents of [chrome.webContents, sidebar.webContents]) {
    contents.ipc.handle('browser:clear-search-data', async (event) => {
      if (!isTrusted(event)) return false
      const { response } = await dialog.showMessageBox(window, {
        type: 'warning',
        message: 'Clear search data?',
        detail:
          'Delete saved browsing history, learned address-bar choices, and cached search results. Open tabs, cookies, downloads, and site shortcuts stay unchanged.',
        buttons: ['Clear data', 'Cancel'],
        defaultId: 1,
        cancelId: 1
      })
      if (window.isDestroyed() || response !== 0) return false
      const success = store.clear()
      if (!success)
        await dialog.showMessageBox(window, {
          type: 'error',
          message: 'Could not clear search data.',
          detail: store.warning
        })
      return success
    })
  }
  window.on('resize', resize)
  window.on('closed', () => {
    store.off('cleared', cleared)
    suggestionRequest?.abort()
    for (const [channel, listener] of Object.entries(listeners))
      ipcMain.removeListener(channel, listener)
    for (const tab of tabs.values())
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
    if (!sidebar.webContents.isDestroyed()) sidebar.webContents.close()
    if (!chrome.webContents.isDestroyed()) chrome.webContents.close()
  })
  newTab()
  return chrome.webContents
}
