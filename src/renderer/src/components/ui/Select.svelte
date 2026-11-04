<script lang="ts">
  import FluidHover from '../FluidHover.svelte'
  import ScrollArea from '../ScrollArea.svelte'
  import { createEventDispatcher, onMount, tick } from 'svelte'
  import { Check, ChevronDown } from '@lucide/svelte'
  export let id: string
  export let label: string
  export let value: string
  export let options: { value: string; label: string }[]
  let trigger: HTMLButtonElement
  let menu: HTMLDivElement
  let opened = false
  let active = 0
  let left = 0
  let top = 0
  let width = 0
  let maxHeight = 240
  let typeahead = ''
  let typedAt = 0
  const dispatch = createEventDispatcher<{ change: string }>()

  async function open(): Promise<void> {
    const bounds = trigger.getBoundingClientRect()
    width = Math.max(bounds.width, 168)
    left = Math.min(bounds.left, innerWidth - width - 8)
    const below = innerHeight - bounds.bottom - 12
    const above = bounds.top - 12
    const menuHeight = Math.min(options.length * 32 + 10, 240)
    maxHeight = Math.max(64, Math.min(240, below >= menuHeight || below >= above ? below : above))
    top =
      below >= menuHeight || below >= above
        ? bounds.bottom + 5
        : bounds.top - Math.min(menuHeight, maxHeight) - 5
    active = Math.max(
      0,
      options.findIndex((option) => option.value === value)
    )
    opened = true
    await tick()
    menu.focus({ preventScroll: true })
    reveal()
  }
  function close(focus = true): void {
    opened = false
    if (focus) trigger.focus({ preventScroll: true })
  }
  function choose(index: number): void {
    value = options[index].value
    dispatch('change', value)
    close()
  }
  function reveal(): void {
    document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' })
  }
  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Tab') {
      close()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    if (['Enter', ' '].includes(event.key)) {
      event.preventDefault()
      choose(active)
      return
    }
    if (event.key === 'ArrowDown') active = (active + 1) % options.length
    else if (event.key === 'ArrowUp') active = (active - 1 + options.length) % options.length
    else if (event.key === 'Home') active = 0
    else if (event.key === 'End') active = options.length - 1
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      typeahead = Date.now() - typedAt > 600 ? event.key : typeahead + event.key
      typedAt = Date.now()
      const index = options.findIndex((option) =>
        option.label.toLowerCase().startsWith(typeahead.toLowerCase())
      )
      if (index >= 0) active = index
    } else return
    event.preventDefault()
    void tick().then(reveal)
  }
  onMount(() => {
    const outside = (event: PointerEvent): void => {
      if (
        opened &&
        !trigger.contains(event.target as Node) &&
        !menu?.contains(event.target as Node)
      )
        close(false)
    }
    const reposition = (event: Event): void => {
      if (opened && !menu?.contains(event.target as Node)) close(false)
    }
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('resize', reposition)
    document.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('resize', reposition)
      document.removeEventListener('scroll', reposition, true)
    }
  })
</script>

<button
  bind:this={trigger}
  {id}
  type="button"
  class="rei-select rei-control"
  role="combobox"
  aria-label={label}
  aria-haspopup="listbox"
  aria-expanded={opened}
  aria-controls={opened ? `${id}-list` : undefined}
  {value}
  on:click={() => (opened ? close() : open())}
  on:keydown={(event) => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      void open()
    }
  }}
>
  <span>{options.find((option) => option.value === value)?.label ?? value}</span><ChevronDown
    size={13}
    aria-hidden="true"
  />
</button>
{#if opened}
  <div
    bind:this={menu}
    id={`${id}-list`}
    class="rei-select-menu"
    role="listbox"
    tabindex="-1"
    aria-label={label}
    aria-activedescendant={`${id}-option-${active}`}
    style:left={`${left}px`}
    style:top={`${top}px`}
    style:width={`${width}px`}
    style:height={`${Math.min(options.length * 32 + 10, maxHeight)}px`}
    on:keydown={keydown}
    on:focusout={(event) => {
      if (!menu.contains(event.relatedTarget as Node)) close(false)
    }}
  >
    <ScrollArea className="rei-select-scroll" background="var(--rei-input)">
      <FluidHover>
        {#each options as option, index (option.value)}
          <div
            id={`${id}-option-${index}`}
            role="option"
            tabindex="-1"
            data-value={option.value}
            data-fluid-hover
            data-fluid-selected={active === index ? '' : undefined}
            aria-selected={value === option.value}
            class:active={active === index}
            on:pointermove={() => (active = index)}
            on:pointerdown|preventDefault
            on:click={() => choose(index)}
            on:keydown={(event) => {
              if (event.key === 'Enter') choose(index)
            }}
          >
            <span>{option.label}</span>{#if value === option.value}<Check
                size={13}
                aria-hidden="true"
              />{/if}
          </div>
        {/each}
      </FluidHover>
    </ScrollArea>
  </div>
{/if}
