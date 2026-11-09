const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

async function main() {
  if (!process.versions.electron) {
    const { build, normalizePath } = await import('vite')
    const { svelte } = await import('@sveltejs/vite-plugin-svelte')
    const root = path.join(__dirname, '..')
    const sourcePath = (file) => JSON.stringify(normalizePath(path.join(root, file)))
    const entry = normalizePath(path.join(root, '__text-morph-check__.js'))
    const result = await build({
      configFile: false,
      root,
      logLevel: 'warn',
      plugins: [
        svelte(),
        {
          name: 'text-morph-check',
          resolveId: (id) => (id.endsWith('__text-morph-check__.js') ? `\0${entry}` : undefined),
          load: (id) =>
            id === `\0${entry}`
              ? `
import { createClassComponent } from 'svelte/legacy'
import { flushSync } from 'svelte'
import Morph from ${sourcePath('src/renderer/src/components/Morph.svelte')}
import AppearanceOptions from ${sourcePath('src/renderer/src/AppearanceOptions.svelte')}
import { theme, motionMode } from ${sourcePath('src/renderer/src/theme.ts')}
import { defaultTheme } from ${sourcePath('src/shared/theme.ts')}
const pause = (duration = 30) => new Promise(resolve => setTimeout(resolve, duration))
const check = (condition, message) => { if (!condition) throw new Error(message) }
const host = document.createElement('div')
host.style.cssText = 'width:600px;font:14px Arial;'
document.body.append(host)
const component = createClassComponent({ component: Morph, target: host, props: { text: '100', preset: 'counter', throttle: 200 } })
const root = () => host.querySelector('span')
const accessible = () => root().querySelector('[torph-sr]')?.textContent ?? root().textContent
let savedTheme = defaultTheme
window.api = { setTheme: async (patch) => (savedTheme = { ...savedTheme, ...patch }) }
window.checkTextMorph = async () => {
  await pause()
  check(root().hasAttribute('torph-root'), 'Initial text must use Torph')
  check(accessible() === '100', 'Initial accessible text must appear once')
  check(root().getAnimations({ subtree: true }).length === 0, 'Initial render must not animate')
  component.$set({ text: '101' }); flushSync()
  component.$set({ text: '102' }); flushSync()
  check(accessible() === '100', 'Download updates must throttle')
  await pause(220)
  check(accessible() === '102', 'Throttle must publish latest value')
  check(root().getAnimations({ subtree: true }).length > 0, 'Counter update must animate')
  component.$set({ text: '103' }); flushSync()
  theme.set({ ...defaultTheme, textMorphing: false }); flushSync()
  check(accessible() === '103', 'Disabling morphing must flush latest value')
  check(!root().hasAttribute('torph-root'), 'Master switch must restore plain text')
  check(root().getAnimations({ subtree: true }).length === 0, 'Master switch must cancel animations')
  theme.set(defaultTheme); component.$set({ text: '', preset: 'action', throttle: 0 }); flushSync()
  component.$set({ text: 'Saved' }); flushSync()
  await pause()
  check(accessible() === 'Saved', 'Confirmation must expose correct accessible text')
  check(root().getAnimations({ subtree: true }).length > 0, 'Confirmation from empty text must animate')
  for (const motion of ['reduced', 'none']) {
    theme.set({ ...defaultTheme, motion }); flushSync()
    component.$set({ text: motion }); flushSync()
    check(!root().hasAttribute('torph-root'), 'App motion setting must disable Torph: ' + motion)
  }
  theme.set({ ...defaultTheme, textMorphActions: false }); flushSync()
  check(!root().hasAttribute('torph-root'), 'Category switch must disable its text')
  theme.set(defaultTheme); motionMode.set('full'); flushSync()
  component.$set({ text: 'A long tab title that must retain native ellipsis', preset: 'title' }); flushSync()
  host.style.cssText += 'width:64px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;'
  await pause()
  check(!root().hasAttribute('torph-root'), 'Overflow must fall back to plain text: ' + JSON.stringify({ width: root().scrollWidth, available: host.clientWidth, bounds: root().getBoundingClientRect().width }))
  check(accessible() === 'A long tab title that must retain native ellipsis', 'Overflow must preserve full text')
  check(getComputedStyle(host).textOverflow === 'ellipsis' && host.scrollWidth > host.clientWidth, 'Native ellipsis must remain applicable')
  host.style.width = '600px'
  component.$set({ text: 'Short' }); flushSync()
  check(root().hasAttribute('torph-root'), 'Shorter text must recover morphing')
  const appearance = document.createElement('section'); document.body.append(appearance)
  const settings = createClassComponent({ component: AppearanceOptions, target: appearance })
  await pause()
  check(appearance.querySelector('#text-morphing')?.getAttribute('aria-checked') === 'true', 'Appearance must expose master switch')
  check(appearance.querySelectorAll('[id^="textMorph"]').length === 5, 'Appearance must expose five categories')
  const slider = appearance.querySelector('#theme-size')
  slider.value = '13'; slider.dispatchEvent(new Event('input', { bubbles: true })); await pause()
  check(slider.parentElement.querySelector('output [torph-sr]')?.textContent === '13', 'Slider must morph digits independently of units')
  check(slider.parentElement.querySelector('output').textContent.endsWith('px'), 'Slider must preserve its unit')
  appearance.querySelector('#text-morph-style').click(); await pause()
  appearance.querySelector('#text-morph-style-option-2').click(); await pause()
  check(savedTheme.textMorphStyle === 'expressive', 'Style selector must save expressive preset')
  check(!Array.from(appearance.querySelectorAll('button')).some(button => button.textContent === 'Preview'), 'Appearance must not expose a text morphing preview')
  appearance.querySelector('#text-morphing').click(); await pause()
  check(appearance.querySelector('#text-morphing').getAttribute('aria-checked') === 'false', 'Appearance must save master switch')
  check(savedTheme.textMorphStyle === 'expressive', 'Master switch must preserve selected style')
  settings.$destroy(); appearance.remove()
  theme.set(defaultTheme); flushSync()
  return 'DOM checks passed: real Torph, accessible text, animation, throttling, motion, ellipsis, and appearance controls.'
}
window.checkSystemMotion = async (reduced) => {
  await pause()
  component.$set({ text: reduced ? 'Reduced motion' : 'Full motion' }); flushSync()
  check(root().hasAttribute('torph-root') !== reduced, 'System reduced motion must update live')
}
window.cleanupMorph = async () => {
  component.$destroy(); host.remove(); await pause()
  check(document.getAnimations().length === 0, 'Unmount must leave no running animations')
  check(!document.querySelector('style[data-torph]'), 'Unmount must release Torph styles')
}
`
              : undefined
        }
      ],
      build: { write: false, minify: false, lib: { entry, name: 'MorphCheck', formats: ['iife'] } }
    })
    const temporaryRoot = fs.realpathSync(os.tmpdir())
    const directory = fs.mkdtempSync(path.join(temporaryRoot, 'rei-text-morph-check-'))
    const bundle = path.join(directory, 'check.js')
    const outputs = Array.isArray(result) ? result : [result]
    fs.writeFileSync(
      bundle,
      outputs.flatMap((output) => output.output).find((item) => item.type === 'chunk').code
    )
    const environment = { ...process.env, REI_MORPH_BUNDLE: bundle }
    delete environment.ELECTRON_RUN_AS_NODE
    try {
      const run = require('node:child_process').spawnSync(require('electron'), [__filename], {
        env: environment,
        stdio: 'inherit',
        windowsHide: true,
        timeout: 30000
      })
      if (run.error) throw run.error
      assert.equal(run.status, 0, 'Electron DOM checks failed')
    } finally {
      if (path.dirname(directory) === temporaryRoot)
        fs.rmSync(directory, { recursive: true, force: true })
    }
    return
  }

  const { app, BrowserWindow } = require('electron')
  app.setPath('userData', path.join(path.dirname(process.env.REI_MORPH_BUNDLE), 'profile'))
  await app.whenReady()
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      offscreen: true
    }
  })
  try {
    await window.loadURL('data:text/html,<html><head></head><body></body></html>')
    window.webContents.debugger.attach('1.3')
    const emulate = (value) =>
      window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value }]
      })
    await emulate('no-preference')
    await window.webContents.executeJavaScript(
      fs.readFileSync(process.env.REI_MORPH_BUNDLE, 'utf8')
    )
    console.log(await window.webContents.executeJavaScript('window.checkTextMorph()'))
    await emulate('reduce')
    await window.webContents.executeJavaScript('window.checkSystemMotion(true)')
    await emulate('no-preference')
    await window.webContents.executeJavaScript('window.checkSystemMotion(false)')
    await window.webContents.executeJavaScript('window.cleanupMorph()')
    console.log('System reduced-motion and unmount checks passed.')
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
