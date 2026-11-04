import type { Extension, WebContents } from 'electron'
import type { ElectronChromeExtensions } from 'electron-chrome-extensions'

export function extensionCompatibilityWarnings(manifest: Extension['manifest']): string[] {
  const warnings: string[] = []
  if (manifest.permissions?.includes('privacy'))
    warnings.push(
      'Only WebRTC IP handling is supported through chrome.privacy. Other privacy controls report unsupported errors.'
    )
  if (manifest.permissions?.includes('proxy'))
    warnings.push(
      'Proxy settings affect Rei browsing only. This is not a system VPN or a guaranteed kill switch.'
    )
  if (manifest.storage?.managed_schema)
    warnings.push('Managed storage contains no enterprise policies and is read-only.')
  return warnings
}

export function installExtensionCompatibility(api: ElectronChromeExtensions): void {
  const runtime = api as unknown as {
    ctx: {
      store: { tabs: Set<WebContents> }
      router: {
        observeListenerHost(host: WebContents): void
        apiHandler(): (
          name: string,
          handler: (event: { type: string; sender: WebContents }) => unknown
        ) => void
      }
    }
    api: { tabs: { getTabDetails(tab: WebContents): unknown } }
  }
  const { router, store } = runtime.ctx
  const observedHosts = new WeakSet<WebContents>()
  const observeListenerHost = router.observeListenerHost.bind(router)
  router.observeListenerHost = (host) => {
    if (observedHosts.has(host)) return
    observedHosts.add(host)
    observeListenerHost(host)
  }
  router.apiHandler()('tabs.getCurrent', (event) => {
    if (event.type !== 'frame' || !store.tabs.has(event.sender)) return undefined
    return runtime.api.tabs.getTabDetails(event.sender)
  })
}
