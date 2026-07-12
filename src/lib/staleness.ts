import type { Config, StaleItem, Staleness, TabRecord } from "../types";
import { idleDays, isValidTimestamp, WAY_TOO_OLD_IDLE_DAYS } from "./date";

/**
 * Compute report rows + badge counts (R4, R5, R6).
 *
 * - Valid lastActiveAt + idle ≥ threshold → real stale (counts toward badge).
 * - Invalid/missing lastActiveAt (epoch 0, etc.) → same table as "way too old",
 *   not counted toward the badge (R6: never auto-flag unknowns alone).
 */
export function computeStalenessFromRecords(
  openRecords: TabRecord[],
  cfg: Config,
  nowMs: number = Date.now(),
): Staleness {
  const realStale: StaleItem[] = [];
  const wayTooOld: StaleItem[] = [];

  for (const r of openRecords) {
    if (!r.isOpen) continue;
    if (!isValidTimestamp(r.lastActiveAt, nowMs)) {
      // Do not compute ~20646d from epoch 0 — flag as way-too-old for the unified table
      wayTooOld.push({
        ...r,
        idleDays: WAY_TOO_OLD_IDLE_DAYS,
        wayTooOld: true,
      });
      continue;
    }
    const days = idleDays(r.lastActiveAt, nowMs);
    if (days >= cfg.thresholdDays) {
      realStale.push({
        ...r,
        idleDays: days,
        wayTooOld: isWayTooOldIdleDays(days),
      });
    }
  }

  realStale.sort((a, b) => b.idleDays - a.idleDays);
  // Unified table: corrupt timestamps first (most alarming), then real idle desc
  const stale = [...wayTooOld, ...realStale];

  const open = openRecords.filter((r) => r.isOpen);
  return {
    stale,
    unknownCount: wayTooOld.length,
    totalOpen: open.length,
    // Badge only — R6
    staleCount: realStale.length,
  };
}

function isWayTooOldIdleDays(days: number): boolean {
  return days >= WAY_TOO_OLD_IDLE_DAYS;
}

/** Group open tab counts by windowId (R2). */
export function countByWindow(
  openRecords: TabRecord[],
): Array<{ windowId: number; count: number }> {
  const map = new Map<number, number>();
  for (const r of openRecords) {
    if (!r.isOpen) continue;
    map.set(r.windowId, (map.get(r.windowId) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([windowId, count]) => ({ windowId, count }))
    .sort((a, b) => a.windowId - b.windowId);
}

/** Badge text for a stale count (R5/R6): empty at 0, "99+" above 99. */
export function badgeTextForCount(staleCount: number): string {
  if (staleCount <= 0) return "";
  if (staleCount > 99) return "99+";
  return String(staleCount);
}
