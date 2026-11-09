const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

async function main() {
  if (!process.versions.electron) {
    const { build, normalizePath } = await import('vite')
    const root = path.resolve(__dirname, '..')
    const themePath = normalizePath(path.join(root, 'src/renderer/src/theme.ts'))
    const baseline = process.argv.includes('--baseline')
    const entry = normalizePath(path.join(root, '__wallpaper-surface-check__.js'))
    const result = await build({
      configFile: false,
      root,
      logLevel: 'warn',
      plugins: [
        {
          name: 'wallpaper-surface-check',
          enforce: 'pre',
          resolveId: (id) =>
            id.endsWith('__wallpaper-surface-check__.js') ? `\0${entry}` : undefined,
          transform(source, id) {
            if (!baseline || normalizePath(id) !== themePath) return
            const guard =
              "  if (['#tabs', '#context-menu', '#find'].includes(location.hash)) return"
            assert.equal(source.split(guard).length, 2, 'baseline guard must match once')
            return { code: source.replace(guard, ''), map: null }
          },
          load: (id) =>
            id === `\0${entry}`
              ? `
import { get } from 'svelte/store'
import { initializeTheme, wallpaperSource, wallpaperError, motionMode } from ${JSON.stringify(themePath)}
import { defaultTheme } from ${JSON.stringify(normalizePath(path.join(root, 'src/shared/theme.ts')))}
window.checkWallpaperSurface = async () => {
  const check = (condition, message) => { if (!condition) throw new Error(message) }
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d')
  context.fillStyle = '#abcdef'
  context.fillRect(0, 0, 64, 64)
  const source = canvas.toDataURL()
  context.fillStyle = '#123456'
  context.fillRect(0, 0, 64, 64)
  const alternate = canvas.toDataURL()
  let requests = 0
  let onTheme
  const timers = new Map()
  let timerId = 100
  window.setInterval = (callback, interval) => { timers.set(++timerId, {callback, interval}); return timerId }
  window.clearInterval = (id) => timers.delete(id)
  const value = {...defaultTheme, wallpaperFolder: 'fixture', wallpaperInterval: 60, wallpaperDither: true}
  window.api = {
    onTheme: (callback) => { onTheme = callback },
    onThemeError: () => {},
    getTheme: async () => value,
    wallpaperImage: async (index) => { requests++; return index % 2 ? alternate : source }
  }
  const main = !location.hash
  const ready = async (previous) => {
    for (let attempt = 0; attempt < 200 && (!get(wallpaperSource) || get(wallpaperSource) === previous); attempt++)
      await new Promise(resolve => setTimeout(resolve, 5))
    check(!!get(wallpaperSource) && get(wallpaperSource) !== previous, 'Main surface must finish rendering wallpaper')
  }
  await initializeTheme()
  if (main) await ready()
  check(requests === (main ? 1 : 0), 'Only main surface may request wallpaper')
  check(timers.size === (main ? 1 : 0), 'Only main surface may schedule rotation')
  check(!get(wallpaperError), 'Wallpaper rendering must not fail')
  check(!!get(wallpaperSource) === main, 'Only main surface may retain rendered wallpaper')
  check(!!document.documentElement.style.getPropertyValue('--rei-wallpaper') === main,
    'Only main surface may install wallpaper CSS')
  onTheme({...value, colors: {...value.colors, accent: '#123456'}, paletteMode: 'custom'})
  check(document.documentElement.style.getPropertyValue('--rei-accent') === '#123456',
    'Every surface must still apply theme updates')
  check(requests === (main ? 1 : 0), 'Color changes must not restart wallpaper processing')
  if (main) {
    const original = get(wallpaperSource)
    await [...timers.values()][0].callback()
    await ready(original)
    check(requests === 2, 'Main wallpaper must still rotate')
    check(get(wallpaperSource) !== original, 'Rotation must display the next image')
    onTheme({...defaultTheme, wallpaper: null, wallpaperFolder: ''})
    check(get(wallpaperSource) === null && timers.size === 0, 'Removing wallpaper must release source and timer')
  }
  return {surface: location.hash || 'main', requests, timers: timers.size}
}
window.checkWallpaperMotion = async (expected) => {
  for (let attempt = 0; attempt < 200 && get(motionMode) !== expected; attempt++)
    await new Promise(resolve => setTimeout(resolve, 5))
  if (get(motionMode) !== expected || document.documentElement.dataset.motion !== expected)
    throw new Error('Every surface must still update system motion live')
}
`
              : undefined
        }
      ],
      build: {
        write: false,
        minify: false,
        lib: { entry, formats: ['iife'], name: 'WallpaperSurfaceCheck' }
      }
    })
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rei-wallpaper-surfaces-'))
    try {
      const fixture = path.join(directory, 'check.js')
      const outputs = Array.isArray(result) ? result : [result]
      fs.writeFileSync(
        fixture,
        outputs.flatMap((output) => output.output).find((item) => item.type === 'chunk').code
      )
      const env = { ...process.env, REI_WALLPAPER_CHECK: directory }
      delete env.ELECTRON_RUN_AS_NODE
      const child = require('node:child_process').spawnSync(require('electron'), [__filename], {
        env,
        stdio: 'inherit',
        timeout: 30000,
        windowsHide: true
      })
      if (child.error) throw child.error
      process.exitCode = child.status ?? 1
    } finally {
      assert.equal(path.dirname(directory), os.tmpdir())
      assert.ok(path.basename(directory).startsWith('rei-wallpaper-surfaces-'))
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
    return
  }
  const { app, BrowserWindow } = require('electron')
  app.setPath('userData', process.env.REI_WALLPAPER_CHECK)
  await app.whenReady()
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  try {
    const fixture = fs.readFileSync(path.join(process.env.REI_WALLPAPER_CHECK, 'check.js'), 'utf8')
    for (const hash of ['', '#tabs', '#context-menu', '#find']) {
      await window.loadURL(
        `data:text/html,<html><title>${encodeURIComponent(hash || 'main')}</title><body></body></html>${hash}`
      )
      await window.webContents.executeJavaScript(fixture)
      const result = await window.webContents.executeJavaScript('window.checkWallpaperSurface()')
      window.webContents.debugger.attach('1.3')
      try {
        for (const reduced of [true, false]) {
          await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
            features: [
              { name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }
            ]
          })
          await window.webContents.executeJavaScript(
            `window.checkWallpaperMotion(${JSON.stringify(reduced ? 'reduced' : 'full')})`
          )
        }
      } finally {
        window.webContents.debugger.detach()
      }
      console.log('PASS:', result)
    }
  } finally {
    window.destroy()
    app.quit()
  }
}

main().catch((error) => {
  console.error(error)
  if (process.versions.electron) require('electron').app.exit(1)
  else process.exitCode = 1
})
