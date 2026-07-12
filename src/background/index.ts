/**
 * Browser Tab Doctor — background service worker (Chromium) / event page (Firefox).
 * Stateless & event-driven: rebuild from storage on every wake (MV3 lifecycle).
 */
import browser from "webextension-polyfill";
import {
  ALARM_NAMES,
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
import { createTabRecord, reconcileTabs, type LiveTab } from "../lib/reconcile";
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

async function ensureReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      try {
        await storage.migrateIfNeeded();
        const map = await storage.getSessionMap();
        if (Object.keys(map).length === 0) {
          await reconcile();
        }
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

async function reconcile(): Promise<void> {
  const cfg = await storage.getConfig();
  const liveTabs = (await browser.tabs.query({
    windowType: "normal",
  })) as LiveTab[];
  const allRecords = await storage.getAllTabRecords();
  const openRecords = allRecords.filter((r) => r.isOpen);

  const result = reconcileTabs(liveTabs, openRecords, cfg);

  // Preserve closed historical records not touched by this reconcile
  const resultKeys = new Set(result.records.map((r) => r.key));
  const preserved = allRecords.filter((r) => !r.isOpen && !resultKeys.has(r.key));
  await storage.upsertTabRecords([...result.records, ...preserved]);
  await storage.setSessionMap(result.tabIdToKey);
  await recomputeAndRefreshBadge();
  logger.log("reconcile done", {
    live: liveTabs.length,
    open: result.records.filter((r) => r.isOpen).length,
    closed: result.closedKeys.length,
  });
}

async function recomputeAndRefreshBadge(): Promise<void> {
  const cfg = await storage.getConfig();
  const open = (await storage.getAllTabRecords()).filter((r) => r.isOpen);
  const { staleCount } = computeStalenessFromRecords(open, cfg);
  await refreshBadge(browser, cfg, staleCount);
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
  const open = (await storage.getAllTabRecords()).filter((r) => r.isOpen);
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
  const open = (await storage.getAllTabRecords()).filter((r) => r.isOpen);
  const staleness = computeStalenessFromRecords(open, cfg);
  const lastSnapshot = await storage.getLatestSnapshot();
  return {
    config: cfg,
    staleness,
    hostBrowser: await getHostBrowser(),
    lastSnapshot,
    byWindow: countByWindow(open),
  };
}

async function adoptTab(tab: LiveTab): Promise<TabRecord> {
  const cfg = await storage.getConfig();
  const now = Date.now();
  // Reject lastAccessed: 0 — don't invent "opened today" for restored tabs
  const accessed = coerceTimestamp(tab.lastAccessed, now);
  const key = crypto.randomUUID();
  const record =
    accessed != null
      ? createTabRecord(key, tab, accessed, accessed, cfg, now)
      : createTabRecord(key, tab, /*firstOpenedAt*/ 0, /*lastActiveAt*/ null, cfg, now);
  await storage.upsertTabRecord(record);
  if (tab.id != null) await storage.mapSet(tab.id, key);
  return record;
}

// ── Message handler ─────────────────────────────────────────────────────────

/** Remove tabs by id; skip internal pages; tolerate already-closed tabs. */
async function removeTabIds(tabIds: number[]): Promise<number> {
  if (tabIds.length === 0) return 0;
  const toClose: number[] = [];
  for (const tabId of tabIds) {
    if (tabId <= 0) continue;
    try {
      const rec = await storage.recordFor(tabId);
      if (rec && !isClosable(rec.url)) continue;
      // Prefer live tab URL when present
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
  try {
    // Batch remove is more reliable than one-by-one in MV3
    await browser.tabs.remove(toClose);
    return toClose.length;
  } catch (e) {
    // Fall back to one-by-one if batch fails partially
    logger.warn("batch tabs.remove failed; falling back", e);
    let closed = 0;
    for (const tabId of toClose) {
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

async function handleMessage(msg: Msg): Promise<MsgResponse> {
  await ensureReady();
  switch (msg.type) {
    case "GET_STATE":
      return { type: "STATE", state: await buildState() };

    case "REFRESH": {
      await reconcile();
      return { type: "STATE", state: await buildState() };
    }

    case "CLOSE_TAB": {
      try {
        const rec = await storage.recordFor(msg.tabId);
        if (rec && !isClosable(rec.url)) {
          return { type: "CLOSE_TAB_RESULT", ok: false, error: "Internal page cannot be closed" };
        }
        await browser.tabs.remove(msg.tabId);
        return { type: "CLOSE_TAB_RESULT", ok: true };
      } catch (e) {
        return { type: "CLOSE_TAB_RESULT", ok: false, error: String(e) };
      }
    }

    case "CLOSE_ALL_STALE": {
      // R9: bulk close every closable report row (stale + unknown/way-too-old)
      const cfg = await storage.getConfig();
      const open = (await storage.getAllTabRecords()).filter((r) => r.isOpen);
      const { stale } = computeStalenessFromRecords(open, cfg);
      const ids = stale
        .filter((s) => isClosable(s.url) && s.tabId > 0)
        .map((s) => s.tabId);
      const closed = await removeTabIds(ids);
      return { type: "CLOSE_ALL_STALE_RESULT", closed };
    }

    case "CLOSE_TABS": {
      // R9: close an arbitrary set of tabIds (selected / others / filtered)
      const ids = msg.tabIds.filter((id) => id > 0);
      const closed = await removeTabIds(ids);
      return { type: "CLOSE_TABS_RESULT", closed };
    }

    case "JUMP_TO_TAB": {
      try {
        const tab = await browser.tabs.get(msg.tabId);
        await browser.tabs.update(msg.tabId, { active: true });
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
      const open = (await storage.getAllTabRecords()).filter((r) => r.isOpen);
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
      const cfg = await storage.getConfig();
      const key = crypto.randomUUID();
      const now = Date.now();
      const accessed = coerceTimestamp(tab.lastAccessed, now);
      // Tab created while we run: firstOpened is now. lastActive: now if active, else
      // lastAccessed if valid, else now (just created — not "way too old").
      const firstOpenedAt = now;
      const lastActiveAt = tab.active ? now : (accessed ?? now);
      const record = createTabRecord(
        key,
        tab as LiveTab,
        firstOpenedAt,
        lastActiveAt,
        cfg,
        now,
      );
      await storage.upsertTabRecord(record);
      if (tab.id != null) await storage.mapSet(tab.id, key);
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
      let rec = await storage.recordFor(tabId);
      if (!rec) {
        try {
          const tab = await browser.tabs.get(tabId);
          rec = await adoptTab(tab as LiveTab);
        } catch {
          return;
        }
      }
      rec.lastActiveAt = Date.now();
      rec.lastSeenAt = Date.now();
      await storage.upsertTabRecord(rec);
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
      let rec = await storage.recordFor(tabId);
      if (!rec) {
        rec = await adoptTab(tab as LiveTab);
      }
      const cfg = await storage.getConfig();
      if (changeInfo.url) rec.url = normalizeUrl(changeInfo.url, cfg);
      if (changeInfo.title) rec.title = changeInfo.title;
      if ("discarded" in changeInfo) rec.discarded = !!changeInfo.discarded;
      if ("pinned" in changeInfo) rec.pinned = !!changeInfo.pinned;
      if (tab.active && changeInfo.status === "complete") {
        rec.lastActiveAt = Date.now();
      }
      rec.lastSeenAt = Date.now();
      rec.tabId = tabId;
      if (tab.windowId != null) rec.windowId = tab.windowId;
      if (typeof tab.index === "number") rec.index = tab.index;
      await storage.upsertTabRecord(rec);
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
      const rec = await storage.recordFor(tabId);
      if (rec) {
        rec.isOpen = false;
        rec.lastSeenAt = Date.now();
        await storage.upsertTabRecord(rec);
      }
      await storage.mapDelete(tabId);
      scheduleRecompute();
    } catch (e) {
      logger.error("onRemoved", e);
    }
  })();
});

async function updateWindowIndex(tabId: number): Promise<void> {
  await ensureReady();
  const tab = await browser.tabs.get(tabId);
  const rec = await storage.recordFor(tabId);
  if (!rec) return;
  rec.windowId = tab.windowId ?? rec.windowId;
  rec.index = tab.index;
  rec.lastSeenAt = Date.now();
  await storage.upsertTabRecord(rec);
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
      }
    } catch (e) {
      logger.error("onAlarm", e);
    }
  })();
});

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
