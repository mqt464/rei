import { session } from 'electron'

const cache = new Map<string, { expires: number; image: Promise<string | null> }>()

export async function getFavicon(source: string): Promise<string | null> {
  let url: URL
  try {
    url = new URL(source)
  } catch {
    return null
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    source.length > 8192
  )
    return null
  const cached = cache.get(url.href)
  if (cached && cached.expires > Date.now()) return cached.image
  const image = (async (): Promise<string | null> => {
    try {
      const response = await session.fromPartition('rei-icons').fetch(url.href, {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(3000)
      })
      if (!response.ok || !response.body) {
        await response.body?.cancel()
        return null
      }
      const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
      if (!mime || !/^image\/[a-z0-9.+-]+$/.test(mime)) {
        await response.body.cancel()
        return null
      }
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 262144) {
          await reader.cancel()
          return null
        }
        chunks.push(value)
      }
      return size ? `data:${mime};base64,${Buffer.concat(chunks).toString('base64')}` : null
    } catch {
      return null
    }
  })()
  cache.delete(url.href)
  const entry = { expires: Date.now() + 300000, image }
  cache.set(url.href, entry)
  if (cache.size > 256) cache.delete(cache.keys().next().value!)
  if (!(await image)) entry.expires = Date.now() + 30000
  return image
}
