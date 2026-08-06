/** Shared TypeScript types for Browser Tab Doctor (v1). */

export const SCHEMA_VERSION = 2;

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
  // ── R12 proactive notifications ─────────────────────────────────
  /** Master switch for system notifications. Default true. */
  notificationsEnabled: boolean;
  /** Require at least this many open tabs. Default 20. */
  notifyMinOpenTabs: number;
  /** Tab is long-idle when idleDays ≥ this (or last-used unknown). Default 15. */
  notifyLongIdleDays: number;
  /** Require long-idle / open × 100 ≥ this percent. Default 35. */
  notifySharePercent: number;
  /** Min days between two shown notifications. Default 7. */
  notifyCooldownDays: number;
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
  notificationsEnabled: true,
  notifyMinOpenTabs: 20,
  notifyLongIdleDays: 15,
  notifySharePercent: 35,
  notifyCooldownDays: 7,
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
  /** Prefer stable `key` — tabId alone can be stale after restart/SW wake. */
  | { type: "CLOSE_TAB"; tabId: number; key?: string }
  | { type: "CLOSE_ALL_STALE" }
  /** Bulk close; pass `keys` when available so we re-resolve live tabIds. */
  | { type: "CLOSE_TABS"; tabIds: number[]; keys?: string[] }
  | { type: "JUMP_TO_TAB"; tabId: number; key?: string }
  | { type: "GENERATE_REPORT_NOW" };

/**
 * Ground-truth counters so we can tell inventory ghosts from real double tabs.
 * Always filled by the background when building state.
 */
export interface InventoryDiagnostics {
  /** browser.tabs.query({ windowType: "normal" }) unique ids */
  liveTabCount: number;
  /** TabRecords with isOpen after sync (should equal liveTabCount) */
  openRecordCount: number;
  /** Rows in the report table (stale + unknown) */
  listedRowCount: number;
  /** Among listed rows, how many share a URL with another listed row */
  listedSameUrlExtras: number;
  /** Open storage records closed this sync because they were not tied to a live tab */
  ghostsClosedThisSync: number;
  extensionVersion: string;
}

export interface ExtensionState {
  config: Config;
  staleness: Staleness;
  hostBrowser: string;
  lastSnapshot: ReportSnapshot | null;
  byWindow: Array<{ windowId: number; count: number }>;
  diagnostics: InventoryDiagnostics;
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
  /** R12 — last successful proactive notification (local only). */
  lastNotificationAt: "lastNotificationAt",
} as const;

/** Fixed notification id for create/clear/click (R12). */
export const PROACTIVE_NOTIFICATION_ID = "tab-doctor-proactive";

export const ALARM_NAMES = {
  daily: "daily-check",
  recompute: "recompute",
} as const;
