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
    case "JUMP_TO_TAB": {
      const v = value as { tabId?: unknown; key?: unknown };
      if (typeof v.tabId !== "number") return false;
      if (v.key !== undefined && typeof v.key !== "string") return false;
      return true;
    }
    case "CLOSE_TABS": {
      const v = value as { tabIds?: unknown; keys?: unknown };
      const ids = v.tabIds;
      if (!Array.isArray(ids) || !ids.every((id) => typeof id === "number")) {
        return false;
      }
      if (v.keys !== undefined) {
        if (!Array.isArray(v.keys) || !v.keys.every((k) => typeof k === "string")) {
          return false;
        }
      }
      return true;
    }
    default:
      return false;
  }
}

export type { ExtensionState, Msg, MsgResponse, ReportSnapshot };
