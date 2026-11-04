<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  export let id: string
  export let checked: boolean
  export let label: string
  const dispatch = createEventDispatcher<{ change: boolean }>()
</script>

<button
  {id}
  type="button"
  class="rei-switch switch"
  class:enabled={checked}
  role="switch"
  aria-label={label}
  aria-checked={checked}
  on:click={() => dispatch('change', !checked)}><span></span></button
>
