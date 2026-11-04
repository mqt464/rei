<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  export let id: string
  export let label: string
  export let value: number
  export let min: number
  export let max: number
  export let step = 1
  export let unit = ''
  export let disabled = false
  export let offAtZero = false
  export let formatValue: ((value: number) => string) | undefined = undefined
  const dispatch = createEventDispatcher<{ change: number }>()
  $: formattedValue =
    offAtZero && value === 0 ? 'Off' : formatValue ? formatValue(value) : `${value}${unit}`
</script>

<div class="rei-slider-control" class:rei-disabled={disabled}>
  <input
    {id}
    name={id}
    class="rei-slider"
    type="range"
    {min}
    {max}
    {step}
    {disabled}
    bind:value
    aria-label={label}
    aria-valuetext={formattedValue}
    style:--slider-fill={`${((value - min) / (max - min)) * 100}%`}
    on:change={() => dispatch('change', Number(value))}
  />
  <output for={id} class:rei-duration-value={!!formatValue}>{formattedValue}</output>
</div>
