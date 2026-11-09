import { writable } from 'svelte/store'
import { actionError } from './errors'
import { defaultPreferences } from '../../shared/preferences'
import type { Preferences } from '../../shared/preferences'

export const preferences = writable<Preferences>(defaultPreferences)
export const preferenceError = writable('')

export async function initializePreferences(): Promise<void> {
  window.api.onPreferences((value) => preferences.set(value))
  try {
    preferences.set(await window.api.getPreferences())
  } catch {
    preferenceError.set('Could not load browser preferences. Reopen Rei to try again.')
  }
}

export async function updatePreferences(patch: Partial<Preferences>): Promise<boolean> {
  try {
    preferences.set(await window.api.setPreferences(patch))
    preferenceError.set('')
    return true
  } catch (error) {
    preferenceError.set(actionError(error, 'Could not save preferences. Try again.'))
    return false
  }
}
