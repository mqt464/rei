# Extensions

Rei bundles full Manifest V2 uBlock Origin 1.75.0, not uBlock Origin Lite. It loads from local resources before browser tabs are created. No first-run download is required. Bundled filter assets work offline; uBlock Origin manages its own subsequent filter-list updates.

The Extensions button sits immediately to the right of Settings in the sidebar footer. It opens extension actions, including uBlock Origin's actual per-site popup. Manage extensions opens `rei://settings/extensions`. Installed extensions share one card with separators, manifest icons, and toggles in their headings. Icons are retained when an extension is disabled. The settings page supports enabling/disabling, opening extension options, visiting the Chrome Web Store, and removing non-bundled extensions with confirmation. Bundled uBlock Origin can be disabled, not removed. Its version updates with Rei.

## Runtime

- `src/main/extensions.ts` owns one extension runtime for the existing default browsing session. Keeping this session preserves website cookies and storage.
- Privileged browser UI and custom context menus use `persist:rei-ui`, which has no third-party extensions. Website and extension tabs receive only the sandboxed keyboard preload, never Rei's privileged UI API.
- This new UI session has its own local storage. A one-time, sandboxed probe copies only legacy search-suggestion consent and site-search shortcuts before extensions are loaded. Existing file-backed preferences, themes, search data, and browsing data stay in place. Website local storage is never copied into the privileged UI session.
- `electron-chrome-extensions` supplies browser actions, tabs, windows, context menus, and other APIs on top of Electron's limited native extension support. Real tabs are registered through the same create/select/close lifecycle as Rei's own controls.
- Both Manifest V2 and V3 installations are permitted. Electron does not implement all Chrome APIs; a successful installation is not a compatibility guarantee.
- `electron-chrome-web-store` supplies store installation. Clicking the store's install button starts installation without a second native confirmation. Optional-permission requests still require confirmation. File access is not granted. Store extensions do not auto-update in this initial implementation; silent updates and permission escalation need a separate review.
- `extensions.json` stores extension installation metadata and enabled choices. A disabled bundled extension stays disabled after restart. Extension-owned storage stays in Chromium's browsing profile.
- Extension options URLs must point to a currently loaded extension. Third-party pages never receive Rei's UI IPC handlers.
- Do Not Track uses the internal Rei Privacy Headers extension. Registering Electron `session.webRequest` listeners would prevent extension `chrome.webRequest` listeners from running.
- Tab discard destroys webContents. Waking recreates and re-registers the tab; its extension-facing ID changes. Stable extension-facing IDs across discard are not implemented.

## Extension API compatibility

In the installed Electron 44 runtime, an MV2 background page's native Chrome APIs become available after session preloads run. The extension library's non-isolated background branch injects too early, so uBlock Origin otherwise fails at startup with a missing `browserAction` API.

The main build emits `extension-api.preload.cjs` from the installed library preload. Frame injection waits for the first document readiness transition, before deferred scripts run. MV3 workers use the same patched bridge without a document-readiness delay. The bridge keeps Chromium's separate `browser` namespace aligned with the patched `chrome` namespace and does not freeze it, so native aliases and extension polyfills can use the supplied APIs. The build fails if expected upstream code changes, rather than silently shipping a broken patch. The original package stays unmodified.

Permission checks recognize wildcard host grants, including MV2 host patterns in `permissions`. Already granted required permissions do not cause another prompt. Optional requests are checked against the manifest before confirmation. Permission dialogs attach to the parent browser window so an extension closing its own popup does not close the dialog.

`tabs.getCurrent()` returns the calling tab, not the active tab in the browser window. Popups and background workers receive `undefined`, as they are not tabs. The upstream library returned the active tab in those contexts; Proton Pass consequently selected its expanded-tab layout with percentage dimensions instead of its popup layout. Rei overrides that handler in `src/main/extension-compatibility.ts` and uses the extension's own popup dimensions, with no Proton-specific minimum size. The override uses the installed library's internal router/store and is covered by popup, tab, and worker regression checks.

Extension popups keep their rendered size instead of resetting to 25 by 25 pixels after load, and their position stays inside the display work area. Proton Pass sign-in opens in a Rei tab. Signed-in layouts and autofill have not been verified.

Rei implements `chrome.proxy.settings.get/set/clear/onChange` through an authenticated extension IPC bridge and Electron's session proxy backend. Both callback (`runtime.lastError`) and Promise callers are supported. System, direct, auto-detect, fixed HTTP/HTTPS/SOCKS servers, bypass lists, and inline or HTTP(S) PAC scripts are supported. Mandatory PAC scripts are rejected because this runtime cannot enforce their fail-closed behavior. Incognito scopes are rejected; `regular` and `regular_only` apply to Rei's shared browsing session, not its isolated settings UI session.

Proxy contributions persist in `extension-proxy.json`, without authentication credentials. The most recently installed eligible extension takes priority. Disabling or removing it restores the next eligible contribution or system proxy settings. Changes close existing session connections. Failed native updates report an error and roll back; failed restores prevent startup from claiming a working configuration. Proxy authentication challenges go only to the controlling extension's `webRequest.onAuthRequired` listeners with `webRequestAuthProvider` and `webRequest` permissions, including MV3 background workers. Authentication replies expire and are cancelled on controller changes. The bridge wakes a stopped MV3 worker when a challenge needs a listener.

`privacy.network.webRTCIPHandlingPolicy` uses Electron's actual WebRTC policy on existing and newly created browsing webContents. Other Chrome privacy settings are not implemented by this proxy bridge. This is browser-session proxy support, not a system VPN or a guaranteed kill switch. Authenticated local proxy routing is tested; signed-in Proton VPN servers and account flows remain unverified.

Managed storage is an empty, read-only policy store because Rei has no enterprise-policy backend. Reads return an empty object or caller-provided defaults, never extension-local data; writes fail through callbacks or rejected Promises. The earlier alias to local storage caused uBlock to cache its own local storage recursively under `cachedManagedStorage`, eventually preventing startup. The uBlock background preload removes only that obsolete cache key; filters and user settings remain intact.

The bridge preserves native callback errors across the cloned runtime API. Native messaging callbacks receive their scoped `runtime.lastError`, including missing-receiver failures; Promise messaging still rejects. Consuming the native callback error at the bridge boundary prevents Chromium from reporting it as unchecked without fabricating a successful response. Proton's startup self-message can still have no receiver before its UI opens; the failure is delivered to its callback, not turned into success.

Electron's native loader can warn about `contextMenus`, `notifications`, `webNavigation`, and `privacy` even when Rei supplies those APIs. The regression probe exercises context-menu creation/removal, notification permission lookup, navigation-frame lookup, and real WebRTC policy changes. Only WebRTC IP handling is implemented in `chrome.privacy`; other privacy settings return explicit unsupported errors instead of silently succeeding. Privacy-only extensions can use WebRTC controls without gaining proxy access. Extension settings show privacy, proxy, and managed-policy limitations. Native loader warnings remain visible; manifests and requested permissions are not stripped.

The extension router now observes each frame host once, rather than adding a new destruction handler for every event subscription. Destroying the host still removes all its subscriptions. Listener limits are unchanged.

## Distribution

`electron-builder.yml` ships unpacked extension files under `resources/extensions` and the tagged uBlock Origin source archive under `resources/sources`. Extension files must remain outside `app.asar`. The extension library and web-store library preloads remain alongside their installed production dependencies. Provenance, the manifest-key addition, license, and source details are in `resources/extensions/NOTICE.md`.

## Checks

Build with `npx electron-vite build`, then run:

```
node scripts/check-extensions.cjs
node scripts/check-extension-warnings.cjs
node scripts/check-extension-proxy.cjs
node scripts/check-proton-extensions.cjs
node scripts/check-preferences.cjs
node scripts/check-settings.cjs
node scripts/check-context-menu.cjs
```

The extension check uses temporary profiles and a local HTTP server, with external DNS blocked. It tests offline default filter loading, real network blocking, cosmetic filtering, ordinary script loading, Do Not Track coexistence, consent migration, UI isolation, button placement, keyboard dismissal, the actual uBlock Origin popup/dashboard, the settings switch, saved custom filters, and restart persistence. It does not install arbitrary third-party extensions from the live Chrome Web Store. Set `REI_EXTENSION_PACKAGE_ROOT` to an unpacked application's root to run the same check against its actual ASAR modules, packaged preloads, and external extension resources.

The check also verifies that store installation approval does not open a native dialog, the removed introduction stays absent, and a legacy recursive managed-storage cache is cleaned up without affecting saved filters. Set `REI_EXTENSION_SEED_PROFILE` to an existing profile directory to test a temporary copy of only its uBlock extension storage; the original profile is never modified. Set `REI_EXTENSION_ONLINE=1` to allow normal DNS resolution during that check.

`node scripts/check-proton-extensions.cjs` additionally checks grouped settings, real installed/disabled icons, header toggles, Proton Pass popup size and sign-in navigation, wildcard permission checks, VPN permission onboarding, running MV3 workers, and actual browser traffic routed through a local proxy from the real Proton extension context. It rejects unchecked runtime errors and listener warnings. It copies installed Proton Pass and Proton VPN package files from `%APPDATA%/rei/Extensions` into a temporary profile; it never copies account state or credentials. Override that package directory with `REI_PROTON_EXTENSIONS`. External DNS is blocked. Signed-in autofill, Proton server connections, and kill-switch behavior are not tested.

`node scripts/check-extension-warnings.cjs` directly compiles the affected Svelte components and rejects accessibility warnings. Its isolated Electron probe repeats host observation 30 times, checks destruction cleanup, preserves native callback/Promise failures, verifies managed/local storage separation and read-only behavior, exercises bridged permissions, and confirms that a privacy-only extension changes the real WebRTC policy without exposing proxy controls. The throwaway runtime instrumentation used to identify Proton's startup calls is not shipped.

The original runtime experiment is in `scripts/prototype-ublock.cjs`. Its verdict was that full uBlock Origin initializes after the MV2 preload timing correction. `src/renderer/src/Extensions.prototype.html` is a separate, throwaway, in-memory lifecycle demo; it does not change the real browser profile.

The proxy check uses synthetic MV2/MV3 extensions and temporary profiles. It verifies actual authenticated HTTP traffic through a local proxy, stopped-worker wake and authentication, PAC routing, callback errors, Promise rejection, change events, priority, disable cleanup, persistence, failed-update rollback, failed-restore reporting, real WebRTC policy application, permission checks, and controller spoofing rejection. It never uses real account state or VPN credentials.
