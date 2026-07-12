import { describe, expect, it } from "vitest";
import { isClosable, isInternalPage, normalizeUrl, truncateForDisplay } from "../src/lib/url";
import { DEFAULT_CONFIG } from "../src/types";

describe("normalizeUrl", () => {
  it("strips query/hash when storeQueryStrings is false", () => {
    const cfg = {
      ...DEFAULT_CONFIG,
      privacy: { truncateUrls: false, storeQueryStrings: false },
    };
    expect(normalizeUrl("https://ex.com/path?q=1#h", cfg)).toBe("https://ex.com/path");
  });

  it("keeps query when storeQueryStrings is true", () => {
    expect(normalizeUrl("https://ex.com/?q=1", DEFAULT_CONFIG)).toBe("https://ex.com/?q=1");
  });

  it("returns empty for empty input", () => {
    expect(normalizeUrl("", DEFAULT_CONFIG)).toBe("");
  });
});

describe("isInternalPage / isClosable", () => {
  it("detects chrome/edge/about pages", () => {
    expect(isInternalPage("chrome://settings")).toBe(true);
    expect(isInternalPage("edge://extensions")).toBe(true);
    expect(isInternalPage("about:config")).toBe(true);
    expect(isClosable("https://example.com")).toBe(true);
    expect(isClosable("chrome://newtab")).toBe(false);
  });
});

describe("truncateForDisplay", () => {
  it("leaves short URLs alone", () => {
    expect(truncateForDisplay("https://a.com", 48)).toBe("https://a.com");
  });

  it("truncates long URLs with ellipsis", () => {
    const long = "https://example.com/" + "x".repeat(80);
    const t = truncateForDisplay(long, 20);
    expect(t.length).toBe(20);
    expect(t).toContain("…");
  });
});
