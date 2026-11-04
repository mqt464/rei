import { app, shell } from 'electron'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unwatchFile,
  watchFile,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { defaultShortcuts, parseShortcuts } from '../shared/search'
import type { SearchShortcut } from '../shared/search'

let shortcuts: SearchShortcut[] | undefined
let fileError = ''
const clients = new Map<WebContents, (value: SearchShortcut[]) => void>()
const filename = (): string => join(app.getPath('userData'), 'site-search.json')

function readSites(): SearchShortcut[] {
  if (statSync(filename()).size > 128 * 1024)
    throw new Error('Site search JSON must be smaller than 128 KB.')
  return parseShortcuts(JSON.parse(readFileSync(filename(), 'utf8')))
}

function publishError(message: string): void {
  fileError = message
  for (const client of clients.keys())
    if (!client.isDestroyed()) client.send('site-search:error', message)
}

function refresh(): void {
  if (!existsSync(filename())) return
  try {
    const next = readSites()
    if (JSON.stringify(next) !== JSON.stringify(shortcuts)) {
      shortcuts = next
      for (const [client, update] of clients) {
        if (client.isDestroyed()) continue
        update(next)
        client.send('site-search:changed', next)
      }
    }
    publishError('')
  } catch (error) {
    publishError(
      `Could not apply site-search.json: ${error instanceof Error ? error.message : 'Invalid JSON.'} Your last valid sites are still active.`
    )
  }
}

function initialize(legacy?: unknown): SearchShortcut[] {
  if (shortcuts) return shortcuts
  if (existsSync(filename())) {
    try {
      shortcuts = readSites()
    } catch {
      shortcuts = defaultShortcuts
      refresh()
    }
    return shortcuts
  }
  let next = defaultShortcuts
  if (typeof legacy === 'string' && legacy.length <= 128 * 1024) {
    try {
      next = parseShortcuts(
        legacy
          .split('\n')
          .filter((line) => line.trim())
          .map((line) => {
            const [keyword, title, ...url] = line.split('|')
            return { keyword, title, url: url.join('|') }
          })
      )
    } catch {
      next = defaultShortcuts
    }
  }
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(`${filename()}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 })
  renameSync(`${filename()}.tmp`, filename())
  shortcuts = next
  return next
}

export function registerSiteSearch(
  contents: WebContents,
  trusted: (event: IpcMainInvokeEvent) => boolean,
  update: (value: SearchShortcut[]) => void
): void {
  const first = !clients.size
  clients.set(contents, update)
  if (existsSync(filename())) update(initialize())
  if (first) watchFile(filename(), { interval: 500, persistent: false }, refresh)
  contents.once('destroyed', () => {
    clients.delete(contents)
    if (!clients.size) unwatchFile(filename())
  })
  contents.ipc.handle('site-search:get', (event, legacy: unknown) => {
    if (!trusted(event)) throw new Error('Site search access denied.')
    const previous = shortcuts
    const value = initialize(legacy)
    if (previous !== value)
      for (const [client, changed] of clients) {
        changed(value)
        if (!client.isDestroyed()) client.send('site-search:changed', value)
      }
    contents.send('site-search:error', fileError)
    return value
  })
  contents.ipc.handle('site-search:open-file', async (event) => {
    if (!trusted(event)) throw new Error('Site search access denied.')
    initialize()
    if (!existsSync(filename())) {
      mkdirSync(app.getPath('userData'), { recursive: true })
      writeFileSync(filename(), JSON.stringify(shortcuts, null, 2), { mode: 0o600 })
    }
    if (await shell.openPath(filename()))
      throw new Error(
        'Could not open site-search.json. Associate JSON files with a text editor and try again.'
      )
  })
}
