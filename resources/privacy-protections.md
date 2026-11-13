# Privacy protections

Settings > Privacy uses Rei's standard setting rows and switches. Fresh profiles
enable consent rejection, tracking-link cleaning, third-party-cookie blocking,
and Global Privacy Control. Existing saved choices remain unchanged.

## Reject optional cookies

Rei runs a pinned Consent-O-Matic engine and consent-platform rules in each HTTP(S)
page's isolated, sandboxed preload, including private tabs and website frames.
All optional consent categories are false. Recognized platforms receive those
choices through their own controls. Unsupported banners remain visible.

Rei excludes utility-only rules, which can dismiss notices without submitting a
choice. It also disables hiding actions and the upstream progress overlay.
Turning the switch off stops scanning and prevents queued actions from proceeding.
Turning it on scans the current document. Rules ship with Rei; there is no remote
rules execution, automatic rule fetch, or consent-statistics service.

This does not revoke consent already stored by a website, prove a website obeys
the submitted choice, or guarantee every consent banner is supported. Reopen a
website's cookie preferences to revise an earlier choice.

Upstream provenance, update instructions, and license are in
`resources/consent-o-matic/README.md`.

## Remove tracking from links

Rei removes known campaign and click identifiers before GET document requests
reach a website. This covers typed addresses, links, redirects, and document
frames, in normal and private tabs. It does not rewrite POST bodies or ordinary
subresource/API requests. uBlock remains responsible for tracker blocking.

The cleaner preserves other query fields, their original encoding and order,
duplicate parameters, and fragments. Known signature-bearing URLs are left
untouched. It does not unwrap arbitrary redirects or remove ambiguous fields
such as `ref`, `token`, or `id`.

Right-clicking a tracked HTTP(S) link offers **Copy clean link**, in both Rei's
and native context menus. This explicit action remains available when automatic
cleaning is off. uBlock's own independent URL filters may still clean some links
when Rei's switch is off.

## Do not sell or share my data

Rei sends `Sec-GPC: 1` and exposes `navigator.globalPrivacyControl` when enabled,
including initial website scripts, frames, private tabs, and subsequent requests.
It is enabled for fresh profiles. An existing saved false choice is preserved.

This is an opt-out signal, not proof that a website complies. It does not delete
broker records or prevent a website from receiving data needed for a visit.
The separate Do Not Track switch remains optional and off by default.

## Block third-party cookies

Rei applies Chromium's native `ForceThirdPartyCookieBlockingEnabled` feature,
with `ThirdPartyStoragePartitioning`, rather than stripping cookie headers.
This restricts unpartitioned cross-site cookie sending, setting, and JavaScript
access. First-party and partitioned cookies (CHIPS) remain available.

Policy is installed before Chromium starts. Rei relaunches before opening any
window when its process arguments do not match the saved preference, preserving
unrelated feature flags and launch URLs. Normal and private tabs receive the
same policy. Development and preview launchers read the saved policy before
starting Electron, keeping the development server alive without a relaunch.
Restart Rei after changing the setting. Existing cookies are not erased; blocking them is
not the same as deleting them. Embedded sign-in and payment widgets may need
the setting disabled and Rei restarted.

No debugger remains attached to website tabs. Website developer tools do not
disable cookie protection. This is not fingerprinting protection or a claim
that websites cannot collect data through other means.

## Checks

After building, run `npm run check:privacy`. The checks use disposable profiles
and local websites. They cover persisted privacy signals, early script and frame
visibility, signal toggles, URL-cleaning edge cases and real navigation, consent
rejection and disabled behavior, unsupported-banner safety, cross-site cookie
headers and JavaScript access, CHIPS, private tabs, switch labels, keyboard focus,
and narrow settings layout.

Set `REI_CAPTURE_PRIVACY=1` when running `node scripts/check-privacy-protections.cjs`
to capture Settings > Privacy in `.cache/privacy-protections/settings.png`.
