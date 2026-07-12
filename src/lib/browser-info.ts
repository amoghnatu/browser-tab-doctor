import type Browser from "webextension-polyfill";

/**
 * Identify the host browser for report labeling (R1).
 * Uses runtime.getBrowserInfo() on Firefox; UA / userAgentData on Chromium.
 */
export async function detectHostBrowser(
  browserApi: typeof Browser,
): Promise<string> {
  // Firefox-only API
  const getBrowserInfo = (
    browserApi.runtime as typeof browserApi.runtime & {
      getBrowserInfo?: () => Promise<{ name: string; version: string }>;
    }
  ).getBrowserInfo;

  if (typeof getBrowserInfo === "function") {
    try {
      const info = await getBrowserInfo();
      if (info?.name) {
        return info.version ? `${info.name} ${info.version}` : info.name;
      }
    } catch {
      // fall through to UA
    }
  }

  return detectFromUserAgent(
    typeof navigator !== "undefined" ? navigator.userAgent : "",
    typeof navigator !== "undefined"
      ? (navigator as Navigator & { userAgentData?: { brands?: Array<{ brand: string; version: string }> } })
          .userAgentData
      : undefined,
  );
}

/** Pure UA heuristic — exported for unit tests. */
export function detectFromUserAgent(
  ua: string,
  uaData?: { brands?: Array<{ brand: string; version: string }> },
): string {
  if (uaData?.brands?.length) {
    const brands = uaData.brands.filter(
      (b) => !/Not.?A.?Brand/i.test(b.brand) && b.brand !== "Chromium",
    );
    const preferred =
      brands.find((b) => /Chrome|Edge|Opera|Brave|Vivaldi/i.test(b.brand)) ??
      brands[0];
    if (preferred) {
      return preferred.version
        ? `${preferred.brand} ${preferred.version}`
        : preferred.brand;
    }
    const chromium = uaData.brands.find((b) => b.brand === "Chromium");
    if (chromium) return `Chromium ${chromium.version}`;
  }

  if (/Edg\//i.test(ua)) {
    const m = ua.match(/Edg\/([\d.]+)/);
    return m ? `Edge ${m[1]}` : "Edge";
  }
  if (/OPR\//i.test(ua) || /Opera/i.test(ua)) {
    const m = ua.match(/OPR\/([\d.]+)/);
    return m ? `Opera ${m[1]}` : "Opera";
  }
  if (/Brave/i.test(ua)) return "Brave";
  if (/Vivaldi/i.test(ua)) {
    const m = ua.match(/Vivaldi\/([\d.]+)/);
    return m ? `Vivaldi ${m[1]}` : "Vivaldi";
  }
  if (/Firefox\//i.test(ua)) {
    const m = ua.match(/Firefox\/([\d.]+)/);
    return m ? `Firefox ${m[1]}` : "Firefox";
  }
  if (/Chrome\//i.test(ua)) {
    const m = ua.match(/Chrome\/([\d.]+)/);
    return m ? `Chrome ${m[1]}` : "Chrome";
  }
  return "Unknown browser";
}
