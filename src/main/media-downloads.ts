import { app } from 'electron'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises'
import { basename, delimiter, isAbsolute, join, relative } from 'node:path'
import type { PlayingMedia } from '../shared/commands'
import type { DownloadRecord } from '../shared/downloads'
import { currentPreferences } from './preferences'
import { queuedDownload, updateQueuedDownload } from './downloads'
import { mediaDownloadUrl } from './playing-media'

const active = new Map<string, DownloadRecord>()
const cancels = new Set<() => void>()
let installation: Promise<string> | undefined
const installationAbort = new AbortController()

app.once('will-quit', () => {
  installationAbort.abort()
  for (const cancel of cancels) cancel()
})

function executable(name: string): string | undefined {
  const filename = process.platform === 'win32' ? `${name}.exe` : name
  const directories = [
    join(app.getPath('userData'), 'command-tools'),
    ...(process.env.PATH ?? '').split(delimiter)
  ]
  return directories.map((directory) => join(directory, filename)).find((path) => existsSync(path))
}

async function downloadEngine(): Promise<string> {
  const installed = executable('yt-dlp')
  if (installed) return installed
  installation ??= installEngine().catch((failure) => {
    installation = undefined
    throw failure
  })
  return installation
}

async function installEngine(): Promise<string> {
  const assetName =
    process.platform === 'win32'
      ? process.arch === 'arm64'
        ? 'yt-dlp_arm64.exe'
        : 'yt-dlp.exe'
      : process.platform === 'darwin'
        ? 'yt-dlp_macos'
        : process.platform === 'linux'
          ? process.arch === 'arm64'
            ? 'yt-dlp_linux_aarch64'
            : 'yt-dlp_linux'
          : ''
  if (!assetName) throw new Error('Install yt-dlp on PATH for this platform.')
  const signal = AbortSignal.any([installationAbort.signal, AbortSignal.timeout(180000)])
  const headers = { 'User-Agent': 'Rei-media-downloader', Accept: 'application/vnd.github+json' }
  const releaseResponse = await fetch(
    'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest',
    { headers, signal }
  )
  if (!releaseResponse.ok)
    throw new Error('Could not fetch yt-dlp. Check your connection and retry.')
  const release = (await releaseResponse.json()) as {
    assets?: { name: string; digest: string; browser_download_url: string; size: number }[]
  }
  const asset = release.assets?.find((entry) => entry.name === assetName)
  if (
    !asset ||
    !/^sha256:[a-f0-9]{64}$/.test(asset.digest) ||
    !asset.browser_download_url.startsWith('https://github.com/yt-dlp/yt-dlp/releases/download/') ||
    !Number.isFinite(asset.size) ||
    asset.size <= 0 ||
    asset.size > 200 * 1024 * 1024
  )
    throw new Error('Could not verify the official yt-dlp release. Install yt-dlp on PATH instead.')
  const response = await fetch(asset.browser_download_url, { signal })
  if (!response.ok || !response.body)
    throw new Error('Could not download yt-dlp. Check your connection and retry.')
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > asset.size) throw new Error('yt-dlp download exceeded its declared size.')
    chunks.push(chunk)
  }
  const binary = Buffer.concat(chunks)
  if (
    size !== asset.size ||
    `sha256:${createHash('sha256').update(binary).digest('hex')}` !== asset.digest
  )
    throw new Error('yt-dlp verification failed. Nothing was installed.')
  const directory = join(app.getPath('userData'), 'command-tools')
  await mkdir(directory, { recursive: true })
  const target = join(directory, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
  await writeFile(`${target}.tmp`, binary, { mode: 0o700 })
  await chmod(`${target}.tmp`, 0o700)
  await rename(`${target}.tmp`, target)
  return target
}

export function enqueueMediaDownload(media: PlayingMedia, privateDownload = false): string {
  const duplicate = [...active.values()].find(
    (record) =>
      record.private === privateDownload &&
      record.media?.url === media.url &&
      record.media?.sourceUrl === media.sourceUrl
  )
  if (duplicate) return duplicate.id
  const record: DownloadRecord = {
    id: randomUUID(),
    filename: media.title || 'Media download',
    url: media.url,
    path: '',
    received: 0,
    total: 0,
    speed: 0,
    started: Date.now(),
    status: 'progressing',
    stage: 'preparing',
    active: true,
    canResume: false,
    canPause: false,
    media: { ...media },
    private: privateDownload
  }
  start(record)
  return record.id
}

export function retryMediaDownload(record: DownloadRecord): void {
  if (
    !record.media ||
    typeof record.media.url !== 'string' ||
    typeof record.media.sourceUrl !== 'string' ||
    typeof record.media.title !== 'string'
  )
    throw new Error('Original media is unavailable. Run /download from its page again.')
  Object.assign(record, {
    status: 'progressing',
    stage: 'preparing',
    active: true,
    canResume: false,
    canPause: false,
    received: 0,
    total: 0,
    speed: 0,
    error: undefined,
    started: Date.now()
  })
  start(record)
}

function start(record: DownloadRecord): void {
  let process: ChildProcess | undefined
  let cancelled = false
  const cancel = (): void => {
    if (!record.active) return
    cancelled = true
    if (process?.pid) {
      if (globalThis.process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/PID', String(process.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore'
        })
        killer.on('error', () => process?.kill())
      } else process.kill('SIGTERM')
    }
    finish('cancelled')
  }
  const finish = (status: DownloadRecord['status'], error?: string): void => {
    if (!record.active) return
    record.status = status
    record.error = error
    record.active = false
    record.speed = 0
    active.delete(record.id)
    cancels.delete(cancel)
    updateQueuedDownload(record)
  }
  active.set(record.id, record)
  cancels.add(cancel)
  queuedDownload(record, cancel)
  void (async () => {
    const target = mediaDownloadUrl(record.media!)
    const engine = await downloadEngine()
    if (cancelled) return
    const directory = currentPreferences().downloadDirectory || app.getPath('downloads')
    await mkdir(directory, { recursive: true })
    if (cancelled) return
    const ffmpeg = executable('ffmpeg')
    const args = [
      '--ignore-config',
      '--no-plugin-dirs',
      '--no-playlist',
      '--no-warnings',
      '--newline',
      '--progress',
      '--no-simulate',
      '--no-cache-dir',
      '--no-overwrites',
      '--windows-filenames',
      '--progress-template',
      'download:rei-progress:%(progress)j',
      '--print',
      'after_move:rei-file:%(filepath)j',
      '--output',
      join(directory, '%(title).150B [%(id)s].%(ext)s'),
      '--format',
      ffmpeg ? 'bv*+ba/b/ba' : 'b/ba',
      '--no-js-runtimes',
      '--js-runtimes',
      `node:${globalThis.process.execPath}`,
      ...(ffmpeg ? ['--ffmpeg-location', ffmpeg] : []),
      '--',
      target
    ]
    process = spawn(engine, args, {
      windowsHide: true,
      env: { ...globalThis.process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const buffers = { stdout: '', stderr: '' }
    let failure = ''
    let output = ''
    const line = (text: string): void => {
      if (!record.active) return
      try {
        if (text.startsWith('rei-progress:')) {
          const progress = JSON.parse(text.slice('rei-progress:'.length))
          record.stage = progress.status === 'finished' ? 'processing' : 'downloading'
          const values = {
            received: progress.downloaded_bytes,
            total: progress.total_bytes ?? progress.total_bytes_estimate,
            speed: progress.speed
          }
          for (const field of ['received', 'total', 'speed'] as const) {
            const value = values[field]
            if (typeof value === 'number' && Number.isFinite(value) && value >= 0)
              record[field] = value
          }
          updateQueuedDownload(record)
        } else if (text.startsWith('rei-file:')) {
          const path = JSON.parse(text.slice('rei-file:'.length))
          if (typeof path !== 'string' || !isAbsolute(path)) return
          const local = relative(directory, path)
          if (
            isAbsolute(local) ||
            local === '..' ||
            local.startsWith('../') ||
            local.startsWith('..\\')
          )
            return
          output = path
          record.path = path
          record.filename = basename(path)
        }
      } catch {
        return
      }
    }
    const receive = (stream: 'stdout' | 'stderr', chunk: string): void => {
      buffers[stream] += chunk
      const lines = buffers[stream].split(/\r?\n/)
      buffers[stream] = lines.pop()!.slice(-65536)
      for (const text of lines) {
        if (text.startsWith('rei-progress:') || text.startsWith('rei-file:')) line(text)
        else if (stream === 'stderr') failure = (failure + text + '\n').slice(-4000)
      }
    }
    process.stdout?.setEncoding('utf8').on('data', (chunk: string) => receive('stdout', chunk))
    process.stderr?.setEncoding('utf8').on('data', (chunk: string) => receive('stderr', chunk))
    process.on('error', (error) => finish('interrupted', error.message))
    process.on('close', (code) => {
      receive('stdout', '\n')
      receive('stderr', '\n')
      if (cancelled || !record.active) return
      if (code === 0 && output && existsSync(output)) finish('completed')
      else
        finish(
          'interrupted',
          failure.trim() ||
            'Media could not be downloaded. The site may require sign-in or may not be supported.'
        )
    })
  })().catch((failure) => {
    if (!cancelled)
      finish('interrupted', failure instanceof Error ? failure.message : 'Media download failed.')
  })
}
