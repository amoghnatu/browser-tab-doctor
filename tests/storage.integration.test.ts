/**
 * Integration tests against an in-memory browser.storage mock (R1–R8 plumbing).
 */
import { beforeEach, describe, expect, it } from "vitest";
import * as storage from "../src/lib/storage";
import { DEFAULT_CONFIG, type TabRecord } from "../src/types";
import { computeStalenessFromRecords } from "../src/lib/staleness";
import { MS_PER_DAY } from "../src/lib/date";
import { buildSnapshot, shouldGenerateDailyReport } from "../src/lib/snapshot";
import { localDateKey, localHour } from "../src/lib/date";

function createMemoryArea() {
  const data = new Map<string, unknown>();
  return {
    async get(keys: string | string[] | null | Record<string, unknown> | undefined) {
      if (keys == null) {
        const out: Record<string, unknown> = {};
        for (const [k, v] of data) out[k] = v;
        return out;
      }
      if (typeof keys === "string") {
        return keys in Object.fromEntries(data) || data.has(keys)
          ? { [keys]: data.get(keys) }
          : {};
      }
      if (Array.isArray(keys)) {
        const out: Record<string, unknown> = {};
        for (const k of keys) if (data.has(k)) out[k] = data.get(k);
        return out;
      }
      // defaults object
      const out: Record<string, unknown> = { ...keys };
      for (const k of Object.keys(keys)) {
        if (data.has(k)) out[k] = data.get(k);
      }
      return out;
    },
    async set(items: Record<string, unknown>) {
      for (const [k, v] of Object.entries(items)) data.set(k, v);
    },
    async remove(keys: string | string[]) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) data.delete(k);
    },
    async clear() {
      data.clear();
    },
    _data: data,
  };
}

describe("storage layer integration", () => {
  let local: ReturnType<typeof createMemoryArea>;
  let session: ReturnType<typeof createMemoryArea>;

  beforeEach(async () => {
    local = createMemoryArea();
    session = createMemoryArea();
    storage.initStorage({
      local: local as never,
      session: session as never,
      sync: null,
    });
    await storage.migrateIfNeeded();
  });

  it("returns default config after migrate", async () => {
    const cfg = await storage.getConfig();
    expect(cfg.thresholdDays).toBe(7);
    expect(cfg.schemaVersion).toBe(1);
  });

  it("persists and loads tab records", async () => {
    const rec: TabRecord = {
      key: "k1",
      tabId: 10,
      windowId: 1,
      index: 0,
      url: "https://a.com/",
      title: "A",
      pinned: false,
      discarded: false,
      firstOpenedAt: 1,
      lastActiveAt: 2,
      lastSeenAt: 3,
      isOpen: true,
    };
    await storage.upsertTabRecord(rec);
    const all = await storage.getAllTabRecords();
    expect(all).toHaveLength(1);
    expect(all[0]!.key).toBe("k1");
  });

  it("session map tabId → key", async () => {
    await storage.mapSet(5, "stable-key");
    expect(await storage.mapGet(5)).toBe("stable-key");
    await storage.mapDelete(5);
    expect(await storage.mapGet(5)).toBeUndefined();
  });

  it("setConfig validates and updates", async () => {
    const next = await storage.setConfig({ thresholdDays: 14 });
    expect(next.thresholdDays).toBe(14);
    expect((await storage.getConfig()).thresholdDays).toBe(14);
  });

  it("rejects invalid config", async () => {
    await expect(storage.setConfig({ thresholdDays: 0 })).rejects.toThrow();
  });

  it("put/get snapshot and prune retention", async () => {
    for (let d = 1; d <= 5; d++) {
      const dateKey = `2026-01-0${d}`;
      await storage.putSnapshot({
        dateKey,
        generatedAt: d,
        totalTabs: 1,
        staleTabs: 0,
        items: [],
        trigger: "scheduled",
      });
    }
    await storage.pruneSnapshots(2);
    const keys = await storage.listSnapshotKeys();
    expect(keys).toHaveLength(2);
    expect(keys.sort().reverse().slice(0, 2)).toEqual([
      "report:2026-01-05",
      "report:2026-01-04",
    ]);
  });

  it("end-to-end: tabs → staleness → snapshot → badge text inputs", async () => {
    const now = Date.now();
    await storage.upsertTabRecord({
      key: "stale",
      tabId: 1,
      windowId: 1,
      index: 0,
      url: "https://old.com/",
      title: "Old",
      pinned: false,
      discarded: false,
      firstOpenedAt: now - 30 * MS_PER_DAY,
      lastActiveAt: now - 10 * MS_PER_DAY,
      lastSeenAt: now,
      isOpen: true,
    });
    await storage.upsertTabRecord({
      key: "fresh",
      tabId: 2,
      windowId: 1,
      index: 1,
      url: "https://new.com/",
      title: "New",
      pinned: false,
      discarded: false,
      firstOpenedAt: now,
      lastActiveAt: now,
      lastSeenAt: now,
      isOpen: true,
    });

    const cfg = await storage.getConfig();
    const open = (await storage.getAllTabRecords()).filter((r) => r.isOpen);
    const staleness = computeStalenessFromRecords(open, cfg, now);
    expect(staleness.staleCount).toBe(1);
    expect(staleness.totalOpen).toBe(2);

    const today = localDateKey(now);
    const hour = localHour(now);
    const should = shouldGenerateDailyReport(null, today, hour, cfg.reportHour);
    // May or may not be past reportHour depending on wall clock — both branches OK
    if (should) {
      const snap = buildSnapshot("scheduled", cfg, staleness.stale, staleness.totalOpen, now);
      await storage.putSnapshot(snap);
      const loaded = await storage.getSnapshot(today);
      expect(loaded?.staleTabs).toBe(1);
      expect(loaded?.trigger).toBe("scheduled");
    }

    const onDemand = buildSnapshot("on-demand", cfg, staleness.stale, staleness.totalOpen, now);
    expect(onDemand.trigger).toBe("on-demand");
    expect(onDemand.items[0]!.title).toBe("Old");
  });
});
