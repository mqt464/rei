globalThis.reiDoNotTrack = false
globalThis.reiGlobalPrivacyControl = false
globalThis.reiCleanTrackingLinks = true
globalThis.chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!globalThis.reiCleanTrackingLinks || details.method !== 'GET') return
    const cleaned = globalThis.reiCleanTrackingUrl?.(details.url) ?? details.url
    if (cleaned !== details.url) return { redirectUrl: cleaned }
  },
  { urls: ['http://*/*', 'https://*/*'], types: ['main_frame', 'sub_frame'] },
  ['blocking']
)
globalThis.chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (!globalThis.reiDoNotTrack && !globalThis.reiGlobalPrivacyControl) return
    const headers = details.requestHeaders.filter((header) => {
      const name = header.name.toLowerCase()
      return (
        !(globalThis.reiDoNotTrack && name === 'dnt') &&
        !(globalThis.reiGlobalPrivacyControl && name === 'sec-gpc')
      )
    })
    if (globalThis.reiDoNotTrack) headers.push({ name: 'DNT', value: '1' })
    if (globalThis.reiGlobalPrivacyControl) headers.push({ name: 'Sec-GPC', value: '1' })
    return { requestHeaders: headers }
  },
  { urls: ['http://*/*', 'https://*/*'] },
  ['blocking', 'requestHeaders']
)
