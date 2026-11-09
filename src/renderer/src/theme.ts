import { writable } from 'svelte/store'
import { actionError } from './errors'
import { defaultTheme, themeColors, themeFonts } from '../../shared/theme'
import { renderWallpaper, wallpaperKey } from './wallpaper'
import type { Theme, ThemePatch } from '../../shared/theme'

export const theme = writable<Theme>(defaultTheme)
export const motionMode = writable<'full' | 'reduced' | 'none'>('full')
export const palette = writable(defaultTheme.colors)
export const themeError = writable('')
export const wallpaperSource = writable<string | null>(null)
export const wallpaperError = writable('')
const systemAppearance = matchMedia('(prefers-color-scheme: dark)')
let lastTheme = defaultTheme
let imageKey = ''
let imageGeneration = 0
let rotation: ReturnType<typeof setInterval> | undefined

function syncWallpaper(value: Theme): void {
  if (['#tabs', '#context-menu', '#find'].includes(location.hash)) return
  const key = wallpaperKey(value)
  if (imageKey === key) return
  imageKey = key
  clearInterval(rotation)
  const generation = ++imageGeneration
  let index = 0
  const update = async (): Promise<void> => {
    try {
      const source = value.wallpaperFolder
        ? await window.api.wallpaperImage(index++)
        : value.wallpaper
      const rendered = source ? await renderWallpaper(source, value.wallpaperDither) : null
      if (generation !== imageGeneration) return
      wallpaperSource.set(rendered)
      document.documentElement.style.setProperty(
        '--rei-wallpaper',
        rendered ? `url("${rendered}")` : 'none'
      )
      wallpaperError.set('')
    } catch (error) {
      if (generation === imageGeneration)
        wallpaperError.set(error instanceof Error ? error.message : 'Could not load wallpaper.')
    }
  }
  void update()
  if (value.wallpaperFolder)
    rotation = setInterval(() => void update(), value.wallpaperInterval * 1000)
}
systemAppearance.addEventListener('change', () => applyTheme(lastTheme))
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')

function applyMotion(value: Theme): void {
  const mode =
    value.motion === 'system' ? (reducedMotion.matches ? 'reduced' : 'full') : value.motion
  document.documentElement.dataset.motion = mode
  motionMode.set(mode)
}
reducedMotion.addEventListener('change', () => {
  theme.update((value) => {
    applyMotion(value)
    return value
  })
})

function applyTheme(value: Theme): void {
  lastTheme = value
  const style = document.documentElement.style
  const colors = themeColors(value, systemAppearance.matches)
  palette.set(colors)
  for (const [key, color] of Object.entries(colors))
    style.setProperty(
      `--rei-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
      color
    )
  style.setProperty('--rei-font', themeFonts[value.font].family)
  style.setProperty('--rei-font-size', `${value.fontSize}px`)
  style.setProperty('--rei-radius', `${value.radius}px`)
  const spacing =
    value.density === 'comfortable' ? 18 : value.density === 'compact' ? 12 : value.spacing
  style.setProperty('--rei-spacing', `${spacing}px`)
  style.setProperty('--rei-font-weight', String(value.fontWeight))
  style.setProperty('--rei-line-height', String(value.lineHeight / 100))
  for (const [key, amount] of Object.entries({
    'tab-height': value.tabHeight,
    'tab-icon-size': value.tabIconSize,
    'topbar-height': value.addressBarHeight,
    'topbar-radius': value.addressBarRadius,
    'scrollbar-width': value.scrollbarVisibility === 'hidden' ? 0 : value.scrollbarWidth,
    'hover-radius': value.hoverRadius
  }))
    style.setProperty(`--rei-${key}`, `${amount}px`)
  style.setProperty('--rei-topbar-opacity', String(value.addressBarOpacity))
  style.setProperty(
    '--rei-topbar-background',
    value.addressBarOpacity === 100
      ? colors.topbar
      : `color-mix(in srgb, ${colors.topbar} ${value.addressBarOpacity}%, transparent)`
  )
  style.setProperty(
    '--rei-address-align',
    { left: 'flex-start', center: 'center', right: 'flex-end' }[value.addressBarAlignment]
  )
  style.setProperty('--rei-hover-opacity', String(value.hoverOpacity / 100))
  style.setProperty(
    '--rei-hover-duration',
    `${2400000 / (value.hoverSpeed * value.animationSpeed)}ms`
  )
  style.setProperty('--rei-edge-fade-top', `${value.edgeFade * 0.24}px`)
  style.setProperty('--rei-edge-fade-bottom', `${value.edgeFade * 0.44}px`)
  document.documentElement.dataset.scrollbars = value.scrollbarVisibility
  document.documentElement.dataset.tabIndicator = value.tabIndicator
  document.documentElement.dataset.tabClose = value.tabCloseButton
  document.documentElement.dataset.sidebarIcons = String(value.sidebarIconsOnly)
  for (const [name, duration] of Object.entries({ fast: 100, medium: 180, slow: 240 }))
    style.setProperty(`--rei-duration-${name}`, `${(duration * 100) / value.animationSpeed}ms`)
  style.setProperty('--rei-caret-width', `${value.caretWidth}px`)
  style.setProperty(
    '--rei-caret-height',
    `${value.caretStyle === 'underline' ? 2 : value.caretHeight}px`
  )
  style.setProperty('--rei-caret-radius', `${value.caretRadius}px`)
  style.setProperty('--rei-caret-opacity', `${value.caretOpacity / 100}`)
  style.setProperty('--rei-caret-blink-interval', `${value.caretBlinkInterval}ms`)
  style.setProperty(
    '--rei-caret-move-duration',
    `${(value.caretMoveDuration * 100) / value.animationSpeed}ms`
  )
  style.setProperty('--rei-selection-radius', `${value.selectionRadius}px`)
  document.documentElement.dataset.selectionSmooth = String(value.selectionSmooth)
  document.documentElement.dataset.caretStyle = value.caretStyle
  document.documentElement.dataset.caretBlink = String(value.caretBlink)
  document.documentElement.dataset.caretSmooth = String(value.caretSmooth)
  applyMotion(value)
  syncWallpaper(value)
  style.setProperty('--rei-wallpaper-fit', value.wallpaperFit)
  style.setProperty('--rei-wallpaper-dim', `${value.wallpaperDim / 100}`)
  style.setProperty('--rei-wallpaper-position', value.wallpaperPosition)
  style.setProperty('--rei-wallpaper-blur', `${value.wallpaperBlur}px`)
  style.setProperty('--rei-wallpaper-fade', `${value.wallpaperBottomFade}%`)
  const background = colors.background
  const brightness = [1, 3, 5].map((offset) => parseInt(background.slice(offset, offset + 2), 16))
  style.colorScheme =
    brightness[0] * 0.299 + brightness[1] * 0.587 + brightness[2] * 0.114 > 150 ? 'light' : 'dark'
  theme.set(value)
}

export async function initializeTheme(): Promise<void> {
  window.api.onTheme((value) => {
    applyTheme(value)
    themeError.set('')
  })
  window.api.onThemeError((message) => themeError.set(message))
  try {
    applyTheme(await window.api.getTheme())
  } catch {
    applyTheme(defaultTheme)
    themeError.set('Could not load your theme. Try reopening Rei.')
  }
}

export async function updateTheme(patch: ThemePatch): Promise<boolean> {
  try {
    applyTheme(await window.api.setTheme(patch))
    themeError.set('')
    return true
  } catch (error) {
    themeError.set(actionError(error, 'Could not save your theme. Try again.'))
    return false
  }
}
