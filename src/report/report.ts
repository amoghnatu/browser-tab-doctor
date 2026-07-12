/**
 * Report page — R4 table + R9 selection/bulk close + R10 confirm + R11 category filter.
 */
import type { ExtensionState, StaleItem } from "../types";
import {
  closeTab,
  closeTabs,
  getState,
  jumpToTab,
  refreshState,
} from "../shared/api";
import { applyI18n, t } from "../shared/i18n";
import { createOptionsPanel } from "../shared/options-panel";
import { formatDate, formatTimestamp } from "../lib/date";
import {
  bulkEligibleRows,
  categoryIsEmpty,
  countByCategory,
  filterByCategory,
  othersBulkRows,
  resolveByKeys,
  selectedBulkRows,
  type CategoryFilter,
} from "../lib/report-view";
import { isClosable, truncateForDisplay } from "../lib/url";

const JUMP_LABEL = "Jump to tab";
const CLOSE_LABEL = "Close";

type SortKey =
  | "idle-desc"
  | "idle-asc"
  | "title-asc"
  | "title-desc"
  | "last-desc"
  | "last-asc";

type BulkKind = "all" | "selected" | "others";

let state: ExtensionState | null = null;
let sortKey: SortKey = "idle-desc";
/** R11 — session UI state, resets on reload. */
let categoryFilter: CategoryFilter = "all";
/** R9 — selected row keys (stable identity). */
const selectedKeys = new Set<string>();
let confirmOpen = false;
let pendingConfirm: { tabIds: number[]; message: string; title: string } | null =
  null;

const els = {
  host: document.getElementById("host-browser")!,
  threshold: document.getElementById("threshold-label")!,
  banner: document.getElementById("banner")!,
  summary: document.getElementById("summary-text")!,
  body: document.getElementById("stale-body")!,
  empty: document.getElementById("empty-stale")!,
  closeAll: document.getElementById("btn-close-all") as HTMLButtonElement,
  closeSelected: document.getElementById("btn-close-selected") as HTMLButtonElement,
  closeOthers: document.getElementById("btn-close-others") as HTMLButtonElement,
  bulkActions: document.getElementById("bulk-actions")!,
  selectAll: document.getElementById("select-all") as HTMLInputElement,
  refresh: document.getElementById("btn-refresh") as HTMLButtonElement,
  options: document.getElementById("btn-options") as HTMLButtonElement,
  sort: document.getElementById("sort-select") as HTMLSelectElement,
  filter: document.getElementById("filter-select") as HTMLSelectElement,
  optionsModal: document.getElementById("options-modal") as HTMLElement,
  optionsModalBody: document.getElementById("options-modal-body")!,
  optionsModalClose: document.getElementById(
    "options-modal-close",
  ) as HTMLButtonElement,
  confirmModal: document.getElementById("confirm-modal") as HTMLElement,
  confirmMessage: document.getElementById("confirm-message")!,
  confirmTitle: document.getElementById("confirm-title")!,
  confirmCancel: document.getElementById("confirm-cancel") as HTMLButtonElement,
  confirmOk: document.getElementById("confirm-ok") as HTMLButtonElement,
};

const optionsPanel = createOptionsPanel({
  onSaved: () => {
    closeOptionsModal();
    void load(true);
  },
});
els.optionsModalBody.append(optionsPanel.root);

// ── View helpers ────────────────────────────────────────────────────────────

function allRows(): StaleItem[] {
  return state?.staleness.stale ?? [];
}

function visibleRows(): StaleItem[] {
  return filterByCategory(allRows(), categoryFilter);
}

function sortRows(items: StaleItem[], key: SortKey): StaleItem[] {
  const copy = [...items];
  const idleKey = (x: StaleItem) =>
    x.wayTooOld ? Number.POSITIVE_INFINITY : x.idleDays;
  switch (key) {
    case "idle-desc":
      return copy.sort((a, b) => idleKey(b) - idleKey(a));
    case "idle-asc":
      return copy.sort((a, b) => idleKey(a) - idleKey(b));
    case "title-asc":
      return copy.sort((a, b) => a.title.localeCompare(b.title));
    case "title-desc":
      return copy.sort((a, b) => b.title.localeCompare(a.title));
    case "last-desc":
      return copy.sort((a, b) => {
        if (a.wayTooOld !== b.wayTooOld) return a.wayTooOld ? 1 : -1;
        return (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0);
      });
    case "last-asc":
      return copy.sort((a, b) => {
        if (a.wayTooOld !== b.wayTooOld) return a.wayTooOld ? -1 : 1;
        return (a.lastActiveAt ?? 0) - (b.lastActiveAt ?? 0);
      });
    default:
      return copy;
  }
}

function clearSelection(): void {
  selectedKeys.clear();
}

/** Drop selection keys that no longer appear in bulk-eligible rows. */
function pruneSelection(): void {
  const eligible = new Set(
    bulkEligibleRows(allRows(), categoryFilter).map((r) => r.key),
  );
  for (const k of [...selectedKeys]) {
    if (!eligible.has(k)) selectedKeys.delete(k);
  }
}

// ── R10 confirm dialog ──────────────────────────────────────────────────────

function openConfirm(
  tabIds: number[],
  title: string,
  message: string,
): Promise<boolean> {
  if (tabIds.length === 0) return Promise.resolve(false);
  // R10: single-tab bulk path still uses confirm only when ≥ 2
  if (tabIds.length < 2) return Promise.resolve(true);

  return new Promise((resolve) => {
    if (confirmOpen) {
      resolve(false);
      return;
    }
    confirmOpen = true;
    pendingConfirm = { tabIds, message, title };
    els.confirmTitle.textContent = title;
    els.confirmMessage.textContent = message;
    els.confirmOk.textContent = `Close ${tabIds.length}`;
    els.confirmModal.hidden = false;
    document.body.classList.add("modal-open");
    els.confirmCancel.focus();

    const cleanup = (ok: boolean) => {
      els.confirmCancel.removeEventListener("click", onCancel);
      els.confirmOk.removeEventListener("click", onOk);
      els.confirmModal.removeEventListener("keydown", onKey);
      els.confirmModal.hidden = true;
      document.body.classList.remove("modal-open");
      confirmOpen = false;
      pendingConfirm = null;
      resolve(ok);
    };
    const onCancel = () => cleanup(false);
    const onOk = () => cleanup(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cleanup(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        cleanup(true);
      } else if (e.key === "Tab") {
        // Simple focus trap between Cancel and Ok
        const focusables = [els.confirmCancel, els.confirmOk];
        const i = focusables.indexOf(document.activeElement as HTMLButtonElement);
        if (e.shiftKey) {
          e.preventDefault();
          focusables[(i - 1 + focusables.length) % focusables.length]!.focus();
        } else {
          e.preventDefault();
          focusables[(i + 1) % focusables.length]!.focus();
        }
      }
    };
    els.confirmCancel.addEventListener("click", onCancel);
    els.confirmOk.addEventListener("click", onOk);
    els.confirmModal.addEventListener("keydown", onKey);
  });
}

/**
 * Collect bulk targets at click time.
 * Selected uses stable keys so we re-resolve to current tabIds from state.
 */
function targetsForBulk(kind: BulkKind): StaleItem[] {
  const eligible = bulkEligibleRows(allRows(), categoryFilter);
  if (kind === "all") return eligible;
  if (kind === "selected") {
    // Re-resolve from full list by key (more robust than filtering eligible only)
    return resolveByKeys(
      filterByCategory(allRows(), categoryFilter),
      selectedKeys,
    );
  }
  return othersBulkRows(eligible, selectedKeys);
}

async function runBulkClose(kind: BulkKind): Promise<void> {
  const targets = targetsForBulk(kind);
  const tabIds = [
    ...new Set(targets.map((r) => r.tabId).filter((id) => id > 0)),
  ];
  if (tabIds.length === 0) {
    els.banner.classList.add("stale");
    els.banner.textContent =
      kind === "selected"
        ? "No tabs selected (or selected tabs are not closable)."
        : "Nothing to close.";
    return;
  }

  const n = tabIds.length;
  let title = "Confirm close";
  let message = `Close ${n} tabs? This cannot be undone.`;
  if (kind === "all") {
    title = "Close all listed";
    message = `Close all ${n} listed closable tab${n === 1 ? "" : "s"}? This cannot be undone.`;
  } else if (kind === "selected") {
    title = "Close selected";
    message = `Close ${n} selected tab${n === 1 ? "" : "s"}? This cannot be undone.`;
  } else {
    title = "Close others";
    message = `Close ${n} tab${n === 1 ? "" : "s"}? This closes the listed tabs you did not select.`;
  }

  const ok = await openConfirm(tabIds, title, message);
  if (!ok) return;

  try {
    const closed = await closeTabs(tabIds);
    clearSelection();
    await load(true); // full refresh so inventory + table match reality
    if (closed === 0) {
      els.banner.classList.add("stale");
      els.banner.textContent =
        "Could not close any of the selected tabs (they may already be gone).";
    }
  } catch (e) {
    els.banner.classList.add("stale");
    els.banner.textContent = `Close failed: ${String(e)}`;
  }
}

// ── Render ──────────────────────────────────────────────────────────────────

function renderBanner(s: ExtensionState): void {
  const days = String(s.config.thresholdDays);
  els.banner.classList.remove("stale", "clear", "empty");
  if (s.staleness.totalOpen === 0) {
    els.banner.classList.add("empty");
    els.banner.textContent = t("bannerEmpty");
    return;
  }
  const rows = s.staleness.stale.length;
  if (rows > 0) {
    els.banner.classList.add("stale");
    if (s.staleness.staleCount > 0) {
      els.banner.textContent = t("bannerStale", [
        String(s.staleness.staleCount),
        days,
      ]);
    } else {
      els.banner.textContent = `You have ${s.staleness.unknownCount} tab(s) with unknown last-used time — review or close them below.`;
    }
  } else {
    els.banner.classList.add("clear");
    els.banner.textContent = t("bannerAllClear", days);
  }
}

function updateFilterLabels(s: ExtensionState): void {
  const c = countByCategory(s.staleness.stale);
  const opts = els.filter.options;
  for (const opt of opts) {
    if (opt.value === "all") opt.textContent = `All (${c.all})`;
    else if (opt.value === "stale") opt.textContent = `Stale (${c.stale})`;
    else if (opt.value === "unknown")
      opt.textContent = `Unknown last-used (${c.unknown})`;
  }
  els.filter.value = categoryFilter;
}

function updateBulkButtons(): void {
  // Bulk actions available in every filter (All / Stale / Unknown)
  els.bulkActions.classList.remove("hidden");

  const eligible = bulkEligibleRows(allRows(), categoryFilter);
  const selected = selectedBulkRows(eligible, selectedKeys);
  const others = othersBulkRows(eligible, selectedKeys);
  const N = eligible.length;
  const K = selected.length;

  const allLabel =
    categoryFilter === "unknown"
      ? "Close all unknown"
      : categoryFilter === "stale"
        ? "Close all stale"
        : "Close all listed";

  els.closeAll.disabled = N === 0;
  els.closeAll.textContent = `${allLabel} (${N})`;

  els.closeSelected.disabled = K === 0;
  els.closeSelected.textContent = `Close selected (${K})`;

  els.closeOthers.disabled = others.length === 0;
  els.closeOthers.textContent = `Close others (${others.length})`;

  els.selectAll.disabled = N === 0;
  if (N === 0) {
    els.selectAll.checked = false;
    els.selectAll.indeterminate = false;
  } else if (K === 0) {
    els.selectAll.checked = false;
    els.selectAll.indeterminate = false;
  } else if (K === N) {
    els.selectAll.checked = true;
    els.selectAll.indeterminate = false;
  } else {
    els.selectAll.checked = false;
    els.selectAll.indeterminate = true;
  }
}

function renderRow(item: StaleItem): HTMLTableRowElement {
  const tr = document.createElement("tr");
  tr.dataset.tabId = String(item.tabId);
  tr.dataset.key = item.key;
  if (item.wayTooOld) tr.classList.add("row-way-too-old");
  if (selectedKeys.has(item.key)) tr.classList.add("row-selected");

  // R9 checkbox — any closable row (stale or unknown); internal pages disabled
  const checkTd = document.createElement("td");
  checkTd.className = "cell-check";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.setAttribute("aria-label", `Select ${item.title || "tab"}`);
  const canSelect = isClosable(item.url) && item.tabId > 0;
  if (!canSelect) {
    cb.disabled = true;
    cb.title = t("internalTooltip");
  } else {
    cb.checked = selectedKeys.has(item.key);
    // Use click as well as change — more reliable across browsers for table cells
    const syncSelection = () => {
      if (cb.checked) selectedKeys.add(item.key);
      else selectedKeys.delete(item.key);
      tr.classList.toggle("row-selected", cb.checked);
      updateBulkButtons();
    };
    cb.addEventListener("change", syncSelection);
    cb.addEventListener("click", (e) => e.stopPropagation());
  }
  checkTd.append(cb);

  const title = document.createElement("td");
  title.className = "cell-title";
  title.textContent = item.title || "(untitled)";
  title.title = item.title;

  const url = document.createElement("td");
  url.className = "cell-url";
  url.textContent = truncateForDisplay(item.url, 56);
  url.title = item.url;

  const first = document.createElement("td");
  const last = document.createElement("td");
  const idle = document.createElement("td");
  idle.className = "cell-idle";

  if (item.wayTooOld) {
    first.textContent = "—";
    first.title =
      "First-opened time unknown (browser did not provide a valid timestamp)";
    first.className = "cell-unknown-meta";
    last.textContent = "—";
    last.title =
      "Last-used time unknown or corrupt (e.g. browser reported epoch 0)";
    last.className = "cell-unknown-meta";
    idle.classList.add("cell-idle-way-too-old");
    idle.textContent = t("idleWayTooOld");
    idle.title =
      "Unknown/corrupt last-used — not counted on the toolbar badge";
  } else {
    first.textContent = formatDate(item.firstOpenedAt);
    first.title = formatTimestamp(item.firstOpenedAt);
    last.textContent = formatDate(item.lastActiveAt);
    last.title = formatTimestamp(item.lastActiveAt);
    idle.textContent = t("idleDays", String(item.idleDays));
  }

  tr.append(
    checkTd,
    title,
    url,
    first,
    last,
    idle,
    makeActionsCell(item, tr),
  );
  return tr;
}

function makeActionsCell(
  item: StaleItem,
  row: HTMLTableRowElement,
): HTMLTableCellElement {
  const actionsTd = document.createElement("td");
  actionsTd.className = "cell-actions";
  const actions = document.createElement("div");
  actions.className = "actions";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = CLOSE_LABEL;
  closeBtn.setAttribute("aria-label", `${CLOSE_LABEL}: ${item.title}`);
  if (!isClosable(item.url)) {
    closeBtn.disabled = true;
    closeBtn.title = t("internalTooltip");
  } else {
    closeBtn.addEventListener("click", async () => {
      // R10: single-tab close — no confirmation
      closeBtn.disabled = true;
      const ok = await closeTab(item.tabId);
      if (ok) {
        selectedKeys.delete(item.key);
        row.remove();
        await load(false);
      } else {
        closeBtn.disabled = false;
      }
    });
  }

  const jumpBtn = document.createElement("button");
  jumpBtn.type = "button";
  jumpBtn.className = "ghost";
  jumpBtn.textContent = JUMP_LABEL;
  jumpBtn.setAttribute("aria-label", `${JUMP_LABEL}: ${item.title}`);
  jumpBtn.title = JUMP_LABEL;
  jumpBtn.addEventListener("click", async () => {
    await jumpToTab(item.tabId);
  });

  actions.append(closeBtn, jumpBtn);
  actionsTd.append(actions);
  return actionsTd;
}

function render(s: ExtensionState): void {
  state = s;

  // R11: auto-clear filter when the viewed category is empty
  if (categoryIsEmpty(s.staleness.stale, categoryFilter)) {
    categoryFilter = "all";
  }

  pruneSelection();

  els.host.textContent = s.hostBrowser;
  els.threshold.textContent = t(
    "thresholdLabel",
    String(s.config.thresholdDays),
  );
  renderBanner(s);
  updateFilterLabels(s);

  els.summary.textContent = t("summary", [
    String(s.staleness.totalOpen),
    String(s.staleness.staleCount),
    String(s.staleness.unknownCount),
  ]);

  const visible = sortRows(visibleRows(), sortKey);
  els.body.replaceChildren(...visible.map(renderRow));
  els.empty.classList.toggle("hidden", visible.length > 0);
  els.empty.textContent =
    s.staleness.stale.length === 0
      ? "No open tabs to analyze in the report."
      : "No tabs match this filter.";

  updateBulkButtons();
}

async function load(fullRefresh: boolean): Promise<void> {
  if (fullRefresh) clearSelection();
  const s = fullRefresh ? await refreshState() : await getState();
  render(s);
}

// ── Modals ──────────────────────────────────────────────────────────────────

async function openOptionsModal(): Promise<void> {
  await optionsPanel.load();
  els.optionsModal.hidden = false;
  document.body.classList.add("modal-open");
  els.optionsModalClose.focus();
}

function closeOptionsModal(): void {
  els.optionsModal.hidden = true;
  document.body.classList.remove("modal-open");
  els.options.focus();
}

// ── Bind ────────────────────────────────────────────────────────────────────

function bind(): void {
  applyI18n();

  els.refresh.addEventListener("click", () => void load(true));
  els.options.addEventListener("click", () => void openOptionsModal());
  els.optionsModalClose.addEventListener("click", () => closeOptionsModal());
  els.optionsModal.addEventListener("click", (e) => {
    if (e.target === els.optionsModal) closeOptionsModal();
  });

  els.sort.addEventListener("change", () => {
    sortKey = els.sort.value as SortKey;
    if (state) render(state);
  });

  // R11 filter
  els.filter.addEventListener("change", () => {
    categoryFilter = els.filter.value as CategoryFilter;
    clearSelection(); // R11: selection resets on filter change
    if (state) render(state);
  });

  // R9 select-all
  els.selectAll.addEventListener("change", () => {
    const eligible = bulkEligibleRows(allRows(), categoryFilter);
    if (els.selectAll.checked) {
      for (const r of eligible) selectedKeys.add(r.key);
    } else {
      for (const r of eligible) selectedKeys.delete(r.key);
    }
    if (state) render(state);
  });

  els.closeAll.addEventListener("click", (e) => {
    e.preventDefault();
    void runBulkClose("all");
  });

  els.closeSelected.addEventListener("click", (e) => {
    e.preventDefault();
    void runBulkClose("selected");
  });

  els.closeOthers.addEventListener("click", (e) => {
    e.preventDefault();
    void runBulkClose("others");
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.optionsModal.hidden && !confirmOpen) {
      closeOptionsModal();
    }
  });
}

bind();
void load(true).catch((e) => {
  els.banner.classList.add("stale");
  els.banner.textContent = `Failed to load: ${String(e)}`;
});
