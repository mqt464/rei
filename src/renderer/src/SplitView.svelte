<script lang="ts">
  import { onMount } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { fade } from 'svelte/transition'
  import { GripVertical, Unlink } from '@lucide/svelte'
  import type { BrowserState } from '../../shared/browser'
  import { splitGeometry } from '../../shared/split'
  import SiteIcon from './components/SiteIcon.svelte'
  import Morph from './components/Morph.svelte'
  import { motionMode, theme } from './theme'

  let state: BrowserState | undefined
  let width = innerWidth
  let drag:
    { id: string; pointer: number; startX: number; startY: number; started: boolean } | undefined
  let target: 'left' | 'right' | undefined
  let suppressClick = false
  $: left = state?.tabs.find((tab) => tab.id === state?.split?.leftId)
  $: right = state?.tabs.find((tab) => tab.id === state?.split?.rightId)
  $: geometry = splitGeometry(width, state?.split?.ratio)
  $: dragged = state?.tabs.find((tab) => tab.id === drag?.id)

  onMount(() =>
    window.api.onState((value) => {
      if (state?.split?.gesture === 'move' && value.split?.gesture !== 'move') {
        drag = undefined
        target = undefined
      }
      state = value
    })
  )

  function start(event: PointerEvent, id: string): void {
    if (event.button !== 0 || !event.isPrimary) return
    const button = event.currentTarget as HTMLButtonElement
    button.setPointerCapture(event.pointerId)
    suppressClick = false
    drag = {
      id,
      pointer: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      started: false
    }
  }

  function move(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointer) return
    if (
      !drag.started &&
      Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 6
    ) {
      drag = { ...drag, started: true }
      suppressClick = true
      window.api.beginSplitGesture(drag.id, 'move')
    }
    if (!drag.started) return
    target =
      event.clientX >= 0 &&
      event.clientX <= width &&
      event.clientY >= 0 &&
      event.clientY <= innerHeight
        ? event.clientX < geometry.leftWidth
          ? 'left'
          : 'right'
        : undefined
  }

  function finish(event?: PointerEvent, cancelled = false): void {
    if (!drag || (event && event.pointerId !== drag.pointer)) return
    const current = drag
    const destination = target
    drag = undefined
    target = undefined
    if (current.started) {
      if (!cancelled && destination) window.api.moveSplitPane(current.id, destination)
      else window.api.finishSplitGesture(true)
    }
  }

  function key(event: KeyboardEvent, id: string): void {
    if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault()
      window.api.moveSplitPane(id, event.key === 'ArrowLeft' ? 'left' : 'right')
    }
  }

  function moveHeading(
    _node: HTMLElement,
    { from, to }: { from: DOMRect; to: DOMRect }
  ): { duration: number; easing: typeof cubicOut; css: (progress: number) => string } {
    return {
      duration:
        $motionMode === 'full' && state?.split?.gesture !== 'resize'
          ? 22000 / $theme.animationSpeed
          : 0,
      easing: cubicOut,
      css: (progress) => `transform: translateX(${(from.left - to.left) * (1 - progress)}px)`
    }
  }
</script>

<svelte:window
  bind:innerWidth={width}
  on:blur={() => finish(undefined, true)}
  on:keydown={(event) => {
    if (event.key === 'Escape' && drag) {
      event.preventDefault()
      finish(undefined, true)
    }
  }}
/>

{#if state?.split && left && right}
  <div
    class="split-toolbar"
    class:dragging={drag?.started}
    role="toolbar"
    aria-label="Split view"
    style:grid-template-columns={`${geometry.leftWidth}px 2px ${geometry.rightWidth}px`}
  >
    {#each [left, right] as tab, index (tab.id)}
      <div class="pane-heading" style:grid-column={index === 0 ? 1 : 3} animate:moveHeading>
        <button
          class="pane-title"
          class:active={tab.id === state.activeTabId}
          class:lifted={drag?.started && drag.id === tab.id}
          type="button"
          aria-pressed={tab.id === state.activeTabId}
          aria-label={`Focus ${index === 0 ? 'left' : 'right'} pane: ${tab.title}`}
          aria-describedby="pane-drag-help"
          title={`${tab.title}; drag to move; Alt+Left/Right to place`}
          on:pointerdown={(event) => start(event, tab.id)}
          on:pointermove={move}
          on:pointerup={(event) => finish(event)}
          on:pointercancel={(event) => finish(event, true)}
          on:lostpointercapture={(event) => finish(event, true)}
          on:keydown={(event) => key(event, tab.id)}
          on:click={(event) => {
            if (!suppressClick || event.detail === 0) window.api.switchTab(tab.id)
            suppressClick = false
          }}
        >
          <GripVertical class="grip" size={12} aria-hidden="true" />
          <span class="pane-side" aria-hidden="true">{index === 0 ? 'L' : 'R'}</span>
          <SiteIcon src={tab.favicon} url={tab.url} />
          <span class="title"><Morph text={tab.title} preset="title" /></span>
        </button>
        {#if index === 1}
          <button
            class="separate"
            type="button"
            aria-label="Separate split tabs"
            title="Separate tabs"
            on:click={() => window.api.unsplitTab(state!.activeTabId)}
            ><Unlink size={14} aria-hidden="true" /></button
          >
        {/if}
      </div>
    {/each}
    <span id="pane-drag-help" class="sr-only"
      >Drag to either side to move this pane. Or press Alt+Left or Alt+Right.</span
    >
    <span class="sr-only" aria-live="polite">{left.title} on left. {right.title} on right.</span>
  </div>
  {#if drag?.started && target}
    <div
      class="drop-target"
      transition:fade={{ duration: $motionMode === 'full' ? 100 : 0 }}
      aria-hidden="true"
      style:left={`${target === 'left' ? 0 : geometry.leftWidth + 2}px`}
      style:width={`${target === 'left' ? geometry.leftWidth : geometry.rightWidth}px`}
    >
      <span>{dragged?.title}<small>Place on {target}</small></span>
    </div>
  {/if}
{/if}

<style>
  .split-toolbar {
    display: grid;
    height: 36px;
    background: var(--rei-sidebar);
    border-bottom: 1px solid var(--rei-border);
    font-size: calc(var(--rei-font-size) - 1px);
  }
  .pane-heading {
    display: flex;
    align-items: center;
    min-width: 0;
    padding: 3px 5px;
    gap: 2px;
  }
  button {
    border: 0;
    border-radius: calc(var(--rei-radius) * 0.4);
    background: transparent;
    color: var(--rei-muted);
    font: inherit;
    touch-action: none;
    transition:
      color var(--rei-duration-fast) ease,
      background-color var(--rei-duration-fast) ease,
      opacity var(--rei-duration-fast) ease;
  }
  button:hover {
    background: var(--rei-hover);
    color: var(--rei-text);
  }
  button:focus-visible {
    outline: 2px solid var(--rei-accent);
    outline-offset: -2px;
  }
  .pane-title {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 6px;
    height: 29px;
    min-width: 0;
    padding: 0 6px;
    text-align: left;
    cursor: grab;
    user-select: none;
  }
  .pane-title.active {
    color: var(--rei-text);
    background: var(--rei-hover);
  }
  .dragging .pane-title {
    cursor: grabbing;
  }
  .pane-title.lifted {
    opacity: 0.5;
  }
  .pane-title :global(.grip) {
    flex-shrink: 0;
    opacity: 0.5;
  }
  .pane-side {
    font-size: 9px;
    flex-shrink: 0;
  }
  .active .pane-side {
    color: var(--rei-accent);
  }
  .title {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .separate {
    display: grid;
    place-items: center;
    width: 28px;
    height: 29px;
    flex-shrink: 0;
    cursor: pointer;
  }
  .drop-target {
    position: absolute;
    top: 36px;
    bottom: 0;
    padding: 12px;
    display: grid;
    place-items: center;
    border: 1px solid color-mix(in srgb, var(--rei-accent) 65%, transparent);
    background: color-mix(in srgb, var(--rei-accent) 8%, transparent);
    pointer-events: none;
    transition:
      left var(--rei-duration-medium) cubic-bezier(0.2, 0.8, 0.2, 1),
      width var(--rei-duration-medium) cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .drop-target span {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 10px 14px;
    border: 1px solid var(--rei-border);
    border-radius: var(--rei-radius);
    color: var(--rei-text);
    background: var(--rei-sidebar);
    font-size: var(--rei-font-size);
    box-shadow: 0 4px 16px #0002;
  }
  .drop-target small {
    display: block;
    margin-top: 4px;
    color: var(--rei-muted);
    font-size: 10px;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  @media (prefers-reduced-motion: reduce) {
    .drop-target {
      transition: none;
    }
  }
</style>
