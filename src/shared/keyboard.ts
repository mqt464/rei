export const keybindActions = [
  { id: 'newTab', title: 'New tab', keys: ['Mod+T'] },
  { id: 'newIncognitoTab', title: 'New incognito tab', keys: ['Mod+Shift+N'] },
  { id: 'closeTab', title: 'Close tab', keys: ['Mod+W'] },
  { id: 'reopenTab', title: 'Reopen closed tab', keys: ['Mod+Shift+T'] },
  { id: 'nextTab', title: 'Next tab', keys: ['Mod+Tab'] },
  { id: 'previousTab', title: 'Previous tab', keys: ['Mod+Shift+Tab'] },
  { id: 'focusAddress', title: 'Focus address bar', keys: ['Mod+L'] },
  { id: 'findInPage', title: 'Find in page', keys: ['Mod+F'] },
  { id: 'toggleSidebar', title: 'Toggle sidebar', keys: ['Mod+B'] },
  { id: 'back', title: 'Back', keys: ['Mod+['] },
  { id: 'forward', title: 'Forward', keys: ['Mod+]'] },
  { id: 'reload', title: 'Reload page', keys: ['Mod+R'] },
  { id: 'hardReload', title: 'Reload without cache', keys: ['Mod+Shift+R'] },
  { id: 'settings', title: 'Open settings', keys: ['Mod+,'] },
  { id: 'downloads', title: 'Open downloads', keys: ['Mod+J'] },
  { id: 'history', title: 'Open history', keys: ['Mod+H'] },
  { id: 'mute', title: 'Toggle tab audio', keys: ['Mod+Shift+M'] },
  { id: 'zoomIn', title: 'Zoom in', keys: ['Mod+='] },
  { id: 'zoomOut', title: 'Zoom out', keys: ['Mod+-'] },
  { id: 'resetZoom', title: 'Reset zoom', keys: ['Mod+0'] },
  { id: 'devtools', title: 'Developer tools (development)', keys: ['F12'] },
  ...Array.from({ length: 9 }, (_, index) => ({
    id: `tab${index + 1}`,
    title: `Switch to tab ${index + 1}`,
    keys: [`Ctrl+${index + 1}`]
  }))
]

export type Keybindings = Record<string, string[]>
export const defaultKeybindings: Keybindings = Object.fromEntries(
  keybindActions.map((action) => [action.id, action.keys])
)
export const sequenceTimeout = 1200
const modifiers = ['Ctrl', 'Meta', 'Alt', 'Shift']

export interface KeyInput {
  key: string
  code?: string
  control: boolean
  meta: boolean
  alt: boolean
  shift: boolean
}

export function keyStroke(input: KeyInput): string | null {
  if (['Control', 'Meta', 'Alt', 'Shift', 'AltGraph', 'Dead', 'Unidentified'].includes(input.key))
    return null
  let key =
    input.key === ' ' ? 'Space' : input.key.length === 1 ? input.key.toUpperCase() : input.key
  if (input.code === 'BracketLeft') key = '['
  if (input.code === 'BracketRight') key = ']'
  if (input.code === 'Equal') key = '='
  if (input.code === 'Minus') key = '-'
  if (key === '+') key = 'Plus'
  return [
    ...modifiers.filter((_, index) => [input.control, input.meta, input.alt, input.shift][index]),
    key
  ].join('+')
}

function strokeVariants(stroke: string): string[] {
  return stroke.startsWith('Mod+')
    ? [stroke.replace('Mod+', 'Ctrl+'), stroke.replace('Mod+', 'Meta+')]
    : [stroke]
}

export function parseKeybindings(value: unknown): Keybindings {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid keybinds.')
  const next = { ...defaultKeybindings }
  for (const [action, sequence] of Object.entries(value)) {
    if (!Object.hasOwn(defaultKeybindings, action)) throw new Error('Unknown keybind action.')
    if (!Array.isArray(sequence) || sequence.length > 4)
      throw new Error('Use up to four keystrokes per keybind.')
    for (const stroke of sequence) {
      if (typeof stroke !== 'string' || stroke.length > 80) throw new Error('Invalid keystroke.')
      const parts = stroke.split('+')
      const key = parts.pop()!
      const allowed = ['Mod', ...modifiers]
      if (
        !key ||
        !/^(?:[^\s+]|Space|Tab|Enter|Escape|Backspace|Delete|Insert|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|F(?:[1-9]|1\d|2[0-4])|Plus)$/.test(
          key
        ) ||
        parts.some((part) => !allowed.includes(part)) ||
        new Set(parts).size !== parts.length ||
        (parts.includes('Mod') && (parts.includes('Ctrl') || parts.includes('Meta')))
      )
        throw new Error('Invalid keystroke.')
      if (['Escape', 'Enter', 'Tab', 'Backspace', 'Delete'].includes(key) && parts.length === 0)
        throw new Error('Add a modifier to Escape, Enter, Tab, Backspace or Delete.')
      if (allowed.filter((part) => parts.includes(part)).join('+') !== parts.join('+'))
        throw new Error('Invalid modifier order.')
    }
    if (sequence.length && !/^(?:Mod|Ctrl|Meta|Alt)\+|^F\d+$/.test(sequence[0]))
      throw new Error('Start with Ctrl, Command, Alt or a function key to protect typing.')
    next[action] = [...sequence]
  }
  const used = Object.entries(next).filter(([, sequence]) => sequence.length)
  for (let index = 0; index < used.length; index++) {
    const [action, sequence] = used[index]
    for (const [other, candidate] of used.slice(index + 1)) {
      if (
        sequence
          .slice(0, Math.min(sequence.length, candidate.length))
          .every((stroke, position) =>
            strokeVariants(stroke).some((variant) =>
              strokeVariants(candidate[position]).includes(variant)
            )
          )
      )
        throw new Error(
          `Keybind conflicts: ${keybindActions.find((entry) => entry.id === action)!.title} and ${keybindActions.find((entry) => entry.id === other)!.title}. Clear or change one first.`
        )
    }
  }
  return next
}

export function createKeybindMatcher(): {
  reset: () => void
  match: (
    input: KeyInput,
    bindings: Keybindings,
    now?: number
  ) => { consumed: boolean; action?: string }
} {
  let pending: string[] = []
  let deadline = 0
  return {
    reset: () => {
      pending = []
      deadline = 0
    },
    match(input, bindings, now = Date.now()) {
      const stroke = keyStroke(input)
      if (!stroke) return { consumed: false }
      if (now > deadline) pending = []
      const matches = (sequence: string[]): [string, string[]][] =>
        Object.entries(bindings).filter(
          ([, candidate]) =>
            candidate.length >= sequence.length &&
            sequence.every((key, index) => strokeVariants(candidate[index]).includes(key))
        )
      let sequence = [...pending, stroke]
      let candidates = matches(sequence)
      if (!candidates.length) {
        sequence = [stroke]
        candidates = matches(sequence)
      }
      const complete = candidates.find(([, candidate]) => candidate.length === sequence.length)
      pending = complete || !candidates.length ? [] : sequence
      deadline = now + sequenceTimeout
      return { consumed: candidates.length > 0, action: complete?.[0] }
    }
  }
}
