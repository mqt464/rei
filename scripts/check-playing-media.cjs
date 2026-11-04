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
assert.equal(
  api.mediaDownloadUrl(sent.at(-1)),
  playlist,
  'X download uses detected media rather than a post without video'
)
const contents = new EventEmitter()
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
  'PASS: X media source matching, paused source retention, playing priority, last-played fallback'
)
