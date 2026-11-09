export const defaultColors = {
  background: '#141414',
  surface: '#0f0f0f',
  sidebar: '#000000',
  topbar: '#000000',
  input: '#141414',
  button: '#141414',
  hover: '#232323',
  selection: '#2d2d2d',
  border: '#1a1a1a',
  text: '#fff5fc',
  muted: '#a8a8b1',
  accent: '#ffb8ff',
  accentText: '#000000',
  error: '#fca5a5',
  caret: '#ffb8ff',
  focus: '#ffb8ff',
  scrollbar: '#a8a8b1'
}

export const lightColors: typeof defaultColors = {
  background: '#faf7fa',
  surface: '#ffffff',
  sidebar: '#f0ebf0',
  topbar: '#f0ebf0',
  input: '#faf7fa',
  button: '#faf7fa',
  hover: '#eee7ee',
  selection: '#ead2ea',
  border: '#e4dfe4',
  text: '#241d24',
  muted: '#716771',
  accent: '#873687',
  accentText: '#ffffff',
  error: '#b93849',
  caret: '#873687',
  focus: '#873687',
  scrollbar: '#8e838e'
}

export const themeFonts = {
  system: {
    label: 'System',
    family: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
  },
  segoe: { label: 'Segoe UI', family: "'Segoe UI', sans-serif" },
  arial: { label: 'Arial', family: 'Arial, sans-serif' },
  georgia: { label: 'Georgia', family: 'Georgia, serif' },
  mono: { label: 'JetBrains Mono', family: "'JetBrains Mono Variable', monospace" }
}

export interface Theme {
  colors: typeof defaultColors
  font: keyof typeof themeFonts
  fontSize: number
  radius: number
  caretStyle: 'line' | 'block' | 'underline'
  caretWidth: number
  caretHeight: number
  caretRadius: number
  caretOpacity: number
  caretBlink: boolean
  caretBlinkInterval: number
  caretSmooth: boolean
  caretSmoothTyping: boolean
  caretMoveDuration: number
  selectionSmooth: boolean
  selectionRadius: number
  motion: 'system' | 'reduced' | 'none'
  animationSpeed: number
  textMorphing: boolean
  textMorphStyle: 'subtle' | 'balanced' | 'expressive'
  textMorphCounters: boolean
  textMorphStatus: boolean
  textMorphActions: boolean
  textMorphTitles: boolean
  textMorphSettings: boolean
  wallpaper: string | null
  wallpaperFit: 'cover' | 'contain'
  wallpaperDim: number
  density: 'compact' | 'comfortable' | 'custom'
  spacing: number
  sidebarWidth: number
  sidebarIconsOnly: boolean
  tabHeight: number
  tabIconSize: number
  tabIndicator: 'fill' | 'line' | 'none'
  tabCloseButton: 'hover' | 'always' | 'never'
  addressBarHeight: number
  addressBarOpacity: number
  addressBarRadius: number
  addressBarAlignment: 'left' | 'center' | 'right'
  scrollbarWidth: number
  scrollbarVisibility: 'auto' | 'always' | 'hidden'
  edgeFade: number
  hoverOpacity: number
  hoverRadius: number
  hoverSpeed: number
  fontWeight: number
  lineHeight: number
  webpageFont: keyof typeof themeFonts | 'website'
  webpageFontSize: number
  webpageLineHeight: number
  wallpaperPosition: 'center' | 'top' | 'bottom' | 'left' | 'right'
  wallpaperBlur: number
  wallpaperBottomFade: number
  wallpaperDither: boolean
  wallpaperFolder: string
  wallpaperInterval: number
  paletteMode: 'system' | 'custom' | 'dark' | 'light'
}

export type ThemePatch = Partial<Omit<Theme, 'colors'>> & { colors?: Partial<Theme['colors']> }

export const defaultTheme: Theme = {
  colors: defaultColors,
  font: 'system',
  fontSize: 12,
  radius: 10,
  caretStyle: 'line',
  caretWidth: 1,
  caretHeight: 16,
  caretRadius: 1,
  caretOpacity: 100,
  caretBlink: true,
  caretBlinkInterval: 1000,
  caretSmooth: true,
  caretSmoothTyping: false,
  caretMoveDuration: 90,
  selectionSmooth: true,
  selectionRadius: 3,
  motion: 'system',
  animationSpeed: 100,
  textMorphing: true,
  textMorphStyle: 'balanced',
  textMorphCounters: true,
  textMorphStatus: true,
  textMorphActions: true,
  textMorphTitles: true,
  textMorphSettings: true,
  wallpaper: null,
  wallpaperFit: 'cover',
  wallpaperDim: 0,
  density: 'compact',
  spacing: 12,
  sidebarWidth: 208,
  sidebarIconsOnly: false,
  tabHeight: 30,
  tabIconSize: 15,
  tabIndicator: 'fill',
  tabCloseButton: 'hover',
  addressBarHeight: 38,
  addressBarOpacity: 100,
  addressBarRadius: 0,
  addressBarAlignment: 'left',
  scrollbarWidth: 6,
  scrollbarVisibility: 'auto',
  edgeFade: 100,
  hoverOpacity: 55,
  hoverRadius: 4,
  hoverSpeed: 100,
  fontWeight: 400,
  lineHeight: 150,
  webpageFont: 'website',
  webpageFontSize: 0,
  webpageLineHeight: 0,
  wallpaperPosition: 'center',
  wallpaperBlur: 0,
  wallpaperBottomFade: 0,
  wallpaperDither: false,
  wallpaperFolder: '',
  wallpaperInterval: 300,
  paletteMode: 'dark'
}

export function themeColors(value: Theme, systemDark: boolean): Theme['colors'] {
  if (value.paletteMode === 'custom') return value.colors
  if (value.paletteMode === 'light' || (value.paletteMode === 'system' && !systemDark))
    return lightColors
  return defaultColors
}

const appearanceChoices = {
  textMorphStyle: ['subtle', 'balanced', 'expressive'],
  density: ['compact', 'comfortable', 'custom'],
  tabIndicator: ['fill', 'line', 'none'],
  tabCloseButton: ['hover', 'always', 'never'],
  addressBarAlignment: ['left', 'center', 'right'],
  scrollbarVisibility: ['auto', 'always', 'hidden'],
  wallpaperPosition: ['center', 'top', 'bottom', 'left', 'right'],
  paletteMode: ['system', 'custom', 'dark', 'light']
}
const appearanceRanges = {
  spacing: [4, 24],
  sidebarWidth: [150, 360],
  tabHeight: [26, 56],
  tabIconSize: [12, 24],
  addressBarHeight: [32, 64],
  addressBarOpacity: [20, 100],
  addressBarRadius: [0, 24],
  scrollbarWidth: [3, 16],
  edgeFade: [0, 100],
  hoverOpacity: [0, 100],
  hoverRadius: [0, 24],
  hoverSpeed: [50, 200],
  fontWeight: [300, 700],
  lineHeight: [100, 220],
  webpageFontSize: [0, 32],
  webpageLineHeight: [0, 240],
  wallpaperBlur: [0, 40],
  wallpaperBottomFade: [0, 100],
  wallpaperInterval: [10, 86400]
} as const

export const maxWallpaperBytes = 6 * 1024 * 1024

export function parseTheme(value: unknown, current: Theme = defaultTheme): Theme {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid theme settings.')
  const next: Theme = { ...current, colors: { ...current.colors } }
  if (
    Object.hasOwn(value, 'colors') &&
    !Object.hasOwn(value, 'paletteMode') &&
    !Object.hasOwn(value, 'themeSchedule')
  )
    next.paletteMode = 'custom'
  for (const [key, entry] of Object.entries(value)) {
    if (['lightStart', 'darkStart', 'lightColors', 'darkColors'].includes(key)) continue
    if (key === 'themeSchedule') {
      if (!['manual', 'system', 'time'].includes(entry as string))
        throw new Error('Choose an available palette mode.')
      if (!Object.hasOwn(value, 'paletteMode'))
        next.paletteMode = entry === 'system' ? 'system' : 'custom'
      continue
    }
    if (Object.hasOwn(appearanceChoices, key)) {
      if (
        !(appearanceChoices[key as keyof typeof appearanceChoices] as readonly unknown[]).includes(
          entry
        )
      )
        throw new Error(`Choose an available ${key} option.`)
      Object.assign(next, { [key]: entry })
    } else if (Object.hasOwn(appearanceRanges, key)) {
      const [minimum, maximum] = appearanceRanges[key as keyof typeof appearanceRanges]
      if (
        typeof entry !== 'number' ||
        !Number.isInteger(entry) ||
        entry < minimum ||
        entry > maximum
      )
        throw new Error(`${key} must be between ${minimum} and ${maximum}.`)
      Object.assign(next, { [key]: entry })
    } else if (
      key === 'sidebarIconsOnly' ||
      key === 'wallpaperDither' ||
      key === 'textMorphing' ||
      key === 'textMorphCounters' ||
      key === 'textMorphStatus' ||
      key === 'textMorphActions' ||
      key === 'textMorphTitles' ||
      key === 'textMorphSettings'
    ) {
      if (typeof entry !== 'boolean') throw new Error('Appearance switches must be on or off.')
      next[key] = entry
    } else if (key === 'wallpaperFolder') {
      if (typeof entry !== 'string' || entry.length > 8192 || entry.includes('\0'))
        throw new Error('Choose a valid wallpaper folder.')
      next.wallpaperFolder = entry
    } else if (key === 'webpageFont') {
      if (entry !== 'website' && (typeof entry !== 'string' || !Object.hasOwn(themeFonts, entry)))
        throw new Error('Choose an available webpage font.')
      next.webpageFont = entry as Theme['webpageFont']
    } else if (key === 'colors') {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry))
        throw new Error('Invalid theme colours.')
      for (const [color, hex] of Object.entries(entry)) {
        if (
          !Object.hasOwn(defaultColors, color) ||
          typeof hex !== 'string' ||
          !/^#[\da-f]{6}$/i.test(hex)
        )
          throw new Error('Use a six-digit hex colour, such as #a5f3fc.')
        next[key] = { ...next[key], [color]: hex.toLowerCase() }
      }
    } else if (key === 'font') {
      if (typeof entry !== 'string' || !Object.hasOwn(themeFonts, entry))
        throw new Error('Choose an available interface font.')
      next.font = entry as Theme['font']
    } else if (key === 'fontSize') {
      if (typeof entry !== 'number' || !Number.isInteger(entry) || entry < 10 || entry > 18)
        throw new Error('Text size must be between 10 and 18 pixels.')
      next.fontSize = entry
    } else if (key === 'caretStyle') {
      if (!['line', 'block', 'underline'].includes(entry as string))
        throw new Error('Choose a line, block, or underline caret.')
      next.caretStyle = entry as Theme['caretStyle']
    } else if (key === 'motion') {
      if (!['system', 'reduced', 'none'].includes(entry as string))
        throw new Error('Choose an available motion setting.')
      next.motion = entry as Theme['motion']
    } else if (
      key === 'caretBlink' ||
      key === 'caretSmooth' ||
      key === 'caretSmoothTyping' ||
      key === 'selectionSmooth'
    ) {
      if (typeof entry !== 'boolean') throw new Error('Caret switches must be on or off.')
      next[key] = entry
    } else if (
      [
        'radius',
        'caretWidth',
        'caretHeight',
        'caretRadius',
        'caretOpacity',
        'caretBlinkInterval',
        'caretMoveDuration',
        'selectionRadius',
        'animationSpeed'
      ].includes(key)
    ) {
      const ranges = {
        radius: [0, 16],
        caretWidth: [1, 12],
        caretHeight: [10, 28],
        caretRadius: [0, 6],
        caretOpacity: [20, 100],
        caretBlinkInterval: [300, 1600],
        caretMoveDuration: [0, 200],
        selectionRadius: [0, 8],
        animationSpeed: [50, 200]
      } as const
      const field = key as keyof typeof ranges
      const [minimum, maximum] = ranges[field]
      if (
        typeof entry !== 'number' ||
        !Number.isInteger(entry) ||
        entry < minimum ||
        entry > maximum
      )
        throw new Error(`${key} must be between ${minimum} and ${maximum}.`)
      next[field] = entry
    } else if (key === 'wallpaper') {
      if (
        entry !== null &&
        (typeof entry !== 'string' ||
          entry.length > Math.ceil(maxWallpaperBytes / 3) * 4 + 64 ||
          !/^data:image\/(?:png|jpeg|webp);base64,[a-z\d+/]+={0,2}$/i.test(entry))
      )
        throw new Error('Choose a PNG, JPEG, or WebP image smaller than 6 MB.')
      next.wallpaper = entry as string | null
    } else if (key === 'wallpaperFit') {
      if (entry !== 'cover' && entry !== 'contain') throw new Error('Choose Fill or Fit.')
      next.wallpaperFit = entry
    } else if (key === 'wallpaperDim') {
      if (typeof entry !== 'number' || !Number.isInteger(entry) || entry < 0 || entry > 80)
        throw new Error('Wallpaper dimming must be between 0 and 80%.')
      next.wallpaperDim = entry
    } else throw new Error('Unknown theme setting.')
  }
  return next
}
