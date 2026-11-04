<script lang="ts">
  import { onMount, tick } from 'svelte'
  import {
    ArrowLeft,
    ArrowRight,
    Copy,
    Download,
    ExternalLink,
    Image,
    Link,
    ClipboardPaste,
    Redo2,
    RotateCw,
    Scissors,
    ScanLine,
    Smile,
    SpellCheck,
    TextSelect,
    Trash2,
    Undo2,
    Video
  } from '@lucide/svelte'
  import type { ContextMenuEntry, ContextMenuState } from '../../shared/context-menu'
  import FluidHover from './components/FluidHover.svelte'
  import ScrollArea from './components/ScrollArea.svelte'
  import { preferences } from './preferences'

  let state: ContextMenuState | null = null
  let menu: HTMLDivElement
  let active = -1
  let keyboard = true
  let closing = false
  let left = 8
  let top = 8
  let error = ''
  let typeahead = ''
  let typedAt = 0
  let observer: ResizeObserver
  const shortcuts: Record<string, string> = {
    Undo: 'Z',
    Redo: 'Shift+Z',
    Cut: 'X',
    Copy: 'C',
    Paste: 'V',
    'Select All': 'A',
    Reload: 'R'
  }
  const modifier = navigator.platform.includes('Mac') ? '?' : 'Ctrl+'

  function iconFor(label: string): typeof Copy {
    if (label.startsWith('Save')) return Download
    if (label.startsWith('Open')) return ExternalLink
    if (label.includes('image')) return Image
    if (label.includes('video')) return Video
    if (label.includes('address')) return Link
    return (
      {
        Back: ArrowLeft,
        Forward: ArrowRight,
        Reload: RotateCw,
        Copy,
        Cut: Scissors,
        Paste: ClipboardPaste,
        Undo: Undo2,
        Redo: Redo2,
        Delete: Trash2,
        'Select All': TextSelect,
        'Add to dictionary': SpellCheck,
        Emoji: Smile,
        Inspect: ScanLine
      }[label] || SpellCheck
    )
  }

  function position(): void {
    if (!menu || !state) return
    const bounds = menu.getBoundingClientRect()
    left = Math.max(8, Math.min(state.x, innerWidth - bounds.width - 8))
    top = Math.max(8, Math.min(state.y, innerHeight - bounds.height - 8))
  }

  async function receive(value: ContextMenuState | null): Promise<void> {
    if (!value || (state && value.id <= state.id)) return
    state = value
    active = state.items.findIndex((item) => item.enabled && !item.separator)
    keyboard = true
    closing = false
    typeahead = ''
    error = ''
    await tick()
    position()
    menu.focus({ preventScroll: true })
    observer?.disconnect()
    observer?.observe(menu)
  }

  async function close(item?: ContextMenuEntry): Promise<void> {
    if (!state || closing) return
    const id = state.id
    closing = true
    await tick()
    try {
      await Promise.all(menu.getAnimations().map((animation) => animation.finished.catch(() => {})))
      if (state.id !== id) return
      if (item) await window.api.selectContextMenu(id, item.id)
      else await window.api.dismissContextMenu(id)
    } catch {
      closing = false
      error = item
        ? 'Could not run this action. Close the menu and try again.'
        : 'Could not close the menu. Press Escape to try again.'
    }
  }

  async function choose(item: ContextMenuEntry): Promise<void> {
    if (!state || !item.enabled || item.separator) return
    await close(item)
  }

  function keydown(event: KeyboardEvent): void {
    if (!state || closing) return
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      void close()
      return
    }
    if (event.ctrlKey || event.metaKey) {
      const shortcut = `${event.shiftKey ? 'Shift+' : ''}${event.key.toUpperCase()}`
      const item = state.items.find((entry) => shortcuts[entry.label] === shortcut)
      if (item) {
        event.preventDefault()
        void choose(item)
      }
      return
    }
    if (event.altKey) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (state.items[active]) void choose(state.items[active])
      return
    }
    const enabled = state.items.flatMap((item, index) =>
      item.enabled && !item.separator ? [index] : []
    )
    if (!enabled.length) return
    const index = enabled.indexOf(active)
    if (event.key === 'ArrowDown') active = enabled[(index + 1) % enabled.length]
    else if (event.key === 'ArrowUp')
      active = enabled[(index - 1 + enabled.length) % enabled.length]
    else if (event.key === 'Home') active = enabled[0]
    else if (event.key === 'End') active = enabled[enabled.length - 1]
    else if (event.key.length === 1) {
      typeahead = Date.now() - typedAt > 600 ? event.key : typeahead + event.key
      typedAt = Date.now()
      const match = enabled.find((itemIndex) =>
        state!.items[itemIndex].label.toLowerCase().startsWith(typeahead.toLowerCase())
      )
      if (match !== undefined) active = match
    } else return
    keyboard = true
    event.preventDefault()
    void tick().then(() =>
      document
        .getElementById(`menu-item-${state?.items[active]?.id}`)
        ?.scrollIntoView({ block: 'nearest' })
    )
  }

  onMount(() => {
    observer = new ResizeObserver(position)
    const unsubscribe = window.api.onContextMenu((value) => void receive(value))
    void window.api.getContextMenu().then(receive)
    return () => {
      unsubscribe()
      observer.disconnect()
    }
  })
</script>

<svelte:window
  on:keydown={keydown}
  on:contextmenu|preventDefault
  on:pointerdown={(event) => {
    if (menu && !menu.contains(event.target as Node)) void close()
  }}
  on:wheel={(event) => {
    if (menu && !menu.contains(event.target as Node)) void close()
  }}
/>

{#if state}
  {#key state.id}
    <div
      bind:this={menu}
      class="context-menu"
      class:closing
      data-menu-id={state.id}
      role="menu"
      tabindex="-1"
      aria-label="Page actions"
      aria-activedescendant={active >= 0 ? `menu-item-${state.items[active].id}` : undefined}
      style:left={`${left}px`}
      style:top={`${top}px`}
      on:pointermove={(event) => {
        if (closing) return
        const button = (event.target as Element).closest<HTMLButtonElement>('[role=menuitem]')
        keyboard = false
        active =
          button && !button.disabled
            ? state.items.findIndex((item) => `menu-item-${item.id}` === button.id)
            : -1
      }}
      on:pointerleave={() => {
        if (!keyboard) active = -1
      }}
    >
      <ScrollArea className="context-menu-scroll" background="var(--rei-input)">
        <FluidHover exact>
          {#each state.items as item, index (item.id)}
            {#if item.separator}
              <div class="menu-separator" role="separator"></div>
            {:else}
              <button
                id={`menu-item-${item.id}`}
                class="menu-item"
                class:active={item.enabled && active === index}
                role="menuitem"
                tabindex="-1"
                type="button"
                disabled={!item.enabled}
                aria-disabled={!item.enabled}
                data-fluid-hover={item.enabled ? '' : undefined}
                data-fluid-selected={keyboard && active === index ? '' : undefined}
                on:click={() => choose(item)}
              >
                {#if $preferences.contextMenuIcons}
                  <svelte:component this={iconFor(item.label)} size={12} aria-hidden="true" />
                {/if}
                <span class="menu-label">{item.label}</span>
                {#if shortcuts[item.label]}<kbd>{modifier}{shortcuts[item.label]}</kbd>{/if}
              </button>
            {/if}
          {/each}
        </FluidHover>
      </ScrollArea>
      {#if error}<p class="menu-error" role="alert">{error}</p>{/if}
    </div>
  {/key}
{/if}

<style>
  :global(html[data-surface='context-menu']),
  :global(html[data-surface='context-menu'] body),
  :global(html[data-surface='context-menu'] #app) {
    background: transparent;
  }

  .context-menu {
    position: fixed;
    display: flex;
    flex-direction: column;
    width: min(236px, calc(100vw - 16px));
    max-height: calc(100vh - 16px);
    padding: max(3px, calc(var(--rei-spacing) / 4));
    border: 1px solid var(--rei-border);
    border-radius: calc(var(--rei-radius) * 0.7);
    color: var(--rei-text);
    background: var(--rei-input);
    box-shadow: 0 6px 16px color-mix(in srgb, var(--rei-background) 70%, transparent);
    font: var(--rei-font-weight, 400) var(--rei-font-size)/var(--rei-line-height, 1.5)
      var(--rei-font);
    outline: none;
    user-select: none;
    animation: menu-in min(60ms, calc(var(--rei-duration-fast) * 0.6)) ease-out;
  }

  .context-menu.closing {
    pointer-events: none;
    animation: menu-out min(50ms, calc(var(--rei-duration-fast) * 0.5)) ease-in forwards;
  }

  .context-menu :global(.context-menu-scroll) {
    flex: 1;
    min-height: 0;
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: calc(20px + var(--rei-spacing) / 3);
    padding: 3px 6px;
    border: 0;
    border-radius: var(--rei-hover-radius);
    color: inherit;
    background: transparent;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .menu-item :global(svg) {
    flex-shrink: 0;
    color: var(--rei-muted);
  }
  .menu-label {
    flex: 1;
    overflow-wrap: anywhere;
  }
  .menu-item:disabled {
    color: var(--rei-muted);
    opacity: 0.5;
    cursor: default;
  }
  .menu-item:focus-visible {
    outline: 2px solid var(--rei-focus);
    outline-offset: -2px;
  }
  .menu-item.active {
    color: var(--rei-accent);
  }
  .menu-item.active :global(svg),
  .menu-item.active kbd {
    color: inherit;
  }
  kbd {
    flex-shrink: 0;
    color: var(--rei-muted);
    font: inherit;
    font-size: 0.85em;
  }
  .menu-separator {
    height: 1px;
    margin: 3px 6px;
    background: var(--rei-border);
  }
  .menu-error {
    padding: 8px;
    color: var(--rei-error);
  }

  @keyframes menu-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @keyframes menu-out {
    from {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .context-menu,
    .context-menu.closing {
      animation: none;
    }
  }
  @media (forced-colors: active) {
    .context-menu {
      border-color: CanvasText;
      box-shadow: none;
    }
    .menu-item.active {
      color: HighlightText;
      background: Highlight;
    }
    .menu-item:disabled {
      color: GrayText;
      opacity: 1;
    }
  }
</style>
