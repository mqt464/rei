export function createExtensionCompatibilityBridge(runtime: {
  lastError?: { message: string }
  sendMessage: (...args: unknown[]) => unknown
}): {
  managed: Record<string, unknown>
  sendMessage: (...args: unknown[]) => unknown
  unsupported: (...args: unknown[]) => Promise<never> | void
  getLastError: () => { message: string } | undefined
} {
  let lastError: { message: string } | undefined
  const callbackResult = (
    callback: (value?: unknown) => void,
    value?: unknown,
    error?: { message: string }
  ): void => {
    const previous = lastError
    lastError = error
    try {
      callback(value)
    } finally {
      lastError = previous
    }
  }
  const complete = (value: unknown, callback?: (value?: unknown) => void): unknown => {
    if (!callback) return Promise.resolve(value)
    queueMicrotask(() => callbackResult(callback, value))
    return undefined
  }
  const fail = (message: string, args: unknown[]): Promise<never> | void => {
    const callback = args.at(-1)
    if (typeof callback !== 'function') return Promise.reject(new Error(message))
    queueMicrotask(() => callbackResult(callback as () => void, undefined, { message }))
  }
  const listeners = new Set<unknown>()
  return {
    getLastError: () => lastError,
    sendMessage: (...args) => {
      const callback = args.at(-1)
      if (typeof callback !== 'function') return runtime.sendMessage(...args)
      args[args.length - 1] = (value: unknown) =>
        callbackResult(callback as (value?: unknown) => void, value, runtime.lastError)
      return runtime.sendMessage(...args)
    },
    unsupported: (...args) => fail('This Chrome privacy setting is not supported by Rei.', args),
    managed: {
      get: (keys?: unknown, callback?: (value?: unknown) => void) => {
        if (typeof keys === 'function') return complete({}, keys as () => void)
        const defaults = keys && typeof keys === 'object' && !Array.isArray(keys) ? { ...keys } : {}
        return complete(defaults, callback)
      },
      getKeys: (callback?: () => void) => complete([], callback),
      getBytesInUse: (keys?: unknown, callback?: () => void) =>
        complete(0, typeof keys === 'function' ? (keys as () => void) : callback),
      set: (...args: unknown[]) => fail('Managed storage is read-only.', args),
      remove: (...args: unknown[]) => fail('Managed storage is read-only.', args),
      clear: (...args: unknown[]) => fail('Managed storage is read-only.', args),
      onChanged: {
        addListener: (listener: unknown) => {
          listeners.add(listener)
        },
        removeListener: (listener: unknown) => {
          listeners.delete(listener)
        },
        hasListener: (listener: unknown) => listeners.has(listener),
        hasListeners: () => listeners.size > 0
      }
    }
  }
}
