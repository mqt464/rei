import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('reiCommandHost', {
  call: (permission: unknown, argument?: unknown) => {
    if (permission === 'activeTab.media') return ipcRenderer.invoke('command:call', permission)
    if (
      permission === 'downloads.enqueue' &&
      argument &&
      typeof argument === 'object' &&
      'id' in argument &&
      typeof argument.id === 'string' &&
      argument.id.length <= 80
    )
      return ipcRenderer.invoke('command:call', permission, { id: argument.id })
    return Promise.reject(new Error('Invalid command capability call.'))
  }
})
