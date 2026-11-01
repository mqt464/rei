import { WebContentsView } from 'electron'
import type { SearchResult } from '../shared/search'

function isGoogleUrl(url: URL): boolean {
  return url.hostname === 'google.com' || url.hostname.endsWith('.google.com')
}

function createSearchView(): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      partition: 'rei-search',
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false
    }
  })
  view.setBounds({ x: 0, y: 0, width: 1280, height: 900 })
  view.webContents.setAudioMuted(true)
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  view.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false)
  )
  return view
}

function resolveGoogleLink(url: URL, signal: AbortSignal): Promise<URL | null> {
  if (signal.aborted) return Promise.resolve(null)
  return new Promise((resolve) => {
    const view = createSearchView()
    const contents = view.webContents
    let settled = false
    function finish(destination: URL | null): void {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      resolve(destination)
      setImmediate(() => {
        if (!contents.isDestroyed()) contents.close()
      })
    }
    const onAbort = (): void => finish(null)
    signal.addEventListener('abort', onAbort, { once: true })
    const onNavigate = (event: Electron.Event, destination: string): void => {
      try {
        const target = new URL(destination)
        if (['https:', 'http:'].includes(target.protocol) && isGoogleUrl(target)) return
        event.preventDefault()
        finish(
          ['https:', 'http:'].includes(target.protocol) &&
            !isGoogleUrl(target) &&
            target.href.length <= 8192
            ? target
            : null
        )
      } catch {
        event.preventDefault()
        finish(null)
      }
    }
    contents.on('will-navigate', onNavigate)
    contents.on('will-redirect', onNavigate)
    contents.loadURL(url.href).catch(() => {
      if (!settled && !contents.isDestroyed() && !contents.isLoading()) finish(null)
    })
  })
}

export async function getWebsites(query: string, signal: AbortSignal): Promise<SearchResult[]> {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(10000)])
  requestSignal.throwIfAborted()
  const view = createSearchView()
  const contents = view.webContents
  let onAbort: () => void = () => {}
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error('Website search cancelled or timed out.'))
    requestSignal.addEventListener('abort', onAbort, { once: true })
  })

  try {
    const loaded = new Promise<void>((resolve) => contents.once('did-finish-load', () => resolve()))
    await Promise.race([
      contents
        .loadURL(`https://www.google.com/search?q=${encodeURIComponent(query)}&num=6`)
        .catch((error: unknown) => {
          if (error && typeof error === 'object' && 'errno' in error && error.errno === -3)
            return loaded
          throw error
        }),
      aborted
    ])
    const data: unknown = await Promise.race([
      contents.executeJavaScript(`
        Array.from(document.querySelectorAll('h3')).flatMap(heading => {
          const link = heading.closest('a');
          if (!link || !heading.textContent.trim()) return [];
          try {
            let url = new URL(link.href, location.href);
            if ((url.hostname === 'google.com' || url.hostname.endsWith('.google.com')) && url.pathname === '/url') {
              const target = url.searchParams.get('q') || url.searchParams.get('url');
              if (target && /^https?:/.test(target)) url = new URL(target);
            }
            if (!['https:', 'http:'].includes(url.protocol)) return [];
            if ((url.hostname === 'google.com' || url.hostname.endsWith('.google.com')) && !['/goto', '/url'].includes(url.pathname)) return [];
            const container = heading.closest('.MjjYud') || link.parentElement?.parentElement?.parentElement;
            const description = container?.querySelector('.VwiC3b, [data-sncf]')?.textContent?.trim().slice(0, 240);
            const image = container?.querySelector('img')?.src;
            const favicon = image && image.length < 32768 && (/^data:image\\/(png|jpeg|webp|gif|x-icon);base64,/i.test(image) || /^https:\\/\\/[^/]*\\.(gstatic|google)\\.com\\//i.test(image)) ? image : undefined;
            return [{ title: heading.textContent.trim().slice(0, 512), url: url.href, description, favicon }];
          } catch { return []; }
        }).slice(0, 6)
      `),
      aborted
    ])
    requestSignal.throwIfAborted()
    if (!Array.isArray(data)) throw new Error('Invalid website results.')
    const destinations = await Promise.all(
      data.map(
        async (
          result
        ): Promise<{
          title: string
          url: string
          description?: string
          favicon?: string
        } | null> => {
          if (!result || typeof result.title !== 'string' || typeof result.url !== 'string')
            return null
          if (!result.title || result.url.length > 8192) return null
          try {
            let url = new URL(result.url)
            if (!['https:', 'http:'].includes(url.protocol)) return null
            if (isGoogleUrl(url)) {
              if (!['/goto', '/url'].includes(url.pathname)) return null
              const destination = await resolveGoogleLink(url, requestSignal)
              if (!destination) return null
              url = destination
            }
            return {
              title: result.title.slice(0, 512),
              url: url.href,
              description:
                typeof result.description === 'string'
                  ? result.description.slice(0, 240)
                  : undefined,
              favicon: typeof result.favicon === 'string' ? result.favicon : undefined
            }
          } catch {
            return null
          }
        }
      )
    )
    signal.throwIfAborted()
    const results = new Map<string, SearchResult>()
    for (const result of destinations) {
      if (!result || results.has(result.url)) continue
      results.set(result.url, { id: `website:${result.url}`, kind: 'website', ...result })
      if (results.size === 6) break
    }
    if (!results.size) throw new Error('Google did not return readable website results.')
    return [...results.values()]
  } finally {
    requestSignal.removeEventListener('abort', onAbort)
    if (!contents.isDestroyed()) contents.close()
  }
}
