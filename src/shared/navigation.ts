export function resolveAddress(input: string): string | null {
  const address = input.trim()
  if (!address) return null

  if (/^https?:\/\//i.test(address)) return new URL(address).href

  if (/^(?:javascript|data|file|vbscript|about):/i.test(address)) {
    throw new Error('Only HTTP and HTTPS addresses are supported.')
  }

  if (
    /^(?:localhost|(?:[^\s./:?#]+\.)+[^\s./:?#]+|\[[\da-f:]+\])(?::\d+)?(?:[/?#]|$)/i.test(address)
  ) {
    return new URL(`https://${address}`).href
  }

  return `https://www.google.com/search?q=${encodeURIComponent(address)}`
}
