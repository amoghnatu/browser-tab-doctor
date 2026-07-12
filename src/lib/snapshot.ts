import type { Config, ReportSnapshot, StaleItem } from "../types";
import { localDateKey } from "./date";
import { truncateForDisplay } from "./url";

/**
 * Build a frozen daily/on-demand report snapshot (R4, R8).
 * On-demand snapshots do NOT fulfill the daily scheduled slot (different trigger).
 */
export function buildSnapshot(
  trigger: "scheduled" | "on-demand",
  cfg: Config,
  stale: StaleItem[],
  totalOpen: number,
  nowMs: number = Date.now(),
): ReportSnapshot {
  const items = stale.map((r) => ({
    title: r.title,
    url: cfg.privacy.truncateUrls ? truncateForDisplay(r.url) : r.url,
    firstOpenedAt: r.firstOpenedAt,
    lastActiveAt: r.lastActiveAt,
    idleDays: r.idleDays,
  }));

  return {
    dateKey: localDateKey(nowMs),
    generatedAt: nowMs,
    totalTabs: totalOpen,
    staleTabs: stale.length,
    items,
    trigger,
  };
}

/**
 * Decide which snapshot storage keys to remove when retaining `keep` newest.
 * Keys are expected as full storage keys: `report:YYYY-MM-DD`.
 */
export function snapshotKeysToPrune(keys: string[], keep: number): string[] {
  if (keep < 1) keep = 1;
  const sorted = [...keys].sort().reverse(); // newest dateKey first (ISO dates sort lexically)
  return sorted.slice(keep);
}

/**
 * Whether a scheduled daily report should be generated now (R8).
 * Idempotent per dateKey; waits until localHour >= reportHour.
 */
export function shouldGenerateDailyReport(
  existingDateKey: string | null | undefined,
  todayKey: string,
  hour: number,
  reportHour: number,
): boolean {
  if (existingDateKey === todayKey) return false;
  if (hour < reportHour) return false;
  return true;
}
