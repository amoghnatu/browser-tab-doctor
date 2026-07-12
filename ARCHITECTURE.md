# Architecture decisions — Browser Tab Doctor v1

Documented for later review. These choices implement [Spec.md](./Spec.md) with near-100% adherence while keeping the codebase readable and testable.

## Stack

| Choice | Decision | Rationale |
| --- | --- | --- |
| Language | TypeScript strict (`noUncheckedIndexedAccess`) | Spec mandate; catches null/undefined tab fields early |
| Bundler | Vite 6 multi-entry | Spec allows Vite or esbuild; Vite handles HTML+TS+CSS entries cleanly |
| Polyfill | `webextension-polyfill` | Single `browser.*` codebase for Chromium + Firefox |
| Tests | Vitest | Fast unit + in-memory storage integration; no browser required for R1–R8 logic |
| i18n | `_locales` + `browser.i18n` with English fallbacks | Spec keys; fallbacks keep UI working in bare Vite preview |

## Layout

```
src/
  background/   # MV3 SW / event page only: listeners, reconcile orchestration, messages
  lib/          # Pure or thinly-I/O modules (staleness, reconcile, dates, storage)
  types/        # Shared domain types + storage/alarm constants
  report/       # Full interactive report page
  popup/        # Toolbar summary
  options/      # Config UI (R7)
  shared/       # CSS, i18n helper, messaging client for pages
tests/          # Unit + storage integration (mocked browser.storage)
dist/chromium|firefox/  # Packaged artifacts after `npm run build`
```

**Why separate `lib/` from `background/`:** almost all acceptance logic (staleness, identity match, date keys, pruning, config validation) is pure and unit-tested without mocking the entire WebExtensions surface. Background wires events → lib → storage → badge.

## Storage

- **Single write path:** `src/lib/storage.ts` is the only module that touches `browser.storage`.
- **Keys:** `schema`, `config`, `tab:<uuid>`, `report:<YYYY-MM-DD>` as specified.
- **Session map:** `tabId → key` lives in `storage.session` when available; falls back to a `_session_*` local key and is rebuilt by `reconcile()` on cold start.
- **Config:** written to `local` always; best-effort also to `sync` (Opera has no sync — errors ignored).
- **Quota:** upsert/snapshot catch quota errors, prune snapshots aggressively, retry once.

## Background lifecycle (MV3)

- All listeners registered **synchronously** at module top level.
- **No long-lived in-memory state** beyond a short debounce timer and a `readyPromise` gate.
- `ensureReady()` migrates schema, reconciles if the session map is empty, and re-asserts alarms.
- Every handler is try/catch-wrapped and does not rethrow.
- Alarms: `daily-check` hourly (catch-up when past `reportHour`), `recompute` for badge backstop; both recreated if missing on startup.

## Cross-browser packaging

- **Chromium** `manifest.chromium.json`: `background.service_worker` + `type: "module"`.
- **Firefox** `manifest.firefox.json`: `background.scripts` + gecko id + `strict_min_version` 121.
- Build copies the same JS/HTML/CSS/icons/locales into `dist/chromium` and `dist/firefox` with the matching manifest (spec dual-key pattern split for store validators that object to combined keys).

## UI

- Dark, compact clinical aesthetic (doctor/cleanup metaphor) without external UI libraries — zero network, zero CDN.
- Report / popup / options talk to background via the message contract (`GET_STATE`, `CLOSE_TAB`, etc.).
- Close / Jump / Close-all go through background so tabId resolution stays consistent with tracked records.

## Testing strategy (what validates the build)

| Area | File(s) | Spec coverage |
| --- | --- | --- |
| Date keys / idle math / DST same-day | `tests/date.test.ts` | R3, R8 |
| Staleness + badge text + by-window | `tests/staleness.test.ts` | R2, R4–R6 |
| Reconcile / carry-forward heuristic | `tests/reconcile.test.ts` | R1, R3 |
| Config validation + merge | `tests/config.test.ts` | R7 |
| Daily report gating + prune + snapshot | `tests/snapshot.test.ts` | R8 |
| URL normalize / internal pages | `tests/url.test.ts` | R3, R4 |
| Host browser UA heuristics | `tests/browser-info.test.ts` | R1 |
| Storage + e2e pipeline mock | `tests/storage.integration.test.ts` | R1–R8 plumbing |
| Message type guard | `tests/messaging.test.ts` | Messaging contract |

Manual / store smoke (not automated in v1 CI): load `dist/chromium` unpacked in Chrome, `dist/firefox` via `web-ext run`.

## Bugfix: epoch-zero timestamps (from live sample report)

**Symptom (sample Edge report):** 14 of 82 stale rows showed **First opened / Last used = Dec 31, 1969** and **Idle = 20646d**.

**Cause:** Chromium sometimes reports `tabs.Tab.lastAccessed === 0` for restored or untracked tabs. Code used `tab.lastAccessed ?? now`, but `??` only replaces `null`/`undefined` — **`0` is kept**. Display then formats Unix epoch 0 as local “Dec 31, 1969” (PST/PDT), and staleness floors ~56 years of idle → false stale + inflated badge.

**Fix:** `isValidTimestamp` / `coerceTimestamp` reject `< year 2000` (and non-finite values); reconcile, adopt, onCreated, staleness, and formatters all use them. Reconcile also repairs already-stored zeros.

## Explicit non-goals (v1)

- Safari packaging (spec: deferred).
- Companion app or filesystem reports.
- Host permissions, content scripts, telemetry, remote logging.
- Programmatic `action.openPopup()` (passive nudge only).

## Deviations / notes vs Spec wording

1. **Dual manifest files** instead of one combined `service_worker`+`scripts` artifact: same runtime behavior; easier store validation. Combined dual-key can be reintroduced if preferred.
2. **On-demand snapshot** does not overwrite an existing *scheduled* snapshot for the same `dateKey` (spec: on-demand does not fulfill the daily slot). If only on-demand exists, it may be replaced by later on-demand or by the scheduled run when due.
3. **Unknown last-used list** is included in `GET_STATE` as `unknownTabs` and rendered in a collapsed report section (never auto-flagged).
4. **Icons** are generated programmatically (`scripts/generate-icons.mjs`) — solid brand mark, not store-polished art.
5. **Background is re-bundled** with esbuild into a single file after the Vite multi-entry build so the service worker / event page has no chunk imports.

## How to build & validate

```bash
npm install
npm run icons
npm run ci          # test + build + package validation
# Load dist/chromium in chrome://extensions (Developer mode → Load unpacked)
```
