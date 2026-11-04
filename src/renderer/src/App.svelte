<script lang="ts">
  import { theme } from './theme'
  import { afterUpdate, onMount, tick } from 'svelte'
  import { HatGlasses, SlidersHorizontal, Terminal } from '@lucide/svelte'
  import { commandResults } from '../../shared/commands'
  import type { CommandResult } from '../../shared/commands'
  import { commands, commandError, watchCommands } from './commands'
  import {
    cleanUrl,
    defaultShortcuts,
    localSearchResults,
    rankSearchResults,
    resultScore,
    searchModes,
    shortcutResult
  } from '../../shared/search'
  import type {
    SearchMode,
    SearchResponse,
    SearchResult,
    SearchShortcut
  } from '../../shared/search'
  import type { BrowserTab } from '../../shared/browser'
  import SiteIcon from './components/SiteIcon.svelte'
  import ScrollArea from './components/ScrollArea.svelte'
  import FluidHover from './components/FluidHover.svelte'
  import SettingsPage from './Settings.svelte'
  import DownloadsPage from './Downloads.svelte'
  import WebsitePermissions from './WebsitePermissions.svelte'
  import { downloadsUrl, isSettingsUrl } from '../../shared/navigation'
  import { preferences } from './preferences'
  import { searchEngines } from '../../shared/preferences'
  import { smoothText } from './smoothText'
  let pageUrl = ''
  let address = ''
  let loading = false
  let error = ''
  let addressInput: HTMLInputElement
  let addressWidth = 280
  const addressMeasure = document.createElement('canvas').getContext('2d')
  let caretFocused = false
  let suggestions: (SearchResult | CommandResult)[] = []
  let selectedMode: SearchMode = 'all'
  let resultsMode: SearchMode = 'all'
  let immediateResultIds = new Set<string>()
  let suggestionScroll: ScrollArea | undefined
  let pendingResults = false
  let resultWarning = ''
  let suggestionsOpen = false
  let suggestionsEnabled = true
  let selectedIndex = 0
  let suggestionTimer: ReturnType<typeof setTimeout> | undefined
  let requestVersion = 0
  let overlayHeight = 0
  let pointerNearAddress = false
  let tabs: BrowserTab[] = []
  let activeTabId = ''
  let activeWebContentsId = 0
  let sitePermissionsOpen = false
  let sitePermissionsButton: HTMLButtonElement
  let sitePermissionsPanel: HTMLElement
  $: siteOrigin = /^https?:\/\//i.test(pageUrl) ? new URL(pageUrl).origin : ''
  $: incognito = !!tabs.find((tab) => tab.id === activeTabId)?.incognito
  let shortcuts = defaultShortcuts
  let shortcutError = ''
  let selectionTouched = false
  let activeShortcut: SearchShortcut | undefined

  onMount(() => {
    suggestionsEnabled = localStorage.getItem('rei:suggestions') !== 'off'
    const syncSuggestions = (event: StorageEvent): void => {
      if (event.key !== 'rei:suggestions') return
      suggestionsEnabled = event.newValue !== 'off'
      closeSuggestions()
    }
    window.addEventListener('storage', syncSuggestions)
    let engine = $preferences.searchEngine
    const unsubscribePreferences = preferences.subscribe((value) => {
      if (value.searchEngine !== engine) {
        engine = value.searchEngine
        closeSuggestions()
      }
    })
    let disposed = false
    const stopCommands = watchCommands()
    const unsubscribeCommands = commands.subscribe((state) => {
      if (caretFocused && !activeShortcut && address.trim().startsWith('/'))
        updateSuggestions(undefined, state)
    })
    const unsubscribeShortcuts = window.api.onShortcuts((value) => {
      shortcuts = value
      if (activeShortcut) {
        const keyword = activeShortcut.keyword
        activeShortcut = value.find((entry) => entry.keyword === keyword)
        if (!activeShortcut) {
          address = `${keyword} ${address}`
          addressInput.value = address
        }
      }
      if (caretFocused) updateSuggestions()
      else closeSuggestions()
    })
    const unsubscribeShortcutErrors = window.api.onShortcutsError((message) => {
      shortcutError = message
    })
    void window.api
      .getShortcuts(localStorage.getItem('rei:shortcuts'))
      .then((value) => {
        if (!disposed) shortcuts = value
      })
      .catch(() => {
        if (!disposed) shortcutError = 'Could not load site-search.json.'
      })
    const unsubscribeHover = window.api.onTopbarHover((hovered) => {
      pointerNearAddress = hovered
    })
    const unsubscribe = window.api.onState((state) => {
      if (
        pageUrl !== state.url ||
        activeTabId !== state.activeTabId ||
        activeWebContentsId !== state.activeWebContentsId ||
        state.loading
      )
        sitePermissionsOpen = false
      activeWebContentsId = state.activeWebContentsId ?? 0
      pageUrl = state.url
      tabs = state.tabs
      if (activeTabId !== state.activeTabId) {
        activeTabId = state.activeTabId
        closeSuggestions()
        activeShortcut = undefined
        address = state.url
      }
      if (!caretFocused) {
        activeShortcut = undefined
        address = state.url
      }
      loading = state.loading
      error = state.error
      suggestions = suggestions.filter(
        (result) => result.kind !== 'tab' || tabs.some((tab) => tab.id === result.tabId)
      )
      selectedIndex = Math.min(selectedIndex, Math.max(0, suggestions.length - 1))
    })
    const unsubscribeSearch = window.api.onSearchUpdate((update) => {
      if (update.requestId !== requestVersion || !caretFocused || !suggestionsOpen) return
      if (!suggestions.length || (!update.pending && suggestionTimer === undefined)) {
        applyResults(update.response)
      }
      pendingResults = update.pending || suggestionTimer !== undefined
    })
    const unsubscribeData = window.api.onSearchDataCleared(() => closeSuggestions())
    const unsubscribeAddress = window.api.onFocusAddress(() => {
      addressInput.focus()
      addressInput.select()
      closeSuggestions()
    })
    const unsubscribeFocus = window.api.onPageFocus(() => {
      sitePermissionsOpen = false
      addressInput.blur()
      closeSuggestions()
    })
    return () => {
      disposed = true
      stopCommands()
      unsubscribeCommands()
      unsubscribeShortcuts()
      unsubscribeShortcutErrors()
      window.removeEventListener('storage', syncSuggestions)
      unsubscribePreferences()
      unsubscribeHover()
      unsubscribe()
      unsubscribeFocus()
      unsubscribeSearch()
      unsubscribeData()
      unsubscribeAddress()
      clearTimeout(suggestionTimer)
      void window.api.suggest('', selectedMode).catch(() => {})
    }
  })

  afterUpdate(() => {
    syncCaret()
    const style = getComputedStyle(addressInput)
    const context = addressMeasure
    if (context) {
      context.font = style.font
      const width = Math.max(
        280,
        Math.ceil(context.measureText(address || addressInput.placeholder).width + 24)
      )
      if (width !== addressWidth) addressWidth = width
    }
    updateOverlayHeight()
  })

  function updateOverlayHeight(): void {
    let height =
      caretFocused ||
      pointerNearAddress ||
      suggestionsOpen ||
      sitePermissionsOpen ||
      !$preferences.autoHideTopbar
        ? $theme.addressBarHeight
        : 0
    if (height) {
      for (const element of document.querySelectorAll(
        '.suggestion-panel, .site-permissions-panel'
      )) {
        height = Math.max(height, Math.ceil(element.getBoundingClientRect().bottom))
      }
    }
    if (height !== overlayHeight) {
      overlayHeight = height
      window.api.setOverlayHeight(height)
    }
  }

  function watchPermissionPanel(element: HTMLElement): { destroy: () => void } {
    const observer = new ResizeObserver(updateOverlayHeight)
    observer.observe(element)
    return { destroy: () => observer.disconnect() }
  }

  async function toggleSitePermissions(): Promise<void> {
    closeSuggestions()
    sitePermissionsOpen = !sitePermissionsOpen
    if (sitePermissionsOpen) {
      await tick()
      sitePermissionsPanel?.focus({ preventScroll: true })
    }
  }

  function closeSuggestions(): void {
    clearTimeout(suggestionTimer)
    suggestionTimer = undefined
    requestVersion += 1
    suggestionsOpen = false
    suggestions = []
    resultWarning = ''
    pendingResults = false
    selectedIndex = 0
    selectionTouched = false
    void window.api.suggest('', selectedMode).catch(() => {})
  }

  function updateSuggestions(event?: Event, commandState = $commands): void {
    if (event?.type === 'input') {
      address = addressInput.value
      if (!activeShortcut && !(event instanceof InputEvent && event.isComposing)) {
        const match = /^(\S+) ([\s\S]*)$/.exec(address)
        const shortcut =
          match && shortcuts.find((entry) => entry.keyword === match[1].toLowerCase())
        if (match && shortcut) {
          const start = addressInput.selectionStart ?? address.length
          const end = addressInput.selectionEnd ?? start
          activeShortcut = shortcut
          selectedMode = 'all'
          address = match[2]
          addressInput.value = address
          addressInput.setSelectionRange(
            Math.max(0, start - match[1].length - 1),
            Math.max(0, end - match[1].length - 1)
          )
          void tick().then(() => syncCaret())
        }
      }
    }
    clearTimeout(suggestionTimer)
    suggestionTimer = undefined
    requestVersion += 1
    pendingResults = false
    resultWarning = ''
    selectedIndex = 0
    selectionTouched = false
    syncCaret()
    const query = searchQuery()
    suggestionsOpen = caretFocused && !!query
    if (!suggestionsOpen) {
      closeSuggestions()
      return
    }
    if (!activeShortcut && query.startsWith('/')) {
      suggestions = commandResults(query, commandState?.commands ?? [])
      resultWarning = commandState?.error ?? ''
      return
    }
    if (activeShortcut && !address.trim()) {
      suggestions = []
      return
    }
    const shortcut = shortcutResult(query, shortcuts)
    let localResults =
      shortcut && selectedMode !== 'tabs' && selectedMode !== 'history'
        ? [shortcut]
        : localSearchResults(query, selectedMode, $preferences.searchEngine)
    if (selectedMode === 'all' || selectedMode === 'tabs') {
      localResults = [
        ...localResults,
        ...tabs
          .filter((tab) => !!tab.incognito === incognito)
          .map((tab): SearchResult => ({
            id: `tab:${tab.id}`,
            kind: 'tab',
            tabId: tab.id,
            title: tab.title,
            url: tab.url,
            favicon: tab.favicon
          }))
          .filter((result) => resultScore(query, result) > 0)
      ]
    }
    const immediateResults = shortcut ? localResults : rankSearchResults(query, localResults)
    const incomingIds = new Set(immediateResults.map((result) => result.id))
    suggestions = [
      ...immediateResults,
      ...(resultsMode === selectedMode &&
      suggestions[0]?.kind !== 'command' &&
      !shortcut &&
      query.length <= 256
        ? suggestions.filter(
            (result) => !incomingIds.has(result.id) && !immediateResultIds.has(result.id)
          )
        : [])
    ]
    immediateResultIds = incomingIds
    resultsMode = selectedMode
    const version = requestVersion
    if (suggestionsOpen && query.length <= 256) {
      void window.api.suggest(query, selectedMode, version, false).catch(() => {})
    }
    if (
      !suggestionsOpen ||
      !suggestionsEnabled ||
      query.length < 2 ||
      query.length > 256 ||
      (selectedMode !== 'search' && selectedMode !== 'websites') ||
      shortcut
    )
      return
    pendingResults = true
    suggestionTimer = setTimeout(async () => {
      suggestionTimer = undefined
      try {
        const response = await window.api.suggest(query, selectedMode, version, true)
        if (
          version === requestVersion &&
          caretFocused &&
          suggestionsOpen &&
          searchQuery() === query
        ) {
          applyResults(response)
        }
      } catch {
        if (version === requestVersion) resultWarning = 'Online results unavailable.'
      } finally {
        if (version === requestVersion) pendingResults = false
      }
    }, 200)
  }

  function searchQuery(): string {
    return activeShortcut ? `${activeShortcut.keyword} ${address.trim()}` : address.trim()
  }

  function exitShortcut(): void {
    if (!activeShortcut) return
    const keyword = activeShortcut.keyword
    activeShortcut = undefined
    address = `${keyword}${address ? ` ${address}` : ''}`
    addressInput.value = address
    addressInput.focus()
    addressInput.setSelectionRange(keyword.length, keyword.length)
    updateSuggestions()
    void tick().then(() => syncCaret())
  }

  function handleBeforeInput(event: InputEvent): void {
    if (
      activeShortcut &&
      event.inputType.startsWith('delete') &&
      event.inputType.endsWith('Backward') &&
      addressInput.selectionStart === 0 &&
      addressInput.selectionEnd === 0
    ) {
      event.preventDefault()
      exitShortcut()
    }
  }

  function applyResults(response: SearchResponse): void {
    response = {
      ...response,
      results: response.results.filter(
        (result) => result.kind !== 'tab' || tabs.some((tab) => tab.id === result.tabId)
      )
    }
    const selectedId = suggestions[selectedIndex]?.id
    if (selectionTouched) {
      const incoming = new Map(response.results.map((result) => [result.id, result]))
      const existing = new Set(suggestions.map((result) => result.id))
      suggestions = [
        ...suggestions
          .filter((result) => incoming.has(result.id))
          .map((result) => incoming.get(result.id)!),
        ...response.results.filter((result) => !existing.has(result.id))
      ]
    } else suggestions = response.results
    if (selectionTouched)
      selectedIndex = Math.max(
        0,
        suggestions.findIndex((result) => result.id === selectedId)
      )
    else selectedIndex = 0
    resultWarning = response.warning ?? ''
  }

  function setMode(mode: SearchMode): void {
    activeShortcut = undefined
    selectedMode = mode
    addressInput.focus()
    updateSuggestions()
  }

  function chooseSuggestion(result: SearchResult | CommandResult): void {
    if (result.kind === 'command') {
      executeCommand(result)
      return
    }
    const query = searchQuery()
    activeShortcut = undefined
    address =
      result.kind === 'website'
        ? result.url
        : result.kind === 'search'
          ? result.query
          : result.title
    closeSuggestions()
    addressInput.blur()
    window.api.activate(result, query)
  }

  function executeCommand(result: CommandResult): void {
    if (result.unavailable) {
      resultWarning = result.unavailable
      return
    }
    const tabId = activeTabId
    activeShortcut = undefined
    closeSuggestions()
    address = pageUrl
    addressInput.blur()
    void window.api.runCommand(result.commandId).catch((failure) => {
      if (activeTabId !== tabId || caretFocused) return
      address = result.title
      addressInput.focus()
      updateSuggestions()
      resultWarning = commandError(failure)
    })
  }

  function navigate(event: SubmitEvent): void {
    event.preventDefault()
    if (!activeShortcut && address.trim().startsWith('/')) {
      const result = suggestions[selectedIndex]
      if (result?.kind === 'command') executeCommand(result)
      else {
        updateSuggestions()
        resultWarning =
          $commands?.error || 'No matching command. Manage commands in Settings → Commands.'
      }
      return
    }
    if (/^rei:/i.test(address.trim())) {
      window.api.navigate(address)
      closeSuggestions()
      addressInput.blur()
      return
    }
    if (suggestionsOpen) {
      const result = suggestions[selectedIndex]
      if (result) chooseSuggestion(result)
    } else {
      if (activeShortcut) {
        const result = shortcutResult(searchQuery(), shortcuts)
        if (result) chooseSuggestion(result)
        return
      }
      window.api.navigate(address)
      addressInput.blur()
    }
  }

  function handleAddressKey(event: KeyboardEvent): void {
    if (event.isComposing) return
    if (
      event.key === 'Backspace' &&
      activeShortcut &&
      addressInput.selectionStart === 0 &&
      addressInput.selectionEnd === 0
    ) {
      event.preventDefault()
      exitShortcut()
      return
    }
    if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault()
      const direction = event.key === 'ArrowRight' ? 1 : -1
      const index = searchModes.findIndex((mode) => mode.id === selectedMode)
      setMode(searchModes[(index + direction + searchModes.length) % searchModes.length].id)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!suggestionsOpen) updateSuggestions()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      if (suggestions.length) {
        selectionTouched = true
        selectedIndex = (selectedIndex + direction + suggestions.length) % suggestions.length
        void tick().then(() =>
          suggestionScroll?.reveal(document.getElementById(`address-option-${selectedIndex}`))
        )
      }
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closeSuggestions()
      addressInput.blur()
    }
  }

  function syncCaret(input = addressInput): void {
    input?.dispatchEvent(new Event('rei:sync-caret'))
  }

  function focusAddress(): void {
    sitePermissionsOpen = false
    caretFocused = true
    closeSuggestions()
    syncCaret()
  }

  function blurAddress(event: FocusEvent): void {
    caretFocused = false
    if (
      !(event.relatedTarget instanceof Element) ||
      !event.relatedTarget.closest('.suggestion-panel')
    ) {
      closeSuggestions()
    }
  }

  function closeMenuOnOutsideClick(event: MouseEvent): void {
    if (
      event.target instanceof Element &&
      !event.target.closest('.site-permissions-panel, .site-permissions-button')
    )
      sitePermissionsOpen = false
    if (
      event.target instanceof Element &&
      !event.target.closest('.address-bar, .suggestion-panel')
    ) {
      closeSuggestions()
    }
  }

  function closeMenuOnEscape(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if (sitePermissionsOpen) {
        sitePermissionsOpen = false
        sitePermissionsButton?.focus({ preventScroll: true })
      }
      closeSuggestions()
      if (document.activeElement === addressInput) addressInput.blur()
    }
  }
</script>

<svelte:window on:click={closeMenuOnOutsideClick} on:keydown={closeMenuOnEscape} />

<header
  class="topbar"
  class:revealed={pointerNearAddress || sitePermissionsOpen || !$preferences.autoHideTopbar}
>
  <form
    class="address-bar"
    class:has-shortcut={!!activeShortcut}
    class:focused={caretFocused}
    style={`--address-width: ${addressWidth}px`}
    on:submit={navigate}
  >
    {#if siteOrigin && !activeShortcut}
      <button
        bind:this={sitePermissionsButton}
        class="site-permissions-button"
        type="button"
        title="Site permissions"
        aria-label="Site permissions"
        aria-haspopup="dialog"
        aria-expanded={sitePermissionsOpen}
        aria-controls={sitePermissionsOpen ? 'site-permissions-panel' : undefined}
        on:click={toggleSitePermissions}><SlidersHorizontal size={15} aria-hidden="true" /></button
      >
    {/if}
    {#if activeShortcut}
      <button
        class="shortcut-token"
        type="button"
        title={`Backspace to return to ${activeShortcut.keyword}`}
        aria-label={`Exit ${activeShortcut.title} site search`}
        on:mousedown|preventDefault
        on:click={exitShortcut}>{`${activeShortcut.title} | `}</button
      >
    {/if}
    {#if incognito}
      <span class="incognito-indicator" title="Incognito: history is not saved">
        <HatGlasses size={15} aria-label="Incognito" />
      </span>
    {/if}
    <input
      use:smoothText
      bind:this={addressInput}
      bind:value={address}
      aria-label={activeShortcut ? `Search ${activeShortcut.title}` : 'Search'}
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={suggestionsOpen}
      aria-controls={suggestionsOpen ? 'address-suggestions' : undefined}
      aria-activedescendant={suggestionsOpen && suggestions.length
        ? `address-option-${selectedIndex}`
        : undefined}
      autocomplete="off"
      spellcheck={false}
      on:blur={blurAddress}
      on:focus={focusAddress}
      on:input={updateSuggestions}
      on:beforeinput={handleBeforeInput}
      on:compositionend={() => updateSuggestions(new Event('input'))}
      on:keydown={handleAddressKey}
      placeholder={activeShortcut ? `Search ${activeShortcut.title}` : 'Search'}
      type="text"
    />
  </form>
</header>

{#if sitePermissionsOpen && siteOrigin}
  <div
    bind:this={sitePermissionsPanel}
    use:watchPermissionPanel
    class="site-permissions-panel"
    id="site-permissions-panel"
    role="dialog"
    aria-label="Site permissions"
    tabindex="-1"
    on:focusout={(event) => {
      if (
        event.relatedTarget instanceof Node &&
        !sitePermissionsPanel.contains(event.relatedTarget) &&
        event.relatedTarget !== sitePermissionsButton
      )
        sitePermissionsOpen = false
    }}
  >
    <WebsitePermissions origin={siteOrigin} {incognito} contentsId={activeWebContentsId} />
  </div>
{/if}

{#if suggestionsOpen}
  <section class="suggestion-panel" aria-label="Address suggestions">
    {#if resultWarning}
      <p class="search-status" role="status">{resultWarning}</p>
    {/if}
    <ScrollArea
      bind:this={suggestionScroll}
      className="suggestion-scroll"
      background="var(--rei-background)"
    >
      <div id="address-suggestions" role="listbox" aria-label="Search suggestions">
        <FluidHover exact>
          {#each suggestions as suggestion, index (suggestion.id)}
            <button
              id={`address-option-${index}`}
              class="suggestion-option"
              class:search-result={suggestion.kind === 'search'}
              data-fluid-hover
              data-fluid-selected={selectedIndex === index ? '' : undefined}
              role="option"
              aria-selected={selectedIndex === index}
              tabindex="-1"
              type="button"
              on:mousedown|preventDefault
              on:click={() => chooseSuggestion(suggestion)}
            >
              {#if suggestion.kind === 'command'}
                <Terminal size={15} aria-hidden="true" />
              {:else if incognito}
                <HatGlasses size={15} aria-hidden="true" />
              {:else}
                <SiteIcon
                  src={suggestion.favicon}
                  url={suggestion.kind === 'search' ? undefined : suggestion.url}
                />
              {/if}
              <span class="result-copy">
                <span class="result-title">{suggestion.title}</span>
              </span>
              <span class="result-url"
                >{suggestion.kind === 'command'
                  ? suggestion.description
                  : suggestion.kind === 'search'
                    ? `${searchEngines[$preferences.searchEngine].label} Search`
                    : suggestion.kind === 'tab'
                      ? `Open tab: ${cleanUrl(suggestion.url)}`
                      : suggestion.source === 'history'
                        ? `History: ${cleanUrl(suggestion.url)}`
                        : cleanUrl(suggestion.url)}</span
              >
            </button>
          {/each}
        </FluidHover>
      </div>
    </ScrollArea>
    {#if !suggestions.length}
      <p class="search-status" role="status">
        {!activeShortcut && address.trim().startsWith('/')
          ? !$commands
            ? 'Loading commands…'
            : 'No matching commands. Add commands in Settings → Commands.'
          : activeShortcut && !address.trim()
            ? `Type to search ${activeShortcut.title}.`
            : selectedMode === 'tabs'
              ? 'No matching open tabs.'
              : selectedMode === 'history'
                ? 'No matching history.'
                : pendingResults
                  ? 'Getting suggestions\u2026'
                  : !address.trim()
                    ? 'Type to search this mode.'
                    : 'No results in this mode.'}
      </p>
    {/if}
  </section>
{/if}

{#if isSettingsUrl(pageUrl) && !error}
  <SettingsPage
    url={pageUrl}
    persistentTopbar={!$preferences.autoHideTopbar}
    bind:suggestionsEnabled
    {shortcuts}
    {shortcutError}
  />
{/if}

{#if pageUrl === downloadsUrl && !error}
  <DownloadsPage persistentTopbar={!$preferences.autoHideTopbar} />
{/if}

{#if !pageUrl && !error}
  <main class="blank-page" aria-label="New tab"></main>
{/if}

{#if error}
  <main class="page-message" role="alert">{error}</main>
{:else if loading}
  <div class="loading-indicator" role="status" aria-label="Loading page"></div>
{/if}
