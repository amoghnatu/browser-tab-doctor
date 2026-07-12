import { describe, expect, it } from "vitest";
import {
  coerceTimestamp,
  formatDate,
  idleDays,
  isValidTimestamp,
  isWayTooOldIdle,
  localDateKey,
  localHour,
  MS_PER_DAY,
  WAY_TOO_OLD_IDLE_DAYS,
} from "../src/lib/date";

describe("localDateKey", () => {
  it("formats local YYYY-MM-DD", () => {
    // Construct a local noon to avoid TZ edge cases around midnight
    const d = new Date(2026, 6, 11, 12, 0, 0); // July 11, 2026 local
    expect(localDateKey(d.getTime())).toBe("2026-07-11");
  });

  it("pads month and day", () => {
    const d = new Date(2026, 0, 5, 15, 0, 0); // Jan 5
    expect(localDateKey(d.getTime())).toBe("2026-01-05");
  });

  it("maps DST transition days to a single key", () => {
    // Any valid local timestamp still produces one dateKey string
    const morning = new Date(2026, 2, 8, 1, 30, 0); // roughly around US DST in March
    const evening = new Date(2026, 2, 8, 23, 0, 0);
    expect(localDateKey(morning.getTime())).toBe(localDateKey(evening.getTime()));
  });
});

describe("localHour", () => {
  it("returns 0–23 local hour", () => {
    const d = new Date(2026, 0, 1, 9, 30, 0);
    expect(localHour(d.getTime())).toBe(9);
  });
});

describe("idleDays", () => {
  it("floors whole days", () => {
    const now = Date.UTC(2026, 0, 10, 12);
    const last = now - 7 * MS_PER_DAY - 1000;
    expect(idleDays(last, now)).toBe(7);
  });

  it("returns 0 for same day", () => {
    const now = Date.UTC(2026, 0, 10, 12);
    const last = now - 3 * 60 * 60 * 1000;
    expect(idleDays(last, now)).toBe(0);
  });

  it("returns 6 for just under 7 days", () => {
    const now = Date.UTC(2026, 0, 10, 12);
    const last = now - 7 * MS_PER_DAY + 1;
    expect(idleDays(last, now)).toBe(6);
  });
});

describe("isValidTimestamp / coerceTimestamp (epoch-zero guard)", () => {
  const now = Date.UTC(2026, 6, 11, 12);

  it("rejects null, undefined, NaN", () => {
    expect(isValidTimestamp(null, now)).toBe(false);
    expect(isValidTimestamp(undefined, now)).toBe(false);
    expect(isValidTimestamp(Number.NaN, now)).toBe(false);
  });

  it("rejects epoch 0 (Chromium lastAccessed sentinel)", () => {
    // Sample report showed Dec 31, 1969 / 20646d from lastAccessed: 0
    expect(isValidTimestamp(0, now)).toBe(false);
    expect(coerceTimestamp(0, now)).toBeNull();
  });

  it("rejects pre-2000 timestamps", () => {
    expect(isValidTimestamp(Date.UTC(1999, 11, 31), now)).toBe(false);
  });

  it("accepts realistic lastAccessed values", () => {
    const t = Date.UTC(2026, 5, 11, 13, 21, 56);
    expect(isValidTimestamp(t, now)).toBe(true);
    expect(coerceTimestamp(t, now)).toBe(t);
  });

  it("formatDate shows em dash for epoch 0, not Dec 1969", () => {
    expect(formatDate(0)).toBe("—");
    expect(formatDate(null)).toBe("—");
  });
});

describe("isWayTooOldIdle", () => {
  it("flags ~20646d epoch-style idle as way too old", () => {
    expect(isWayTooOldIdle(20646)).toBe(true);
    expect(isWayTooOldIdle(WAY_TOO_OLD_IDLE_DAYS)).toBe(true);
  });

  it("does not flag normal stale idle (days–months)", () => {
    expect(isWayTooOldIdle(7)).toBe(false);
    expect(isWayTooOldIdle(30)).toBe(false);
    expect(isWayTooOldIdle(3649)).toBe(false);
  });
});
