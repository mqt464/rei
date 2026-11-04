import type { PlayingMedia } from './commands'

export type DownloadStatus = 'progressing' | 'paused' | 'interrupted' | 'completed' | 'cancelled'
export type DownloadAction = 'pause' | 'resume' | 'cancel' | 'retry' | 'open' | 'reveal' | 'remove'

export interface DownloadRecord {
  id: string
  filename: string
  url: string
  path: string
  received: number
  total: number
  speed: number
  started: number
  status: DownloadStatus
  active: boolean
  canResume: boolean
  media?: PlayingMedia
  stage?: 'preparing' | 'downloading' | 'processing'
  error?: string
  canPause?: boolean
  private?: boolean
}

export function downloadBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index++
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[index]}`
}

export function downloadRemaining(record: DownloadRecord): string {
  if (record.status !== 'progressing' || record.speed <= 0 || record.total <= record.received)
    return ''
  const seconds = Math.ceil((record.total - record.received) / record.speed)
  if (seconds < 60) return `${seconds}s left`
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m left`
  return `${Math.ceil(seconds / 3600)}h left`
}
