export function extensionOriginCovered(granted: string, requested: string): boolean {
  const pattern = /^(\*|https?|wss?|ftp|file):\/\/([^/]*)(\/.*)$/
  const request = pattern.exec(requested)
  if (granted === '<all_urls>') return requested === '<all_urls>' || !!request
  const grant = pattern.exec(granted)
  if (!grant || !request) return false
  if (grant[1] !== request[1] && !(grant[1] === '*' && ['http', 'https'].includes(request[1])))
    return false
  const allowedHost = grant[2].toLowerCase()
  const requestedHost = request[2].toLowerCase()
  if (allowedHost === '*' || allowedHost === requestedHost) return true
  if (!allowedHost.startsWith('*.')) return false
  const domain = allowedHost.slice(2)
  return requestedHost === domain || requestedHost.endsWith(`.${domain}`)
}
