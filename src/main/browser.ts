import {
  app,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  screen,
  session,
  systemPreferences,
  View,
  WebContentsView
} from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { EventEmitter } from 'node:events'
import { BrowserContextMenu } from './context-menu'
import { PageFinder } from './find-in-page'
import type { BaseWindow, IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron'
import type { BrowserState, BrowserTab } from '../shared/browser'
import { splitGeometry, splitDividerWidth, splitDividerHitWidth } from '../shared/split'
import {
  downloadsUrl,
  historyUrl,
  isInternalUrl,
  isSettingsUrl,
  resolveAddress,
  settingsUrl
} from '../shared/navigation'
import { registerDownloads } from './downloads'
import { isInstallingUpdate, registerUpdates } from './updates'
import { registerDefaultBrowser, registerLinkWindow } from './default-browser'
import { commandsRuntime } from './commands'
import { registerPlayingMedia } from './playing-media'
import { SearchService } from './search'
import type { SearchStore } from './search-store'
import { getFavicon } from './favicons'
import { currentTheme, registerTheme } from './theme'
import { registerSiteSearch } from './site-search'
import {
  currentPreferences,
  hasActiveDownload,
  registerPreferences,
  registerSessionPreferences
} from './preferences'
import { themeColors, themeFonts } from '../shared/theme'
import { websiteScrollbarCSS } from '../shared/website-scrollbars'
import { closeSession, saveSession, startupSession } from './session'
import { freezeTab, thawTab, TabSnapshotStore } from './tab-memory'
import type { TabSnapshot } from './tab-memory'
import { searchUrl } from '../shared/preferences'
import { searchModes } from '../shared/search'
import { createKeybindMatcher } from '../shared/keyboard'
import { parseHistoryQuery, parseHistoryRemoval } from '../shared/history'
import { uiPartition } from './extensions'
import type { ExtensionRuntime } from './extensions'
import { legacyUIStorage } from './ui-storage'
import {
  clearPrivateWebsitePermissions,
  registerWebsitePermissions,
  registerWebsitePermissionSettings
} from './website-permissions'
import type { SearchMode, SearchResponse } from '../shared/search'

interface TabEntry {
  state: BrowserTab
  view?: WebContentsView
  typed: boolean
  query?: string
  lastActive: number
  scroll: [number, number]
  appearanceCss?: string
  zoom?: number
  transition?: Promise<void>
  waking?: Promise<void>
  navigationVersion?: number
  unbind?: () => void
  incognitoPartition?: string
}

export interface DetachedTab {
  tab: TabEntry
  x: number
  y: number
}

let nextTab = 0
const privatePartitions = new Map<number, () => Set<string>>()
const tabWindows = new Map<
  number,
  (id: string, receive: (tab: TabEntry) => void) => Promise<void>
>()
let tabDrag: { token: string; windowId: number; id: string } | undefined

function createUIView(additionalArguments: string[] = []): WebContentsView {
  return new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      additionalArguments,
      partition: uiPartition,
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false
    }
  })
}

export function attachBrowser(
  window: BaseWindow,
  store: SearchStore,
  extensions?: ExtensionRuntime,
  openWindow?: (detached: DetachedTab) => void,
  detached?: DetachedTab
): WebContents {
  const windowId = window.id
  const chrome = createUIView(app.isPackaged ? ['--rei-disable-reload'] : [])
  const sidebar = createUIView()
  const tabs = new Map<string, TabEntry>()
  const splitBar = createUIView()
  splitBar.setVisible(false)
  const splitDivider = createUIView()
  splitDivider.setVisible(false)
  const uiContents = [chrome, sidebar, splitBar, splitDivider].map((view) => view.webContents)
  let splitGesture: { kind: 'move' | 'resize'; tabId: string; initialRatio: number } | undefined
  let layoutAnimation: ReturnType<typeof setInterval> | undefined
  let layoutProgress = 1
  const layoutFrom = new Map<string, Electron.Rectangle>()
  const closedTabs: { url: string; index: number }[] = []
  const snapshots = new TabSnapshotStore()
  let incognitoPartition = detached?.tab.incognitoPartition
  privatePartitions.set(
    windowId,
    () =>
      new Set(
        [...tabs.values()].flatMap((tab) =>
          tab.incognitoPartition ? [tab.incognitoPartition] : []
        )
      )
  )
  const search = new SearchService(store)
  const contextMenu = new BrowserContextMenu(
    window,
    chrome.webContents,
    (destination, disposition) => {
      if (/^https?:\/\//i.test(destination))
        newTab(
          destination,
          disposition === 'background-tab' ||
            (disposition === 'default' && currentPreferences().backgroundTabs),
          undefined,
          !!tabs.get(activeTabId)?.state.incognito
        )
    },
    keyboard,
    extensions
  )
  let activeTabId = ''
  const finder = new PageFinder(window, chrome.webContents, keyboard)
  let overlayHeight = 38
  let pointerNearTopbar = false
  let sidebarVisible = true
  let pointerNearSidebar = false
  let sidebarWidth = 208
  let sidebarAnimation: ReturnType<typeof setInterval> | undefined
  let controlHeld = false
  let suggestionRequest: AbortController | undefined
  let initializing = true
  let registeringExtensionTab = false
  const appearanceVersions = new WeakMap<WebContents, number>()
  const sleepChecks = new Set<string>()
  const detachingTabs = new Set<string>()
  let websiteAppearance = ''
  let fullscreenTabId: string | undefined
  window.setContentView(new View())
  window.contentView.addChildView(sidebar)
  window.contentView.addChildView(chrome)
  window.contentView.addChildView(splitBar)
  window.contentView.addChildView(splitDivider)

  function activeSplit(): BrowserState['split'] {
    const tab = tabs.get(activeTabId)?.state
    if (!tab?.split) return
    const extra = {
      ratio: tab.split.ratio ?? 0.5,
      width: Math.max(0, window.getContentBounds().width - sidebarWidth),
      gesture: splitGesture?.kind
    }
    return tab.split.side === 'left'
      ? { leftId: tab.id, rightId: tab.split.partnerId, ...extra }
      : { leftId: tab.split.partnerId, rightId: tab.id, ...extra }
  }

  function visibleTab(id: string): boolean {
    const split = activeSplit()
    return id === activeTabId || id === split?.leftId || id === split?.rightId
  }

  function clearSplit(id: string): void {
    const tab = tabs.get(id)?.state
    if (!tab?.split) return
    if (splitGesture && visibleTab(id)) finishSplitGesture(true)
    const partner = tabs.get(tab.split.partnerId)?.state
    delete tab.split
    if (partner) delete partner.split
  }

  function canSplit(id: string): boolean {
    const tab = tabs.get(id)?.state
    return !!tab && /^https?:/.test(tab.url) && !tab.error
  }

  function animateLayout(change: () => void): void {
    clearInterval(layoutAnimation)
    layoutFrom.clear()
    for (const [id, tab] of tabs)
      if (tab.view && visibleTab(id)) layoutFrom.set(id, tab.view.getBounds())
    change()
    const theme = currentTheme()
    const duration =
      theme.motion === 'system' && !systemPreferences.getAnimationSettings().prefersReducedMotion
        ? 22000 / theme.animationSpeed
        : 0
    layoutProgress = duration ? 0 : 1
    publish()
    if (!duration) return
    const started = Date.now()
    layoutAnimation = setInterval(() => {
      const progress = Math.min(1, (Date.now() - started) / duration)
      layoutProgress = 1 - (1 - progress) ** 3
      resize()
      if (progress === 1) {
        clearInterval(layoutAnimation)
        layoutAnimation = undefined
        layoutFrom.clear()
      }
    }, 8)
  }

  function splitTab(id: string): void {
    if (id === activeTabId || !canSplit(id) || !canSplit(activeTabId)) return
    if (!!tabs.get(id)!.state.incognito !== !!tabs.get(activeTabId)!.state.incognito) return
    if (tabs.get(activeTabId)!.state.split?.partnerId === id) return
    animateLayout(() => {
      clearSplit(activeTabId)
      clearSplit(id)
      tabs.get(activeTabId)!.state.split = { partnerId: id, side: 'left' }
      tabs.get(id)!.state.split = { partnerId: activeTabId, side: 'right' }
      tabs.get(id)!.lastActive = Date.now()
      void wakeTab(tabs.get(id)!)
    })
  }

  function swapSplit(id: string): void {
    const tab = tabs.get(id)?.state
    const partner = tab?.split && tabs.get(tab.split.partnerId)?.state
    if (!tab?.split || !partner?.split) return
    animateLayout(() => {
      tab.split!.side = tab.split!.side === 'left' ? 'right' : 'left'
      partner.split!.side = tab.split!.side === 'left' ? 'right' : 'left'
    })
  }

  function setSplitRatio(id: string, ratio: number): void {
    const tab = tabs.get(id)?.state
    const partner = tab?.split && tabs.get(tab.split.partnerId)?.state
    if (!tab?.split || !partner?.split) return
    const width = window.getContentBounds().width - sidebarWidth
    const next = splitGeometry(width, ratio).ratio
    tab.split.ratio = next
    partner.split.ratio = next
  }

  function finishSplitGesture(cancelled = false): void {
    if (!splitGesture) return
    const gesture = splitGesture
    splitGesture = undefined
    if (cancelled && gesture.kind === 'resize') setSplitRatio(gesture.tabId, gesture.initialRatio)
    publish()
  }

  function splitAction(event: IpcMainEvent, action: unknown, id: unknown, value: unknown): void {
    if (!isTrusted(event)) return
    const header = event.sender === splitBar.webContents
    const divider = event.sender === splitDivider.webContents
    if (!header && !divider) return
    if (action === 'finish') {
      if ((header && splitGesture?.kind === 'move') || (divider && splitGesture?.kind === 'resize'))
        finishSplitGesture(value === true)
      return
    }
    if (typeof id !== 'string' || !visibleTab(id) || !tabs.get(id)?.state.split || fullscreenTabId)
      return
    if (action === 'begin' && ((header && value === 'move') || (divider && value === 'resize'))) {
      finishSplitGesture(true)
      clearInterval(layoutAnimation)
      layoutAnimation = undefined
      layoutProgress = 1
      layoutFrom.clear()
      splitGesture = { kind: value, tabId: id, initialRatio: activeSplit()!.ratio }
      publish()
    } else if (action === 'move' && header && (value === 'left' || value === 'right')) {
      splitGesture = undefined
      if (tabs.get(id)!.state.split!.side !== value) swapSplit(id)
      else publish()
    } else if (
      action === 'resize' &&
      divider &&
      typeof value === 'number' &&
      Number.isFinite(value)
    ) {
      setSplitRatio(id, value)
      publish()
    }
  }

  function resize(animateSidebar = false): void {
    const { width, height } = window.getContentBounds()
    if (fullscreenTabId) {
      sidebar.setVisible(false)
      chrome.setVisible(false)
      splitBar.setVisible(false)
      splitDivider.setVisible(false)
      for (const [id, tab] of tabs) tab.view?.setVisible(id === fullscreenTabId)
      tabs.get(fullscreenTabId)?.view?.setBounds({ x: 0, y: 0, width, height })
      return
    }
    chrome.setVisible(true)
    for (const [id, tab] of tabs)
      tab.view?.setVisible(
        visibleTab(id) && !!tab.state.url && !isInternalUrl(tab.state.url) && !tab.state.error
      )
    if (!sidebarAnimation)
      sidebarWidth = sidebarVisible || pointerNearSidebar ? desiredSidebarWidth() : 0
    const sideWidth = sidebarWidth
    sidebar.setVisible(sideWidth > 0)
    sidebar.setBounds({ x: 0, y: 0, width: sideWidth, height })
    const split = activeSplit()
    const contentWidth = Math.max(0, width - sideWidth)
    const paneTop = overlayHeight + (split ? 36 : 0)
    const { leftWidth, rightWidth } = splitGeometry(contentWidth, split?.ratio)
    splitBar.setVisible(!!split)
    splitDivider.setVisible(!!split && splitGesture?.kind !== 'move')
    if (split) {
      splitBar.setBounds({
        x: sideWidth,
        y: overlayHeight,
        width: contentWidth,
        height: splitGesture?.kind === 'move' ? Math.max(36, height - overlayHeight) : 36
      })
      const resizing = splitGesture?.kind === 'resize'
      splitDivider.setBounds({
        x: resizing
          ? sideWidth
          : sideWidth + leftWidth - (splitDividerHitWidth - splitDividerWidth) / 2,
        y: paneTop,
        width: resizing ? contentWidth : splitDividerHitWidth,
        height: Math.max(0, height - paneTop)
      })
    }
    const resizedTabs = animateSidebar
      ? [...tabs.values()].filter((tab) => visibleTab(tab.state.id))
      : tabs.values()
    for (const tab of resizedTabs) {
      if (!tab.view) continue
      const right = split?.rightId === tab.state.id
      const paired = !!split && visibleTab(tab.state.id)
      const target = {
        x: Math.round(sideWidth + (paired && right ? leftWidth + splitDividerWidth : 0)),
        y: paired ? paneTop : overlayHeight,
        width: paired ? (right ? rightWidth : leftWidth) : contentWidth,
        height: Math.max(0, height - (paired ? paneTop : overlayHeight))
      }
      const from = layoutFrom.get(tab.state.id) ?? { ...target, x: width, width: 0 }
      tab.view.setBounds(
        layoutProgress === 1 || !visibleTab(tab.state.id)
          ? target
          : {
              x: Math.round(from.x + (target.x - from.x) * layoutProgress),
              y: Math.round(from.y + (target.y - from.y) * layoutProgress),
              width: Math.max(
                0,
                Math.round(from.width + (target.width - from.width) * layoutProgress)
              ),
              height: Math.max(
                0,
                Math.round(from.height + (target.height - from.height) * layoutProgress)
              )
            }
      )
    }
    const active = tabs.get(activeTabId)?.state
    chrome.setBounds({
      x: sideWidth,
      y: 0,
      width: Math.max(0, width - sideWidth),
      height:
        active?.url && !isInternalUrl(active.url) && !active.error
          ? Math.min(height, overlayHeight)
          : height
    })
    const focusedBounds = split ? tabs.get(activeTabId)?.view?.getBounds() : undefined
    finder.resize(
      focusedBounds?.x ?? sideWidth,
      focusedBounds?.y ?? overlayHeight,
      focusedBounds ? focusedBounds.x + focusedBounds.width : width
    )
  }

  function publish(): void {
    if (window.isDestroyed()) return
    for (const [id, tab] of tabs)
      if (tab.state.split && (!canSplit(id) || !canSplit(tab.state.split.partnerId))) clearSplit(id)
    resize()
    const active = tabs.get(activeTabId)?.state
    finder.sync(`${activeTabId}:${active?.url ?? ''}`)
    const state: BrowserState = {
      url: active?.url ?? '',
      loading: active?.loading ?? false,
      error: active?.error ?? '',
      activeTabId,
      activeWebContentsId: tabs.get(activeTabId)?.view?.webContents.id,
      controlHeld,
      split: activeSplit(),
      tabs: [...tabs.values()].map((tab) => ({ ...tab.state }))
    }
    chrome.webContents.send('browser:state', state)
    if (!sidebar.webContents.isDestroyed()) sidebar.webContents.send('browser:state', state)
    if (!splitBar.webContents.isDestroyed()) splitBar.webContents.send('browser:state', state)
    if (!splitDivider.webContents.isDestroyed())
      splitDivider.webContents.send('browser:state', state)
    if (!initializing) saveSession(windowId, state.tabs, activeTabId)
  }

  function desiredSidebarWidth(): number {
    const theme = currentTheme()
    return theme.sidebarIconsOnly
      ? 52
      : window.getContentBounds().width < 620
        ? 150
        : Math.min(theme.sidebarWidth, Math.max(150, window.getContentBounds().width - 280))
  }

  async function applyWebsiteAppearance(tab: TabEntry): Promise<void> {
    if (!tab.view) return
    const contents = tab.view.webContents
    if (contents.isDestroyed() || tab.state.sleeping || !/^https?:/.test(tab.state.url)) return
    const version = (appearanceVersions.get(contents) ?? 0) + 1
    appearanceVersions.set(contents, version)
    const theme = currentTheme()
    const css = [
      theme.webpageFont !== 'website'
        ? `font-family:${themeFonts[theme.webpageFont].family} !important`
        : '',
      theme.webpageFontSize ? `font-size:${theme.webpageFontSize}px !important` : '',
      theme.webpageLineHeight ? `line-height:${theme.webpageLineHeight / 100} !important` : ''
    ]
      .filter(Boolean)
      .join(';')
    try {
      if (tab.appearanceCss) {
        const previous = tab.appearanceCss
        tab.appearanceCss = undefined
        await contents.removeInsertedCSS(previous)
      }
      if (version !== appearanceVersions.get(contents) || contents.isDestroyed()) return
      const appearanceCSS = `${css ? `:where(body, body *):not(pre, code, pre *, code *, svg, svg *) { ${css} }` : ''}
        ${websiteScrollbarCSS(theme, nativeTheme.shouldUseDarkColors)}`
      const key = await contents.insertCSS(appearanceCSS, { cssOrigin: 'user' })
      if (version !== appearanceVersions.get(contents)) await contents.removeInsertedCSS(key)
      else tab.appearanceCss = key
    } catch {
      return
    }
  }

  function applyAppearance(): void {
    if (window.isDestroyed()) return
    resize()
    const value = currentTheme()
    const background = themeColors(value, nativeTheme.shouldUseDarkColors).background
    const appearance = JSON.stringify([
      value.webpageFont,
      value.webpageFontSize,
      value.webpageLineHeight,
      websiteScrollbarCSS(value, nativeTheme.shouldUseDarkColors)
    ])
    for (const tab of tabs.values()) {
      tab.view?.setBackgroundColor(background)
      if (appearance !== websiteAppearance) void applyWebsiteAppearance(tab)
    }
    websiteAppearance = appearance
  }

  function focusAddress(): void {
    chrome.webContents.focus()
    chrome.webContents.send('browser:focus-address')
  }

  function toggleSidebar(): void {
    sidebarVisible = !sidebarVisible
    pointerNearSidebar = false
    animateSidebar()
  }

  function animateSidebar(): void {
    if (sidebarAnimation) clearInterval(sidebarAnimation)
    const visible = sidebarVisible || pointerNearSidebar
    const from = sidebarWidth
    const to = visible ? desiredSidebarWidth() : 0
    const start = Date.now()
    const theme = currentTheme()
    const duration =
      theme.motion !== 'system' || systemPreferences.getAnimationSettings().prefersReducedMotion
        ? 0
        : 18000 / theme.animationSpeed
    if (visible) sidebar.setVisible(true)
    sidebarAnimation = setInterval(() => {
      const progress = duration ? Math.min(1, (Date.now() - start) / duration) : 1
      const eased = 1 - (1 - progress) ** 3
      sidebarWidth = from + (to - from) * eased
      resize(progress < 1)
      if (progress === 1) {
        clearInterval(sidebarAnimation)
        sidebarAnimation = undefined
        if (!visible) sidebar.setVisible(false)
      }
    }, 8)
  }

  function switchTab(id: string, focusPage = true): void {
    if (splitGesture) finishSplitGesture(true)
    if (!tabs.has(id)) return
    contextMenu.dismiss(false)
    if (activeTabId !== id) suggestionRequest?.abort()
    for (const tab of tabs.values()) if (visibleTab(tab.state.id)) tab.lastActive = Date.now()
    if (!visibleTab(id)) {
      clearInterval(layoutAnimation)
      layoutAnimation = undefined
      layoutProgress = 1
      layoutFrom.clear()
    }
    activeTabId = id
    const selected = tabs.get(id)!
    const partnerId = selected.state.split?.partnerId
    if (partnerId && tabs.has(partnerId)) {
      tabs.get(partnerId)!.lastActive = Date.now()
      void wakeTab(tabs.get(partnerId)!)
    }
    selected.lastActive = Date.now()
    void wakeTab(selected).then(() => {
      if (selected.view && activeTabId === id && !selected.state.incognito)
        extensions?.api.selectTab(selected.view.webContents)
      if (
        focusPage &&
        activeTabId === id &&
        /^https?:/.test(selected.state.url) &&
        !window.isDestroyed()
      )
        selected.view?.webContents.focus()
    })
    publish()
    if (!focusPage) return
    const tab = tabs.get(id)!
    if (isInternalUrl(tab.state.url)) {
      chrome.webContents.focus()
      chrome.webContents.send('browser:page-focus')
    } else if (tab.state.url) tab.view?.webContents.focus()
    else focusAddress()
  }

  let capturingKeybind = false
  chrome.webContents.ipc.on('keybinds:capture', (event, active: unknown) => {
    if (isTrusted(event) && typeof active === 'boolean') capturingKeybind = active
    event.returnValue = null
  })
  chrome.webContents.on('did-start-loading', () => {
    capturingKeybind = false
  })

  function keyboard(contents: WebContents): void {
    const matcher = createKeybindMatcher()
    let suppressedKey = ''
    let bindings = currentPreferences().keybindings
    contents.ipc.on('keybinds:get', (event) => {
      event.returnValue = currentPreferences().keybindings
    })
    contents.on('blur', () => {
      matcher.reset()
      if (contents === chrome.webContents) capturingKeybind = false
    })
    contents.on('before-input-event', (event, input) => {
      if (controlHeld !== input.control) {
        controlHeld = input.control
        publish()
      }
      if (input.type !== 'keyDown' || input.isComposing) {
        if (input.key === suppressedKey) suppressedKey = ''
        return
      }
      if (contents === chrome.webContents && capturingKeybind) {
        matcher.reset()
        return
      }
      if (bindings !== currentPreferences().keybindings) {
        bindings = currentPreferences().keybindings
        matcher.reset()
      }
      if (input.isAutoRepeat) {
        if (input.key === suppressedKey) event.preventDefault()
        return
      }
      const result = matcher.match(input, bindings)
      suppressedKey = result.consumed ? input.key : ''
      if (!result.consumed) return
      const action = result.action
      if (!action) return
      contextMenu.dismiss(false)
      if (/^tab[1-9]$/.test(action)) {
        const tab = [...tabs.values()][Number(action.slice(3)) - 1]
        if (tab) switchTab(tab.state.id)
        return
      }
      if (action === 'newTab') newTab()
      else if (action === 'newIncognitoTab') newTab(undefined, false, undefined, true)
      else if (action === 'closeTab') closeTab(activeTabId)
      else if (action === 'reopenTab') {
        const closed = closedTabs.pop()
        if (closed) {
          const targetId = [...tabs.keys()][closed.index]
          const tab = newTab(closed.url)
          if (targetId) reorderTab(tab.state.id, targetId)
        }
      } else if (action === 'focusAddress') focusAddress()
      else if (action === 'findInPage') {
        const tab = tabs.get(activeTabId)
        const source =
          tab?.view && !isInternalUrl(tab.state.url) && !tab.state.error
            ? tab.view.webContents
            : chrome.webContents
        void finder.show(source, `${activeTabId}:${tab?.state.url ?? ''}`).then(() => resize())
      } else if (action === 'toggleSidebar') toggleSidebar()
      else if (action === 'devtools') {
        if (app.isPackaged) return
        const page = tabs.get(activeTabId)?.view?.webContents
        ;(page?.isFocused() ? page : chrome.webContents).toggleDevTools()
      } else if (action === 'downloads') {
        const existing = [...tabs.values()].find((tab) => tab.state.url === downloadsUrl)
        if (existing) switchTab(existing.state.id)
        else newTab(downloadsUrl)
      } else if (action === 'history') {
        openHistory()
      } else if (action === 'settings') {
        const existing = [...tabs.values()].find((tab) => isSettingsUrl(tab.state.url))
        if (existing) switchTab(existing.state.id)
        else newTab(settingsUrl)
      } else if (action === 'nextTab' || action === 'previousTab') {
        const ids = [...tabs.keys()]
        switchTab(
          ids[
            (ids.indexOf(activeTabId) + (action === 'previousTab' ? -1 : 1) + ids.length) %
              ids.length
          ]
        )
      } else {
        const tab = tabs.get(activeTabId)
        const page = tab?.view?.webContents
        if (!tab || !page || !/^https?:/.test(tab.state.url)) return
        if (action === 'back' && page.navigationHistory.canGoBack()) page.navigationHistory.goBack()
        else if (action === 'forward' && page.navigationHistory.canGoForward())
          page.navigationHistory.goForward()
        else if (action === 'reload') page.reload()
        else if (action === 'hardReload') page.reloadIgnoringCache()
        else if (action === 'mute') toggleMute(tab.state.id)
        else if (['zoomIn', 'zoomOut', 'resetZoom'].includes(action)) {
          tab.zoom =
            action === 'resetZoom'
              ? currentPreferences().defaultZoom / 100
              : Math.max(
                  0.25,
                  Math.min(5, page.getZoomFactor() + (action === 'zoomIn' ? 0.1 : -0.1))
                )
          page.setZoomFactor(tab.zoom)
        }
      }
    })
  }

  function load(url: string, id = activeTabId, typed = false, query?: string): void {
    const tab = tabs.get(id)
    if (!tab) return
    tab.lastActive = Date.now()
    const version = (tab.navigationVersion ?? 0) + 1
    tab.navigationVersion = version
    void wakeTab(tab, false).then(() => {
      if (
        window.isDestroyed() ||
        tabs.get(id) !== tab ||
        tab.navigationVersion !== version ||
        !tab.view
      )
        return
      tab.scroll = [0, 0]
      tab.typed = typed
      tab.query = query
      tab.state.url = url
      tab.state.title = new URL(url).hostname
      tab.state.favicon = undefined
      tab.state.error = ''
      if (isInternalUrl(url)) {
        tab.view.webContents.stop()
        tab.state.title = url === downloadsUrl ? 'Downloads' : 'Settings'
        tab.state.loading = false
        tab.typed = false
        tab.query = undefined
        publish()
        if (tab.view.webContents.getURL())
          void tab.view.webContents.loadURL('about:blank').catch(() => {})
        return
      }
      publish()
      void tab.view.webContents.loadURL(url).catch(() => {})
    })
  }

  function newTab(
    url: string | undefined = undefined,
    background = false,
    afterTabId?: string,
    incognito = false
  ): TabEntry {
    url ??= incognito ? '' : currentPreferences().newTabUrl
    const id = String(++nextTab)
    const entry: TabEntry = {
      state: {
        id,
        incognito,
        url: url ?? '',
        title: incognito ? 'Incognito tab' : 'New tab',
        loading: false,
        error: '',
        sleeping: false,
        discarded: false
      },
      typed: false,
      lastActive: Date.now(),
      scroll: [0, 0]
    }
    if (afterTabId && tabs.has(afterTabId)) {
      const entries = [...tabs]
      tabs.clear()
      for (const [existingId, existingTab] of entries) {
        tabs.set(existingId, existingTab)
        if (existingId === afterTabId) tabs.set(id, entry)
      }
    }
    tabs.set(id, entry)
    createTabView(entry)
    if (!background) switchTab(id)
    else publish()
    if (url) load(url, id)
    return entry
  }

  function createTabView(entry: TabEntry): void {
    const tab = entry.state
    if (tab.incognito)
      entry.incognitoPartition ??= incognitoPartition ??= `rei-incognito-${randomUUID()}`
    const existingView = entry.view
    const view =
      existingView ??
      new WebContentsView({
        webPreferences: {
          preload: join(__dirname, '../preload/keyboard.js'),
          additionalArguments: ['--rei-browsing'],
          partition: tab.incognito ? entry.incognitoPartition : undefined,
          nodeIntegration: false,
          nodeIntegrationInSubFrames: true,
          contextIsolation: true,
          sandbox: true
        }
      })
    entry.view = view
    if (!existingView) {
      registerPlayingMedia(view.webContents)
      entry.appearanceCss = undefined
    }
    view.setBackgroundColor(themeColors(currentTheme(), nativeTheme.shouldUseDarkColors).background)
    window.contentView.addChildView(view)
    window.contentView.addChildView(chrome)
    window.contentView.addChildView(splitBar)
    window.contentView.addChildView(splitDivider)
    view.setVisible(false)
    const contents = view.webContents
    registerWebsitePermissions(contents, window, !!tab.incognito)
    registerSessionPreferences(contents.session, !!tab.incognito)
    const listenersBefore = [contents, contents.ipc].map((emitter: EventEmitter) => ({
      emitter,
      listeners: new Set(emitter.eventNames().flatMap((name) => emitter.listeners(name)))
    }))
    if (extensions && !tab.incognito) {
      registeringExtensionTab = true
      try {
        extensions.api.addTab(contents, window)
        const selected = tabs.get(activeTabId)?.view
        if (selected && !tabs.get(activeTabId)?.state.incognito)
          extensions.api.selectTab(selected.webContents)
      } finally {
        registeringExtensionTab = false
      }
    }
    const leaveFullscreen = (): void => {
      if (fullscreenTabId !== tab.id) return
      fullscreenTabId = undefined
      if (!window.isDestroyed()) resize()
    }
    contents.on('enter-html-full-screen', () => {
      finishSplitGesture(true)
      fullscreenTabId = tab.id
      finder.close()
      resize()
    })
    contents.on('leave-html-full-screen', leaveFullscreen)
    contents.on('destroyed', leaveFullscreen)
    contents.on('render-process-gone', leaveFullscreen)
    contents.ipc.on('privacy:get', (event) => {
      const { doNotTrack, globalPrivacyControl, autoRejectConsent } = currentPreferences()
      event.returnValue = { doNotTrack, globalPrivacyControl, autoRejectConsent }
    })
    contents.on('context-menu', (_event, params) => {
      void contextMenu.show(contents, params, !!tab.incognito)
    })
    contents.setZoomFactor(entry.zoom ?? currentPreferences().defaultZoom / 100)
    contents.setAudioMuted(!!tab.muted)
    let recorded = false
    function recordVisit(): void {
      if (recorded || tab.incognito || tab.error || isInternalUrl(tab.url)) return
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
      if (isInternalUrl(tab.url) || tab.sleeping) return
      tab.loading = true
      tab.error = ''
      publish()
    })
    contents.on('did-stop-loading', () => {
      tab.loading = false
      publish()
    })
    contents.on('focus', () => {
      if (!window.isDestroyed()) {
        if (visibleTab(tab.id) && activeTabId !== tab.id) switchTab(tab.id, false)
        chrome.webContents.send('browser:page-focus')
        if (!sidebar.webContents.isDestroyed()) sidebar.webContents.send('browser:page-focus')
      }
    })
    contents.on('did-navigate', (_, destination) => {
      entry.appearanceCss = undefined
      appearanceVersions.set(contents, (appearanceVersions.get(contents) ?? 0) + 1)
      if (isInternalUrl(tab.url) || tab.sleeping) return
      recorded = false
      tab.url = destination
      tab.title = new URL(destination).hostname
      tab.favicon = undefined
      publish()
    })
    contents.on('did-navigate-in-page', (_, destination, mainFrame) => {
      if (mainFrame && !isInternalUrl(tab.url) && !tab.sleeping && tab.url !== destination) {
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
    contents.on('audio-state-changed', ({ audible }) => {
      tab.audible = audible
      tab.muted = contents.isAudioMuted()
      publish()
    })
    contents.on('did-finish-load', () => {
      contents.setZoomFactor(entry.zoom ?? currentPreferences().defaultZoom / 100)
      if (tab.sleeping) return
      void applyWebsiteAppearance(entry)
      if (entry.scroll[0] || entry.scroll[1]) {
        void contents
          .executeJavaScript(`scrollTo(${entry.scroll[0]},${entry.scroll[1]})`)
          .catch(() => {})
        entry.scroll = [0, 0]
      }
      if (contents.getURL() !== tab.url || tab.error) return
      tab.title = contents.getTitle() || new URL(tab.url).hostname
      publish()
      if (recorded) search.metadata(tab)
      else recordVisit()
    })
    contents.on('did-fail-load', (_, code, description, destination, mainFrame) => {
      if (!mainFrame || code === -3 || isInternalUrl(tab.url) || tab.sleeping) return
      tab.url = destination
      tab.loading = false
      tab.error = `Could not load this page: ${description}`
      publish()
    })
    contents.on('render-process-gone', () => {
      if (isInternalUrl(tab.url) || tab.discarded) return
      tab.sleeping = false
      tab.loading = false
      tab.error = 'This page stopped responding. Enter its address to reload.'
      publish()
    })
    contents.on('will-navigate', (event, destination) => {
      if (!(extensions?.allowedURL(destination) ?? /^https?:\/\//i.test(destination)))
        event.preventDefault()
    })
    contents.on('will-redirect', (event, destination) => {
      if (!(extensions?.allowedURL(destination) ?? /^https?:\/\//i.test(destination)))
        event.preventDefault()
    })
    contents.setWindowOpenHandler(({ url: destination, disposition }) => {
      if (extensions?.allowedURL(destination) ?? /^https?:\/\//i.test(destination))
        newTab(
          destination,
          disposition === 'background-tab' || currentPreferences().backgroundTabs,
          disposition === 'background-tab' ? tab.id : undefined,
          !!tab.incognito
        )
      return { action: 'deny' }
    })
    const bindings = listenersBefore.flatMap(({ emitter, listeners }) =>
      emitter.eventNames().flatMap((name) =>
        emitter
          .listeners(name)
          .filter((listener) => !listeners.has(listener))
          .map((listener) => ({ emitter, name, listener }))
      )
    )
    entry.unbind = () => {
      for (const { emitter, name, listener } of bindings)
        emitter.removeListener(name, listener as (...args: unknown[]) => void)
    }
  }

  function wakeTab(tab: TabEntry, restore = true): Promise<void> {
    if (tab.waking) return tab.waking
    tab.waking = (async () => {
      await tab.transition
      if (window.isDestroyed() || tabs.get(tab.state.id) !== tab) return
      if (tab.state.discarded) {
        let snapshot: TabSnapshot | undefined
        if (restore) {
          try {
            snapshot = snapshots.read(tab.state.id)
          } catch (error) {
            console.error('Could not read tab restore data; reloading its address:', error)
          }
        }
        if (snapshot) {
          tab.scroll = snapshot.scroll
          tab.zoom ??= snapshot.zoom
          tab.state.muted ??= snapshot.muted
        }
        createTabView(tab)
        tab.state.discarded = false
        if (restore) {
          tab.state.loading = true
          publish()
          const contents = tab.view!.webContents
          if (snapshot) {
            try {
              await contents.navigationHistory.restore({
                entries: snapshot.entries,
                index: snapshot.index
              })
            } catch {
              await contents.loadURL(tab.state.url)
            }
          } else await contents.loadURL(tab.state.url)
        }
        snapshots.remove(tab.state.id)
      } else if (tab.state.sleeping && tab.view) {
        await thawTab(tab.view.webContents)
        tab.state.sleeping = false
        void applyWebsiteAppearance(tab)
      }
      publish()
    })()
      .catch((error) => {
        if (window.isDestroyed() || tabs.get(tab.state.id) !== tab) return
        tab.state.loading = false
        tab.state.error = 'Could not restore this tab. Enter its address to reload.'
        console.error('Could not wake tab:', error)
        publish()
      })
      .finally(() => {
        tab.waking = undefined
      })
    return tab.waking
  }

  function closeTab(id: string): void {
    const tab = tabs.get(id)
    if (!tab) return
    const ids = [...tabs.keys()]
    const index = ids.indexOf(id)
    const partnerId = tab.state.split?.partnerId
    clearSplit(id)
    if (!tab.state.incognito) closedTabs.push({ url: tab.state.url, index })
    if (closedTabs.length > 25) closedTabs.shift()
    tabs.delete(id)
    if (tab.view) {
      window.contentView.removeChildView(tab.view)
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
    }
    snapshots.remove(id)
    if (tab.state.incognito) clearIncognitoSession(tab.incognitoPartition)
    if (!tabs.size) newTab()
    else if (activeTabId === id) switchTab(partnerId ?? ids[index + 1] ?? ids[index - 1])
    else publish()
  }

  function toggleMute(id: string): void {
    const tab = tabs.get(id)
    if (!tab) return
    tab.state.muted = !tab.state.muted
    tab.view?.webContents.setAudioMuted(tab.state.muted)
    publish()
  }

  function reorderTab(id: string, targetId: string): void {
    const entries = [...tabs.entries()]
    const from = entries.findIndex(([tabId]) => tabId === id)
    const target =
      targetId === '' ? entries.length : entries.findIndex(([tabId]) => tabId === targetId)
    if (from < 0 || target < 0 || from === target) return
    const [entry] = entries.splice(from, 1)
    entries.splice(target > from ? target - 1 : target, 0, entry)
    tabs.clear()
    for (const [tabId, tab] of entries) tabs.set(tabId, tab)
    publish()
  }

  function clearIncognitoSession(partition = incognitoPartition): void {
    if (!partition) return
    if (
      partition === incognitoPartition &&
      ![...tabs.values()].some((tab) => tab.incognitoPartition === partition)
    )
      incognitoPartition = undefined
    if ([...privatePartitions.values()].some((current) => current().has(partition))) return
    const privateSession = session.fromPartition(partition)
    clearPrivateWebsitePermissions(privateSession)
    void Promise.all([
      privateSession.clearStorageData(),
      privateSession.clearCache(),
      privateSession.clearAuthCache()
    ]).catch((error) => console.error('Could not clear incognito storage:', error))
  }

  function isTrusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    return uiContents.some(
      (contents) =>
        !contents.isDestroyed() &&
        event.sender === contents &&
        event.senderFrame === contents.mainFrame
    )
  }

  function detachTab(id: string): void {
    if (!openWindow) return
    const cursor = screen.getCursorScreenPoint()
    const bounds = window.getBounds()
    if (
      cursor.x >= bounds.x &&
      cursor.x < bounds.x + bounds.width &&
      cursor.y >= bounds.y &&
      cursor.y < bounds.y + bounds.height
    )
      return
    void transferTab(id, (tab) =>
      openWindow({
        tab,
        x: cursor.x - Math.min(100, sidebarWidth / 2),
        y: cursor.y - 50
      })
    )
  }

  async function transferTab(id: string, receive: (tab: TabEntry) => void): Promise<void> {
    const tab = tabs.get(id)
    if (!tab || detachingTabs.has(id)) return
    detachingTabs.add(id)
    try {
      await tab.waking
      await tab.transition
      if (tab.state.sleeping || tab.state.discarded) await wakeTab(tab)
      if (window.isDestroyed() || tabs.get(id) !== tab || tab.state.sleeping || tab.state.discarded)
        return
      const ids = [...tabs.keys()]
      const index = ids.indexOf(id)
      const previousActiveId = activeTabId
      finder.close()
      contextMenu.dismiss(false)
      clearSplit(id)
      if (fullscreenTabId === id) {
        fullscreenTabId = undefined
        window.setFullScreen(false)
      }
      tab.unbind?.()
      if (tab.view) window.contentView.removeChildView(tab.view)
      tabs.delete(id)
      try {
        if (extensions && tab.view && !tab.state.incognito)
          extensions.api.removeTab(tab.view.webContents)
        receive(tab)
      } catch (error) {
        tabs.set(id, tab)
        createTabView(tab)
        reorderTab(id, ids[index + 1] ?? '')
        switchTab(previousActiveId)
        throw error
      }
      snapshots.remove(id)
      if (!tabs.size) window.close()
      else {
        if (activeTabId === id) switchTab(ids[index + 1] ?? ids[index - 1])
        else publish()
        if (tab.state.incognito) clearIncognitoSession(tab.incognitoPartition)
      }
    } catch (error) {
      console.error('Could not transfer tab:', error)
    } finally {
      detachingTabs.delete(id)
    }
  }

  function receiveTab(tab: TabEntry, targetId: string): void {
    if (window.isDestroyed() || (targetId !== '' && !tabs.has(targetId)))
      throw new Error('The destination tab list changed during transfer.')
    tabs.set(tab.state.id, tab)
    try {
      createTabView(tab)
      reorderTab(tab.state.id, targetId)
      window.show()
      window.focus()
      switchTab(tab.state.id)
    } catch (error) {
      tab.unbind?.()
      if (tab.view) window.contentView.removeChildView(tab.view)
      tabs.delete(tab.state.id)
      publish()
      throw error
    }
  }

  for (const contents of uiContents)
    contents.ipc.on('browser:tab-drag', (event, id: unknown) => {
      if (
        !isTrusted(event) ||
        event.sender !== sidebar.webContents ||
        typeof id !== 'string' ||
        !tabs.has(id)
      ) {
        event.returnValue = ''
        return
      }
      tabDrag = { token: randomUUID(), windowId, id }
      event.returnValue = tabDrag.token
    })
  sidebar.webContents.ipc.on('browser:tab-drop', (event, token: unknown, targetId: unknown) => {
    if (
      !isTrusted(event) ||
      typeof token !== 'string' ||
      typeof targetId !== 'string' ||
      (targetId !== '' && !tabs.has(targetId)) ||
      !tabDrag ||
      tabDrag.token !== token
    )
      return
    const drag = tabDrag
    const transfer = tabWindows.get(drag.windowId)
    if (!transfer) return
    tabDrag = undefined
    if (drag.windowId === windowId) reorderTab(drag.id, targetId)
    else void transfer(drag.id, (tab) => receiveTab(tab, targetId))
  })

  function navigate(event: IpcMainEvent, input: unknown): void {
    if (!isTrusted(event) || typeof input !== 'string' || input.length > 8192) return
    try {
      const url = resolveAddress(input, currentPreferences().searchEngine)
      if (url) load(url, activeTabId, resolveAddress(input) !== searchUrl(input), input.trim())
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
      if (tab && !!tab.incognito === !!tabs.get(activeTabId)?.state.incognito) {
        if (!tab.incognito)
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
      load(searchUrl(result.query, currentPreferences().searchEngine))
    } else if (
      result.kind === 'website' &&
      'url' in result &&
      typeof result.url === 'string' &&
      result.url.length <= 8192
    ) {
      try {
        const url = new URL(result.url)
        if (!['http:', 'https:'].includes(url.protocol)) return
        load(
          url.href,
          activeTabId,
          resolveAddress(query, currentPreferences().searchEngine) === url.href,
          query
        )
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
      [...tabs.values()]
        .map((tab) => tab.state)
        .filter((tab) => !!tab.incognito === !!tabs.get(activeTabId)?.state.incognito),
      online === true,
      (response, pending) => {
        if (!controller.signal.aborted && !event.sender.isDestroyed())
          event.sender.send('browser:search-update', { requestId, response, pending })
      },
      !!tabs.get(activeTabId)?.state.incognito
    )
  }

  function overlay(event: IpcMainEvent, height: unknown): void {
    if (!isTrusted(event) || typeof height !== 'number' || !Number.isFinite(height)) return
    overlayHeight = Math.max(0, Math.min(900, Math.ceil(height)))
    resize()
  }
  function openHistory(): void {
    const existing = [...tabs.values()].find((tab) => isSettingsUrl(tab.state.url))
    if (existing) {
      load(historyUrl, existing.state.id)
      switchTab(existing.state.id)
    } else newTab(historyUrl)
  }

  function tabAction(event: IpcMainEvent, action: unknown, id: unknown, targetId: unknown): void {
    if (!isTrusted(event)) return
    if (action === 'new') newTab()
    else if (action === 'history') openHistory()
    else if (action === 'incognito') newTab(undefined, false, undefined, true)
    else if (action === 'downloads') {
      const existing = [...tabs.values()].find((tab) => tab.state.url === downloadsUrl)
      if (existing) switchTab(existing.state.id)
      else newTab(downloadsUrl)
    } else if (action === 'settings' || action === 'extensions') {
      const existing = [...tabs.values()].find((tab) => isSettingsUrl(tab.state.url))
      const destination = action === 'extensions' ? `${settingsUrl}/extensions` : settingsUrl
      if (existing) {
        if (action === 'extensions') load(destination, existing.state.id)
        switchTab(existing.state.id)
      } else newTab(destination)
    } else if (action === 'reorder' && typeof id === 'string' && typeof targetId === 'string')
      reorderTab(id, targetId)
    else if (action === 'detach' && typeof id === 'string' && event.sender === sidebar.webContents)
      void detachTab(id)
    else if (typeof id === 'string') {
      if (action === 'switch') switchTab(id, event.sender !== sidebar.webContents)
      else if (action === 'close') closeTab(id)
      else if (action === 'split') splitTab(id)
      else if (action === 'unsplit' && tabs.get(id)?.state.split)
        animateLayout(() => clearSplit(id))
      else if (action === 'mute') toggleMute(id)
    }
  }
  function showTabMenu(event: IpcMainEvent, id: unknown, x: unknown, y: unknown): void {
    if (
      !isTrusted(event) ||
      event.sender !== sidebar.webContents ||
      typeof id !== 'string' ||
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    )
      return
    const tab = tabs.get(id)
    if (!tab) return
    const menu = Menu.buildFromTemplate([
      {
        label: 'Reload tab',
        enabled: !!tab.state.url,
        click: () => {
          if (tabs.has(id)) load(tab.state.url, id)
        }
      },
      {
        label: 'Duplicate tab',
        enabled: !!tab.state.url,
        click: () => {
          if (tabs.has(id)) newTab(tab.state.url, false, id, !!tab.state.incognito)
        }
      },
      {
        label: tab.state.muted ? 'Unmute tab' : 'Mute tab',
        click: () => toggleMute(id)
      },
      { type: 'separator' },
      {
        label: 'Split view with current tab',
        enabled:
          id !== activeTabId &&
          canSplit(id) &&
          canSplit(activeTabId) &&
          tabs.get(activeTabId)?.state.split?.partnerId !== id &&
          !!tab.state.incognito === !!tabs.get(activeTabId)?.state.incognito,
        click: () => splitTab(id)
      },
      ...(tab.state.split
        ? [{ label: 'Separate tabs', click: () => animateLayout(() => clearSplit(id)) }]
        : []),
      { type: 'separator' },
      { label: 'Close tab', click: () => closeTab(id) }
    ])
    void contextMenu.showMenu(event.sender, menu, x, y)
  }
  function ready(event: IpcMainEvent): void {
    if (isTrusted(event)) {
      event.sender.send('browser:topbar-hover', pointerNearTopbar)
      publish()
    }
  }
  const listeners = {
    'browser:navigate': navigate,
    'browser:activate': activate,
    'browser:overlay': overlay,
    'browser:tab': tabAction,
    'browser:tab-menu': showTabMenu,
    'browser:split': splitAction,
    'browser:ready': ready
  }
  for (const [channel, listener] of Object.entries(listeners)) ipcMain.on(channel, listener)
  chrome.webContents.ipc.handle('browser:suggest', suggest)
  for (const contents of uiContents) {
    contents.ipc.handle('browser:favicon', (event, source: unknown) => {
      if (!isTrusted(event) || typeof source !== 'string') return null
      return getFavicon(source)
    })
  }
  for (const contents of uiContents) keyboard(contents)
  registerTheme(chrome, false, isTrusted, applyAppearance)
  registerTheme(sidebar, true, isTrusted)
  for (const view of [splitBar, splitDivider]) {
    registerTheme(view, true, isTrusted, () => view.setBackgroundColor('#00000000'))
    view.setBackgroundColor('#00000000')
    registerPreferences(view.webContents, window, isTrusted, () => {})
    view.webContents.on('will-navigate', (event) => event.preventDefault())
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  }
  registerSiteSearch(chrome.webContents, isTrusted, (value) => {
    search.shortcuts = value
  })
  commandsRuntime().register(
    chrome.webContents,
    isTrusted,
    () => tabs.get(activeTabId)?.view?.webContents
  )
  sidebar.webContents.on('will-navigate', (event) => event.preventDefault())
  sidebar.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  sidebar.webContents.on('blur', () => {
    if (!sidebar.webContents.isDestroyed()) sidebar.webContents.send('browser:page-focus')
  })
  chrome.webContents.once('did-finish-load', () => {
    const url = new URL(chrome.webContents.getURL())
    url.hash = 'tabs'
    void sidebar.webContents.loadURL(url.href).catch(() => {})
    url.hash = 'split'
    void splitBar.webContents.loadURL(url.href).catch(() => {})
    url.hash = 'split-divider'
    void splitDivider.webContents.loadURL(url.href).catch(() => {})
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
  const historyChanged = (): void => {
    if (!chrome.webContents.isDestroyed()) chrome.webContents.send('history:changed')
  }
  store.on('history-changed', historyChanged)
  chrome.webContents.ipc.handle('history:get', (event, filter: unknown) => {
    if (!isTrusted(event)) throw new Error('Untrusted history request.')
    return store.historyPage(parseHistoryQuery(filter))
  })
  chrome.webContents.ipc.handle('history:open', (event, id: unknown, target: unknown) => {
    if (
      !isTrusted(event) ||
      !Number.isSafeInteger(id) ||
      !['tab', 'background', 'incognito'].includes(target as string)
    )
      throw new Error('Invalid history visit.')
    const visit = store.historyVisit(id as number)
    if (!visit) throw new Error('Visit no longer exists.')
    newTab(visit.url, target === 'background', undefined, target === 'incognito')
  })
  chrome.webContents.ipc.handle('history:copy', (event, id: unknown) => {
    if (!isTrusted(event) || !Number.isSafeInteger(id)) throw new Error('Invalid history visit.')
    const visit = store.historyVisit(id as number)
    if (!visit) throw new Error('Visit no longer exists.')
    return clipboard.writeText(visit.url)
  })
  chrome.webContents.ipc.handle('history:remove', async (event, value: unknown) => {
    if (!isTrusted(event)) throw new Error('Untrusted history request.')
    const removal = parseHistoryRemoval(value)
    const { response } = await dialog.showMessageBox(window, {
      type: 'warning',
      message: removal.ids
        ? `Delete ${removal.ids.length === 1 ? 'visit' : `${removal.ids.length} visits`}?`
        : 'Clear browsing history?',
      detail: removal.ids
        ? 'Remove selected visits from history.'
        : 'Remove all visits in the selected time range.',
      buttons: ['Delete', 'Cancel'],
      defaultId: 1,
      cancelId: 1
    })
    if (window.isDestroyed() || response !== 0) return false
    store.removeHistory(removal)
    return true
  })
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
  window.on('blur', () => finishSplitGesture(true))
  const resizeAfterFullscreen = (): void => {
    setImmediate(() => {
      if (!window.isDestroyed()) resize()
    })
  }
  window.on('enter-full-screen', resizeAfterFullscreen)
  window.on('leave-full-screen', resizeAfterFullscreen)
  let appliedPreferences = currentPreferences()
  extensions?.registerWindow(window, {
    createTab: (url, active) => {
      if (url && !extensions.allowedURL(url)) throw new Error('Unsupported extension navigation.')
      return newTab(url, !active).view!.webContents
    },
    selectTab: (contents) => {
      if (registeringExtensionTab) return
      const tab = [...tabs.values()].find((entry) => entry.view?.webContents === contents)
      if (tab) switchTab(tab.state.id)
    },
    removeTab: (contents) => {
      const tab = [...tabs.values()].find((entry) => entry.view?.webContents === contents)
      if (tab) closeTab(tab.state.id)
    }
  })
  for (const contents of [chrome.webContents, sidebar.webContents])
    extensions?.registerUI(contents, window, isTrusted, (url) => {
      newTab(url)
    })
  for (const contents of [chrome.webContents, sidebar.webContents])
    contents.ipc.on('ui:legacy-storage', (event) => {
      event.returnValue = isTrusted(event) ? legacyUIStorage() : {}
    })
  for (const contents of [chrome.webContents, sidebar.webContents]) {
    registerDownloads(contents, isTrusted, session.defaultSession)
    registerUpdates(contents, window, isTrusted)
    registerDefaultBrowser(contents, isTrusted)
    registerWebsitePermissionSettings(
      contents,
      isTrusted,
      () => tabs.get(activeTabId)?.view?.webContents
    )
    registerPreferences(contents, window, isTrusted, (value) => {
      if (value === appliedPreferences) return
      for (const client of [
        ...uiContents,
        ...[...tabs.values()].flatMap((tab) => (tab.view ? [tab.view.webContents] : []))
      ])
        if (!client.isDestroyed())
          for (const frame of client.mainFrame.framesInSubtree)
            if (!frame.detached) {
              frame.send('keybinds:changed', value.keybindings)
              frame.send('privacy:changed', {
                doNotTrack: value.doNotTrack,
                globalPrivacyControl: value.globalPrivacyControl,
                autoRejectConsent: value.autoRejectConsent
              })
            }
      if (value.searchEngine !== appliedPreferences.searchEngine) suggestionRequest?.abort()
      if (value.defaultZoom !== appliedPreferences.defaultZoom)
        for (const tab of tabs.values()) {
          tab.zoom = value.defaultZoom / 100
          if (tab.view && !tab.view.webContents.isDestroyed()) {
            tab.view.webContents.setZoomFactor(value.defaultZoom / 100)
          }
        }
      for (const tab of tabs.values()) {
        if (!tab.state.sleeping) continue
        const host = new URL(tab.state.url).hostname
        if (
          value.tabSleepMinutes === 0 ||
          value.tabSleepExceptions.some(
            (exception) => host === exception || host.endsWith(`.${exception}`)
          )
        )
          void wakeTab(tab)
      }
      appliedPreferences = value
    })
  }
  let closingConfirmed = false
  let confirmingClose = false
  window.on('close', (event) => {
    if (
      isInstallingUpdate() ||
      closingConfirmed ||
      !currentPreferences().confirmClose ||
      tabs.size < 2
    )
      return
    event.preventDefault()
    if (confirmingClose) return
    confirmingClose = true
    void dialog
      .showMessageBox(window, {
        type: 'question',
        message: `Close ${tabs.size} tabs?`,
        buttons: ['Close tabs', 'Cancel'],
        defaultId: 1,
        cancelId: 1
      })
      .then(({ response }) => {
        confirmingClose = false
        if (response !== 0 || window.isDestroyed()) return
        closingConfirmed = true
        window.close()
      })
      .catch(() => {
        confirmingClose = false
      })
  })
  const topbarHoverTimer = setInterval(() => {
    const bounds = window.getContentBounds()
    const cursor = screen.getCursorScreenPoint()
    const nearSidebar =
      !sidebarVisible &&
      window.isVisible() &&
      cursor.x >= bounds.x &&
      cursor.x < bounds.x + (pointerNearSidebar ? desiredSidebarWidth() : 12) &&
      cursor.y >= bounds.y &&
      cursor.y < bounds.y + bounds.height
    if (nearSidebar !== pointerNearSidebar) {
      pointerNearSidebar = nearSidebar
      animateSidebar()
    }
    const near =
      window.isVisible() &&
      cursor.x >= bounds.x + sidebarWidth &&
      cursor.x < bounds.x + bounds.width &&
      cursor.y >= bounds.y &&
      cursor.y < bounds.y + (overlayHeight > 0 ? currentTheme().addressBarHeight : 12)
    if (near === pointerNearTopbar) return
    pointerNearTopbar = near
    chrome.webContents.send('browser:topbar-hover', near)
  }, 50)
  window.on('closed', () => {
    tabWindows.delete(windowId)
    if (tabDrag?.windowId === windowId) tabDrag = undefined
    const partitions = privatePartitions.get(windowId)?.() ?? new Set<string>()
    privatePartitions.delete(windowId)
    finder.destroy()
    closeSession(windowId)
    clearInterval(sleepTimer)
    clearInterval(topbarHoverTimer)
    if (sidebarAnimation) clearInterval(sidebarAnimation)
    store.off('cleared', cleared)
    clearInterval(layoutAnimation)
    store.off('history-changed', historyChanged)
    suggestionRequest?.abort()
    for (const [channel, listener] of Object.entries(listeners))
      ipcMain.removeListener(channel, listener)
    for (const tab of tabs.values())
      if (tab.view && !tab.view.webContents.isDestroyed()) tab.view.webContents.close()
    snapshots.clear()
    for (const partition of partitions) clearIncognitoSession(partition)
    for (const contents of uiContents) if (!contents.isDestroyed()) contents.close()
  })
  function memoryMode(tab: TabEntry): 'sleep' | 'discard' | undefined {
    if (
      visibleTab(tab.state.id) ||
      tab.state.discarded ||
      tab.state.loading ||
      tab.state.error ||
      detachingTabs.has(tab.state.id) ||
      tab.waking ||
      !tab.view ||
      !/^https?:/.test(tab.state.url)
    )
      return
    const contents = tab.view.webContents
    if (
      contents.isDestroyed() ||
      contents.isCurrentlyAudible() ||
      hasActiveDownload(contents) ||
      contents.isBeingCaptured()
    )
      return
    const preferences = currentPreferences()
    const host = new URL(tab.state.url).hostname
    const elapsed = Date.now() - tab.lastActive
    const excluded = (exceptions: string[]): boolean =>
      exceptions.some((exception) => host === exception || host.endsWith(`.${exception}`))
    if (
      preferences.tabDiscardMinutes > 0 &&
      elapsed >= preferences.tabDiscardMinutes * 60000 &&
      !excluded(preferences.tabDiscardExceptions)
    )
      return 'discard'
    if (
      !tab.state.sleeping &&
      preferences.tabSleepMinutes > 0 &&
      elapsed >= preferences.tabSleepMinutes * 60000 &&
      !excluded(preferences.tabSleepExceptions)
    )
      return 'sleep'
    return
  }

  const sleepTimer = setInterval(() => {
    for (const [id, tab] of tabs) {
      const mode = memoryMode(tab)
      if (!mode || sleepChecks.has(id) || !tab.view) continue
      const contents = tab.view.webContents
      const address = tab.state.url
      sleepChecks.add(id)
      const lastActive = tab.lastActive
      const root = contents.mainFrame
      const frames = [
        root,
        ...root.framesInSubtree.filter((frame) => frame.frameTreeNodeId !== root.frameTreeNodeId)
      ]
      tab.transition = (
        tab.state.sleeping
          ? Promise.resolve([{ dirty: false, scroll: tab.scroll }])
          : Promise.all(
              frames.map((frame) =>
                frame.executeJavaScript(`(() => ({
        dirty: [...document.querySelectorAll('input, textarea, select, [contenteditable]')].some(field => {
          if (field.isContentEditable) return !!field.textContent
          if (field.tagName === 'SELECT') {
            const options = [...field.options]
            if (field.multiple) return options.some(option => option.selected !== option.defaultSelected)
            const initial = options.length ? Math.max(0, options.findLastIndex(option => option.defaultSelected)) : -1
            return field.selectedIndex !== initial
          }
          if (field.type === 'checkbox' || field.type === 'radio') return field.checked !== field.defaultChecked
          return field.value !== field.defaultValue
        }), scroll: [scrollX, scrollY]
      }))()`)
              )
            )
      )
        .then(async (results) => {
          if (
            !results.every(
              (result): result is { dirty: boolean; scroll: [number, number] } =>
                typeof result === 'object' &&
                result !== null &&
                'dirty' in result &&
                typeof result.dirty === 'boolean' &&
                'scroll' in result &&
                Array.isArray(result.scroll) &&
                result.scroll.length === 2 &&
                result.scroll.every(
                  (coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate)
                )
            )
          )
            return
          if (
            window.isDestroyed() ||
            tabs.get(id) !== tab ||
            tab.state.url !== address ||
            tab.lastActive !== lastActive ||
            memoryMode(tab) !== mode ||
            results.some((result) => result.dirty) ||
            contents.isCurrentlyAudible() ||
            contents.isBeingCaptured() ||
            hasActiveDownload(contents)
          )
            return
          tab.scroll = results[0].scroll
          if (mode === 'sleep') {
            await freezeTab(contents)
            if (
              window.isDestroyed() ||
              tabs.get(id) !== tab ||
              tab.lastActive !== lastActive ||
              memoryMode(tab) !== mode
            ) {
              await thawTab(contents)
              return
            }
            tab.state.sleeping = true
          } else {
            tab.zoom = contents.getZoomFactor()
            tab.state.muted = contents.isAudioMuted()
            snapshots.save(
              id,
              {
                entries: contents.navigationHistory.getAllEntries(),
                index: contents.navigationHistory.getActiveIndex(),
                scroll: tab.scroll,
                zoom: tab.zoom,
                muted: tab.state.muted
              },
              !!tab.state.incognito
            )
            tab.state.discarded = true
            tab.state.sleeping = false
            tab.state.loading = false
            tab.state.audible = false
            window.contentView.removeChildView(tab.view!)
            tab.view = undefined
            contents.close()
          }
          publish()
        })
        .catch((error) => console.error('Could not change tab memory state:', error))
        .finally(() => {
          sleepChecks.delete(id)
          tab.transition = undefined
        })
    }
  }, 15000)
  sleepTimer.unref()
  tabWindows.set(windowId, transferTab)
  if (detached) {
    tabs.set(detached.tab.state.id, detached.tab)
    createTabView(detached.tab)
    switchTab(detached.tab.state.id, false)
  } else {
    const startup = startupSession(currentPreferences())
    for (const url of startup.urls) newTab(url, true)
    const ids = [...tabs.keys()]
    for (const [left, right, ratio = 0.5] of startup.splits ?? []) {
      const leftTab = tabs.get(ids[left])
      const rightTab = tabs.get(ids[right])
      if (
        !leftTab ||
        !rightTab ||
        leftTab.state.split ||
        rightTab.state.split ||
        !canSplit(ids[left]) ||
        !canSplit(ids[right])
      )
        continue
      leftTab.state.split = { partnerId: ids[right], side: 'left', ratio }
      rightTab.state.split = { partnerId: ids[left], side: 'right', ratio }
    }
    switchTab([...tabs.keys()][startup.active] ?? [...tabs.keys()][0], false)
  }
  initializing = false
  registerLinkWindow(window, (url) => {
    const active = tabs.get(activeTabId)
    if (tabs.size === 1 && active && !active.state.url && !active.state.incognito) {
      load(url, activeTabId)
    } else newTab(url)
  })
  publish()
  return chrome.webContents
}
