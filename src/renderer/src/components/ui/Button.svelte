<script lang="ts">
  export let type: 'button' | 'submit' = 'button'
  export let disabled = false
  export let busy = false
</script>

<button
  {...$$restProps}
  {type}
  disabled={disabled || busy}
  aria-busy={busy || undefined}
  class="rei-button"
  on:click><slot /></button
>
