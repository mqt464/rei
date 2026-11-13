export function cleanTrackingUrl(value: string): string {
  let address: URL
  try {
    address = new URL(value)
  } catch {
    return value
  }
  if (!['http:', 'https:'].includes(address.protocol) || !address.search) return value
  const fields = address.search.slice(1).split('&')
  if (
    Array.from(address.searchParams.keys()).some((name) =>
      /^(?:x-amz-signature|x-goog-signature|signature|sig)$/i.test(name)
    )
  )
    return value
  const kept = fields.filter((field) => {
    let name: string
    try {
      name = decodeURIComponent(field.split('=', 1)[0].replace(/\+/g, ' ')).toLowerCase()
    } catch {
      return true
    }
    return !/^(?:utm_[a-z\d_]+|fbclid|gclid|dclid|msclkid|twclid|ttclid|igshid|mc_cid|mc_eid|_hsenc|_hsmi|vero_id|oly_anon_id|oly_enc_id)$/.test(
      name
    )
  })
  if (kept.length === fields.length) return value
  const queryStart = value.indexOf('?')
  const hashStart = value.indexOf('#', queryStart)
  return (
    value.slice(0, queryStart) +
    (kept.length ? `?${kept.join('&')}` : '') +
    (hashStart < 0 ? '' : value.slice(hashStart))
  )
}
