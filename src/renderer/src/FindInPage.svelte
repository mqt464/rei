<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { smoothText } from './smoothText'
  import type { FindState } from '../../shared/browser'

  let input: HTMLInputElement
  let query = ''
  let state: FindState = { query: '', activeMatchOrdinal: 0, matches: 0 }
  let opening = false

  async function focus(): Promise<void> {
    query = state.query
    opening = false
    await tick()
    opening = true
    input.focus()
    input.select()
  }

  onMount(() => {
    const update = (value: FindState): void => {
      state = value
      void tick().then(() => input.dispatchEvent(new Event('rei:sync-caret')))
    }
    const unsubscribe = window.api.onFindState(update)
    const unsubscribeFocus = window.api.onFocusFind(() => void focus())
    void window.api.getFindState().then(update).then(focus)
    return () => {
      unsubscribe()
      unsubscribeFocus()
    }
  })

  function keydown(event: KeyboardEvent): void {
    if (event.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      input.blur()
      window.api.dismissFind(false)
    } else if (event.key === 'Enter' && event.target === input) {
      event.preventDefault()
      window.api.findInPage(query, !event.shiftKey)
    }
  }
</script>

<svelte:window on:keydown={keydown} />

<section class="finder" class:opening aria-label="Find in page">
  <div class="field">
    <input
      bind:this={input}
      bind:value={query}
      use:smoothText
      aria-label="Find in page"
      placeholder="Find in page"
      maxlength="8192"
      spellcheck="false"
      on:input={(event) => window.api.findInPage(event.currentTarget.value)}
    />
  </div>
  <output aria-live="polite" aria-atomic="true" class:no-match={query && !state.matches}>
    {query ? `${state.activeMatchOrdinal}/${state.matches}` : ''}
  </output>
  <button
    aria-label="Previous match"
    title="Previous match (Shift+Enter)"
    disabled={!state.matches}
    on:click={() => window.api.findInPage(query, false)}
  >
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 10 4-4 4 4" /></svg>
  </button>
  <button
    aria-label="Next match"
    title="Next match (Enter)"
    disabled={!state.matches}
    on:click={() => window.api.findInPage(query, true)}
  >
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
  </button>
  <button
    aria-label="Close find in page"
    title="Close find in page"
    on:click={() => window.api.dismissFind(true)}
  >
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" /></svg>
  </button>
</section>

<style>
  :global(html[data-surface='find']),
  :global(html[data-surface='find'] body),
  :global(html[data-surface='find'] #app) {
    background: transparent;
  }

  .finder {
    display: flex;
    align-items: center;
    gap: 2px;
    margin: 6px 10px;
    padding: 4px;
    border: 1px solid var(--rei-border);
    border-radius: var(--rei-radius);
    color: var(--rei-text);
    background: var(--rei-input);
    box-shadow: 0 4px 12px color-mix(in srgb, var(--rei-background) 40%, transparent);
  }

  .opening {
    animation: find-in var(--rei-duration-medium) cubic-bezier(0.16, 1, 0.3, 1);
  }

  .field {
    position: relative;
    flex: 1;
    min-width: 0;
  }

  input {
    width: 100%;
    height: 30px;
    padding: 0 8px;
    border: 0;
    outline: none;
    color: inherit;
    background: transparent;
    font: inherit;
  }

  input::placeholder,
  output {
    color: var(--rei-muted);
  }

  .field:focus-within {
    border-radius: calc(var(--rei-radius) / 2);
    box-shadow: inset 0 -1px var(--rei-accent);
  }

  output {
    padding: 0 6px;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  output.no-match {
    color: var(--rei-text);
  }

  button {
    display: grid;
    place-items: center;
    flex: 0 0 26px;
    height: 28px;
    padding: 5px;
    border: 0;
    border-radius: calc(var(--rei-radius) / 2);
    color: inherit;
    background: transparent;
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    background: var(--rei-border);
  }

  button:focus-visible {
    outline: 1px solid var(--rei-accent);
  }

  button:disabled {
    opacity: 0.35;
    cursor: default;
  }

  svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  @keyframes find-in {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  :global(html[data-motion='reduced']) .opening {
    animation: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .opening {
      animation: none;
    }
  }
</style>
