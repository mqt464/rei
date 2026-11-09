export interface UpdateState {
  currentVersion: string
  status:
    | 'unsupported'
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'ready'
    | 'current'
    | 'error'
  version: string
  progress: number
  message: string
}
