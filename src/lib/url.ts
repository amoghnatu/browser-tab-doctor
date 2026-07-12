import type { Config } from "../types";

/**
 * Normalize a URL for storage and identity matching (R3).
 * Invalid / empty URLs are returned as-is (or empty string).
 */
export function normalizeUrl(rawUrl: string, cfg: Config): string {
  if (!rawUrl) return "";
  try {
    const u = new URL(rawUrl);
    if (!cfg.privacy.storeQueryStrings) {
      u.search = "";
      u.hash = "";
    }
    return u.toString();
  } catch {
    return rawUrl;
  }
}

/** Truncate a URL for display (middle ellipsis). */
export function truncateForDisplay(url: string, maxLen = 48): string {
  if (url.length <= maxLen) return url;
  const head = Math.floor((maxLen - 1) / 2);
  const tail = maxLen - 1 - head;
  return `${url.slice(0, head)}…${url.slice(-tail)}`;
}

/**
 * Browser-internal / non-closable page detection.
 * Close is disabled for these; they are still inventoried.
 */
export function isInternalPage(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    lower.startsWith("chrome://") ||
    lower.startsWith("chrome-extension://") ||
    lower.startsWith("edge://") ||
    lower.startsWith("about:") ||
    lower.startsWith("moz-extension://") ||
    lower.startsWith("brave://") ||
    lower.startsWith("opera://") ||
    lower.startsWith("vivaldi://") ||
    lower.startsWith("devtools://") ||
    lower.startsWith("view-source:")
  );
}

/** Whether the tabs API is likely to allow removing this tab. */
export function isClosable(url: string): boolean {
  return !isInternalPage(url);
}
