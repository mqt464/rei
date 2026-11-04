import { app, shell } from 'electron'
import type { DownloadItem, IpcMainInvokeEvent, Session, WebContents } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { currentPreferences } from './preferences'
import type { DownloadAction, DownloadRecord } from '../shared/downloads'
import { retryMediaDownload } from './media-downloads'

const records = new Map<string, DownloadRecord>()
const items = new Map<string, DownloadItem>()
const clients = new Set<WebContents>()
const queuedCancels = new Map<string, () => void>()
let loaded = false
let timer: ReturnType<typeof setTimeout> | undefined

function load(): void {
  if (loaded) return
  loaded = true
  if (!currentPreferences().downloadHistory) return
  try {
    const saved: unknown = JSON.parse(
      readFileSync(join(app.getPath('userData'), 'downloads.json'), 'utf8')
    )
    if (!Array.isArray(saved)) return
    for (const entry of saved.slice(0, 500)) {
      if (
        !entry ||
        typeof entry !== 'object' ||
        typeof entry.id !== 'string' ||
        typeof entry.filename !== 'string' ||
        typeof entry.url !== 'string' ||
        !/^https?:\/\//i.test(entry.url) ||
        typeof entry.path !== 'string' ||
        entry.path.includes('\0') ||
        (entry.path && !isAbsolute(entry.path)) ||
        !['progressing', 'paused', 'interrupted', 'completed', 'cancelled'].includes(
          entry.status
        ) ||
        entry.started > 8640000000000000 ||
        ![entry.received, entry.total, entry.started].every(
          (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0
        )
      )
        continue
      records.set(entry.id, {
        ...entry,
        active: false,
        canResume: false,
        speed: 0,
        status: ['progressing', 'paused'].includes(entry.status) ? 'interrupted' : entry.status
      })
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      console.error('Could not load download history:', error)
  }
}

function snapshot(): DownloadRecord[] {
  load()
  return [...records.values()].sort((first, second) => second.started - first.started)
}

function publish(): void {
  clearTimeout(timer)
  timer = undefined
  const state = snapshot()
  for (const client of clients) if (!client.isDestroyed()) client.send('downloads:changed', state)
}

function save(): void {
  const history = snapshot()
    .filter((record) => !record.active && !record.private)
    .slice(0, 500)
  const retained = new Set(history.map((record) => record.id))
  for (const record of records.values())
    if (!record.active && !retained.has(record.id)) records.delete(record.id)
  const directory = app.getPath('userData')
  try {
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      join(directory, 'downloads.json.tmp'),
      JSON.stringify(
        currentPreferences().downloadHistory ? snapshot().filter((record) => !record.private) : []
      ),
      { mode: 0o600 }
    )
    renameSync(join(directory, 'downloads.json.tmp'), join(directory, 'downloads.json'))
  } catch (error) {
    console.error('Could not save download history:', error)
  }
  publish()
}

export function clearDownloadHistory(): void {
  load()
  for (const [id, record] of records) if (!record.active) records.delete(id)
  save()
}

export function queuedDownload(record: DownloadRecord, cancel: () => void): void {
  load()
  records.set(record.id, record)
  queuedCancels.set(record.id, cancel)
  save()
}

export function updateQueuedDownload(record: DownloadRecord): void {
  if (!record.active) {
    queuedCancels.delete(record.id)
    if (record.private || !currentPreferences().downloadHistory) records.delete(record.id)
    save()
  } else {
    if (!timer) timer = setTimeout(publish, 200)
  }
}

export function trackDownload(item: DownloadItem): void {
  load()
  const record: DownloadRecord = {
    id: randomUUID(),
    filename: item.getFilename(),
    url: item.getURL(),
    path: '',
    received: item.getReceivedBytes(),
    total: item.getTotalBytes(),
    speed: 0,
    started: Date.now(),
    status: 'progressing',
    active: true,
    canResume: false
  }
  records.set(record.id, record)
  items.set(record.id, item)
  let sampleTime = Date.now()
  let sampleBytes = record.received
  function update(): void {
    const now = Date.now()
    record.received = item.getReceivedBytes()
    record.total = item.getTotalBytes()
    record.path = item.getSavePath()
    record.filename = record.path ? basename(record.path) : item.getFilename()
    record.canResume = item.canResume()
    if (now - sampleTime >= 500) {
      record.speed = Math.max(0, ((record.received - sampleBytes) * 1000) / (now - sampleTime))
      sampleTime = now
      sampleBytes = record.received
    }
    if (record.status !== 'progressing') record.speed = 0
  }
  item.on('updated', (_event, state) => {
    record.status = item.isPaused() ? 'paused' : state
    update()
    if (!timer) timer = setTimeout(publish, 200)
  })
  item.once('done', (_event, state) => {
    record.status = state
    update()
    record.active = false
    record.canResume = false
    record.speed = 0
    items.delete(record.id)
    if (!currentPreferences().downloadHistory) records.delete(record.id)
    save()
  })
  save()
}

export function registerDownloads(
  contents: WebContents,
  trusted: (event: IpcMainInvokeEvent) => boolean,
  session: Session
): void {
  clients.add(contents)
  contents.once('destroyed', () => clients.delete(contents))
  contents.ipc.handle('downloads:get', (event) => {
    if (!trusted(event)) throw new Error('Download access denied.')
    return snapshot()
  })
  contents.ipc.handle('downloads:clear', (event) => {
    if (!trusted(event)) throw new Error('Download access denied.')
    clearDownloadHistory()
  })
  contents.ipc.handle('downloads:folder', async (event) => {
    if (!trusted(event)) throw new Error('Download access denied.')
    const error = await shell.openPath(
      currentPreferences().downloadDirectory || app.getPath('downloads')
    )
    if (error) throw new Error(error)
  })
  contents.ipc.handle('downloads:action', async (event, id: unknown, action: DownloadAction) => {
    if (!trusted(event)) throw new Error('Download access denied.')
    if (typeof id !== 'string') throw new Error('Invalid download.')
    const record = records.get(id)
    if (!record) throw new Error('Download no longer available.')
    if (record.media && action === 'cancel' && record.active) {
      queuedCancels.get(id)?.()
      return
    }
    if (record.media && action === 'retry' && !record.active && record.status !== 'completed') {
      retryMediaDownload(record)
      return
    }
    const item = items.get(id)
    if (action === 'pause' && item && record.status === 'progressing') item.pause()
    else if (action === 'resume' && item && item.canResume()) item.resume()
    else if (action === 'cancel' && item) item.cancel()
    else if (action === 'retry' && !record.active && record.status !== 'completed') {
      if (!/^https?:\/\//i.test(record.url))
        throw new Error('This download cannot be retried. Download it from its website again.')
      session.downloadURL(record.url)
    } else if ((action === 'open' || action === 'reveal') && record.status === 'completed') {
      if (!record.path || !existsSync(record.path))
        throw new Error('File moved or deleted. Download it again from its website.')
      if (action === 'reveal') shell.showItemInFolder(record.path)
      else {
        const error = await shell.openPath(record.path)
        if (error) throw new Error(error)
      }
    } else if (action === 'remove' && !record.active) {
      records.delete(id)
      save()
      return
    } else throw new Error('This action is not available for this download.')
    if (item && (action === 'pause' || action === 'resume') && record.active) {
      record.status = item.isPaused() ? 'paused' : item.getState()
      record.canResume = item.canResume()
    }
    publish()
  })
}
