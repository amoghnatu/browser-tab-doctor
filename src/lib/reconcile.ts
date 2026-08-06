import type { Config, TabRecord } from "../types";
import { coerceTimestamp, isValidTimestamp } from "./date";
import { normalizeUrl } from "./url";

/** Minimal tab shape used by reconciliation (avoids coupling to polyfill types). */
export interface LiveTab {
  id?: number;
  windowId?: number;
  index: number;
  url?: string;
  title?: string;
  pinned?: boolean;
  discarded?: boolean;
  active?: boolean;
  lastAccessed?: number;
}

export function createTabRecord(
  key: string,
  tab: LiveTab,
  firstOpenedAt: number,
  lastActiveAt: number | null,
  cfg: Config,
  nowMs: number = Date.now(),
): TabRecord {
  return {
    key,
    tabId: tab.id ?? -1,
    windowId: tab.windowId ?? -1,
    index: tab.index,
    url: normalizeUrl(tab.url ?? "", cfg),
    title: tab.title ?? "",
    pinned: !!tab.pinned,
    discarded: !!tab.discarded,
    firstOpenedAt,
    lastActiveAt,
    lastSeenAt: nowMs,
    isOpen: true,
  };
}

/**
 * Identity match for a live tab against open inventory (R3).
 * Order:
 *  1) Exact tabId (stable within a browser session / extension reload)
 *  2) Same URL + closest index
 *  3) Same title + closest index
 *
 * Matching tabId first is critical: after extension reload, tabIds usually
 * stay the same while a missed reconcile + event handlers can create ghosts.
 */
export function findBestMatch(
  tab: LiveTab,
  openRecords: TabRecord[],
  used: Set<string>,
  cfg: Config,
): TabRecord | null {
  if (tab.id != null) {
    const byId = openRecords.find(
      (r) => !used.has(r.key) && r.tabId === tab.id && r.tabId > 0,
    );
    if (byId) return byId;
  }

  const url = normalizeUrl(tab.url ?? "", cfg);
  // Empty URL is common for pending tabs — don't mass-merge on ""
  if (url) {
    const candidates = openRecords.filter(
      (r) => !used.has(r.key) && r.url === url && r.url !== "",
    );
    if (candidates.length > 0) {
      return (
        [...candidates].sort(
          (a, b) => Math.abs(a.index - tab.index) - Math.abs(b.index - tab.index),
        )[0] ?? null
      );
    }
  }

  const title = tab.title ?? "";
  if (title) {
    const byTitle = openRecords.filter(
      (r) => !used.has(r.key) && r.title === title && r.title !== "",
    );
    if (byTitle.length > 0) {
      return (
        [...byTitle].sort(
          (a, b) => Math.abs(a.index - tab.index) - Math.abs(b.index - tab.index),
        )[0] ?? null
      );
    }
  }

  return null;
}

export interface ReconcileResult {
  records: TabRecord[];
  tabIdToKey: Record<number, string>;
  /** Records that were open but no longer present (closed while browser was off). */
  closedKeys: string[];
}

/**
 * Pure reconciliation of live tabs vs persisted open records (R1, R3).
 * uuidFn and nowMs are injectable for tests.
 */
export function reconcileTabs(
  liveTabs: LiveTab[],
  openRecords: TabRecord[],
  cfg: Config,
  uuidFn: () => string = () => crypto.randomUUID(),
  nowMs: number = Date.now(),
): ReconcileResult {
  const used = new Set<string>();
  const tabIdToKey: Record<number, string> = {};
  const updated = new Map<string, TabRecord>();

  // Clone open records into a working map
  for (const r of openRecords) {
    updated.set(r.key, { ...r });
  }

  for (const tab of liveTabs) {
    if (tab.id == null) continue;
    const match = findBestMatch(tab, openRecords, used, cfg);
    let record: TabRecord;

    if (match) {
      record = { ...match };
      record.tabId = tab.id;
      record.windowId = tab.windowId ?? record.windowId;
      record.index = tab.index;
      record.url = normalizeUrl(tab.url ?? "", cfg);
      record.title = tab.title ?? record.title;
      record.pinned = !!tab.pinned;
      record.discarded = !!tab.discarded;
      // Corrupt timestamps: clear lastActiveAt (unknown). Do NOT invent firstOpenedAt = now
      // — that showed "today" for ancient restored tabs (way-too-old rows).
      if (!isValidTimestamp(record.firstOpenedAt, nowMs)) {
        // Keep 0 as "unknown" sentinel; formatDate renders "—"
        record.firstOpenedAt = 0;
      }
      if (record.lastActiveAt != null && !isValidTimestamp(record.lastActiveAt, nowMs)) {
        record.lastActiveAt = null;
      }
      const accessed = coerceTimestamp(tab.lastAccessed, nowMs);
      if (accessed != null) {
        record.lastActiveAt = Math.max(record.lastActiveAt ?? 0, accessed);
        // Only backfill firstOpened when we have a real browser timestamp and ours is unknown
        if (!isValidTimestamp(record.firstOpenedAt, nowMs)) {
          record.firstOpenedAt = accessed;
        }
      }
      record.lastSeenAt = nowMs;
      record.isOpen = true;
    } else {
      // `lastAccessed: 0` is common on restored tabs — must NOT use `??` (0 is defined)
      const accessed = coerceTimestamp(tab.lastAccessed, nowMs);
      if (accessed != null) {
        record = createTabRecord(uuidFn(), tab, accessed, accessed, cfg, nowMs);
      } else {
        // No trustworthy open/active time — leave firstOpened unknown (0), lastActive null
        record = createTabRecord(uuidFn(), tab, /*firstOpenedAt*/ 0, /*lastActiveAt*/ null, cfg, nowMs);
      }
    }

    used.add(record.key);
    tabIdToKey[tab.id] = record.key;
    updated.set(record.key, record);
  }

  const closedKeys: string[] = [];
  for (const r of openRecords) {
    if (!used.has(r.key)) {
      const closed = { ...r, isOpen: false, lastSeenAt: nowMs };
      updated.set(r.key, closed);
      closedKeys.push(r.key);
    }
  }

  // Hard invariant: at most one open record per live tabId.
  // Collapse any remaining duplicates (corrupt inventory / race survivors).
  const openByTabId = new Map<number, string>(); // tabId → winning key
  for (const r of updated.values()) {
    if (!r.isOpen || r.tabId <= 0) continue;
    const prevKey = openByTabId.get(r.tabId);
    if (prevKey == null) {
      openByTabId.set(r.tabId, r.key);
      continue;
    }
    if (prevKey === r.key) continue;
    // Prefer the key already assigned in tabIdToKey for this live id
    const preferredKey = tabIdToKey[r.tabId] ?? prevKey;
    const loserKey = preferredKey === r.key ? prevKey : r.key;
    const winnerKey = preferredKey === r.key ? r.key : prevKey;
    const loser = updated.get(loserKey);
    if (loser) {
      updated.set(loserKey, { ...loser, isOpen: false, lastSeenAt: nowMs });
      if (!closedKeys.includes(loserKey)) closedKeys.push(loserKey);
    }
    openByTabId.set(r.tabId, winnerKey);
    tabIdToKey[r.tabId] = winnerKey;
  }

  // Ensure tabIdToKey only points at open winners
  for (const tabIdStr of Object.keys(tabIdToKey)) {
    const tabId = Number(tabIdStr);
    const key = tabIdToKey[tabId];
    if (!key) continue;
    const rec = updated.get(key);
    if (!rec || !rec.isOpen) {
      delete tabIdToKey[tabId];
    }
  }

  return {
    records: Array.from(updated.values()),
    tabIdToKey,
    closedKeys,
  };
}

/**
 * Pure: collapse open records so each live tabId appears at most once.
 * Coerces tabId with Number() so string ids from storage cannot slip through.
 * Drops tabId<=0 open rows (cannot be acted on; cause ghost duplicates).
 */
export function dedupeOpenByTabId(openRecords: TabRecord[]): TabRecord[] {
  const byId = new Map<number, TabRecord>();
  for (const r of openRecords) {
    if (!r.isOpen) continue;
    const id = Number(r.tabId);
    if (!Number.isFinite(id) || id <= 0) continue;
    const normalized = r.tabId === id ? r : { ...r, tabId: id };
    const prev = byId.get(id);
    if (!prev || normalized.lastSeenAt >= prev.lastSeenAt) {
      byId.set(id, normalized);
    }
  }
  return [...byId.values()];
}

/**
 * After reconcile: keep ONLY records assigned to a live tab via tabIdToKey.
 * Everything else that was open is forced closed.
 * Guarantees open.length === Object.keys(tabIdToKey).length.
 */
export function projectOpenFromTabIdMap(
  records: TabRecord[],
  tabIdToKey: Record<number, string>,
  nowMs: number = Date.now(),
): { open: TabRecord[]; all: TabRecord[] } {
  const keyToTabId = new Map<string, number>();
  for (const [idStr, key] of Object.entries(tabIdToKey)) {
    const id = Number(idStr);
    if (Number.isFinite(id) && id > 0 && key) keyToTabId.set(key, id);
  }

  const byKey = new Map<string, TabRecord>();
  for (const r of records) {
    byKey.set(r.key, { ...r });
  }

  const open: TabRecord[] = [];
  for (const [key, tabId] of keyToTabId) {
    const rec = byKey.get(key);
    if (!rec) continue;
    const fixed: TabRecord = {
      ...rec,
      tabId,
      isOpen: true,
      lastSeenAt: nowMs,
    };
    byKey.set(key, fixed);
    open.push(fixed);
  }

  // Force-close any other open record
  for (const [key, rec] of byKey) {
    if (rec.isOpen && !keyToTabId.has(key)) {
      byKey.set(key, { ...rec, isOpen: false, lastSeenAt: nowMs });
    }
  }

  // Dedupe open by tabId one more time (corrupt map)
  const openDeduped = dedupeOpenByTabId(open);
  const openKeys = new Set(openDeduped.map((r) => r.key));
  for (const [key, rec] of byKey) {
    if (rec.isOpen && !openKeys.has(key)) {
      byKey.set(key, { ...rec, isOpen: false, lastSeenAt: nowMs });
    }
  }

  return { open: openDeduped, all: Array.from(byKey.values()) };
}
