import { describe, expect, it } from "vitest";
import {
  bulkEligibleRows,
  categoryIsEmpty,
  countByCategory,
  filterByCategory,
  othersBulkRows,
  resolveByKeys,
  selectedBulkRows,
} from "../src/lib/report-view";
import type { StaleItem } from "../src/types";

function item(
  partial: Partial<StaleItem> & Pick<StaleItem, "key">,
): StaleItem {
  return {
    tabId: 1,
    windowId: 1,
    index: 0,
    url: "https://example.com/",
    title: "Ex",
    pinned: false,
    discarded: false,
    firstOpenedAt: 1,
    lastActiveAt: 1,
    lastSeenAt: 1,
    isOpen: true,
    idleDays: 10,
    wayTooOld: false,
    ...partial,
  };
}

describe("filterByCategory (R11)", () => {
  const rows = [
    item({ key: "s1", wayTooOld: false, idleDays: 12 }),
    item({ key: "u1", wayTooOld: true, idleDays: 3650 }),
    item({ key: "s2", wayTooOld: false, idleDays: 8 }),
  ];

  it("all returns everything", () => {
    expect(filterByCategory(rows, "all")).toHaveLength(3);
  });

  it("stale excludes wayTooOld", () => {
    expect(filterByCategory(rows, "stale").map((r) => r.key)).toEqual([
      "s1",
      "s2",
    ]);
  });

  it("unknown only wayTooOld", () => {
    expect(filterByCategory(rows, "unknown").map((r) => r.key)).toEqual(["u1"]);
  });
});

describe("categoryIsEmpty (R11 auto-clear)", () => {
  it("true when filtered category has no rows", () => {
    const onlyStale = [item({ key: "s", wayTooOld: false })];
    expect(categoryIsEmpty(onlyStale, "unknown")).toBe(true);
    expect(categoryIsEmpty(onlyStale, "stale")).toBe(false);
    expect(categoryIsEmpty(onlyStale, "all")).toBe(false);
  });
});

describe("bulkEligibleRows / selection (R9)", () => {
  const rows = [
    item({ key: "s1", tabId: 10, wayTooOld: false, url: "https://a.com/" }),
    item({ key: "u1", tabId: 11, wayTooOld: true, url: "https://b.com/" }),
    item({
      key: "internal",
      tabId: 12,
      wayTooOld: false,
      url: "chrome://settings",
    }),
    item({ key: "s2", tabId: 13, wayTooOld: false, url: "https://c.com/" }),
  ];

  it("includes unknown (wayTooOld) closable tabs in bulk eligibility", () => {
    const elig = bulkEligibleRows(rows, "all");
    expect(elig.map((r) => r.key).sort()).toEqual(["s1", "s2", "u1"]);
  });

  it("excludes internal pages", () => {
    const elig = bulkEligibleRows(rows, "all");
    expect(elig.some((r) => r.key === "internal")).toBe(false);
  });

  it("works under unknown filter", () => {
    expect(bulkEligibleRows(rows, "unknown").map((r) => r.key)).toEqual(["u1"]);
  });

  it("selected / others partition", () => {
    const elig = bulkEligibleRows(rows, "all");
    const selected = new Set(["s1", "u1"]);
    expect(selectedBulkRows(elig, selected).map((r) => r.key).sort()).toEqual([
      "s1",
      "u1",
    ]);
    expect(othersBulkRows(elig, selected).map((r) => r.key)).toEqual(["s2"]);
  });

  it("resolveByKeys maps selection to current tabIds", () => {
    const selected = new Set(["s1", "u1"]);
    const resolved = resolveByKeys(rows, selected);
    expect(resolved.map((r) => r.tabId).sort((a, b) => a - b)).toEqual([10, 11]);
  });
});

describe("countByCategory", () => {
  it("counts stale vs unknown", () => {
    const rows = [
      item({ key: "a", wayTooOld: false }),
      item({ key: "b", wayTooOld: true }),
      item({ key: "c", wayTooOld: true }),
    ];
    expect(countByCategory(rows)).toEqual({ stale: 1, unknown: 2, all: 3 });
  });
});
