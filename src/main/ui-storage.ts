import { app, WebContentsView } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'

let migrated: Record<string, string> = {}

export function legacyUIStorage(): Record<string, string> {
  return migrated
}

export async function prepareUIStorage(): Promise<void> {
  const path = join(app.getPath('userData'), 'ui-storage-migration.json')
  if (existsSync(path)) {
    const saved = JSON.parse(readFileSync(path, 'utf8'))
    for (const key of ['rei:suggestions', 'rei:shortcuts'])
      if (typeof saved?.[key] === 'string' && saved[key].length <= 65536) migrated[key] = saved[key]
    return
  }
  const probe = new WebContentsView({
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  probe.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  try {
    if (is.dev && process.env.ELECTRON_RENDERER_URL)
      await probe.webContents.loadURL(process.env.ELECTRON_RENDERER_URL)
    else await probe.webContents.loadFile(join(__dirname, '../renderer/index.html'))
    migrated = await probe.webContents.executeJavaScript(`Object.fromEntries(
      ['rei:suggestions', 'rei:shortcuts'].map(key => [key, localStorage.getItem(key)])
        .filter(([, value]) => typeof value === 'string' && value.length <= 65536)
    )`)
    writeFileSync(`${path}.tmp`, JSON.stringify(migrated), { mode: 0o600 })
    renameSync(`${path}.tmp`, path)
  } finally {
    probe.webContents.close()
  }
}
