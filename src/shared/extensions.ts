export interface BrowserExtension {
  id: string
  name: string
  version: string
  description: string
  enabled: boolean
  bundled: boolean
  options: boolean
  icon?: string
  error?: string
  compatibilityWarnings?: string[]
}

export interface ExtensionState {
  extensions: BrowserExtension[]
  error: string
}
