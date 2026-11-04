<script lang="ts">
  import { parsePreferences } from '../../shared/preferences'
  import { preferences, updatePreferences } from './preferences'
  import { Card, SettingRow, Slider } from './components/ui'

  const modes = [
    {
      id: 'sleep',
      description: 'Freezes tabs, partially reducing memory',
      action: 'Sleep after',
      delay: 'tabSleepMinutes',
      exceptions: 'tabSleepExceptions',
      exceptionTitle: 'Never sleep these sites'
    },
    {
      id: 'discard',
      description: 'Unload tabs, maximizing memory reduction',
      action: 'Discard after',
      delay: 'tabDiscardMinutes',
      exceptions: 'tabDiscardExceptions',
      exceptionTitle: 'Never discard these sites'
    }
  ] as const
  let errors = { sleep: '', discard: '' }

  function formatDuration(seconds: number): string {
    const total = Math.round(seconds)
    const hours = Math.floor(total / 3600)
    const minutes = Math.floor((total % 3600) / 60)
    const remainder = total % 60
    return (
      [hours ? `${hours}h` : '', minutes ? `${minutes}m` : '', remainder ? `${remainder}s` : '']
        .filter(Boolean)
        .join(' ') || '0s'
    )
  }

  async function saveExceptions(mode: (typeof modes)[number], value: string): Promise<void> {
    const entries = value
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean)
    try {
      parsePreferences({ [mode.exceptions]: entries })
      errors = { ...errors, [mode.id]: '' }
      await updatePreferences({ [mode.exceptions]: entries })
    } catch (error) {
      errors = {
        ...errors,
        [mode.id]: error instanceof Error ? error.message : 'Check these hostnames.'
      }
    }
  }
</script>

{#each modes as mode (mode.id)}
  <Card>
    <SettingRow
      title={mode.action}
      description={mode.description}
      control={`tab-${mode.id}-minutes`}
    >
      <Slider
        id={`tab-${mode.id}-minutes`}
        label={mode.action}
        value={Math.round($preferences[mode.delay] * 60)}
        min={0}
        max={21600}
        formatValue={formatDuration}
        offAtZero
        on:change={(event) => updatePreferences({ [mode.delay]: event.detail / 60 })}
      />
    </SettingRow>
    <SettingRow title={mode.exceptionTitle} control={`tab-${mode.id}-exceptions`} stacked>
      <textarea
        id={`tab-${mode.id}-exceptions`}
        class="rei-control"
        rows="3"
        spellcheck={false}
        autocomplete="off"
        placeholder="meet.example.com"
        value={$preferences[mode.exceptions].join('\n')}
        aria-invalid={!!errors[mode.id]}
        aria-describedby={errors[mode.id] ? `${mode.id}-exceptions-error` : undefined}
        on:change={(event) => saveExceptions(mode, event.currentTarget.value)}></textarea>
      {#if errors[mode.id]}
        <p id={`${mode.id}-exceptions-error`} class="rei-description" role="alert">
          {errors[mode.id]}
        </p>
      {/if}
    </SettingRow>
  </Card>
{/each}

<style>
  textarea {
    width: 100%;
    resize: vertical;
    min-height: 72px;
  }
</style>
