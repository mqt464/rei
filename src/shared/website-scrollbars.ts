import { themeColors } from './theme'
import type { Theme } from './theme'

export function websiteScrollbarCSS(theme: Theme, dark: boolean): string {
  const color = themeColors(theme, dark).scrollbar
  const width = theme.scrollbarVisibility === 'hidden' ? 0 : theme.scrollbarWidth
  const thumb = `var(--rei-website-scrollbar-thumb, color-mix(in srgb, ${color} 60%, transparent))`
  return `@media screen and (forced-colors: none) {
    :where([data-rei-scrollbar-colors]) { scrollbar-color: auto !important; }
    :where(*)::-webkit-scrollbar { width: ${width}px; height: ${width}px; }
    :where(*)::-webkit-scrollbar-track { background: var(--rei-website-scrollbar-track, transparent); }
    :where(*)::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
    :where(*)::-webkit-scrollbar-thumb {
      border: 1px solid transparent;
      border-radius: ${theme.radius * 99.9}px;
      background: ${theme.scrollbarVisibility === 'always' ? thumb : 'transparent'};
      background-clip: padding-box;
    }
    :where([data-rei-scrollbar-active])::-webkit-scrollbar-thumb { background-color: ${thumb}; }
    :where(*)::-webkit-scrollbar-corner { background: var(--rei-website-scrollbar-track, transparent); }
  }`
}
