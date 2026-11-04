<script lang="ts">
  import { onMount } from 'svelte'
  import {
    Download,
    File,
    FolderOpen,
    Settings,
    Pause,
    Play,
    X,
    RotateCcw,
    Copy,
    Trash2
  } from '@lucide/svelte'
  import { downloadBytes, downloadRemaining } from '../../shared/downloads'
  import type { DownloadAction, DownloadRecord } from '../../shared/downloads'
  import { settingsUrl } from '../../shared/navigation'
  import { theme } from './theme'
  import { preferences } from './preferences'
  import ScrollArea from './components/ScrollArea.svelte'
  import { Button, Card, Select } from './components/ui'

  export let persistentTopbar = false
  let page: HTMLElement
  let records: DownloadRecord[] = []
  let loaded = false
  let query = ''
  let filter = 'all'
  let error = ''
  let feedback = ''
  let busy = ''
  const statuses = {
    progressing: 'Downloading',
    paused: 'Paused',
    interrupted: 'Interrupted',
    completed: 'Completed',
    cancelled: 'Cancelled'
  }
  $: active = records.filter((record) => record.active).length
  $: visible = records.filter(
    (record) =>
      (filter === 'all' ||
        (filter === 'active'
          ? record.active
          : filter === 'completed'
            ? record.status === 'completed'
            : !record.active && record.status !== 'completed')) &&
      `${record.filename} ${record.url}`.toLowerCase().includes(query.toLowerCase().trim())
  )

  onMount(() => {
    page.focus({ preventScroll: true })
    let changed = false
    let mounted = true
    const unsubscribe = window.api.onDownloads((value) => {
      changed = true
      records = value
      loaded = true
    })
    window.api
      .getDownloads()
      .then((value) => {
        if (!mounted) return
        if (!changed) records = value
        loaded = true
      })
      .catch(() => {
        if (!mounted) return
        error = 'Could not load downloads. Reopen this page to try again.'
        loaded = true
      })
    return () => {
      mounted = false
      unsubscribe()
    }
  })

  async function run(key: string, action: () => Promise<void>, message = ''): Promise<void> {
    if (busy) return
    busy = key
    error = ''
    feedback = ''
    try {
      await action()
      feedback = message
    } catch (reason) {
      error =
        reason instanceof Error
          ? reason.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
          : 'Could not complete this action. Try again.'
    } finally {
      busy = ''
    }
  }

  function act(record: DownloadRecord, action: DownloadAction): void {
    void run(record.id, () => window.api.downloadAction(record.id, action))
  }

  function source(url: string): string {
    try {
      return new URL(url).hostname || 'Local download'
    } catch {
      return 'Unknown source'
    }
  }
</script>

<main
  bind:this={page}
  class="downloads-page"
  style:top={persistentTopbar ? `${$theme.addressBarHeight}px` : '0px'}
  tabindex="-1"
  aria-label="Downloads"
>
  <ScrollArea className="downloads-scroll" background="var(--rei-background)">
    <div class="downloads-layout">
      <header>
        <div>
          <h1>Downloads</h1>
          {#if active}<p class="summary">{active} in progress</p>{/if}
        </div>
        <div class="toolbar">
          <Button
            disabled={!!busy}
            on:click={() => run('folder', () => window.api.openDownloadFolder())}
            ><FolderOpen size={15} aria-hidden="true" /> Open folder</Button
          >
          <Button
            title="Download settings"
            aria-label="Download settings"
            on:click={() => window.api.navigate(`${settingsUrl}/downloads`)}
            ><Settings size={15} aria-hidden="true" /></Button
          >
        </div>
      </header>

      <div class="filters">
        <label class="search">
          <span class="sr-only">Search downloads</span>
          <input
            class="rei-control"
            type="search"
            name="download-search"
            placeholder="Search downloads&#8230;"
            bind:value={query}
            autocomplete="off"
            spellcheck={false}
          />
        </label>
        <Select
          id="download-filter"
          label="Filter downloads"
          value={filter}
          options={[
            { value: 'all', label: 'All downloads' },
            { value: 'active', label: 'In progress' },
            { value: 'completed', label: 'Completed' },
            { value: 'stopped', label: 'Interrupted / cancelled' }
          ]}
          on:change={(event) => (filter = event.detail)}
        />
      </div>

      <div class="history-tools">
        <p>
          {loaded
            ? `${visible.length} ${visible.length === 1 ? 'download' : 'downloads'}`
            : 'Loading downloads\u2026'}
        </p>
        <Button
          disabled={!!busy || !records.some((record) => !record.active)}
          title="Remove finished entries, not files"
          on:click={() =>
            run(
              'clear',
              () => window.api.clearDownloads(),
              'Download history cleared. Files were not deleted.'
            )}>Clear history</Button
        >
      </div>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <p class="feedback" role="status">{feedback}</p>

      {#if loaded && visible.length === 0}
        <Card>
          <div class="empty">
            <Download size={24} strokeWidth={1.5} aria-hidden="true" />
            <h2>{records.length ? 'No matching downloads' : 'No downloads yet'}</h2>
            {#if records.length}<p>Try another search or filter.</p>{/if}
          </div>
        </Card>
      {:else}
        <ul class="download-list" aria-label="Downloaded files">
          {#each visible as record (record.id)}
            <li>
              <Card>
                <div class="download-entry">
                  <File class="file-icon" size={20} strokeWidth={1.5} aria-hidden="true" />
                  <div class="file-content">
                    <h2 title={record.path || record.filename}>{record.filename}</h2>
                    <p class="source">
                      {source(record.url)} &middot;
                      <time datetime={new Date(record.started).toISOString()}
                        >{new Date(record.started).toLocaleString(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short'
                        })}</time
                      >
                    </p>
                    <p class="transfer" class:failed={record.status === 'interrupted'}>
                      <span
                        >{record.status === 'progressing' && record.stage === 'preparing'
                          ? 'Preparing media'
                          : record.status === 'progressing' && record.stage === 'processing'
                            ? 'Processing media'
                            : statuses[record.status]}</span
                      >
                      &middot; {downloadBytes(record.received)}{record.total > 0 &&
                      record.status !== 'completed'
                        ? ` / ${downloadBytes(record.total)}`
                        : ''}
                      {#if record.status === 'progressing' && record.speed > 0}
                        &middot; {downloadBytes(record.speed)}/s {downloadRemaining(record)}{/if}
                    </p>
                    {#if record.error}<p class="error" role="alert">{record.error}</p>{/if}
                    {#if record.active}
                      <progress
                        aria-label={`Download progress for ${record.filename}`}
                        max={record.total > 0 ? record.total : 1}
                        value={record.total > 0
                          ? Math.min(record.received, record.total)
                          : undefined}
                      ></progress>
                    {/if}
                    <div class="file-actions">
                      {#if record.status === 'completed'}
                        <Button disabled={!!busy} on:click={() => act(record, 'open')}
                          >Open file</Button
                        >
                        <Button
                          disabled={!!busy}
                          title="Show in folder"
                          aria-label={`Show ${record.filename} in folder`}
                          on:click={() => act(record, 'reveal')}
                          ><FolderOpen size={15} aria-hidden="true" /></Button
                        >
                      {:else if record.active}
                        {#if record.status === 'progressing' && record.canPause !== false}
                          <Button
                            disabled={!!busy}
                            title="Pause"
                            aria-label={`Pause ${record.filename}`}
                            on:click={() => act(record, 'pause')}
                            ><Pause size={15} aria-hidden="true" /></Button
                          >
                        {:else if record.status === 'paused'}
                          <Button
                            disabled={!!busy || !record.canResume}
                            title={record.canResume
                              ? 'Resume'
                              : 'Server cannot resume this transfer. Cancel and retry.'}
                            aria-label={`Resume ${record.filename}`}
                            on:click={() => act(record, 'resume')}
                            ><Play size={15} aria-hidden="true" /></Button
                          >
                        {/if}
                        <Button
                          disabled={!!busy}
                          title="Cancel"
                          aria-label={`Cancel ${record.filename}`}
                          on:click={() => act(record, 'cancel')}
                          ><X size={15} aria-hidden="true" /></Button
                        >
                      {:else}
                        <Button
                          disabled={!!busy || !/^https?:\/\//i.test(record.url)}
                          on:click={() => act(record, 'retry')}
                          ><RotateCcw size={15} aria-hidden="true" /> Retry</Button
                        >
                      {/if}
                      <Button
                        disabled={!!busy}
                        title="Copy download link"
                        aria-label={`Copy download link for ${record.filename}`}
                        on:click={() =>
                          run(
                            record.id,
                            () => navigator.clipboard.writeText(record.url),
                            'Download link copied.'
                          )}><Copy size={15} aria-hidden="true" /></Button
                      >
                      {#if !record.active}
                        <Button
                          disabled={!!busy}
                          title="Remove from history (keeps file)"
                          aria-label={`Remove ${record.filename} from history`}
                          on:click={() => act(record, 'remove')}
                          ><Trash2 size={15} aria-hidden="true" /></Button
                        >
                      {/if}
                    </div>
                  </div>
                </div>
              </Card>
            </li>
          {/each}
        </ul>
      {/if}
      {#if !$preferences.downloadHistory}<p class="history-note">
          Download history is off. Finished downloads disappear from this list. Your files stay in
          the download folder.
        </p>{/if}
    </div>
  </ScrollArea>
</main>

<style>
  .downloads-page {
    position: absolute;
    inset: 0;
    background: var(--rei-background);
    color: var(--rei-text);
    outline: none;
  }
  .downloads-page :global(.downloads-scroll) {
    height: 100%;
  }
  .downloads-layout {
    max-width: 728px;
    margin: 0 auto;
    padding: 32px 24px;
  }
  header,
  .toolbar,
  .filters,
  .history-tools,
  .file-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  header,
  .history-tools {
    justify-content: space-between;
  }
  header {
    gap: 16px;
    margin-bottom: 24px;
  }
  h1 {
    margin: 0;
    font-size: calc(var(--rei-font-size) + 4px);
    font-weight: 600;
    letter-spacing: -0.3px;
  }
  h2 {
    font-size: var(--rei-font-size);
    font-weight: 600;
    margin: 0;
    overflow-wrap: anywhere;
  }
  p {
    font-size: var(--rei-font-size);
    color: var(--rei-muted);
    line-height: var(--rei-line-height, 1.5);
    overflow-wrap: anywhere;
  }
  .summary,
  .source {
    margin: 4px 0 0;
  }
  .search {
    flex: 1;
    min-width: min(180px, 100%);
  }
  .search input {
    width: 100%;
  }
  .history-tools {
    margin: 14px 0;
  }
  .history-tools p {
    margin: 0;
  }
  .download-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 12px;
  }
  .download-list > li {
    content-visibility: auto;
    contain-intrinsic-size: auto 160px;
  }
  .download-entry {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    padding: calc(var(--rei-spacing, 12px) + 3px);
  }
  .download-entry :global(.file-icon) {
    flex-shrink: 0;
    margin-top: 2px;
    color: var(--rei-muted);
  }
  .file-content {
    flex: 1;
    min-width: 0;
  }
  .transfer {
    margin: 10px 0 0;
    font-variant-numeric: tabular-nums;
  }
  .transfer span {
    color: var(--rei-text);
  }
  .transfer.failed span,
  .error {
    color: var(--rei-error);
  }
  progress {
    display: block;
    appearance: none;
    width: 100%;
    height: 4px;
    margin-top: 10px;
    border: 0;
    border-radius: var(--rei-radius);
    overflow: hidden;
    background: var(--rei-border);
    accent-color: var(--rei-accent);
  }
  progress::-webkit-progress-bar {
    background: var(--rei-border);
  }
  progress::-webkit-progress-value {
    background: var(--rei-accent);
  }
  progress:indeterminate {
    opacity: 0.5;
    background: var(--rei-accent);
  }
  .file-actions {
    margin-top: 12px;
  }
  .toolbar :global(.rei-button),
  .file-actions :global(.rei-button) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 30px;
  }
  .empty {
    padding: 40px 20px;
    text-align: center;
    color: var(--rei-muted);
  }
  .empty h2 {
    margin-top: 12px;
    color: var(--rei-text);
  }
  .empty p {
    margin: 6px 0 0;
  }
  .error,
  .feedback {
    margin: 0 0 12px;
  }
  .feedback:empty {
    margin: 0;
  }
  .history-note {
    margin-top: 16px;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  @media (max-width: 520px) {
    .downloads-layout {
      padding: 24px 16px;
    }
    .filters {
      align-items: stretch;
    }
    .search {
      flex-basis: 100%;
    }
    .download-entry {
      gap: 10px;
    }
  }
</style>
