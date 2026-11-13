<script lang="ts">
  import { onMount } from 'svelte'
  import type { BrowserState } from '../../shared/browser'
  import { splitGeometry, splitDividerWidth, splitDividerHitWidth } from '../../shared/split'

  let state: BrowserState | undefined
  let drag: { pointer: number; offset: number; id: string } | undefined
  let pendingRatio: number | undefined
  let frame = 0
  $: geometry = splitGeometry(state?.split?.width ?? 0, state?.split?.ratio)
  $: position =
    state?.split?.gesture === 'resize'
      ? geometry.leftWidth
      : (splitDividerHitWidth - splitDividerWidth) / 2

  onMount(() => {
    const unsubscribe = window.api.onState((value) => {
      if (state?.split?.gesture === 'resize' && value.split?.gesture !== 'resize') clear()
      state = value
    })
    return () => {
      unsubscribe()
      clear()
    }
  })

  function clear(): void {
    cancelAnimationFrame(frame)
    frame = 0
    drag = undefined
    pendingRatio = undefined
  }

  function flush(): void {
    frame = 0
    if (drag && pendingRatio !== undefined) window.api.resizeSplit(drag.id, pendingRatio)
    pendingRatio = undefined
  }

  function start(event: PointerEvent): void {
    if (event.button !== 0 || !event.isPrimary || !state?.split) return
    event.preventDefault()
    const element = event.currentTarget as HTMLDivElement
    element.focus()
    element.setPointerCapture(event.pointerId)
    drag = {
      pointer: event.pointerId,
      offset: event.clientX - (splitDividerHitWidth - splitDividerWidth) / 2,
      id: state.split.leftId
    }
    window.api.beginSplitGesture(drag.id, 'resize')
  }

  function move(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointer) return
    if (state?.split?.gesture !== 'resize' || innerWidth !== state.split.width) return
    pendingRatio = (event.clientX - drag.offset) / Math.max(1, innerWidth - splitDividerWidth)
    if (!frame) frame = requestAnimationFrame(flush)
  }

  function finish(event?: PointerEvent, cancelled = false): void {
    if (!drag || (event && event.pointerId !== drag.pointer)) return
    if (!cancelled) flush()
    clear()
    window.api.finishSplitGesture(cancelled)
  }

  function key(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      finish(undefined, true)
      return
    }
    if (!state?.split || !['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key))
      return
    event.preventDefault()
    const next =
      event.key === 'Enter'
        ? 0.5
        : event.key === 'Home'
          ? geometry.minimum
          : event.key === 'End'
            ? geometry.maximum
            : geometry.ratio + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 0.1 : 0.02)
    window.api.resizeSplit(state.split.leftId, next)
  }

  function separator(node: HTMLDivElement): { destroy: () => void } {
    node.tabIndex = 0
    const listeners = {
      pointerdown: start,
      pointermove: move,
      pointerup: (event: PointerEvent) => finish(event),
      pointercancel: (event: PointerEvent) => finish(event, true),
      lostpointercapture: (event: PointerEvent) => finish(event, true),
      keydown: key,
      dblclick: () => {
        if (state?.split) window.api.resizeSplit(state.split.leftId, 0.5)
      }
    }
    for (const [type, listener] of Object.entries(listeners))
      node.addEventListener(type, listener as (event: Event) => void)
    return {
      destroy: () => {
        for (const [type, listener] of Object.entries(listeners))
          node.removeEventListener(type, listener as (event: Event) => void)
      }
    }
  }
</script>

<svelte:window
  on:blur={() => finish(undefined, true)}
  on:keydown={(event) => {
    if (event.key === 'Escape') finish(undefined, true)
  }}
/>

<div
  use:separator
  class="divider"
  class:resizing={!!drag}
  role="separator"
  aria-label="Resize split panes"
  aria-orientation="vertical"
  aria-valuemin={Math.round(geometry.minimum * 100)}
  aria-valuemax={Math.round(geometry.maximum * 100)}
  aria-valuenow={Math.round(geometry.ratio * 100)}
  aria-valuetext={`${Math.round(geometry.ratio * 100)}% left pane`}
  title="Drag to resize; double-click to balance; arrow keys to adjust"
  style:--seam={`${position}px`}
></div>

<style>
  .divider {
    position: absolute;
    inset: 0;
    cursor: col-resize;
    touch-action: none;
    outline: none;
  }
  .divider::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: var(--seam);
    width: 2px;
    background: var(--rei-border);
    transition: background-color var(--rei-duration-fast) ease;
  }
  .divider:hover::after,
  .divider:focus-visible::after,
  .divider.resizing::after {
    background: var(--rei-accent);
  }
</style>
