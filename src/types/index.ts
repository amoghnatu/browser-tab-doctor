/** Shared TypeScript types for Browser Tab Doctor (v1). */

export const SCHEMA_VERSION = 1;

export interface PrivacyConfig {
  /** When true, URLs shown in reports are truncated for display. */
  truncateUrls: boolean;
  /** When false, query strings and hashes are stripped before storage/matching. */
  storeQueryStrings: boolean;
}

export interface Config {
  schemaVersion: number;
  /** Idle days before a tab is considered stale. Integer ≥ 1. Default 7. */
  thresholdDays: number;
  /** Local hour (0–23) at/after which the daily report may be generated. Default 9. */
  reportHour: number;
  /** Number of daily ReportSnapshots to retain. Integer ≥ 1. Default 90. */
  retentionSnapshots: number;
  /** Whether the toolbar badge is shown when stale tabs exist. Default true. */
  badgeEnabled: boolean;
  /** Periodic recompute interval in minutes. Must be ≥ 0.5. Default 30. */
  recomputeIntervalMinutes: number;
  privacy: PrivacyConfig;
  /** Gates verbose console logging. Default false. */
  debug: boolean;
}

export const DEFAULT_CONFIG: Config = {
  schemaVersion: SCHEMA_VERSION,
  thresholdDays: 7,
  reportHour: 9,
  retentionSnapshots: 90,
  badgeEnabled: true,
  recomputeIntervalMinutes: 30,
  privacy: {
    truncateUrls: false,
    storeQueryStrings: true,
  },
  debug: false,
};

/** Stable identity for a tab, independent of volatile tabId. */
export interface TabRecord {
  /** UUID stable across restarts (carry-forward is heuristic). */
  key: string;
  /** Current browser tab id — unique only within a session. */
  tabId: number;
  windowId: number;
  index: number;
  url: string;
  title: string;
  pinned: boolean;
  discarded: boolean;
  /** Epoch ms when the tab was first observed/opened. */
  firstOpenedAt: number;
  /** Epoch ms of last activation (or lastAccessed bootstrap). null = unknown. */
  lastActiveAt: number | null;
  /** Epoch ms of last time we saw this tab in an event/query. */
  lastSeenAt: number;
  isOpen: boolean;
}

export interface StaleItem extends TabRecord {
  idleDays: number;
  /**
   * True when lastActiveAt is missing/corrupt (e.g. epoch 0).
   * Shown in the same report table as "way too old"; excluded from badge (R6).
   */
  wayTooOld: boolean;
}

export interface Staleness {
  /**
   * All rows for the main report table: way-too-old first, then real stale by idle.
   * Includes both threshold-stale and corrupt-timestamp tabs.
   */
  stale: StaleItem[];
  /** Count of corrupt/missing lastActiveAt rows (subset of `stale` with wayTooOld). */
  unknownCount: number;
  totalOpen: number;
  /**
   * Badge / nudge count — only real threshold-stale with a valid lastActiveAt (R6).
   * Does not include wayTooOld rows.
   */
  staleCount: number;
}

export interface ReportSnapshotItem {
  title: string;
  url: string;
  firstOpenedAt: number;
  lastActiveAt: number | null;
  idleDays: number;
}

export interface ReportSnapshot {
  dateKey: string;
  generatedAt: number;
  totalTabs: number;
  staleTabs: number;
  items: ReportSnapshotItem[];
  trigger: "scheduled" | "on-demand";
}

/** Messages between extension pages and the background. */
export type Msg =
  | { type: "GET_STATE" }
  | { type: "REFRESH" }
  | { type: "CLOSE_TAB"; tabId: number }
  | { type: "CLOSE_ALL_STALE" }
  /** Bulk close an arbitrary set of tabIds (R9). */
  | { type: "CLOSE_TABS"; tabIds: number[] }
  | { type: "JUMP_TO_TAB"; tabId: number }
  | { type: "GENERATE_REPORT_NOW" };

export interface ExtensionState {
  config: Config;
  staleness: Staleness;
  hostBrowser: string;
  lastSnapshot: ReportSnapshot | null;
  byWindow: Array<{ windowId: number; count: number }>;
}

export type MsgResponse =
  | { type: "STATE"; state: ExtensionState }
  | { type: "CLOSE_TAB_RESULT"; ok: boolean; error?: string }
  | { type: "CLOSE_ALL_STALE_RESULT"; closed: number }
  | { type: "CLOSE_TABS_RESULT"; closed: number }
  | { type: "JUMP_TO_TAB_RESULT"; ok: boolean; error?: string }
  | { type: "GENERATE_REPORT_NOW_RESULT"; snapshot: ReportSnapshot }
  | { type: "ERROR"; error: string };

export interface SchemaMeta {
  schemaVersion: number;
}

/** Storage key prefixes. */
export const STORAGE_KEYS = {
  schema: "schema",
  config: "config",
  tabPrefix: "tab:",
  reportPrefix: "report:",
  sessionMap: "tabIdToKey",
} as const;

export const ALARM_NAMES = {
  daily: "daily-check",
  recompute: "recompute",
} as const;
