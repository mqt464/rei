<script lang="ts">
  import { parsePreferences } from '../../shared/preferences'
  import { preferences, updatePreferences } from './preferences'
  import { Card, Select, SettingRow } from './components/ui'
  let pagesError = ''
  async function saveList(key: 'startupPages', value: string): Promise<void> {
    const entries = value
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean)
    try {
      parsePreferences({ [key]: entries })
      pagesError = ''
      await updatePreferences({ [key]: entries })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Check these entries.'
      pagesError = message
    }
  }
</script>

<Card>
  <SettingRow title="On startup" control="startup-behaviour"
    ><Select
      id="startup-behaviour"
      label="On startup"
      value={$preferences.startup}
      options={[
        { value: 'blank', label: 'Open blank' },
        { value: 'restore', label: 'Restore previous session' },
        { value: 'pages', label: 'Open chosen pages' }
      ]}
      on:change={(event) =>
        updatePreferences({ startup: event.detail as 'blank' | 'restore' | 'pages' })}
    /></SettingRow
  >
  {#if $preferences.startup === 'pages'}
    <SettingRow title="Startup pages" control="startup-pages" stacked>
      <textarea
        id="startup-pages"
        class="rei-control"
        rows="4"
        spellcheck={false}
        autocomplete="off"
        placeholder="https://example.com"
        title="One HTTP(S) address per line, up to 50 pages."
        value={$preferences.startupPages.join('\n')}
        aria-invalid={!!pagesError}
        aria-describedby={pagesError ? 'startup-pages-error' : undefined}
        on:change={(event) => saveList('startupPages', event.currentTarget.value)}></textarea>
      {#if pagesError}<p id="startup-pages-error" class="rei-description" role="alert">
          {pagesError}
        </p>{/if}
    </SettingRow>
  {/if}
</Card>

<style>
  textarea {
    width: 100%;
    resize: vertical;
    min-height: 72px;
  }
</style>
