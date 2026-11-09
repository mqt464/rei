import { writable } from 'svelte/store'
import { actionError } from './errors'
import type { CommandsState } from '../../shared/commands'

export const commands = writable<CommandsState | null>(null)

export function commandError(failure: unknown): string {
  return actionError(failure, 'Could not complete the command action.')
}

export function watchCommands(): () => void {
  let active = true
  let changed = false
  const unsubscribe = window.api.onCommands((state) => {
    changed = true
    commands.set(state)
  })
  void window.api
    .getCommands()
    .then((state) => {
      if (active && !changed) commands.set(state)
    })
    .catch((failure) => {
      if (active) commands.set({ commands: [], error: commandError(failure) })
    })
  return () => {
    active = false
    unsubscribe()
  }
}
