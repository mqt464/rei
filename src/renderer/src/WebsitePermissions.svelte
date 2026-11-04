<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { ChevronDown } from '@lucide/svelte'
  import { Button, Card, SettingRow } from './components/ui'
  import WebsitePermissionRows from './WebsitePermissionRows.svelte'
  import type { WebsitePermissionDecision } from '../../shared/website-permissions'

  export let origin = ''
  export let incognito = false
  export let contentsId = 0
  let decisions: WebsitePermissionDecision[] = []
  let loading = true
  let busy = false
  let error = ''
  let status = ''
  let summary: HTMLElement
  $: sites = [...new Set(decisions.map((decision) => decision.topOrigin))].sort()
  $: scope = origin ? { contentsId } : undefined

  async function load(): Promise<void> {
    try {
      decisions = await window.api.getWebsitePermissions(scope)
      error = ''
    } catch {
      error = 'Could not load permissions. Try again.'
    } finally {
      loading = false
    }
  }

  async function reset(decision: WebsitePermissionDecision): Promise<void> {
    const trigger = document.activeElement
    busy = true
    try {
      decisions = await window.api.resetWebsitePermission(decision, scope)
      error = ''
      status = 'Permission reset. Reload the site to apply.'
      await tick()
      if (trigger && !trigger.isConnected && document.activeElement === document.body)
        summary.focus({ preventScroll: true })
    } catch {
      error = 'Could not reset permission. Try again.'
    } finally {
      busy = false
    }
  }

  onMount(() => {
    const unsubscribe = window.api.onWebsitePermissions(() => void load())
    void load()
    return unsubscribe
  })
</script>

<Card>
  <details class="permission-group" open={!!origin}>
    <summary bind:this={summary} class="rei-row">
      <span class="rei-row-title">{origin || 'Site permissions'}</span>
      <span class="summary-trailing">
        {#if incognito}
          <span title="Cleared when all incognito tabs close">Incognito</span>
        {:else if !origin && sites.length}
          <span>{sites.length} {sites.length === 1 ? 'site' : 'sites'}</span>
        {/if}
        <ChevronDown size={15} aria-hidden="true" />
      </span>
    </summary>
    {#if loading}
      <SettingRow title="Loading permissions&#8230;" />
    {:else if error}
      <SettingRow title="Permissions unavailable"><Button on:click={load}>Retry</Button></SettingRow
      >
    {:else if origin}
      {#if decisions.length}
        <WebsitePermissionRows {decisions} {busy} {reset} />
      {:else}
        <SettingRow title="Ask before access" />
      {/if}
    {:else if sites.length === 0}
      <SettingRow title="No saved permissions" />
    {:else}
      {#each sites as site (site)}
        <details class="permission-group site-group">
          <summary class="rei-row">
            <span class="rei-row-title">{site}</span>
            <ChevronDown size={15} aria-hidden="true" />
          </summary>
          <WebsitePermissionRows
            decisions={decisions.filter((decision) => decision.topOrigin === site)}
            {busy}
            {reset}
          />
        </details>
      {/each}
    {/if}
    {#if status}<p class="permission-feedback rei-description" role="status">{status}</p>{/if}
    {#if error && !loading}<p class="permission-feedback permission-error" role="alert">
        {error}
      </p>{/if}
  </details>
</Card>

<style>
  summary {
    cursor: pointer;
    list-style: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary:hover {
    background: var(--rei-hover);
  }
  summary:focus-visible {
    outline: 2px solid var(--rei-focus);
    outline-offset: -3px;
    border-radius: var(--rei-radius);
  }
  summary :global(svg) {
    flex-shrink: 0;
    color: var(--rei-muted);
  }
  details[open] > summary :global(svg) {
    transform: rotate(180deg);
  }
  .summary-trailing {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 12px;
    color: var(--rei-muted);
    font-size: var(--rei-font-size);
    line-height: var(--rei-line-height, 1.5);
  }
  .permission-group > :global(.rei-row:not(summary)),
  .site-group {
    border-top: 1px solid var(--rei-border);
  }
  .site-group > :global(.rei-row:not(summary)) {
    padding-left: calc(var(--rei-spacing, 12px) + 15px);
  }
  .permission-feedback {
    max-width: none;
    margin: 0;
    padding: var(--rei-spacing, 12px);
    border-top: 1px solid var(--rei-border);
  }
  .permission-error {
    color: var(--rei-error);
  }
</style>
