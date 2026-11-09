import type { ElectronAPI } from '@electron-toolkit/preload'
import type { BrowserAPI } from '../shared/browser'

declare global {
  interface Window {
    electron: ElectronAPI
    api: BrowserAPI
  }
}
