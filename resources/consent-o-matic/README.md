# Consent-O-Matic engine

Source: https://github.com/cavi-au/Consent-O-Matic

Pinned commit: `8ca8500d26434c586039e126ad091e1bfccd205d`.

The seven JavaScript modules are unmodified upstream source. `rules.json` combines
the pinned commit's `rules/*.json`, in sorted path order, without `$schema`.
The adjacent TypeScript declarations are Rei integration files. The MIT license
is retained in `LICENSE` and distributed with the application.

Rei bundles the engine into its sandboxed, isolated website preload. It supplies
false for all optional consent categories. It does not run the upstream
extension, contact an update service, collect statistics, or show the upstream
progress overlay. Utility-only rules and banner-hiding actions are disabled: rejection and saving must
run through the consent platform's own controls.

To update, review a new upstream commit, replace the seven modules and license,
and combine every JSON file directly under `rules/` from that same commit.
Run Rei's privacy checks against the new engine and rules before release.
