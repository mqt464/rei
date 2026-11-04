interface AuthDetails {
  requestId: string
  url: string
}
type AuthListener = (details: AuthDetails, respond: (response: unknown) => void) => unknown

export function createExtensionProxyBridge(
  invoke: (
    method: string,
    details: unknown
  ) => Promise<{ ok: boolean; value?: unknown; error?: string }>,
  listen: (name: string, listener: (details: unknown) => void) => void,
  runtime: object
): {
  settings: Record<string, unknown>
  auth: Record<string, unknown>
  webRTC: Record<string, unknown>
  getLastError: () => unknown
  patchSetting: (
    target: Record<string, unknown> | undefined,
    setting: Record<string, unknown>
  ) => Record<string, unknown>
} {
  let lastError: { message: string } | undefined
  const nativeRuntime = runtime as { lastError?: { message: string } }
  const call =
    (method: string) =>
    (details: unknown = {}, callback?: (value?: unknown) => void): Promise<unknown> | void => {
      const promise = invoke(method, details).then((result) => {
        if (!result?.ok) throw new Error(result?.error ?? 'Extension proxy transport unavailable.')
        return result.value
      })
      if (!callback) return promise
      void promise.then(callback, (error) => {
        lastError = { message: error.message }
        try {
          callback()
        } finally {
          lastError = undefined
        }
      })
    }
  const changeEvent = (name: string): Record<string, unknown> => {
    const listeners = new Set<(details: unknown) => void>()
    listen(name, (details) => {
      for (const listener of listeners) listener(details)
    })
    return {
      addListener: (listener: (details: unknown) => void) => listeners.add(listener),
      removeListener: (listener: (details: unknown) => void) => listeners.delete(listener),
      hasListener: (listener: (details: unknown) => void) => listeners.has(listener),
      hasListeners: () => listeners.size > 0
    }
  }
  const authListeners = new Map<AuthListener, { urls: string[]; extra: string[] }>()
  let authListening = false
  const handleAuth = (received: unknown): void => {
    const details = received as AuthDetails
    let answered = false
    const respond = (response: unknown): void => {
      if (answered) return
      answered = true
      void invoke('rei.proxy.authResponse', { requestId: details.requestId, response })
    }
    for (const [listener, options] of authListeners) {
      const matches = options.urls.some((pattern) => {
        if (pattern === '<all_urls>') return /^https?:/.test(details.url)
        const escaped = pattern
          .split('*')
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('.*')
        return new RegExp(`^${escaped}$`).test(details.url)
      })
      if (!matches) continue
      try {
        if (options.extra.includes('asyncBlocking')) listener(details, respond)
        else
          Promise.resolve(listener(details, respond)).then(respond, () => respond({ cancel: true }))
      } catch {
        respond({ cancel: true })
      }
      return
    }
    respond({ cancel: true })
  }
  return {
    getLastError: () => lastError ?? nativeRuntime.lastError,
    patchSetting: (target = {}, setting) => {
      for (const [key, value] of Object.entries(setting)) {
        if (key === 'onChange' && target.onChange) Object.assign(target.onChange, value)
        else target[key] = value
      }
      return target
    },
    settings: {
      get: call('rei.proxy.get'),
      set: call('rei.proxy.set'),
      clear: call('rei.proxy.clear'),
      onChange: changeEvent('rei.proxy.onChange')
    },
    webRTC: {
      get: call('rei.proxy.webRTC.get'),
      set: call('rei.proxy.webRTC.set'),
      clear: call('rei.proxy.webRTC.clear'),
      onChange: changeEvent('rei.proxy.onWebRTCChange')
    },
    auth: {
      addListener: (listener: AuthListener, filter: { urls: string[] }, extra: string[] = []) => {
        if (!Array.isArray(filter?.urls) || !filter.urls.every((url) => typeof url === 'string'))
          throw new Error('Invalid proxy authentication filter.')
        authListeners.set(listener, { urls: filter.urls, extra })
        if (!authListening) {
          listen('rei.proxy.onAuthRequired', handleAuth)
          authListening = true
        }
        void invoke('rei.proxy.authListen', { enabled: true })
      },
      removeListener: (listener: AuthListener) => {
        authListeners.delete(listener)
        if (!authListeners.size) void invoke('rei.proxy.authListen', { enabled: false })
      },
      hasListener: (listener: AuthListener) => authListeners.has(listener),
      hasListeners: () => authListeners.size > 0
    }
  }
}
