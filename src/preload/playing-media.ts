import { ipcRenderer } from 'electron'

const identities = new WeakMap<
  HTMLMediaElement,
  { id: string; playedAt: number; snapshot?: { title: string; url: string; sourceUrl: string } }
>()
const twitterSources = new Map<string, string>()
let sequence = 0
let lastUpdate = 0

function rememberTwitterSource(name: string): void {
  try {
    const url = new URL(name)
    const match = /^\/(?:ext_tw_video|amplify_video)\/(\d+)\/.*\.(m3u8|mp4)$/.exec(url.pathname)
    if (url.protocol !== 'https:' || url.hostname !== 'video.twimg.com' || !match) return
    const previous = twitterSources.get(match[1])
    if (previous && new URL(previous).pathname.endsWith('.m3u8') && match[2] !== 'm3u8') return
    twitterSources.set(match[1], url.href)
    if (twitterSources.size > 64) twitterSources.delete(twitterSources.keys().next().value!)
  } catch {
    return
  }
}

function twitterSource(media: HTMLMediaElement): string | undefined {
  if (!(media instanceof HTMLVideoElement)) return undefined
  const identity = /\/(?:ext_tw_video_thumb|amplify_video_thumb)\/(\d+)\//.exec(media.poster)?.[1]
  if (!identity) return undefined
  for (const entry of performance.getEntriesByType('resource')) rememberTwitterSource(entry.name)
  return twitterSources.get(identity)
}

if (typeof PerformanceObserver !== 'undefined') {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) rememberTwitterSource(entry.name)
  }).observe({ type: 'resource', buffered: true })
}

function capture(event: Event): void {
  const media = event.target
  if (!(media instanceof HTMLMediaElement)) return
  if (event.type === 'loadedmetadata' && media.paused) return
  if (event.type === 'timeupdate' && Date.now() - lastUpdate < 1000) return
  let identity = identities.get(media)
  if (!identity) {
    if (event.type !== 'play' && media.paused) return
    identity = { id: String(++sequence), playedAt: Date.now() }
    identities.set(media, identity)
  }
  if ((media.paused || media.ended) && identity.snapshot) {
    ipcRenderer.send('commands:playing-media', {
      id: identity.id,
      playedAt: identity.playedAt,
      ...identity.snapshot,
      playing: false
    })
    return
  }
  if (event.type === 'play') identity.playedAt = Date.now()
  lastUpdate = Date.now()
  let pageUrl = location.href
  const host = location.hostname.replace(/^www\./, '')
  if (
    ['x.com', 'twitter.com', 'tiktok.com'].some(
      (site) => host === site || host.endsWith(`.${site}`)
    )
  ) {
    let container: Element | null = media.parentElement
    for (let depth = 0; container && depth < 8; depth++, container = container.parentElement) {
      if (container.querySelectorAll('video, audio').length > 1) break
      const link = [...container.querySelectorAll<HTMLAnchorElement>('a[href]')].find((anchor) => {
        try {
          const url = new URL(anchor.href)
          return url.origin === location.origin && /\/(?:status|video)\/\d+/.test(url.pathname)
        } catch {
          return false
        }
      })
      if (link) {
        pageUrl = link.href
        break
      }
      if (container.tagName === 'ARTICLE') break
    }
  }
  identity.snapshot = {
    title: document.title.slice(0, 512),
    url: pageUrl.slice(0, 8192),
    sourceUrl: (
      ((host === 'x.com' ||
        host === 'twitter.com' ||
        host.endsWith('.x.com') ||
        host.endsWith('.twitter.com')) &&
        twitterSource(media)) ||
      media.currentSrc ||
      media.src
    ).slice(0, 8192)
  }
  ipcRenderer.send('commands:playing-media', {
    id: identity.id,
    playedAt: identity.playedAt,
    ...identity.snapshot,
    playing: !media.paused && !media.ended
  })
}

for (const event of ['play', 'playing', 'pause', 'ended', 'timeupdate', 'loadedmetadata'])
  window.addEventListener(event, capture, true)
