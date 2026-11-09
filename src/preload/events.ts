import { ipcRenderer } from 'electron'

export function subscribeValue<Value>(
  channel: string,
  callback: (value: Value) => void
): () => void {
  const listener = (_event: Electron.IpcRendererEvent, value: Value): void => callback(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

export function subscribeSignal(channel: string, callback: () => void): () => void {
  const listener = (): void => callback()
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}
