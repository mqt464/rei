if (!process.versions.electron) {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = require('node:child_process').spawn(require('electron'), [__filename], {
    env,
    stdio: 'inherit',
    windowsHide: true
  })
  child.on('exit', (code) => process.exit(code ?? 1))
} else {
  const { app, BrowserWindow } = require('electron')
  app.whenReady().then(() => {
    const window = new BrowserWindow({
      width: 1100,
      height: 780,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    window.loadFile(
      require('node:path').resolve(__dirname, '../src/renderer/src/Commands.prototype.html')
    )
  })
  app.on('window-all-closed', () => app.quit())
}
