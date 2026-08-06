import browser from "webextension-polyfill";

/** Safe i18n getter with English fallbacks for dev / missing keys. */
const FALLBACKS: Record<string, string> = {
  appName: "Browser Tab Doctor",
  bannerStale: "You have $COUNT$ tabs not used in over $DAYS$ days — close the ones you don't need.",
  bannerAllClear: "All clear — no tabs are older than $DAYS$ days.",
  bannerEmpty: "No open tabs to analyze.",
  // $OPEN$ total open · $STALE$ idle≥threshold · $UNKNOWN$ bad timestamps · $FRESH$ not listed
  summary:
    "$OPEN$ open in this browser  ·  $STALE$ stale  ·  $UNKNOWN$ unknown last-used  ·  $FRESH$ recent (not listed)",
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
    // Numbered placeholders ($1$, $2$, …) — Chrome-compatible order
    subs.forEach((s, i) => {
      text = text.split(`$${i + 1}$`).join(s);
    });
    // Named placeholders in FALLBACKS: fill in order of appearance in the string
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const m of text.matchAll(/\$([A-Z][A-Z0-9]*)\$/g)) {
      const name = m[1]!;
      if (!seen.has(name)) {
        seen.add(name);
        ordered.push(name);
      }
    }
    ordered.forEach((name, i) => {
      const s = subs[i];
      if (s != null) text = text.split(`$${name}$`).join(s);
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
