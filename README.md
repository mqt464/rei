# rei

A minimal and opinionated Chromium browser built on Electron, Svelte, and TypeScript.

## Download

Download the Windows x64 installer (`rei-1.1.0-setup.exe`) or standalone portable
executable (`rei-1.1.0-portable.exe`) from the [v1.1.0 release](https://github.com/mqt464/rei/releases/tag/v1.1.0).
The builds are unsigned; Windows may display an unknown-publisher or SmartScreen warning.
macOS and Linux binaries are not included in this release.

## Features

- Vertical tabs with drag-to-reorder, incognito tabs, and configurable startup sessions.
- An address bar for web searches, history, open tabs, site shortcuts, and local slash commands.
- Full uBlock Origin enabled by default, plus Chrome extension support.
- A download manager with progress, pause/resume, retries, and download history.
- Custom themes, fonts, wallpapers, animations, and keyboard shortcuts.
- Optional tab sleeping and discarding to reduce background work and memory use.
- Find in page, per-site permissions, and searchable browsing history.
- Fullscreen media playback with Escape to return to the browser.

### Split view

Right-click a website tab and choose **Split view with current tab** to keep two
pages side by side. Both tabs show a linked-pane badge with their left/right side;
hover a badge to see its partner. Selecting either tab restores the pair, and
clicking a page makes it the target for the address bar and keyboard shortcuts.

Drag a pane's title to the other side to exchange positions; a quiet highlight
previews the destination. Drag the 2px divider to resize, or double-click it to
balance the panes. The divider has a wider invisible grab area. Focus a pane title
and press **Alt+Left/Right** to move it with the keyboard; focus the divider and
use **Left/Right** to resize (**Shift** for larger steps, **Enter** to balance).
Press **Escape** to cancel a drag. **Separate tabs** exits split view without
closing either page. Closing one pane keeps its partner open. Pairs are restored
with startup sessions, including their widths; private and normal tabs cannot be paired together.
Blank pages, internal browser pages, and failed navigations use the normal
single-page layout. Motion follows Appearance settings and reduced-motion preferences.

Run `npm run build && npm run check:split-view` to check tab menus, pairing,
focus, pane dragging, resizing, fullscreen layout, session persistence, and privacy boundaries.

### Website scrollbars

Websites use Rei's thin, rounded scrollbar styling by default, following the
scrollbar color, thickness, and visibility in Appearance settings. Auto mode
reveals the thumb while scrolling or pointing near a scrollbar, then hides it
after two seconds. Website scrollbar CSS takes priority over Rei's fallback;
native scrolling, keyboard controls, and forced-colors accessibility remain intact.
Pages that only set scrollbar colors keep those colors on Rei's thin scrollbar,
rather than switching back to the wide native scrollbar. Explicit website widths
(including `thin` and `none`) and custom scrollbar styles still take priority.

Run `node scripts/check-website-scrollbars.cjs` to check the fallback and website overrides.

### Text morphing

Appearance settings include Torph text morphing, enabled by default, with Subtle,
Balanced, and Expressive styles and separate switches for counters, status text,
action feedback, tab titles, and settings values. Timing follows the existing
Motion speed setting; Reduced and None disable text morphing, as does the system
reduced-motion preference.

Download readouts update at most five times per second while morphing. Long or
overflowing labels fall back to plain text to preserve wrapping and tab-title
ellipsis. Editable fields, filenames, URLs, error details, and visited websites
are not morphed.

## How it works

Electron renders websites in sandboxed Chromium views, separate from the Svelte browser UI.
Pages have Node.js disabled. Settings and browsing data stay in your local app profile.
Searches use Google; online address-bar suggestions are opt-in.

Privacy settings include automatic rejection of optional cookies on supported sites,
tracking-link cleaning, third-party-cookie blocking, and "Do not sell or share my data"
(Global Privacy Control). These are enabled for fresh profiles; saved choices are preserved.
All apply to normal and incognito tabs. "Send Do Not Track" remains optional and off by default.
GPC sends `Sec-GPC: 1` and exposes `navigator.globalPrivacyControl`; DNT sends
`DNT: 1` and exposes `navigator.doNotTrack`. These signals request privacy choices;
they do not block trackers or guarantee that websites comply. Tracker blocking is
handled separately by the bundled uBlock Origin extension.

Run `npm run check:privacy` after building to check protections, privacy signals, and persistence.
See [privacy protections](resources/privacy-protections.md) for scope and compatibility limits.

Type a URL, search, or slash command in the address bar. Open Settings from the sidebar or
enter `rei://settings` to customize the browser.

## Development

Install [Bun](https://bun.sh), then run:

```sh
bun install
bun run dev
```

Package with `bun run build:win`, `bun run build:mac`, or `bun run build:linux` on the target platform.
Build output goes to `dist/`.

After building, run `npm run check:fullscreen` to check fullscreen permissions,
media sizing, browser UI restoration, and Escape handling in Electron.

## Memory diagnostics

After building, run `npm run check:memory` on Windows. The check uses a disposable
profile with Rei's normal extensions. It opens and closes real Wikipedia, X, and
YouTube tabs three times, with one website open at a time. YouTube's playback
clock must advance; a loaded player shell is not counted as video playback.
X is tested logged out, so this does not exercise an authenticated feed.
Automatic tab sleeping and discarding are disabled only in the test profile,
so they cannot hide retained tab memory.

Add `-- --video-soak --trace-memory` to verify two additional minutes of playback
per cycle and record process memory every 200 ms. These live-network checks take
minutes, not seconds, and can fail when sites block access or media stalls.
They never use your browsing profile or change your tab-sleep/discard settings.

Results go to `.cache/memory/real-tabs.json`. Private bytes measure process-private
allocation, not exclusively resident RAM. Summed working sets count shared pages
multiple times. The closed-tab check rejects growth of 150 MiB or more between
the first and last closed cycles and verifies website WebContents destruction.
This coarse short-run budget cannot rule out smaller or long-running leaks.
Normal samples precede a separately labeled diagnostic garbage collection.

Run `node scripts/check-website-scrollbars.cjs` to also check that removed
custom-colored scrollers do not retain detached DOM trees after their timers expire.

## Default browser

Install a packaged build, then open Settings > Browser > Make default. Windows opens
Default Apps; select Rei for HTTP and HTTPS. macOS and Linux use the system protocol
registration flow. Development builds do not change your default browser. Linux needs
an installed desktop entry; a standalone AppImage may need desktop integration first.

External HTTP and HTTPS links open in normal tabs in the last focused Rei window,
restoring it when minimized. Links received during startup wait until the browser is
ready. A second launch forwards links to the running instance instead of opening a
duplicate process. With no windows open, Rei creates one. Existing tabs remain intact;
an empty normal tab can be reused. Unsupported schemes and URLs containing credentials
are rejected. Registration does not silently replace another browser's defaults.

Run `npm run check:default-browser` to check routing and registration wiring. Installed
OS association changes still need a manual test on each platform.

## Updates

Settings → Updates shows the installed version, download progress, errors, and a manual
update check. Automatic updates are enabled by default: installed builds check after
startup and every six hours, then download stable GitHub releases in the background.
Rei asks before restarting to install; save your work first. Disable automatic checks
in Settings without losing manual checks. Development builds do not check for updates.
Linux automatic updates require AppImage; update deb and snap installations through
their package manager.

To ship an update, bump `package.json` to a higher version and build on each target
platform. Upload the installers, blockmaps, macOS ZIP, and generated `latest*.yml`
metadata to the matching public GitHub release in `mqt464/rei`. Publish the draft as a
stable release; drafts and prereleases are not offered. Use properly signed Windows
and signed/notarized macOS builds for production. Keep signing identities consistent
between releases; macOS updates require code signing. Never embed a GitHub token in
the application. A real published release is needed for an end-to-end install test.

## Notes

- Chrome extension compatibility is incomplete; not every extension or API works.
- Local browsing data is not encrypted. Incognito does not make you anonymous, and downloaded files remain on disk.
- Local commands require permission before use. The bundled `/download` command saves media playing in the active tab.
- Tab discarding cannot preserve all page state. Exempt important editors and call sites.

More detail: [commands](docs/commands.md), [extensions](docs/extensions.md),
[downloads](docs/downloads.md), and [website permissions](docs/website-permissions.md).
