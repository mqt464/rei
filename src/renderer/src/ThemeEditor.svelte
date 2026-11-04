<script lang="ts">
  import { defaultTheme, maxWallpaperBytes } from '../../shared/theme'
  import type { Theme, ThemePatch } from '../../shared/theme'
  import { palette, theme, themeError, updateTheme, wallpaperSource } from './theme'
  import AppearanceOptions from './AppearanceOptions.svelte'
  import { smoothText } from './smoothText'
  import { Button, Card, Select, SettingRow, Slider, Switch } from './components/ui'

  export let mode: 'appearance' | 'wallpaper' | 'caret' | 'motion' = 'appearance'
  let fileInput: HTMLInputElement
  let loadingImage = false
  let openingFile = false
  let fileError = ''
  let invalidColors: string[] = []
  let motionPreview = false
  let appearanceOptions: AppearanceOptions
  const colorGroups = [
    {
      title: 'Surfaces',
      fields: [
        { key: 'background', label: 'Page' },
        { key: 'surface', label: 'Cards' },
        { key: 'sidebar', label: 'Tab sidebar' },
        { key: 'topbar', label: 'Address bar' },
        { key: 'input', label: 'Inputs' },
        { key: 'button', label: 'Buttons' },
        { key: 'hover', label: 'Hover' },
        { key: 'selection', label: 'Selection' },
        { key: 'border', label: 'Outlines' },
        { key: 'scrollbar', label: 'Scrollbar' }
      ]
    },
    {
      title: 'Text & accents',
      fields: [
        { key: 'text', label: 'Text' },
        { key: 'muted', label: 'Muted text' },
        { key: 'accent', label: 'Accent' },
        { key: 'accentText', label: 'On accent' },
        { key: 'focus', label: 'Focus ring' },
        { key: 'caret', label: 'Caret' },
        { key: 'error', label: 'Errors' }
      ]
    }
  ] as const
  const caretControls = [
    { key: 'caretWidth', label: 'Width', min: 1, max: 12, unit: 'px' },
    { key: 'caretHeight', label: 'Height', min: 10, max: 28, unit: 'px' },
    { key: 'caretRadius', label: 'Corner radius', min: 0, max: 6, unit: 'px' },
    { key: 'caretOpacity', label: 'Opacity', min: 20, max: 100, unit: '%' }
  ] as const

  async function changeColor(key: keyof Theme['colors'], value: string): Promise<void> {
    invalidColors = invalidColors.filter((field) => field !== key)
    if (!/^#[\da-f]{6}$/i.test(value)) {
      invalidColors = [...invalidColors, key]
      return
    }
    await updateTheme({ paletteMode: 'custom', colors: { ...$palette, [key]: value } })
  }
  async function openFile(): Promise<void> {
    openingFile = true
    try {
      await window.api.openThemeFile()
      fileError = ''
    } catch (error) {
      fileError =
        error instanceof Error
          ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
          : 'Could not open theme.json.'
    } finally {
      openingFile = false
    }
  }
  async function chooseWallpaper(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    loadingImage = true
    try {
      if (
        !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
        file.size > maxWallpaperBytes ||
        !file.size
      )
        throw new Error('Choose a PNG, JPEG, or WebP image smaller than 6 MB.')
      const source = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('Could not read that image. Choose another file.'))
        reader.readAsDataURL(file)
      })
      const image = new Image()
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('Could not open that image. Choose another file.'))
        image.src = source
      })
      if (image.naturalWidth * image.naturalHeight > 40000000)
        throw new Error('Choose an image smaller than 40 megapixels.')
      await updateTheme({ wallpaper: source, wallpaperFolder: '' })
    } catch (error) {
      themeError.set(
        error instanceof Error ? error.message : 'Could not open that image. Try another file.'
      )
    } finally {
      loadingImage = false
      input.value = ''
    }
  }
  function reset(keys: (keyof Theme)[]): void {
    invalidColors = []
    const patch: ThemePatch = {}
    for (const key of keys) Object.assign(patch, { [key]: defaultTheme[key] })
    void updateTheme(patch)
  }
</script>

{#if mode === 'wallpaper'}
  <Card>
    <SettingRow title="Blank-page wallpaper" description="PNG, JPEG, or WebP. Up to 6 MB.">
      <Button busy={loadingImage} on:click={() => fileInput.click()}
        >{loadingImage
          ? 'Opening image\u2026'
          : $theme.wallpaper
            ? 'Replace image'
            : 'Choose image'}</Button
      >
      {#if $theme.wallpaper}<Button on:click={() => updateTheme({ wallpaper: null })}>Remove</Button
        >{/if}
    </SettingRow>
  </Card>
  <input
    id="wallpaper-file"
    bind:this={fileInput}
    type="file"
    accept="image/png,image/jpeg,image/webp"
    hidden
    on:change={chooseWallpaper}
  />
  {#if $wallpaperSource}
    <div class="wallpaper-preview">
      <img
        src={$wallpaperSource}
        alt="Current blank-page wallpaper"
        width="680"
        height="220"
        style:object-fit={$theme.wallpaperFit}
        style:object-position={$theme.wallpaperPosition}
        style:filter={`blur(${$theme.wallpaperBlur}px)`}
      />
      <div class="wallpaper-dim" style:opacity={$theme.wallpaperDim / 100}></div>
      <div class="wallpaper-fade"></div>
    </div>
  {/if}
  <div class="editor-gap">
    <Card>
      <SettingRow title="Image fit" control="wallpaper-fit"
        ><Select
          id="wallpaper-fit"
          label="Image fit"
          value={$theme.wallpaperFit}
          options={[
            { value: 'cover', label: 'Fill' },
            { value: 'contain', label: 'Fit' }
          ]}
          on:change={(event) =>
            updateTheme({ wallpaperFit: event.detail as Theme['wallpaperFit'] })}
        /></SettingRow
      >
      <SettingRow title="Dim image" control="wallpaper-dim"
        ><Slider
          id="wallpaper-dim"
          label="Dim image"
          value={$theme.wallpaperDim}
          min={0}
          max={80}
          unit="%"
          on:change={(event) => updateTheme({ wallpaperDim: event.detail })}
        /></SettingRow
      >
    </Card>
  </div>
  <div class="editor-gap"><AppearanceOptions mode="wallpaper" /></div>
{:else if mode === 'caret'}
  <Card
    ><div class="caret-preview">
      <input
        use:smoothText
        class="rei-control"
        aria-label="Caret preview text"
        name="caret-preview"
        autocomplete="off"
        spellcheck={false}
        placeholder="Click here to try the text cursor"
      />
    </div></Card
  >
  <Card>
    <SettingRow title="Address-bar caret" control="caret-style"
      ><Select
        id="caret-style"
        label="Caret shape"
        value={$theme.caretStyle}
        options={[
          { value: 'line', label: 'Line' },
          { value: 'block', label: 'Block' },
          { value: 'underline', label: 'Underline' }
        ]}
        on:change={(event) =>
          updateTheme({
            caretStyle: event.detail as Theme['caretStyle'],
            caretWidth: event.detail === 'line' ? 1 : 8
          })}
      /></SettingRow
    >
    {#each caretControls as control (control.key)}
      <SettingRow title={control.label} control={control.key}
        ><Slider
          id={control.key}
          label={`Caret ${control.label.toLowerCase()}`}
          value={$theme[control.key]}
          min={control.min}
          max={control.max}
          unit={control.unit}
          disabled={control.key === 'caretHeight' && $theme.caretStyle === 'underline'}
          on:change={(event) => updateTheme({ [control.key]: event.detail })}
        /></SettingRow
      >
    {/each}
  </Card>
  <div class="editor-gap">
    <Card>
      <SettingRow title="Blink" control="caret-blink"
        ><Switch
          id="caret-blink"
          label="Blink caret"
          checked={$theme.caretBlink}
          on:change={(event) => updateTheme({ caretBlink: event.detail })}
        /></SettingRow
      >
      <SettingRow title="Blink interval" control="caret-interval"
        ><Slider
          id="caret-interval"
          label="Caret blink interval"
          value={$theme.caretBlinkInterval}
          min={300}
          max={1600}
          step={50}
          unit="ms"
          disabled={!$theme.caretBlink}
          on:change={(event) => updateTheme({ caretBlinkInterval: event.detail })}
        /></SettingRow
      >
      <SettingRow title="Smooth movement" control="caret-smooth"
        ><Switch
          id="caret-smooth"
          label="Smooth caret movement"
          checked={$theme.caretSmooth}
          on:change={(event) => updateTheme({ caretSmooth: event.detail })}
        /></SettingRow
      >
      <SettingRow title="Animate while typing" control="caret-smooth-typing">
        <Switch
          id="caret-smooth-typing"
          label="Animate caret while typing"
          checked={$theme.caretSmoothTyping}
          on:change={(event) => updateTheme({ caretSmoothTyping: event.detail })}
        />
      </SettingRow>
      <SettingRow title="Movement duration" control="caret-move-duration">
        <Slider
          id="caret-move-duration"
          label="Caret and selection movement duration"
          value={$theme.caretMoveDuration}
          min={0}
          max={200}
          step={10}
          unit="ms"
          on:change={(event) => updateTheme({ caretMoveDuration: event.detail })}
        />
      </SettingRow>
      <SettingRow title="Smooth selection" control="selection-smooth">
        <Switch
          id="selection-smooth"
          label="Smooth text selection"
          checked={$theme.selectionSmooth}
          on:change={(event) => updateTheme({ selectionSmooth: event.detail })}
        />
      </SettingRow>
      <SettingRow title="Selection corners" control="selection-radius">
        <Slider
          id="selection-radius"
          label="Selection corner radius"
          value={$theme.selectionRadius}
          min={0}
          max={8}
          unit="px"
          on:change={(event) => updateTheme({ selectionRadius: event.detail })}
        />
      </SettingRow>
    </Card>
  </div>
  <div class="reset-row">
    <Button
      on:click={() =>
        reset([
          'caretStyle',
          'caretWidth',
          'caretHeight',
          'caretRadius',
          'caretOpacity',
          'caretBlink',
          'caretBlinkInterval',
          'caretSmooth',
          'caretSmoothTyping',
          'caretMoveDuration',
          'selectionSmooth',
          'selectionRadius'
        ])}>Reset caret</Button
    >
  </div>
{:else if mode === 'motion'}
  <Card>
    <SettingRow title="Animations" control="theme-motion"
      ><Select
        id="theme-motion"
        label="Animations"
        value={$theme.motion}
        options={[
          { value: 'system', label: 'Follow system' },
          { value: 'reduced', label: 'Reduced' },
          { value: 'none', label: 'Off' }
        ]}
        on:change={(event) => updateTheme({ motion: event.detail as Theme['motion'] })}
      /></SettingRow
    >
    <SettingRow title="Animation speed" control="theme-speed"
      ><Slider
        id="theme-speed"
        label="Animation speed"
        value={$theme.animationSpeed}
        min={50}
        max={200}
        step={10}
        unit="%"
        disabled={$theme.motion !== 'system'}
        on:change={(event) => updateTheme({ animationSpeed: event.detail })}
      /></SettingRow
    >
    <SettingRow title="Preview motion"
      ><div class="motion-track"><span class:moved={motionPreview}></span></div>
      <Button on:click={() => (motionPreview = !motionPreview)}>Preview</Button></SettingRow
    >
  </Card>
  <div class="reset-row">
    <Button on:click={() => reset(['motion', 'animationSpeed'])}>Reset motion</Button>
  </div>
{:else}
  <h2 class="first-heading">System appearance</h2>
  <Card
    ><SettingRow title="Switch palette" control="theme-palette"
      ><Select
        id="theme-palette"
        label="Switch palette"
        value={$theme.paletteMode}
        options={[
          { value: 'system', label: 'System' },
          { value: 'custom', label: 'Custom' },
          { value: 'dark', label: 'Dark' },
          { value: 'light', label: 'Light' }
        ]}
        on:change={(event) => updateTheme({ paletteMode: event.detail as Theme['paletteMode'] })}
      /></SettingRow
    ></Card
  >
  <div class="palette">
    {#each colorGroups as group (group.title)}
      <div>
        <h2>{group.title}</h2>
        <Card>
          {#each group.fields as field (field.key)}
            <div class="rei-row color-setting">
              <label for={`color-${field.key}`}>{field.label}</label>
              <div class="color-controls">
                <input
                  id={`color-${field.key}`}
                  class="rei-colour"
                  type="color"
                  value={$palette[field.key]}
                  aria-label={`${field.label} colour`}
                  on:change={(event) => changeColor(field.key, event.currentTarget.value)}
                />
                <input
                  class="rei-control rei-hex hex-input"
                  name={`hex-${field.key}`}
                  type="text"
                  maxlength="7"
                  spellcheck={false}
                  autocomplete="off"
                  aria-label={`${field.label} hex colour`}
                  aria-invalid={invalidColors.includes(field.key)}
                  aria-describedby={invalidColors.includes(field.key)
                    ? `colour-error-${field.key}`
                    : undefined}
                  value={$palette[field.key]}
                  on:change={(event) => changeColor(field.key, event.currentTarget.value)}
                />
              </div>
              {#if invalidColors.includes(field.key)}<p
                  class="theme-error colour-error"
                  id={`colour-error-${field.key}`}
                  role="alert"
                >
                  Use a six-digit hex colour, such as #a5f3fc.
                </p>{/if}
            </div>
          {/each}
        </Card>
      </div>
    {/each}
  </div>
  <AppearanceOptions bind:this={appearanceOptions} />
  <div class="editor-gap">
    <Card
      ><SettingRow title="Theme JSON"
        ><Button busy={openingFile} on:click={openFile}>Open theme.json</Button></SettingRow
      ></Card
    >
  </div>
  <h2>Extra</h2>
  <Card
    ><SettingRow title="Reset appearance"
      ><Button on:click={() => appearanceOptions.resetAppearance()}>Reset appearance</Button
      ></SettingRow
    ></Card
  >
{/if}
{#if fileError}<p id="theme-file-error" class="theme-error" role="alert">{fileError}</p>{/if}
{#if $themeError}<p id="theme-error" class="theme-error" role="alert">{$themeError}</p>{/if}

<style>
  h2 {
    margin: 20px 0 9px;
    color: var(--rei-muted);
    font-size: var(--rei-font-size);
    font-weight: 500;
  }
  .first-heading {
    margin-top: 0;
  }
  .palette {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
    gap: 20px;
    margin-bottom: 20px;
  }
  .color-setting {
    min-height: 45px;
    padding: 9px 12px;
    flex-wrap: wrap;
    gap: 8px;
  }
  .color-setting label {
    font-size: var(--rei-font-size);
  }
  .color-controls {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-left: auto;
  }
  .theme-error {
    margin-top: 12px;
    color: var(--rei-error);
    font-size: var(--rei-font-size);
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .colour-error {
    width: 100%;
    margin: 0;
  }
  .editor-gap {
    margin-top: 14px;
  }
  .reset-row {
    display: flex;
    justify-content: flex-end;
    margin-top: 16px;
  }
  .wallpaper-preview {
    position: relative;
    margin-top: 14px;
    overflow: hidden;
    border: 1px solid var(--rei-border);
    border-radius: var(--rei-radius);
    background: var(--rei-background);
  }
  .wallpaper-preview img {
    display: block;
    width: 100%;
    height: 220px;
  }
  .wallpaper-dim {
    position: absolute;
    inset: 0;
    background: var(--rei-background);
    pointer-events: none;
  }
  .wallpaper-fade {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(
      to bottom,
      transparent calc(100% - var(--rei-wallpaper-fade)),
      var(--rei-background)
    );
  }
  .caret-preview {
    position: relative;
    padding: 16px;
    overflow: hidden;
  }
  .caret-preview input {
    width: 100%;
  }
  .motion-track {
    position: relative;
    width: 100px;
    height: 20px;
    background: var(--rei-input);
    border-radius: 20px;
  }
  .motion-track span {
    display: block;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--rei-accent);
    transform: translateX(0);
    transition: transform var(--rei-duration-slow) cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .motion-track span.moved {
    transform: translateX(80px);
  }
</style>
