import { describe, expect, it } from "vitest";
import {
  dedupeOpenByTabId,
  findBestMatch,
  projectOpenFromTabIdMap,
  reconcileTabs,
  type LiveTab,
} from "../src/lib/reconcile";
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

  it("matches by tabId first (extension reload / same session)", () => {
    const open = [
      record({ key: "old-url", tabId: 5, url: "https://old.com/", index: 0 }),
      record({ key: "other", tabId: 9, url: "https://new.com/", index: 0 }),
    ];
    const tab: LiveTab = { id: 5, index: 0, url: "https://new.com/", title: "x" };
    const m = findBestMatch(tab, open, used, cfg);
    expect(m?.key).toBe("old-url");
  });

  it("matches by URL preferring closest index", () => {
    const open = [
      record({ key: "a", tabId: 1, url: "https://a.com/", index: 0 }),
      record({ key: "b", tabId: 2, url: "https://a.com/", index: 5 }),
    ];
    const tab: LiveTab = { id: 99, index: 4, url: "https://a.com/", title: "x" };
    const m = findBestMatch(tab, open, used, cfg);
    expect(m?.key).toBe("b");
  });

  it("falls back to title when URL differs and tabId unknown", () => {
    const open = [
      record({ key: "a", tabId: 1, url: "https://old.com/", title: "Docs", index: 2 }),
    ];
    const tab: LiveTab = { id: 99, index: 2, url: "https://new.com/", title: "Docs" };
    const m = findBestMatch(tab, open, used, cfg);
    expect(m?.key).toBe("a");
  });

  it("returns null when no match", () => {
    const open = [record({ key: "a", tabId: 1, url: "https://a.com/", title: "A" })];
    const tab: LiveTab = { id: 99, index: 0, url: "https://b.com/", title: "B" };
    expect(findBestMatch(tab, open, used, cfg)).toBeNull();
  });

  it("skips already-used keys", () => {
    const open = [record({ key: "a", url: "https://a.com/" })];
    const used2 = new Set(["a"]);
    const tab: LiveTab = { id: 1, index: 0, url: "https://a.com/" };
    expect(findBestMatch(tab, open, used2, cfg)).toBeNull();
  });

  it("does not mass-match on empty URL", () => {
    const open = [record({ key: "a", tabId: 1, url: "", title: "" })];
    const tab: LiveTab = { id: 2, index: 0, url: "", title: "" };
    expect(findBestMatch(tab, open, used, cfg)).toBeNull();
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

  it("prefers tabId match and closes ghost duplicate open rows", () => {
    uuid = 0;
    const now = Date.UTC(2026, 6, 11);
    const open = [
      record({
        key: "real",
        tabId: 10,
        url: "https://x.com/",
        index: 0,
        lastSeenAt: now - 1000,
      }),
      // Ghost: same URL, dead tabId — used to produce "every row duplicated"
      record({
        key: "ghost",
        tabId: 999,
        url: "https://x.com/",
        index: 0,
        lastSeenAt: now,
      }),
    ];
    const live: LiveTab[] = [
      { id: 10, index: 0, url: "https://x.com/", title: "X", lastAccessed: now },
    ];
    const result = reconcileTabs(live, open, cfg, uuidFn, now);
    const stillOpen = result.records.filter((r) => r.isOpen);
    expect(stillOpen).toHaveLength(1);
    expect(stillOpen[0]!.key).toBe("real");
    expect(stillOpen[0]!.tabId).toBe(10);
    expect(result.closedKeys).toContain("ghost");
  });

  it("does not create a second open record when tabId already known", () => {
    uuid = 0;
    const now = Date.UTC(2026, 6, 11);
    const open = [
      record({
        key: "stable",
        tabId: 3,
        url: "https://a.com/",
        firstOpenedAt: Date.UTC(2026, 0, 1),
      }),
    ];
    const live: LiveTab[] = [
      { id: 3, index: 1, url: "https://a.com/path", title: "A", lastAccessed: now },
    ];
    const result = reconcileTabs(live, open, cfg, uuidFn, now);
    expect(result.records.filter((r) => r.isOpen)).toHaveLength(1);
    expect(result.records.find((r) => r.isOpen)!.key).toBe("stable");
    expect(uuid).toBe(0); // no new UUID allocated
  });

  it("collapses two open records that share the same live tabId", () => {
    uuid = 0;
    const now = Date.UTC(2026, 6, 11);
    // Simulate corrupt inventory: two open rows, one live tab
    const open = [
      record({ key: "a", tabId: 7, url: "https://dup.com/", lastSeenAt: now - 10 }),
      record({ key: "b", tabId: 7, url: "https://dup.com/", lastSeenAt: now }),
    ];
    const live: LiveTab[] = [
      { id: 7, index: 0, url: "https://dup.com/", lastAccessed: now },
    ];
    const result = reconcileTabs(live, open, cfg, uuidFn, now);
    const stillOpen = result.records.filter((r) => r.isOpen);
    expect(stillOpen).toHaveLength(1);
    expect(stillOpen[0]!.tabId).toBe(7);
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

describe("dedupeOpenByTabId", () => {
  it("keeps one record per tabId and drops tabId<=0", () => {
    const open = [
      record({ key: "a", tabId: 1, url: "https://a.com/", lastSeenAt: 1 }),
      record({ key: "b", tabId: 1, url: "https://a.com/", lastSeenAt: 9 }),
      record({ key: "c", tabId: -1, url: "https://c.com/", lastSeenAt: 5 }),
      record({ key: "d", tabId: 2, url: "https://d.com/", lastSeenAt: 3 }),
    ];
    const d = dedupeOpenByTabId(open);
    expect(d).toHaveLength(2);
    expect(d.find((r) => r.tabId === 1)?.key).toBe("b");
    expect(d.find((r) => r.tabId === 2)?.key).toBe("d");
  });
});

describe("projectOpenFromTabIdMap", () => {
  it("forces open set to exactly the live tabId→key map (kills doubled inventory)", () => {
    const now = 1000;
    const records = [
      record({ key: "keep", tabId: 1, url: "https://a.com/", isOpen: true }),
      record({ key: "ghost", tabId: 2, url: "https://a.com/", isOpen: true }),
      record({ key: "other", tabId: 3, url: "https://b.com/", isOpen: true }),
    ];
    // Only two live tabs mapped
    const map = { 1: "keep", 3: "other" };
    const { open, all } = projectOpenFromTabIdMap(records, map, now);
    expect(open).toHaveLength(2);
    expect(open.map((r) => r.key).sort()).toEqual(["keep", "other"]);
    expect(all.find((r) => r.key === "ghost")!.isOpen).toBe(false);
    expect(open.every((r) => r.isOpen)).toBe(true);
  });
});
