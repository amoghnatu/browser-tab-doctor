/** Local-calendar date helpers (R8). No UTC day boundaries. */

const MS_PER_DAY = 86_400_000;

/**
 * Earliest timestamp we accept from the browser.
 * Chromium sometimes reports `lastAccessed: 0` for restored/untracked tabs;
 * that must not be treated as "Dec 31, 1969" / ~20k idle days.
 * Floor is 2000-01-01 UTC — well before WebExtensions and any real tab history.
 */
export const MIN_VALID_TIMESTAMP_MS = Date.UTC(2000, 0, 1);

/** Whole days far enough in the future to reject clock-skew garbage. */
const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

/**
 * True when `ms` is a usable epoch-ms timestamp (not null/0/NaN/absurd).
 * `0` is invalid: `??` and `!= null` still accept it, which caused epoch-zero bugs.
 */
export function isValidTimestamp(
  ms: number | null | undefined,
  nowMs: number = Date.now(),
): ms is number {
  if (ms == null || !Number.isFinite(ms)) return false;
  if (ms < MIN_VALID_TIMESTAMP_MS) return false;
  if (ms > nowMs + MAX_FUTURE_SKEW_MS) return false;
  return true;
}

/**
 * Coerce a raw browser timestamp to a valid number, or `null` if unusable.
 * Prefer this over `value ?? fallback` — `0` must not win over a real seed.
 */
export function coerceTimestamp(
  ms: number | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  return isValidTimestamp(ms, nowMs) ? ms : null;
}

/** Local calendar day as `YYYY-MM-DD`. */
export function localDateKey(epochMs: number = Date.now()): string {
  const d = new Date(epochMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Local hour of day (0–23). */
export function localHour(epochMs: number = Date.now()): number {
  return new Date(epochMs).getHours();
}

/** Whole idle days between lastActiveAt and now (floor). */
export function idleDays(lastActiveAt: number, nowMs: number = Date.now()): number {
  return Math.floor((nowMs - lastActiveAt) / MS_PER_DAY);
}

/**
 * Idle so large it is almost certainly corrupt / epoch-zero (~20646d).
 * Report shows "way too old" instead of a raw day count.
 */
export const WAY_TOO_OLD_IDLE_DAYS = 3650; // ≥ ~10 years

export function isWayTooOldIdle(idleDayCount: number): boolean {
  return Number.isFinite(idleDayCount) && idleDayCount >= WAY_TOO_OLD_IDLE_DAYS;
}

export { MS_PER_DAY };

/** Format epoch ms as a short localized date for tables. */
export function formatDate(epochMs: number | null | undefined): string {
  if (!isValidTimestamp(epochMs)) return "—";
  return new Date(epochMs).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** ISO-ish absolute timestamp for tooltips. */
export function formatTimestamp(epochMs: number | null | undefined): string {
  if (!isValidTimestamp(epochMs)) return "";
  return new Date(epochMs).toLocaleString();
}
