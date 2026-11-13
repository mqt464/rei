import { contextBridge, ipcRenderer } from 'electron'
import type { Preferences } from '../shared/preferences'
import { applyConsentRejection } from './consent'

type PrivacySignals = Pick<Preferences, 'doNotTrack' | 'globalPrivacyControl' | 'autoRejectConsent'>

function applySignals(signals: PrivacySignals): void {
  applyConsentRejection(signals.autoRejectConsent)
  contextBridge.executeInMainWorld({
    func: (value: PrivacySignals) => {
      Object.defineProperties(Navigator.prototype, {
        globalPrivacyControl: { configurable: true, get: () => value.globalPrivacyControl },
        doNotTrack: { configurable: true, get: () => (value.doNotTrack ? '1' : null) }
      })
    },
    args: [signals]
  })
}

if (process.argv.includes('--rei-browsing')) {
  applySignals(ipcRenderer.sendSync('privacy:get'))
  ipcRenderer.on('privacy:changed', (_event, signals: PrivacySignals) => applySignals(signals))
}
