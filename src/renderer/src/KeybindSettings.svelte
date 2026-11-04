<script lang="ts">
  import { onDestroy } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import { Button, Card, SettingRow } from './components/ui'
  import { preferences, updatePreferences } from './preferences'
  import {
    defaultKeybindings,
    keybindActions,
    keyStroke,
    parseKeybindings,
    sequenceTimeout
  } from '../../shared/keyboard'

  let recording = ''
  let sequence: string[] = []
  let pending: string[] = []
  let modifierPreview = ''
  const held = new SvelteSet<string>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let clearing = false
  let error = ''
  let status = ''
  let saving = false
  const modifier = navigator.platform.includes('Mac') ? 'Meta' : 'Ctrl'
  const display = (keys: string[]): string =>
    keys
      .map((stroke) => stroke.replace('Mod+', `${modifier}+`).replaceAll('+', ' + '))
      .join(' then ')
  const pressedModifiers = (event: KeyboardEvent): string =>
    ['Ctrl', 'Meta', 'Alt', 'Shift']
      .filter((_, index) => [event.ctrlKey, event.metaKey, event.altKey, event.shiftKey][index])
      .join('+')
  $: preview = display([...sequence, ...pending, ...(modifierPreview ? [modifierPreview] : [])])

  function stop(): void {
    clearTimeout(timer)
    if (recording) window.api.setKeybindCapture(false)
    recording = ''
    sequence = []
    pending = []
    modifierPreview = ''
    held.clear()
    clearing = false
    error = ''
  }

  function start(id: string): void {
    if (saving || recording === id) return
    stop()
    status = ''
    recording = id
    window.api.setKeybindCapture(true)
  }

  function capture(event: KeyboardEvent, id: string): void {
    if (!recording) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        start(id)
      }
      return
    }
    if (saving || event.isComposing) return
    event.stopPropagation()
    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      stop()
      return
    }
    event.preventDefault()
    if (event.repeat) return
    clearTimeout(timer)
    if (event.key === 'Escape') {
      stop()
      return
    }
    held.add(event.code || event.key)
    if (error) {
      sequence = []
      pending = []
      error = ''
    }
    if (
      ['Backspace', 'Delete'].includes(event.key) &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey
    ) {
      clearing = true
      return
    }
    const stroke = keyStroke({
      key: event.key,
      code: event.code,
      control: event.ctrlKey,
      meta: event.metaKey,
      alt: event.altKey,
      shift: event.shiftKey
    })
    if (!stroke) {
      if (['Control', 'Meta', 'Alt', 'Shift'].includes(event.key))
        modifierPreview = pressedModifiers(event)
      return
    }
    modifierPreview = ''
    if (sequence.length + pending.length === 4) {
      error = 'Use up to four keystrokes. Press Escape to cancel.'
      return
    }
    pending = [...pending, stroke]
  }

  function release(event: KeyboardEvent): void {
    if (!recording || saving || event.isComposing) return
    event.preventDefault()
    event.stopPropagation()
    held.delete(event.code || event.key)
    if (modifierPreview) modifierPreview = pressedModifiers(event)
    if (held.size || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || error)
      return
    if (clearing) {
      sequence = []
      clearing = false
      void save()
    } else if (pending.length || sequence.length) {
      sequence = [...sequence, ...pending]
      pending = []
      timer = setTimeout(() => void save(), sequenceTimeout)
    }
  }

  async function save(): Promise<void> {
    if (!recording || saving) return
    const id = recording
    let bindings
    try {
      bindings = parseKeybindings({ ...$preferences.keybindings, [id]: sequence })
    } catch (failure) {
      error = failure instanceof Error ? failure.message : 'Invalid keybind.'
      return
    }
    saving = true
    if (await updatePreferences({ keybindings: bindings })) {
      stop()
      status = `${keybindActions.find((action) => action.id === id)!.title} updated.`
    }
    saving = false
  }

  async function reset(): Promise<void> {
    stop()
    saving = true
    if (await updatePreferences({ keybindings: defaultKeybindings }))
      status = 'Default keybinds restored.'
    saving = false
  }

  onDestroy(stop)
</script>

<svelte:window on:blur={stop} />

<span id="keybind-instructions" hidden>
  Click or press Enter to record. Release keys to set the binding. Escape cancels. Delete clears.
</span>
<Card aria-label="Keyboard shortcuts">
  {#each keybindActions as action (action.id)}
    <SettingRow title={action.title} control={`keybind-${action.id}`}>
      <div class="keybind-field">
        <input
          id={`keybind-${action.id}`}
          name={`keybind-${action.id}`}
          class="rei-control keybind-input"
          class:recording={recording === action.id}
          data-keybind-input
          type="text"
          readonly
          autocomplete="off"
          spellcheck={false}
          disabled={saving}
          aria-describedby={recording === action.id && error
            ? 'keybind-instructions keybind-error'
            : 'keybind-instructions'}
          aria-invalid={recording === action.id && !!error}
          value={recording === action.id
            ? preview || '...'
            : display($preferences.keybindings[action.id]) || 'Not set'}
          on:click={() => start(action.id)}
          on:blur={stop}
          on:keydown={(event) => capture(event, action.id)}
          on:keyup={release}
        />
        {#if recording === action.id && error}
          <p id="keybind-error" class="keybind-error" role="alert">{error}</p>
        {/if}
      </div>
    </SettingRow>
  {/each}
</Card>
<p class="rei-description" role="status">
  {recording
    ? `${keybindActions.find((action) => action.id === recording)!.title}: ${preview || 'Listening for keys…'}`
    : status}
</p>
<div class="reset-action">
  <Button disabled={saving} on:click={reset}>Restore defaults</Button>
</div>

<style>
  .keybind-field {
    display: grid;
    justify-items: end;
    min-width: 0;
    max-width: 100%;
  }
  .keybind-input {
    field-sizing: content;
    width: auto;
    min-width: 0;
    text-align: center;
    cursor: pointer;
  }
  .keybind-input.recording {
    border-color: var(--rei-focus);
  }
  .keybind-error {
    max-width: 36ch;
    color: var(--rei-error);
    margin: 8px 0 0;
    overflow-wrap: anywhere;
  }
  .reset-action {
    margin-top: 12px;
  }
</style>
