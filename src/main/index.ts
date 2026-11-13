import { app, shell, BaseWindow, dialog } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'node:fs'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import windowsIcon from '../../resources/icon.ico?asset'
import { attachBrowser } from './browser'
import type { DetachedTab } from './browser'
import { SearchStore } from './search-store'
import { ExtensionRuntime, setExtensionDoNotTrack } from './extensions'
import { currentPreferences } from './preferences'
import { prepareUIStorage } from './ui-storage'
import { initializeUpdates } from './updates'
import { finishLinkRouting, startLinkRouting } from './default-browser'
import { configureCookieProtection } from './cookie-protection'

function createWindow(
  store: SearchStore,
  extensions: ExtensionRuntime,
  detached?: DetachedTab
): void {
  const mainWindow = new BaseWindow({
    width: 900,
    height: 670,
    minWidth: 480,
    minHeight: 400,
    show: false,
    ...(detached ? { x: Math.round(detached.x), y: Math.round(detached.y) } : {}),
    autoHideMenuBar: true,
    ...(process.platform === 'win32'
      ? { frame: false }
      : {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: { color: '#18181b', symbolColor: '#f4f4f5', height: 38 }
        }),
    icon: process.platform === 'win32' ? windowsIcon : icon
  })

  const chrome = attachBrowser(
    mainWindow,
    store,
    extensions,
    (tab) => createWindow(store, extensions, tab),
    detached
  )
  chrome.once('did-finish-load', () => {
    mainWindow.show()
  })

  chrome.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  chrome.on('will-navigate', (event) => event.preventDefault())
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void chrome.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void chrome.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

if (!configureCookieProtection(currentPreferences().blockThirdPartyCookies)) app.exit(0)
else if (!startLinkRouting()) app.quit()
else
  app
    .whenReady()
    .then(async () => {
      const directory = app.getPath('userData')
      mkdirSync(directory, { recursive: true })
      const store = new SearchStore(join(directory, 'search.sqlite'))
      app.once('will-quit', () => store.close())
      app.setAppUserModelId('io.github.mqt464.rei')
      if (process.platform === 'darwin') app.dock?.setIcon(icon)

      setExtensionDoNotTrack(
        currentPreferences().doNotTrack,
        currentPreferences().globalPrivacyControl,
        currentPreferences().cleanTrackingLinks
      )
      const extensions = new ExtensionRuntime()
      await Promise.all([prepareUIStorage(), extensions.initialize()])
      finishLinkRouting(() => createWindow(store, extensions))
      initializeUpdates()

      app.on('activate', function () {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (BaseWindow.getAllWindows().length === 0) createWindow(store, extensions)
      })
    })
    .catch((error: unknown) => {
      dialog.showErrorBox(
        'Could not start Rei',
        error instanceof Error ? error.message : String(error)
      )
      app.quit()
    })

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
