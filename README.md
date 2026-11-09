# rei

A minimal and opinionated Chromium browser built on Electron, Svelte, and TypeScript.

## Download

Download the Windows x64 installer (`rei-1.0.0-setup.exe`) or standalone portable
executable (`rei-1.0.0-portable.exe`) from the [v1 release](https://github.com/mqt464/rei/releases/tag/v1).
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

Privacy settings include "Do not sell or share my data" (Global Privacy Control) and
"Send Do Not Track". Both are optional and apply to normal and incognito tabs.
GPC sends `Sec-GPC: 1` and exposes `navigator.globalPrivacyControl`; DNT sends
`DNT: 1` and exposes `navigator.doNotTrack`. These signals request privacy choices;
they do not block trackers or guarantee that websites comply. Tracker blocking is
handled separately by the bundled uBlock Origin extension.

Run `node scripts/check-privacy.cjs` after building to check privacy signals and persistence.

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
