import { describe, expect, it } from "vitest";
import { badgeTextForCount, computeStalenessFromRecords, countByWindow } from "../src/lib/staleness";
import { DEFAULT_CONFIG, type TabRecord } from "../src/types";
import { MS_PER_DAY } from "../src/lib/date";

function tab(partial: Partial<TabRecord> & Pick<TabRecord, "key">): TabRecord {
  return {
    tabId: 1,
    windowId: 1,
    index: 0,
    url: "https://example.com",
    title: "Example",
    pinned: false,
    discarded: false,
    firstOpenedAt: Date.UTC(2026, 0, 1),
    lastActiveAt: Date.UTC(2026, 0, 1),
    lastSeenAt: Date.UTC(2026, 0, 1),
    isOpen: true,
    ...partial,
  };
}

describe("computeStalenessFromRecords (R4/R5/R6)", () => {
  const now = Date.UTC(2026, 6, 11, 12);
  const cfg = { ...DEFAULT_CONFIG, thresholdDays: 7 };

  it("flags tabs idle >= thresholdDays", () => {
    const records = [
      tab({ key: "a", lastActiveAt: now - 8 * MS_PER_DAY, title: "Old" }),
      tab({ key: "b", lastActiveAt: now - 3 * MS_PER_DAY, title: "Fresh" }),
      tab({ key: "c", lastActiveAt: now - 7 * MS_PER_DAY, title: "Edge" }),
    ];
    const s = computeStalenessFromRecords(records, cfg, now);
    expect(s.staleCount).toBe(2);
    expect(s.totalOpen).toBe(3);
    expect(s.stale.filter((x) => !x.wayTooOld).map((x) => x.key).sort()).toEqual(["a", "c"]);
  });

  it("puts unknown lastActiveAt in the same table as wayTooOld, not badge (R6)", () => {
    const records = [
      tab({ key: "u", lastActiveAt: null }),
      tab({ key: "s", lastActiveAt: now - 30 * MS_PER_DAY }),
    ];
    const s = computeStalenessFromRecords(records, cfg, now);
    expect(s.unknownCount).toBe(1);
    expect(s.staleCount).toBe(1); // badge only
    expect(s.stale).toHaveLength(2); // unified table
    expect(s.stale.find((x) => x.key === "u")!.wayTooOld).toBe(true);
    expect(s.stale.find((x) => x.key === "s")!.wayTooOld).toBe(false);
    // way-too-old rows sort first
    expect(s.stale[0]!.key).toBe("u");
  });

  it("epoch-zero is wayTooOld in the same table (not 20646d badge inflate)", () => {
    const records = [
      tab({ key: "epoch", lastActiveAt: 0, firstOpenedAt: 0 }),
      tab({ key: "real", lastActiveAt: now - 10 * MS_PER_DAY }),
    ];
    const s = computeStalenessFromRecords(records, cfg, now);
    expect(s.unknownCount).toBe(1);
    expect(s.staleCount).toBe(1);
    expect(s.stale).toHaveLength(2);
    const epoch = s.stale.find((x) => x.key === "epoch")!;
    expect(epoch.wayTooOld).toBe(true);
    expect(epoch.idleDays).toBeGreaterThanOrEqual(3650);
    // Badge count excludes epoch
    expect(badgeTextForCount(s.staleCount)).toBe("1");
  });

  it("ignores closed tabs", () => {
    const records = [
      tab({ key: "closed", isOpen: false, lastActiveAt: now - 100 * MS_PER_DAY }),
      tab({ key: "open", lastActiveAt: now }),
    ];
    const s = computeStalenessFromRecords(records, cfg, now);
    expect(s.totalOpen).toBe(1);
    expect(s.staleCount).toBe(0);
    expect(s.stale).toHaveLength(0);
  });

  it("returns empty report rows when all fresh", () => {
    const records = [tab({ key: "a", lastActiveAt: now - MS_PER_DAY })];
    const s = computeStalenessFromRecords(records, cfg, now);
    expect(s.staleCount).toBe(0);
    expect(s.stale).toHaveLength(0);
  });
});

describe("badgeTextForCount (R5/R6)", () => {
  it("clears at zero", () => {
    expect(badgeTextForCount(0)).toBe("");
  });

  it("shows count under 100", () => {
    expect(badgeTextForCount(7)).toBe("7");
    expect(badgeTextForCount(99)).toBe("99");
  });

  it("caps at 99+", () => {
    expect(badgeTextForCount(100)).toBe("99+");
    expect(badgeTextForCount(999)).toBe("99+");
  });
});

describe("countByWindow (R2)", () => {
  it("groups open tabs by windowId", () => {
    const records = [
      tab({ key: "a", windowId: 1 }),
      tab({ key: "b", windowId: 1 }),
      tab({ key: "c", windowId: 2 }),
      tab({ key: "d", windowId: 2, isOpen: false }),
    ];
    expect(countByWindow(records)).toEqual([
      { windowId: 1, count: 2 },
      { windowId: 2, count: 1 },
    ]);
  });
});
