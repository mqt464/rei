# Bundled extensions

## uBlock Origin 1.75.0

- Author: Raymond Hill and contributors.
- Upstream: https://github.com/gorhill/uBlock
- Release: https://github.com/gorhill/uBlock/releases/tag/1.75.0
- Package: `uBlock0_1.75.0.chromium.zip` from that release.
- Download SHA-256: `393cf95709d1074d4022970e9014e434395c53a822387f1e25f43be97cf4b582`.
- License: GPL-3.0-or-later. Full license and original notices are preserved in `uBlock0.chromium/LICENSE.txt` and the upstream files.
- Corresponding tagged upstream source is included in `sources/uBlock-1.75.0.tar.gz` in Rei's resources directory. Its SHA-256 is `3321b3db44c091a90350da6993fb9ec18f1905b500ccb3ce6981189df048c850`.
- The source archive includes upstream's build scripts and instructions. The bundled extension also retains its human-readable JavaScript and filter assets.
- Rei adds only the `key` manifest field, copied from the public-key proof in the upstream Chromium CRX release. This preserves its upstream sideload ID (`fkgkibajhfbepljeaefdnfnegdcjomkh`) across installation paths and Rei updates. No upstream JavaScript or filter assets are modified.

uBlock Origin is an independent project. Bundling does not imply endorsement by its authors.

## Rei Privacy Headers

Rei's small internal extension adds the optional Do Not Track header using Chrome's request API. It is not shown in the user extension list. Using an extension rather than an Electron request hook allows the header to coexist with uBlock Origin's request blocking.
