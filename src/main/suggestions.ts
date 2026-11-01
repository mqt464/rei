import { net } from 'electron'
import { resolveAddress } from '../shared/navigation'

export async function getSuggestions(query: string, signal: AbortSignal): Promise<string[]> {
  query = query.trim()
  if (query.length < 2 || query.length > 256) return []

  try {
    if (!resolveAddress(query)?.startsWith('https://www.google.com/search?q=')) return []

    const response = await net.fetch(
      `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}`,
      {
        signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]),
        credentials: 'omit',
        redirect: 'error'
      }
    )
    if (!response.ok) return []
    const data: unknown = await response.json()
    if (signal.aborted || !Array.isArray(data) || !Array.isArray(data[1])) return []

    return [
      ...new Set<string>(
        data[1].filter(
          (value): value is string =>
            typeof value === 'string' &&
            value.trim().length > 0 &&
            value.length <= 256 &&
            value !== query
        )
      )
    ].slice(0, 6)
  } catch {
    return []
  }
}
