const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const ts = require('typescript')

function load(file, globals) {
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const context = vm.createContext({ exports: {}, URL, console, ...globals })
  vm.runInContext(source, context)
  return context
}

const listeners = new Map()
const sent = []
const videoId = '2078937645648896000'
const playlist = `https://video.twimg.com/ext_tw_video/${videoId}/pu/pl/video.m3u8?tag=12`
const resources = [
  { name: 'https://video.twimg.com/ext_tw_video/999/pu/pl/unrelated.m3u8' },
  { name: playlist }
]
class Media {
  constructor() {
    this.paused = false
    this.ended = false
    this.currentSrc = 'blob:https://x.com/playing'
    this.src = this.currentSrc
    this.poster = `https://pbs.twimg.com/ext_tw_video_thumb/${videoId}/pu/img/frame.jpg`
    this.parentElement = {
      parentElement: null,
      tagName: 'ARTICLE',
      querySelectorAll: (selector) =>
        selector === 'video, audio'
          ? [this]
          : [{ href: 'https://x.com/person/status/2078937645648896420' }]
    }
  }
  closest() {
    return this.parentElement
  }
}
load('src/preload/playing-media.ts', {
  require: () => ({ ipcRenderer: { send: (_channel, value) => sent.push(value) } }),
  HTMLMediaElement: Media,
  HTMLVideoElement: Media,
  location: { href: 'https://x.com/home', hostname: 'x.com', origin: 'https://x.com' },
  document: { title: 'X feed' },
  performance: { getEntriesByType: () => resources },
  window: { addEventListener: (event, callback) => listeners.set(event, callback) }
})
const media = new Media()
listeners.get('play')({ type: 'play', target: media })
assert.equal(
  sent.at(-1).sourceUrl,
  playlist,
  'X blob playback resolves only its matching CDN playlist'
)
media.paused = true
media.currentSrc = ''
media.src = ''
listeners.get('pause')({ type: 'pause', target: media })
assert.equal(sent.at(-1).sourceUrl, playlist, 'paused playback retains its last media source')

const api = load('src/main/playing-media.ts', { require }).exports
const soundcloudTrack = 'https://soundcloud.com/artist/track?secret_token=s-secret'
for (const sourceUrl of ['blob:https://soundcloud.com/playing', '', 'https://cdn.example/stream']) {
  assert.equal(api.mediaDownloadUrl({ url: soundcloudTrack, sourceUrl }), soundcloudTrack)
}
assert.equal(
  api.mediaDownloadUrl({
    url: 'https://m.soundcloud.com/artist/track/s-secret',
    sourceUrl: 'blob:playing'
  }),
  'https://m.soundcloud.com/artist/track/s-secret'
)
for (const url of [
  'https://soundcloud.com/discover',
  'https://soundcloud.com/you/likes',
  'https://soundcloud.com/artist/tracks',
  'https://soundcloud.com/artist/sets',
  'https://soundcloud.com/stations/track',
  'https://soundcloud.com/artist/sets/playlist',
  'https://soundcloud.com.evil.example/artist/track'
]) {
  assert.throws(
    () => api.mediaDownloadUrl({ url, sourceUrl: 'blob:playing' }),
    /Could not identify/
  )
}
assert.equal(
  api.mediaDownloadUrl({
    url: 'https://example.com/audio',
    sourceUrl: 'https://cdn.example/audio.mp3'
  }),
  'https://cdn.example/audio.mp3',
  'generic direct audio downloads still work'
)
assert.equal(
  api.mediaDownloadUrl(sent.at(-1)),
  playlist,
  'X download uses detected media rather than a post without video'
)
const contents = new EventEmitter()
const soundcloudListeners = new Map()
const soundcloudLocation = {
  href: 'https://soundcloud.com/discover',
  hostname: 'soundcloud.com',
  origin: 'https://soundcloud.com'
}
let playerLink = soundcloudTrack
load('src/preload/playing-media.ts', {
  require: () => ({ ipcRenderer: { send: (_channel, value) => sent.push(value) } }),
  HTMLMediaElement: Media,
  HTMLVideoElement: Media,
  location: soundcloudLocation,
  document: { title: 'SoundCloud', querySelector: () => playerLink && { href: playerLink } },
  window: { addEventListener: (event, callback) => soundcloudListeners.set(event, callback) }
})
const audio = new Media()
audio.currentSrc = 'blob:https://soundcloud.com/playing'
soundcloudListeners.get('play')({ type: 'play', target: audio })
assert.equal(
  sent.at(-1).url,
  soundcloudTrack,
  'SoundCloud feed playback identifies the active track'
)
playerLink = 'https://evil.example/artist/track'
soundcloudListeners.get('play')({ type: 'play', target: audio })
assert.equal(sent.at(-1).url, soundcloudLocation.href, 'cross-origin player links are ignored')
playerLink = ''
soundcloudLocation.href = soundcloudTrack
soundcloudListeners.get('play')({ type: 'play', target: audio })
assert.equal(sent.at(-1).url, soundcloudTrack, 'track pages work without a persistent player link')
audio.paused = true
playerLink = 'https://soundcloud.com/other/track'
soundcloudListeners.get('pause')({ type: 'pause', target: audio })
assert.equal(sent.at(-1).url, soundcloudTrack, 'paused playback retains the track')
contents.ipc = new EventEmitter()
contents.mainFrame = { framesInSubtree: [{ frameTreeNodeId: 1 }] }
api.registerPlayingMedia(contents)
const event = { senderFrame: { detached: false, url: 'https://x.com/home', frameTreeNodeId: 1 } }
const report = (id, playing, playedAt) =>
  contents.ipc.emit('commands:playing-media', event, {
    id,
    playing,
    playedAt,
    url: 'https://x.com/home',
    sourceUrl: `https://example.com/${id}.mp4`,
    title: id
  })
report('playing', true, 100)
report('paused', false, 200)
assert.equal(
  api.currentPlayingMedia(contents).title,
  'playing',
  'playing media wins over a newer paused item'
)
report('playing', false, 100)
assert.equal(
  api.currentPlayingMedia(contents).title,
  'paused',
  'when nothing plays, use the most recently played media'
)
console.log(
  'PASS: SoundCloud track routing, X media source matching, paused retention, playing priority'
)

async function checkDownloadFormats() {
  for (const ffmpeg of [false, true]) {
    const spawned = []
    const queued = []
    const app = new EventEmitter()
    app.getPath = () => path.resolve('mock-downloads')
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.stdout.setEncoding = () => child.stdout
    child.stderr.setEncoding = () => child.stderr
    const downloader = load('src/main/media-downloads.ts', {
      process,
      AbortController,
      require: (name) => {
        if (name === 'electron') return { app }
        if (name === 'node:fs')
          return {
            existsSync: (filename) => path.basename(filename).startsWith('yt-dlp') || ffmpeg
          }
        if (name === 'node:fs/promises') return { mkdir: async () => {} }
        if (name === 'node:child_process')
          return {
            spawn: (_engine, args) => {
              spawned.push(args)
              return child
            }
          }
        if (name === './preferences') return { currentPreferences: () => ({}) }
        if (name === './downloads')
          return {
            queuedDownload: (record) => queued.push(record),
            updateQueuedDownload: (record) => assert.ok(queued.includes(record))
          }
        if (name === './playing-media') return api
        return require(name)
      }
    }).exports
    downloader.enqueueMediaDownload({
      id: 'audio',
      title: 'SoundCloud audio',
      url: soundcloudTrack,
      sourceUrl: 'blob:playing'
    })
    await new Promise(setImmediate)
    assert.equal(spawned.length, 1, 'SoundCloud blob playback reaches the download engine')
    const args = spawned[0]
    assert.equal(args.at(-1), soundcloudTrack)
    assert.equal(args[args.indexOf('--format') + 1], ffmpeg ? 'bv*+ba/b/ba' : 'b/ba')
    child.emit('close', 1)
    assert.equal(queued[0].status, 'interrupted', 'engine errors still reach the download queue')
  }
  console.log('PASS: audio-only format fallback with and without FFmpeg')
}
checkDownloadFormats().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
