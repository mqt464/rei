import { app, shell } from 'electron'
import type { BaseWindow, IpcMainInvokeEvent, WebContents } from 'electron'

const windows = new Map<BaseWindow, (url: string) => void>()
const pending: string[] = []
let createWindow: (() => void) | undefined

export function externalURLs(arguments_: string[]): string[] {
  return arguments_.filter((value) => {
    if (
      value.length > 8192 ||
      /[\r\n\t]/.test(value) ||
      value.includes('\0') ||
      !/^https?:\/\//i.test(value)
    )
      return false
    try {
      const url = new URL(value)
      return !!url.hostname && !url.username && !url.password
    } catch {
      return false
    }
  })
}

function routeLinks(urls: string[]): void {
  if (!createWindow) {
    pending.push(...urls)
    return
  }
  let window = [...windows.keys()].at(-1)
  if (!window) {
    createWindow()
    window = [...windows.keys()].at(-1)
  }
  if (!window) return
  for (const url of urls) windows.get(window)!(url)
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

export function startLinkRouting(): boolean {
  if (!app.requestSingleInstanceLock()) return false
  pending.push(...externalURLs(process.argv.slice(process.defaultApp ? 2 : 1)))
  app.on('open-url', (event, url) => {
    event.preventDefault()
    const urls = externalURLs([url])
    if (urls.length) routeLinks(urls)
  })
  app.on('second-instance', (_event, arguments_) => {
    routeLinks(externalURLs(arguments_.slice(process.defaultApp ? 2 : 1)))
  })
  return true
}

export function finishLinkRouting(factory: () => void): void {
  createWindow = factory
  routeLinks(pending.splice(0))
}

export function registerLinkWindow(window: BaseWindow, open: (url: string) => void): void {
  windows.set(window, open)
  window.on('focus', () => {
    windows.delete(window)
    windows.set(window, open)
  })
  window.once('closed', () => {
    windows.delete(window)
  })
}

export function registerDefaultBrowser(
  contents: WebContents,
  trusted: (event: IpcMainInvokeEvent) => boolean
): void {
  contents.ipc.handle('browser:make-default', async (event) => {
    if (!trusted(event)) throw new Error('Default browser access denied.')
    if (!app.isPackaged) throw new Error('Install Rei before making it your default browser.')
    if (process.platform === 'win32') {
      await shell.openExternal('ms-settings:defaultapps?registeredAppUser=Rei')
      return
    }
    const http = app.setAsDefaultProtocolClient('http')
    const https = app.setAsDefaultProtocolClient('https')
    if (!http || !https)
      throw new Error('Could not change the default browser. Use system settings.')
  })
}
