<script lang="ts">
  import StartupSettings from './StartupSettings.svelte'
  import WebsitePermissions from './WebsitePermissions.svelte'
  import { parsePreferences, searchEngines } from '../../shared/preferences'
  import type { Preferences } from '../../shared/preferences'
  import { preferences, preferenceError, updatePreferences } from './preferences'
  import { Button, Card, Select, SettingRow, Slider, Switch } from './components/ui'
  export let mode: 'browser' | 'search' | 'downloads' | 'privacy'
  let choosingFolder = false
  let homepageError = ''
  async function saveHomepage(value: string): Promise<void> {
    try {
      parsePreferences({ newTabUrl: value })
      homepageError = ''
    } catch (error) {
      homepageError = error instanceof Error ? error.message : 'Enter an HTTP or HTTPS address.'
      return
    }
    await updatePreferences({ newTabUrl: value })
  }
  const browserSwitches = [
    {
      key: 'autoHideTopbar',
      title: 'Auto-hide address bar'
    },
    {
      key: 'backgroundTabs',
      title: 'Open links in background tabs'
    },
    {
      key: 'confirmClose',
      title: 'Confirm closing multiple tabs'
    },
    { key: 'spellcheck', title: 'Check spelling' }
  ] as const
  async function chooseFolder(): Promise<void> {
    choosingFolder = true
    try {
      preferences.set(await window.api.chooseDownloadFolder())
      preferenceError.set('')
    } catch {
      preferenceError.set('Could not change the download folder. Try again.')
    } finally {
      choosingFolder = false
    }
  }
</script>

{#if mode === 'browser'}
  <StartupSettings />
  <Card
    ><SettingRow title="New-tab page" control="new-tab-url" stacked>
      <input
        id="new-tab-url"
        class="rei-control homepage-input"
        name="new-tab-url"
        type="url"
        autocomplete="off"
        spellcheck={false}
        placeholder="https://example.com"
        aria-invalid={!!homepageError}
        aria-describedby={homepageError ? 'homepage-error' : undefined}
        value={$preferences.newTabUrl}
        on:change={(event) => saveHomepage(event.currentTarget.value)}
      />
      {#if homepageError}<p id="homepage-error" class="rei-description" role="alert">
          {homepageError}
        </p>{/if}
    </SettingRow></Card
  >
  <Card>
    <SettingRow title="Default website zoom" control="default-zoom"
      ><Slider
        id="default-zoom"
        label="Default website zoom"
        value={$preferences.defaultZoom}
        min={50}
        max={200}
        step={10}
        unit="%"
        on:change={(event) => updatePreferences({ defaultZoom: event.detail })}
      /></SettingRow
    >
    {#each browserSwitches as setting (setting.key)}<SettingRow
        title={setting.title}
        control={setting.key}
        ><Switch
          id={setting.key}
          label={setting.title}
          checked={$preferences[setting.key]}
          on:change={(event) => updatePreferences({ [setting.key]: event.detail })}
        /></SettingRow
      >{/each}
  </Card>
  <Card>
    <SettingRow title="Context menu style" control="context-menu-style">
      <Select
        id="context-menu-style"
        label="Context menu style"
        value={$preferences.contextMenuStyle}
        options={[
          { value: 'rei', label: 'Rei' },
          { value: 'native', label: 'Native' }
        ]}
        on:change={(event) =>
          updatePreferences({ contextMenuStyle: event.detail as Preferences['contextMenuStyle'] })}
      />
    </SettingRow>
    {#if $preferences.contextMenuStyle === 'rei'}
      <SettingRow title="Context menu icons" control="context-menu-icons">
        <Switch
          id="context-menu-icons"
          label="Context menu icons"
          checked={$preferences.contextMenuIcons}
          on:change={(event) => updatePreferences({ contextMenuIcons: event.detail })}
        />
      </SettingRow>
    {/if}
  </Card>
{:else if mode === 'search'}
  <Card
    ><SettingRow title="Default search engine" control="search-engine"
      ><Select
        id="search-engine"
        label="Default search engine"
        value={$preferences.searchEngine}
        options={Object.entries(searchEngines).map(([value, engine]) => ({
          value,
          label: engine.label
        }))}
        on:change={(event) =>
          updatePreferences({ searchEngine: event.detail as Preferences['searchEngine'] })}
      /></SettingRow
    ></Card
  >
{:else if mode === 'downloads'}
  <Card>
    <SettingRow title="Download folder"
      ><Button busy={choosingFolder} on:click={chooseFolder}>Change folder</Button></SettingRow
    >
    <SettingRow title="Ask where to save each file" control="download-prompt"
      ><Switch
        id="download-prompt"
        label="Ask where to save each file"
        checked={$preferences.downloadPrompt}
        on:change={(event) => updatePreferences({ downloadPrompt: event.detail })}
      /></SettingRow
    >
    <SettingRow title="Keep download history" control="download-history">
      <Switch
        id="download-history"
        label="Keep download history"
        checked={$preferences.downloadHistory}
        on:change={(event) => updatePreferences({ downloadHistory: event.detail })}
      />
    </SettingRow>
    <SettingRow title="Download manager">
      <Button on:click={() => window.api.openDownloads()}>Open downloads</Button>
    </SettingRow>
  </Card>
{:else}
  <Card>
    <SettingRow title="Save browsing history" control="history-enabled"
      ><Switch
        id="history-enabled"
        label="Save browsing history"
        checked={$preferences.historyEnabled}
        on:change={(event) => updatePreferences({ historyEnabled: event.detail })}
      /></SettingRow
    >
    <SettingRow title="Send Do Not Track" control="do-not-track"
      ><Switch
        id="do-not-track"
        label="Send Do Not Track requests"
        checked={$preferences.doNotTrack}
        on:change={(event) => updatePreferences({ doNotTrack: event.detail })}
      /></SettingRow
    >
  </Card>
  <WebsitePermissions />
{/if}

<style>
  .homepage-input {
    width: 100%;
    min-width: 0;
  }
  #homepage-error {
    width: 100%;
    color: var(--rei-error);
  }
</style>
