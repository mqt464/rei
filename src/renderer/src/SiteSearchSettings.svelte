<script lang="ts">
  import { actionError } from './errors'
  import type { SearchShortcut } from '../../shared/search'
  import { Button, Card, SettingRow } from './components/ui'

  export let sites: SearchShortcut[]
  export let error: string
  let opening = false
  let openError = ''

  async function openFile(): Promise<void> {
    opening = true
    openError = ''
    try {
      await window.api.openShortcutsFile()
    } catch (error) {
      openError = actionError(error, 'Could not open site-search.json.')
    } finally {
      opening = false
    }
  }
</script>

<div class="site-actions">
  <Button busy={opening} on:click={openFile}>Open site-search.json</Button>
</div>
<Card>
  {#each sites as site (site.keyword)}
    <SettingRow title={site.title}
      ><code title={site.url} aria-label={`Keyword ${site.keyword}`}>{site.keyword}</code
      ></SettingRow
    >
  {:else}
    <SettingRow title="No sites added" />
  {/each}
</Card>
{#if openError || error}<p class="error" role="alert">{openError || error}</p>{/if}

<style>
  .site-actions {
    display: flex;
    margin-bottom: 14px;
  }
  code {
    color: var(--rei-muted);
    font-family: var(--rei-font-mono, monospace);
    font-size: var(--rei-font-size);
    overflow-wrap: anywhere;
  }
  .error {
    margin-top: 12px;
    color: var(--rei-error);
    font-size: var(--rei-font-size);
    overflow-wrap: anywhere;
  }
</style>
