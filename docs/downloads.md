# Download manager

The download button immediately right of Settings opens `rei://downloads` and reuses an
existing downloads tab. Ctrl+J (Command+J on macOS) opens it too; change the binding in
Settings / Keybinds. The manager shares the settings UI components and theme.

- Live progress, transfer speed, estimated time remaining, file size, source, and date.
- The sidebar download icon shows an active-transfer badge and byte-weighted progress bar.
  Unknown file sizes use an indeterminate bar; paused transfers retain their progress.
- Pause/resume supported transfers, cancel, and retry interrupted or cancelled HTTP(S) downloads.
- Open files, reveal files in their folder, copy links, and open the download folder.
- Search by filename or URL; filter active, completed, or stopped downloads.
- Remove individual entries or clear finished history without deleting files or cancelling transfers.

Retries use the browser session. Expired links or downloads requiring a form submission
may need downloading again from the original website. Files never open automatically.

Settings / Downloads includes folder selection, save prompts, and download history.
History keeps the latest 500 finished entries in `downloads.json` across restarts.
Unfinished transfers return as interrupted and can be retried, not automatically resumed.
Turning history off clears finished entries and only shows transfers while active.
Automatic downloads retain collision-safe filenames instead of overwriting existing files.
The manager links back to these settings and can open the download folder directly.

After building, run `node scripts/check-downloads.cjs` for real Electron transfer controls,
collision protection, file actions, search, sidebar navigation, responsive layout,
history persistence, and history privacy checks. Set `REI_DOWNLOAD_CAPTURES` to a directory
to save screenshots of the downloads page, settings, and sidebar during the check.
