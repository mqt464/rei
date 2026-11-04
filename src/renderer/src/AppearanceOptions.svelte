<script lang="ts">
  import { defaultTheme, themeFonts } from '../../shared/theme'
  import type { Theme, ThemePatch } from '../../shared/theme'
  import { theme, themeError, updateTheme, wallpaperError } from './theme'
  import { Button, Card, Select, SettingRow, Slider, Switch } from './components/ui'

  export let mode: 'appearance' | 'wallpaper' = 'appearance'
  let choosingFolder = false
  const options = (values: string[]): { value: string; label: string }[] =>
    values.map((value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) }))
  const groups = [
    {
      title: 'Typography',
      sliders: [
        { key: 'fontSize', label: 'Interface text size', min: 10, max: 18, unit: 'px' },
        { key: 'fontWeight', label: 'Interface font weight', min: 300, max: 700, unit: '' },
        { key: 'lineHeight', label: 'Interface line spacing', min: 100, max: 220, unit: '%' }
      ]
    },
    {
      title: 'Website typography',
      sliders: [
        { key: 'webpageFontSize', label: 'Website text size', min: 0, max: 32, unit: 'px' },
        { key: 'webpageLineHeight', label: 'Website line spacing', min: 0, max: 240, unit: '%' }
      ]
    },
    {
      title: 'Layout',
      sliders: [
        { key: 'radius', label: 'Corner radius', min: 0, max: 16, unit: 'px' },
        { key: 'spacing', label: 'Custom spacing', min: 4, max: 24, unit: 'px' },
        { key: 'sidebarWidth', label: 'Sidebar width', min: 150, max: 360, unit: 'px' }
      ]
    },
    {
      title: 'Tabs',
      sliders: [
        { key: 'tabHeight', label: 'Tab height', min: 26, max: 56, unit: 'px' },
        { key: 'tabIconSize', label: 'Tab icon size', min: 12, max: 24, unit: 'px' }
      ]
    },
    {
      title: 'Address bar',
      sliders: [
        { key: 'addressBarHeight', label: 'Height', min: 32, max: 64, unit: 'px' },
        { key: 'addressBarOpacity', label: 'Opacity', min: 20, max: 100, unit: '%' },
        { key: 'addressBarRadius', label: 'Address bar corner radius', min: 0, max: 24, unit: 'px' }
      ]
    },
    {
      title: 'Scrolling',
      sliders: [
        { key: 'scrollbarWidth', label: 'Scrollbar thickness', min: 3, max: 16, unit: 'px' },
        { key: 'edgeFade', label: 'Scroll edge fade', min: 0, max: 100, unit: '%' }
      ]
    },
    {
      title: 'Hover',
      sliders: [
        { key: 'hoverOpacity', label: 'Hover opacity', min: 0, max: 100, unit: '%' },
        { key: 'hoverRadius', label: 'Hover corner radius', min: 0, max: 24, unit: 'px' },
        { key: 'hoverSpeed', label: 'Hover speed', min: 50, max: 200, unit: '%' }
      ]
    }
  ] as const
  const selects = {
    tabIndicator: { label: 'Active-tab indicator', values: options(['fill', 'line', 'none']) },
    tabCloseButton: { label: 'Close buttons', values: options(['hover', 'always', 'never']) },
    addressBarAlignment: { label: 'Alignment', values: options(['left', 'center', 'right']) },
    scrollbarVisibility: {
      label: 'Scrollbar visibility',
      values: options(['auto', 'always', 'hidden'])
    }
  } as const
  function set(key: keyof Theme, value: unknown): void {
    void updateTheme({ [key]: value })
  }
  async function chooseFolder(): Promise<void> {
    choosingFolder = true
    try {
      await updateTheme(await window.api.chooseWallpaperFolder())
    } catch (error) {
      themeError.set(error instanceof Error ? error.message : 'Could not open wallpaper folder.')
    } finally {
      choosingFolder = false
    }
  }
  export function resetAppearance(): void {
    const keys = [
      ...groups.flatMap((group) => group.sliders.map((field) => field.key)),
      ...Object.keys(selects),
      'density',
      'sidebarIconsOnly',
      'webpageFont',
      'font',
      'colors',
      'paletteMode'
    ] as (keyof Theme)[]
    const patch: ThemePatch = {}
    for (const key of keys) Object.assign(patch, { [key]: defaultTheme[key] })
    void updateTheme(patch)
  }
</script>

{#if mode === 'wallpaper'}
  <Card>
    <SettingRow title="Image position" control="wallpaper-position"
      ><Select
        id="wallpaper-position"
        label="Image position"
        value={$theme.wallpaperPosition}
        options={options(['center', 'top', 'bottom', 'left', 'right'])}
        on:change={(event) => set('wallpaperPosition', event.detail)}
      /></SettingRow
    >
    {#each [{ key: 'wallpaperBlur', label: 'Blur', max: 40, unit: 'px' }, { key: 'wallpaperBottomFade', label: 'Bottom fade', max: 100, unit: '%' }] as field (field.key)}
      <SettingRow title={field.label} control={field.key}
        ><Slider
          id={field.key}
          label={field.label}
          value={$theme[field.key]}
          min={0}
          max={field.max}
          unit={field.unit}
          on:change={(event) => set(field.key as keyof Theme, event.detail)}
        /></SettingRow
      >
    {/each}
    <SettingRow title="Dither image" control="wallpaper-dither"
      ><Switch
        id="wallpaper-dither"
        label="Dither image"
        checked={$theme.wallpaperDither}
        on:change={(event) => set('wallpaperDither', event.detail)}
      /></SettingRow
    >
  </Card>
  <Card>
    <SettingRow title="Wallpaper slideshow" description={$theme.wallpaperFolder}
      ><Button busy={choosingFolder} on:click={chooseFolder}>Choose folder</Button
      >{#if $theme.wallpaperFolder}<Button on:click={() => set('wallpaperFolder', '')}
          >Stop slideshow</Button
        >{/if}</SettingRow
    >
    <SettingRow title="Change image every" control="wallpaper-interval"
      ><Slider
        id="wallpaper-interval"
        label="Change image every"
        value={$theme.wallpaperInterval}
        min={10}
        max={86400}
        step={10}
        unit="s"
        disabled={!$theme.wallpaperFolder}
        on:change={(event) => set('wallpaperInterval', event.detail)}
      /></SettingRow
    >
  </Card>
  {#if $wallpaperError}<p class="rei-description" role="alert">{$wallpaperError}</p>{/if}
{:else}
  {#each groups as group (group.title)}
    <h2>{group.title}</h2>
    <Card>
      {#if group.title === 'Typography'}
        <SettingRow title="Interface font" control="theme-font"
          ><Select
            id="theme-font"
            label="Interface font"
            value={$theme.font}
            options={Object.entries(themeFonts).map(([value, font]) => ({
              value,
              label: font.label
            }))}
            on:change={(event) => set('font', event.detail)}
          /></SettingRow
        >
      {/if}
      {#if group.title === 'Website typography'}
        <SettingRow title="Website font" control="webpage-font"
          ><Select
            id="webpage-font"
            label="Website font"
            value={$theme.webpageFont}
            options={[
              { value: 'website', label: 'Website default' },
              ...Object.entries(themeFonts).map(([value, font]) => ({ value, label: font.label }))
            ]}
            on:change={(event) => set('webpageFont', event.detail)}
          /></SettingRow
        >
      {/if}
      {#if group.title === 'Layout'}
        <SettingRow title="Interface density" control="theme-density"
          ><Select
            id="theme-density"
            label="Interface density"
            value={$theme.density}
            options={options(['compact', 'comfortable', 'custom'])}
            on:change={(event) => set('density', event.detail)}
          /></SettingRow
        >
        <SettingRow title="Icon-only sidebar" control="sidebar-icons-only"
          ><Switch
            id="sidebar-icons-only"
            label="Icon-only sidebar"
            checked={$theme.sidebarIconsOnly}
            on:change={(event) => set('sidebarIconsOnly', event.detail)}
          /></SettingRow
        >
      {/if}
      {#each group.sliders as field (field.key)}
        <SettingRow
          title={field.label}
          control={field.key === 'fontSize'
            ? 'theme-size'
            : field.key === 'radius'
              ? 'theme-radius'
              : `appearance-${field.key}`}
          description={field.key === 'webpageFontSize' || field.key === 'webpageLineHeight'
            ? '0 keeps the website setting.'
            : ''}
        >
          <Slider
            id={field.key === 'fontSize'
              ? 'theme-size'
              : field.key === 'radius'
                ? 'theme-radius'
                : `appearance-${field.key}`}
            label={field.label}
            value={$theme[field.key]}
            min={field.min}
            max={field.max}
            unit={field.unit}
            step={field.key === 'fontWeight' ? 100 : 1}
            disabled={(field.key === 'spacing' && $theme.density !== 'custom') ||
              (field.key === 'sidebarWidth' && $theme.sidebarIconsOnly)}
            on:change={(event) => set(field.key, event.detail)}
          />
        </SettingRow>
      {/each}
      {#each Object.entries(selects).filter( ([key]) => (group.title === 'Tabs' ? key.startsWith('tab') : group.title === 'Address bar' ? key === 'addressBarAlignment' : group.title === 'Scrolling' ? key === 'scrollbarVisibility' : false) ) as [key, field] (key)}
        <SettingRow title={field.label} control={`appearance-${key}`}
          ><Select
            id={`appearance-${key}`}
            label={field.label}
            value={$theme[key]}
            options={field.values}
            on:change={(event) => set(key as keyof Theme, event.detail)}
          /></SettingRow
        >
      {/each}
    </Card>
  {/each}
{/if}

<style>
  h2 {
    margin: 20px 0 9px;
    color: var(--rei-muted);
    font-size: var(--rei-font-size);
    font-weight: 500;
  }
</style>
