import { describe, expect, it } from "vitest";
import {
  buildSnapshot,
  shouldGenerateDailyReport,
  snapshotKeysToPrune,
} from "../src/lib/snapshot";
import { DEFAULT_CONFIG, type StaleItem } from "../src/types";

describe("shouldGenerateDailyReport (R8)", () => {
  it("skips when today's snapshot already exists", () => {
    expect(shouldGenerateDailyReport("2026-07-11", "2026-07-11", 10, 9)).toBe(false);
  });

  it("skips before reportHour", () => {
    expect(shouldGenerateDailyReport(null, "2026-07-11", 8, 9)).toBe(false);
  });

  it("generates at/after reportHour when missing", () => {
    expect(shouldGenerateDailyReport(null, "2026-07-11", 9, 9)).toBe(true);
    expect(shouldGenerateDailyReport(undefined, "2026-07-11", 15, 9)).toBe(true);
  });

  it("generates when existing is a different day", () => {
    expect(shouldGenerateDailyReport("2026-07-10", "2026-07-11", 10, 9)).toBe(true);
  });
});

describe("snapshotKeysToPrune", () => {
  it("keeps newest N keys", () => {
    const keys = [
      "report:2026-01-01",
      "report:2026-01-03",
      "report:2026-01-02",
      "report:2026-01-04",
    ];
    const prune = snapshotKeysToPrune(keys, 2);
    expect(prune.sort()).toEqual(["report:2026-01-01", "report:2026-01-02"]);
  });

  it("prunes nothing when under limit", () => {
    expect(snapshotKeysToPrune(["report:2026-01-01"], 90)).toEqual([]);
  });
});

describe("buildSnapshot", () => {
  it("freezes stale items and sets trigger", () => {
    const stale: StaleItem[] = [
      {
        key: "k",
        tabId: 1,
        windowId: 1,
        index: 0,
        url: "https://example.com/very/long/path/that/might/be/truncated?q=1",
        title: "Ex",
        pinned: false,
        discarded: false,
        firstOpenedAt: 1,
        lastActiveAt: 2,
        lastSeenAt: 3,
        isOpen: true,
        idleDays: 10,
        wayTooOld: false,
      },
    ];
    const cfg = {
      ...DEFAULT_CONFIG,
      privacy: { truncateUrls: true, storeQueryStrings: true },
    };
    const snap = buildSnapshot("scheduled", cfg, stale, 5, Date.UTC(2026, 6, 11, 12));
    expect(snap.trigger).toBe("scheduled");
    expect(snap.staleTabs).toBe(1);
    expect(snap.totalTabs).toBe(5);
    expect(snap.items[0]!.idleDays).toBe(10);
    expect(snap.items[0]!.url.length).toBeLessThanOrEqual(48);
    expect(snap.dateKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("on-demand trigger does not change shape", () => {
    const snap = buildSnapshot("on-demand", DEFAULT_CONFIG, [], 0, 1);
    expect(snap.trigger).toBe("on-demand");
    expect(snap.items).toEqual([]);
  });
});
