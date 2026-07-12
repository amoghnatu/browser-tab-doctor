/**
 * Pure helpers for report filtering, selection, and bulk targets (R9 / R11).
 *
 * R6 only means unknown last-used tabs are not auto-flagged on the *badge*.
 * They are still closable and participate in bulk close when the user asks.
 */
import type { StaleItem } from "../types";
import { isClosable } from "./url";

/** Category filter for the report table (R11). */
export type CategoryFilter = "all" | "stale" | "unknown";

/** Rows visible under the current category filter. */
export function filterByCategory(
  items: StaleItem[],
  filter: CategoryFilter,
): StaleItem[] {
  switch (filter) {
    case "stale":
      return items.filter((r) => !r.wayTooOld);
    case "unknown":
      return items.filter((r) => r.wayTooOld);
    case "all":
    default:
      return [...items];
  }
}

/** True when the filtered category has zero rows (R11 auto-clear). */
export function categoryIsEmpty(
  items: StaleItem[],
  filter: CategoryFilter,
): boolean {
  if (filter === "all") return false;
  return filterByCategory(items, filter).length === 0;
}

/**
 * Closable rows eligible for bulk actions among the currently visible set.
 * Includes both real-stale and unknown/way-too-old (user can bulk-close either).
 * Excludes browser-internal pages the API cannot close.
 */
export function bulkEligibleRows(
  allItems: StaleItem[],
  filter: CategoryFilter,
): StaleItem[] {
  const visible = filterByCategory(allItems, filter);
  return visible.filter((r) => isClosable(r.url) && r.tabId > 0);
}

/** Closable visible rows that are checked (by stable key). */
export function selectedBulkRows(
  eligible: StaleItem[],
  selectedKeys: ReadonlySet<string>,
): StaleItem[] {
  return eligible.filter((r) => selectedKeys.has(r.key));
}

/** Closable eligible rows that are *not* checked. */
export function othersBulkRows(
  eligible: StaleItem[],
  selectedKeys: ReadonlySet<string>,
): StaleItem[] {
  return eligible.filter((r) => !selectedKeys.has(r.key));
}

/**
 * Resolve selected keys → current rows from a fresh list (by key).
 * Prefer this at click time so we never close a stale tabId after re-render.
 */
export function resolveByKeys(
  items: StaleItem[],
  keys: ReadonlySet<string>,
): StaleItem[] {
  if (keys.size === 0) return [];
  return items.filter(
    (r) => keys.has(r.key) && isClosable(r.url) && r.tabId > 0,
  );
}

export function countByCategory(items: StaleItem[]): {
  stale: number;
  unknown: number;
  all: number;
} {
  let stale = 0;
  let unknown = 0;
  for (const r of items) {
    if (r.wayTooOld) unknown++;
    else stale++;
  }
  return { stale, unknown, all: items.length };
}
