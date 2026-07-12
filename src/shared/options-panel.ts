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
          <span data-i18n="optThreshold">Threshold (days)</span>
          <input type="number" name="thresholdDays" min="1" max="3650" step="1" required />
        </label>
        <label>
          <span data-i18n="optReportHour">Daily report time (hour)</span>
          <input type="number" name="reportHour" min="0" max="23" step="1" required />
        </label>
        <label class="checkbox">
          <span data-i18n="optBadge">Show toolbar badge</span>
          <input type="checkbox" name="badgeEnabled" />
        </label>
      </fieldset>
      <fieldset>
        <legend>History &amp; privacy</legend>
        <label>
          <span data-i18n="optRetention">History to keep (days)</span>
          <input type="number" name="retentionSnapshots" min="1" max="3650" step="1" required />
        </label>
        <label class="checkbox">
          <span data-i18n="optTruncateUrls">Truncate URLs in report</span>
          <input type="checkbox" name="truncateUrls" />
        </label>
        <label class="checkbox">
          <span data-i18n="optStoreQuery">Store query strings</span>
          <input type="checkbox" name="storeQueryStrings" />
        </label>
      </fieldset>
      <div class="options-panel-actions">
        <button type="submit" class="primary" data-i18n="save">Save</button>
        <p class="options-panel-status" role="status" aria-live="polite"></p>
      </div>
    </form>
  `;

  // Apply i18n to static labels
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
  }

  function read(): Partial<Config> {
    return {
      thresholdDays: Number(field("thresholdDays").value),
      reportHour: Number(field("reportHour").value),
      badgeEnabled: field("badgeEnabled").checked,
      retentionSnapshots: Number(field("retentionSnapshots").value),
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
