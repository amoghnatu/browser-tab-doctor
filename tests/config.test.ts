import { describe, expect, it } from "vitest";
import { mergeConfig, validateConfigPatch } from "../src/lib/config";
import { DEFAULT_CONFIG } from "../src/types";

describe("validateConfigPatch (R7)", () => {
  it("accepts valid thresholdDays", () => {
    const r = validateConfigPatch({ thresholdDays: 14 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.thresholdDays).toBe(14);
  });

  it("rejects thresholdDays < 1", () => {
    const r = validateConfigPatch({ thresholdDays: 0 });
    expect(r.ok).toBe(false);
  });

  it("rejects non-integer threshold", () => {
    const r = validateConfigPatch({ thresholdDays: 1.5 });
    expect(r.ok).toBe(false);
  });

  it("rejects reportHour outside 0–23", () => {
    expect(validateConfigPatch({ reportHour: -1 }).ok).toBe(false);
    expect(validateConfigPatch({ reportHour: 24 }).ok).toBe(false);
    expect(validateConfigPatch({ reportHour: 9 }).ok).toBe(true);
  });

  it("rejects recomputeIntervalMinutes < 0.5", () => {
    expect(validateConfigPatch({ recomputeIntervalMinutes: 0.4 }).ok).toBe(false);
    expect(validateConfigPatch({ recomputeIntervalMinutes: 0.5 }).ok).toBe(true);
  });

  it("accepts privacy flags", () => {
    const r = validateConfigPatch({
      privacy: { truncateUrls: true, storeQueryStrings: false },
    });
    expect(r.ok).toBe(true);
  });
});

describe("mergeConfig", () => {
  it("returns defaults for empty/invalid", () => {
    expect(mergeConfig(null).thresholdDays).toBe(DEFAULT_CONFIG.thresholdDays);
    expect(mergeConfig({}).thresholdDays).toBe(7);
  });

  it("merges partial stored config", () => {
    const m = mergeConfig({ thresholdDays: 3, privacy: { truncateUrls: true } });
    expect(m.thresholdDays).toBe(3);
    expect(m.privacy.truncateUrls).toBe(true);
    expect(m.privacy.storeQueryStrings).toBe(true); // default
    expect(m.reportHour).toBe(9);
  });
});
