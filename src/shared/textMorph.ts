import type { TextMorphOptions } from 'torph'
import type { Theme } from './theme'

export const textMorphCategories = [
  {
    key: 'textMorphCounters',
    label: 'Counters',
    description: 'Downloads, find-in-page, and history counts.'
  },
  {
    key: 'textMorphStatus',
    label: 'Status text',
    description: 'Download states and search context.'
  },
  {
    key: 'textMorphActions',
    label: 'Action feedback',
    description: 'Working states and confirmations.'
  },
  { key: 'textMorphTitles', label: 'Tab titles', description: 'Subtle updates within each tab.' },
  {
    key: 'textMorphSettings',
    label: 'Settings values',
    description: 'Slider values, selections, and summaries.'
  }
] as const

export type TextMorphCategory = (typeof textMorphCategories)[number]['key']
export type TextMorphPreset = 'counter' | 'status' | 'action' | 'title'

export function textMorphOptions(
  theme: Theme,
  preset: TextMorphPreset,
  category: TextMorphCategory,
  reducedMotion = false
): Omit<TextMorphOptions, 'element'> {
  const speed = theme.animationSpeed / 100
  const duration = { counter: 160, status: 180, action: 220, title: 120 }[preset]
  const style = { subtle: 0.8, balanced: 1, expressive: 1.15 }[theme.textMorphStyle]
  return {
    disabled: !theme.textMorphing || !theme[category] || theme.motion !== 'system' || reducedMotion,
    duration: (duration * style) / speed,
    ease:
      preset === 'action' && theme.textMorphStyle !== 'subtle'
        ? {
            stiffness: 400 * speed * speed,
            damping: (theme.textMorphStyle === 'expressive' ? 28 : 38) * speed,
            mass: 1
          }
        : 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    numbers: preset === 'counter',
    scale: preset === 'action' && theme.textMorphStyle !== 'subtle',
    respectReducedMotion: true
  }
}
