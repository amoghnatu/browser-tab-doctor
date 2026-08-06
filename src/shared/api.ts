import browser from "webextension-polyfill";
import type { ExtensionState, Msg, MsgResponse, ReportSnapshot } from "../types";

async function send(msg: Msg): Promise<MsgResponse> {
  const response = (await browser.runtime.sendMessage(msg)) as MsgResponse;
  if (!response) throw new Error("No response from background");
  if (response.type === "ERROR") throw new Error(response.error);
  return response;
}

export async function getState(): Promise<ExtensionState> {
  const res = await send({ type: "GET_STATE" });
  if (res.type !== "STATE") throw new Error("Unexpected response");
  return res.state;
}

export async function refreshState(): Promise<ExtensionState> {
  const res = await send({ type: "REFRESH" });
  if (res.type !== "STATE") throw new Error("Unexpected response");
  return res.state;
}

export async function closeTab(
  tabId: number,
  key?: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await send({ type: "CLOSE_TAB", tabId, key });
  if (res.type !== "CLOSE_TAB_RESULT") throw new Error("Unexpected response");
  return { ok: res.ok, error: res.error };
}

export async function closeAllStale(): Promise<number> {
  const res = await send({ type: "CLOSE_ALL_STALE" });
  if (res.type !== "CLOSE_ALL_STALE_RESULT") throw new Error("Unexpected response");
  return res.closed;
}

/** Bulk-close by live tab ids and/or stable keys (R9). */
export async function closeTabs(
  tabIds: number[],
  keys?: string[],
): Promise<number> {
  if (tabIds.length === 0 && (!keys || keys.length === 0)) return 0;
  const res = await send({ type: "CLOSE_TABS", tabIds, keys });
  if (res.type !== "CLOSE_TABS_RESULT") throw new Error("Unexpected response");
  return res.closed;
}

export async function jumpToTab(
  tabId: number,
  key?: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await send({ type: "JUMP_TO_TAB", tabId, key });
  if (res.type !== "JUMP_TO_TAB_RESULT") throw new Error("Unexpected response");
  return { ok: res.ok, error: res.error };
}

export async function generateReportNow(): Promise<ReportSnapshot> {
  const res = await send({ type: "GENERATE_REPORT_NOW" });
  if (res.type !== "GENERATE_REPORT_NOW_RESULT") throw new Error("Unexpected response");
  return res.snapshot;
}

/**
 * @deprecated Prefer the in-page options modal / popup options view.
 * Kept for rare cases (e.g. chrome://extensions “Extension options”).
 */
export function openOptionsPage(): void {
  void browser.runtime.openOptionsPage();
}

export function openReportPage(): void {
  void browser.tabs.create({ url: browser.runtime.getURL("report.html") });
}
