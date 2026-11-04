import { writable } from 'svelte/store'
import type { ExtensionState } from '../../shared/extensions'

export const extensions = writable<ExtensionState | null>(null)

export function watchExtensions(): () => void {
  let active = true
  const unsubscribe = window.api.onExtensions((state) => extensions.set(state))
  void window.api
    .getExtensions()
    .then((state) => {
      if (active) extensions.set(state)
    })
    .catch(() => {
      if (active)
        extensions.set({
          extensions: [],
          error: 'Could not load extensions. Restart Rei and try again.'
        })
    })
  return () => {
    active = false
    unsubscribe()
  }
}
