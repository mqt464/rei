# Website permissions

Normal and incognito tabs use explicit Electron permission request and check handlers.
Camera, microphone, location, notifications, clipboard reading, and sanitized clipboard
writing require approval. Other permissions are denied without prompting. Requests
without a valid HTTP(S) requesting origin, a valid top-level origin, or a registered
browsing tab are denied. Background tabs cannot open permission prompts.

Prompts show the requesting origin and, for embedded content, the top-level origin.
Decisions apply only to that origin pair and permission. Camera and microphone
remain separate decisions, even when a site requests both together. Unknown media
types are denied. Navigation, renderer crashes, tab destruction, and window closure
cancel pending approval. Only one prompt can open per window at a time.

Normal tabs can remember Allow or Block using the prompt checkbox. Remembered
decisions are stored in `website-permissions.json` in the application profile.
Without the checkbox, the answer applies to that request only. Not now saves nothing.
The controls icon beside the address opens permissions for the current site,
including temporary incognito choices. Settings > Privacy > Site permissions
groups remembered choices by site in collapsed sections. Reset affects future checks and requests, not existing
media streams. Reload pages after resetting.

Incognito decisions never use or update the normal profile's permission store.
They are shared only by incognito tabs in the same window, held in memory, and
cleared when that window's last incognito tab closes. They never appear in Settings.
OS-level permissions still apply; website approval cannot override an OS denial.

Run `node scripts/check-website-permissions.cjs` for isolated handler checks.
These checks mock Electron; real device access and native dialogs need manual testing.

After building, run `node scripts/check-website-permissions-ui.cjs` for real Electron
UI checks. It uses an isolated profile and local test page, briefly shows a test
window, and saves desktop/narrow captures and a source-hash receipt under
`out/permissions-check`. The checks cover disclosures, current-site scoping, reset,
keyboard focus, navigation dismissal, and incognito isolation.
