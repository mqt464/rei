import { app, dialog } from 'electron'
import type { BaseWindow, IpcMainInvokeEvent, Session, WebContents } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, isAbsolute, join } from 'node:path'
import { defaultPreferences, parsePreferences } from '../shared/preferences'
import type { Preferences } from '../shared/preferences'
import { setExtensionDoNotTrack } from './extensions'
import { clearDownloadHistory, trackDownload } from './downloads'
import { cleanTrackingUrl } from '../shared/privacy'

let preferences: Preferences | undefined
const clients = new Map<WebContents, (value: Preferences) => void>()
const sessions = new Set<Session>()
const downloads = new Set<string>()
const downloading = new Map<number, number>()
export function hasActiveDownload(contents: WebContents): boolean {
  return (downloading.get(contents.id) ?? 0) > 0
}

export function currentPreferences(): Preferences {
  if (!preferences) {
    try {
      const saved = JSON.parse(
        readFileSync(join(app.getPath('userData'), 'preferences.json'), 'utf8')
      )
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        for (const key of ['tabSleepMinutes', 'tabDiscardMinutes']) {
          if (typeof saved[key] === 'number' && saved[key] > 360 && saved[key] <= 1440)
            saved[key] = 360
        }
      }
      preferences = parsePreferences(saved)
    } catch {
      preferences = { ...defaultPreferences }
    }
  }
  return preferences
}

let saving: Promise<unknown> = Promise.resolve()

function save(patch: unknown): Promise<Preferences> {
  const pending = saving.catch(() => {}).then(() => persist(patch))
  saving = pending
  return pending
}

async function persist(patch: unknown): Promise<Preferences> {
  const next = parsePreferences(patch, currentPreferences())
  if (
    next.downloadDirectory &&
    (!isAbsolute(next.downloadDirectory) ||
      !existsSync(next.downloadDirectory) ||
      !statSync(next.downloadDirectory).isDirectory())
  )
    throw new Error('Choose an existing download folder.')
  const directory = app.getPath('userData')
  try {
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'preferences.json.tmp'), JSON.stringify(next, null, 2), {
      mode: 0o600
    })
    renameSync(join(directory, 'preferences.json.tmp'), join(directory, 'preferences.json'))
  } catch {
    throw new Error('Could not save preferences. Check disk space and try again.')
  }
  preferences = next
  if (!next.downloadHistory) clearDownloadHistory()
  await setExtensionDoNotTrack(next.doNotTrack, next.globalPrivacyControl, next.cleanTrackingLinks)
  for (const session of sessions) {
    session.setSpellCheckerEnabled(next.spellcheck)
    session.setDownloadPath(next.downloadDirectory || app.getPath('downloads'))
  }
  for (const [contents, update] of clients) {
    if (contents.isDestroyed()) continue
    update(next)
    contents.send('preferences:changed', next)
  }
  return next
}

export function registerSessionPreferences(session: Session, incognito = false): void {
  if (!sessions.has(session)) {
    sessions.add(session)
    if (incognito) {
      session.webRequest.onBeforeRequest((details, callback) => {
        const cleaned =
          currentPreferences().cleanTrackingLinks &&
          details.method === 'GET' &&
          ['mainFrame', 'subFrame'].includes(details.resourceType)
            ? cleanTrackingUrl(details.url)
            : details.url
        callback(cleaned === details.url ? {} : { redirectURL: cleaned })
      })
      session.webRequest.onBeforeSendHeaders((details, callback) => {
        const { doNotTrack, globalPrivacyControl } = currentPreferences()
        const headers = { ...details.requestHeaders }
        for (const name of Object.keys(headers)) {
          if (
            (doNotTrack && name.toLowerCase() === 'dnt') ||
            (globalPrivacyControl && name.toLowerCase() === 'sec-gpc')
          )
            delete headers[name]
        }
        if (doNotTrack) headers.DNT = '1'
        if (globalPrivacyControl) headers['Sec-GPC'] = '1'
        callback({ requestHeaders: headers })
      })
    }
    session.setSpellCheckerEnabled(currentPreferences().spellcheck)
    session.setDownloadPath(currentPreferences().downloadDirectory || app.getPath('downloads'))
    session.on('will-download', (_event, item, source) => {
      if (!incognito) trackDownload(item)
      const sourceId = source?.id
      if (sourceId !== undefined) {
        downloading.set(sourceId, (downloading.get(sourceId) ?? 0) + 1)
        item.once('done', () => {
          const count = (downloading.get(sourceId) ?? 1) - 1
          if (count) downloading.set(sourceId, count)
          else downloading.delete(sourceId)
        })
      }
      if (currentPreferences().downloadPrompt) return
      const directory = currentPreferences().downloadDirectory || app.getPath('downloads')
      const filename = basename(item.getFilename())
      const extension = extname(filename)
      const stem = filename.slice(0, filename.length - extension.length)
      let destination = join(directory, filename)
      let suffix = 1
      while (existsSync(destination) || downloads.has(destination))
        destination = join(directory, `${stem} (${suffix++})${extension}`)
      downloads.add(destination)
      item.once('done', () => downloads.delete(destination))
      item.setSavePath(destination)
    })
  }
}

export function registerPreferences(
  contents: WebContents,
  window: BaseWindow,
  trusted: (event: IpcMainInvokeEvent) => boolean,
  update: (value: Preferences) => void
): void {
  clients.set(contents, update)
  contents.once('destroyed', () => clients.delete(contents))
  registerSessionPreferences(contents.session)
  contents.ipc.handle('preferences:get', (event) => {
    if (!trusted(event)) throw new Error('Preference access denied.')
    return currentPreferences()
  })
  contents.ipc.handle('preferences:set', (event, patch: unknown) => {
    if (!trusted(event)) throw new Error('Preference access denied.')
    return save(patch)
  })
  contents.ipc.handle('preferences:download-folder', async (event) => {
    if (!trusted(event)) throw new Error('Preference access denied.')
    const result = await dialog.showOpenDialog(window, {
      title: 'Download folder',
      defaultPath: currentPreferences().downloadDirectory || app.getPath('downloads'),
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return currentPreferences()
    return save({ downloadDirectory: result.filePaths[0] })
  })
}
