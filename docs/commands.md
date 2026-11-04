# Commands

Commands are editable local additions to Rei, not browser extensions. Open **Settings → Commands**
(`rei://settings/commands`) to manage them. The page uses the existing Settings cards, buttons, and
switches. **Open commands folder** opens `app.getPath('userData')/commands`.

## Install and authorize

Add a `.ts` or `.js` file directly to the commands folder. Rei watches for changes and shows each
command’s name, description, and optional version. New commands start disabled, with no permissions.
Enabling a command grants all its declared intents at once. Only enable commands you trust;
no access prompts appear on each invocation.

Type `/` in the address bar to find installed commands. Enter runs the selected command. Slash
queries never go to a search provider. Disabled commands are hidden from the address bar and cannot run. Unknown commands do not become web searches.

**Show file** reveals the source in your file manager without executing it. **Remove…** asks before
moving that file to the system trash. The bundled `download.ts` is copied only on first initialization.
Rei does not overwrite local edits or restore a deleted bundled command on restart or upgrade.

## Author a command

```ts
import { defineCommand } from 'rei/commands'

export default defineCommand({
  name: 'Download',
  command: 'download',
  description: 'Download media playing in the active tab.',
  version: '1.0.0',
  intent: {
    'activeTab.media': 'Identify the video or audio you are playing.',
    'downloads.enqueue': 'Save that media to your download folder.'
  },
  async run(context) {
    const media = await context.activeTab.media.current()
    await context.downloads.enqueue(media)
  }
})
```

`name`, `command`, `description`, `intent`, and `run` are required. `version` is optional. Command
names use lowercase letters, numbers, and hyphens, starting with a letter. Duplicate names are
unavailable until renamed. A file must be a regular file smaller than 128 KB; at most 100 files load.

Rei installs `rei.d.ts` and `tsconfig.json` alongside commands for editor IntelliSense and type
checking, including JavaScript files. Supported TypeScript uses erasable types. Additional runtime
imports, packages, enums, and namespaces are not supported; keep a command self-contained apart
from its `rei/commands` import. Metadata must be synchronous and must not use browser capabilities.

An intent key is a requested capability; its string explains the command’s purpose. These are the
initial capabilities:

- `activeTab.media`: read the active tab’s detected media title, page address, source address, and
  opaque identity. Embedded HTTP(S) players are included. It does not expose arbitrary page content,
  cookies, other tabs, or browsing history.
- `downloads.enqueue`: queue that same detected media in Rei’s Downloads page. The host uses its
  captured snapshot, not a caller-supplied address. It also requires granted `activeTab.media` access.

Changing or adding an intent’s reason disables the command until it is enabled again, granting its
updated intents. Disabling preserves grants; removal through Settings clears them. New capabilities must be implemented in Rei before
a command can request them. Unknown intent keys are errors, not unrestricted permissions.

## Runtime boundary

Each metadata inspection and invocation uses a worker inside a separate sandboxed renderer with its
own temporary session. Commands cannot access the DOM or WebRTC. Metadata inspection has no browser
capabilities. Commands have no Node.js, filesystem,
process, cookie, or unrestricted network API. Rei checks declarations and current user grants on
every privileged call. Calls bind to the active tab’s media at invocation, not a later tab selection.
The sandbox allows at most 64 capability calls and closes after completion or a ten-second execution limit; queued downloads continue
outside it. Revoking access prevents subsequent calls, not downloads already authorized and queued.

Type declarations assist authors; runtime checks enforce access. Treat installed source as untrusted
code even when it has a familiar name. Only enable commands whose behavior you trust.

## Bundled `/download`

Play video or audio, focus the address bar, type `/download`, and press Enter. There is no picker,
save dialog, or success confirmation. Rei queues currently playing media in that tab, falling back
to the most recently played media when nothing is playing, even if focusing the bar pauses it.
The last captured media source survives playback ending or the player clearing its source.
Progress, cancellation, retry, processing, and errors use the existing
Downloads page. The target remains fixed when you scroll, navigate, or change tabs.

For YouTube, TikTok, and X, Rei resolves an individual video/post address when available. For feeds,
it looks for a permalink next to the playing element. For X blob players, Rei matches the player's
poster video identity to an observed video.twimg.com playlist or MP4 and prefers that direct media
over a post address, which may belong to a quote or reply without video. Unrelated video requests
are not selected. Direct HTTP(S) media addresses also work.
If only a blob address is available without an identifiable video page, Rei reports an error rather
than downloading a whole feed. A page with multiple indistinguishable clips may require opening
the individual video page first. There is no DRM bypass or authenticated-cookie sharing.

Rei uses `yt-dlp` from `app.getPath('userData')/command-tools` or PATH. When absent, the first download
fetches the official standalone build from the `yt-dlp/yt-dlp` GitHub release and verifies its declared
size and SHA-256 before installation. This needs an internet connection. Rei uses its bundled Node.js
runtime for extraction. Install `ffmpeg` on PATH or in `command-tools` for separate video/audio
merging and higher-quality formats. Without FFmpeg, Rei requests an already-combined format.
Site support and available formats depend on yt-dlp and the source site. Managed tools can be updated
by replacing their executable; they are not updated on each download.

Media downloads always use the configured download directory without prompting. Command code
cannot choose a different destination. Incognito media jobs do not persist in download history.
Cancellation stops the job; it does not remove an existing finished file. Media jobs cannot pause
or resume in place; retry starts extraction again. Downloads stop when Rei quits.

## Checks and prototype

After building with `electron-vite build`, run `npm run check:commands`. Tests use a scratch profile,
local media fixtures, and a fake downloader process; they do not fetch media from live services.
They cover sandbox restrictions, grants, declaration changes, Settings controls, playback selection,
silent queueing, fixed targets, errors, retries, and deleted bundled commands surviving restart.
UI captures are written under `out/commands-check`. Scratch profiles remain in the OS temp folder.

`npm run prototype:commands` opens the separate throwaway Settings prototype. Its three layouts use
`?variant=A`, `?variant=B`, or `?variant=C`, with a bottom switcher and arrow-key navigation. All
prototype state is in memory; it changes no command files or permissions. Production uses a compact command list with one enable toggle per command and the folder button below it. No prototype branch or commit is created automatically.
