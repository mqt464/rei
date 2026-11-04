<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import { Ellipsis, Search, Trash2 } from '@lucide/svelte'
  import { Button, Card, Select, SettingRow, Switch } from './components/ui'
  import SiteIcon from './components/SiteIcon.svelte'
  import { preferences, updatePreferences } from './preferences'
  import { historyPageSize } from '../../shared/history'
  import type { HistoryPage, HistoryRemoval, HistoryVisit } from '../../shared/history'

  const ranges = [
    { value: 'all', label: 'All time' },
    { value: 'hour', label: 'Last hour' },
    { value: 'day', label: 'Last 24 hours' },
    { value: 'week', label: 'Last 7 days' },
    { value: 'month', label: 'Last 4 weeks' }
  ]
  const durations = { hour: 3600000, day: 86400000, week: 7 * 86400000, month: 28 * 86400000 }
  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'full' })
  const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
  let result: HistoryPage = { visits: [], total: 0 }
  let query = ''
  let range = 'all'
  let clearRange = 'all'
  let from = ''
  let until = ''
  let host = ''
  let offset = 0
  let selected = new Set<number>()
  let anchor: number | undefined
  let loading = true
  let busy = false
  let error = ''
  let status = ''
  let ready = false
  let request = 0
  let timer: ReturnType<typeof setTimeout>
  let page: HTMLElement
  let searchInput: HTMLInputElement

  $: schedule(query, range, from, until, host, offset)
  $: groups = result.visits.reduce<{ label: string; visits: HistoryVisit[] }[]>((days, visit) => {
    const label = dayLabel(visit.visitedAt)
    if (days[days.length - 1]?.label !== label) days.push({ label, visits: [] })
    days[days.length - 1].visits.push(visit)
    return days
  }, [])

  onMount(() => {
    ready = true
    void tick().then(() => {
      if (ready) searchInput.focus({ preventScroll: true })
    })
    schedule(query, range, from, until, host, offset)
    return window.api.onHistory(() => {
      offset = 0
      schedule(query, range, from, until, host, 0)
    })
  })
  onDestroy(() => {
    ready = false
    request += 1
    clearTimeout(timer)
  })

  function dayLabel(timestamp: number): string {
    const date = new Date(timestamp)
    const today = new Date()
    if (date.toDateString() === today.toDateString()) return 'Today'
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
    return dateFormat.format(date)
  }

  function startFor(value: string): number {
    return value in durations ? Date.now() - durations[value as keyof typeof durations] : 0
  }

  function schedule(
    text: string,
    period: string,
    after: string,
    before: string,
    site: string,
    skip: number
  ): void {
    if (!ready) return
    clearTimeout(timer)
    const version = ++request
    loading = true
    timer = setTimeout(async () => {
      error = ''
      try {
        const start =
          period === 'custom'
            ? after
              ? new Date(`${after}T00:00:00`).getTime()
              : 0
            : startFor(period)
        const endDate = before ? new Date(`${before}T00:00:00`) : undefined
        const end =
          period === 'custom' && endDate
            ? new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() + 1).getTime()
            : Date.now() + 1
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
          throw new Error('Choose a valid date range.')
        const page = await window.api.getHistory({
          query: text,
          start,
          end,
          host: site,
          offset: skip
        })
        if (version !== request) return
        result = page
        selected = new Set(
          [...selected].filter((id) => page.visits.some((visit) => visit.id === id))
        )
      } catch (failure) {
        if (version === request) {
          result = { visits: [], total: 0 }
          selected = new Set()
          error =
            failure instanceof Error && failure.message === 'Choose a valid date range.'
              ? failure.message
              : 'Could not load history. Try again.'
        }
      } finally {
        if (version === request) loading = false
      }
    }, 180)
  }

  function resetPage(): void {
    offset = 0
    selected = new Set()
    anchor = undefined
    status = ''
  }

  function selectVisit(event: MouseEvent, id: number): void {
    const next = new SvelteSet(selected)
    const checked = (event.currentTarget as HTMLInputElement).checked
    const first = result.visits.findIndex((visit) => visit.id === anchor)
    const last = result.visits.findIndex((visit) => visit.id === id)
    const visits =
      event.shiftKey && first >= 0
        ? result.visits.slice(Math.min(first, last), Math.max(first, last) + 1)
        : result.visits.filter((visit) => visit.id === id)
    for (const visit of visits) {
      if (checked) next.add(visit.id)
      else next.delete(visit.id)
    }
    anchor = id
    selected = next
  }

  async function remove(removal: HistoryRemoval): Promise<void> {
    busy = true
    error = ''
    status = ''
    try {
      if (await window.api.removeHistory(removal)) {
        selected = new Set()
        schedule(query, range, from, until, host, offset)
      }
    } catch {
      error = 'Could not delete history. Try again.'
    } finally {
      busy = false
    }
  }

  async function openVisit(event: MouseEvent, visit: HistoryVisit): Promise<void> {
    event.preventDefault()
    if (event.button === 2 || busy || loading) return
    if (event.ctrlKey || event.metaKey || event.button === 1)
      await open(visit.id, event.shiftKey ? 'tab' : 'background')
    else window.api.navigate(visit.url)
  }

  async function open(id: number, target: 'tab' | 'background' | 'incognito'): Promise<void> {
    try {
      await window.api.openHistoryVisit(id, target)
    } catch {
      error = 'Could not open visit. Try again.'
    }
  }

  async function copy(id: number): Promise<void> {
    try {
      await window.api.copyHistoryVisit(id)
      status = 'Link copied.'
    } catch {
      error = 'Could not copy link. Try again.'
    }
  }

  function handleKey(event: KeyboardEvent): void {
    if (
      !page.contains(event.target as Node) ||
      (event.target instanceof HTMLInputElement && event.target.type !== 'checkbox') ||
      event.target instanceof HTMLTextAreaElement
    )
      return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && !busy && !loading) {
      event.preventDefault()
      selected = new Set(result.visits.map((visit) => visit.id))
    } else if (event.key === 'Escape') {
      selected = new Set()
      document.querySelectorAll<HTMLDetailsElement>('.visit-menu[open]').forEach((menu) => {
        menu.open = false
      })
    } else if (event.key === 'Delete' && selected.size && !busy && !loading) {
      event.preventDefault()
      void remove({ ids: [...selected] })
    }
  }

  function closeMenus(event: MouseEvent): void {
    page.querySelectorAll<HTMLDetailsElement>('.visit-menu[open]').forEach((menu) => {
      const target = event.target as HTMLElement
      if (!menu.contains(target) || target.closest('button')) menu.open = false
    })
  }
</script>

<svelte:window on:keydown={handleKey} on:click={closeMenus} />

<section bind:this={page} aria-label="Browsing history">
  <Card>
    <SettingRow title="Save browsing history" control="history-enabled">
      <Switch
        id="history-enabled"
        label="Save browsing history"
        checked={$preferences.historyEnabled}
        on:change={() => updatePreferences({ historyEnabled: !$preferences.historyEnabled })}
      />
    </SettingRow>
    <SettingRow title="Clear browsing history">
      <div class="clear-controls">
        <Select
          id="history-clear-range"
          label="Time range to clear"
          bind:value={clearRange}
          options={ranges}
        />
        <Button {busy} on:click={() => remove({ start: startFor(clearRange), end: Date.now() + 1 })}
          >Clear history&#8230;</Button
        >
      </div>
    </SettingRow>
  </Card>

  <div class="history-tools">
    <div class="history-search">
      <Search size={15} aria-hidden="true" />
      <input
        class="rei-control"
        id="history-search"
        bind:this={searchInput}
        name="history-search"
        type="search"
        aria-label="Search history"
        placeholder="Search history&#8230;"
        autocomplete="off"
        spellcheck={false}
        maxlength="512"
        bind:value={query}
        on:input={resetPage}
      />
    </div>
    <Select
      id="history-range"
      label="Filter history by time"
      bind:value={range}
      options={[...ranges, { value: 'custom', label: 'Date range' }]}
      on:change={resetPage}
    />
  </div>
  {#if range === 'custom'}
    <div class="date-range">
      <label
        >From <input
          class="rei-control"
          name="history-from"
          type="date"
          bind:value={from}
          on:input={resetPage}
        /></label
      >
      <label
        >To <input
          class="rei-control"
          name="history-until"
          type="date"
          bind:value={until}
          on:input={resetPage}
        /></label
      >
    </div>
  {/if}
  {#if host}
    <div class="site-filter">
      <span>{host}</span><Button
        on:click={() => {
          host = ''
          resetPage()
        }}>Show all sites</Button
      >
    </div>
  {/if}

  {#if selected.size}
    <div class="selection-bar">
      <span>{selected.size} selected</span>
      <Button
        disabled={busy || loading}
        on:click={async () => {
          for (const id of selected) await open(id, 'background')
        }}>Open in tabs</Button
      >
      <Button disabled={busy || loading} on:click={() => remove({ ids: [...selected] })}
        >Delete selected</Button
      >
    </div>
  {/if}
  {#if loading}<p role="status">Loading&#8230;</p>{/if}

  {#if error}<p class="history-error" role="alert">
      {error}
      <Button on:click={() => schedule(query, range, from, until, host, offset)}>Retry</Button>
    </p>{/if}
  {#if !error && !result.visits.length && !loading}
    <div class="empty-state">
      <Card
        ><p class="empty-history">
          {query || host || range !== 'all' ? 'No matching visits.' : 'No history yet.'}
        </p></Card
      >
    </div>
  {/if}
  <div aria-busy={loading || busy}>
    {#each groups as group (group.label)}
      <h2>{group.label}</h2>
      <Card>
        {#each group.visits as visit (visit.id)}
          <div class="history-visit" class:selected={selected.has(visit.id)}>
            <input
              class="visit-check"
              name={`history-visit-${visit.id}`}
              type="checkbox"
              aria-label={`Select ${visit.title || visit.url}`}
              checked={selected.has(visit.id)}
              disabled={busy || loading}
              on:click={(event) => selectVisit(event, visit.id)}
            />
            <time
              datetime={new Date(visit.visitedAt).toISOString()}
              title={dateFormat.format(visit.visitedAt)}>{timeFormat.format(visit.visitedAt)}</time
            >
            <SiteIcon src={visit.favicon ?? undefined} />
            <a
              class="visit-link"
              href={visit.url}
              title={visit.url}
              on:click={(event) => openVisit(event, visit)}
              on:auxclick={(event) => openVisit(event, visit)}
            >
              <span class="visit-title">{visit.title || visit.url}</span><span class="visit-url"
                >{visit.url}</span
              >
            </a>
            <details class="visit-menu">
              <summary aria-label={`Actions for ${visit.title || visit.url}`} title="More actions"
                ><Ellipsis size={16} aria-hidden="true" /></summary
              >
              <div class="visit-actions">
                <Button disabled={busy || loading} on:click={() => open(visit.id, 'tab')}
                  >Open in new tab</Button
                >
                <Button disabled={busy || loading} on:click={() => open(visit.id, 'incognito')}
                  >Open incognito</Button
                >
                <Button on:click={() => copy(visit.id)}>Copy link</Button>
                <Button disabled={busy || loading} on:click={() => remove({ ids: [visit.id] })}
                  >Delete visit</Button
                >
                <Button
                  on:click={() => {
                    host = new URL(visit.url).host
                    resetPage()
                  }}>More from this site</Button
                >
              </div>
            </details>
            <button
              class="icon-button"
              type="button"
              aria-label={`Delete visit to ${visit.title || visit.url}`}
              title="Delete visit"
              disabled={busy || loading}
              on:click={() => remove({ ids: [visit.id] })}
              ><Trash2 size={14} aria-hidden="true" /></button
            >
          </div>
        {/each}
      </Card>
    {/each}
  </div>

  {#if result.total > historyPageSize}
    <nav class="history-pagination" aria-label="History pages">
      <Button
        disabled={busy || loading || offset === 0}
        on:click={() => {
          offset = Math.max(0, offset - historyPageSize)
          selected = new Set()
        }}>Previous</Button
      >
      <span
        >{Math.floor(offset / historyPageSize) + 1} / {Math.ceil(
          result.total / historyPageSize
        )}</span
      >
      <Button
        disabled={busy || loading || offset + historyPageSize >= result.total}
        on:click={() => {
          offset += historyPageSize
          selected = new Set()
        }}>Next</Button
      >
    </nav>
  {/if}
  {#if status}<p class="history-status" role="status">{status}</p>{/if}
</section>

<style>
  section {
    container-type: inline-size;
    font: var(--rei-font-weight, 400) var(--rei-font-size)/var(--rei-line-height, 1.5)
      var(--rei-font);
  }
  .history-tools,
  .date-range,
  .site-filter,
  .selection-bar,
  .clear-controls,
  .history-pagination {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    min-width: 0;
  }
  .history-tools {
    margin-top: 16px;
  }
  .history-search {
    position: relative;
    flex: 1;
    min-width: 140px;
  }
  .history-search :global(svg) {
    position: absolute;
    left: 10px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--rei-muted);
    pointer-events: none;
  }
  .history-search input {
    width: 100%;
    padding-left: 32px;
  }
  .date-range,
  .site-filter {
    margin-top: 10px;
  }
  .date-range label {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .date-range input {
    min-width: 0;
    max-width: 100%;
  }
  .site-filter span {
    overflow-wrap: anywhere;
  }
  .selection-bar {
    margin: 14px 0;
    min-height: 32px;
  }
  input[type='checkbox'] {
    accent-color: var(--rei-accent);
    width: 15px;
    height: 15px;
    flex-shrink: 0;
    cursor: pointer;
  }
  h2 {
    font-size: var(--rei-font-size);
    font-weight: 500;
    color: var(--rei-muted);
    margin: 18px 0 8px;
  }
  .history-visit {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    min-width: 0;
    position: relative;
  }
  .history-visit + .history-visit {
    border-top: 1px solid var(--rei-border);
  }
  .history-visit.selected {
    background: var(--rei-hover);
  }
  .history-visit:focus-within {
    z-index: 1;
  }
  time {
    color: var(--rei-muted);
    font-variant-numeric: tabular-nums;
    font-size: calc(var(--rei-font-size) - 1px);
    flex-shrink: 0;
  }
  .visit-link {
    display: grid;
    min-width: 0;
    flex: 1;
    gap: 2px;
    text-decoration: none;
    color: var(--rei-text);
    border-radius: 2px;
  }
  .visit-link:hover .visit-title {
    text-decoration: underline;
  }
  .visit-title,
  .visit-url {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .visit-url {
    color: var(--rei-muted);
    font-size: calc(var(--rei-font-size) - 1px);
  }
  .icon-button,
  summary {
    display: flex;
    align-items: center;
    justify-content: center;
    border: 0;
    background: transparent;
    color: var(--rei-muted);
    width: 28px;
    min-height: 28px;
    border-radius: calc(var(--rei-radius) * 0.6);
    cursor: pointer;
  }
  .icon-button {
    flex-shrink: 0;
  }
  .icon-button:hover,
  summary:hover {
    color: var(--rei-text);
    background: var(--rei-hover);
  }
  .icon-button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  summary {
    list-style: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  .visit-menu {
    position: relative;
    flex-shrink: 0;
  }
  .visit-menu[open] {
    z-index: 2;
  }
  .visit-actions {
    position: absolute;
    right: 0;
    top: 100%;
    display: grid;
    gap: 3px;
    padding: 6px;
    width: max-content;
    max-width: min(240px, 60vw);
    background: var(--rei-background);
    border: 1px solid var(--rei-border);
    border-radius: var(--rei-radius);
    box-shadow: 0 8px 24px #0002;
  }
  .visit-actions :global(button) {
    text-align: left;
    white-space: normal;
  }
  .history-pagination {
    justify-content: center;
    margin-top: 16px;
    font-variant-numeric: tabular-nums;
  }
  .empty-state {
    margin-top: 16px;
  }
  .empty-history {
    text-align: center;
    padding: 28px 12px;
    color: var(--rei-muted);
  }
  .history-error {
    color: var(--rei-error);
    margin: 12px 0;
    overflow-wrap: anywhere;
  }
  .history-status {
    margin: 12px 0;
    color: var(--rei-muted);
  }
  :is(a, input, summary, .icon-button):focus-visible {
    outline: 2px solid var(--rei-focus);
    outline-offset: 3px;
  }
  @media (max-width: 600px) {
    .history-visit {
      gap: 7px;
      padding: 9px 8px;
      flex-wrap: wrap;
    }
  }
  @container (max-width: 400px) {
    .history-visit {
      display: grid;
      grid-template-columns: 15px 16px minmax(0, 1fr) 28px;
      column-gap: 7px;
      row-gap: 2px;
    }
    .visit-check {
      grid-column: 1;
      grid-row: 1;
    }
    .history-visit :global(.site-icon) {
      grid-column: 2;
      grid-row: 1;
    }
    .visit-link {
      grid-column: 3;
      grid-row: 1;
    }
    .visit-menu {
      grid-column: 4;
      grid-row: 1;
    }
    time {
      grid-column: 3;
      grid-row: 2;
    }
    .icon-button {
      display: none;
    }
  }
</style>
