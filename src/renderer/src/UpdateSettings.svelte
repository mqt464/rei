<script lang="ts">
  import { onMount } from 'svelte'
  import type { UpdateState } from '../../shared/updates'
  import { preferences, updatePreferences } from './preferences'
  import { Button, Card, SettingRow, Switch } from './components/ui'

  let state: UpdateState | undefined
  let pending = false
  let error = ''
  const labels = {
    unsupported: '',
    idle: 'Ready to check for updates',
    checking: 'Checking for updates…',
    available: 'Preparing download…',
    downloading: 'Downloading update…',
    ready: 'Update ready to install',
    current: 'Rei is up to date',
    error: 'Update failed'
  }
  $: working = pending || (state && ['checking', 'available', 'downloading'].includes(state.status))

  onMount(() => {
    let active = true
    let received = false
    const unsubscribe = window.api.onUpdates((value) => {
      received = true
      state = value
    })
    void window.api
      .getUpdates()
      .then((value) => {
        if (active && !received) state = value
      })
      .catch(() => {
        if (active) error = 'Could not load update status. Reopen Settings to try again.'
      })
    return () => {
      active = false
      unsubscribe()
    }
  })

  async function run(action: 'check' | 'install'): Promise<void> {
    pending = true
    error = ''
    try {
      if (action === 'check') state = await window.api.checkForUpdates()
      else await window.api.installUpdate()
    } catch {
      error = 'Could not complete the update. Try again.'
    } finally {
      pending = false
    }
  }
</script>

<Card>
  <SettingRow
    title="Rei"
    description={state ? `Version ${state.currentVersion}` : 'Loading version…'}
  >
    {#if state?.status === 'ready'}
      <Button busy={pending} on:click={() => run('install')}>Restart to update…</Button>
    {:else}
      <Button
        busy={!!working}
        disabled={!state || state.status === 'unsupported'}
        on:click={() => run('check')}
      >
        {working ? 'Updating…' : 'Check for updates'}
      </Button>
    {/if}
  </SettingRow>
  {#if state?.status !== 'unsupported' || state?.message || error}
    <div class="update-status">
      <p class="rei-description" role="status" aria-live="polite" aria-atomic="true">
        {state ? labels[state.status] : 'Loading update status…'}
        {#if state?.version}
          · Version {state.version}{/if}
      </p>
      {#if state?.status === 'downloading'}
        <progress max="100" value={state.progress} aria-label="Update download progress"></progress>
        <span class="rei-description progress-value">{state.progress}%</span>
      {/if}
      {#if state?.message}<p class="rei-description">{state.message}</p>{/if}
      {#if state?.status === 'ready'}
        <p class="rei-description">
          Save your work before restarting. The update will not install until you choose to restart.
        </p>
      {/if}
      {#if error}<p class="rei-description" role="alert">{error}</p>{/if}
    </div>
  {/if}
</Card>

<Card>
  <SettingRow title="Automatic updates" control="automatic-updates">
    <Switch
      id="automatic-updates"
      label="Automatic updates"
      checked={$preferences.automaticUpdates}
      on:change={(event) => updatePreferences({ automaticUpdates: event.detail })}
    />
  </SettingRow>
</Card>

<style>
  .update-status {
    padding: 0 16px 16px;
    overflow-wrap: anywhere;
  }
  progress {
    width: 100%;
    height: 6px;
    accent-color: var(--rei-accent);
  }
  .progress-value {
    font-variant-numeric: tabular-nums;
  }
</style>
