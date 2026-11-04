# Rei UI

Settings use this library as their visual contract. Import primitives from `./components/ui`
instead of introducing local button, dropdown, slider, toggle, or card styles.

- `Card` is a low-contrast surface containing direct `SettingRow` children. Never nest cards.
- `SettingRow` owns spacing, title/description hierarchy, control alignment, and narrow wrapping.
  Use `control` to associate its label with a control ID. Omit descriptions unless they explain
  a constraint, consequence, or non-obvious action. `stacked` supports a full-width field.
- `Button` owns action sizing, focus, busy, disabled, and hover states. Pass `busy` while awaiting work.
- `Select` is a themed combobox/listbox with keyboard arrows, Home/End, typeahead, Escape,
  Tab, outside dismissal, focus restoration, and viewport-aware placement. `change.detail` is
  the selected value. Do not use native `<select>` elements in settings.
  Menus reuse the sidebar's `FluidHover` indicator and `ScrollArea`; settings navigation
  uses the same hover/selection motion, and the page uses the same fading scrollbar.
- `Slider` retains native range semantics and pointer/keyboard behavior, but renders Rei's
  own track, fill, thumb, output, focus, and disabled states. Its output follows dragging
  immediately; `change.detail` commits the final numeric value.
- `Switch` owns on/off feedback and exposes `change.detail` as a boolean.
- `.rei-control`, `.rei-colour`, and `.rei-hex` style text areas, text inputs, and colour fields
  using the same sizing and tokens as the components. Keep labels and inline validation.

All colours, typography, radii, and transition durations come from `--rei-*` tokens applied
by `theme.ts`. Do not introduce literal colours or independent motion timings in settings.
Global reduced/off motion policies also cover the rest of Rei's renderer. Native sidebar
motion follows the same persisted preference in the main process.

`check-settings.cjs` exercises every page at wide, medium, narrow, and maximum text sizes.
`check-preferences.cjs` asserts no native dropdowns or nested cards and exercises the shared
controls, preference effects, and persistence through a real Electron window.
