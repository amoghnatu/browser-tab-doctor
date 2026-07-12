import browser from "webextension-polyfill";
import { DEFAULT_CONFIG, type Config } from "../types";
import { mergeConfig, validateConfigPatch } from "../lib/config";
import { applyI18n, t } from "../shared/i18n";

const form = document.getElementById("options-form") as HTMLFormElement;
const statusEl = document.getElementById("status")!;

const fields = {
  thresholdDays: document.getElementById("thresholdDays") as HTMLInputElement,
  reportHour: document.getElementById("reportHour") as HTMLInputElement,
  badgeEnabled: document.getElementById("badgeEnabled") as HTMLInputElement,
  retentionSnapshots: document.getElementById("retentionSnapshots") as HTMLInputElement,
  truncateUrls: document.getElementById("truncateUrls") as HTMLInputElement,
  storeQueryStrings: document.getElementById("storeQueryStrings") as HTMLInputElement,
};

function fillForm(cfg: Config): void {
  fields.thresholdDays.value = String(cfg.thresholdDays);
  fields.reportHour.value = String(cfg.reportHour);
  fields.badgeEnabled.checked = cfg.badgeEnabled;
  fields.retentionSnapshots.value = String(cfg.retentionSnapshots);
  fields.truncateUrls.checked = cfg.privacy.truncateUrls;
  fields.storeQueryStrings.checked = cfg.privacy.storeQueryStrings;
}

function readForm(): Partial<Config> {
  return {
    thresholdDays: Number(fields.thresholdDays.value),
    reportHour: Number(fields.reportHour.value),
    badgeEnabled: fields.badgeEnabled.checked,
    retentionSnapshots: Number(fields.retentionSnapshots.value),
    privacy: {
      truncateUrls: fields.truncateUrls.checked,
      storeQueryStrings: fields.storeQueryStrings.checked,
    },
  };
}

function setStatus(msg: string, kind: "ok" | "err" | ""): void {
  statusEl.textContent = msg;
  statusEl.classList.remove("ok", "err");
  if (kind) statusEl.classList.add(kind);
}

async function load(): Promise<void> {
  applyI18n();
  const result = await browser.storage.local.get("config");
  const cfg = mergeConfig(result.config ?? DEFAULT_CONFIG);
  fillForm(cfg);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const patch = readForm();
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
    // Best-effort sync for cross-device (Opera may throw)
    try {
      if (browser.storage.sync) {
        await browser.storage.sync.set({ config: next });
      }
    } catch {
      // ignore
    }
    setStatus(t("saved"), "ok");
  } catch (err) {
    setStatus(t("saveError", String(err)), "err");
  }
});

void load().catch((err) => setStatus(String(err), "err"));
