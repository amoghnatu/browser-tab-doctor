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
 * Heuristic identity match when tabId is not stable across restarts (R3).
 * Prefer same URL + closest index; fall back to title + closest index.
 */
export function findBestMatch(
  tab: LiveTab,
  openRecords: TabRecord[],
  used: Set<string>,
  cfg: Config,
): TabRecord | null {
  const url = normalizeUrl(tab.url ?? "", cfg);
  const candidates = openRecords.filter((r) => !used.has(r.key) && r.url === url);
  if (candidates.length === 0) {
    const byTitle = openRecords.filter(
      (r) => !used.has(r.key) && r.title === (tab.title ?? "") && (tab.title ?? "") !== "",
    );
    if (byTitle.length === 0) return null;
    return (
      [...byTitle].sort(
        (a, b) => Math.abs(a.index - tab.index) - Math.abs(b.index - tab.index),
      )[0] ?? null
    );
  }
  return (
    [...candidates].sort(
      (a, b) => Math.abs(a.index - tab.index) - Math.abs(b.index - tab.index),
    )[0] ?? null
  );
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

  return {
    records: Array.from(updated.values()),
    tabIdToKey,
    closedKeys,
  };
}
