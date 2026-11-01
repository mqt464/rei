import { app, shell, BaseWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'node:fs'
import { electronApp, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { attachBrowser } from './browser'
import { SearchStore } from './search-store'

function createWindow(store: SearchStore): void {
  // Create the browser window.
  const mainWindow = new BaseWindow({
    width: 900,
    height: 670,
    minWidth: 480,
    minHeight: 400,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'win32'
      ? { frame: false }
      : {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: { color: '#18181b', symbolColor: '#f4f4f5', height: 38 }
        }),
    ...(process.platform === 'linux' ? { icon } : {})
  })

  const chrome = attachBrowser(mainWindow, store)
  chrome.once('did-finish-load', () => {
    mainWindow.show()
  })

  chrome.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  chrome.on('will-navigate', (event) => event.preventDefault())
  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  chrome.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (is.dev && input.key === 'F12') chrome.toggleDevTools()
    if (!is.dev && (input.control || input.meta) && input.key.toLowerCase() === 'r')
      event.preventDefault()
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void chrome.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void chrome.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app
  .whenReady()
  .then(() => {
    const directory = app.getPath('userData')
    mkdirSync(directory, { recursive: true })
    const store = new SearchStore(join(directory, 'search.sqlite'))
    app.once('will-quit', () => store.close())
    // Set app user model id for windows
    electronApp.setAppUserModelId('com.electron')

    // IPC test
    ipcMain.on('ping', () => console.log('pong'))
    createWindow(store)

    app.on('activate', function () {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (BaseWindow.getAllWindows().length === 0) createWindow(store)
    })
  })
  .catch((error: unknown) => {
    dialog.showErrorBox(
      'Could not open search storage',
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

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
