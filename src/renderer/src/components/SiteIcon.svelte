<script lang="ts">
  import { Globe } from '@lucide/svelte'
  import { onDestroy } from 'svelte'
  export let src: string | undefined = undefined
  export let url: string | undefined = undefined
  let image: string | undefined
  let version = 0
  $: void resolveIcon(src, url)
  onDestroy(() => {
    version += 1
  })

  async function resolveIcon(
    source: string | undefined,
    address: string | undefined
  ): Promise<void> {
    const request = ++version
    image = undefined
    if (!source && address) {
      try {
        source = new URL('/favicon.ico', address).href
      } catch {
        return
      }
    }
    if (!source) return
    try {
      const resolved = /^data:image\//i.test(source) ? source : await window.api.favicon(source)
      if (request === version) image = resolved ?? undefined
    } catch {
      return
    }
  }
</script>

<span class="site-icon" aria-hidden="true">
  {#if image}
    <img src={image} alt="" referrerpolicy="no-referrer" on:error={() => (image = undefined)} />
  {:else}
    <Globe size={16} />
  {/if}
</span>
