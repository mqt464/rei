<script lang="ts">
  import { onMount } from 'svelte'

  let container: HTMLDivElement
  let active = false
  let x = 0
  let y = 0
  let width = 0
  let height = 0

  function moveToNearest(clientX: number, clientY: number) {
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
  bind:this={container}
  on:pointermove={(event) => moveToNearest(event.clientX, event.clientY)}
  on:pointerleave={() => (active = false)}
>
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
    border-radius: inherit;
    background: currentColor;
    opacity: 0;
    pointer-events: none;
    transform: translate(var(--fluid-hover-x), var(--fluid-hover-y));
    transition:
      transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
      width 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
      height 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
      opacity 120ms ease;
  }

  .fluid-hover-indicator.active {
    opacity: 0.12;
  }

  @media (prefers-reduced-motion: reduce) {
    .fluid-hover-indicator {
      transition: none;
    }
  }
</style>
