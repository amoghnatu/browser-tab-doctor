import { getState, openReportPage } from "../shared/api";
import { applyI18n, t } from "../shared/i18n";
import { createOptionsPanel } from "../shared/options-panel";

const summaryEl = document.getElementById("summary")!;
const listEl = document.getElementById("stale-list")!;
const allClearEl = document.getElementById("all-clear")!;
const btnReport = document.getElementById("btn-report") as HTMLButtonElement;
const btnOptions = document.getElementById("btn-options") as HTMLButtonElement;
const btnBack = document.getElementById("btn-options-back") as HTMLButtonElement;
const viewMain = document.getElementById("view-main")!;
const viewOptions = document.getElementById("view-options")!;
const optionsBody = document.getElementById("popup-options-body")!;

const optionsPanel = createOptionsPanel({
  compact: true,
  onSaved: () => {
    showMain();
    void render();
  },
});
optionsBody.append(optionsPanel.root);

function showMain(): void {
  viewOptions.hidden = true;
  viewOptions.classList.add("hidden");
  viewMain.hidden = false;
  viewMain.classList.remove("hidden");
}

async function showOptions(): Promise<void> {
  await optionsPanel.load();
  viewMain.hidden = true;
  viewMain.classList.add("hidden");
  viewOptions.hidden = false;
  viewOptions.classList.remove("hidden");
}

async function render(): Promise<void> {
  applyI18n();
  const state = await getState();
  const { staleCount, totalOpen, stale } = state.staleness;

  if (staleCount === 0) {
    summaryEl.textContent =
      totalOpen === 0 ? t("bannerEmpty") : t("popupAllClear");
    listEl.replaceChildren();
    allClearEl.classList.remove("hidden");
  } else {
    summaryEl.textContent = t("popupStaleSummary", [
      String(staleCount),
      String(totalOpen),
    ]);
    allClearEl.classList.add("hidden");
    const top = stale.slice(0, 3);
    listEl.replaceChildren(
      ...top.map((item) => {
        const li = document.createElement("li");
        const title = document.createElement("span");
        title.className = "title";
        title.textContent = item.title || "(untitled)";
        title.title = item.url;
        const idle = document.createElement("span");
        idle.className = "idle";
        idle.textContent = t("idleDays", String(item.idleDays));
        li.append(title, idle);
        return li;
      }),
    );
  }
}

btnReport.addEventListener("click", () => openReportPage());
btnOptions.addEventListener("click", () => void showOptions());
btnBack.addEventListener("click", () => showMain());

void render().catch((e) => {
  summaryEl.textContent = `Error: ${String(e)}`;
});
