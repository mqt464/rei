<script lang="ts">
  import { onMount } from 'svelte'
  import ExtensionsIcon from './components/ExtensionsIcon.svelte'
  import Morph from './components/Morph.svelte'
  import { Button, Card, SettingRow, Switch } from './components/ui'
  import { extensions, watchExtensions } from './extensions'
  let busy = ''
  let error = ''
  let status = ''
  onMount(watchExtensions)

  async function toggle(id: string, enabled: boolean): Promise<void> {
    busy = id
    error = ''
    status = ''
    try {
      extensions.set(await window.api.toggleExtension(id, enabled))
      status = enabled
        ? 'Extension enabled. Reload existing pages to apply content scripts.'
        : 'Extension disabled. Reload existing pages to remove content changes.'
    } catch (failure) {
      error = failure instanceof Error ? failure.message : 'Could not change extension. Try again.'
    } finally {
      busy = ''
    }
  }

  async function action(id: string, kind: 'options' | 'remove' | 'store'): Promise<void> {
    busy = id || 'store'
    error = ''
    status = ''
    try {
      if (kind === 'options') await window.api.openExtensionOptions(id)
      else if (kind === 'remove') extensions.set(await window.api.removeExtension(id))
      else await window.api.openExtensionStore()
    } catch (failure) {
      error =
        failure instanceof Error ? failure.message : 'Could not complete this action. Try again.'
    } finally {
      busy = ''
    }
  }
</script>

<fieldset disabled={!!busy} aria-busy={!!busy}>
  <legend class="sr-only">Installed extensions</legend>
  {#if !$extensions}
    <p role="status">Loading extensions…</p>
  {:else}
    <Card>
      {#each $extensions.extensions as extension (extension.id)}
        <section class="extension-entry" aria-labelledby={`extension-name-${extension.id}`}>
          <div class="extension-heading">
            {#if extension.icon}
              <img src={extension.icon} alt="" width="28" height="28" />
            {:else}
              <ExtensionsIcon size={25} />
            {/if}
            <div class="extension-name">
              <h2 id={`extension-name-${extension.id}`}>{extension.name}</h2>
              <p>{extension.bundled ? 'Built in · ' : ''}Version {extension.version}</p>
            </div>
            <Switch
              id={`extension-${extension.id}`}
              checked={extension.enabled}
              label={`Enable ${extension.name}`}
              on:change={(event) => toggle(extension.id, event.detail)}
            />
          </div>
          {#if extension.error}<p class="error" role="alert">
              {extension.error}
            </p>{/if}
          <div class="extension-actions">
            {#if extension.options}
              <Button
                disabled={!extension.enabled}
                aria-label={`Options for ${extension.name}`}
                on:click={() => action(extension.id, 'options')}>Options</Button
              >
            {/if}
            {#if !extension.bundled}
              <Button
                aria-label={`Remove ${extension.name}`}
                on:click={() => action(extension.id, 'remove')}>Remove…</Button
              >
            {:else}
              <span>Updates with Rei</span>
            {/if}
          </div>
        </section>
      {:else}
        {#if !$extensions.error}<p>No extensions installed.</p>{/if}
      {/each}
      <div class="extension-store">
        <SettingRow title="Find more extensions">
          <Button on:click={() => action('', 'store')}>Chrome Web Store</Button>
        </SettingRow>
      </div>
    </Card>
  {/if}
</fieldset>
<p class="feedback" role="status"><Morph text={status} preset="action" /></p>
{#if error || $extensions?.error}<p class="error" role="alert">
    {error || $extensions?.error}
  </p>{/if}

<style>
  fieldset {
    display: grid;
    gap: 16px;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }
  .extension-heading {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: calc(var(--rei-spacing, 12px) + 1px) calc(var(--rei-spacing, 12px) + 3px);
  }
  .extension-entry + .extension-entry,
  .extension-store {
    border-top: 1px solid var(--rei-border);
  }
  .extension-heading > img {
    flex: 0 0 auto;
    object-fit: contain;
  }
  .extension-heading > :global(svg) {
    flex: 0 0 auto;
    color: var(--rei-muted);
  }
  .extension-name {
    flex: 1;
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-size: inherit;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .extension-name p {
    margin: 2px 0 0;
    color: var(--rei-muted);
    font-size: calc(var(--rei-font-size) - 1px);
  }
  .extension-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    padding: 0 16px 16px;
  }
  .extension-entry > .error {
    margin: 0 16px 12px;
  }
  .extension-actions span {
    margin-left: auto;
    color: var(--rei-muted);
    font-size: calc(var(--rei-font-size) - 1px);
  }
  .feedback {
    min-height: 1.5em;
    margin: 12px 0 0;
    color: var(--rei-muted);
  }
  .error {
    color: var(--rei-error);
    overflow-wrap: anywhere;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
