globalThis.reiDoNotTrack = false
globalThis.reiGlobalPrivacyControl = false
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
