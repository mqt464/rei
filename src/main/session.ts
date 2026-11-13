import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isInternalUrl } from '../shared/navigation'
import type { BrowserTab } from '../shared/browser'
import type { Preferences } from '../shared/preferences'

interface SavedSession {
  urls: string[]
  active: number
  splits?: [number, number, number?][]
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
          splits: Array.isArray(saved.splits)
            ? saved.splits.filter(
                (pair: unknown) =>
                  Array.isArray(pair) &&
                  (pair.length === 2 || pair.length === 3) &&
                  (pair.length === 2 ||
                    (typeof pair[2] === 'number' &&
                      Number.isFinite(pair[2]) &&
                      pair[2] > 0 &&
                      pair[2] < 1)) &&
                  pair[0] !== pair[1] &&
                  pair
                    .slice(0, 2)
                    .every(
                      (index: unknown) =>
                        typeof index === 'number' &&
                        Number.isInteger(index) &&
                        index >= 0 &&
                        index < saved.urls.length
                    )
              )
            : [],
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
  let offset = 0
  const splits = entries.flatMap((entry) => {
    const pairs = (entry.splits ?? []).map(([left, right, ratio = 0.5]) => [
      left + offset,
      right + offset,
      ratio
    ])
    offset += entry.urls.length
    return pairs.filter((pair) => pair[0] < urls.length && pair[1] < urls.length)
  })
  try {
    const directory = app.getPath('userData')
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'session.json.tmp'), JSON.stringify({ urls, active, splits }), {
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
    splits: safe.flatMap((tab, index) => {
      if (tab.split?.side !== 'left') return []
      const partner = safe.findIndex((entry) => entry.id === tab.split!.partnerId)
      return partner < 0
        ? []
        : [[index, partner, tab.split.ratio ?? 0.5] as [number, number, number]]
    }),
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
