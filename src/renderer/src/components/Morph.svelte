<script lang="ts">
  import { TextMorph } from 'torph'
  import type { ActionReturn } from 'svelte/action'
  import { textMorphOptions } from '../../../shared/textMorph'
  import type { TextMorphCategory, TextMorphPreset } from '../../../shared/textMorph'
  import { motionMode, theme } from '../theme'

  export let text: string
  export let preset: TextMorphPreset = 'status'
  export let category: TextMorphCategory | undefined = undefined
  export let throttle = 0

  const categories = {
    counter: 'textMorphCounters',
    status: 'textMorphStatus',
    action: 'textMorphActions',
    title: 'textMorphTitles'
  } as const
  $: options = textMorphOptions(
    $theme,
    preset,
    category ?? categories[preset],
    $motionMode !== 'full'
  )

  function morph(
    node: HTMLSpanElement,
    initial: { text: string; options: typeof options; throttle: number }
  ): ActionReturn<typeof initial> {
    let value = initial
    let instance: TextMorph | undefined
    let config = ''
    let timer: ReturnType<typeof setTimeout> | undefined
    let lastUpdate = -Infinity

    function plain(): void {
      instance?.destroy()
      instance = undefined
      config = ''
      node.textContent = value.text
    }

    function render(): void {
      clearTimeout(timer)
      timer = undefined
      lastUpdate = performance.now()
      if (value.options.disabled || value.text.length > 160) {
        plain()
        return
      }
      const nextConfig = JSON.stringify(value.options)
      if (!instance || config !== nextConfig) {
        plain()
        instance = new TextMorph({ element: node, ...value.options })
        config = nextConfig
        if (!value.text) instance.update('\u200b')
      }
      instance.update(value.text)
      checkOverflow()
    }

    function checkOverflow(): void {
      const available = node.parentElement?.clientWidth ?? 0
      if (instance && available > 0 && node.scrollWidth > available) plain()
    }

    const observer = new ResizeObserver(checkOverflow)
    if (node.parentElement) observer.observe(node.parentElement)
    render()
    return {
      update(next: typeof initial): void {
        const configChanged = JSON.stringify(value.options) !== JSON.stringify(next.options)
        value = next
        const remaining = value.throttle - (performance.now() - lastUpdate)
        if (!configChanged && !value.options.disabled && value.text && remaining > 0) {
          if (!timer) timer = setTimeout(render, remaining)
        } else render()
      },
      destroy(): void {
        clearTimeout(timer)
        observer.disconnect()
        instance?.destroy()
      }
    }
  }
</script>

<span style:display={text ? undefined : 'none'} use:morph={{ text, options, throttle }}></span>
