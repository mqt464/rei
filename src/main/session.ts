import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isInternalUrl } from '../shared/navigation'
import type { BrowserTab } from '../shared/browser'
import type { Preferences } from '../shared/preferences'

interface SavedSession {
  urls: string[]
  active: number
}
const windows = new Map<number, SavedSession>()
let startupClaimed = false
let timer: ReturnType<typeof setTimeout> | undefined

function validUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 8192) return false
  if (!value || isInternalUrl(value)) return true
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
}

export function startupSession(preferences: Preferences): SavedSession {
  if (startupClaimed) return { urls: [''], active: 0 }
  startupClaimed = true
  if (preferences.startup === 'pages')
    return {
      urls: preferences.startupPages.length ? [...preferences.startupPages] : [''],
      active: 0
    }
  if (preferences.startup === 'restore') {
    try {
      const saved = JSON.parse(readFileSync(join(app.getPath('userData'), 'session.json'), 'utf8'))
      if (
        Array.isArray(saved.urls) &&
        saved.urls.length > 0 &&
        saved.urls.length <= 500 &&
        saved.urls.every(validUrl)
      )
        return {
          urls: saved.urls,
          active: Number.isInteger(saved.active)
            ? Math.max(0, Math.min(saved.active, saved.urls.length - 1))
            : 0
        }
    } catch {
      return { urls: [''], active: 0 }
    }
  }
  return { urls: [''], active: 0 }
}

function flush(): void {
  clearTimeout(timer)
  const entries = [...windows.values()]
  if (!entries.length) return
  const urls = entries.flatMap((entry) => entry.urls).slice(0, 500)
  const active = entries[0].active
  try {
    const directory = app.getPath('userData')
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'session.json.tmp'), JSON.stringify({ urls, active }), {
      mode: 0o600
    })
    renameSync(join(directory, 'session.json.tmp'), join(directory, 'session.json'))
  } catch (error) {
    console.error('Could not save browser session:', error)
  }
}

export function saveSession(windowId: number, tabs: BrowserTab[], activeId: string): void {
  const safe = tabs.filter((tab) => !tab.incognito && validUrl(tab.url))
  windows.set(windowId, {
    urls: safe.map((tab) => tab.url),
    active: Math.max(
      0,
      safe.findIndex((tab) => tab.id === activeId)
    )
  })
  clearTimeout(timer)
  timer = setTimeout(flush, 250)
  timer.unref()
}

export function closeSession(windowId: number): void {
  flush()
  windows.delete(windowId)
  if (windows.size) flush()
}
