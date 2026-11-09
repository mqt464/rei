<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'
  import {
    AlertCircle,
    CircleDashed,
    Download,
    HatGlasses,
    Settings,
    Volume2,
    VolumeX,
    X
  } from '@lucide/svelte'
  import type { BrowserTab } from '../../shared/browser'
  import type { DownloadRecord } from '../../shared/downloads'
  import SiteIcon from './components/SiteIcon.svelte'
  import ExtensionsIcon from './components/ExtensionsIcon.svelte'
  import ScrollArea from './components/ScrollArea.svelte'
  import FluidHover from './components/FluidHover.svelte'
  import Morph from './components/Morph.svelte'
  import { extensions, watchExtensions } from './extensions'
  import { preferences } from './preferences'
  let tabs: BrowserTab[] = []
  let audibleTabIds = new SvelteSet<string>()
  let activeTabId = ''
  let controlHeld = false
  let draggedTabId = ''
  let tabList: HTMLDivElement
  let dropTargetTabId: string | null = null
  let dropIndicatorY = 0
  let extensionsOpen = false
  let extensionButton: HTMLButtonElement
  let extensionPanel: HTMLDivElement
  let activeWebContentsId = -1
  let downloads: DownloadRecord[] = []
  $: activeDownloads = downloads.filter((download) => download.active)
  $: downloadTotal = activeDownloads.reduce((total, download) => total + download.total, 0)
  $: downloadReceived = activeDownloads.reduce(
    (total, download) => total + Math.min(download.received, download.total),
    0
  )
  $: downloadProgress =
    activeDownloads.some((download) => download.total <= 0) || !downloadTotal
      ? null
      : Math.min(1, Math.max(0, downloadReceived / downloadTotal))
  $: downloadStatus = activeDownloads.some((download) => download.status === 'progressing')
    ? 'downloading'
    : activeDownloads.some((download) => download.status === 'interrupted')
      ? 'interrupted'
      : 'paused'
  $: downloadLabel = activeDownloads.length
    ? `Downloads, ${activeDownloads.length} active, ${downloadStatus}${downloadProgress === null ? ', size unknown' : `, ${Math.round(downloadProgress * 100)}%`}`
    : 'Downloads'

  async function toggleExtensions(): Promise<void> {
    extensionsOpen = !extensionsOpen
    if (extensionsOpen) {
      await tick()
      extensionPanel.focus()
    }
  }

  function setTabDragImage(event: DragEvent, row: HTMLDivElement): void {
    if (!event.dataTransfer) return
    const bounds = row.getBoundingClientRect()
    const preview = row.cloneNode(true) as HTMLDivElement
    preview.classList.remove('dragging')
    preview.classList.add('tab-drag-preview')
    preview.style.width = bounds.width + 'px'
    preview.setAttribute('aria-hidden', 'true')
    row.parentElement?.appendChild(preview)
    event.dataTransfer.setDragImage(
      preview,
      event.clientX - bounds.left,
      event.clientY - bounds.top
    )
    requestAnimationFrame(() => preview.remove())
  }

  function updateDropTarget(event: DragEvent): void {
    if (!draggedTabId) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    const target = [...tabList.querySelectorAll<HTMLElement>('.vertical-tab')].find(
      (row) => event.clientY < row.getBoundingClientRect().bottom
    )
    dropTargetTabId = target?.dataset.tabId ?? ''
    dropIndicatorY = target
      ? target.getBoundingClientRect().top - tabList.getBoundingClientRect().top
      : tabList.scrollHeight - 1
  }

  function resetDrag(): void {
    draggedTabId = ''
    dropTargetTabId = null
  }
  onMount(() => {
    const audioHideTimers = new SvelteMap<string, ReturnType<typeof setTimeout>>()
    let mounted = true
    let downloadsChanged = false
    const unsubscribeDownloads = window.api.onDownloads((value) => {
      downloadsChanged = true
      downloads = value
    })
    void window.api
      .getDownloads()
      .then((value) => {
        if (mounted && !downloadsChanged) downloads = value
      })
      .catch(() => {})
    const unwatch = watchExtensions()
    const unfocus = window.api.onPageFocus(() => {
      extensionsOpen = false
    })
    const unsubscribe = window.api.onState((state) => {
      if (activeTabId !== state.activeTabId) extensionsOpen = false
      const openTabIds = new Set(state.tabs.map((tab) => tab.id))
      for (const id of audibleTabIds) {
        if (!openTabIds.has(id)) audibleTabIds.delete(id)
      }
      for (const [id, timer] of audioHideTimers) {
        if (!openTabIds.has(id)) {
          clearTimeout(timer)
          audioHideTimers.delete(id)
        }
      }
      for (const tab of state.tabs) {
        if (tab.audible) {
          clearTimeout(audioHideTimers.get(tab.id))
          audioHideTimers.delete(tab.id)
          audibleTabIds.add(tab.id)
        } else if (audibleTabIds.has(tab.id) && !audioHideTimers.has(tab.id)) {
          audioHideTimers.set(
            tab.id,
            setTimeout(() => {
              audioHideTimers.delete(tab.id)
              audibleTabIds.delete(tab.id)
              audibleTabIds = new SvelteSet(audibleTabIds)
            }, 1000)
          )
        }
      }
      tabs = state.tabs
      activeTabId = state.activeTabId
      controlHeld = state.controlHeld
      activeWebContentsId = state.activeWebContentsId ?? -1
    })
    return () => {
      for (const timer of audioHideTimers.values()) clearTimeout(timer)
      mounted = false
      unsubscribeDownloads()
      unsubscribe()
      unwatch()
      unfocus()
    }
  })
</script>

<svelte:window
  on:keydown={(event) => {
    if (event.key === 'Escape' && extensionsOpen) {
      event.preventDefault()
      extensionsOpen = false
      extensionButton.focus()
    }
  }}
  on:pointerdown={(event) => {
    const target = event.composedPath()
    if (extensionsOpen && !target.includes(extensionPanel) && !target.includes(extensionButton))
      extensionsOpen = false
  }}
/>

<aside
  class="tab-sidebar"
  aria-label="Browser tabs"
  on:dragover={updateDropTarget}
  on:dragleave={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) dropTargetTabId = null
  }}
  on:drop={(event) => {
    if (!draggedTabId) return
    updateDropTarget(event)
    if (dropTargetTabId !== null) window.api.reorderTab(draggedTabId, dropTargetTabId)
    resetDrag()
  }}
>
  <ScrollArea className="vertical-tabs" background="var(--rei-sidebar)">
    <FluidHover>
      <div
        bind:this={tabList}
        class="tab-list"
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
        <div
          class="tab-drop-indicator"
          class:visible={dropTargetTabId !== null}
          style:transform={'translateY(' + dropIndicatorY + 'px)'}
          aria-hidden="true"
        ></div>
        {#each tabs as tab, index (tab.id)}
          <div
            class="vertical-tab"
            role="presentation"
            data-tab-id={tab.id}
            data-fluid-hover
            data-fluid-selected={activeTabId === tab.id ? '' : undefined}
            class:active={activeTabId === tab.id}
            class:sleeping={tab.sleeping}
            class:discarded={tab.discarded}
            class:dragging={draggedTabId === tab.id}
            class:show-shortcut={controlHeld &&
              index < 9 &&
              !!$preferences.keybindings[`tab${index + 1}`]?.length}
            draggable="true"
            on:dragstart={(event) => {
              setTabDragImage(event, event.currentTarget)
              draggedTabId = tab.id
              dropIndicatorY =
                event.currentTarget.getBoundingClientRect().top -
                tabList.getBoundingClientRect().top
              event.dataTransfer?.setData('text/plain', tab.id)
              if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
            }}
            on:dragend={resetDrag}
          >
            <button
              id={`tab-${tab.id}`}
              class="tab-select"
              role="tab"
              aria-selected={activeTabId === tab.id}
              tabindex={activeTabId === tab.id ? 0 : -1}
              type="button"
              aria-label={(tab.incognito ? 'Incognito, ' : '') +
                (tab.error
                  ? `${tab.title}, error: ${tab.error}`
                  : tab.loading
                    ? `${tab.title}, loading`
                    : `${tab.title}${tab.discarded ? ', discarded; reloads on selection' : tab.sleeping ? ', sleeping' : ''}`)}
              title={tab.discarded
                ? `${tab.title} (discarded; reloads on selection)`
                : tab.sleeping
                  ? `${tab.title} (sleeping)`
                  : tab.error || tab.url || tab.title}
              on:click={() => window.api.switchTab(tab.id)}
            >
              {#if tab.loading}
                <span class="tab-loading" aria-label="Loading"></span>
              {:else if tab.error}
                <AlertCircle class="tab-error-icon" size={15} aria-label="Tab error" />
              {:else if tab.discarded}
                <CircleDashed size={15} aria-hidden="true" />
              {:else if tab.incognito}
                <HatGlasses size={15} aria-label="Incognito tab" />
              {:else}
                <SiteIcon src={tab.favicon} url={tab.url} />
              {/if}
              {#if audibleTabIds.has(tab.id)}
                <span class="tab-audio-space" aria-hidden="true"></span>
              {/if}
              <span class="tab-title" class:error={!!tab.error}
                ><Morph text={tab.title} preset="title" /></span
              >
              {#if tab.incognito && (tab.loading || tab.error || tab.discarded)}
                <HatGlasses size={13} aria-label="Incognito tab" />
              {/if}
            </button>
            {#if audibleTabIds.has(tab.id)}
              <button
                class="tab-audio"
                aria-label={tab.muted ? `Unmute ${tab.title}` : `Mute ${tab.title}`}
                title={tab.muted ? 'Unmute tab' : 'Mute tab'}
                type="button"
                on:click={() => window.api.toggleMute(tab.id)}
              >
                {#if tab.muted}<VolumeX size={15} />{:else}<Volume2 size={15} />{/if}
              </button>
            {/if}
            <button
              class="tab-close"
              aria-label={`Close ${tab.title}`}
              title="Close tab"
              type="button"
              on:click={() => window.api.closeTab(tab.id)}><X size={13} /></button
            >
            {#if controlHeld && index < 9 && $preferences.keybindings[`tab${index + 1}`]?.length}
              <span
                class="tab-shortcut"
                aria-hidden="true"
                title={$preferences.keybindings[`tab${index + 1}`].join(' then ')}
              >
                {$preferences.keybindings[`tab${index + 1}`]
                  .map((stroke) =>
                    stroke
                      .replace('Mod+', navigator.platform.includes('Mac') ? 'Meta+' : 'Ctrl+')
                      .replaceAll('+', ' + ')
                      .toLowerCase()
                  )
                  .join(' then ')}
              </span>
            {/if}
          </div>
        {/each}
      </div>
    </FluidHover>
  </ScrollArea>
  <div class="sidebar-footer">
    <button
      class="sidebar-settings"
      type="button"
      aria-label="Settings"
      title="Settings"
      on:click={() => window.api.openSettings()}
    >
      <Settings size={15} aria-hidden="true" />
    </button>
    <button
      class="sidebar-settings sidebar-downloads"
      class:has-downloads={activeDownloads.length > 0}
      class:downloads-stopped={downloadStatus !== 'downloading'}
      type="button"
      aria-label={downloadLabel}
      title={downloadLabel}
      on:click={() => window.api.openDownloads()}
    >
      <Download size={15} aria-hidden="true" />
      {#if activeDownloads.length}
        <span class="download-badge" aria-hidden="true"
          >{activeDownloads.length > 99 ? '99+' : activeDownloads.length}</span
        >
        <span
          class="download-progress"
          class:indeterminate={downloadProgress === null}
          aria-hidden="true"
          data-progress={downloadProgress}
        >
          <span
            class="download-progress-fill"
            style:transform={downloadProgress === null ? undefined : `scaleX(${downloadProgress})`}
          ></span>
        </span>
      {/if}
    </button>
    <button
      bind:this={extensionButton}
      class="sidebar-settings sidebar-extensions"
      disabled={!!tabs.find((tab) => tab.id === activeTabId)?.incognito}
      type="button"
      aria-label={$extensions?.error || $extensions?.extensions.some((extension) => extension.error)
        ? 'Extensions: attention required'
        : 'Extensions'}
      title={$extensions?.error || $extensions?.extensions.some((extension) => extension.error)
        ? 'An extension could not start. Open Settings > Extensions for details.'
        : 'Extensions'}
      aria-expanded={extensionsOpen}
      aria-haspopup="dialog"
      aria-controls="extensions-panel"
      on:click={toggleExtensions}
    >
      <ExtensionsIcon size={15} />
      {#if $extensions?.error || $extensions?.extensions.some((extension) => extension.error)}
        <span class="extension-warning" aria-hidden="true"></span>
      {/if}
    </button>
    {#if extensionsOpen}
      <div
        bind:this={extensionPanel}
        id="extensions-panel"
        class="extensions-panel"
        role="dialog"
        aria-labelledby="extensions-heading"
        tabindex="-1"
      >
        <h2 id="extensions-heading">Extensions</h2>
        {#if $extensions?.extensions.some((extension) => extension.enabled)}
          <browser-action-list
            partition="rei-browsing"
            tab={activeWebContentsId}
            alignment="top left"
          ></browser-action-list>
        {:else}
          <p>
            {$extensions?.error
              ? 'Extensions unavailable.'
              : !$extensions
                ? 'Loading extensions…'
                : 'No enabled extensions.'}
          </p>
        {/if}
      </div>
    {/if}
  </div>
</aside>

<style>
  .sidebar-downloads {
    position: relative;
  }
  .sidebar-downloads.has-downloads {
    color: var(--rei-accent);
  }
  .download-badge {
    position: absolute;
    top: -3px;
    right: -3px;
    display: grid;
    place-items: center;
    min-width: 15px;
    height: 15px;
    padding: 0 2px;
    border: 2px solid var(--rei-sidebar);
    border-radius: 999px;
    background: var(--rei-accent);
    color: var(--rei-accent-text);
    font-size: 9px;
    font-weight: 600;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
  .download-progress {
    position: absolute;
    right: 6px;
    bottom: 3px;
    left: 6px;
    height: 2px;
    border-radius: 999px;
    overflow: hidden;
    background: var(--rei-border);
    pointer-events: none;
  }
  .download-progress-fill {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: inherit;
    background: var(--rei-accent);
    transform-origin: left;
    transition: transform var(--rei-duration-medium) linear;
  }
  .indeterminate .download-progress-fill {
    width: 40%;
    transform: translateX(75%);
    animation: download-sweep calc(var(--rei-duration-slow) * 5) ease-in-out infinite;
  }
  .downloads-stopped .download-progress-fill {
    background: var(--rei-muted);
    animation: none;
  }
  @keyframes download-sweep {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(250%);
    }
  }
  :global(:root[data-motion='reduced']) .indeterminate .download-progress-fill,
  :global(:root[data-motion='none']) .indeterminate .download-progress-fill {
    animation: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .indeterminate .download-progress-fill {
      animation: none;
    }
    .download-progress-fill {
      transition: none;
    }
  }
  .sidebar-extensions {
    position: relative;
  }
  .extension-warning {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--rei-error);
  }
  .sidebar-footer {
    position: relative;
    display: flex;
    gap: 4px;
    -webkit-app-region: no-drag;
  }
  .extensions-panel {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 0;
    right: 0;
    z-index: 2;
    padding: 12px;
    border: 1px solid var(--rei-border);
    border-radius: var(--rei-radius);
    background: var(--rei-surface);
    color: var(--rei-text);
    box-shadow: 0 6px 20px #0002;
  }
  h2 {
    margin: 0 0 12px;
    font-size: inherit;
    font-weight: 600;
  }
  p {
    margin: 10px 0;
    color: var(--rei-muted);
    font-size: calc(var(--rei-font-size) - 1px);
    overflow-wrap: anywhere;
  }
  browser-action-list {
    flex-wrap: wrap;
    --browser-action-hover-bg: var(--rei-hover);
  }
  browser-action-list::part(action) {
    cursor: pointer;
    width: 32px;
    height: 32px;
  }
  browser-action-list::part(action):focus-visible {
    outline: 2px solid var(--rei-accent);
    outline-offset: 2px;
  }
  .sidebar-extensions:focus-visible {
    outline: 2px solid var(--rei-accent);
    outline-offset: 2px;
  }
</style>
