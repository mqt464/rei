import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type { PlayingMedia } from '../shared/commands'

type MediaState = PlayingMedia & { frameId: number; playing: boolean; playedAt: number }
const mediaByTab = new WeakMap<WebContents, Map<string, MediaState>>()

export function registerPlayingMedia(contents: WebContents): void {
  const records = new Map<string, MediaState>()
  mediaByTab.set(contents, records)
  contents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) records.clear()
  })
  contents.ipc.on('commands:playing-media', (event, value: unknown) => {
    const frame = event.senderFrame
    if (!frame || frame.detached || !/^https?:\/\//i.test(frame.url)) return
    if (!value || typeof value !== 'object') return
    const entry = value as Record<string, unknown>
    if (
      typeof entry.id !== 'string' ||
      entry.id.length > 40 ||
      typeof entry.url !== 'string' ||
      entry.url.length > 8192 ||
      typeof entry.sourceUrl !== 'string' ||
      entry.sourceUrl.length > 8192 ||
      typeof entry.title !== 'string' ||
      entry.title.length > 512 ||
      typeof entry.playedAt !== 'number' ||
      !Number.isFinite(entry.playedAt) ||
      typeof entry.playing !== 'boolean'
    )
      return
    try {
      const url = new URL(entry.url)
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.origin !== new URL(frame.url).origin ||
        url.username ||
        url.password
      )
        return
      const key = `${frame.frameTreeNodeId}:${entry.id}`
      const previous = records.get(key)
      records.set(key, {
        id: previous?.id ?? randomUUID(),
        title: entry.title,
        url: url.href,
        sourceUrl: entry.sourceUrl,
        frameId: frame.frameTreeNodeId,
        playing: entry.playing,
        playedAt: Math.max(0, Math.min(Date.now(), entry.playedAt))
      })
      if (records.size > 32) records.delete(records.keys().next().value!)
    } catch {
      return
    }
  })
}

export function currentPlayingMedia(contents: WebContents): PlayingMedia | undefined {
  const frames = new Set(contents.mainFrame.framesInSubtree.map((frame) => frame.frameTreeNodeId))
  const records = [...(mediaByTab.get(contents)?.values() ?? [])].filter((media) =>
    frames.has(media.frameId)
  )
  const selected = records.sort(
    (first, second) =>
      Number(second.playing) - Number(first.playing) || second.playedAt - first.playedAt
  )[0]
  if (!selected) return undefined
  return {
    id: selected.id,
    title: selected.title,
    url: selected.url,
    sourceUrl: selected.sourceUrl
  }
}

export function mediaDownloadUrl(media: PlayingMedia): string {
  const page = new URL(media.url)
  if (!['http:', 'https:'].includes(page.protocol) || page.username || page.password)
    throw new Error('Only public HTTP(S) media addresses can be downloaded.')
  const host = page.hostname.replace(/^www\./, '')
  if (
    (host === 'soundcloud.com' || host === 'm.soundcloud.com') &&
    /^\/[\w-]+\/[\w-]+(?:\/s-[\w-]+)?\/?$/.test(page.pathname) &&
    !/^\/[\w-]+\/(?:tracks|albums|sets|reposts|likes|spotlight|comments)(?:\/|$)/.test(
      page.pathname
    ) &&
    page.pathname.replace(/\/$/, '') !== '/stations/track'
  )
    return page.origin + page.pathname + page.search
  if (
    host === 'x.com' ||
    host === 'twitter.com' ||
    host.endsWith('.x.com') ||
    host.endsWith('.twitter.com')
  ) {
    if (URL.canParse(media.sourceUrl)) {
      const source = new URL(media.sourceUrl)
      if (
        source.protocol === 'https:' &&
        source.hostname === 'video.twimg.com' &&
        !source.username &&
        !source.password &&
        /\.(m3u8|mp4)$/.test(source.pathname)
      )
        return source.href
    }
  }
  if (host === 'youtu.be')
    return `https://www.youtube.com/watch?v=${encodeURIComponent(page.pathname.slice(1).split('/')[0])}`
  if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtube-nocookie.com') {
    const video =
      page.searchParams.get('v') ?? /^\/(?:shorts|embed|live)\/([^/]+)/.exec(page.pathname)?.[1]
    if (video) return `https://www.youtube.com/watch?v=${encodeURIComponent(video)}`
  }
  if (
    (host === 'x.com' ||
      host === 'twitter.com' ||
      host.endsWith('.x.com') ||
      host.endsWith('.twitter.com')) &&
    /\/status\/\d+/.test(page.pathname)
  )
    return `${page.origin}${page.pathname}`
  if ((host === 'tiktok.com' || host.endsWith('.tiktok.com')) && /\/video\/\d+/.test(page.pathname))
    return `${page.origin}${page.pathname}`
  try {
    const source = new URL(media.sourceUrl)
    if (['http:', 'https:'].includes(source.protocol) && !source.username && !source.password)
      return source.href
  } catch {
    return unavailableMedia()
  }
  return unavailableMedia()
}

function unavailableMedia(): never {
  throw new Error(
    'Could not identify this media’s direct link. Open its individual video or audio page and try again.'
  )
}
