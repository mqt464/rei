<script lang="ts">
  import { afterUpdate, onMount, tick } from 'svelte'
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
  let address = ''
  let loading = false
  let error = ''
  let addressInput: HTMLInputElement
  let caretX = 12
  let caretFocused = false
  let caretBlinking = false
  let blinkTimer: ReturnType<typeof setTimeout> | undefined
  let suggestions: SearchResult[] = []
  let selectedMode: SearchMode = 'all'
  let pendingResults = false
  let resultWarning = ''
  let suggestionsOpen = false
  let suggestionsEnabled = true
  let selectedIndex = 0
  let suggestionTimer: ReturnType<typeof setTimeout> | undefined
  let requestVersion = 0
  let overlayHeight = 0
  let tabs: BrowserTab[] = []
  let activeTabId = ''
  let shortcuts = defaultShortcuts
  let shortcutsOpen = false
  let shortcutText = ''
  let shortcutError = ''
  let selectionTouched = false
  let activeShortcut: SearchShortcut | undefined

  onMount(() => {
    suggestionsEnabled = localStorage.getItem('rei:suggestions') !== 'off'
    shortcutText =
      localStorage.getItem('rei:shortcuts') ??
      defaultShortcuts.map((entry) => `${entry.keyword} | ${entry.title} | ${entry.url}`).join('\n')
    saveShortcuts(false)
    const unsubscribe = window.api.onState((state) => {
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
      applyResults(update.response)
      pendingResults = update.pending || suggestionTimer !== undefined
    })
    const unsubscribeData = window.api.onSearchDataCleared(() => closeSuggestions())
    const unsubscribeAddress = window.api.onFocusAddress(() => {
      addressInput.focus()
      addressInput.select()
      closeSuggestions()
    })
    const unsubscribeFocus = window.api.onPageFocus(() => {
      addressInput.blur()
      closeSuggestions()
      shortcutsOpen = false
    })
    return () => {
      unsubscribe()
      unsubscribeFocus()
      unsubscribeSearch()
      unsubscribeData()
      unsubscribeAddress()
      clearTimeout(suggestionTimer)
      clearTimeout(blinkTimer)
      void window.api.suggest('', selectedMode).catch(() => {})
    }
  })

  afterUpdate(() => {
    let height = 38
    for (const element of document.querySelectorAll('.suggestion-panel, .shortcut-panel')) {
      height = Math.max(height, Math.ceil(element.getBoundingClientRect().bottom))
    }
    if (height !== overlayHeight) {
      overlayHeight = height
      window.api.setOverlayHeight(height)
    }
    if (suggestionsOpen) {
      const list = document.getElementById('address-suggestions')
      const option = document.getElementById(`address-option-${selectedIndex}`)
      if (list && option) {
        const listBounds = list.getBoundingClientRect()
        const optionBounds = option.getBoundingClientRect()
        if (optionBounds.top < listBounds.top) list.scrollTop -= listBounds.top - optionBounds.top
        else if (optionBounds.bottom > listBounds.bottom) {
          list.scrollTop += optionBounds.bottom - listBounds.bottom
        }
      }
    }
  })

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

  function updateSuggestions(event?: Event): void {
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
    closeSuggestions()
    syncCaret()
    shortcutsOpen = false
    const query = searchQuery()
    suggestionsOpen = caretFocused && !!query
    if (activeShortcut && !address.trim()) return
    const shortcut = shortcutResult(query, shortcuts)
    suggestions =
      shortcut && selectedMode !== 'tabs' && selectedMode !== 'history'
        ? [shortcut]
        : localSearchResults(query, selectedMode)
    if (selectedMode === 'all' || selectedMode === 'tabs') {
      suggestions = [
        ...suggestions,
        ...tabs
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
    if (!shortcut) suggestions = rankSearchResults(query, suggestions)
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

  function saveShortcuts(persist = true): void {
    const parsed: SearchShortcut[] = []
    for (const line of shortcutText.split('\n').filter((line) => line.trim())) {
      const [keyword, title, ...urlParts] = line.split('|').map((part) => part.trim())
      const url = urlParts.join('|')
      try {
        if (
          !/^[a-z0-9_-]{1,20}$/.test(keyword) ||
          !title ||
          title.length > 80 ||
          url.length > 2048 ||
          !url.includes('{query}') ||
          !['https:', 'http:'].includes(new URL(url).protocol) ||
          parsed.some((entry) => entry.keyword === keyword)
        )
          throw new Error()
      } catch {
        shortcutError = 'Use unique keyword | Name | https://site/search?q={query}'
        return
      }
      parsed.push({ keyword, title, url })
    }
    if (parsed.length > 30) {
      shortcutError = 'Use at most 30 shortcuts.'
      return
    }
    shortcuts = parsed
    shortcutError = ''
    window.api.setShortcuts(shortcuts)
    if (persist) {
      localStorage.setItem('rei:shortcuts', shortcutText)
      shortcutsOpen = false
    }
  }

  function setMode(mode: SearchMode): void {
    activeShortcut = undefined
    selectedMode = mode
    addressInput.focus()
    updateSuggestions()
  }

  function chooseSuggestion(result: SearchResult): void {
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

  function navigate(event: SubmitEvent): void {
    event.preventDefault()
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
      }
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closeSuggestions()
    }
  }

  function syncCaret(input = addressInput): void {
    if (!input) return

    const start = input.selectionStart ?? input.value.length
    const end = input.selectionEnd ?? start
    const caretIndex = input.selectionDirection === 'backward' ? start : end
    const textBeforeCaret = input.value.slice(0, caretIndex)
    const style = getComputedStyle(input)
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')

    if (context) {
      context.font = style.font
      const letterSpacing = Number.parseFloat(style.letterSpacing) || 0
      const textWidth =
        context.measureText(textBeforeCaret).width +
        Math.max(0, Array.from(textBeforeCaret).length - 1) * letterSpacing
      caretX = Math.max(
        0,
        input.offsetLeft +
          (Number.parseFloat(style.paddingLeft) || 0) +
          textWidth -
          input.scrollLeft
      )
    }

    caretBlinking = false
    clearTimeout(blinkTimer)
    if (caretFocused) blinkTimer = setTimeout(() => (caretBlinking = true), 700)
  }

  function focusAddress(): void {
    caretFocused = true
    closeSuggestions()
    syncCaret()
  }

  function blurAddress(event: FocusEvent): void {
    caretFocused = false
    caretBlinking = false
    clearTimeout(blinkTimer)
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
      !event.target.closest('.address-bar, .suggestion-panel')
    ) {
      closeSuggestions()
    }
    if (
      shortcutsOpen &&
      event.target instanceof Element &&
      !event.target.closest('.shortcut-panel')
    )
      shortcutsOpen = false
  }

  function closeMenuOnEscape(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      shortcutsOpen = false
      closeSuggestions()
    }
  }
</script>

<svelte:window on:click={closeMenuOnOutsideClick} on:keydown={closeMenuOnEscape} />

<header class="topbar">
  <form class="address-bar" class:has-shortcut={!!activeShortcut} on:submit={navigate}>
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
    <input
      bind:this={addressInput}
      bind:value={address}
      aria-label={activeShortcut
        ? `Search ${activeShortcut.title}`
        : 'Search Google or enter address'}
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
      on:click={() => syncCaret()}
      on:focus={focusAddress}
      on:input={updateSuggestions}
      on:beforeinput={handleBeforeInput}
      on:compositionend={() => updateSuggestions(new Event('input'))}
      on:keydown={handleAddressKey}
      on:keyup={() => syncCaret()}
      on:scroll={() => syncCaret()}
      on:select={() => syncCaret()}
      placeholder={activeShortcut
        ? `Search ${activeShortcut.title}`
        : 'Search Google or enter address'}
      type="text"
    />
    <span
      aria-hidden="true"
      class="custom-caret"
      class:focused={caretFocused}
      class:blinking={caretBlinking}
      style={`--caret-x: ${caretX}px`}
    ></span>
  </form>
</header>

{#if suggestionsOpen}
  <section class="suggestion-panel" aria-label="Address suggestions">
    {#if resultWarning}
      <p class="search-status" role="status">{resultWarning}</p>
    {/if}
    <ScrollArea className="suggestion-scroll" background="#18181b">
      <div id="address-suggestions" role="listbox" aria-label="Search suggestions">
        {#each suggestions as suggestion, index (suggestion.id)}
          <button
            id={`address-option-${index}`}
            class="suggestion-option"
            class:search-result={suggestion.kind === 'search'}
            class:selected={selectedIndex === index}
            role="option"
            aria-selected={selectedIndex === index}
            tabindex="-1"
            type="button"
            on:mousedown|preventDefault
            on:click={() => chooseSuggestion(suggestion)}
          >
            <SiteIcon
              src={suggestion.favicon}
              url={suggestion.kind === 'search' ? undefined : suggestion.url}
            />
            <span class="result-copy">
              <span class="result-title">{suggestion.title}</span>
            </span>
            <span class="result-url"
              >{suggestion.kind === 'search'
                ? 'Google Search'
                : suggestion.kind === 'tab'
                  ? `Open tab: ${cleanUrl(suggestion.url)}`
                  : suggestion.source === 'history'
                    ? `History: ${cleanUrl(suggestion.url)}`
                    : cleanUrl(suggestion.url)}</span
            >
          </button>
        {/each}
      </div>
    </ScrollArea>
    {#if !suggestions.length}
      <p class="search-status" role="status">
        {activeShortcut && !address.trim()
          ? `Type to search ${activeShortcut.title}.`
          : selectedMode === 'tabs'
            ? 'No matching open tabs.'
            : selectedMode === 'history'
              ? 'No matching history.'
              : pendingResults
                ? 'Searching Google...'
                : !address.trim()
                  ? 'Type to search this mode.'
                  : 'No results in this mode.'}
      </p>
    {/if}
  </section>
{/if}

{#if shortcutsOpen}
  <section class="shortcut-panel" aria-label="Site search shortcuts">
    <h2>Site search shortcuts</h2>
    <p>Type a keyword and query, like <strong>yt cats</strong>. One shortcut per line.</p>
    <label for="shortcut-editor">keyword | Name | URL with {'{query}'}</label>
    <textarea
      id="shortcut-editor"
      aria-invalid={!!shortcutError}
      aria-describedby={shortcutError ? 'shortcut-error' : undefined}
      bind:value={shortcutText}
      rows="6"
      spellcheck={false}></textarea>
    {#if shortcutError}<p id="shortcut-error" role="alert">{shortcutError}</p>{/if}
    <div class="shortcut-actions">
      <button type="button" on:click={() => (shortcutsOpen = false)}>Cancel</button><button
        type="button"
        on:click={() => saveShortcuts()}>Save shortcuts</button
      >
    </div>
  </section>
{/if}

{#if error}
  <main class="page-message" role="alert">{error}</main>
{:else if loading}
  <div class="loading-indicator" role="status" aria-label="Loading page"></div>
{/if}
