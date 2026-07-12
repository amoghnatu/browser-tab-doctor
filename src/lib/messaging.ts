import type { ExtensionState, Msg, MsgResponse, ReportSnapshot } from "../types";

export type MessageHandler = (msg: Msg) => Promise<MsgResponse>;

export function isMsg(value: unknown): value is Msg {
  if (!value || typeof value !== "object") return false;
  const t = (value as { type?: unknown }).type;
  if (typeof t !== "string") return false;
  switch (t) {
    case "GET_STATE":
    case "REFRESH":
    case "CLOSE_ALL_STALE":
    case "GENERATE_REPORT_NOW":
      return true;
    case "CLOSE_TAB":
    case "JUMP_TO_TAB":
      return typeof (value as { tabId?: unknown }).tabId === "number";
    case "CLOSE_TABS": {
      const ids = (value as { tabIds?: unknown }).tabIds;
      return Array.isArray(ids) && ids.every((id) => typeof id === "number");
    }
    default:
      return false;
  }
}

export type { ExtensionState, Msg, MsgResponse, ReportSnapshot };
