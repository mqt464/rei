<script lang="ts">
  import { tick } from 'svelte'
  import { FolderOpen } from '@lucide/svelte'
  import { commands, commandError } from './commands'
  import { Button, Card, SettingRow, Switch } from './components/ui'

  let busy = false
  let error = ''
  let removing = ''
  let status = ''

  async function perform(action: () => Promise<unknown>): Promise<void> {
    busy = true
    error = ''
    status = ''
    try {
      await action()
    } catch (failure) {
      error = commandError(failure)
    } finally {
      busy = false
    }
  }

  async function remove(id: string): Promise<void> {
    commands.set(await window.api.removeCommand(id))
    removing = ''
    status = 'Command moved to trash. Rei will not reinstall it.'
    setTimeout(() => document.getElementById('commands-folder')?.focus(), 0)
  }

  async function confirmRemoval(id: string, confirm: boolean): Promise<void> {
    removing = confirm ? id : ''
    await tick()
    document.getElementById(`${confirm ? 'command-trash' : 'command-remove'}-${id}`)?.focus()
  }
</script>

<fieldset disabled={busy} aria-busy={busy}>
  <legend class="sr-only">Installed commands</legend>
  {#if !$commands}
    <p role="status">Loading commands…</p>
  {:else}
    <Card>
      {#each $commands.commands as command (command.id)}
        <section class="command-entry" aria-labelledby={`command-name-${command.id}`}>
          <div class="command-heading">
            <div class="command-copy">
              <div class="command-name">
                <h2 id={`command-name-${command.id}`}>{command.name}</h2>
                {#if command.version}<span class="version">v{command.version}</span>{/if}
              </div>
              <p class="description">
                {command.description || 'Fix this command’s file to load it.'}
              </p>
            </div>
            <fieldset disabled={!!command.error} class="enable-control">
              <legend class="sr-only">Enable {command.name}</legend>
              <Switch
                id={`command-${command.id}`}
                checked={command.enabled}
                label={`Enable ${command.name}`}
                on:change={(event) =>
                  perform(async () =>
                    commands.set(await window.api.toggleCommand(command.id, event.detail))
                  )}
              />
            </fieldset>
          </div>
          {#if command.error}<p class="error command-error" role="alert">{command.error}</p>{/if}
          <div class="command-actions">
            <Button
              on:click={() => perform(() => window.api.revealCommand(command.id))}
              aria-label={`Show ${command.name} file`}>Show file</Button
            >
            {#if removing === command.id}
              <span>Move command file to trash?</span>
              <Button
                id={`command-trash-${command.id}`}
                on:click={() => perform(() => remove(command.id))}>Move to trash</Button
              >
              <Button on:click={() => confirmRemoval(command.id, false)}>Cancel</Button>
            {:else}
              <Button
                id={`command-remove-${command.id}`}
                on:click={() => confirmRemoval(command.id, true)}
                aria-label={`Remove ${command.name}`}>Remove…</Button
              >
            {/if}
          </div>
        </section>
      {:else}
        <SettingRow
          title="No commands installed"
          description="Add a .ts or .js file to your commands folder. New commands start disabled, with no access."
        />
      {/each}
    </Card>
  {/if}
  <div class="command-tools">
    <Button id="commands-folder" on:click={() => perform(() => window.api.openCommandsFolder())}>
      <FolderOpen size={14} aria-hidden="true" /> Open commands folder
    </Button>
  </div>
</fieldset>
<p class="feedback" role="status">{status}</p>
{#if error || $commands?.error}<p class="error" role="alert">{error || $commands?.error}</p>{/if}

<style>
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  fieldset {
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }
  .command-tools {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 16px;
  }
  .command-tools :global(.rei-button) {
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }
  .command-entry + .command-entry {
    border-top: 1px solid var(--rei-border);
  }
  .command-heading {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: calc(var(--rei-spacing, 12px) + 1px) calc(var(--rei-spacing, 12px) + 3px);
  }
  .command-copy {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .command-name {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 8px;
  }
  h2 {
    margin: 0;
    font-size: inherit;
    font-weight: 600;
  }
  .version,
  .description,
  .command-actions > span {
    color: var(--rei-muted);
    font-size: var(--rei-font-size);
    line-height: var(--rei-line-height, 1.5);
  }
  .version {
    font-size: calc(var(--rei-font-size) - 1px);
    font-variant-numeric: tabular-nums;
  }
  .description {
    margin: 4px 0 0;
    max-width: 52ch;
  }
  .enable-control {
    flex: 0 0 auto;
  }
  .command-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    padding: 12px 15px;
    border-top: 1px solid var(--rei-border);
  }
  .command-actions > span {
    overflow-wrap: anywhere;
  }
  .feedback {
    min-height: 1.5em;
    margin: 12px 0 0;
    color: var(--rei-muted);
  }
  .error {
    margin: 12px 0 0;
    color: var(--rei-error);
    overflow-wrap: anywhere;
  }
  .command-error {
    margin: 0;
    padding: 0 15px 12px;
  }
</style>
