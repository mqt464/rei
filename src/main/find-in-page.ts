import { WebContentsView } from 'electron'
import type { BaseWindow, IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron'
import { join } from 'node:path'
import type { FindState } from '../shared/browser'
import { uiPartition } from './extensions'
import { registerTheme } from './theme'
import { registerPreferences } from './preferences'

export class PageFinder {
  private view?: WebContentsView
  private ready?: Promise<void>
  private source?: WebContents
  private page = ''
  private requestId = 0
  private state: FindState = { query: '', activeMatchOrdinal: 0, matches: 0 }

  constructor(
    private window: BaseWindow,
    private renderer: WebContents,
    private registerKeyboard: (contents: WebContents) => void
  ) {}

  resize(left: number, top: number): void {
    if (!this.view || this.window.isDestroyed()) return
    const { width, height } = this.window.getContentBounds()
    const panelWidth = Math.min(380, Math.max(0, width - left))
    this.view.setBounds({
      x: width - panelWidth,
      y: top,
      width: panelWidth,
      height: Math.max(0, Math.min(64, height - top))
    })
  }

  sync(page: string): void {
    if (this.source && page !== this.page) this.close()
  }

  async show(source: WebContents, page: string): Promise<void> {
    if (this.source !== source || this.page !== page) {
      this.close()
      this.source = source
      this.page = page
      source.on('found-in-page', this.found)
      source.on('did-start-navigation', this.navigation)
      source.once('destroyed', this.sourceDestroyed)
    }
    try {
      await this.createView()
      if (this.source !== source || this.page !== page || this.window.isDestroyed()) return
      this.window.contentView.addChildView(this.view!)
      this.view!.setVisible(true)
      this.view!.webContents.send('find:state', this.state)
      this.view!.webContents.focus()
      this.view!.webContents.send('find:focus')
    } catch (error) {
      this.close()
      console.error('Could not open find in page:', error)
    }
  }

  private found = (_event: Electron.Event, result: Electron.Result): void => {
    if (result.requestId !== this.requestId || !this.state.query) return
    this.state = {
      query: this.state.query,
      activeMatchOrdinal: result.activeMatchOrdinal,
      matches: result.matches
    }
    this.view?.webContents.send('find:state', this.state)
  }

  private navigation = (
    _event: Electron.Event,
    _url: string,
    _inPlace: boolean,
    mainFrame: boolean
  ): void => {
    if (mainFrame) this.close()
  }

  private sourceDestroyed = (): void => this.close()

  close(): void {
    const source = this.source
    this.source = undefined
    if (source && !source.isDestroyed()) {
      source.removeListener('found-in-page', this.found)
      source.removeListener('did-start-navigation', this.navigation)
      source.removeListener('destroyed', this.sourceDestroyed)
      source.stopFindInPage('clearSelection')
    }
    this.state = { query: '', activeMatchOrdinal: 0, matches: 0 }
    this.requestId = 0
    const contents = this.view?.webContents
    if (contents && !contents.isDestroyed()) {
      this.view!.setVisible(false)
      contents.send('find:state', this.state)
    }
  }

  destroy(): void {
    this.close()
    if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close()
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
    view.setBackgroundColor('#00000000')
    const contents = view.webContents
    const url = new URL(this.renderer.getURL())
    url.hash = 'find'
    const trusted = (event: IpcMainEvent | IpcMainInvokeEvent): boolean =>
      event.sender === contents &&
      event.senderFrame === contents.mainFrame &&
      contents.getURL() === url.href
    this.registerKeyboard(contents)
    registerTheme(view, false, trusted, () => view.setBackgroundColor('#00000000'))
    view.setBackgroundColor('#00000000')
    registerPreferences(contents, this.window, trusted, (value) => {
      contents.send('keybinds:changed', value.keybindings)
    })
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event) => event.preventDefault())
    contents.ipc.handle('find:get', (event) => {
      if (!trusted(event)) throw new Error('Find access denied.')
      return this.state
    })
    contents.ipc.on('find:query', (event, query: unknown, forward: unknown) => {
      if (!trusted(event) || !this.source || this.source.isDestroyed()) return
      if (typeof query !== 'string' || query.length > 8192) return
      if (forward !== undefined && typeof forward !== 'boolean') return
      const next = forward !== undefined && query === this.state.query
      if (query !== this.state.query) this.state = { query, activeMatchOrdinal: 0, matches: 0 }
      if (query) {
        this.requestId = this.source.findInPage(query, {
          forward: forward !== false,
          findNext: !next
        })
      } else {
        this.requestId = 0
        this.source.stopFindInPage('clearSelection')
      }
      contents.send('find:state', this.state)
    })
    contents.ipc.on('find:dismiss', (event, close: unknown) => {
      if (!trusted(event) || typeof close !== 'boolean') return
      const source = this.source
      if (close) this.close()
      if (source && !source.isDestroyed()) source.focus()
    })
    contents.once('destroyed', () => {
      this.view = undefined
      this.ready = undefined
      this.close()
    })
    this.ready = contents.loadURL(url.href).catch((error: unknown) => {
      if (!contents.isDestroyed()) contents.close()
      throw error
    })
    return this.ready
  }
}
