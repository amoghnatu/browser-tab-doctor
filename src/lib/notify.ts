/**
 * R12 — pure proactive notification decision logic.
 */
import type { Config, TabRecord } from "../types";
import { idleDays, isValidTimestamp, MS_PER_DAY } from "./date";

export interface NotifyDecision {
  shouldNotify: boolean;
  openCount: number;
  longIdleCount: number;
  /** 0–100 */
  sharePercent: number;
  reason: "disabled" | "too_few_tabs" | "share_too_low" | "cooldown" | "ok";
}

/** Long-idle for R12: unknown last-used, or idleDays >= notifyLongIdleDays. */
export function isLongIdleForNotify(
  r: TabRecord,
  longIdleDays: number,
  nowMs: number = Date.now(),
): boolean {
  if (!r.isOpen) return false;
  if (!isValidTimestamp(r.lastActiveAt, nowMs)) return true;
  return idleDays(r.lastActiveAt, nowMs) >= longIdleDays;
}

/**
 * Decide whether to show a system notification (R12).
 * Does not perform I/O — unit-testable.
 */
export function evaluateProactiveNotification(
  openRecords: TabRecord[],
  cfg: Config,
  lastNotificationAt: number | null,
  nowMs: number = Date.now(),
): NotifyDecision {
  const open = openRecords.filter((r) => r.isOpen);
  const openCount = open.length;

  if (!cfg.notificationsEnabled) {
    return {
      shouldNotify: false,
      openCount,
      longIdleCount: 0,
      sharePercent: 0,
      reason: "disabled",
    };
  }

  if (openCount < cfg.notifyMinOpenTabs) {
    return {
      shouldNotify: false,
      openCount,
      longIdleCount: 0,
      sharePercent: 0,
      reason: "too_few_tabs",
    };
  }

  const longIdleCount = open.filter((r) =>
    isLongIdleForNotify(r, cfg.notifyLongIdleDays, nowMs),
  ).length;
  const sharePercent = (longIdleCount / openCount) * 100;

  if (sharePercent < cfg.notifySharePercent) {
    return {
      shouldNotify: false,
      openCount,
      longIdleCount,
      sharePercent,
      reason: "share_too_low",
    };
  }

  if (lastNotificationAt != null) {
    const elapsed = nowMs - lastNotificationAt;
    if (elapsed < cfg.notifyCooldownDays * MS_PER_DAY) {
      return {
        shouldNotify: false,
        openCount,
        longIdleCount,
        sharePercent,
        reason: "cooldown",
      };
    }
  }

  return {
    shouldNotify: true,
    openCount,
    longIdleCount,
    sharePercent,
    reason: "ok",
  };
}

export function notificationMessage(
  decision: NotifyDecision,
  longIdleDays: number,
): string {
  return `${decision.longIdleCount} of ${decision.openCount} open tabs are idle ≥ ${longIdleDays} days. Open the report to clean up.`;
}
