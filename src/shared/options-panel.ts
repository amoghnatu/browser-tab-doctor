/**
 * Embeddable options form — used by the report-page modal and the toolbar popup.
 * Writes config to storage.local (+ sync best-effort); background reacts via onChanged.
 */
import browser from "webextension-polyfill";
import { DEFAULT_CONFIG, type Config } from "../types";
import { mergeConfig, validateConfigPatch } from "../lib/config";
import { t } from "./i18n";

export interface OptionsPanelHandle {
  load: () => Promise<void>;
  root: HTMLElement;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Small ⓘ control; native title tooltip on hover/focus. */
function infoHint(explanation: string): string {
  const e = esc(explanation);
  return `<abbr class="info-hint" title="${e}" aria-label="${e}">ⓘ</abbr>`;
}

function labelWithHint(text: string, hint: string, dataI18n?: string): string {
  const textSpan = dataI18n
    ? `<span data-i18n="${dataI18n}">${esc(text)}</span>`
    : `<span>${esc(text)}</span>`;
  return `<span class="label-with-hint">${textSpan}${infoHint(hint)}</span>`;
}

export function createOptionsPanel(opts?: {
  onSaved?: () => void;
  compact?: boolean;
}): OptionsPanelHandle {
  const root = document.createElement("div");
  root.className = "options-panel" + (opts?.compact ? " options-panel--compact" : "");

  root.innerHTML = `
    <form class="options-panel-form" novalidate>
      <fieldset>
        <legend>Threshold &amp; schedule</legend>
        <label>
          ${labelWithHint(
            "Threshold (days)",
            "How many days without use before a tab is marked stale in the report and counts toward the toolbar badge. Default 7. Separate from “Long-idle days” under notifications.",
            "optThreshold",
          )}
          <input type="number" name="thresholdDays" min="1" max="3650" step="1" required />
        </label>
        <label>
          ${labelWithHint(
            "Daily report time (hour)",
            "Local hour (0–23) at or after which the once-per-day report snapshot may be saved. Default 9 (9:00 AM).",
            "optReportHour",
          )}
          <input type="number" name="reportHour" min="0" max="23" step="1" required />
        </label>
        <label class="checkbox">
          ${labelWithHint(
            "Show toolbar badge",
            "When on, the extension icon shows a small count of stale tabs. Empty when nothing is stale.",
            "optBadge",
          )}
          <input type="checkbox" name="badgeEnabled" />
        </label>
      </fieldset>
      <fieldset>
        <legend>History &amp; privacy</legend>
        <label>
          ${labelWithHint(
            "History to keep (days)",
            "How many daily report snapshots to keep in local storage. Older ones are deleted automatically. Default 90.",
            "optRetention",
          )}
          <input type="number" name="retentionSnapshots" min="1" max="3650" step="1" required />
        </label>
        <label class="checkbox">
          ${labelWithHint(
            "Truncate URLs in report",
            "When on, long URLs are shortened in the report table for readability (full URL still available on hover).",
            "optTruncateUrls",
          )}
          <input type="checkbox" name="truncateUrls" />
        </label>
        <label class="checkbox">
          ${labelWithHint(
            "Store query strings",
            "When off, ?search=… and #hash are stripped before saving and matching tab URLs (more private, slightly less precise matching).",
            "optStoreQuery",
          )}
          <input type="checkbox" name="storeQueryStrings" />
        </label>
      </fieldset>
      <fieldset>
        <legend>Proactive notifications</legend>
        <p class="options-panel-hint">
          Rare system alerts when tab load is high and many tabs are long-idle.
          Does not replace the toolbar badge.
        </p>
        <label class="checkbox">
          ${labelWithHint(
            "Enable proactive notifications",
            "Master switch. When off, no system notifications are shown (badge and report still work).",
          )}
          <input type="checkbox" name="notificationsEnabled" />
        </label>
        <label>
          ${labelWithHint(
            "Min open tabs",
            "Only consider notifying if you have at least this many open tabs. Default 20.",
          )}
          <input type="number" name="notifyMinOpenTabs" min="1" max="10000" step="1" required />
        </label>
        <label>
          ${labelWithHint(
            "Long-idle days",
            "A tab counts as “long-idle” for notifications if unused for at least this many days (or last-used is unknown). Default 15. Independent of the report stale threshold.",
          )}
          <input type="number" name="notifyLongIdleDays" min="1" max="3650" step="1" required />
        </label>
        <label>
          ${labelWithHint(
            "Share of tabs long-idle (%)",
            "Only notify if at least this percentage of open tabs are long-idle. Default 35.",
          )}
          <input type="number" name="notifySharePercent" min="1" max="100" step="1" required />
        </label>
        <label>
          ${labelWithHint(
            "Cooldownoldown (days)",
            "Minimum days to wait after a proactive notification before another one can appear — even if tab conditions are still met. Default 7.",
          )}
          <input type="number" name="notifyCooldownDays" min="1" max="3650" step="1" required />
        </label>
      </fieldset>
      <div class="options-panel-actions">
        <button type="submit" class="primary" data-i18n="save">Save</button>
        <p class="options-panel-status" role="status" aria-live="polite"></p>
      </div>
    </form>
  `;

  // Apply i18n only to leaf text nodes (won't wipe ⓘ hints)
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) el.textContent = t(key);
  });

  const form = root.querySelector("form") as HTMLFormElement;
  const statusEl = root.querySelector(".options-panel-status") as HTMLElement;
  const field = (name: string) =>
    form.elements.namedItem(name) as HTMLInputElement;

  function setStatus(msg: string, kind: "ok" | "err" | ""): void {
    statusEl.textContent = msg;
    statusEl.classList.remove("ok", "err");
    if (kind) statusEl.classList.add(kind);
  }

  function fill(cfg: Config): void {
    field("thresholdDays").value = String(cfg.thresholdDays);
    field("reportHour").value = String(cfg.reportHour);
    field("badgeEnabled").checked = cfg.badgeEnabled;
    field("retentionSnapshots").value = String(cfg.retentionSnapshots);
    field("truncateUrls").checked = cfg.privacy.truncateUrls;
    field("storeQueryStrings").checked = cfg.privacy.storeQueryStrings;
    field("notificationsEnabled").checked = cfg.notificationsEnabled;
    field("notifyMinOpenTabs").value = String(cfg.notifyMinOpenTabs);
    field("notifyLongIdleDays").value = String(cfg.notifyLongIdleDays);
    field("notifySharePercent").value = String(cfg.notifySharePercent);
    field("notifyCooldownDays").value = String(cfg.notifyCooldownDays);
  }

  function read(): Partial<Config> {
    return {
      thresholdDays: Number(field("thresholdDays").value),
      reportHour: Number(field("reportHour").value),
      badgeEnabled: field("badgeEnabled").checked,
      retentionSnapshots: Number(field("retentionSnapshots").value),
      notificationsEnabled: field("notificationsEnabled").checked,
      notifyMinOpenTabs: Number(field("notifyMinOpenTabs").value),
      notifyLongIdleDays: Number(field("notifyLongIdleDays").value),
      notifySharePercent: Number(field("notifySharePercent").value),
      notifyCooldownDays: Number(field("notifyCooldownDays").value),
      privacy: {
        truncateUrls: field("truncateUrls").checked,
        storeQueryStrings: field("storeQueryStrings").checked,
      },
    };
  }

  async function load(): Promise<void> {
    const result = await browser.storage.local.get("config");
    fill(mergeConfig(result.config ?? DEFAULT_CONFIG));
    setStatus("", "");
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const patch = read();
    const validated = validateConfigPatch(patch);
    if (!validated.ok) {
      setStatus(
        t("saveError", validated.errors.map((err) => err.message).join("; ")),
        "err",
      );
      return;
    }
    try {
      const current = mergeConfig(
        (await browser.storage.local.get("config")).config,
      );
      const next: Config = {
        ...current,
        ...validated.value,
        privacy: {
          ...current.privacy,
          ...(validated.value.privacy ?? {}),
        },
      };
      await browser.storage.local.set({ config: next });
      try {
        if (browser.storage.sync) {
          await browser.storage.sync.set({ config: next });
        }
      } catch {
        // Opera / no sync
      }
      setStatus(t("saved"), "ok");
      opts?.onSaved?.();
    } catch (err) {
      setStatus(t("saveError", String(err)), "err");
    }
  });

  return { root, load };
}
