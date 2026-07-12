import { describe, expect, it } from "vitest";
import { findBestMatch, reconcileTabs, type LiveTab } from "../src/lib/reconcile";
import { DEFAULT_CONFIG, type TabRecord } from "../src/types";

function record(partial: Partial<TabRecord> & Pick<TabRecord, "key" | "url">): TabRecord {
  return {
    tabId: 1,
    windowId: 1,
    index: 0,
    title: "t",
    pinned: false,
    discarded: false,
    firstOpenedAt: 1000,
    lastActiveAt: 1000,
    lastSeenAt: 1000,
    isOpen: true,
    ...partial,
  };
}

describe("findBestMatch (R3 carry-forward)", () => {
  const cfg = DEFAULT_CONFIG;
  const used = new Set<string>();

  it("matches by URL preferring closest index", () => {
    const open = [
      record({ key: "a", url: "https://a.com/", index: 0 }),
      record({ key: "b", url: "https://a.com/", index: 5 }),
    ];
    const tab: LiveTab = { id: 99, index: 4, url: "https://a.com/", title: "x" };
    const m = findBestMatch(tab, open, used, cfg);
    expect(m?.key).toBe("b");
  });

  it("falls back to title when URL differs", () => {
    const open = [record({ key: "a", url: "https://old.com/", title: "Docs", index: 2 })];
    const tab: LiveTab = { id: 1, index: 2, url: "https://new.com/", title: "Docs" };
    const m = findBestMatch(tab, open, used, cfg);
    expect(m?.key).toBe("a");
  });

  it("returns null when no match", () => {
    const open = [record({ key: "a", url: "https://a.com/", title: "A" })];
    const tab: LiveTab = { id: 1, index: 0, url: "https://b.com/", title: "B" };
    expect(findBestMatch(tab, open, used, cfg)).toBeNull();
  });

  it("skips already-used keys", () => {
    const open = [record({ key: "a", url: "https://a.com/" })];
    const used2 = new Set(["a"]);
    const tab: LiveTab = { id: 1, index: 0, url: "https://a.com/" };
    expect(findBestMatch(tab, open, used2, cfg)).toBeNull();
  });
});

describe("reconcileTabs (R1/R3)", () => {
  const cfg = DEFAULT_CONFIG;
  let uuid = 0;
  const uuidFn = () => `uuid-${++uuid}`;

  it("carries forward firstOpenedAt for matched tabs", () => {
    uuid = 0;
    const first = Date.UTC(2026, 0, 1);
    const prev = Date.UTC(2026, 1, 1);
    const accessed = Date.UTC(2026, 2, 1);
    const now = Date.UTC(2026, 6, 11);
    const open = [
      record({
        key: "stable",
        url: "https://example.com/",
        title: "Ex",
        index: 0,
        firstOpenedAt: first,
        lastActiveAt: prev,
      }),
    ];
    const live: LiveTab[] = [
      {
        id: 42,
        windowId: 1,
        index: 0,
        url: "https://example.com/",
        title: "Ex",
        lastAccessed: accessed,
      },
    ];
    const result = reconcileTabs(live, open, cfg, uuidFn, now);
    const matched = result.records.find((r) => r.key === "stable");
    expect(matched).toBeDefined();
    expect(matched!.firstOpenedAt).toBe(first);
    expect(matched!.tabId).toBe(42);
    expect(matched!.lastActiveAt).toBe(accessed); // max with lastAccessed
    expect(result.tabIdToKey[42]).toBe("stable");
  });

  it("creates new records for unmatched live tabs", () => {
    uuid = 0;
    const accessed = Date.UTC(2026, 5, 1);
    const now = Date.UTC(2026, 6, 11);
    const live: LiveTab[] = [
      { id: 7, windowId: 1, index: 0, url: "https://new.com/", title: "New", lastAccessed: accessed },
    ];
    const result = reconcileTabs(live, [], cfg, uuidFn, now);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]!.key).toBe("uuid-1");
    expect(result.records[0]!.firstOpenedAt).toBe(accessed);
    expect(result.records[0]!.isOpen).toBe(true);
  });

  it("marks missing open records as closed", () => {
    uuid = 0;
    const open = [record({ key: "gone", url: "https://gone.com/", isOpen: true })];
    const result = reconcileTabs([], open, cfg, uuidFn, 3000);
    expect(result.closedKeys).toEqual(["gone"]);
    expect(result.records.find((r) => r.key === "gone")!.isOpen).toBe(false);
  });

  it("bootstraps lastActiveAt from lastAccessed", () => {
    uuid = 0;
    const live: LiveTab[] = [
      { id: 1, index: 0, url: "https://x.com/", lastAccessed: Date.UTC(2026, 5, 1) },
    ];
    const now = Date.UTC(2026, 6, 11);
    const result = reconcileTabs(live, [], cfg, uuidFn, now);
    expect(result.records[0]!.lastActiveAt).toBe(Date.UTC(2026, 5, 1));
  });

  it("ignores lastAccessed: 0 — leaves open/active unknown (not today)", () => {
    uuid = 0;
    const now = Date.UTC(2026, 6, 11, 12);
    const live: LiveTab[] = [
      { id: 1, index: 0, url: "https://zero.com/", title: "Z", lastAccessed: 0 },
    ];
    const result = reconcileTabs(live, [], cfg, uuidFn, now);
    expect(result.records[0]!.lastActiveAt).toBeNull();
    // 0 = unknown sentinel (formatDate → "—"); do not invent "opened today"
    expect(result.records[0]!.firstOpenedAt).toBe(0);
  });

  it("clears stored epoch-zero lastActive; does not invent firstOpened = now", () => {
    uuid = 0;
    const now = Date.UTC(2026, 6, 11, 12);
    const open = [
      record({
        key: "bad",
        url: "https://a.com/",
        title: "A",
        firstOpenedAt: 0,
        lastActiveAt: 0,
      }),
    ];
    const live: LiveTab[] = [
      { id: 9, index: 0, url: "https://a.com/", title: "A", lastAccessed: 0 },
    ];
    const result = reconcileTabs(live, open, cfg, uuidFn, now);
    const r = result.records.find((x) => x.key === "bad")!;
    expect(r.firstOpenedAt).toBe(0);
    expect(r.lastActiveAt).toBeNull();
  });

  it("does not overwrite a real firstOpenedAt with now when lastAccessed is 0", () => {
    uuid = 0;
    const now = Date.UTC(2026, 6, 11, 12);
    const realFirst = Date.UTC(2026, 0, 15);
    const open = [
      record({
        key: "kept",
        url: "https://a.com/",
        title: "A",
        firstOpenedAt: realFirst,
        lastActiveAt: 0,
      }),
    ];
    const live: LiveTab[] = [
      { id: 9, index: 0, url: "https://a.com/", title: "A", lastAccessed: 0 },
    ];
    const result = reconcileTabs(live, open, cfg, uuidFn, now);
    const r = result.records.find((x) => x.key === "kept")!;
    expect(r.firstOpenedAt).toBe(realFirst);
    expect(r.lastActiveAt).toBeNull();
  });
});
