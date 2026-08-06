# Changelog

All notable changes to Browser Tab Doctor are documented here.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [1.1.4] — 2026-08-06

### Highlights

Report UX polish, reliable Close/Jump, inventory hardening, and clearer multi-window behavior. Ready for store update from 1.1.x / 1.0.x.

### Added

- **Doctor’s note sticky notes** on the report for mid-age (30–89d) and ancient (90+d) tabs — playful, dismissible, no product side effects
- **Extension version** in the report header next to the host browser version
- **Inventory diagnostics** line on the report (`live tabs` vs `open records`, same-URL extras) for multi-window / inventory sanity checks
- Row hover shows `tabId` / key identity (helps confirm two similar rows are two real tabs)
- Clearer summary copy: open total vs stale vs unknown vs recent (not listed)
- Bulk close button labels/tooltips distinguish **closable** listed tabs (skips internal pages)
- Options ⓘ hints for cooldown and related fields; host label style “Running in … · v…”

### Fixed

- **Truncate URLs in report** option now actually controls the live report table (not only snapshots)
- **Close / Jump** resolve by stable record key and re-sync live tab ids (stale tab ids after reload)
- Inventory sync is **live-tab-first**: at most one open record per live browser tab; force-close storage ghosts
- Concurrent tab events no longer race reconcile into doubled open inventory
- Match live tabs by **tabId first**, then URL/title (safer after extension reload)

### Notes for multi-window users

The report lists **all normal windows** in this browser profile. The same page open in two windows appears as two rows with different `tabId`s — Close targets that specific tab (which may be in another window). Hover a row to see its `tabId`.

### Store packages

After `npm run release`:

- `release/browser-tab-doctor-chromium-1.1.4.zip`
- `release/browser-tab-doctor-firefox-1.1.4.zip`

---

## [1.1.0] — prior

R12 proactive notifications, packaging improvements, and earlier report/options UX (see git history for detail).

## [1.0.2] — prior

Firefox `data_collection_permissions` for AMO.

## [1.0.1] — prior

Initial public release.
