<script lang="ts">
  import { onMount } from 'svelte'

  export let exact = false

  let container: HTMLDivElement
  let active = false
  let x = 0
  let y = 0
  let width = 0
  let height = 0
  let selectedX = 0
  let selectedY = 0
  let selectedWidth = 0
  let selectedHeight = 0

  function updateSelection(): void {
    const selected = container.querySelector<HTMLElement>('[data-fluid-selected]')
    if (!selected) {
      selectedWidth = 0
      selectedHeight = 0
      return
    }
    const targetRect = selected.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    selectedX = targetRect.left - containerRect.left + container.scrollLeft
    selectedY = targetRect.top - containerRect.top + container.scrollTop
    selectedWidth = targetRect.width
    selectedHeight = targetRect.height
  }

  onMount(() => {
    updateSelection()
    const observer = new MutationObserver(updateSelection)
    observer.observe(container, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'data-fluid-selected']
    })
    const resizeObserver = new ResizeObserver(updateSelection)
    resizeObserver.observe(container)
    return () => {
      observer.disconnect()
      resizeObserver.disconnect()
    }
  })

  function moveToNearest(clientX: number, clientY: number): void {
    const targets = [...container.querySelectorAll<HTMLElement>('[data-fluid-hover]')]
    let closest: HTMLElement | undefined
    let nearestDistance = Infinity

    for (const target of targets) {
      const rect = target.getBoundingClientRect()
      const dx = clientX - (rect.left + rect.width / 2)
      const dy = clientY - (rect.top + rect.height / 2)
      const distance = dx * dx + dy * dy
      if (distance < nearestDistance) {
        nearestDistance = distance
        closest = target
      }
    }

    if (!closest) return
    const targetRect = closest.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    x = targetRect.left - containerRect.left + container.scrollLeft
    y = targetRect.top - containerRect.top + container.scrollTop
    width = targetRect.width
    height = targetRect.height
    active = true
  }
</script>

<div
  class="fluid-hover"
  role="presentation"
  bind:this={container}
  on:pointermove={(event) => {
    if (exact && !(event.target as Element).closest('[data-fluid-hover]')) active = false
    else moveToNearest(event.clientX, event.clientY)
  }}
  on:pointerleave={() => (active = false)}
>
  <div
    class="fluid-hover-indicator selected"
    style={`--fluid-hover-x:${selectedX}px;--fluid-hover-y:${selectedY}px;--fluid-hover-width:${selectedWidth}px;--fluid-hover-height:${selectedHeight}px`}
    aria-hidden="true"
  ></div>
  <div
    class="fluid-hover-indicator"
    class:active
    style={`--fluid-hover-x:${x}px;--fluid-hover-y:${y}px;--fluid-hover-width:${width}px;--fluid-hover-height:${height}px`}
    aria-hidden="true"
  ></div>
  <slot />
</div>

<style>
  .fluid-hover {
    position: relative;
    isolation: isolate;
  }

  .fluid-hover-indicator {
    position: absolute;
    z-index: -1;
    top: 0;
    left: 0;
    width: var(--fluid-hover-width);
    height: var(--fluid-hover-height);
    border-radius: var(--rei-hover-radius, calc(var(--rei-radius) * 0.4));
    background: var(--rei-hover);
    opacity: 0;
    pointer-events: none;
    transform: translate(var(--fluid-hover-x), var(--fluid-hover-y));
    transition:
      transform var(--rei-hover-duration, var(--rei-duration-slow)) cubic-bezier(0.2, 0.8, 0.2, 1),
      width var(--rei-hover-duration, var(--rei-duration-slow)) cubic-bezier(0.2, 0.8, 0.2, 1),
      height var(--rei-hover-duration, var(--rei-duration-slow)) cubic-bezier(0.2, 0.8, 0.2, 1),
      opacity var(--rei-duration-fast) ease;
  }

  .fluid-hover-indicator.active {
    opacity: var(--rei-hover-opacity, 0.55);
  }

  .fluid-hover-indicator.selected {
    background: var(--rei-selection);
    opacity: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    .fluid-hover-indicator {
      transition: none;
    }
  }
</style>
