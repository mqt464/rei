# rei

A minimal and opinionated Chromium browser built on Electron, Svelte, and TypeScript.

## Features

- Vertical tabs with drag-to-reorder, incognito tabs, and configurable startup sessions.
- An address bar for web searches, history, open tabs, site shortcuts, and local slash commands.
- Full uBlock Origin enabled by default, plus Chrome extension support.
- A download manager with progress, pause/resume, retries, and download history.
- Custom themes, fonts, wallpapers, animations, and keyboard shortcuts.
- Optional tab sleeping and discarding to reduce background work and memory use.
- Find in page, per-site permissions, and searchable browsing history.

## How it works

Electron renders websites in sandboxed Chromium views, separate from the Svelte browser UI.
Pages have Node.js disabled. Settings and browsing data stay in your local app profile.
Searches use Google; online address-bar suggestions are opt-in.

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

## Notes

- Chrome extension compatibility is incomplete; not every extension or API works.
- Local browsing data is not encrypted. Incognito does not make you anonymous, and downloaded files remain on disk.
- Local commands require permission before use. The bundled `/download` command saves media playing in the active tab.
- Tab discarding cannot preserve all page state. Exempt important editors and call sites.

More detail: [commands](docs/commands.md), [extensions](docs/extensions.md),
[downloads](docs/downloads.md), and [website permissions](docs/website-permissions.md).
