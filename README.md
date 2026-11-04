# rei

A custom Chromium-based web browser with a minimal, modern, and command pallete focused interface. It supports tabs, downloads, bookmarks, and Chrome extensions, with a focus on simplicity, customization, and low resource usage using Svelte and Typescript.

Full uBlock Origin is bundled and enabled by default. Open the puzzle button immediately
right of Settings for extension controls, or visit `rei://settings/extensions` to manage
extensions. Bundled uBlock Origin can be disabled; its choice survives restarts.
See [extension support and distribution](docs/extensions.md) for compatibility, licensing,
source archives, and validation commands.

## Commands

Local slash commands extend the address bar. Manage installed files, enabled state, and individual
intent permissions in **Settings → Commands**. The editable bundled `/download` command queues
media playing in the active tab without a confirmation or save dialog. New commands start disabled
with no access; authorize them once in Settings. See [Commands](docs/commands.md) for authoring,
IntelliSense, runtime limits, media downloader setup, tests, and the throwaway Settings prototype.

## Search and browsing

Enter a search or web address in the address bar and press Enter. Searches use Google.
Addresses without a scheme use HTTPS; enter `http://` explicitly for HTTP-only sites.
Pages render inside the app using Electron's Chromium engine, isolated from the browser UI
with sandboxing enabled and Node.js disabled. Links requesting a new window open in a
new tab.

### Incognito tabs

Open an incognito tab with Ctrl+Shift+N (Command+Shift+N on macOS).
Rebind it under Settings > Keybinds.
Incognito tabs have a private indicator and share a temporary cookie session only
with other incognito tabs in the same window. Links and popups stay incognito.
Closing the last incognito tab clears that session; closed private tabs cannot be
reopened or restored on startup. Private browsing history, search selections,
suggestion caches, and download history are not saved. Discarded private tabs keep
their restore state in memory instead of the disk cache. Extensions and online
address-bar suggestions are disabled in incognito, and tab suggestions do not mix
normal and private tabs.

Private tabs start blank by default. Settings > Privacy lets you opt into using
your configured new-tab page. Downloaded files remain on disk. Incognito is not
anonymity: websites, your employer, and your network provider may still see activity.
Run `node scripts/check-incognito.cjs` after a build to check private-tab isolation.

The address bar is a multi-mode picker: All, Search engine, Websites, Opened tabs, and
History. Use Alt+Left/Right to switch modes; results have no mode-selector row.

- **All:** an exact-query Google action, actual browsing history, and matching open tabs.
  No web-result scraping or query autocomplete runs in this mode. On a fresh profile,
  unfamiliar site names fall back to Google; use Websites to discover a new destination.
- **Search engine:** Google search actions and optional Google query autocomplete.
- **Websites:** known destinations plus optional online website discovery. Entries show
  real result titles and destination URLs and open those URLs directly.
- **Opened tabs:** live tab titles and addresses; selecting one switches to that tab.
- **History:** previously visited destinations, including their titles, paths, and searches.

Cached discoveries are never treated as visits or mixed into All. Google's suggested query
expansions appear only in Search engine mode, not in All.
Focusing the address bar does not open results. Start typing to see matches; an empty
query never lists tabs or history. A close website or tab match appears first, followed
by the exact-query Google action. Otherwise Google stays first, above weaker matches.
Duplicate destinations collapse into one row, preferring an already-open tab. Existing
Google results for the same query do not add a duplicate search row in All.
Wrapped Google links, including JavaScript and refresh redirect pages, are resolved in
temporary sandboxed Chromium views. Navigation stops before fetching the destination page.

Use Up/Down to select, Enter to activate, and Escape to dismiss. Use
Alt+Left/Right to change modes. Local matches appear immediately; explicit online lookup
runs after a 200 ms pause. Arriving results do not move a keyboard-selected row.
Recognized web addresses open directly without remote lookup.

Discovered website suggestions match domain identity, an exact homepage name, or an explicitly typed
address. A third-party profile or article mentioning a site does not count as that site,
even when its title matches exactly. This also applies to cached discovery results.
Actual history and open tabs can additionally match page titles and paths. Matching ignores arbitrary URL
parameters and descriptions. Every query term must match. Search-results pages use their
site identity, not a potentially stale title; open search tabs can also match their actual
query. Exact domains and titles rank above partial matches. Compact abbreviations
(`gthb` for GitHub, `yt` for YouTube) and small
typos remain weaker matches. This is deterministic relevance, not semantic intent inference.
Visits, typed navigations, recency, and prior selections contribute bounded ranking boosts;
weak lexical matches do not become strong merely through frequency. Choosing the same
destination for the same query at least twice also teaches a personal query shortcut.
Only successful page visits create history, including in-page navigation. Switching tabs
does not add visits. Titles and icon URLs update without incrementing visit counts.

### Local search storage

The main process stores history, learned choices, and provider responses in SQLite at
`app.getPath('userData')/search.sqlite`, using Electron's built-in `node:sqlite` support.
No native dependency or separate database server is needed. The database is shared across
windows and survives app restarts; renderers never receive direct database access.

History retains up to 50,000 visits across 5,000 addresses for 90 days. Learned query choices are bounded to
5,000 pairs and expire with their history or after 90 days. Provider responses expire after
five minutes, with at most 100 provider/query entries. Offline lookup may reuse unexpired
cache entries in explicit online modes, but never makes a network request for new results.
Completed visits, not search-result appearances, are the source of browsing history.

Settings / History (`rei://settings/history`, `Ctrl+H` or `Cmd+H`) shows visits by day.
Search titles and URLs, filter by time or site, and use a custom date range. Select visits
individually, with Shift-click, or by page; open them in tabs or delete them together.
Links support Ctrl/Cmd-click and middle-click. Each visit also offers incognito, copy link,
and more from this site. Deletion requires confirmation; clearing history accepts a time
range and leaves cookies, downloads, and open tabs untouched. Changes update across windows
and address-bar history. The shortcut is editable in Settings / Keybinds.
Existing databases keep their saved latest visit per address; older individual timestamps
cannot be recovered. New browsing records each visit. Run `node scripts/check-history.cjs`
after building for storage, migration, privacy, and settings integration checks.

Use **Clear search data** at the bottom of the tab sidebar. A native confirmation dialog
protects deletion. Clearing removes history, learned choices, and provider caches across
windows and cancels in-flight lookup updates. Open tabs, cookies, downloads, and site
shortcuts remain intact; subsequent browsing can create new history. Database startup
errors are reported instead of silently resetting data, and runtime storage failures appear
in the picker.

The database is local but not encrypted. It contains visited URLs (including query strings),
titles, selected queries, and cached provider responses. Credential-bearing URLs are not
stored. There is no private-browsing mode or tab-session restoration in this implementation.

Website rows include clean URLs, source labels, descriptions and favicons. Missing icon
URLs fall back to the site's `/favicon.ico`; unavailable icons show a globe. Icons are fetched
in the main process through a separate credentialless session, cached, and passed to the UI
as image data, so sites do not need CORS headers. Icon requests omit cookies and referrers,
including when a website result has not been opened yet.

### Tabs

The left sidebar contains vertical tabs with page titles, icons, selection and close controls.
Each tab owns a separate sandboxed Chromium page; switching preserves its page state.
Use Ctrl+T for a new tab, Ctrl+W to close, Ctrl+Tab / Ctrl+Shift+Tab to cycle, and Ctrl+L
to focus the address bar (Command instead of Ctrl on macOS). Ctrl+Shift+T reopens the most
recently closed tab at its original position. Each window remembers up to 25 closed tab
addresses until it closes; reopening reloads the page rather than restoring page state or
navigation history. Change or disable this shortcut in Settings / Keybinds. Closing the last tab creates
a blank tab. Links requesting a new window open in a new tab. Tabs are not restored after
restarting the app.

### Keyboard bindings

Settings → Keybinds (`rei://settings/keybinds`) lists each action in a shared card,
with its name on the left and a clickable shortcut field on the right. Click a field,
press a combination or up to four sequential combinations (for example, Ctrl+K then
Ctrl+C). The field starts at `...` and previews modifiers and sequence steps as keys are pressed.
Bindings save automatically after a 1.2-second pause, allowing additional sequence steps.
Escape cancels and restores the previous binding. Delete or Backspace disables the action;
Restore defaults restores every binding. Shortcut fields size to their text. Changes save
to `preferences.json` and apply immediately to browser chrome, pages and existing frames.
Duplicate bindings and ambiguous sequence prefixes are rejected. Sequence steps must
arrive within 1.2 seconds; the first step requires Ctrl, Command, Alt or a function key
so normal typing stays untouched. System-reserved shortcuts may not reach the app.

The audit retains new/close tab, next/previous tab, address focus, sidebar toggle,
Ctrl+1–9 tab selection and development-only F12. Added actions: back (Ctrl+[), forward
(Ctrl+]), reload (Ctrl+R), reload without cache (Ctrl+Shift+R), settings (Ctrl+,), mute
(Ctrl+Shift+M), zoom in/out (Ctrl+= / Ctrl+-), and reset zoom (Ctrl+0). Defaults using
Ctrl also accept Command on macOS, except the existing numbered-tab bindings.
Address-bar result navigation and context-menu keys remain local to their controls.
Native editing shortcuts (copy, paste, cut, undo, redo and select all) stay native.
Ctrl+F (Command+F on macOS) opens Find in page as an animated, focused field in the
top-right corner without resizing the page. Typing highlights matching text on the
active page and shows the match count. Enter / Shift+Enter moves to the next / previous
match. Escape returns focus to the page while keeping the query and highlights; the
close button clears them. Switching tabs or navigating dismisses the finder. Its input
uses the address bar's shared smooth caret and selection settings. Find in page can be
remapped or disabled in Settings / Keybinds, like other actions.

Checks: `node scripts/check-keybinds.cjs`, then `npx electron-vite build` and
`node scripts/check-find-in-page.cjs` for finder focus, matches, caret and custom bindings;
`node scripts/check-tab-shortcuts.cjs`; `node scripts/check-settings.cjs` covers
settings navigation and responsive layout, including the Keybinds page.

### Site search shortcuts

Type `yt cats`, `gh svelte`, or `wiki chromium` to search those sites directly, without
Google lookup. Pressing Space after a keyword turns it into a non-editable `YouTube | `
block, with the query edited separately. Backspace at the start of the query restores the
original keyword; clicking the block also exits the shortcut. Empty scoped queries do not
fall back to Google. Edit shortcuts in Settings under "Site search".
Each line uses `keyword | Name | https://site/search?q={query}`; the query is URL-encoded.
Shortcuts are saved locally. You can change or remove the defaults or add your own.

Online lookup in Search engine and Websites modes sends unfinished search text to Google.
Turn online suggestions on or off in Settings. All,
History, and Opened tabs do not send lookup queries. Autocomplete requests omit cookies. Website
results are read from Google using a temporary sandboxed Chromium view and a separate,
non-persistent search session, not the browsing session. No account credentials are copied.
Google's autocomplete endpoint and result markup may change; consent pages or verification
can prevent website results. The picker reports unavailable results rather than inventing
destinations, and Search engine mode remains usable.

### Settings

Click the sidebar gear or enter `rei://settings` to open Settings in the content area.
The gear reuses an existing Settings tab; it never replaces your current website.
Settings content is centered, with floating navigation for Appearance, Wallpaper, Caret,
Motion, Browsing, Search, Site search, Downloads, and Privacy. Appearance opens at
`rei://settings`; the other pages use `/wallpaper`, `/caret`, `/motion`, `/browser`,
`/search`, `/shortcuts`, `/downloads`, and `/privacy`. Settings tabs support normal switching, reordering, and closing. Online suggestions save
immediately; Site search lists configured websites and opens `site-search.json` in your default
JSON editor. Valid edits apply live across windows; invalid edits keep your last valid sites.
Existing site shortcuts migrate automatically. Clearing search data requires
confirmation and keeps open tabs, cookies, downloads, and shortcuts.

Run `node scripts/check-settings.cjs` after `npx electron-vite build` to check internal
routing, tab behavior, saved preferences, shortcut validation, cleanup, and narrow layouts.

Appearance controls Rei's interface font, text size, corner radius, and 17 colours: page and card surfaces,
tab sidebar, address bar, inputs, buttons, hover and selection states, outlines, text, muted
text, accents, accent text, focus rings, carets, errors, and scrollbars. Changes save automatically to
`app.getPath('userData')/theme.json` and apply across windows. Reset appearance restores
the original palette and typography without removing wallpaper.

**Open theme.json** opens the actual saved file in your default JSON editor. Saved edits
apply live across windows. Invalid JSON or invalid setting values keep the last valid theme
active and show an error until the file is corrected. There is no separate import/export UI.

Caret settings control the address-bar insertion cursor's shape, width, height, roundness,
opacity, blinking, blink interval, and smooth movement, with an interactive preview. Navigation
uses short ease-out movement; typing and horizontal scrolling stay immediate by default.
Settings / Caret also offers typing animation, movement duration (0-200 ms), smooth text
selection, and selection corner radius (0-8 px). Highlights use the accent colour;
selected text uses the on-accent colour (Appearance / Accent text).
These settings save to `theme.json`, update live, and reset with Reset caret. The preview
and address bar share the same renderer. System reduced motion and forced colours are
respected; IME composition falls back to native editing. Other
Rei text fields use the caret colour but retain native text-editing behavior. Motion controls
follow system accessibility preferences, reduce motion to colour/opacity feedback, or disable
animations entirely; animation speed affects Rei transitions and its native sidebar reveal.

Caret implementation notes and upstream resources: [Caret motion](docs/caret-motion.md).
After building, run `node scripts/check-caret.cjs` for focused caret and selection checks.

Browsing settings include a custom new-tab URL, default website zoom, spellchecking,
address-bar auto-hide, background opening of website-created tabs, and confirmation before
closing multiple tabs. Search supports Google, DuckDuckGo, Bing, and Brave Search. Online
query suggestions still come from Google. Downloads can use a chosen folder or ask where
to save each file; automatic downloads choose a new filename instead of overwriting files.
Privacy settings can stop saving new history/learned choices and send Do Not Track headers
(which websites may ignore). Browser preferences save to `preferences.json` across windows.

The matching sidebar button opens `rei://downloads` (Ctrl+J / Command+J). Track progress,
pause/resume, cancel/retry, search history, and open or reveal files. Settings / Downloads
controls the folder, save prompts, and history retention. Clearing history never deletes
files. See [Download manager](docs/downloads.md). After building, run
`node scripts/check-downloads.cjs` for transfer, history, settings, and layout checks.

Wallpaper accepts PNG, JPEG, or WebP images up to 6 MiB and 40 megapixels, with Fill/Fit
and dimming controls. Images are stored locally with the theme and appear only on blank
tabs, never on settings or websites. Rei does not recolour website content, favicons, or
operating-system window frames and dialogs. Websites cannot access theme preferences.

Run `node scripts/check-theme.cjs` after building to check every colour token, typography,
multi-window updates, wallpaper controls, validation, failed-save recovery, website isolation,
and persistence across a real application restart.

Run `node scripts/check-preferences.cjs` to exercise custom controls, external JSON editing,
caret/motion settings, all browser preferences, file download collision protection, and restart
persistence. The shared UI components and their usage rules live in
`src/renderer/src/components/ui/README.md`.

The browser UI uses native sidebar, page and overlay views, so menus and suggestions do
not hide the loaded page.

## Appearance and startup

`rei://settings` controls interface density, sidebar/tab layout, address-bar geometry,
scrollbars, hover motion, interface typography, and optional website typography overrides.
All appearance values, including palette mode, custom colours and wallpaper effects, are stored
in `theme.json`; **Open theme.json** opens that file in the system editor. Existing theme
files gain defaults for new fields, and valid external edits apply live.

Wallpaper supports position, fit, blur, dimming, bottom fade, ordered colour dithering,
and a folder slideshow. Images stay local. Slideshow folders support up to 200 PNG/JPEG/WebP
files, each at most 6 MB; dithering processes images at up to 2048px. Palettes can follow
the system appearance or use the built-in Dark and Light presets. Custom keeps your edited palette.
Editing a preset colour captures its displayed palette and switches to Custom without changing
the other colours. Switching presets does not overwrite your saved custom palette.
Dark uses near-black surfaces and pink accents; Light uses matching pale surfaces and a plum accent.
Time-based switching is no longer supported; older manual themes retain their custom colours.

`site-search.json` is an array of up to 30 objects with `keyword`, `title`, and `url` fields.
Keywords must be unique, with 1-20 lowercase letters, digits, hyphens, or underscores. URLs must
use HTTP(S) and contain `{query}`, which is replaced by the encoded search term. An empty array
disables all site searches. Saved JSON edits update the list and address-bar search immediately.

Browsing settings provide blank/chosen-page/session startup. Session URLs are saved
locally in `session.json`.

Performance settings (`rei://settings/performance`) manage two independent inactive-tab modes:

- **Sleeping** freezes a live page through Chromium's lifecycle API. Selecting it resumes
  its existing document without reloading. Its favicon turns grey. This reduces background
  work; memory savings vary because the live document remains allocated.
- **Discarding** saves encrypted navigation history/page state, scroll, zoom, and mute state
  to a temporary disk cache, then removes the view and closes its web contents. Selecting
  the tab recreates its page and restores the saved state where supported. Discarded tabs
  use a dashed-circle icon and dimmed text. Arbitrary JavaScript state is not preserved.

Each mode has its own 0-6 hour slider and hostname exceptions; 0 means Off. Durations use
hours, minutes, and seconds, with one-second steps. Older delays above 6 hours are capped
at 6 hours when loading preferences. Both modes are
off by default. Timers measure time since leaving a tab, checked every 15 seconds, and
discarding takes priority when both delays have elapsed. A sleeping tab can later discard.
Active, audible, captured, downloading, and detected edited-form tabs (including iframes)
are protected. Exceptions also cover subdomains. Disabling sleeping resumes existing
sleepers; disabling discarding prevents future discards without eagerly reloading pages.

Restore records are encrypted with Electron's system-backed safe storage and deleted on
wake, tab close, or window close. If encryption or a disk write fails, the page stays live.
Records are capped at 8 MB per tab. A crash can leave encrypted temporary files; they are
not a restart/session backup. Session startup still restores saved URLs, not full page state.
Unsaved-work detection and page-state restoration are best-effort; exempt important editors
and call sites when their state must not be lost.

Run `node scripts/check-performance.cjs` after `electron-vite build` to check freeze/thaw,
discard/restore, history, scroll, zoom, mute, exceptions, disk failure safety, cache cleanup,
and the Performance settings using an isolated profile.

Run `node scripts/check-appearance-startup.cjs` after `electron-vite build` to exercise
appearance wiring, image processing, JSON completeness, sleeping/waking, and real startup
restarts, using an isolated profile and native Electron windows.

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode) + [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode)

## Project Setup

### Install

```bash
$ bun install
```

### Development

```bash
$ bun run dev
```

### Build

```bash
# For windows
$ bun run build:win

# For macOS
$ bun run build:mac

# For Linux
$ bun run build:linux
```
