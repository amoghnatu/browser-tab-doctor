import { describe, expect, it } from "vitest";
import { detectFromUserAgent } from "../src/lib/browser-info";

describe("detectFromUserAgent (R1)", () => {
  it("detects Chrome", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    expect(detectFromUserAgent(ua)).toMatch(/^Chrome /);
  });

  it("detects Edge", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";
    expect(detectFromUserAgent(ua)).toMatch(/^Edge /);
  });

  it("detects Firefox", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0";
    expect(detectFromUserAgent(ua)).toMatch(/^Firefox /);
  });

  it("uses userAgentData brands when present", () => {
    const label = detectFromUserAgent("ignored", {
      brands: [
        { brand: "Not_A Brand", version: "8" },
        { brand: "Chromium", version: "131" },
        { brand: "Google Chrome", version: "131" },
      ],
    });
    expect(label).toContain("Chrome");
  });

  it("returns Unknown for empty UA", () => {
    expect(detectFromUserAgent("")).toBe("Unknown browser");
  });
});
