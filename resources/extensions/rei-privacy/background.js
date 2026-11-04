globalThis.reiDoNotTrack = false
globalThis.chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (!globalThis.reiDoNotTrack) return
    const headers = details.requestHeaders.filter((header) => header.name.toLowerCase() !== 'dnt')
    headers.push({ name: 'DNT', value: '1' })
    return { requestHeaders: headers }
  },
  { urls: ['http://*/*', 'https://*/*'] },
  ['blocking', 'requestHeaders']
)
