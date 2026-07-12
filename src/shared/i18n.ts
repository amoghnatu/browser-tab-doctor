import browser from "webextension-polyfill";

/** Safe i18n getter with English fallbacks for dev / missing keys. */
const FALLBACKS: Record<string, string> = {
  appName: "Browser Tab Doctor",
  bannerStale: "You have $COUNT$ tabs not used in over $DAYS$ days — close the ones you don't need.",
  bannerAllClear: "All clear — no tabs are older than $DAYS$ days.",
  bannerEmpty: "No open tabs to analyze.",
  summary: "Open tabs: $OPEN$  |  Stale: $STALE$  |  Unknown last-used: $UNKNOWN$",
  colTitle: "Title",
  colUrl: "URL",
  colFirstOpened: "First opened",
  colLastUsed: "Last used",
  colIdle: "Idle",
  actionClose: "Close",
  actionJump: "Jump to tab",
  idleWayTooOld: "way too old",
  closeAllStale: "Close all stale",
  unknownSection: "Unknown last-used",
  optThreshold: "Threshold (days)",
  optReportHour: "Daily report time (hour)",
  optBadge: "Show toolbar badge",
  optRetention: "History to keep (days)",
  optTruncateUrls: "Truncate URLs in report",
  optStoreQuery: "Store query strings",
  save: "Save",
  refresh: "Refresh",
  openReport: "Open full report",
  options: "Options",
  popupStaleSummary: "$STALE$ stale of $OPEN$ open tabs",
  popupAllClear: "All clear",
  confirmCloseAll: "Close $COUNT$ stale tabs? This cannot be undone.",
  saved: "Settings saved.",
  saveError: "Could not save: $ERROR$",
  thresholdLabel: "threshold: $DAYS$ days",
  topStale: "Top stale",
  idleDays: "$DAYS$d",
  internalTooltip: "Browser internal page — cannot be closed by the extension",
  hostBrowser: "Host",
};

export function t(key: string, substitutions?: string | string[]): string {
  try {
    const msg = browser.i18n?.getMessage?.(key, substitutions);
    if (msg) return msg;
  } catch {
    // fall through
  }
  let text = FALLBACKS[key] ?? key;
  if (substitutions != null) {
    const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
    // Map common placeholder patterns used in FALLBACKS
    const names = ["COUNT", "DAYS", "OPEN", "STALE", "UNKNOWN", "ERROR"];
    subs.forEach((s, i) => {
      const name = names[i] ?? String(i + 1);
      text = text.replace(`$${name}$`, s).replace(`$${i + 1}$`, s);
    });
  }
  return text;
}

/** Apply data-i18n attributes on the page. */
export function applyI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) el.textContent = t(key);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (key && "placeholder" in el) {
      (el as HTMLInputElement).placeholder = t(key);
    }
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-aria]").forEach((el) => {
    const key = el.getAttribute("data-i18n-aria");
    if (key) el.setAttribute("aria-label", t(key));
  });
}
