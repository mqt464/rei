import { DatabaseSync } from 'node:sqlite'
import { EventEmitter } from 'node:events'
import type { SearchResult } from '../shared/search'

export interface HistoryEntry {
  url: string
  title: string
  favicon: string | null
  visits: number
  typedVisits: number
  lastVisit: number
  selections: number
  queryUses: number
}

export type SearchProvider = 'search' | 'websites'

function webUrl(value: string): string | undefined {
  if (value.length > 8192) return undefined
  try {
    const url = new URL(value)
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password)
      return url.href
  } catch {
    return undefined
  }
  return undefined
}

function providerResults(value: unknown, provider: SearchProvider): SearchResult[] | undefined {
  if (!Array.isArray(value) || value.length > 24) return undefined
  const results: SearchResult[] = []
  for (const result of value) {
    if (!result || typeof result.title !== 'string' || result.title.length > 512) return undefined
    if (provider === 'search') {
      if (
        result.kind !== 'search' ||
        typeof result.query !== 'string' ||
        !result.query.trim() ||
        result.query.length > 256
      )
        return undefined
      results.push({
        id: `search:${result.query}`,
        kind: 'search',
        title: result.title,
        query: result.query
      })
    } else {
      if (result.kind !== 'website' || typeof result.url !== 'string') return undefined
      const url = webUrl(result.url)
      if (!url) return undefined
      results.push({
        id: `website:${url}`,
        kind: 'website',
        title: result.title,
        url,
        description:
          typeof result.description === 'string' ? result.description.slice(0, 240) : undefined,
        favicon: typeof result.favicon === 'string' ? webUrl(result.favicon) : undefined
      })
    }
  }
  return results
}

export class SearchStore extends EventEmitter {
  private database: DatabaseSync
  warning: string | undefined
  generation = 0

  constructor(filename: string) {
    super()
    this.database = new DatabaseSync(filename)
    try {
      const version = this.database.prepare('PRAGMA user_version').get()?.user_version
      if (version !== 0 && version !== 1) throw new Error('Unsupported search database version.')
      this.database.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 3000;
        PRAGMA secure_delete = ON;
        CREATE TABLE IF NOT EXISTS history (
          url TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          favicon TEXT,
          visits INTEGER NOT NULL DEFAULT 1,
          typed_visits INTEGER NOT NULL DEFAULT 0,
          last_visit INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS history_recency ON history(last_visit);
        CREATE TABLE IF NOT EXISTS choices (
          query TEXT NOT NULL,
          url TEXT NOT NULL,
          uses INTEGER NOT NULL DEFAULT 1,
          last_used INTEGER NOT NULL,
          PRIMARY KEY(query, url)
        );
        CREATE INDEX IF NOT EXISTS choices_url ON choices(url);
        CREATE TABLE IF NOT EXISTS provider_cache (
          provider TEXT NOT NULL CHECK(provider IN ('search', 'websites')),
          query TEXT NOT NULL,
          payload TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          accessed_at INTEGER NOT NULL,
          PRIMARY KEY(provider, query)
        );
        PRAGMA user_version = 1;
      `)
      this.prune()
    } catch (error) {
      this.database.close()
      throw error
    }
  }

  private attempt<Result>(operation: () => Result, fallback: Result): Result {
    try {
      return operation()
    } catch (error) {
      console.error('Search storage unavailable:', error)
      this.warning = 'Search storage unavailable. History and learned choices may be incomplete.'
      return fallback
    }
  }

  private prune(): void {
    const cutoff = Date.now() - 90 * 86400000
    this.database.prepare('DELETE FROM history WHERE last_visit < ?').run(cutoff)
    this.database.exec(
      'DELETE FROM history WHERE url IN (SELECT url FROM history ORDER BY last_visit DESC LIMIT -1 OFFSET 5000)'
    )
    this.database
      .prepare('DELETE FROM choices WHERE last_used < ? OR url NOT IN (SELECT url FROM history)')
      .run(cutoff)
    this.database.exec(
      'DELETE FROM choices WHERE rowid IN (SELECT rowid FROM choices ORDER BY last_used DESC LIMIT -1 OFFSET 5000)'
    )
    this.database.prepare('DELETE FROM provider_cache WHERE expires_at <= ?').run(Date.now())
    this.database.exec(
      'DELETE FROM provider_cache WHERE rowid IN (SELECT rowid FROM provider_cache ORDER BY accessed_at DESC LIMIT -1 OFFSET 100)'
    )
  }

  visit(url: string, title: string, favicon: string | undefined, typed: boolean): void {
    const address = webUrl(url)
    if (!address) return
    this.attempt(() => {
      this.database
        .prepare(
          `
        INSERT INTO history(url, title, favicon, typed_visits, last_visit) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET
          title = excluded.title, favicon = excluded.favicon,
          visits = history.visits + 1,
          typed_visits = history.typed_visits + excluded.typed_visits,
          last_visit = excluded.last_visit
      `
        )
        .run(
          address,
          title.slice(0, 512),
          favicon ? (webUrl(favicon) ?? null) : null,
          Number(typed),
          Date.now()
        )
      this.prune()
    }, undefined)
  }

  metadata(url: string, title: string, favicon?: string): void {
    const address = webUrl(url)
    if (!address) return
    this.attempt(() => {
      this.database
        .prepare('UPDATE history SET title = ?, favicon = ? WHERE url = ?')
        .run(title.slice(0, 512), favicon ? (webUrl(favicon) ?? null) : null, address)
    }, undefined)
  }

  select(query: string, url: string): void {
    query = query.trim().toLowerCase()
    const address = webUrl(url)
    if (!query || query.length > 256 || !address) return
    if (/^https?:\/\//i.test(query) && !webUrl(query)) return
    this.attempt(() => {
      this.database
        .prepare(
          `
        INSERT INTO choices(query, url, last_used)
        SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM history WHERE url = ?)
        ON CONFLICT(query, url) DO UPDATE SET uses = choices.uses + 1, last_used = excluded.last_used
      `
        )
        .run(query, address, Date.now(), address)
    }, undefined)
  }

  history(query: string): HistoryEntry[] {
    return this.attempt(
      () =>
        this.database
          .prepare(
            `
      SELECT h.url, h.title, h.favicon, h.visits, h.typed_visits AS typedVisits,
        h.last_visit AS lastVisit, COALESCE(SUM(c.uses), 0) AS selections,
        COALESCE(MAX(CASE WHEN c.query = ? THEN c.uses ELSE 0 END), 0) AS queryUses
      FROM history h LEFT JOIN choices c ON c.url = h.url
      WHERE h.last_visit >= ?
      GROUP BY h.url ORDER BY h.last_visit DESC LIMIT 5000
    `
          )
          .all(query.trim().toLowerCase(), Date.now() - 90 * 86400000) as unknown as HistoryEntry[],
      []
    )
  }

  cached(provider: SearchProvider, query: string): SearchResult[] | undefined {
    return this.attempt(() => {
      const key = query.trim().toLowerCase()
      const row = this.database
        .prepare('SELECT payload, expires_at FROM provider_cache WHERE provider = ? AND query = ?')
        .get(provider, key)
      if (!row) return undefined
      let results: SearchResult[] | undefined
      if (
        typeof row.payload === 'string' &&
        row.payload.length <= 131072 &&
        typeof row.expires_at === 'number' &&
        row.expires_at > Date.now()
      ) {
        try {
          results = providerResults(JSON.parse(row.payload), provider)
        } catch {
          results = undefined
        }
      }
      if (!results) {
        this.database
          .prepare('DELETE FROM provider_cache WHERE provider = ? AND query = ?')
          .run(provider, key)
        return undefined
      }
      this.database
        .prepare('UPDATE provider_cache SET accessed_at = ? WHERE provider = ? AND query = ?')
        .run(Date.now(), provider, key)
      return results
    }, undefined)
  }

  cache(provider: SearchProvider, query: string, incoming: SearchResult[]): void {
    const results = providerResults(incoming, provider)
    if (!results || query.length > 256) return
    const payload = JSON.stringify(results)
    if (payload.length > 131072) return
    this.attempt(() => {
      const now = Date.now()
      this.database
        .prepare(
          `
        INSERT INTO provider_cache(provider, query, payload, expires_at, accessed_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(provider, query) DO UPDATE SET payload = excluded.payload,
          expires_at = excluded.expires_at, accessed_at = excluded.accessed_at
      `
        )
        .run(provider, query.trim().toLowerCase(), payload, now + 300000, now)
      this.database.prepare('DELETE FROM provider_cache WHERE expires_at <= ?').run(now)
      this.database.exec(
        'DELETE FROM provider_cache WHERE rowid IN (SELECT rowid FROM provider_cache ORDER BY accessed_at DESC LIMIT -1 OFFSET 100)'
      )
    }, undefined)
  }

  clear(): boolean {
    return this.attempt(() => {
      this.database.exec('BEGIN IMMEDIATE')
      try {
        this.database.exec(
          'DELETE FROM choices; DELETE FROM history; DELETE FROM provider_cache; COMMIT;'
        )
      } catch (error) {
        this.database.exec('ROLLBACK')
        throw error
      }
      this.database.exec('PRAGMA wal_checkpoint(TRUNCATE)')
      this.warning = undefined
      this.generation += 1
      this.emit('cleared')
      return true
    }, false)
  }

  close(): void {
    this.database.close()
  }
}
