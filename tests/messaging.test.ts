import { describe, expect, it } from "vitest";
import { isMsg } from "../src/lib/messaging";

describe("isMsg", () => {
  it("accepts valid message types", () => {
    expect(isMsg({ type: "GET_STATE" })).toBe(true);
    expect(isMsg({ type: "REFRESH" })).toBe(true);
    expect(isMsg({ type: "CLOSE_ALL_STALE" })).toBe(true);
    expect(isMsg({ type: "GENERATE_REPORT_NOW" })).toBe(true);
    expect(isMsg({ type: "CLOSE_TAB", tabId: 3 })).toBe(true);
    expect(isMsg({ type: "JUMP_TO_TAB", tabId: 1 })).toBe(true);
    expect(isMsg({ type: "CLOSE_TABS", tabIds: [1, 2, 3] })).toBe(true);
    expect(isMsg({ type: "CLOSE_TABS", tabIds: [] })).toBe(true);
  });

  it("rejects invalid payloads", () => {
    expect(isMsg(null)).toBe(false);
    expect(isMsg({})).toBe(false);
    expect(isMsg({ type: "CLOSE_TAB" })).toBe(false);
    expect(isMsg({ type: "NOPE" })).toBe(false);
    expect(isMsg({ type: "CLOSE_TABS" })).toBe(false);
    expect(isMsg({ type: "CLOSE_TABS", tabIds: ["x"] })).toBe(false);
  });
});
