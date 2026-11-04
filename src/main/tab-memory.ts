import { app, safeStorage } from 'electron'
import type { NavigationEntry, WebContents } from 'electron'
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface TabSnapshot {
  entries: NavigationEntry[]
  index: number
  scroll: [number, number]
  zoom: number
  muted: boolean
}

const frozenContents = new WeakSet<WebContents>()

export async function freezeTab(contents: WebContents): Promise<void> {
  if (contents.debugger.isAttached()) throw new Error('Tab debugger is already in use.')
  contents.debugger.attach('1.3')
  frozenContents.add(contents)
  try {
    await contents.debugger.sendCommand('Page.setWebLifecycleState', { state: 'frozen' })
  } catch (error) {
    frozenContents.delete(contents)
    if (!contents.isDestroyed() && contents.debugger.isAttached()) contents.debugger.detach()
    throw error
  }
}

export async function thawTab(contents: WebContents): Promise<void> {
  if (!frozenContents.has(contents)) return
  if (!contents.isDestroyed() && contents.debugger.isAttached()) {
    await contents.debugger.sendCommand('Page.setWebLifecycleState', { state: 'active' })
    contents.debugger.detach()
  }
  frozenContents.delete(contents)
}

export class TabSnapshotStore {
  private directory?: string
  private memory = new Map<string, TabSnapshot>()

  save(id: string, snapshot: TabSnapshot, memoryOnly = false): void {
    if (memoryOnly) {
      this.memory.set(id, snapshot)
      return
    }
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure tab storage is unavailable.')
    if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
      throw new Error('A system secret store is required for tab restore data.')
    const serialized = JSON.stringify(snapshot)
    if (Buffer.byteLength(serialized) > 8 * 1024 * 1024)
      throw new Error('Tab state exceeds the restore-cache limit.')
    this.directory ??= mkdtempSync(join(app.getPath('temp'), 'rei-tab-cache-'))
    const file = this.path(id)
    writeFileSync(`${file}.tmp`, safeStorage.encryptString(serialized), { mode: 0o600 })
    renameSync(`${file}.tmp`, file)
  }

  read(id: string): TabSnapshot {
    const snapshot = this.memory.get(id)
    if (snapshot) return snapshot
    const value = JSON.parse(safeStorage.decryptString(readFileSync(this.path(id))))
    if (
      !value ||
      !Array.isArray(value.entries) ||
      !value.entries.length ||
      !Number.isInteger(value.index) ||
      value.index < 0 ||
      value.index >= value.entries.length ||
      !value.entries.every(
        (entry: NavigationEntry) =>
          entry &&
          typeof entry.url === 'string' &&
          /^(https?:\/\/|about:blank$)/.test(entry.url) &&
          typeof entry.title === 'string' &&
          (entry.pageState === undefined || typeof entry.pageState === 'string')
      ) ||
      !Array.isArray(value.scroll) ||
      value.scroll.length !== 2 ||
      !value.scroll.every(
        (coordinate: unknown) => typeof coordinate === 'number' && Number.isFinite(coordinate)
      ) ||
      typeof value.zoom !== 'number' ||
      !Number.isFinite(value.zoom) ||
      value.zoom <= 0 ||
      typeof value.muted !== 'boolean'
    )
      throw new Error('Invalid tab restore data.')
    return value
  }

  remove(id: string): void {
    this.memory.delete(id)
    if (!this.directory) return
    for (const suffix of ['', '.tmp']) {
      try {
        rmSync(`${this.path(id)}${suffix}`, { force: true })
      } catch (error) {
        console.error('Could not remove tab restore data:', error)
      }
    }
  }

  clear(): void {
    this.memory.clear()
    if (!this.directory) return
    try {
      rmSync(this.directory, { recursive: true, force: true })
      this.directory = undefined
    } catch (error) {
      console.error('Could not clear tab restore cache:', error)
    }
  }

  private path(id: string): string {
    if (!this.directory || !/^\d+$/.test(id)) throw new Error('Invalid tab restore key.')
    return join(this.directory, `${id}.bin`)
  }
}
