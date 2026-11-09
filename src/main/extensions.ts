import { app, BaseWindow, dialog, nativeImage, session, webContents } from 'electron'
import type { BrowserWindow, Extension, IpcMainInvokeEvent, Rectangle, WebContents } from 'electron'
import type { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { ElectronChromeExtensions, setSessionPartitionResolver } from 'electron-chrome-extensions'
import { installChromeWebStore, uninstallExtension } from 'electron-chrome-web-store'
import type { BrowserExtension, ExtensionState } from '../shared/extensions'
import { extensionOriginCovered } from '../shared/extension-permissions'
import {
  extensionCompatibilityWarnings,
  installExtensionCompatibility
} from './extension-compatibility'
import { ExtensionProxy } from './extension-proxy'

export const ublockId = 'fkgkibajhfbepljeaefdnfnegdcjomkh'
export const uiPartition = 'persist:rei-ui'
const extensionIdPattern = /^[a-p]{32}$/
let doNotTrack = false
let globalPrivacyControl = false
let privacyId = ''

export function setExtensionDoNotTrack(enabled: boolean, globalPrivacy = false): void {
  doNotTrack = enabled
  globalPrivacyControl = globalPrivacy
  for (const contents of webContents.getAllWebContents()) {
    if (privacyId && contents.getURL().startsWith(`chrome-extension://${privacyId}/`))
      void contents
        .executeJavaScript(
          `globalThis.reiDoNotTrack = ${enabled}; globalThis.reiGlobalPrivacyControl = ${globalPrivacy}`
        )
        .catch(console.error)
  }
}

interface InstalledExtension extends BrowserExtension {
  path: string
}

interface ExtensionWindow {
  createTab: (url: string, active: boolean) => WebContents
  selectTab: (contents: WebContents) => void
  removeTab: (contents: WebContents) => void
}

export class ExtensionRuntime {
  readonly session = session.defaultSession
  readonly proxy = new ExtensionProxy(this.session)
  readonly api: ElectronChromeExtensions
  private readonly directory = join(app.getPath('userData'), 'Extensions')
  private readonly statePath = join(app.getPath('userData'), 'extensions.json')
  private readonly bundledPath = app.isPackaged
    ? join(process.resourcesPath, 'extensions')
    : join(__dirname, '../../resources/extensions')
  private readonly installed = new Map<string, InstalledExtension>()
  private readonly windows = new Map<number, ExtensionWindow>()
  private readonly clients = new Map<WebContents, number>()
  private readonly pending = new Set<string>()
  private starting = true
  private error = ''

  constructor() {
    this.api = new ElectronChromeExtensions({
      session: this.session,
      createTab: async (details) => {
        const windowId = details.windowId ?? BaseWindow.getFocusedWindow()?.id
        const host = this.windows.get(windowId ?? -1) ?? this.windows.values().next().value
        if (!host) throw new Error('No browser window is available.')
        const contents = host.createTab(details.url ?? '', details.active !== false)
        const window = BaseWindow.getAllWindows().find(
          (entry) => this.windows.get(entry.id) === host
        )!
        return [contents, window]
      },
      selectTab: (contents, window) => {
        if (!window.isDestroyed() && !contents.isDestroyed())
          this.windows.get(window.id)?.selectTab(contents)
      },
      removeTab: (contents, window) => {
        if (!window.isDestroyed() && !contents.isDestroyed())
          this.windows.get(window.id)?.removeTab(contents)
      },
      removeWindow: (window) => {
        if (!window.isDestroyed()) window.close()
      },
      requestPermissions: async (extension, permissions) => {
        const manifest = extension.manifest
        const required = manifest.permissions ?? []
        const requiredOrigins = [...(manifest.host_permissions ?? []), ...required]
        const allowed = [...required, ...(manifest.optional_permissions ?? [])]
        const allowedOrigins = [
          ...requiredOrigins,
          ...(manifest.optional_host_permissions ?? []),
          ...allowed
        ]
        if (
          !(permissions.permissions ?? []).every((permission) => allowed.includes(permission)) ||
          !(permissions.origins ?? []).every((origin) =>
            allowedOrigins.some((grant) => extensionOriginCovered(grant, origin))
          )
        )
          return false
        if (
          (permissions.permissions ?? []).every((permission) => required.includes(permission)) &&
          (permissions.origins ?? []).every((origin) =>
            requiredOrigins.some((grant) => extensionOriginCovered(grant, origin))
          )
        )
          return true
        return this.confirm(
          `Allow additional access for ${extension.name}?`,
          [...(permissions.permissions ?? []), ...(permissions.origins ?? [])].join('\n'),
          'Allow'
        )
      }
    })
    installExtensionCompatibility(this.api)
    // shortcut: Electron 44 initializes MV2 APIs after preloads; remove when upstream fixes injection timing.
    this.session.unregisterPreloadScript('crx-mv2-preload')
    this.session.unregisterPreloadScript('crx-mv3-preload')
    this.session.registerPreloadScript({
      id: 'rei-extension-api',
      type: 'frame',
      filePath: join(__dirname, 'extension-api.preload.cjs')
    })
    this.session.registerPreloadScript({
      id: 'rei-extension-worker-api',
      type: 'service-worker',
      filePath: join(__dirname, 'extension-api.preload.cjs')
    })
    setSessionPartitionResolver((partition) => {
      if (partition !== 'rei-browsing') throw new Error('Unknown extension partition.')
      return this.session
    })
    ElectronChromeExtensions.handleCRXProtocol(session.fromPartition(uiPartition))
    this.api.on(
      'browser-action-popup-created',
      (
        popup: EventEmitter & {
          browserWindow?: BrowserWindow
          parent?: BaseWindow
        }
      ) => {
        const window = popup.browserWindow
        const parent = popup.parent
        if (!window || !parent) return
        popup.on('will-resize', (size: Pick<Rectangle, 'width' | 'height'>) => {
          if (window.isDestroyed() || parent.isDestroyed()) return
          const current = window.getBounds()
          const area = parent.getContentBounds()
          if (size.width === 25 && size.height === 25) {
            size.width = current.width
            size.height = current.height
          }
          size.width = Math.min(area.width, size.width)
          size.height = Math.min(area.height, size.height)
        })
        popup.on('will-move', (position: { x: number; y: number }) => {
          if (window.isDestroyed() || parent.isDestroyed()) return
          const bounds = window.getBounds()
          const area = parent.getContentBounds()
          position.x = Math.max(area.x, Math.min(position.x, area.x + area.width - bounds.width))
          position.y = Math.max(area.y, Math.min(position.y, area.y + area.height - bounds.height))
        })
      }
    )
    this.session.extensions.on('extension-loaded', (_event, extension) => {
      if (this.safePath(extension.path)) {
        const previous = this.installed.get(extension.id)
        this.installed.set(extension.id, this.describe(extension, previous?.bundled ?? false))
        if (!this.starting) this.save()
        this.publish()
      }
    })
    this.session.extensions.on('extension-unloaded', () => this.publish())
    app.on('web-contents-created', (_event, contents) => {
      if (contents.session !== this.session || contents.getType() !== 'backgroundPage') return
      contents.on('did-finish-load', () => {
        if (privacyId && contents.getURL().startsWith(`chrome-extension://${privacyId}/`))
          void contents
            .executeJavaScript(
              `globalThis.reiDoNotTrack = ${doNotTrack}; globalThis.reiGlobalPrivacyControl = ${globalPrivacyControl}`
            )
            .catch(console.error)
      })
    })
  }

  private safePath(path: string): boolean {
    const location = relative(resolve(this.directory), resolve(path))
    return location !== '' && !location.startsWith('..') && !isAbsolute(location)
  }

  private describe(extension: Extension, bundled: boolean): InstalledExtension {
    const manifest = extension.manifest
    return {
      id: extension.id,
      name: extension.name,
      version: extension.version,
      description: bundled
        ? 'Blocks ads, trackers, and unwanted content.'
        : (extension.manifest.description ?? ''),
      enabled: true,
      bundled,
      options: !!(manifest.options_ui?.page || manifest.options_page),
      compatibilityWarnings: extensionCompatibilityWarnings(manifest),
      icon: this.extensionIcon(extension.path, manifest),
      path: extension.path
    }
  }

  private extensionIcon(directory: string, manifest: Extension['manifest']): string | undefined {
    const icons =
      manifest.icons ?? manifest.action?.default_icon ?? manifest.browser_action?.default_icon
    const file =
      typeof icons === 'string'
        ? icons
        : icons?.[
            Object.keys(icons).sort(
              (left, right) => Math.abs(Number(left) - 32) - Math.abs(Number(right) - 32)
            )[0]
          ]
    if (typeof file !== 'string') return
    const path = resolve(directory, file.replace(/^[/\\]+/, ''))
    const location = relative(resolve(directory), path)
    if (!location || location.startsWith('..') || isAbsolute(location)) return
    const image = nativeImage.createFromPath(path)
    if (!image.isEmpty()) return image.resize({ width: 32, height: 32 }).toDataURL()
    return undefined
  }

  async initialize(): Promise<void> {
    if (existsSync(this.statePath)) {
      const saved: unknown = JSON.parse(readFileSync(this.statePath, 'utf8'))
      if (!Array.isArray(saved))
        throw new Error('Invalid extension settings. Check extensions.json.')
      for (const entry of saved) {
        if (
          !entry ||
          !extensionIdPattern.test(entry.id) ||
          typeof entry.enabled !== 'boolean' ||
          typeof entry.path !== 'string' ||
          typeof entry.name !== 'string' ||
          (entry.id !== ublockId && !this.safePath(entry.path))
        )
          throw new Error('Invalid extension settings. Check extensions.json.')
        this.installed.set(entry.id, entry)
        if (!entry.icon && existsSync(join(entry.path, 'manifest.json'))) {
          try {
            entry.icon = this.extensionIcon(
              entry.path,
              JSON.parse(readFileSync(join(entry.path, 'manifest.json'), 'utf8'))
            )
          } catch {
            delete entry.icon
          }
        }
      }
    }
    const enabled = this.installed.get(ublockId)?.enabled !== false
    const manifest = JSON.parse(
      readFileSync(join(this.bundledPath, 'uBlock0.chromium/manifest.json'), 'utf8')
    )
    this.installed.set(ublockId, {
      id: ublockId,
      name: 'uBlock Origin',
      version: manifest.version,
      description: 'Blocks ads, trackers, and unwanted content.',
      enabled,
      bundled: true,
      options: true,
      compatibilityWarnings: extensionCompatibilityWarnings(manifest),
      icon: this.extensionIcon(join(this.bundledPath, 'uBlock0.chromium'), manifest),
      path: join(this.bundledPath, 'uBlock0.chromium')
    })
    await installChromeWebStore({
      session: this.session,
      extensionsPath: this.directory,
      minimumManifestVersion: 2,
      loadExtensions: false,
      autoUpdate: false,
      denylist: [ublockId],
      beforeInstall: async () => ({ action: 'allow' })
    })
    for (const entry of this.installed.values()) {
      if (!entry.enabled) continue
      try {
        await this.load(entry)
      } catch (error) {
        entry.error =
          error instanceof Error
            ? error.message
            : 'Could not load extension. Try enabling it again.'
      }
    }
    const privacy = await this.session.extensions.loadExtension(
      join(this.bundledPath, 'rei-privacy')
    )
    privacyId = privacy.id
    setExtensionDoNotTrack(doNotTrack, globalPrivacyControl)
    await this.proxy.whenReady()
    this.starting = false
    this.save()
  }

  private async load(entry: InstalledExtension): Promise<void> {
    let timer: ReturnType<typeof setInterval> | undefined
    const deadline = Date.now() + 15000
    try {
      await Promise.race([
        this.loadExtension(entry),
        new Promise<never>((_resolve, reject) => {
          timer = setInterval(() => {
            if (Date.now() >= deadline)
              reject(
                new Error('Extension startup timed out. Restart Rei or try enabling it again.')
              )
          }, 50)
        })
      ])
    } finally {
      clearInterval(timer)
    }
  }

  private async loadExtension(entry: InstalledExtension): Promise<void> {
    const extension = await this.session.extensions.loadExtension(entry.path)
    if (extension.id !== entry.id) {
      this.session.extensions.removeExtension(extension.id)
      throw new Error('Extension ID changed. Reinstall the extension.')
    }
    this.installed.set(entry.id, this.describe(extension, entry.bundled))
    if (entry.bundled) {
      const deadline = Date.now() + 15000
      while (Date.now() < deadline) {
        const background = webContents
          .getAllWebContents()
          .find(
            (contents) =>
              contents.session === this.session &&
              contents.getURL() === `${extension.url}background.html`
          )
        if (
          background &&
          !background.isLoading() &&
          (await background
            .executeJavaScript('globalThis.\u00b5Block?.readyToFilter === true')
            .catch(() => false))
        )
          return
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      this.session.extensions.removeExtension(extension.id)
      const current = this.installed.get(entry.id)!
      current.error = 'uBlock Origin did not finish starting. Restart Rei or try enabling it again.'
      throw new Error(current.error)
    }
  }

  private async confirm(message: string, detail: string, allow: string): Promise<boolean> {
    const options = {
      type: 'question' as const,
      message,
      detail,
      buttons: [allow, 'Cancel'],
      defaultId: 1,
      cancelId: 1
    }
    const focused = BaseWindow.getFocusedWindow()
    const window = focused?.getParentWindow() ?? focused
    const result = window
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options)
    return result.response === 0
  }

  private save(): void {
    try {
      mkdirSync(app.getPath('userData'), { recursive: true })
      writeFileSync(
        `${this.statePath}.tmp`,
        JSON.stringify([...this.installed.values()], null, 2),
        { mode: 0o600 }
      )
      renameSync(`${this.statePath}.tmp`, this.statePath)
      this.error = ''
    } catch {
      this.error = 'Could not save extension settings. Check disk space and try again.'
    }
    this.publish()
  }

  state(): ExtensionState {
    return {
      extensions: [...this.installed.values()].map((entry) => ({
        id: entry.id,
        name: entry.name,
        version: entry.version,
        description: entry.description,
        bundled: entry.bundled,
        options: entry.options,
        icon: entry.icon,
        error: entry.error,
        compatibilityWarnings: entry.compatibilityWarnings,
        enabled: !!this.session.extensions.getExtension(entry.id)
      })),
      error: this.error
    }
  }

  private publish(): void {
    for (const contents of this.clients.keys())
      if (!contents.isDestroyed()) contents.send('extensions:changed', this.state())
  }

  registerWindow(window: BaseWindow, host: ExtensionWindow): void {
    const windowId = window.id
    this.windows.set(windowId, host)
    window.once('closed', () => {
      this.windows.delete(windowId)
      for (const [contents, owner] of this.clients)
        if (owner === windowId) this.clients.delete(contents)
    })
  }

  registerUI(
    contents: WebContents,
    window: BaseWindow,
    trusted: (event: IpcMainInvokeEvent) => boolean,
    openTab: (url: string) => void
  ): void {
    this.clients.set(contents, window.id)
    const validate = (event: IpcMainInvokeEvent, id: unknown): InstalledExtension => {
      if (!trusted(event)) throw new Error('Extension access denied.')
      if (typeof id !== 'string' || !extensionIdPattern.test(id) || !this.installed.has(id))
        throw new Error('Extension not found. Reload Settings and try again.')
      return this.installed.get(id)!
    }
    contents.ipc.handle('extensions:get', (event) => {
      if (!trusted(event)) throw new Error('Extension access denied.')
      return this.state()
    })
    contents.ipc.handle('extensions:toggle', async (event, id: unknown, enabled: unknown) => {
      const entry = validate(event, id)
      if (typeof enabled !== 'boolean') throw new Error('Invalid extension state.')
      if (this.pending.has(entry.id)) throw new Error('Extension is busy. Try again.')
      this.pending.add(entry.id)
      try {
        if (enabled) await this.load(entry)
        else this.session.extensions.removeExtension(entry.id)
        const current = this.installed.get(entry.id)!
        current.enabled = enabled
        delete current.error
        this.save()
        return this.state()
      } finally {
        this.pending.delete(entry.id)
      }
    })
    contents.ipc.handle('extensions:remove', async (event, id: unknown) => {
      const entry = validate(event, id)
      if (entry.bundled) throw new Error('Bundled extensions can be disabled, not removed.')
      if (this.pending.has(entry.id)) throw new Error('Extension is busy. Try again.')
      this.pending.add(entry.id)
      try {
        const result = await dialog.showMessageBox(window, {
          type: 'warning',
          message: `Remove ${entry.name}?`,
          detail: 'You can reinstall it from the Chrome Web Store.',
          buttons: ['Remove extension', 'Cancel'],
          defaultId: 1,
          cancelId: 1
        })
        if (window.isDestroyed() || result.response !== 0) return this.state()
        await uninstallExtension(entry.id, {
          session: this.session,
          extensionsPath: this.directory
        })
        await this.proxy.remove(entry.id)
        this.installed.delete(entry.id)
        this.save()
        return this.state()
      } finally {
        this.pending.delete(entry.id)
      }
    })
    contents.ipc.handle('extensions:options', (event, id: unknown) => {
      const entry = validate(event, id)
      const extension = this.session.extensions.getExtension(entry.id)
      if (!extension) throw new Error('Enable this extension before opening its options.')
      const page = extension.manifest.options_ui?.page ?? extension.manifest.options_page
      if (typeof page !== 'string') throw new Error('This extension has no options page.')
      const url = new URL(page, extension.url)
      if (url.protocol !== 'chrome-extension:' || url.hostname !== entry.id)
        throw new Error('Invalid extension options page.')
      openTab(url.href)
    })
    contents.ipc.handle('extensions:store', (event) => {
      if (!trusted(event)) throw new Error('Extension access denied.')
      openTab('https://chromewebstore.google.com/')
    })
  }

  allowedURL(value: string): boolean {
    try {
      const url = new URL(value)
      return (
        ['http:', 'https:'].includes(url.protocol) ||
        (url.protocol === 'chrome-extension:' &&
          !!this.session.extensions.getExtension(url.hostname) &&
          url.hostname !== privacyId)
      )
    } catch {
      return false
    }
  }
}
