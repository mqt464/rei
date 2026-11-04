import { app, dialog, nativeTheme, shell } from 'electron'
import type { IpcMainInvokeEvent, WebContents, WebContentsView } from 'electron'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  renameSync,
  unwatchFile,
  watchFile,
  writeFileSync
} from 'node:fs'
import { extname, isAbsolute, join } from 'node:path'
import { defaultTheme, maxWallpaperBytes, parseTheme, themeColors } from '../shared/theme'
import type { Theme } from '../shared/theme'

let theme: Theme | undefined
const clients = new Map<WebContents, { view: WebContentsView; sidebar: boolean }>()
const listeners = new Map<WebContents, () => void>()
let appliedPalette = ''

export function currentTheme(): Theme {
  if (!theme) {
    try {
      theme = parseTheme(
        JSON.parse(readFileSync(join(app.getPath('userData'), 'theme.json'), 'utf8'))
      )
    } catch {
      theme = parseTheme(defaultTheme)
    }
  }
  return theme
}

function publishTheme(next: Theme): void {
  theme = next
  const colors = themeColors(next, nativeTheme.shouldUseDarkColors)
  appliedPalette = JSON.stringify(colors)
  for (const [client, entry] of clients) {
    if (client.isDestroyed()) continue
    entry.view.setBackgroundColor(colors[entry.sidebar ? 'sidebar' : 'background'])
    client.send('theme:changed', next)
    listeners.get(client)?.()
  }
}

function saveTheme(patch: unknown): Theme {
  let current = currentTheme()
  if (
    patch &&
    typeof patch === 'object' &&
    Object.hasOwn(patch, 'colors') &&
    !Object.hasOwn(patch, 'paletteMode') &&
    !Object.hasOwn(patch, 'themeSchedule')
  )
    current = {
      ...current,
      paletteMode: 'custom',
      colors: themeColors(current, nativeTheme.shouldUseDarkColors)
    }
  const next = parseTheme(patch, current)
  if (
    next.wallpaperFolder &&
    (!isAbsolute(next.wallpaperFolder) || !statSync(next.wallpaperFolder).isDirectory())
  )
    throw new Error('Choose an existing wallpaper folder.')
  const directory = app.getPath('userData')
  try {
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'theme.json.tmp'), JSON.stringify(next, null, 2), { mode: 0o600 })
    renameSync(join(directory, 'theme.json.tmp'), join(directory, 'theme.json'))
  } catch {
    throw new Error('Could not save the theme. Check available disk space and try again.')
  }
  publishTheme(next)
  return next
}

export function registerTheme(
  view: WebContentsView,
  sidebar: boolean,
  trusted: (event: IpcMainInvokeEvent) => boolean,
  update?: () => void
): void {
  const contents = view.webContents
  const file = join(app.getPath('userData'), 'theme.json')
  if (!clients.size) {
    appliedPalette = JSON.stringify(themeColors(currentTheme(), nativeTheme.shouldUseDarkColors))
    nativeTheme.on('updated', refreshSystemPalette)
  }
  if (!clients.size)
    watchFile(file, { interval: 750, persistent: false }, () => {
      if (!existsSync(file)) return
      try {
        const next = parseTheme(JSON.parse(readFileSync(file, 'utf8')))
        if (JSON.stringify(next) !== JSON.stringify(currentTheme())) publishTheme(next)
      } catch {
        for (const client of clients.keys())
          if (!client.isDestroyed())
            client.send(
              'theme:error',
              'Theme file is invalid. Fix the JSON to apply your edits; your last valid theme is still active.'
            )
      }
    })
  clients.set(contents, { view, sidebar })
  if (update) listeners.set(contents, update)
  view.setBackgroundColor(
    themeColors(currentTheme(), nativeTheme.shouldUseDarkColors)[sidebar ? 'sidebar' : 'background']
  )
  contents.once('destroyed', () => {
    clients.delete(contents)
    listeners.delete(contents)
    if (!clients.size) {
      unwatchFile(file)
      nativeTheme.removeListener('updated', refreshSystemPalette)
    }
  })
  contents.ipc.handle('theme:open-file', async (event) => {
    if (!trusted(event)) throw new Error('Theme access denied.')
    if (existsSync(file)) {
      try {
        const normalized = parseTheme(JSON.parse(readFileSync(file, 'utf8')))
        writeFileSync(file, JSON.stringify(normalized, null, 2), { mode: 0o600 })
      } catch {
        contents.send(
          'theme:error',
          'Theme JSON needs repair. Your last valid theme remains active.'
        )
      }
    } else {
      mkdirSync(app.getPath('userData'), { recursive: true })
      writeFileSync(file, JSON.stringify(currentTheme(), null, 2), { mode: 0o600 })
    }
    const error = await shell.openPath(file)
    if (error)
      throw new Error(
        'Could not open theme.json. Associate JSON files with a text editor and try again.'
      )
  })
  contents.ipc.handle('theme:get', (event) => {
    if (!trusted(event)) throw new Error('Theme access denied.')
    return currentTheme()
  })
  contents.ipc.handle('theme:set', (event, patch: unknown) => {
    if (!trusted(event)) throw new Error('Theme access denied.')
    return saveTheme(patch)
  })
  contents.ipc.handle('theme:wallpaper-folder', async (event) => {
    if (!trusted(event)) throw new Error('Theme access denied.')
    const result = await dialog.showOpenDialog({
      title: 'Wallpaper slideshow folder',
      properties: ['openDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return currentTheme()
    return saveTheme({ wallpaperFolder: result.filePaths[0] })
  })
  contents.ipc.handle('theme:wallpaper-image', (event, index: unknown) => {
    if (!trusted(event) || typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0)
      throw new Error('Wallpaper access denied.')
    const folder = currentTheme().wallpaperFolder
    if (!folder) return null
    try {
      const images = readdirSync(folder, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name))
        .sort((first, second) => first.name.localeCompare(second.name))
        .slice(0, 200)
      if (!images.length) throw new Error('No PNG, JPEG, or WebP images in this folder.')
      const file = join(folder, images[index % images.length].name)
      if (statSync(file).size > maxWallpaperBytes)
        throw new Error('Slideshow images must be smaller than 6 MB.')
      const mime =
        extname(file).toLowerCase() === '.png'
          ? 'png'
          : extname(file).toLowerCase() === '.webp'
            ? 'webp'
            : 'jpeg'
      return `data:image/${mime};base64,${readFileSync(file).toString('base64')}`
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Could not read wallpaper folder.', {
        cause: error
      })
    }
  })
}

function refreshSystemPalette(): void {
  if (
    JSON.stringify(themeColors(currentTheme(), nativeTheme.shouldUseDarkColors)) !== appliedPalette
  )
    publishTheme(currentTheme())
}
