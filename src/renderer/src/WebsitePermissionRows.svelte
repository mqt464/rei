<script lang="ts">
  import { Button, SettingRow } from './components/ui'
  import { websitePermissionLabels } from '../../shared/website-permissions'
  import type { WebsitePermissionDecision } from '../../shared/website-permissions'

  export let decisions: WebsitePermissionDecision[]
  export let busy: boolean
  export let reset: (decision: WebsitePermissionDecision) => Promise<void>
</script>

{#each decisions as decision (JSON.stringify( [decision.topOrigin, decision.origin, decision.permission] ))}
  <SettingRow
    title={websitePermissionLabels[decision.permission]}
    description={decision.origin !== decision.topOrigin ? decision.origin : ''}
  >
    <span class="permission-state">{decision.allowed ? 'Allowed' : 'Blocked'}</span>
    <Button
      disabled={busy}
      title="Ask next time. Reload to apply; active streams keep running."
      aria-label={`Reset ${websitePermissionLabels[decision.permission]} for ${decision.origin}`}
      on:click={() => reset(decision)}>Reset</Button
    >
  </SettingRow>
{/each}

<style>
  .permission-state {
    color: var(--rei-muted);
    font-size: var(--rei-font-size);
    line-height: var(--rei-line-height, 1.5);
  }
</style>
