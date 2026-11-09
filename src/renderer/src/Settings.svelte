<script lang="ts">
  import { onMount } from 'svelte'
  import {
    Download,
    RefreshCw,
    History,
    Terminal,
    Gauge,
    Globe,
    Image,
    Keyboard,
    Palette,
    Search,
    Shield,
    TextCursor,
    Zap
  } from '@lucide/svelte'
  import ThemeEditor from './ThemeEditor.svelte'
  import Morph from './components/Morph.svelte'
  import SiteSearchSettings from './SiteSearchSettings.svelte'
  import BrowserSettings from './BrowserSettings.svelte'
  import PerformanceSettings from './PerformanceSettings.svelte'
  import UpdateSettings from './UpdateSettings.svelte'
  import ExtensionsSettings from './ExtensionsSettings.svelte'
  import ExtensionsIcon from './components/ExtensionsIcon.svelte'
  import KeybindSettings from './KeybindSettings.svelte'
  import CommandsSettings from './CommandsSettings.svelte'
  import HistorySettings from './HistorySettings.svelte'
  import FluidHover from './components/FluidHover.svelte'
  import ScrollArea from './components/ScrollArea.svelte'
  import { Button, Card, SettingRow, Switch } from './components/ui'
  import { settingsPages } from '../../shared/navigation'
  import { preferenceError } from './preferences'
  import { theme } from './theme'
  import type { SearchShortcut } from '../../shared/search'

  export let url: string
  export let persistentTopbar = false
  export let suggestionsEnabled: boolean
  export let shortcuts: SearchShortcut[]
  export let shortcutError: string
  const icons = {
    appearance: Palette,
    wallpaper: Image,
    caret: TextCursor,
    motion: Zap,
    browser: Globe,
    performance: Gauge,
    search: Search,
    shortcuts: Keyboard,
    keybinds: Keyboard,
    commands: Terminal,
    downloads: Download,
    history: History,
    extensions: ExtensionsIcon,
    privacy: Shield,
    updates: RefreshCw
  }
  let page: HTMLElement
  let clearing = false
  let clearStatus = ''
  let clearError = ''
  $: selectedPage = settingsPages.find((entry) => entry.url === url) ?? settingsPages[0]
  onMount(() => page.focus({ preventScroll: true }))

  function handleNavigationKey(event: KeyboardEvent): void {
    const index = settingsPages.indexOf(selectedPage)
    let nextIndex: number
    if (event.key === 'ArrowDown') nextIndex = (index + 1) % settingsPages.length
    else if (event.key === 'ArrowUp')
      nextIndex = (index - 1 + settingsPages.length) % settingsPages.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = settingsPages.length - 1
    else return
    event.preventDefault()
    window.api.navigate(settingsPages[nextIndex].url)
    document.getElementById(`settings-tab-${settingsPages[nextIndex].id}`)?.focus()
  }
  function toggleSuggestions(): void {
    try {
      localStorage.setItem('rei:suggestions', suggestionsEnabled ? 'off' : 'on')
      suggestionsEnabled = !suggestionsEnabled
      preferenceError.set('')
    } catch {
      preferenceError.set('Could not save this setting. Check available disk space and try again.')
    }
  }
  async function clearData(): Promise<void> {
    clearing = true
    clearStatus = ''
    clearError = ''
    try {
      if (await window.api.clearSearchData()) clearStatus = 'Search data cleared.'
    } catch {
      clearError = 'Could not clear search data. Try again.'
    } finally {
      clearing = false
    }
  }
</script>

<main
  bind:this={page}
  class="settings-page"
  style:top={persistentTopbar ? `${$theme.addressBarHeight}px` : '0px'}
  tabindex="-1"
  aria-label="Settings"
>
  <ScrollArea className="settings-scroll" background="var(--rei-background)">
    <div class="settings-layout">
      <nav class="settings-sidebar" aria-label="Settings pages">
        <FluidHover>
          <div
            role="tablist"
            tabindex="-1"
            aria-label="Settings pages"
            aria-orientation="vertical"
            on:keydown={handleNavigationKey}
          >
            {#each settingsPages as entry (entry.id)}
              <button
                id={`settings-tab-${entry.id}`}
                type="button"
                data-fluid-hover
                data-fluid-selected={selectedPage.id === entry.id ? '' : undefined}
                role="tab"
                aria-selected={selectedPage.id === entry.id}
                aria-controls={`settings-panel-${entry.id}`}
                tabindex={selectedPage.id === entry.id ? 0 : -1}
                on:click={() => window.api.navigate(entry.url)}
                ><svelte:component
                  this={icons[entry.id]}
                  size={15}
                  aria-hidden="true"
                />{entry.title}</button
              >
            {/each}
          </div>
        </FluidHover>
      </nav>
      <div class="settings-content">
        {#each settingsPages as entry (entry.id)}
          <div
            class="settings-panel"
            id={`settings-panel-${entry.id}`}
            role="tabpanel"
            aria-labelledby={`settings-tab-${entry.id}`}
            tabindex="0"
            hidden={selectedPage.id !== entry.id}
          >
            <h1>{entry.title}</h1>
            {#if selectedPage.id === entry.id}
              {#if entry.id === 'appearance' || entry.id === 'wallpaper' || entry.id === 'caret' || entry.id === 'motion'}
                <ThemeEditor mode={entry.id} />
              {:else if entry.id === 'browser' || entry.id === 'downloads'}
                <BrowserSettings mode={entry.id} />
              {:else if entry.id === 'performance'}
                <PerformanceSettings />
              {:else if entry.id === 'updates'}
                <UpdateSettings />
              {:else if entry.id === 'extensions'}
                <ExtensionsSettings />
              {:else if entry.id === 'keybinds'}
                <KeybindSettings />
              {:else if entry.id === 'commands'}
                <CommandsSettings />
              {:else if entry.id === 'history'}
                <HistorySettings />
              {:else if entry.id === 'search'}
                <BrowserSettings mode="search" />
                <Card
                  ><SettingRow
                    title="Online search suggestions"
                    description="Send typed text to Google for suggestions."
                    control="online-suggestions"
                    ><Switch
                      id="online-suggestions"
                      label="Online search suggestions"
                      checked={suggestionsEnabled}
                      on:change={toggleSuggestions}
                    /></SettingRow
                  ></Card
                >
              {:else if entry.id === 'shortcuts'}
                <SiteSearchSettings sites={shortcuts} error={shortcutError} />
              {:else}
                <BrowserSettings mode="privacy" />
                <Card
                  ><SettingRow title="Clear history and search data"
                    ><Button id="clear-search-data" busy={clearing} on:click={clearData}
                      ><Morph
                        text={clearing ? 'Clearing\u2026' : 'Clear data\u2026'}
                        preset="action"
                      /></Button
                    ></SettingRow
                  ></Card
                >
                <p class="feedback" class:empty={!clearStatus} role="status">
                  <Morph text={clearStatus} preset="action" />
                </p>
                {#if clearError}<p class="error" role="alert">{clearError}</p>{/if}
              {/if}
            {/if}
          </div>
        {/each}
        {#if $preferenceError}<p class="error" role="alert">{$preferenceError}</p>{/if}
      </div>
    </div>
  </ScrollArea>
</main>

<style>
  .settings-page {
    position: absolute;
    inset: 0;
    color: var(--rei-text);
    background: var(--rei-background);
    outline: none;
  }
  .settings-page :global(.settings-scroll) {
    height: 100%;
  }
  .settings-page :global(.settings-scroll > .scroll-area) {
    scrollbar-gutter: stable both-edges;
  }
  .settings-layout {
    display: grid;
    grid-template-columns: minmax(144px, 1fr) minmax(0, 680px) minmax(144px, 1fr);
    align-content: start;
    align-items: start;
    column-gap: 24px;
    padding: 32px 0;
  }
  .settings-sidebar {
    position: sticky;
    top: 32px;
    justify-self: end;
    width: 144px;
  }
  [role='tablist'] {
    display: grid;
    gap: 3px;
  }
  [role='tab'] {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    padding: 6px 9px;
    border: 0;
    border-radius: calc(var(--rei-radius) * 0.6);
    color: var(--rei-muted);
    background: transparent;
    text-align: left;
    font: var(--rei-font-weight, 400) var(--rei-font-size)/var(--rei-line-height, 1.5)
      var(--rei-font);
    overflow-wrap: anywhere;
    cursor: pointer;
    transition:
      color var(--rei-duration-fast) ease,
      background-color var(--rei-duration-fast) ease;
  }
  [role='tab']:hover {
    color: var(--rei-text);
  }
  [role='tab'][aria-selected='true'] {
    color: var(--rei-accent);
  }
  [role='tab']:focus-visible,
  .settings-panel:focus-visible {
    outline: 2px solid var(--rei-focus);
    outline-offset: 3px;
  }
  [role='tab'] :global(svg) {
    flex-shrink: 0;
  }
  .settings-content {
    min-width: 0;
  }
  .settings-panel {
    width: 100%;
  }
  .settings-panel[hidden] {
    display: none;
  }
  .settings-panel:not([hidden]) {
    animation: arrive var(--rei-duration-fast) ease-out;
  }
  h1 {
    margin-bottom: 16px;
    font-size: calc(var(--rei-font-size) + 4px);
    font-weight: 600;
    line-height: 1.3;
    letter-spacing: -0.3px;
  }
  .feedback,
  .error {
    margin-top: 12px;
    font-size: var(--rei-font-size);
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .feedback {
    color: var(--rei-muted);
  }
  .feedback.empty {
    margin: 0;
  }
  .error {
    color: var(--rei-error);
  }
  @keyframes arrive {
    from {
      opacity: 0.6;
    }
    to {
      opacity: 1;
    }
  }
  @media (max-width: 1064px) {
    .settings-layout {
      grid-template-columns: 128px minmax(0, 680px);
      justify-content: center;
      padding: 24px;
    }
    .settings-sidebar {
      width: 128px;
      top: 24px;
    }
  }
  @media (max-width: 520px) {
    .settings-layout {
      grid-template-columns: 104px minmax(0, 1fr);
      gap: 12px;
      padding: 16px 10px;
    }
    .settings-sidebar {
      width: 104px;
      top: 16px;
    }
    [role='tab'] {
      gap: 6px;
      padding: 6px;
    }
  }
  @media (forced-colors: active) {
    [role='tab'][aria-selected='true'] {
      outline: 1px solid Highlight;
      outline-offset: -1px;
    }
  }
</style>
