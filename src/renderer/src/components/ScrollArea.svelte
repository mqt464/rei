<script lang="ts">
  import { onDestroy, onMount } from 'svelte'

  export let background = 'transparent'
  export let className = ''

  let area: HTMLDivElement
  let atTop = true
  let atBottom = true
  let visible = false
  let hideTimer: ReturnType<typeof setTimeout>

  function syncEdges(): void {
    if (!area) return
    atTop = area.scrollTop <= 1
    atBottom = area.scrollTop + area.clientHeight >= area.scrollHeight - 1
  }

  function showScrollbar(): void {
    visible = true
    clearTimeout(hideTimer)
    hideTimer = setTimeout(() => (visible = false), 2000)
  }

  onMount(() => {
    const observer = new ResizeObserver(syncEdges)
    observer.observe(area)
    if (area.firstElementChild) observer.observe(area.firstElementChild)
    syncEdges()
    return () => observer.disconnect()
  })

  onDestroy(() => clearTimeout(hideTimer))
</script>

<div
  class={`scroll-frame ${className}`}
  class:at-top={atTop}
  class:at-bottom={atBottom}
  class:scrollbar-visible={visible}
  style={`--scroll-area-background: ${background}`}
  on:mouseenter={showScrollbar}
  on:mouseleave={() => (hideTimer = setTimeout(() => (visible = false), 2000))}
>
  <div bind:this={area} class="scroll-area" on:scroll={() => { syncEdges(); showScrollbar() }}>
    <slot />
  </div>
</div>

<style>
  .scroll-frame {
    position: relative;
    min-height: 0;
    overflow: hidden;
  }

  .scroll-frame::before,
  .scroll-frame::after {
    position: absolute;
    z-index: 1;
    right: 0;
    left: 0;
    content: '';
    opacity: 1;
    pointer-events: none;
    transition: opacity 180ms ease;
  }

  .scroll-frame::before {
    top: 0;
    height: 24px;
    background: linear-gradient(var(--scroll-area-background), transparent);
  }

  .scroll-frame::after {
    bottom: 0;
    height: 44px;
    background: linear-gradient(transparent, var(--scroll-area-background));
  }

  .scroll-frame.at-top::before,
  .scroll-frame.at-bottom::after {
    opacity: 0;
  }

  .scroll-area {
    width: 100%;
    height: 100%;
    overflow: auto;
    scrollbar-width: thin;
    scrollbar-color: transparent transparent;
    scrollbar-gutter: auto;
    transition: scrollbar-color 240ms ease;
  }

  .scrollbar-visible .scroll-area {
    scrollbar-color: rgb(69 69 75 / 85%) transparent;
  }

  .scroll-area::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  .scroll-area::-webkit-scrollbar-track {
    background: transparent;
  }

  .scroll-area::-webkit-scrollbar-button {
    display: none;
    width: 0;
    height: 0;
  }

  .scroll-area::-webkit-scrollbar-thumb {
    border: 1px solid transparent;
    border-radius: 999px;
    background: rgb(69 69 75 / 0%);
    background-clip: padding-box;
    transition: background-color 240ms ease;
  }

  .scrollbar-visible .scroll-area::-webkit-scrollbar-thumb {
    background-color: rgb(69 69 75 / 85%);
  }

  @media (prefers-reduced-motion: reduce) {
    .scroll-frame::before,
    .scroll-frame::after,
    .scroll-area,
    .scroll-area::-webkit-scrollbar-thumb {
      transition: none;
    }
  }
</style>
