# Context menu UI audit

## Existing visual reference

- **Sidebar:** quiet surface, compact icon/text rows, theme-defined spacing and rounded corners. `FluidHover` supplies the moving hover highlight and persistent selection.
- **Topbar:** the same palette and typography, with separately configurable height, opacity and alignment. Its Electron drag region must not swallow menu input.
- **Settings:** shared `Card`, `SettingRow`, `Select` and `Switch` controls. Dropdowns establish the floating-surface treatment: input background, thin border, modest shadow and rounded rows.
- **Shared interactions:** `ScrollArea`, focus colors, reduced-motion handling, hover opacity/radius/speed and animation speed already define the product language.

## Findings and implementation

1. Native context menus were the visual outlier and cannot render `FluidHover`. Rei mode renders the existing menu library's actions in a trusted, transparent `WebContentsView`, above the website and browser chrome. No page CSS or page script owns the menu.
2. A DOM popup in the topbar alone would be clipped by its view bounds. The menu uses a window-sized overlay, clamps to the available viewport, and scrolls long menus. Outside presses, Escape, Tab, navigation, tab switches, window resize and window blur dismiss it.
3. Pointer hover alone would omit keyboard and accessibility states. The menu uses menu/menuitem semantics, an active descendant, arrow/Home/End navigation, typeahead, disabled-item skipping, edit shortcuts and focus restoration. Fluid hover ignores disabled rows and separators.

## Compact menu and image actions

- Pointer and keyboard selection use the same accent text/icon color. FluidHover still distinguishes pointer hover from persistent keyboard selection; disabled rows and separators are not selected.
- The default menu is 236px wide with approximately 24px rows, smaller padding and 12px icons. Typography and density settings still apply.
- Each opening fades in within 60ms; user dismissal or action selection fades out within 50ms before the overlay hides. Faster animation settings can shorten these times. Reduced/no-motion preferences disable the effect. Forced navigation, resize and window cleanup dismiss immediately.
- Image menus include Copy image and Save image as, including linked images and native mode. Copy uses the source WebContents' image clipboard API. Save uses the existing session download pipeline, including the configured folder, prompting and filename-collision handling. Unloaded images disable Copy image.

## Settings applied

- Interface palette (dark, light, custom or system), font, text size, weight, line spacing, density, spacing, corner radius and focus color.
- Hover color, opacity, radius and speed; animation speed; motion preferences and system reduced motion.
- Scrollbar visibility, thickness and color, plus scroll-edge treatment through `ScrollArea`.
- Background-tab preference and spellcheck still drive the original library actions. Website zoom affects page content, not menu typography.
- Topbar opacity/alignment, website typography, sidebar width and wallpaper are intentionally not menu styling controls. They address different surfaces.

## New browser settings

- **Context menu style:** Rei (default) or Native. Native remains available for system rendering and accessibility preferences. Renderer-load failure also falls back to native.
- **Context menu icons:** optional action icons in Rei mode. The global theme remains the source of styling; no duplicate menu-specific color or animation settings.

Menu actions remain in the main process. Only the dedicated local menu renderer can invoke an enabled action from the current menu; stale IDs, separator IDs and website IPC cannot execute actions.

The library's existing ?Open in new window? action follows Rei's existing popup policy and opens a tab. Extension-provided submenus are not registered by the app. This change does not add extension-menu integration or redesign unrelated app surfaces.

## Remaining audit findings

- `Sidebar.svelte`'s draggable tab wrapper and `ScrollArea.svelte`'s mouse-interaction wrapper still produce existing Svelte accessibility-role warnings. Their unrelated interaction structure is unchanged.
- The existing settings regression expects a different appearance-section order and omits the current ?Extra? section. The menu regression checks the new controls separately; this change does not reorder the appearance settings to satisfy an outdated assertion.
- Existing theme/startup regressions still assume the old default background and `themeSchedule` model. The current app uses `paletteMode`; the menu follows it through the shared theme pipeline rather than introducing another appearance model.
