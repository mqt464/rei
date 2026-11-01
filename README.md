# rei

A custom Chromium-based web browser with a minimal, modern, and command pallete focused interface. It supports tabs, downloads, bookmarks, and Chrome extensions, with a focus on simplicity, customization, and low resource usage using Svelte and Typescript.

## Search and browsing

Enter a search or web address in the address bar and press Enter. Searches use Google.
Addresses without a scheme use HTTPS; enter `http://` explicitly for HTTP-only sites.
Pages render inside the app using Electron's Chromium engine, isolated from the browser UI
with sandboxing enabled and Node.js disabled. Links requesting a new window open in a
new tab.

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

History retains up to 5,000 addresses for 90 days. Learned query choices are bounded to
5,000 pairs and expire with their history or after 90 days. Provider responses expire after
five minutes, with at most 100 provider/query entries. Offline lookup may reuse unexpired
cache entries in explicit online modes, but never makes a network request for new results.
Completed visits, not search-result appearances, are the source of browsing history.

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
to focus the address bar (Command instead of Ctrl on macOS). Closing the last tab creates
a blank tab. Links requesting a new window open in a new tab. Tabs are not restored after
restarting the app.

### Site search shortcuts

Type `yt cats`, `gh svelte`, or `wiki chromium` to search those sites directly, without
Google lookup. Pressing Space after a keyword turns it into a non-editable `YouTube | `
block, with the query edited separately. Backspace at the start of the query restores the
original keyword; clicking the block also exits the shortcut. Empty scoped queries do not
fall back to Google. Edit shortcuts through the browser menu's "Site search shortcuts" action.
Each line uses `keyword | Name | https://site/search?q={query}`; the query is URL-encoded.
Shortcuts are saved locally. You can change or remove the defaults or add your own.

Online lookup in Search engine and Websites modes sends unfinished search text to Google.
Previously saved online-results preferences are still respected. All,
History, and Opened tabs do not send lookup queries. Autocomplete requests omit cookies. Website
results are read from Google using a temporary sandboxed Chromium view and a separate,
non-persistent search session, not the browsing session. No account credentials are copied.
Google's autocomplete endpoint and result markup may change; consent pages or verification
can prevent website results. The picker reports unavailable results rather than inventing
destinations, and Search engine mode remains usable.

The browser UI uses native sidebar, page and overlay views, so menus and suggestions do
not hide the loaded page.

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
