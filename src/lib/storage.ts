/**
 * Thin typed storage layer — the only module that touches browser.storage.
 * Validates on read; runs schemaVersion migrations.
 */
import type Browser from "webextension-polyfill";
import {
  DEFAULT_CONFIG,
  SCHEMA_VERSION,
  STORAGE_KEYS,
  type Config,
  type ReportSnapshot,
  type SchemaMeta,
  type TabRecord,
} from "../types";
import { mergeConfig, validateConfigPatch } from "./config";
import { snapshotKeysToPrune } from "./snapshot";
import * as logger from "./logger";

type StorageArea = Browser.Storage.StorageArea;

export interface StorageDeps {
  local: StorageArea;
  /** Optional session area (Chromium; feature-detected). */
  session?: StorageArea | null;
  /** Optional sync for config only (falls back to local). */
  sync?: StorageArea | null;
}

let deps: StorageDeps | null = null;

export function initStorage(d: StorageDeps): void {
  deps = d;
}

function requireDeps(): StorageDeps {
  if (!deps) throw new Error("Storage not initialized — call initStorage() first");
  return deps;
}

function tabKey(key: string): string {
  return `${STORAGE_KEYS.tabPrefix}${key}`;
}

function reportKey(dateKey: string): string {
  return `${STORAGE_KEYS.reportPrefix}${dateKey}`;
}

export async function migrateIfNeeded(): Promise<void> {
  const { local } = requireDeps();
  const result = await local.get(STORAGE_KEYS.schema);
  const meta = result[STORAGE_KEYS.schema] as SchemaMeta | undefined;
  const current = meta?.schemaVersion ?? 0;

  if (current === 0) {
    await local.set({
      [STORAGE_KEYS.schema]: { schemaVersion: SCHEMA_VERSION } satisfies SchemaMeta,
    });
    // Ensure config exists
    const cfgResult = await local.get(STORAGE_KEYS.config);
    if (!cfgResult[STORAGE_KEYS.config]) {
      await local.set({ [STORAGE_KEYS.config]: { ...DEFAULT_CONFIG } });
    }
    return;
  }

  if (current < SCHEMA_VERSION) {
    // Future migrations go here (v1 has none beyond bootstrap).
    await local.set({
      [STORAGE_KEYS.schema]: { schemaVersion: SCHEMA_VERSION } satisfies SchemaMeta,
    });
  }
}

export async function getConfig(): Promise<Config> {
  const { local, sync } = requireDeps();
  // Prefer sync when available (cross-device), else local
  let raw: unknown;
  if (sync) {
    try {
      const s = await sync.get(STORAGE_KEYS.config);
      raw = s[STORAGE_KEYS.config];
    } catch {
      // Opera / unavailable sync
    }
  }
  if (raw === undefined) {
    const l = await local.get(STORAGE_KEYS.config);
    raw = l[STORAGE_KEYS.config];
  }
  const cfg = mergeConfig(raw);
  logger.setDebug(cfg.debug);
  return cfg;
}

export async function setConfig(patch: Partial<Config>): Promise<Config> {
  const validated = validateConfigPatch(patch);
  if (!validated.ok) {
    throw new Error(validated.errors.map((e) => `${e.field}: ${e.message}`).join("; "));
  }
  const current = await getConfig();
  const next: Config = {
    ...current,
    ...validated.value,
    privacy: {
      ...current.privacy,
      ...(validated.value.privacy ?? {}),
    },
    schemaVersion: SCHEMA_VERSION,
  };

  const { local, sync } = requireDeps();
  // Always write local so tab/report logic can read consistently
  await local.set({ [STORAGE_KEYS.config]: next });
  if (sync) {
    try {
      await sync.set({ [STORAGE_KEYS.config]: next });
    } catch (e) {
      logger.warn("storage.sync set failed; using local only", e);
    }
  }
  logger.setDebug(next.debug);
  return next;
}

export async function getAllTabRecords(): Promise<TabRecord[]> {
  const { local } = requireDeps();
  const all = await local.get(null);
  const records: TabRecord[] = [];
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith(STORAGE_KEYS.tabPrefix) && v && typeof v === "object") {
      records.push(v as TabRecord);
    }
  }
  return records;
}

export async function getTabRecord(key: string): Promise<TabRecord | undefined> {
  const { local } = requireDeps();
  const result = await local.get(tabKey(key));
  return result[tabKey(key)] as TabRecord | undefined;
}

export async function upsertTabRecord(r: TabRecord): Promise<void> {
  const { local } = requireDeps();
  try {
    await local.set({ [tabKey(r.key)]: r });
  } catch (e) {
    const msg = String(e);
    if (/QUOTA|quota/i.test(msg)) {
      logger.warn("Quota exceeded on tab upsert; pruning snapshots and retrying");
      const cfg = await getConfig();
      await pruneSnapshots(Math.max(7, Math.floor(cfg.retentionSnapshots / 2)));
      await local.set({ [tabKey(r.key)]: r });
    } else {
      throw e;
    }
  }
}

export async function deleteTabRecord(key: string): Promise<void> {
  const { local } = requireDeps();
  await local.remove(tabKey(key));
}

/** Batch upsert for reconcile performance. */
export async function upsertTabRecords(records: TabRecord[]): Promise<void> {
  if (records.length === 0) return;
  const { local } = requireDeps();
  const payload: Record<string, TabRecord> = {};
  for (const r of records) {
    payload[tabKey(r.key)] = r;
  }
  try {
    await local.set(payload);
  } catch (e) {
    const msg = String(e);
    if (/QUOTA|quota/i.test(msg)) {
      logger.warn("Quota exceeded on batch upsert; pruning and retrying");
      const cfg = await getConfig();
      await pruneSnapshots(Math.max(7, Math.floor(cfg.retentionSnapshots / 2)));
      await local.set(payload);
    } else {
      throw e;
    }
  }
}

export async function getSnapshot(dateKey: string): Promise<ReportSnapshot | undefined> {
  const { local } = requireDeps();
  const result = await local.get(reportKey(dateKey));
  return result[reportKey(dateKey)] as ReportSnapshot | undefined;
}

export async function putSnapshot(s: ReportSnapshot): Promise<void> {
  const { local } = requireDeps();
  try {
    await local.set({ [reportKey(s.dateKey)]: s });
  } catch (e) {
    const msg = String(e);
    if (/QUOTA|quota/i.test(msg)) {
      logger.warn("Quota exceeded on snapshot; aggressive prune + retry");
      await pruneSnapshots(14);
      await local.set({ [reportKey(s.dateKey)]: s });
    } else {
      throw e;
    }
  }
}

export async function listSnapshotKeys(): Promise<string[]> {
  const { local } = requireDeps();
  const all = await local.get(null);
  return Object.keys(all).filter((k) => k.startsWith(STORAGE_KEYS.reportPrefix));
}

export async function pruneSnapshots(keep: number): Promise<void> {
  const { local } = requireDeps();
  const keys = await listSnapshotKeys();
  const toRemove = snapshotKeysToPrune(keys, keep);
  if (toRemove.length > 0) {
    await local.remove(toRemove);
  }
}

export async function getLatestSnapshot(): Promise<ReportSnapshot | null> {
  const keys = await listSnapshotKeys();
  if (keys.length === 0) return null;
  const newest = [...keys].sort().reverse()[0]!;
  const dateKey = newest.slice(STORAGE_KEYS.reportPrefix.length);
  return (await getSnapshot(dateKey)) ?? null;
}

// ── Session map (tabId → stable key) ────────────────────────────────────────

export async function getSessionMap(): Promise<Record<number, string>> {
  const { session, local } = requireDeps();
  if (session) {
    try {
      const r = await session.get(STORAGE_KEYS.sessionMap);
      const map = r[STORAGE_KEYS.sessionMap] as Record<string, string> | undefined;
      if (!map) return {};
      // Keys may be stringified numbers in storage
      const out: Record<number, string> = {};
      for (const [k, v] of Object.entries(map)) {
        out[Number(k)] = v;
      }
      return out;
    } catch {
      // fall through
    }
  }
  // Fallback: keep map in local under a session-like key (cleared on reconcile)
  const r = await local.get(`_session_${STORAGE_KEYS.sessionMap}`);
  const map = r[`_session_${STORAGE_KEYS.sessionMap}`] as Record<string, string> | undefined;
  if (!map) return {};
  const out: Record<number, string> = {};
  for (const [k, v] of Object.entries(map)) {
    out[Number(k)] = v;
  }
  return out;
}

export async function setSessionMap(m: Record<number, string>): Promise<void> {
  const { session, local } = requireDeps();
  // Storage APIs need string keys
  const serializable: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) {
    serializable[String(k)] = v;
  }
  if (session) {
    try {
      await session.set({ [STORAGE_KEYS.sessionMap]: serializable });
      return;
    } catch {
      // fall through
    }
  }
  await local.set({ [`_session_${STORAGE_KEYS.sessionMap}`]: serializable });
}

export async function mapGet(tabId: number): Promise<string | undefined> {
  const m = await getSessionMap();
  return m[tabId];
}

export async function mapSet(tabId: number, key: string): Promise<void> {
  const m = await getSessionMap();
  m[tabId] = key;
  await setSessionMap(m);
}

export async function mapDelete(tabId: number): Promise<void> {
  const m = await getSessionMap();
  delete m[tabId];
  await setSessionMap(m);
}

export async function recordFor(tabId: number): Promise<TabRecord | undefined> {
  const key = await mapGet(tabId);
  if (!key) return undefined;
  return getTabRecord(key);
}
