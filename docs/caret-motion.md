# Caret and selection motion

The address bar and Settings / Caret preview use one Svelte action, `smoothText`.
The real input owns selection, keyboard navigation, clipboard operations, and IME.
Only the caret and highlight are custom drawn; no key presses are intercepted.

## References and decisions

- [VS Code editor options](https://github.com/microsoft/vscode/blob/main/src/vs/editor/common/config/editorOptions.ts): `cursorSmoothCaretAnimation` separates explicit navigation from always-on motion; `roundedSelection` provides a useful visual reference. Rei defaults to immediate typing and animated navigation, with an opt-in typing switch.
- [kitty cursor configuration](https://sw.kovidgoyal.net/kitty/conf/#text-cursor), also defined in [upstream configuration source](https://github.com/kovidgoyal/kitty/blob/master/kitty/options/definition.py): trails have independent timing and distance thresholds. Rei borrows the restrained, configurable approach, not the trail effect. A browser address field should not smear or overshoot while reading text.
- [Input selectionchange](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/selectionchange_event): selection extent and direction can change independently of typing. Listen to selection changes, including dragging and programmatic selection, rather than relying on keyup alone.
- [DOM Range rectangles](https://developer.mozilla.org/en-US/docs/Web/API/Range/getClientRects): measure a hidden full-text mirror using browser shaping instead of measuring a text prefix on a canvas. Selection rectangles also support mixed-direction runs without painting over gaps.
- [Reduced motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion) and [forced colours](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/forced-colors): motion follows the existing global policy; forced colours restore native caret and selection.

## Behavior

- Default movement: 90 ms strong ease-out, no bounce or trail. Interrupted transitions retarget from the displayed position.
- Typing, focus changes, resizing, and horizontal scrolling snap rather than sweeping across the field. Typing animation is optional.
- Rounded selection uses the accent colour, with selected text in the on-accent colour (Appearance / Accent text). Overlays never capture pointer events.
- Blinking restarts only when text, selection, focus, or blink preferences change, not on every unrelated key release.
- Rendering batches selection/input events into one animation frame. A hidden mirror accounts for font shaping, letter spacing, selection direction, and horizontal input scroll.
- IME composition uses native editing. Blur hides both visuals. Disposal removes observers, events, frames, and blink timers.

## Settings

Existing `caretSmooth` remains backward compatible. New fields merge into older theme files:

| Field               | Default | Valid values      |
| ------------------- | ------- | ----------------- |
| `caretSmoothTyping` | `false` | Boolean           |
| `caretMoveDuration` | `90`    | Integer, 0-200 ms |
| `selectionSmooth`   | `true`  | Boolean           |
| `selectionRadius`   | `3`     | Integer, 0-8 px   |

Global animation speed scales movement duration. Reduced or disabled motion overrides spatial animation.

Run `npx electron-vite build`, then `node scripts/check-caret.cjs` and
`node scripts/check-preferences.cjs`. Automated geometry checks do not substitute for
trying the movement on your monitor, especially IME candidates and high-DPI rendering.
