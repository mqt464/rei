import { app, dialog } from 'electron'
import type { BaseWindow, IpcMainInvokeEvent, WebContents } from 'electron'
import { autoUpdater } from 'electron-updater'
import { currentPreferences } from './preferences'
import type { UpdateState } from '../shared/updates'

const supported = app.isPackaged && (process.platform !== 'linux' || !!process.env.APPIMAGE)
const clients = new Set<WebContents>()
let state: UpdateState = {
  currentVersion: app.getVersion(),
  status: supported ? 'idle' : 'unsupported',
  version: '',
  progress: 0,
  message: !app.isPackaged
    ? ''
    : !supported
      ? 'Update Rei through your package manager. Automatic updates require the AppImage build on Linux.'
      : ''
}
let busy = false
let confirming = false
let installing = false

export function isInstallingUpdate(): boolean {
  return installing
}

function publish(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch }
  for (const contents of clients)
    if (!contents.isDestroyed()) contents.send('updates:changed', state)
}

async function check(): Promise<UpdateState> {
  if (!supported || busy || state.status === 'ready') return state
  busy = true
  publish({ status: 'checking', message: '', progress: 0, version: '' })
  try {
    const result = await autoUpdater.checkForUpdates()
    if (result?.downloadPromise) await result.downloadPromise
    if (!result)
      publish({ status: 'error', message: 'Updates are unavailable for this installation.' })
  } catch {
    publish({
      status: 'error',
      message: 'Could not check or download the update. Check your connection and try again.'
    })
  } finally {
    busy = false
  }
  return state
}

export function initializeUpdates(): void {
  if (!supported) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  autoUpdater.on('error', () => {
    installing = false
    publish({
      status: 'error',
      message: 'Could not update Rei. Check your connection and try again.'
    })
  })
  autoUpdater.on('update-available', (info) => {
    publish({ status: 'available', version: info.version, message: '' })
  })
  autoUpdater.on('update-not-available', () => {
    publish({ status: 'current', message: '' })
  })
  autoUpdater.on('download-progress', (info) => {
    const progress = Math.max(0, Math.min(100, Math.floor(info.percent)))
    if (state.status !== 'downloading' || state.progress !== progress)
      publish({ status: 'downloading', progress })
  })
  autoUpdater.on('update-downloaded', (info) => {
    publish({ status: 'ready', version: info.version, progress: 100, message: '' })
  })
  const automaticCheck = (): void => {
    if (currentPreferences().automaticUpdates) void check()
  }
  const startup = setTimeout(automaticCheck, 15_000)
  const interval = setInterval(automaticCheck, 6 * 60 * 60 * 1000)
  startup.unref()
  interval.unref()
  app.once('will-quit', () => {
    clearTimeout(startup)
    clearInterval(interval)
  })
}

export function registerUpdates(
  contents: WebContents,
  window: BaseWindow,
  trusted: (event: IpcMainInvokeEvent) => boolean
): void {
  clients.add(contents)
  contents.once('destroyed', () => clients.delete(contents))
  contents.ipc.handle('updates:get', (event) => {
    if (!trusted(event)) throw new Error('Update access denied.')
    return state
  })
  contents.ipc.handle('updates:check', (event) => {
    if (!trusted(event)) throw new Error('Update access denied.')
    return check()
  })
  contents.ipc.handle('updates:install', async (event) => {
    if (!trusted(event)) throw new Error('Update access denied.')
    if (state.status !== 'ready' || confirming || installing) return
    confirming = true
    try {
      const { response } = await dialog.showMessageBox(window, {
        type: 'question',
        message: 'Restart Rei to install the update?',
        detail:
          'Save your work first. All windows will close, and active downloads will be interrupted.',
        buttons: ['Restart and install', 'Cancel'],
        defaultId: 1,
        cancelId: 1
      })
      if (response === 0 && !window.isDestroyed() && state.status === 'ready') {
        installing = true
        autoUpdater.quitAndInstall(false, true)
      }
    } catch (error) {
      installing = false
      throw error
    } finally {
      confirming = false
    }
  })
}
