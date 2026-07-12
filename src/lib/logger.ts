/** Debug-gated logger (no remote logging). */

let debugEnabled = false;

export function setDebug(enabled: boolean): void {
  debugEnabled = enabled;
}

export function log(...args: unknown[]): void {
  if (debugEnabled) {
    console.log("[TabDoctor]", ...args);
  }
}

export function warn(...args: unknown[]): void {
  console.warn("[TabDoctor]", ...args);
}

export function error(...args: unknown[]): void {
  console.error("[TabDoctor]", ...args);
}
