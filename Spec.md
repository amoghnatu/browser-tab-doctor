# Browser Tab Doctor
## Summary
Browser Tab Doctor is a browser extension that keeps a tab on how many tabs are open in the browser it is installed in, tracks when each tab was last used, and suggests which stale tabs can be closed. Because an extension can only see its own browser, you install it separately in each browser you want to monitor.

## High-level spec

| Req-ID | Requirement | Priority | Details | Implementation status |
| --- | --- | --- | --- | --- |
| R1 | On startup, inventory all tabs open in the browser the extension is installed in | 1 | Enumerates tabs/windows via `tabs.query` on `onInstalled` / `onStartup` and identifies the host browser. See R1 detail. | Complete |
| R2 | Track the number of open tabs in this browser (optionally grouped by window) | 1 | Live counts via the `tabs` API, kept current as tabs open and close. See R2 detail. | Complete |
| R3 | Track when each tab was first opened and last used | 1 | `tabs.onCreated` / `onActivated` timestamps in storage; cross-restart carry-forward is heuristic. See R3 detail. | Complete |
| R4 | Show a concise, readable in-browser report of how many tabs have not been used for > 7 days | 1 | Interactive report page with Close / Jump actions; report history kept in the extension's storage. See R4 detail. | Complete |
| R5 | Surface an in-browser nudge (toolbar badge + report banner) when stale tabs are found | 1 | Toolbar badge shows the stale count; the report page shows a summary banner. See R5 detail. | Complete |
| R6 | Show no nudge when no tabs are older than the configured threshold | 1 | Badge clears to empty and the report shows "all clear" when nothing is stale. See R6 detail. | Complete |
| R7 | Threshold must be configurable and apply immediately, without reloading the extension | 1 | Options page + `storage.onChanged` applies changes instantly; no restart. See R7 detail. | Complete |
| R8 | Generate one report per day, and let the user check current tab health on demand by opening the extension | 1 | Daily snapshot via `chrome.alarms`; on-demand via the toolbar popup / report page. See R8 detail. | Complete |
| R9 | In the report, let the user select specific tabs (checkboxes) and either close only the selected tabs or close all listed stale tabs except the selected | 2 | Adds per-row checkboxes plus "Close selected" and "Close others" buttons beside the existing "Close all stale". See R9 detail. | Complete |
| R10 | Before closing multiple tabs at once (any bulk action), confirm with the user | 2 | Confirmation dialog stating the exact count and action; applies to Close all stale / Close selected / Close others. See R10 detail. | Complete |
| R11 | The report must be filterable by category ("Stale" or "Unknown last-used"), shown in-place; auto-clear the filter when all filtered tabs are closed | 2 | Client-side category filter in the report page (no navigation); an emptied category auto-resets to the unfiltered view. See R11 detail. | Complete |

## Detailed spec

### Design decisions & architecture

Browser Tab Doctor is a single cross-browser WebExtension (Manifest V3); everything — tracking, storage, reporting, and the nudge — runs inside the browser, with a zero-footprint install.

- **Form factor:** one **Manifest V3 WebExtension**, distributed per browser (Chrome Web Store, Edge Add-ons, Firefox AMO; Safari via the App Store is a **later phase**). Each install runs independently; extensions cannot see other browsers or share storage across them.
- **API surface & namespace:** the standard WebExtensions APIs. Code targets the promise-based `browser.*` namespace and ships [`webextension-polyfill`](https://github.com/mozilla/webextension-polyfill) so the same build also runs on Chromium's `chrome.*` namespace. (From Chrome 121, Chromium's async extension APIs also return promises.)
- **Language/build:** TypeScript (strict) compiled and bundled to MV3 with Vite or esbuild. One shared codebase; per-browser `manifest.json` differences are produced at build time.
- **Background model (key cross-browser difference, verified):** Chromium (Chrome/Edge/Opera) runs the MV3 background as an **ephemeral service worker**; Firefox runs it as a **non-persistent event page** and does **not** support `background.service_worker`; Safari supports both. The manifest therefore declares **both** `service_worker` and `scripts` pointing at the same bundle (see Manifest). All background code is stateless and event-driven.
- **Scope:**
  - **Per-browser** — the extension covers the browser it runs in; install it in each browser you want covered.
  - **In-browser nudge** — a toolbar badge plus a report-page banner.
  - **On-demand via the extension** — checks happen by opening the toolbar popup / report page.

### Target browsers & compatibility

The extension is **browser-agnostic in the WebExtensions sense**: one codebase runs on all Chromium browsers and Firefox with only manifest/packaging differences. It is **not** literally drop-in on every browser — Safari needs a packaging step and a few APIs differ, so Safari is **deferred to a later phase** (the initial release targets Chromium browsers and Firefox). Verified support:

| Browser | Supported | Notes (fact-checked) |
| --- | --- | --- |
| Chrome | Yes | Reference target. MV3 background = service worker. |
| Edge | Yes | Chromium; same build as Chrome. |
| Brave / Opera / Vivaldi | Yes | Chromium. **Opera does not support `storage.sync`** → config falls back to `storage.local`. |
| Firefox | Yes | MV3 background = **event page** (`background.scripts`); `storage.sync` needs an add-on ID via `browser_specific_settings`; `runtime.getBrowserInfo()` is available (Firefox-only). Target Firefox **121+** (background page starts even when `service_worker` is also declared). |
| Safari (macOS/iOS) | Deferred (later phase) | WebExtensions are supported, but the extension must be wrapped into an Xcode app project with `xcrun safari-web-extension-packager` and shipped via the App Store. Some keys are flagged unsupported (e.g. `downloads`). Requires a Mac/Xcode (or App Store Connect). |

**Namespaces:** `browser.*` (Firefox, Safari) vs `chrome.*` (Chrome, Edge, Opera) — bridged by `webextension-polyfill`. **Packaging:** Chrome/Edge/Firefox/Opera use a zip with `manifest.json` at the root; Safari uses the Xcode packager. **Publishing:** each store reviews separately and requires a unique version per upload.

### Component overview (all inside the extension)

| Component | Responsibility |
| --- | --- |
| Background (service worker on Chromium / event page on Firefox) | Event-driven; listens to `tabs` events, maintains the tab inventory + timestamps, recomputes staleness, updates the badge, and runs the daily report via `browser.alarms`. Stateless — rebuilds from storage on wake. |
| Storage layer | `browser.storage.local` (plus IndexedDB if report history grows) persists tabs, timestamps, config, and report history. |
| Toolbar action (badge + popup) | The `action` badge shows the current stale-tab count; the popup (`popup.html`) shows a summary and a link to the full report. |
| Report page | `report.html` — interactive, sortable list with per-tab "Close" / "Jump to" actions, plus the nudge banner. |
| Options page | `options.html` — configure threshold, report time, and privacy; applied live via `storage.onChanged`. |
| Alarms | `browser.alarms` schedules the once-per-day report and periodic staleness recomputation. |

### Manifest (MV3)

The build emits a per-browser manifest from one template. Baseline (combined background keys work on Chrome 121+ and Firefox 121+):

```json
{
  "manifest_version": 3,
  "name": "Browser Tab Doctor",
  "version": "1.0.0",
  "minimum_chrome_version": "121",
  "permissions": ["tabs", "storage", "alarms"],
  "background": {
    "service_worker": "background.js",
    "scripts": ["background.js"],
    "type": "module"
  },
  "action": {
    "default_title": "Browser Tab Doctor",
    "default_popup": "popup.html",
    "default_icon": { "16": "icons/16.png", "32": "icons/32.png", "48": "icons/48.png", "128": "icons/128.png" }
  },
  "options_ui": { "page": "options.html", "open_in_tab": false },
  "icons": { "16": "icons/16.png", "32": "icons/32.png", "48": "icons/48.png", "128": "icons/128.png" },
  "browser_specific_settings": { "gecko": { "id": "browser-tab-doctor@example.com", "strict_min_version": "121.0" } }
}
```

- **Permissions rationale (minimal):** `tabs` is required to read the sensitive `url`, `title`, and `favIconUrl` properties shown in the report (counting tabs alone needs no permission); `storage` for all persistence; `alarms` for the daily schedule. **No** host permissions, content scripts, `downloads`, `notifications`, or network permissions are requested. (`action` is a manifest key, not a permission.)
- **Background keys:** Chromium ignores `background.scripts` from Chrome 121; Firefox ignores `background.service_worker`. Declaring both yields one artifact that runs everywhere; the build may also emit `manifest.chromium.json` / `manifest.firefox.json` if a store validator objects.
- MV3 uses `action` (MV2's `browserAction`/`pageAction` are gone).

### Data model

All records live in `browser.storage.local` under versioned keys; `schemaVersion` enables migrations.

- **`TabRecord`**
  - `key` (string) — stable identity (see R3), independent of `tabId`.
  - `tabId` (number) — current, volatile (unique only within a browser session).
  - `windowId` (number), `index` (number)
  - `url` (string), `title` (string), `pinned` (boolean), `discarded` (boolean)
  - `firstOpenedAt` (epoch ms), `lastActiveAt` (epoch ms), `lastSeenAt` (epoch ms)
  - `isOpen` (boolean)
- **`ReportSnapshot`**
  - `dateKey` (`YYYY-MM-DD`, local), `generatedAt` (epoch ms)
  - `totalTabs` (number), `staleTabs` (number)
  - `items` (array of frozen `{ title, url, firstOpenedAt, lastActiveAt, idleDays }`)
  - `trigger` (`"scheduled"` | `"on-demand"`)
- **`Config`**
  - `schemaVersion` (number)
  - `thresholdDays` (number, default 7, min 1)
  - `reportHour` (0–23, local, default 9)
  - `retentionSnapshots` (number, default 90)
  - `badgeEnabled` (boolean, default true)
  - `recomputeIntervalMinutes` (number, default 30; must be ≥ 0.5 — see constraints)
  - `privacy`: `{ truncateUrls: boolean, storeQueryStrings: boolean }`

### Platform constraints & verified facts

Every figure below was verified against official docs (see References; last verified 2026-07-11). Build to these limits.

| Area | Verified fact | Design implication |
| --- | --- | --- |
| `storage.local` quota | Chrome: **10 MB** (`QUOTA_BYTES = 10485760`; 5 MB on Chrome ≤113), raised by `unlimitedStorage`. Firefox: IndexedDB-style origin quota; `unlimitedStorage` for more. | Cap report history (default 90 snapshots) and prune; move history to IndexedDB if it grows. |
| `storage.sync` quota | **100 KB** total (`QUOTA_BYTES = 102400`), **8 KB/item** (`QUOTA_BYTES_PER_ITEM = 8192`), **512 items**, **1800 writes/hour**, **120 writes/min**. Not supported on Opera; needs an add-on ID on Firefox. | Only the tiny `Config` may use `sync`; default to `local`. Never put tab/report data in `sync`. |
| MV3 service-worker lifecycle (Chromium) | Terminated after **30 s** of inactivity; a single task > 5 min or a `fetch()` > 30 s also terminates it; **global variables are lost**. `runtime.onStartup` fires at profile start; `runtime.onInstalled` on install/update. | Persist after every event; rebuild from storage on wake; never hold state in memory; recreate alarms on startup. |
| Firefox background | MV3 supports only **non-persistent event pages**; `background.service_worker` is unsupported. Event pages unload after a few seconds idle. | Use the dual `background` keys; same stateless discipline. |
| `alarms` minimum period | Chrome enforces a minimum of **30 s** (`periodInMinutes`/`delayInMinutes` < 0.5 warns; the floor was 1 min before Chrome 120). Max **500** active alarms (Chrome 117+); alarm names < 1024 bytes (Chrome 150+). | `recomputeIntervalMinutes` ≥ 0.5; use one daily alarm + one periodic recompute alarm. |
| `alarms` persistence & sleep | `persistAcrossSessions` exists only on **Chrome 150+** (not other browsers); alarms fire during sleep only after wake and never wake the device; a missed repeating alarm fires at most once on wake. | Re-assert alarms on every background startup (`alarms.get` → create if missing); treat the daily run as catch-up-on-wake. |
| `action` badge | Text + background color; only **~4 characters** fit; empty string clears it. `setBadgeTextColor` is Chrome 110+. `action.openPopup()` is Chrome 127+ (policy-only 118–126). | Badge shows the count or `99+`; the nudge stays passive — never programmatically open the popup. |
| `tabs` timestamps | `tabs.Tab.lastAccessed` (last time the tab became active, epoch ms) exists on **Chrome 121+** and Firefox. `Tab.id` is unique only within a browser session (not stable across restarts). | Bootstrap `lastActiveAt` from `lastAccessed` where present; otherwise track `onActivated`. Never persist identity by `tabId` (see R3). |
| Incognito / private | Extensions do **not** run in private windows unless the user opts in; the `incognito` manifest key is `spanning` (default) / `split` / `not_allowed` (Firefox lacks `split`). | Default behavior excludes private windows; no special handling required. |
| Browser identification | `runtime.getBrowserInfo()` is **Firefox-only**. | On Chromium, derive the label from `navigator.userAgentData` / UA; feature-detect `getBrowserInfo`. |

---

### R1 — Initialize the browsing context at startup

**Intent:** On install/startup, build a complete inventory of the current browser's tabs. (An extension only sees its own browser.)

**Behavior & approach:**
- On `runtime.onInstalled` and `runtime.onStartup`, query `tabs.query({})` and `windows.getAll()` to enumerate all normal windows/tabs in this browser.
- Identify the host browser for labeling the report (`runtime.getBrowserInfo()` on Firefox; UA/heuristics on Chromium).
- Reconcile the live tab set with persisted `TabRecord`s, carrying forward timestamps (see R3).

**Edge cases:** private/incognito windows excluded unless the user opts in (off by default); browser-internal pages (`chrome://`, `about:`) are inventoried but flagged non-closable where the API forbids it; very large tab counts.

**Acceptance criteria:**
- After startup the extension holds a complete inventory of this browser's normal tabs.
- The host browser is identified and used to label the report.
- Each install covers only its own browser; install the extension in each browser you want monitored.

---

### R2 — Count open tabs (grouped within this browser)

**Intent:** Track how many tabs are open, grouped for this browser (optionally by window/profile).

**Behavior & approach:**
- Maintain the live tab set from `tabs.onCreated` / `onRemoved` / `onUpdated` / `onAttached` / `onDetached`, with periodic `tabs.query` reconciliation.
- Grouping is by *this* browser, with an optional breakdown by window (and inherently by profile, since each profile runs its own extension instance and storage).
- Counts include pinned and discarded/sleeping tabs; private windows are excluded by default.

**Edge cases:** discarded tabs still count as open; tabs moved between windows; duplicate URLs; rapid open/close bursts (debounced recompute).

**Acceptance criteria:**
- Accurate live open-tab count for this browser, updating immediately on open/close.
- An optional per-window breakdown is available.

---

### R3 — Track when a tab was first opened and last used

**Intent:** Maintain a `firstOpenedAt` and `lastActiveAt` per tab.

**Behavior & approach:**
- `tabs.onCreated` sets `firstOpenedAt`; `tabs.onActivated` and meaningful `tabs.onUpdated` (e.g. load complete, URL change) refresh `lastActiveAt`; `tabs.onRemoved` marks the tab closed. "Last used" = last activation, the best available proxy.
- **Native bootstrap:** where available (**Chrome 121+**, Firefox), seed `lastActiveAt` from `tabs.Tab.lastAccessed` (a native last-active timestamp) on startup and for tabs that existed before install; otherwise rely on activation events.
- Persist to storage on every event, because the background (service worker on Chromium, event page on Firefox) can be terminated at any time.
- **Stable identity:** `tabId` is **not** stable across browser restarts. On `onStartup`, reconcile restored tabs to prior records via a heuristic key (windowId/index + url + title) and carry forward `firstOpenedAt`; unmatched tabs are treated as first-seen at startup. Where available, the `sessions` API improves matching. This carry-forward is a documented approximation inherent to extensions.

**Edge cases:** session restore (heuristic carry-forward); system clock changes; SPA URL changes within one tab (keep `firstOpenedAt`, update `lastActiveAt`); tabs never activated since first seen (`lastActiveAt` = first-seen time).

**Acceptance criteria:**
- For tabs opened while the extension runs, timestamps are exact.
- Across restarts, timestamps are best-effort carried forward.
- Values persist in storage and are queryable per tab.

---

### R4 — In-browser report of tabs idle > threshold (default 7 days)

**Intent:** Show, inside the browser, how many tabs have not been used for longer than the threshold, and let the user act on them.

**Behavior & approach:**
- Staleness: `idleDays = now - lastActiveAt`; a tab is **stale** when `idleDays >= thresholdDays` (config, default 7).
- The **report page** (`report.html`) renders:
  - a summary/banner (total tabs, stale count, threshold);
  - an interactive table sorted by idle time descending — title, optionally trimmed URL, `firstOpenedAt`, `lastActiveAt`, idle days — with a **Close** button (`tabs.remove`) and **Jump to tab** (`tabs.update({active:true})` + `windows.update`);
  - a **Close all stale** bulk action with confirmation.
- Each day's results are also frozen into a `ReportSnapshot` in the extension's storage for history (R8) — nothing is written to the machine's filesystem.

**Edge cases:** no stale tabs gives an "all clear" view; tabs with unknown `lastActiveAt` are listed separately and never auto-flagged; non-closable internal pages have the Close button disabled.

**Acceptance criteria:**
- The report lists exactly the tabs whose idle time meets/exceeds the threshold; counts are correct.
- Close / Jump / Close-all actions operate on real tabs.
- Everything renders in-browser and is stored only in the extension's storage — no external file, no companion app.

---

### R5 — In-browser nudge (toolbar badge + report banner)

**Intent:** Tell the user, inside the browser, that stale tabs exist.

**Behavior & approach:**
- **Toolbar badge:** `action.setBadgeText` shows the stale-tab count with an emphasis color and a tooltip ("N tabs idle > X days"); refreshed whenever staleness recomputes.
- **Report-page banner:** opening the report shows a top banner summarizing the situation ("You have N tabs not used in over X days — see below for how many you can close"). Exact wording TBD.
- Clicking the toolbar icon opens the popup / report.

**Edge cases:** the badge fits only ~4 characters (verified), so counts over 99 render as `99+`; the badge clears to empty at zero (see R6); the extension never calls `action.openPopup()` (limited availability, Chrome 127+), so the nudge stays passive; opening the report when nothing is stale shows the "all clear" banner.

**Acceptance criteria:**
- The badge reflects the current stale count and updates live.
- Opening the action shows the nudge banner above the report.

---

### R6 — Suppress the nudge when nothing is stale

**Intent:** Don't nag when there is nothing actionable.

**Behavior & approach:**
- When `staleCount == 0`: clear the badge text (empty) and show an "all clear" banner instead of a nudge.
- Rule: show the badge/banner nudge **iff** `staleCount > 0` (and `badgeEnabled`).
- Tabs with unknown `lastActiveAt` are not counted as stale and therefore never, on their own, trigger the nudge.

**Acceptance criteria:**
- Zero stale tabs gives an empty badge and an "all clear" banner.
- One or more stale tabs gives a badge count and the nudge banner.

---

### R7 — Configurable threshold, applied without restart

**Intent:** Let the user change the threshold (and related settings) with the change taking effect immediately.

**Behavior & approach:**
- The options page writes config to `browser.storage` — `sync` for cross-device where supported (note: **Opera has no `storage.sync`**, and Firefox requires an add-on ID), otherwise `local`. Tab and report data never use `sync` (its 100 KB total / 8 KB-per-item quota is too small).
- The background worker subscribes to `storage.onChanged` and applies new values immediately — recomputing staleness and refreshing the badge on the spot. No reload or restart (inherent to the MV3 model).
- Validation in the options UI: `thresholdDays >= 1`, sane bounds; invalid input is rejected before saving.

**Edge cases:** `storage.sync` conflicts across devices (last-write-wins); out-of-range values; storage quota.

**Acceptance criteria:**
- Changing `thresholdDays` in options instantly updates staleness and the badge with no restart.
- Invalid values are rejected at the UI.

---

### R8 — One report per day, plus on-demand checks

**Intent:** Produce one report per day and let the user check current health anytime by opening the extension.

**Behavior & approach:**
- **Daily:** a `browser.alarms` alarm near `reportHour` (default `09:00` local) generates and freezes the day's `ReportSnapshot`; idempotent per `dateKey` (skipped if today's snapshot already exists). The recompute alarm period respects the verified **30 s minimum**.
- **Alarm resilience:** on every background startup, `alarms.get` the daily and recompute alarms and recreate any that are missing — `persistAcrossSessions` exists only on Chrome 150+, and other browsers clear alarms on restart.
- **Catch-up:** because alarms only fire while the browser runs, on `onStartup` (and the first wake each day) the extension generates today's snapshot if it is missing and past `reportHour`. If the browser stays closed all day, that day is skipped.
- **On-demand:** clicking the toolbar icon or opening `report.html` always shows *live* current health (with a Refresh action), independent of the daily snapshot — so "ask any time" is simply opening the extension.

**Edge cases:** browser closed at `reportHour` (catch-up on next launch); multiple windows share one per-profile storage, so there is one snapshot per day per profile; timezone/DST handling for "per day".

**Acceptance criteria:**
- At most one scheduled snapshot per calendar day per profile.
- Live health is viewable at any time by opening the extension.
- A missed day is recovered on the next launch when possible.

---

### R9 — Select tabs, then close selected or close others

**Intent:** In the report, let the user pick exactly which stale tabs to close via checkboxes, then either close only the selected tabs or close every listed stale tab *except* the selected ones. (Extends the report toolbar defined in R4; the existing "Close all stale" button stays.)

**Behavior & approach:**
- The report's stale-tab table gains a leading **checkbox column**, plus a header **select-all** checkbox that toggles all closable rows currently shown.
- Selection is per-row UI state held in the report page (not persisted); it resets on **Refresh** and whenever the underlying list changes.
- The report toolbar gains two buttons beside **Close all stale (N)** (where **N** = number of displayed stale tabs, **K** = number selected):
  - **Close selected (K)** — closes only the K checked tabs; disabled when K = 0.
  - **Close others (N−K)** — closes the listed stale tabs that are *not* checked ("others" = the unselected stale tabs); disabled when the target set is empty (K = N, or N = 0).
- **Scope:** all three bulk buttons act on the **currently displayed closable rows** (after the category filter). That includes **both** real stale tabs and **Unknown last-used** tabs when those rows are shown. R6 only means unknowns are not auto-flagged on the **toolbar badge** — they remain closable and bulk-selectable.
- Actions resolve selected **keys → current `tabId`s** at click time (re-resolving avoids acting on a stale `tabId`), then go through the **R10 confirmation** before closing via a bulk-close message:
  - `{ type: "CLOSE_TABS"; tabIds: number[] } -> { closed: number }` — a generalization of the existing single/`CLOSE_ALL_STALE` close to an arbitrary set.
- Non-closable rows (browser-internal pages) render a **disabled** checkbox and are excluded from select-all, "Close selected", and "Close others".

**Edge cases:** a selected tab was closed or navigated since load → re-resolve by `key`, silently skip anything already gone, and report the real closed count; select-all selects only closable rows; when the list is empty all bulk buttons are disabled.

**Acceptance criteria:**
- Each closable stale row has a checkbox, and a header select-all toggles them.
- **Close selected** closes exactly the checked tabs and leaves the rest open.
- **Close others** closes exactly the unchecked closable stale tabs and leaves the checked ones (and the unknown-last-used tabs) open.
- Each button disables when its target set is empty; all three bulk actions route through the R10 confirmation.

---

### R10 — Confirm before closing multiple tabs

**Intent:** Any action that would close more than one tab must ask the user to confirm first, to prevent accidental mass-closing.

**Behavior & approach:**
- A confirmation step precedes **every bulk close** — **Close all stale**, **Close selected**, and **Close others** (R9), plus any future multi-close action.
- **Trigger rule:** confirm when the action would close **2 or more** tabs. The single per-row **Close** (one tab) does **not** prompt.
- The dialog states the **exact count** and the specific action, e.g. *"Close 12 tabs? This closes the 12 stale tabs you did not select."*, with **Cancel** (default focus) and a primary **Close N** button. The count is computed at confirm time from the current selection/list.
- Closing proceeds **only** on explicit confirmation; **Cancel** makes no changes.
- Implemented as an in-page, accessible modal (`role="alertdialog"`, focus-trapped, **Esc** = cancel, **Enter** = confirm the primary). `window.confirm()` in the report page is an acceptable fallback.

**Edge cases:** if some target tabs are already gone by the time the user confirms, the extension closes what remains and reports the actual number; closing exactly one tab bypasses the dialog; only one confirmation dialog is shown at a time (re-triggering is guarded).

**Acceptance criteria:**
- Every bulk close (2+ tabs) shows a confirmation with an accurate count and the specific action; tabs close only after the user confirms.
- **Cancel** results in no changes.
- Single-tab close does not prompt.
- The dialog is keyboard-accessible (focus trap, Esc cancels, Enter confirms).

---

### R11 — Filter the report by category (in-place)

**Intent:** Let the user narrow the report to a single category — **Stale** or **Unknown last-used** — with results shown in place on the same page, and automatically clear the filter when the viewed category empties. (Extends the report page defined in R4; works alongside the R9 selection/bulk actions.)

**Behavior & approach:**
- The report toolbar gains a **category filter** with three states: **All** (default — both categories shown), **Stale (N)**, and **Unknown last-used (U)** (counts shown).
- Filtering is **client-side and in-place**: selecting a category re-renders the visible rows from the already-loaded state in the same page — no navigation and no new tab.
- Sort (R4) applies within the filtered view; **selection (R9) resets when the filter changes** so bulk actions never act on hidden rows.
- **Bulk-action interaction:** the R9 bulk buttons (**Close all listed / Close selected / Close others**) apply to **visible closable rows** in every filter view (All, Stale, Unknown). Under **Unknown last-used**, bulk close targets those unknown rows. R6 badge non-flagging is unchanged. Per-row **Close** / **Jump** remain available in every view.
- **Auto-clear on empty:** after any close (bulk or per-row) or a **Refresh**, if the currently filtered category has **no** remaining tabs, the filter auto-resets to **All** and re-renders so the remaining tabs (the other category) appear immediately. If nothing remains at all, the empty state shows.
- The active filter is session UI state (not persisted) and resets to **All** on reload.

**Edge cases:** switching filters clears the current selection; a Refresh that empties the active category triggers the same auto-clear; the filter control's counts update after every recompute; filtering is view-only and never changes stored data.

**Acceptance criteria:**
- The report offers **Stale** and **Unknown last-used** filters (plus an **All** view); choosing one shows only that category's rows in the same page — no new tab or navigation.
- Under the **Unknown last-used** filter, bulk buttons target the unknown rows; per-row actions still work.
- When the viewed category's tabs are all closed, the filter auto-clears and the remaining tabs render immediately.
- Filter, sort, and selection are client-side and reset on reload.

---

### Algorithms (pseudocode)

Pseudocode is TypeScript-flavored and uses the promise-based `browser.*` namespace. `now()` returns epoch ms. All handlers are registered synchronously at the top level of the background script and each persists its result before returning (the background may be killed at any time).

#### Storage keys & the volatile tab map

```text
storage.local:
  "schema"            -> { schemaVersion: number }
  "config"            -> Config
  "tab:<key>"         -> TabRecord            (key = UUID, stable across restarts)
  "report:<dateKey>"  -> ReportSnapshot       (dateKey = local YYYY-MM-DD)

storage.session (in-memory, cleared on browser restart — matches tabId lifetime):
  "tabIdToKey"        -> { [tabId: number]: key }
```

`tabId` is unique only within a browser session, so the `tabId → key` map lives in `storage.session`. Feature-detect it; if unavailable (older Firefox), rebuild the map by calling `reconcile()` on every cold start.

#### URL normalization

```ts
function normalizeUrl(rawUrl: string, cfg: Config): string {
  const u = new URL(rawUrl);
  if (!cfg.privacy.storeQueryStrings) { u.search = ""; u.hash = ""; }
  return u.toString();
}
// Used for both matching (reconcile) and storage. Truncation for display is separate (buildSnapshot).
```

#### Startup reconciliation (R1, R3)

Runs on `runtime.onStartup`, on cold background wake (when the session map is missing), and after `runtime.onInstalled`.

```ts
async function reconcile(): Promise<void> {
  const cfg = await getConfig();
  const liveTabs = await browser.tabs.query({ windowType: "normal" });
  const openRecords = (await getAllTabRecords()).filter(r => r.isOpen);
  const used = new Set<string>();      // keys already matched
  const tabIdToKey: Record<number, string> = {};

  for (const tab of liveTabs) {
    if (isExcluded(tab)) continue;     // internal pages optional; private handled by manifest
    const match = findBestMatch(tab, openRecords, used, cfg);   // see below
    let record: TabRecord;
    if (match) {
      record = match;
      record.tabId = tab.id!;
      record.windowId = tab.windowId!;
      record.index = tab.index;
      record.url = normalizeUrl(tab.url ?? "", cfg);
      record.title = tab.title ?? record.title;
      record.pinned = !!tab.pinned;
      record.discarded = !!tab.discarded;
      if (tab.lastAccessed) record.lastActiveAt = Math.max(record.lastActiveAt ?? 0, tab.lastAccessed);
      record.lastSeenAt = now();
      record.isOpen = true;
    } else {
      const seed = tab.lastAccessed ?? now();     // native bootstrap where available
      record = newRecord(crypto.randomUUID(), tab, /*firstOpenedAt*/ seed, /*lastActiveAt*/ seed, cfg);
    }
    used.add(record.key);
    tabIdToKey[tab.id!] = record.key;
    await upsertTabRecord(record);
  }

  // records that were open but are no longer present => closed while the browser was off
  for (const r of openRecords) {
    if (!used.has(r.key)) { r.isOpen = false; r.lastSeenAt = now(); await upsertTabRecord(r); }
  }

  await setSessionMap(tabIdToKey);
  await recomputeAndRefreshBadge();
}

// Heuristic identity match (tabId is not stable across restarts):
function findBestMatch(tab, openRecords, used, cfg) {
  const url = normalizeUrl(tab.url ?? "", cfg);
  const candidates = openRecords.filter(r => !used.has(r.key) && r.url === url);
  if (candidates.length === 0) {
    // fall back to title-only match (e.g. URL changed slightly)
    const byTitle = openRecords.filter(r => !used.has(r.key) && r.title === tab.title);
    return byTitle.sort((a, b) => Math.abs(a.index - tab.index) - Math.abs(b.index - tab.index))[0] ?? null;
  }
  // prefer the candidate whose stored index is closest to the live index
  return candidates.sort((a, b) => Math.abs(a.index - tab.index) - Math.abs(b.index - tab.index))[0];
}
```

#### Tab event handlers (R2, R3)

`ensureReady()` guarantees the session map exists (lazily runs `reconcile()` after a cold wake). `scheduleRecompute()` coalesces bursts with a short debounce (~750 ms) while the background is alive; the periodic recompute alarm is the backstop.

```ts
browser.tabs.onCreated.addListener(async (tab) => {
  await ensureReady();
  const key = crypto.randomUUID();
  const seed = tab.active ? now() : (tab.lastAccessed ?? now());
  await upsertTabRecord(newRecord(key, tab, /*firstOpenedAt*/ now(), /*lastActiveAt*/ seed, await getConfig()));
  await mapSet(tab.id!, key);
  scheduleRecompute();
});

browser.tabs.onActivated.addListener(async ({ tabId }) => {
  await ensureReady();
  const rec = await recordFor(tabId); if (!rec) return;
  rec.lastActiveAt = now(); rec.lastSeenAt = now();
  await upsertTabRecord(rec);
  scheduleRecompute();
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  await ensureReady();
  const rec = await recordFor(tabId) ?? await adoptTab(tab);   // adopt if we missed onCreated
  const cfg = await getConfig();
  if (changeInfo.url) rec.url = normalizeUrl(changeInfo.url, cfg);
  if (changeInfo.title) rec.title = changeInfo.title;
  if ("discarded" in changeInfo) rec.discarded = !!changeInfo.discarded;
  if ("pinned" in changeInfo) rec.pinned = !!changeInfo.pinned;
  if (tab.active && changeInfo.status === "complete") rec.lastActiveAt = now();
  rec.lastSeenAt = now();
  await upsertTabRecord(rec);
  scheduleRecompute();
});

browser.tabs.onRemoved.addListener(async (tabId) => {
  await ensureReady();
  const rec = await recordFor(tabId);
  if (rec) { rec.isOpen = false; rec.lastSeenAt = now(); await upsertTabRecord(rec); }
  await mapDelete(tabId);
  scheduleRecompute();
});

// onAttached / onDetached: update windowId + index via browser.tabs.get(tabId), then upsert.
```

#### Staleness & badge (R4, R5, R6)

```ts
interface Staleness { stale: StaleItem[]; unknownCount: number; totalOpen: number; staleCount: number; }

async function computeStaleness(cfg: Config): Promise<Staleness> {
  const t = now();
  const open = (await getAllTabRecords()).filter(r => r.isOpen);
  const stale: StaleItem[] = [];
  let unknownCount = 0;
  for (const r of open) {
    if (r.lastActiveAt == null) { unknownCount++; continue; }   // never auto-flag unknowns (R6)
    const idleDays = Math.floor((t - r.lastActiveAt) / 86_400_000);
    if (idleDays >= cfg.thresholdDays) stale.push({ ...r, idleDays });
  }
  stale.sort((a, b) => b.idleDays - a.idleDays);
  return { stale, unknownCount, totalOpen: open.length, staleCount: stale.length };
}

async function recomputeAndRefreshBadge(): Promise<void> {
  const cfg = await getConfig();
  const { staleCount } = await computeStaleness(cfg);
  if (!cfg.badgeEnabled || staleCount === 0) {
    await browser.action.setBadgeText({ text: "" });                    // R6: clear at zero
  } else {
    await browser.action.setBadgeText({ text: staleCount > 99 ? "99+" : String(staleCount) });  // ~4-char limit
    await browser.action.setBadgeBackgroundColor({ color: "#C0392B" });
    await browser.action.setTitle({ title: `${staleCount} tab(s) idle > ${cfg.thresholdDays} days` });
  }
}
```

#### Scheduling & daily report (R8)

An hourly alarm makes the daily run resilient to sleep/DST; a separate recompute alarm is the badge backstop. Both are re-asserted on every startup because `persistAcrossSessions` is Chrome 150+ only.

```ts
const DAILY_ALARM = "daily-check";       // fires hourly; generates the report when due
const RECOMPUTE_ALARM = "recompute";     // periodic badge refresh backstop

async function ensureAlarms(): Promise<void> {
  const cfg = await getConfig();
  if (!(await browser.alarms.get(DAILY_ALARM)))
    await browser.alarms.create(DAILY_ALARM, { periodInMinutes: 60 });
  if (!(await browser.alarms.get(RECOMPUTE_ALARM)))
    await browser.alarms.create(RECOMPUTE_ALARM, { periodInMinutes: Math.max(0.5, cfg.recomputeIntervalMinutes) });
}

browser.alarms.onAlarm.addListener(async (alarm) => {
  await ensureReady();
  if (alarm.name === RECOMPUTE_ALARM) return recomputeAndRefreshBadge();
  if (alarm.name === DAILY_ALARM) return maybeGenerateDailyReport();
});

async function maybeGenerateDailyReport(): Promise<void> {
  const cfg = await getConfig();
  const today = localDateKey(now());                       // local calendar day
  if (await getSnapshot(today)) return;                    // idempotent per day
  if (localHour(now()) < cfg.reportHour) return;           // not yet time today
  await putSnapshot(await buildSnapshot("scheduled", cfg));
  await pruneSnapshots(cfg.retentionSnapshots);
  await recomputeAndRefreshBadge();
}

// On onStartup and onInstalled: await reconcile(); await ensureAlarms(); await maybeGenerateDailyReport();

async function buildSnapshot(trigger: "scheduled" | "on-demand", cfg: Config): Promise<ReportSnapshot> {
  const { stale, totalOpen } = await computeStaleness(cfg);
  const items = stale.map(r => ({
    title: r.title,
    url: cfg.privacy.truncateUrls ? truncateForDisplay(r.url) : r.url,
    firstOpenedAt: r.firstOpenedAt, lastActiveAt: r.lastActiveAt, idleDays: r.idleDays,
  }));
  return { dateKey: localDateKey(now()), generatedAt: now(), totalTabs: totalOpen, staleTabs: stale.length, items, trigger };
}

async function pruneSnapshots(keep: number): Promise<void> {
  const keys = (await listSnapshotKeys()).sort().reverse();  // report:<dateKey>, newest first
  for (const k of keys.slice(keep)) await browser.storage.local.remove(k);
}
```

**Date handling:** `localDateKey`/`localHour` use the local timezone via `Date` methods, so "one report per day" means one per local calendar day. DST transition days still map to a single `dateKey`; no UTC conversion is used for the day boundary.

### Storage layer (API)

A thin typed module (`src/lib/storage.ts`) is the only code that touches `browser.storage`. It validates on read and runs `schemaVersion` migrations.

```ts
getConfig(): Promise<Config>                       // returns defaults merged with stored values
setConfig(patch: Partial<Config>): Promise<void>   // validates, writes, triggers storage.onChanged
getAllTabRecords(): Promise<TabRecord[]>
getTabRecord(key: string): Promise<TabRecord | undefined>
upsertTabRecord(r: TabRecord): Promise<void>
deleteTabRecord(key: string): Promise<void>
getSnapshot(dateKey: string): Promise<ReportSnapshot | undefined>
putSnapshot(s: ReportSnapshot): Promise<void>
listSnapshotKeys(): Promise<string[]>
// session map:
getSessionMap(): Promise<Record<number,string>>; setSessionMap(m): Promise<void>
mapGet/mapSet/mapDelete(tabId, key?)
migrateIfNeeded(): Promise<void>                   // run on onInstalled(reason==="update")
```

Config defaults: `{ schemaVersion: 1, thresholdDays: 7, reportHour: 9, retentionSnapshots: 90, badgeEnabled: true, recomputeIntervalMinutes: 30, privacy: { truncateUrls: false, storeQueryStrings: true } }`.

### Messaging contract

Extension pages (`report`/`popup`/`options`) have direct access to `browser.*`, so they read storage and call `tabs.remove`/`tabs.update` themselves. A small message API keeps the background as the single source of truth for *computation*; UI actions on tabs can be done directly or via messages.

```ts
type Msg =
  | { type: "GET_STATE" }                              // -> { config, staleness, hostBrowser, lastSnapshot }
  | { type: "REFRESH" }                                // recompute + return state
  | { type: "CLOSE_TAB"; tabId: number }               // -> { ok }
  | { type: "CLOSE_ALL_STALE" }                         // closes current stale tabIds -> { closed: number }
  | { type: "JUMP_TO_TAB"; tabId: number }             // tabs.update({active:true}) + windows.update(focused)
  | { type: "GENERATE_REPORT_NOW" };                   // buildSnapshot("on-demand"); does NOT fulfill the daily slot
```

Handled in the background via `browser.runtime.onMessage` (return a Promise). Actions resolve `key → tabId` through the current records so a stale UID never closes the wrong tab.

### UI layouts

All three pages are static HTML + the bundled TS, keyboard-navigable, with ARIA labels; strings come from `_locales`.

#### `report.html` (R4/R5)

```text
┌───────────────────────────────────────────────────────────────────────────┐
│ Browser Tab Doctor — <HostBrowser>            threshold: 7 days   [Refresh] │
├───────────────────────────────────────────────────────────────────────────┤
│ [ Banner ]                                                                  │
│   staleCount > 0 → "You have N tabs not used in over 7 days — close the     │
│                     ones you don't need."                (accent background)│
│   staleCount = 0 → "All clear — no tabs are older than 7 days."   (neutral) │
├───────────────────────────────────────────────────────────────────────────┤
│ Summary:  Open tabs: M   |   Stale: N   |   Unknown last-used: U            │
│ Toolbar:  Sort [Idle ▼]        [ Close all stale (N) ]                      │
├───────────────────────────────────────────────────────────────────────────┤
│ Title                     │ URL (trimmed)     │ First opened │ Last used │ Idle │ Actions        │
│ Docs: WebExtensions       │ developer.mozil… │ 2026-05-02   │ 2026-06-30│  11d │ [Close] [Jump] │
│ …                                                                                              │
├───────────────────────────────────────────────────────────────────────────┤
│ ▸ Unknown last-used (U)   — collapsed; listed, never auto-flagged                              │
└───────────────────────────────────────────────────────────────────────────┘
Empty state (M=0): "No open tabs to analyze."
```

- Default sort: **Idle days descending**. Columns sortable by click. `Last used`/`First opened` render as localized dates with an absolute timestamp on hover.
- **Close** → `CLOSE_TAB` (row removed on success); **Jump** → `JUMP_TO_TAB`; **Close all stale** → confirm dialog → `CLOSE_ALL_STALE`.
- Rows for browser-internal pages show a disabled **Close** with a tooltip.
- **Refresh** re-runs `GET_STATE` (live), independent of the daily snapshot.

#### `popup.html`

```text
┌─────────────────────────────┐
│ Browser Tab Doctor          │
│ N stale of M open tabs      │
│ ─ Top stale ───────────────│
│  • Title …            11d   │
│  • Title …             9d   │
│  • Title …             8d   │
│ [ Open full report ]        │
│ [ Options ]                 │
└─────────────────────────────┘
```

- Reads `GET_STATE`; shows up to 3 most-stale tabs; "Open full report" opens `report.html` in a tab; when `staleCount = 0`, shows "All clear".

#### `options.html` (R7)

```text
Threshold (days)            [  7 ]      (integer ≥ 1)
Daily report time (hour)    [  9 ]      (0–23, local)
Show toolbar badge          [x]
History to keep (days)      [ 90 ]      (integer ≥ 1)
Truncate URLs in report     [ ]
Store query strings         [x]
                           [ Save ]
```

- On **Save**, validate, then `setConfig`. The background reacts via `storage.onChanged` (recompute + badge + re-arm the recompute alarm) — no restart (R7).

### Error handling & logging

- Every event/alarm handler wraps its body in try/catch and never rethrows (an unhandled rejection would drop the event).
- Storage writes catch quota errors (`QUOTA_BYTES` exceeded): on failure, prune snapshots more aggressively, then retry once; if still failing, keep the newest data and log.
- A `debug` flag (in `Config`, default off) gates verbose `console` logging; there is no remote logging.
- Feature detection guards optional APIs (`storage.session`, `tabs.Tab.lastAccessed`, `runtime.getBrowserInfo`, `alarms.persistAcrossSessions`) with defined fallbacks.

### Internationalization (`_locales`)

User-facing strings live in `_locales/en/messages.json` and are read via `browser.i18n.getMessage`. Initial keys: `appName`, `bannerStale` (placeholder `$COUNT$`, `$DAYS$`), `bannerAllClear`, `summary`, `colTitle`, `colUrl`, `colFirstOpened`, `colLastUsed`, `colIdle`, `actionClose`, `actionJump`, `closeAllStale`, `unknownSection`, `optThreshold`, `optReportHour`, `optBadge`, `optRetention`, `optTruncateUrls`, `optStoreQuery`, `save`.

---

### Cross-cutting concerns

- **Persistence:** all state — tab records, timestamps, config, and daily report history — lives in the extension's own storage (`browser.storage.local`, or IndexedDB for larger history). The browser keeps this inside its profile directory; the extension never writes to the machine's filesystem and there is no companion app.
- **Retention:** report history is capped (default: keep the last `retentionSnapshots` = 90 daily snapshots) and older snapshots are pruned to respect the 10 MB `storage.local` quota; add the `unlimitedStorage` permission only if longer history is required.
- **Privacy:** fully local; no network calls and no analytics/telemetry; URL/query-string truncation is configurable (`privacy.truncateUrls`, `privacy.storeQueryStrings`).
- **Permissions:** `tabs`, `storage`, `alarms` (`action` is a manifest key, not a permission). No host permissions, content scripts, `downloads`, `notifications`, or network access. Private/incognito access is off by default.
- **Performance:** tab handling is incremental (event-driven) with a debounced recompute; a full `tabs.query` reconciliation runs on startup and on the recompute alarm. Target correct behavior at 1,000+ open tabs, with storage writes batched to respect quotas.
- **MV3 lifecycle:** treat the background as disposable — persist after every event, rebuild state from storage on wake, use `alarms` rather than in-memory timers, and register all event listeners synchronously at the top level.
- **Cross-browser parity:** target the `browser.*` namespace via `webextension-polyfill`; feature-detect `runtime.getBrowserInfo`, `tabs.Tab.lastAccessed`, `storage.sync`, and `persistAcrossSessions`.
- **Accessibility & i18n:** report/popup/options are keyboard-navigable with ARIA labels; user-facing strings go through `_locales` (`i18n`) with English as the default.
- **Security:** no remote code and no `eval`; the default strict MV3 CSP applies; the extension reads tab metadata only and stores it locally.

### Project structure & tooling

```
browser-tab-doctor/
├─ src/
│  ├─ background/        # service worker / event page entry: tab tracking, staleness, alarms
│  ├─ report/            # report.html + report UI
│  ├─ popup/             # popup.html + summary UI
│  ├─ options/           # options.html + settings UI
│  ├─ lib/               # storage layer, staleness/date logic, browser detection
│  └─ types/             # shared TypeScript types (TabRecord, ReportSnapshot, Config)
├─ _locales/en/messages.json
├─ icons/                # 16/32/48/128 PNGs
├─ manifest.chromium.json
├─ manifest.firefox.json
├─ tests/                # unit + integration tests
├─ package.json
└─ (bundler config: vite / esbuild)
```

- **Stack:** TypeScript (strict), Vite or esbuild, `webextension-polyfill`, ESLint + Prettier, and `web-ext` for Firefox run/lint and zipping.
- **Build:** one command emits per-browser bundles + the matching manifest into `dist/chromium` and `dist/firefox`.

### Testing strategy

- **Unit:** staleness math, `dateKey`/DST handling, retention/pruning, the identity/carry-forward heuristic, and config validation (Vitest or Jest).
- **Integration (mocked WebExtensions):** tab event → storage → badge/recompute flows against a mocked `browser.*` (e.g. `sinon-chrome` or `webextension-polyfill` mocks).
- **End-to-end:** load the unpacked build in Chrome (Puppeteer) and Firefox (`web-ext`); open/idle/close tabs and verify counts, badge, report actions, daily-alarm catch-up (with a shortened interval), and options hot-reload.
- **Manual matrix:** Chrome, Edge, one other Chromium (Brave/Opera), and Firefox smoke tests before each release.

### Packaging & distribution

- **Chromium (Chrome/Edge/Opera/Brave):** zip `dist/chromium` (manifest at root) → upload to Chrome Web Store / Edge Add-ons / Opera. Each store requires a unique version per upload.
- **Firefox:** `web-ext build` on `dist/firefox` → submit to AMO (automated review, with possible post-publication manual review). Requires `browser_specific_settings.gecko.id`.
- **Safari (deferred — later phase):** `xcrun safari-web-extension-packager dist/chromium` → Xcode app project → App Store. Expect manifest warnings for unsupported keys; requires a Mac/Xcode or App Store Connect.

### First-run & onboarding

- On `runtime.onInstalled` with `reason === "install"`: open `report.html` (or a short welcome) explaining per-browser scope and the default 7-day threshold, and run the first full `tabs.query` inventory.
- No permission prompts beyond install time (all permissions are static and non-host). Private-window coverage stays off unless the user enables it in the browser's extension settings.
- On `runtime.onInstalled` with `reason === "update"`: run any `schemaVersion` migration.

### Milestones

1. **M1 — Skeleton:** manifest(s), background entry, storage layer, shared types, build for Chrome + Firefox.
2. **M2 — Tracking (R1–R3):** startup inventory, live tab events, timestamps with `lastAccessed` bootstrap + carry-forward.
3. **M3 — Report & nudge (R4–R6):** staleness engine, `report.html` with Close/Jump, toolbar badge + banner, all-clear suppression.
4. **M4 — Config & schedule (R7–R8):** options page + hot reload, daily alarm with catch-up, on-demand refresh, retention/pruning.
5. **M5 — Hardening:** tests, accessibility/i18n, performance at scale, and store packaging.
6. **M6 — Selective close & filtering (R9–R11):** report row checkboxes + select-all, "Close selected" / "Close others", the generalized `CLOSE_TABS` message, the confirm-before-multi-close dialog, and the in-place category filter with auto-clear.

### Assumptions & open questions

Current defaults (tell me if any should change):

1. **Per-browser:** each browser install is independent and covers only its own browser.
2. Daily report at `09:00` local; default threshold `7` days; both configurable.
3. Private/incognito excluded by default.
4. Nudge = toolbar badge + report-page banner.
5. On-demand health = opening the extension.
6. Cross-restart timestamp carry-forward is heuristic (tab IDs are not stable); `lastAccessed` is used where available; timestamps are exact from the moment a tab is opened while the extension is running.
7. **Storage-only:** all data, including daily report history, lives solely in the extension's browser storage — no files and no companion app on the machine. Report history is capped (default: last 90 snapshots).
8. **Safari** is deferred to a later phase; the initial release targets Chromium browsers and Firefox.

### References (verified 2026-07-11)

- `chrome.storage` — local 10 MB, sync 100 KB / 8 KB-per-item / 512 items / 1800-hr / 120-min: developer.chrome.com/docs/extensions/reference/api/storage
- MDN `storage.local` and `storage.sync` — Firefox quotas, Opera unsupported, add-on ID: developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage
- `chrome.alarms` — 30 s minimum, 500 cap, `persistAcrossSessions` (Chrome 150+), sleep behavior: developer.chrome.com/docs/extensions/reference/api/alarms and MDN `alarms/create`
- Service-worker lifecycle — 30 s idle, 5 min task, 30 s fetch: developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- MDN Background scripts and the `background` manifest key — Firefox event pages; `service_worker` unsupported; dual-key pattern; Chrome 121 / Firefox 121: developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background
- `chrome.action` — badge ~4 chars, `openPopup` availability: developer.chrome.com/docs/extensions/reference/api/action
- `chrome.tabs` — `lastAccessed` (Chrome 121+), `Tab.id` session-scoped, events: developer.chrome.com/docs/extensions/reference/api/tabs
- MDN `runtime.getBrowserInfo` (Firefox-only) and `manifest.json/incognito`: developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/getBrowserInfo
- MDN Build a cross-browser extension and Apple "Packaging a web extension for Safari": developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Build_a_cross_browser_extension