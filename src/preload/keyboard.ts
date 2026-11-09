import { ipcRenderer } from 'electron'
import './playing-media'
import './scrollbars'
import './privacy'
import { createKeybindMatcher, defaultKeybindings } from '../shared/keyboard'
import type { Keybindings } from '../shared/keyboard'

let bindings: Keybindings = ipcRenderer.sendSync('keybinds:get') ?? defaultKeybindings
let capturing = false
const matcher = createKeybindMatcher()
ipcRenderer.on('keybinds:changed', (_event, value: Keybindings) => {
  bindings = value
  matcher.reset()
})

export function setKeybindCapture(active: boolean): void {
  capturing = active
  matcher.reset()
  ipcRenderer.sendSync('keybinds:capture', active)
}

window.addEventListener('blur', () => matcher.reset())
window.addEventListener(
  'keydown',
  (event) => {
    if (capturing || event.isComposing) return
    const result = matcher.match(
      {
        key: event.key,
        code: event.code,
        control: event.ctrlKey,
        meta: event.metaKey,
        alt: event.altKey,
        shift: event.shiftKey
      },
      bindings
    )
    if (!result.consumed) return
    event.preventDefault()
    event.stopImmediatePropagation()
  },
  true
)
