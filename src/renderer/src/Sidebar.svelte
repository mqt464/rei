<script lang="ts">
  import { onMount } from 'svelte'
  import { AlertCircle, Plus, Trash2, X } from '@lucide/svelte'
  import type { BrowserTab } from '../../shared/browser'
  import SiteIcon from './components/SiteIcon.svelte'
  import ScrollArea from './components/ScrollArea.svelte'
  let tabs: BrowserTab[] = []
  let activeTabId = ''
  let controlHeld = false
  let draggedTabId = ''
  onMount(() => {
    const unsubscribe = window.api.onState((state) => {
      tabs = state.tabs
      activeTabId = state.activeTabId
      controlHeld = state.controlHeld
    })
    return unsubscribe
  })
</script>

<aside class="tab-sidebar" aria-label="Browser tabs">
  <div class="sidebar-heading"><span>rei</span><span class="tab-count">{tabs.length}</span></div>
  <button
    class="new-tab"
    type="button"
    on:click={() => window.api.newTab()}
    title="New tab (Ctrl+T)"><Plus size={16} />New tab</button
  >
  <ScrollArea className="vertical-tabs" background="#141416">
    <div
      role="tablist"
      tabindex="-1"
      aria-label="Open pages"
      aria-orientation="vertical"
      on:keydown={(event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
        event.preventDefault()
        if (!tabs.length) return
        const index = tabs.findIndex((tab) => tab.id === activeTabId)
        const nextIndex =
          index < 0
            ? event.key === 'ArrowDown'
              ? 0
              : tabs.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + tabs.length) % tabs.length
        const next = tabs[nextIndex]
        if (next) {
          window.api.switchTab(next.id)
          document.getElementById(`tab-${next.id}`)?.focus()
        }
      }}
    >
      {#each tabs as tab, index (tab.id)}
        <div
          class="vertical-tab"
          class:active={activeTabId === tab.id}
          class:dragging={draggedTabId === tab.id}
          class:show-shortcut={controlHeld && index < 9}
          draggable="true"
          on:dragstart={(event) => {
            draggedTabId = tab.id
            event.dataTransfer?.setData('text/plain', tab.id)
            if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
          }}
          on:dragend={() => (draggedTabId = '')}
          on:dragover={(event) => event.preventDefault()}
          on:drop={(event) => {
            event.preventDefault()
            const sourceId = event.dataTransfer?.getData('text/plain') || draggedTabId
            if (sourceId) window.api.reorderTab(sourceId, tab.id)
            draggedTabId = ''
          }}
        >
          <button
            id={`tab-${tab.id}`}
            class="tab-select"
            role="tab"
            aria-selected={activeTabId === tab.id}
            tabindex={activeTabId === tab.id ? 0 : -1}
            type="button"
            aria-label={tab.error
              ? `${tab.title}, error: ${tab.error}`
              : tab.loading
                ? `${tab.title}, loading`
                : tab.title}
            title={tab.error || tab.url || tab.title}
            on:click={() => window.api.switchTab(tab.id)}
          >
            {#if tab.loading}
              <span class="tab-loading" aria-label="Loading"></span>
            {:else if tab.error}
              <AlertCircle class="tab-error-icon" size={15} aria-label="Tab error" />
            {:else}
              <SiteIcon src={tab.favicon} url={tab.url} />
            {/if}
            <span class="tab-title" class:error={!!tab.error}>{tab.title}</span>
          </button>
          <button
            class="tab-close"
            aria-label={`Close ${tab.title}`}
            title="Close tab"
            type="button"
            on:click={() => window.api.closeTab(tab.id)}><X size={13} /></button
          >
          {#if controlHeld && index < 9}
            <span class="tab-shortcut" aria-hidden="true">ctrl + {index + 1}</span>
          {/if}
        </div>
      {/each}
    </div>
  </ScrollArea>
  <button
    class="new-tab clear-search-data"
    type="button"
    on:click={() => window.api.clearSearchData()}><Trash2 size={14} />Clear search data</button
  >
</aside>
