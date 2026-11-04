import { clipboard, MenuItem, WebContentsView } from 'electron'
import type { BaseWindow, ContextMenuParams, IpcMainInvokeEvent, Menu, WebContents } from 'electron'
import { join } from 'node:path'
import buildChromeContextMenu from 'electron-chrome-context-menu'
import type { ContextMenuState } from '../shared/context-menu'
import { currentPreferences, registerPreferences } from './preferences'
import { registerTheme } from './theme'
import { uiPartition } from './extensions'
import type { ExtensionRuntime } from './extensions'

export class BrowserContextMenu {
  private view?: WebContentsView
  private ready?: Promise<void>
  private active?: { state: ContextMenuState; menu: Menu; source: WebContents }
  private sequence = 0
  private readonly sourceChanged = (): void => this.dismiss()

  constructor(
    private window: BaseWindow,
    private renderer: WebContents,
    private openLink: Parameters<typeof buildChromeContextMenu>[0]['openLink'],
    private registerKeyboard: (contents: WebContents) => void,
    private extensions?: ExtensionRuntime
  ) {
    window.on('resize', () => this.dismiss())
    window.on('blur', () => this.dismiss())
    window.on('closed', () => {
      this.dismiss(false)
      if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close()
    })
  }

  dismiss(restoreFocus = true): void {
    const source = this.active?.source
    this.active = undefined
    if (source && !source.isDestroyed()) {
      source.removeListener('did-start-loading', this.sourceChanged)
      source.removeListener('destroyed', this.sourceChanged)
    }
    if (this.view && !this.view.webContents.isDestroyed()) this.view.setVisible(false)
    if (restoreFocus && source && !source.isDestroyed() && !this.window.isDestroyed())
      source.focus()
  }

  private createView(): Promise<void> {
    if (this.ready) return this.ready
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        partition: uiPartition,
        contextIsolation: true,
        sandbox: false,
        nodeIntegration: false
      }
    })
    this.view = view
    view.setVisible(false)
    const contents = view.webContents
    this.registerKeyboard(contents)
    const url = new URL(this.renderer.getURL())
    url.hash = 'context-menu'
    const trusted = (event: IpcMainInvokeEvent): boolean =>
      event.sender === contents &&
      event.senderFrame === contents.mainFrame &&
      contents.getURL() === url.href
    registerTheme(view, false, trusted, () => view.setBackgroundColor('#00000000'))
    view.setBackgroundColor('#00000000')
    registerPreferences(contents, this.window, trusted, (value) => {
      if (value.contextMenuStyle === 'native') this.dismiss()
    })
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event) => event.preventDefault())
    contents.ipc.handle('context-menu:get', (event) => {
      if (!trusted(event)) throw new Error('Context menu access denied.')
      return this.active?.state ?? null
    })
    contents.ipc.handle('context-menu:dismiss', (event, id: unknown) => {
      if (trusted(event) && id === this.active?.state.id) this.dismiss()
    })
    contents.ipc.handle('context-menu:select', (event, id: unknown, itemId: unknown) => {
      if (
        !trusted(event) ||
        !this.active ||
        id !== this.active.state.id ||
        !Number.isSafeInteger(itemId)
      )
        return
      const active = this.active!
      const item = active.menu.items[itemId as number]
      if (!item || !item.visible || !item.enabled || item.type === 'separator') return
      this.dismiss()
      if (!active.source.isDestroyed()) item.click(item, this.window, {})
    })
    contents.on('render-process-gone', () => {
      this.dismiss()
      contents.close()
    })
    contents.once('destroyed', () => {
      if (this.view !== view) return
      this.view = undefined
      this.ready = undefined
      this.dismiss()
    })
    this.ready = contents.loadURL(url.href).catch((error: unknown) => {
      this.ready = undefined
      this.view = undefined
      if (!contents.isDestroyed()) contents.close()
      throw error
    })
    return this.ready
  }

  async show(source: WebContents, params: ContextMenuParams, incognito = false): Promise<void> {
    this.dismiss(false)
    const menu = buildChromeContextMenu({ params, webContents: source, openLink: this.openLink })
    if (params.mediaType === 'image') {
      const imageItems = [
        new MenuItem({
          label: 'Save image as\u2026',
          enabled: /^(?:https?:|data:image\/|blob:https?:)/i.test(params.srcURL),
          click: () => source.downloadURL(params.srcURL)
        }),
        new MenuItem({
          label: 'Copy image',
          enabled: params.hasImageContents,
          click: () => source.copyImageAt(params.x, params.y)
        })
      ]
      if (params.linkURL)
        imageItems.unshift(
          new MenuItem({ type: 'separator' }),
          new MenuItem({
            label: 'Open image in new tab',
            click: () => this.openLink(params.srcURL, 'default', params)
          }),
          new MenuItem({
            label: 'Copy image address',
            click: () => clipboard.writeText(params.srcURL)
          })
        )
      const index = menu.items.length - 2
      imageItems.forEach((item, offset) => menu.insert(index + offset, item))
    }
    const extensionItems = incognito
      ? []
      : (this.extensions?.api.getContextMenuItems(source, params) ?? [])
    if (extensionItems.length) {
      menu.append(new MenuItem({ type: 'separator' }))
      for (const item of extensionItems) menu.append(item)
    }
    if (
      currentPreferences().contextMenuStyle === 'native' ||
      extensionItems.some((item) => item.submenu)
    ) {
      menu.popup({ window: this.window })
      return
    }
    const sourceView = this.window.contentView.children.find(
      (view) => view instanceof WebContentsView && view.webContents === source
    )
    if (!sourceView) return
    const bounds = sourceView.getBounds()
    const state: ContextMenuState = {
      id: ++this.sequence,
      x: bounds.x + params.x,
      y: bounds.y + params.y,
      items: menu.items.flatMap((item, index) =>
        item.visible
          ? [
              {
                id: index,
                label: item.label,
                separator: item.type === 'separator',
                enabled: item.enabled
              }
            ]
          : []
      )
    }
    this.active = { state, menu, source }
    source.once('did-start-loading', this.sourceChanged)
    source.once('destroyed', this.sourceChanged)
    try {
      await this.createView()
      if (this.active?.state.id !== state.id || this.window.isDestroyed()) return
      const view = this.view!
      const { width, height } = this.window.getContentBounds()
      view.setBounds({ x: 0, y: 0, width, height })
      this.window.contentView.addChildView(view)
      view.setVisible(true)
      view.webContents.send('context-menu:changed', state)
      view.webContents.focus()
    } catch {
      if (this.active?.state.id !== state.id || this.window.isDestroyed()) return
      this.dismiss()
      menu.popup({ window: this.window })
    }
  }
}
