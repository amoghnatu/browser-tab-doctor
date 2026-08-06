/**
 * Browser Tab Doctor — background service worker (Chromium) / event page (Firefox).
 * Stateless & event-driven: rebuild from storage on every wake (MV3 lifecycle).
 */
import browser from "webextension-polyfill";
import {
  ALARM_NAMES,
  PROACTIVE_NOTIFICATION_ID,
  type Config,
  type ExtensionState,
  type Msg,
  type MsgResponse,
  type TabRecord,
} from "../types";
import { detectHostBrowser } from "../lib/browser-info";
import { coerceTimestamp, localDateKey, localHour } from "../lib/date";
import * as logger from "../lib/logger";
import { isMsg } from "../lib/messaging";
import {
  evaluateProactiveNotification,
  notificationMessage,
} from "../lib/notify";
import {
  createTabRecord,
  dedupeOpenByTabId,
  findBestMatch,
  projectOpenFromTabIdMap,
  reconcileTabs,
  type LiveTab,
} from "../lib/reconcile";
import { buildSnapshot, shouldGenerateDailyReport } from "../lib/snapshot";
import { computeStalenessFromRecords, countByWindow } from "../lib/staleness";
import * as storage from "../lib/storage";
import { isClosable, normalizeUrl } from "../lib/url";
import { refreshBadge } from "./badge";

// ── Bootstrap storage ───────────────────────────────────────────────────────

function hasSessionStorage(): boolean {
  try {
    return !!(browser.storage && (browser.storage as { session?: unknown }).session);
  } catch {
    return false;
  }
}

function hasSyncStorage(): boolean {
  try {
    return !!browser.storage?.sync;
  } catch {
    return false;
  }
}

storage.initStorage({
  local: browser.storage.local,
  session: hasSessionStorage()
    ? (browser.storage as { session: typeof browser.storage.local }).session
    : null,
  sync: hasSyncStorage() ? browser.storage.sync : null,
});

// ── Ready gate (lazy reconcile after cold wake) ─────────────────────────────

let readyPromise: Promise<void> | null = null;
let hostBrowserCache: string | null = null;
let recomputeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Serialize all inventory mutations. Concurrent reconcile + adoptTab/onCreated
 * was creating a full second set of open records (every report row duplicated).
 */
let inventoryChain: Promise<unknown> = Promise.resolve();
/** >0 while inside withInventory — prevents re-entrant reconcile deadlocks. */
let inventoryDepth = 0;

function withInventory<T>(fn: () => Promise<T>): Promise<T> {
  const run = inventoryChain.then(
    async () => {
      inventoryDepth++;
      try {
        return await fn();
      } finally {
        inventoryDepth--;
      }
    },
    async () => {
      inventoryDepth++;
      try {
        return await fn();
      } finally {
        inventoryDepth--;
      }
    },
  );
  inventoryChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function ensureReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      try {
        await storage.migrateIfNeeded();
        // ALWAYS full re-sync once per service-worker start / extension reload.
        // Skipping when the session map "looked live" left ghost rows in production.
        await reconcile();
        await ensureAlarms();
      } catch (e) {
        logger.error("ensureReady failed", e);
        readyPromise = null;
        throw e;
      }
    })();
  }
  return readyPromise;
}

function scheduleRecompute(): void {
  if (recomputeTimer) clearTimeout(recomputeTimer);
  recomputeTimer = setTimeout(() => {
    recomputeTimer = null;
    void recomputeAndRefreshBadge().catch((e) => logger.error("debounced recompute", e));
  }, 750);
}

// ── Core operations ─────────────────────────────────────────────────────────

/** Live normal-window tabs, deduped by id. */
async function queryLiveTabs(): Promise<LiveTab[]> {
  const raw = (await browser.tabs.query({
    windowType: "normal",
  })) as LiveTab[];
  const byId = new Map<number, LiveTab>();
  for (const t of raw) {
    if (t.id != null && t.id > 0) byId.set(t.id, t);
  }
  return [...byId.values()];
}

/**
 * Full inventory sync: open set is EXACTLY one record per live tab id.
 * This is the only path that may set isOpen=true for report/badge.
 */
async function reconcile(): Promise<void> {
  return withInventory(async () => {
    const { open } = await syncInventoryFromLiveUnlocked();
    await recomputeAndRefreshBadgeFromOpen(open);
  });
}

/**
 * Must run inside withInventory.
 *
 * First principles:
 *   Source of truth for "what tabs exist" = browser.tabs.query (live tabs).
 *   chrome.storage.local tab:<uuid> only holds *metadata* (first opened, last used).
 *   The report must never list a storage row that is not a live browser tab.
 *
 * Algorithm: walk LIVE tabs once; assign exactly one TabRecord each; force-close
 * every other isOpen record. open.length === liveTabs.length always.
 */
async function syncInventoryFromLiveUnlocked(): Promise<{
  open: TabRecord[];
  ghostsClosed: number;
  liveCount: number;
}> {
  const cfg = await storage.getConfig();
  const now = Date.now();
  const liveTabs = await queryLiveTabs();
  const allRecords = await storage.getAllTabRecords();
  const openBefore = allRecords.filter((r) => r.isOpen);

  // Match using currently-open inventory (carry forward identity / timestamps)
  const result = reconcileTabs(liveTabs, openBefore, cfg);

  // Keep ONLY the live-tab→key winners open
  const projected = projectOpenFromTabIdMap(
    result.records,
    result.tabIdToKey,
    now,
  );

  const openKeys = new Set(projected.open.map((r) => r.key));
  const writeByKey = new Map<string, TabRecord>();
  for (const r of projected.open) writeByKey.set(r.key, r);

  let ghostsClosed = 0;
  for (const r of allRecords) {
    if (openKeys.has(r.key)) continue;
    if (r.isOpen) {
      writeByKey.set(r.key, { ...r, isOpen: false, lastSeenAt: now });
      ghostsClosed++;
    }
    // closed historical rows: leave untouched (not rewritten) unless already in map
  }

  // Persist open winners + newly closed ghosts only (smaller write)
  await storage.upsertTabRecords([...writeByKey.values()]);
  await storage.setSessionMap(result.tabIdToKey);

  // Absolute invariant
  if (projected.open.length !== liveTabs.length) {
    logger.error("INVARIANT BROKEN: open !== live after sync", {
      open: projected.open.length,
      live: liveTabs.length,
      tabIdToKeySize: Object.keys(result.tabIdToKey).length,
    });
  } else {
    logger.log("inventory sync ok", {
      live: liveTabs.length,
      open: projected.open.length,
      ghostsClosed,
      openBefore: openBefore.length,
    });
  }

  return {
    open: projected.open,
    ghostsClosed,
    liveCount: liveTabs.length,
  };
}

/**
 * Open inventory for report/badge: always 1:1 with live tabs.
 * Re-syncs when called outside the inventory lock if counts look wrong.
 */
async function getCanonicalOpenRecords(): Promise<TabRecord[]> {
  if (inventoryDepth > 0) {
    const liveTabs = await queryLiveTabs();
    const liveIds = new Set(
      liveTabs.map((t) => t.id).filter((id): id is number => id != null && id > 0),
    );
    return dedupeOpenByTabId(
      (await storage.getAllTabRecords()).filter(
        (r) => r.isOpen && liveIds.has(Number(r.tabId)),
      ),
    );
  }

  return withInventory(async () => {
    const { open } = await syncInventoryFromLiveUnlocked();
    return open;
  });
}

function countSameUrlExtras(items: { url: string }[]): number {
  const counts = new Map<string, number>();
  for (const it of items) {
    const u = it.url || "";
    if (!u) continue;
    counts.set(u, (counts.get(u) ?? 0) + 1);
  }
  let extras = 0;
  for (const n of counts.values()) {
    if (n > 1) extras += n - 1;
  }
  return extras;
}

async function recomputeAndRefreshBadgeFromOpen(open: TabRecord[]): Promise<void> {
  const cfg = await storage.getConfig();
  const { staleCount } = computeStalenessFromRecords(open, cfg);
  await refreshBadge(browser, cfg, staleCount);
  await maybeShowProactiveNotificationFromOpen(open);
}

async function recomputeAndRefreshBadge(): Promise<void> {
  const open = await getCanonicalOpenRecords();
  await recomputeAndRefreshBadgeFromOpen(open);
}

/** R12: rare system notification when load is high and long-idle share is high. */
async function maybeShowProactiveNotification(): Promise<void> {
  const open = await getCanonicalOpenRecords();
  await maybeShowProactiveNotificationFromOpen(open);
}

async function maybeShowProactiveNotificationFromOpen(
  open: TabRecord[],
): Promise<void> {
  try {
    const cfg = await storage.getConfig();
    const lastAt = await storage.getLastNotificationAt();
    const now = Date.now();
    const decision = evaluateProactiveNotification(open, cfg, lastAt, now);
    if (!decision.shouldNotify) {
      logger.log("proactive notify skip", decision.reason, {
        open: decision.openCount,
        longIdle: decision.longIdleCount,
        share: decision.sharePercent,
      });
      return;
    }
    await browser.notifications.create(PROACTIVE_NOTIFICATION_ID, {
      type: "basic",
      iconUrl: browser.runtime.getURL("icons/128.png"),
      title: "Browser Tab Doctor",
      message: notificationMessage(decision, cfg.notifyLongIdleDays),
    });
    // Only advance cooldown after a successful create
    await storage.setLastNotificationAt(now);
    logger.log("proactive notification shown", decision);
  } catch (e) {
    // Permission denied / OS blocked — do not set cooldown
    logger.warn("proactive notification failed", e);
  }
}

async function openReportFromNotification(): Promise<void> {
  const url = browser.runtime.getURL("report.html");
  try {
    const existing = await browser.tabs.query({ url });
    if (existing[0]?.id != null) {
      await browser.tabs.update(existing[0].id, { active: true });
      if (existing[0].windowId != null) {
        await browser.windows.update(existing[0].windowId, { focused: true });
      }
    } else {
      await browser.tabs.create({ url });
    }
  } catch {
    await browser.tabs.create({ url });
  }
  try {
    await browser.notifications.clear(PROACTIVE_NOTIFICATION_ID);
  } catch {
    // ignore
  }
}

async function ensureAlarms(): Promise<void> {
  const cfg = await storage.getConfig();
  try {
    if (!(await browser.alarms.get(ALARM_NAMES.daily))) {
      await browser.alarms.create(ALARM_NAMES.daily, { periodInMinutes: 60 });
    }
    const existing = await browser.alarms.get(ALARM_NAMES.recompute);
    const period = Math.max(0.5, cfg.recomputeIntervalMinutes);
    if (!existing) {
      await browser.alarms.create(ALARM_NAMES.recompute, { periodInMinutes: period });
    } else if (
      existing.periodInMinutes != null &&
      Math.abs(existing.periodInMinutes - period) > 0.01
    ) {
      await browser.alarms.clear(ALARM_NAMES.recompute);
      await browser.alarms.create(ALARM_NAMES.recompute, { periodInMinutes: period });
    }
  } catch (e) {
    logger.error("ensureAlarms failed", e);
  }
}

async function maybeGenerateDailyReport(): Promise<void> {
  const cfg = await storage.getConfig();
  const now = Date.now();
  const today = localDateKey(now);
  const existing = await storage.getSnapshot(today);
  if (
    !shouldGenerateDailyReport(
      existing?.dateKey,
      today,
      localHour(now),
      cfg.reportHour,
    )
  ) {
    return;
  }
  const open = await getCanonicalOpenRecords();
  const staleness = computeStalenessFromRecords(open, cfg, now);
  const snap = buildSnapshot("scheduled", cfg, staleness.stale, staleness.totalOpen, now);
  await storage.putSnapshot(snap);
  await storage.pruneSnapshots(cfg.retentionSnapshots);
  await recomputeAndRefreshBadge();
  logger.log("daily report generated", snap.dateKey, snap.staleTabs);
}

async function getHostBrowser(): Promise<string> {
  if (!hostBrowserCache) {
    hostBrowserCache = await detectHostBrowser(browser);
  }
  return hostBrowserCache;
}

async function buildState(): Promise<ExtensionState> {
  const cfg = await storage.getConfig();

  // Sync first: open set is derived ONLY from live browser tabs
  let open: TabRecord[];
  let ghostsClosed = 0;
  let liveCount = 0;
  if (inventoryDepth > 0) {
    open = await getCanonicalOpenRecords();
    liveCount = (await queryLiveTabs()).length;
  } else {
    const sync = await withInventory(() => syncInventoryFromLiveUnlocked());
    open = sync.open;
    ghostsClosed = sync.ghostsClosed;
    liveCount = sync.liveCount;
  }

  const staleness = computeStalenessFromRecords(open, cfg);
  // Report "open" count = real browser tabs
  staleness.totalOpen = liveCount;

  let extVersion = "";
  try {
    extVersion = browser.runtime.getManifest()?.version ?? "";
  } catch {
    /* ignore */
  }

  const lastSnapshot = await storage.getLatestSnapshot();
  return {
    config: cfg,
    staleness,
    hostBrowser: await getHostBrowser(),
    lastSnapshot,
    byWindow: countByWindow(open),
    diagnostics: {
      liveTabCount: liveCount,
      openRecordCount: open.length,
      listedRowCount: staleness.stale.length,
      listedSameUrlExtras: countSameUrlExtras(staleness.stale),
      ghostsClosedThisSync: ghostsClosed,
      extensionVersion: extVersion,
    },
  };
}

/**
 * Attach a live browser tab to inventory (must run inside withInventory).
 * Prefer reusing an existing open record so we never create ghost duplicates.
 */
async function adoptTabUnlocked(tab: LiveTab): Promise<TabRecord> {
  const cfg = await storage.getConfig();
  const now = Date.now();
  const open = (await storage.getAllTabRecords()).filter((r) => r.isOpen);

  // 0) Session map already has this live id
  if (tab.id != null) {
    const mappedKey = await storage.mapGet(tab.id);
    if (mappedKey) {
      const mapped = await storage.getTabRecord(mappedKey);
      if (mapped) {
        mapped.tabId = tab.id;
        mapped.windowId = tab.windowId ?? mapped.windowId;
        mapped.index = tab.index;
        mapped.url = normalizeUrl(tab.url ?? "", cfg);
        mapped.title = tab.title ?? mapped.title;
        mapped.pinned = !!tab.pinned;
        mapped.discarded = !!tab.discarded;
        mapped.lastSeenAt = now;
        mapped.isOpen = true;
        await storage.upsertTabRecord(mapped);
        return mapped;
      }
    }
  }

  // 1) Same live tabId already on a record
  if (tab.id != null) {
    const byId = open.find((r) => r.tabId === tab.id);
    if (byId) {
      byId.tabId = tab.id;
      byId.windowId = tab.windowId ?? byId.windowId;
      byId.index = tab.index;
      byId.url = normalizeUrl(tab.url ?? "", cfg);
      byId.title = tab.title ?? byId.title;
      byId.pinned = !!tab.pinned;
      byId.discarded = !!tab.discarded;
      byId.lastSeenAt = now;
      byId.isOpen = true;
      const accessed = coerceTimestamp(tab.lastAccessed, now);
      if (accessed != null) {
        byId.lastActiveAt = Math.max(byId.lastActiveAt ?? 0, accessed);
      }
      await storage.upsertTabRecord(byId);
      await storage.mapSet(tab.id, byId.key);
      return byId;
    }
  }

  // 2) Heuristic match — carry forward identity
  const match = findBestMatch(tab, open, new Set(), cfg);
  if (match) {
    const record = { ...match };
    if (tab.id != null) record.tabId = tab.id;
    record.windowId = tab.windowId ?? record.windowId;
    record.index = tab.index;
    record.url = normalizeUrl(tab.url ?? "", cfg);
    record.title = tab.title ?? record.title;
    record.pinned = !!tab.pinned;
    record.discarded = !!tab.discarded;
    record.lastSeenAt = now;
    record.isOpen = true;
    const accessed = coerceTimestamp(tab.lastAccessed, now);
    if (accessed != null) {
      record.lastActiveAt = Math.max(record.lastActiveAt ?? 0, accessed);
      if (!record.firstOpenedAt || record.firstOpenedAt <= 0) {
        record.firstOpenedAt = accessed;
      }
    }
    await storage.upsertTabRecord(record);
    if (tab.id != null) await storage.mapSet(tab.id, record.key);
    return record;
  }

  // 3) Truly new tab
  const accessed = coerceTimestamp(tab.lastAccessed, now);
  const key = crypto.randomUUID();
  const record =
    accessed != null
      ? createTabRecord(key, tab, accessed, accessed, cfg, now)
      : createTabRecord(
          key,
          tab,
          /*firstOpenedAt*/ 0,
          /*lastActiveAt*/ null,
          cfg,
          now,
        );
  await storage.upsertTabRecord(record);
  if (tab.id != null) await storage.mapSet(tab.id, key);
  return record;
}

async function adoptTab(tab: LiveTab): Promise<TabRecord> {
  if (inventoryDepth > 0) return adoptTabUnlocked(tab);
  return withInventory(() => adoptTabUnlocked(tab));
}

/** Resolve a live browser tabId from stable key and/or possibly-stale tabId. */
async function resolveLiveTabId(opts: {
  tabId?: number;
  key?: string;
}): Promise<{ tabId: number; url: string } | null> {
  const tryId = async (id: number, expectedUrl?: string) => {
    if (id <= 0) return null;
    try {
      const live = await browser.tabs.get(id);
      if (expectedUrl && live.url) {
        const cfg = await storage.getConfig();
        // Soft check — URL may have navigated; still allow close of this id
        void cfg;
      }
      return { tabId: id, url: live.url ?? expectedUrl ?? "" };
    } catch {
      return null;
    }
  };

  // Prefer stable key → current record.tabId (after reconcile)
  if (opts.key) {
    const rec = await storage.getTabRecord(opts.key);
    if (rec) {
      const hit = await tryId(rec.tabId, rec.url);
      if (hit) return hit;
      // Last resort: find a live tab with the same URL (closest index)
      if (rec.url) {
        try {
          const cfg = await storage.getConfig();
          const want = normalizeUrl(rec.url, cfg);
          const all = (await browser.tabs.query({
            windowType: "normal",
          })) as LiveTab[];
          const candidates = all.filter(
            (t) =>
              t.id != null &&
              normalizeUrl(t.url ?? "", cfg) === want,
          );
          if (candidates.length > 0) {
            candidates.sort(
              (a, b) =>
                Math.abs(a.index - rec.index) - Math.abs(b.index - rec.index),
            );
            const best = candidates[0]!;
            if (best.id != null) {
              // Repair inventory mapping
              rec.tabId = best.id;
              rec.windowId = best.windowId ?? rec.windowId;
              rec.index = best.index;
              rec.isOpen = true;
              rec.lastSeenAt = Date.now();
              await storage.upsertTabRecord(rec);
              await storage.mapSet(best.id, rec.key);
              return { tabId: best.id, url: best.url ?? rec.url };
            }
          }
        } catch (e) {
          logger.warn("resolveLiveTabId URL fallback failed", e);
        }
      }
    }
  }

  if (opts.tabId != null) {
    const hit = await tryId(opts.tabId);
    if (hit) return hit;
  }
  return null;
}

/** Mark a ghost inventory row closed when the live tab is gone. */
async function markKeyClosed(key: string | undefined): Promise<void> {
  if (!key) return;
  const rec = await storage.getTabRecord(key);
  if (!rec || !rec.isOpen) return;
  rec.isOpen = false;
  rec.lastSeenAt = Date.now();
  await storage.upsertTabRecord(rec);
}

// ── Message handler ─────────────────────────────────────────────────────────

/**
 * Remove live tabs by id; skip internal pages; tolerate already-closed tabs.
 * Callers should pass ids already resolved via resolveLiveTabId when possible.
 */
async function removeTabIds(tabIds: number[]): Promise<number> {
  if (tabIds.length === 0) return 0;
  const toClose: number[] = [];
  for (const tabId of tabIds) {
    if (tabId <= 0) continue;
    try {
      const rec = await storage.recordFor(tabId);
      if (rec && !isClosable(rec.url)) continue;
      try {
        const live = await browser.tabs.get(tabId);
        if (live.url && !isClosable(live.url)) continue;
      } catch {
        // Tab already gone — skip
        continue;
      }
      toClose.push(tabId);
    } catch (e) {
      logger.warn("removeTabIds precheck failed", tabId, e);
    }
  }
  if (toClose.length === 0) return 0;
  // Deduplicate — ghost rows can resolve to the same live id
  const unique = [...new Set(toClose)];
  try {
    await browser.tabs.remove(unique);
    return unique.length;
  } catch (e) {
    logger.warn("batch tabs.remove failed; falling back", e);
    let closed = 0;
    for (const tabId of unique) {
      try {
        await browser.tabs.remove(tabId);
        closed++;
      } catch (err) {
        logger.warn("close tab failed", tabId, err);
      }
    }
    return closed;
  }
}

/** Re-resolve keys/ids to live tabIds after a fresh reconcile. */
async function resolveTargetsToLiveIds(
  tabIds: number[],
  keys?: string[],
): Promise<number[]> {
  await reconcile();
  const liveIds: number[] = [];
  const seen = new Set<number>();

  const add = (id: number) => {
    if (id > 0 && !seen.has(id)) {
      seen.add(id);
      liveIds.push(id);
    }
  };

  if (keys && keys.length > 0) {
    for (const key of keys) {
      const resolved = await resolveLiveTabId({ key });
      if (resolved) add(resolved.tabId);
      else await markKeyClosed(key);
    }
  }

  for (const id of tabIds) {
    if (seen.has(id)) continue;
    const resolved = await resolveLiveTabId({ tabId: id });
    if (resolved) add(resolved.tabId);
  }

  return liveIds;
}

async function handleMessage(msg: Msg): Promise<MsgResponse> {
  await ensureReady();
  switch (msg.type) {
    case "GET_STATE": {
      // buildState always runs live-tab 1:1 sync
      return { type: "STATE", state: await buildState() };
    }

    case "REFRESH": {
      return { type: "STATE", state: await buildState() };
    }

    case "CLOSE_TAB": {
      try {
        // Re-sync tabIds first — report rows may hold stale ids / ghost duplicates
        await reconcile();
        const resolved = await resolveLiveTabId({
          tabId: msg.tabId,
          key: msg.key,
        });
        if (!resolved) {
          await markKeyClosed(msg.key);
          await recomputeAndRefreshBadge();
          return {
            type: "CLOSE_TAB_RESULT",
            ok: false,
            error:
              "Could not find that tab (stale list entry). Refreshed inventory — try again if it still appears.",
          };
        }
        if (!isClosable(resolved.url)) {
          return {
            type: "CLOSE_TAB_RESULT",
            ok: false,
            error: "Internal page cannot be closed",
          };
        }
        await browser.tabs.remove(resolved.tabId);
        return { type: "CLOSE_TAB_RESULT", ok: true };
      } catch (e) {
        return { type: "CLOSE_TAB_RESULT", ok: false, error: String(e) };
      }
    }

    case "CLOSE_ALL_STALE": {
      // R9: bulk close every closable report row (stale + unknown/way-too-old)
      await reconcile();
      const cfg = await storage.getConfig();
      const open = await getCanonicalOpenRecords();
      const { stale } = computeStalenessFromRecords(open, cfg);
      const keys = stale.filter((s) => isClosable(s.url)).map((s) => s.key);
      const ids = await resolveTargetsToLiveIds(
        stale.map((s) => s.tabId),
        keys,
      );
      const closed = await removeTabIds(ids);
      return { type: "CLOSE_ALL_STALE_RESULT", closed };
    }

    case "CLOSE_TABS": {
      // R9: close by keys (preferred) and/or tabIds
      const ids = await resolveTargetsToLiveIds(msg.tabIds, msg.keys);
      const closed = await removeTabIds(ids);
      return { type: "CLOSE_TABS_RESULT", closed };
    }

    case "JUMP_TO_TAB": {
      try {
        await reconcile();
        const resolved = await resolveLiveTabId({
          tabId: msg.tabId,
          key: msg.key,
        });
        if (!resolved) {
          await markKeyClosed(msg.key);
          return {
            type: "JUMP_TO_TAB_RESULT",
            ok: false,
            error: "Tab no longer open (stale list entry removed).",
          };
        }
        const tab = await browser.tabs.get(resolved.tabId);
        await browser.tabs.update(resolved.tabId, { active: true });
        if (tab.windowId != null) {
          await browser.windows.update(tab.windowId, { focused: true });
        }
        return { type: "JUMP_TO_TAB_RESULT", ok: true };
      } catch (e) {
        return { type: "JUMP_TO_TAB_RESULT", ok: false, error: String(e) };
      }
    }

    case "GENERATE_REPORT_NOW": {
      const cfg = await storage.getConfig();
      const open = await getCanonicalOpenRecords();
      const staleness = computeStalenessFromRecords(open, cfg);
      // On-demand does NOT overwrite/fulfill the daily scheduled slot if one exists;
      // we store under today's key only when no scheduled snapshot exists yet,
      // otherwise return ephemeral snapshot without replacing scheduled one.
      const today = localDateKey();
      const existing = await storage.getSnapshot(today);
      const snap = buildSnapshot(
        "on-demand",
        cfg,
        staleness.stale,
        staleness.totalOpen,
      );
      if (!existing || existing.trigger === "on-demand") {
        await storage.putSnapshot(snap);
        await storage.pruneSnapshots(cfg.retentionSnapshots);
      }
      return { type: "GENERATE_REPORT_NOW_RESULT", snapshot: snap };
    }

    default:
      return { type: "ERROR", error: "Unknown message" };
  }
}

// ── Event listeners (registered synchronously at top level) ─────────────────

browser.runtime.onInstalled.addListener((details) => {
  void (async () => {
    try {
      await storage.migrateIfNeeded();
      readyPromise = null;
      await ensureReady();
      await reconcile();
      await ensureAlarms();
      await maybeGenerateDailyReport();
      if (details.reason === "install") {
        await browser.tabs.create({
          url: browser.runtime.getURL("report.html"),
        });
      }
    } catch (e) {
      logger.error("onInstalled", e);
    }
  })();
});

browser.runtime.onStartup.addListener(() => {
  void (async () => {
    try {
      readyPromise = null;
      await ensureReady();
      await reconcile();
      await ensureAlarms();
      await maybeGenerateDailyReport();
    } catch (e) {
      logger.error("onStartup", e);
    }
  })();
});

browser.tabs.onCreated.addListener((tab) => {
  void (async () => {
    try {
      await ensureReady();
      await withInventory(async () => {
        const rec = await adoptTabUnlocked(tab as LiveTab);
        const now = Date.now();
        if (tab.active) rec.lastActiveAt = now;
        rec.lastSeenAt = now;
        rec.isOpen = true;
        if (tab.id != null) {
          rec.tabId = tab.id;
          await storage.mapSet(tab.id, rec.key);
        }
        await storage.upsertTabRecord(rec);
      });
      scheduleRecompute();
    } catch (e) {
      logger.error("onCreated", e);
    }
  })();
});

browser.tabs.onActivated.addListener(({ tabId }) => {
  void (async () => {
    try {
      await ensureReady();
      await withInventory(async () => {
        let rec = await storage.recordFor(tabId);
        if (!rec) {
          try {
            const tab = await browser.tabs.get(tabId);
            // Inline adopt without nested lock (we're already in withInventory)
            rec = await adoptTabUnlocked(tab as LiveTab);
          } catch {
            return;
          }
        }
        rec.lastActiveAt = Date.now();
        rec.lastSeenAt = Date.now();
        rec.tabId = tabId;
        rec.isOpen = true;
        await storage.upsertTabRecord(rec);
        await storage.mapSet(tabId, rec.key);
      });
      scheduleRecompute();
    } catch (e) {
      logger.error("onActivated", e);
    }
  })();
});

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  void (async () => {
    try {
      await ensureReady();
      // Full read-modify-write under lock — prevents reopening ghosts after reconcile
      await withInventory(async () => {
        let rec = await storage.recordFor(tabId);
        if (!rec) {
          rec = await adoptTabUnlocked(tab as LiveTab);
        }
        // Re-read after adopt in case another writer closed a ghost
        const latest = (await storage.getTabRecord(rec.key)) ?? rec;
        const cfg = await storage.getConfig();
        if (changeInfo.url) latest.url = normalizeUrl(changeInfo.url, cfg);
        if (changeInfo.title) latest.title = changeInfo.title;
        if ("discarded" in changeInfo) latest.discarded = !!changeInfo.discarded;
        if ("pinned" in changeInfo) latest.pinned = !!changeInfo.pinned;
        if (tab.active && changeInfo.status === "complete") {
          latest.lastActiveAt = Date.now();
        }
        latest.lastSeenAt = Date.now();
        latest.tabId = tabId;
        latest.isOpen = true;
        if (tab.windowId != null) latest.windowId = tab.windowId;
        if (typeof tab.index === "number") latest.index = tab.index;
        await storage.upsertTabRecord(latest);
        await storage.mapSet(tabId, latest.key);
      });
      scheduleRecompute();
    } catch (e) {
      logger.error("onUpdated", e);
    }
  })();
});

browser.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    try {
      await ensureReady();
      await withInventory(async () => {
        const rec = await storage.recordFor(tabId);
        if (rec) {
          rec.isOpen = false;
          rec.lastSeenAt = Date.now();
          await storage.upsertTabRecord(rec);
        }
        await storage.mapDelete(tabId);
      });
      scheduleRecompute();
    } catch (e) {
      logger.error("onRemoved", e);
    }
  })();
});

async function updateWindowIndex(tabId: number): Promise<void> {
  await ensureReady();
  await withInventory(async () => {
    const tab = await browser.tabs.get(tabId);
    const rec = await storage.recordFor(tabId);
    if (!rec) return;
    rec.windowId = tab.windowId ?? rec.windowId;
    rec.index = tab.index;
    rec.lastSeenAt = Date.now();
    await storage.upsertTabRecord(rec);
  });
  scheduleRecompute();
}

browser.tabs.onAttached.addListener((tabId) => {
  void updateWindowIndex(tabId).catch((e) => logger.error("onAttached", e));
});

browser.tabs.onDetached.addListener((tabId) => {
  void updateWindowIndex(tabId).catch((e) => logger.error("onDetached", e));
});

browser.alarms.onAlarm.addListener((alarm) => {
  void (async () => {
    try {
      await ensureReady();
      if (alarm.name === ALARM_NAMES.recompute) {
        await recomputeAndRefreshBadge();
      } else if (alarm.name === ALARM_NAMES.daily) {
        await maybeGenerateDailyReport();
        // Primary R12 evaluation path (hourly; cooldown prevents spam)
        await maybeShowProactiveNotification();
      }
    } catch (e) {
      logger.error("onAlarm", e);
    }
  })();
});

// R12: open report when user clicks the proactive notification
if (browser.notifications?.onClicked) {
  browser.notifications.onClicked.addListener((notificationId) => {
    if (notificationId !== PROACTIVE_NOTIFICATION_ID) return;
    void openReportFromNotification().catch((e) =>
      logger.error("notification click", e),
    );
  });
}

browser.storage.onChanged.addListener((changes, area) => {
  void (async () => {
    try {
      if (area !== "local" && area !== "sync") return;
      if (!changes.config) return;
      const cfg = await storage.getConfig();
      logger.setDebug(cfg.debug);
      await ensureAlarms();
      await recomputeAndRefreshBadge();
    } catch (e) {
      logger.error("storage.onChanged", e);
    }
  })();
});

browser.runtime.onMessage.addListener((message: unknown) => {
  if (!isMsg(message)) {
    return Promise.resolve({ type: "ERROR", error: "Invalid message" } satisfies MsgResponse);
  }
  return handleMessage(message).catch((e: unknown) => {
    logger.error("onMessage", e);
    return { type: "ERROR", error: String(e) } satisfies MsgResponse;
  });
});

// Cold start: kick ready without blocking listener registration
void ensureReady().catch((e) => logger.error("cold ensureReady", e));

// Silence unused Config import warning in some TS configs
export type { Config };
