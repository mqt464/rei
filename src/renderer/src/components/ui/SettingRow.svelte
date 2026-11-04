<script lang="ts">
  export let title: string
  export let description = ''
  export let control = ''
  export let stacked = false
</script>

<div class="rei-row" class:rei-row-stacked={stacked}>
  <div class="rei-row-copy">
    {#if control}<label for={control} class="rei-row-title">{title}</label>{:else}<span
        class="rei-row-title">{title}</span
      >{/if}
    {#if description}<p class="rei-description">{description}</p>{/if}
  </div>
  <div class="rei-row-control"><slot /></div>
</div>
