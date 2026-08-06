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
import { formatHostBrowserLabel } from "../lib/browser-info";
import browser from "webextension-polyfill";
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

/** Manifest version (e.g. 1.1.1) for the report header. */
function getExtensionVersion(): string {
  try {
    return browser.runtime.getManifest()?.version ?? "";
  } catch {
    return "";
  }
}

/** Fun sticky notes — pure flavor, no product effect. */
const FUN_NOTE_MID_MIN_DAYS = 30;
const FUN_NOTE_ANCIENT_MIN_DAYS = 90;

type FunNoteBand = "mid" | "ancient";

const FUN_NOTE_SESSION_KEYS: Record<FunNoteBand, string> = {
  mid: "btd-fun-note-mid-dismissed",
  ancient: "btd-fun-note-ancient-dismissed",
};

/**
 * Snarky doctor's notes per age band.
 * One is picked at random when the note first appears (stable while visible).
 */
const FUN_PROMPTS_MID = [
  "These have been loitering for a month-ish. Suspicious activity detected.",
  "Not fossils yet — just mildly neglected and moderately judged.",
  "Your tabs called. They miss being useful.",
  "Dust settling. Ambitions fading. Tabs enduring.",
  "Thirty days of “I’ll get to it.” Bold strategy.",
  "These are past “maybe later” and deep into “or never.”",
  "Mild case of tab hoarding. Prognosis: freckles of guilt.",
  "Still open. Still unread. Still somehow essential, right?",
  "If procrastination were a sport, these would be mid-season MVPs.",
  "They’re not ancient. They’re just… aging in place. Aggressively.",
];

const FUN_PROMPTS_ANCIENT = [
  "These tabs have been idle so long they need a fossil permit.",
  "Archaeology department on line one about your browser.",
  "If tabs could vote, these would qualify for senior discounts.",
  "Still hoping these reincarnate as life-changing bookmarks?",
  "Carbon dating suggests you opened these during another era.",
  "These tabs remember a time before you had that haircut.",
  "Ninety days. The tabs have unionized. Demands pending.",
  "Not abandoned — “long-term ambient storage.” Totally different.",
  "I’d prescribe closure, but only you can write that script.",
  "Congratulations: you’ve achieved museum-grade tab preservation.",
];

const FUN_PROMPTS: Record<FunNoteBand, readonly string[]> = {
  mid: FUN_PROMPTS_MID,
  ancient: FUN_PROMPTS_ANCIENT,
};

const FUN_REPLIES: Record<"yes" | "no" | "maybe", string[]> = {
  yes: [
    "Bold. Living the multi-tab dream.",
    "Respect. Optimism is a lifestyle.",
    "Noted. The doctor will look away.",
    "Denial looks good on you. Carry on.",
  ],
  no: [
    "Close is right there. No judgment (okay, mild judgment).",
    "Good call. Your future self just sighed with relief.",
    "Doctor’s optional orders: prune when ready.",
    "Finally. The tabs can rest in peace (or the recycle bin).",
  ],
  maybe: [
    "Classic. We’ll pretend that answers something.",
    "The diplomatic option. Tabs remain in limbo.",
    "Schrödinger’s tabs: both needed and not.",
    "“Maybe” is just “yes” wearing a trench coat.",
  ],
};

/** Stable random pick while a note stays on screen. */
const funNotePromptPick: Partial<Record<FunNoteBand, string>> = {};

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
  diag: document.getElementById("diag-text")!,
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
  funNoteMid: document.getElementById("fun-note-mid") as HTMLElement,
  funNoteMidText: document.getElementById("fun-note-mid-text")!,
  funNoteMidReply: document.getElementById("fun-note-mid-reply")!,
  funNoteMidActions: document.getElementById("fun-note-mid-actions")!,
  funNoteMidDismiss: document.getElementById(
    "fun-note-mid-dismiss",
  ) as HTMLButtonElement,
  funNoteAncient: document.getElementById("fun-note-ancient") as HTMLElement,
  funNoteAncientText: document.getElementById("fun-note-ancient-text")!,
  funNoteAncientReply: document.getElementById("fun-note-ancient-reply")!,
  funNoteAncientActions: document.getElementById("fun-note-ancient-actions")!,
  funNoteAncientDismiss: document.getElementById(
    "fun-note-ancient-dismiss",
  ) as HTMLButtonElement,
};

type FunNoteEls = {
  root: HTMLElement;
  text: HTMLElement;
  reply: HTMLElement;
  actions: HTMLElement;
  dismiss: HTMLButtonElement;
  rowSelector: string;
  detail: (count: number) => string;
};

function funNoteEls(band: FunNoteBand): FunNoteEls {
  if (band === "mid") {
    return {
      root: els.funNoteMid,
      text: els.funNoteMidText,
      reply: els.funNoteMidReply,
      actions: els.funNoteMidActions,
      dismiss: els.funNoteMidDismiss,
      rowSelector: "tr.row-mid-age",
      detail: (n) =>
        n === 1
          ? "← this one's been idle 30–89 days."
          : `← these ${n} have been idle 30–89 days.`,
    };
  }
  return {
    root: els.funNoteAncient,
    text: els.funNoteAncientText,
    reply: els.funNoteAncientReply,
    actions: els.funNoteAncientActions,
    dismiss: els.funNoteAncientDismiss,
    rowSelector: "tr.row-ancient",
    detail: (n) =>
      n === 1
        ? "← this one has been idle 90+ days."
        : `← these ${n} have been idle 90+ days.`,
  };
}

/** Random snarky line for a band; sticky while the note stays visible. */
function pickFunPrompt(band: FunNoteBand): string {
  const existing = funNotePromptPick[band];
  if (existing) return existing;
  const list = FUN_PROMPTS[band];
  const line = list[Math.floor(Math.random() * list.length)] ?? list[0]!;
  funNotePromptPick[band] = line;
  return line;
}

function clearFunPromptPick(band: FunNoteBand): void {
  delete funNotePromptPick[band];
}

const optionsPanel = createOptionsPanel({
  onSaved: () => {
    closeOptionsModal();
    void load(true);
  },
});
els.optionsModalBody.append(optionsPanel.root);

// ── View helpers ────────────────────────────────────────────────────────────

/** Collapse any accidental duplicate report rows (same live tabId). */
function dedupeRowsByTabId(rows: StaleItem[]): StaleItem[] {
  const byId = new Map<number, StaleItem>();
  for (const r of rows) {
    const id = Number(r.tabId);
    if (!Number.isFinite(id) || id <= 0) continue;
    const prev = byId.get(id);
    if (!prev || r.lastSeenAt >= prev.lastSeenAt) byId.set(id, r);
  }
  return [...byId.values()];
}

function allRows(): StaleItem[] {
  return dedupeRowsByTabId(state?.staleness.stale ?? []);
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
  const keys = [...new Set(targets.map((r) => r.key).filter(Boolean))];
  if (tabIds.length === 0 && keys.length === 0) {
    els.banner.classList.add("stale");
    els.banner.textContent =
      kind === "selected"
        ? "No tabs selected (or selected tabs are not closable)."
        : "Nothing to close.";
    return;
  }

  const n = Math.max(tabIds.length, keys.length);
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
    // Pass stable keys so background re-resolves live tabIds after reconcile
    const closed = await closeTabs(tabIds, keys);
    clearSelection();
    await load(true); // full refresh so inventory + table match reality
    if (closed === 0) {
      els.banner.classList.add("stale");
      els.banner.textContent =
        "Could not close any of the selected tabs (they may already be gone, or were stale list entries). Try Refresh.";
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

  const listedRows = filterByCategory(allRows(), categoryFilter);
  const eligible = bulkEligibleRows(allRows(), categoryFilter);
  const selected = selectedBulkRows(eligible, selectedKeys);
  const others = othersBulkRows(eligible, selectedKeys);
  const N = eligible.length;
  const K = selected.length;
  const listed = listedRows.length;
  const skipped = Math.max(0, listed - N);

  const allLabel =
    categoryFilter === "unknown"
      ? "Close all closable unknown"
      : categoryFilter === "stale"
        ? "Close all closable stale"
        : "Close all closable listed";

  els.closeAll.disabled = N === 0;
  els.closeAll.textContent = `${allLabel} (${N})`;
  els.closeAll.title =
    skipped > 0
      ? `Closes ${N} of ${listed} listed tabs. Skips ${skipped} browser-internal page(s) the extension cannot close (chrome://, about:, …).`
      : `Closes all ${N} currently listed tab${N === 1 ? "" : "s"} in this filter.`;

  els.closeSelected.disabled = K === 0;
  els.closeSelected.textContent = `Close selected (${K})`;
  els.closeSelected.title =
    K === 0
      ? "Select rows with the checkboxes first."
      : `Close the ${K} selected closable tab${K === 1 ? "" : "s"}.`;

  els.closeOthers.disabled = others.length === 0;
  els.closeOthers.textContent = `Close others (${others.length})`;
  els.closeOthers.title =
    others.length === 0
      ? "No other closable listed tabs outside your selection."
      : `Close the ${others.length} closable listed tab${others.length === 1 ? "" : "s"} that are not selected.`;

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
  // Hover any row to see identity (helps verify “duplicate” = two real tabs)
  tr.title = `tabId=${item.tabId} · key=${item.key.slice(0, 8)}… · idle=${item.idleDays}d`;
  if (item.wayTooOld) tr.classList.add("row-way-too-old");
  if (isAncientTab(item)) tr.classList.add("row-ancient");
  else if (isMidAgeTab(item)) tr.classList.add("row-mid-age");
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
  // Honor privacy.truncateUrls — option label: "Truncate URLs in report"
  const shouldTruncate = state?.config.privacy.truncateUrls === true;
  if (shouldTruncate) {
    url.textContent = truncateForDisplay(item.url, 40);
    url.classList.add("cell-url-truncated");
    url.title = item.url; // full URL on hover
  } else {
    url.textContent = item.url;
    url.title = item.url;
  }

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
  if (!isClosable(item.url) || item.tabId <= 0) {
    closeBtn.disabled = true;
    closeBtn.title =
      item.tabId <= 0
        ? "Tab id unknown — hit Refresh, then try again"
        : t("internalTooltip");
  } else {
    closeBtn.addEventListener("click", async () => {
      // R10: single-tab close — no confirmation
      closeBtn.disabled = true;
      try {
        // Pass stable key so background can find the live tab even if tabId is stale
        const result = await closeTab(item.tabId, item.key);
        selectedKeys.delete(item.key);
        if (result.ok) {
          row.remove();
        } else {
          els.banner.classList.remove("clear", "empty");
          els.banner.classList.add("stale");
          els.banner.textContent =
            result.error ?? "Could not close that tab. Try Refresh, then Close again.";
        }
        // Always full refresh — clears ghost duplicates / repairs inventory
        await load(true);
      } catch (e) {
        closeBtn.disabled = false;
        els.banner.classList.add("stale");
        els.banner.textContent = `Close failed: ${String(e)}`;
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
    const result = await jumpToTab(item.tabId, item.key);
    if (!result.ok) {
      els.banner.classList.remove("clear", "empty");
      els.banner.classList.add("stale");
      els.banner.textContent =
        result.error ?? "Could not jump to that tab. Try Refresh.";
      await load(true);
    }
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

  // e.g. "Google Chrome 151" + extension 1.1.1
  const extVersion = getExtensionVersion();
  const host = formatHostBrowserLabel(s.hostBrowser, extVersion);
  els.host.textContent = host.text;
  els.host.title = host.title;
  els.threshold.textContent = t(
    "thresholdLabel",
    String(s.config.thresholdDays),
  );
  renderBanner(s);
  updateFilterLabels(s);

  // totalOpen = live browser tabs (synced 1:1); table only lists stale + unknown.
  const open = s.staleness.totalOpen;
  const staleN = s.staleness.staleCount;
  const unknownN = s.staleness.unknownCount;
  const listedN = allRows().length; // after client-side tabId dedupe
  const rawListed = s.staleness.stale.length;
  const freshN = Math.max(0, open - listedN);
  els.summary.textContent = t("summary", [
    String(open),
    String(staleN),
    String(unknownN),
    String(freshN),
  ]);
  els.summary.title = [
    `${open} tabs are open in this browser profile (live browser count).`,
    `${staleN} are stale: unused for at least your threshold, with a known last-used time.`,
    `${unknownN} have unknown/corrupt last-used time (listed, but not counted on the badge).`,
    `${freshN} are recent enough that they are not listed in this report.`,
    `Listed rows now: ${listedN}${rawListed !== listedN ? ` (collapsed ${rawListed - listedN} duplicate tab ids)` : ""}.`,
    `Bulk “close … closable” only targets listed rows the extension can close (skips chrome://, about:, etc.).`,
  ].join(" ");

  // Diagnostics: tells us inventory ghosts vs real double tabs
  const d = s.diagnostics;
  if (d && els.diag) {
    const invOk = d.liveTabCount === d.openRecordCount;
    els.diag.textContent = [
      `Diagnostics · ext ${d.extensionVersion || "?"}`,
      `live tabs ${d.liveTabCount}`,
      `open records ${d.openRecordCount}${invOk ? " ✓" : " ✗ MISMATCH"}`,
      `listed ${d.listedRowCount}`,
      `same-URL extras among listed ${d.listedSameUrlExtras}`,
      d.ghostsClosedThisSync > 0
        ? `ghosts closed this load ${d.ghostsClosedThisSync}`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
    els.diag.title = invOk
      ? "Inventory matches live tabs (1 record per browser tab). If two rows look the same, they are two real open tabs (check tab id on hover)."
      : "BUG: open records ≠ live tabs. Capture this line and report it.";
    els.diag.classList.toggle("diag-bad", !invOk);
  }

  const visible = sortRows(visibleRows(), sortKey);
  els.body.replaceChildren(...visible.map(renderRow));
  els.empty.classList.toggle("hidden", visible.length > 0);
  els.empty.textContent =
    s.staleness.stale.length === 0
      ? "No open tabs to analyze in the report."
      : "No tabs match this filter.";

  updateBulkButtons();
  updateFunNote(visible);
}

/** Mid-age: slightly older, not quite fossils (30–89 days). */
function isMidAgeTab(r: StaleItem): boolean {
  if (r.wayTooOld) return false;
  return r.idleDays >= FUN_NOTE_MID_MIN_DAYS && r.idleDays < FUN_NOTE_ANCIENT_MIN_DAYS;
}

/** Fossils: extremely idle tabs (90+ days or way-too-old). */
function isAncientTab(r: StaleItem): boolean {
  return r.wayTooOld || r.idleDays >= FUN_NOTE_ANCIENT_MIN_DAYS;
}

function countBand(rows: StaleItem[], band: FunNoteBand): number {
  return rows.filter(band === "mid" ? isMidAgeTab : isAncientTab).length;
}

function isFunNoteDismissed(band: FunNoteBand): boolean {
  try {
    return sessionStorage.getItem(FUN_NOTE_SESSION_KEYS[band]) === "1";
  } catch {
    return false;
  }
}

function dismissFunNote(band: FunNoteBand): void {
  try {
    sessionStorage.setItem(FUN_NOTE_SESSION_KEYS[band], "1");
  } catch {
    // ignore
  }
  hideFunNote(band);
  syncFunNoteLayoutClass();
}

function hideFunNote(band: FunNoteBand): void {
  const n = funNoteEls(band);
  n.root.hidden = true;
  n.root.classList.add("hidden");
  n.root.style.top = "";
  n.root.style.right = "";
  clearFunPromptPick(band);
}

function anyFunNoteVisible(): boolean {
  return (
    (!els.funNoteMid.hidden && !els.funNoteMid.classList.contains("hidden")) ||
    (!els.funNoteAncient.hidden &&
      !els.funNoteAncient.classList.contains("hidden"))
  );
}

function syncFunNoteLayoutClass(): void {
  const main = els.funNoteMid.parentElement ?? els.funNoteAncient.parentElement;
  main?.classList.toggle("has-fun-note", anyFunNoteVisible());
}

function showFunNote(band: FunNoteBand, count: number): void {
  const n = funNoteEls(band);
  const alreadyOpen =
    !n.root.hidden && !n.root.classList.contains("hidden");
  const prompt = pickFunPrompt(band);
  // Keep yes/no/maybe reply state if we're only re-rendering the table
  if (!alreadyOpen) {
    n.reply.textContent = "";
    n.reply.classList.add("hidden");
    n.actions.classList.remove("hidden");
  }
  n.text.textContent = `${prompt} ${n.detail(count)}`;
  n.root.hidden = false;
  n.root.classList.remove("hidden");
  syncFunNoteLayoutClass();
}

/**
 * Pin each sticky note’s top to the first matching band row
 * so it clearly refers to those tabs (not the toolbar).
 */
function positionFunNotes(): void {
  const bands: FunNoteBand[] = ["mid", "ancient"];
  const main = els.funNoteMid.parentElement;
  if (!main) return;

  const narrow = window.matchMedia("(max-width: 1179px)").matches;
  const placed: { top: number; height: number }[] = [];

  for (const band of bands) {
    const n = funNoteEls(band);
    if (n.root.hidden || n.root.classList.contains("hidden")) continue;

    if (narrow) {
      n.root.style.top = "";
      n.root.style.right = "";
      continue;
    }

    const first = els.body.querySelector(n.rowSelector) as HTMLElement | null;
    if (!first) continue;

    const mainRect = main.getBoundingClientRect();
    const rowRect = first.getBoundingClientRect();
    let top = rowRect.top - mainRect.top + main.scrollTop;

    // Avoid stacking on top of a previously placed note
    for (const p of placed) {
      const overlap = top < p.top + p.height + 12 && top + n.root.offsetHeight > p.top;
      if (overlap) {
        top = p.top + p.height + 14;
      }
    }

    const maxTop = Math.max(0, main.scrollHeight - n.root.offsetHeight - 8);
    top = Math.min(Math.max(0, top), maxTop);

    n.root.style.top = `${Math.round(top)}px`;
    n.root.style.right = "0";
    placed.push({ top, height: n.root.offsetHeight });
  }
}

function updateFunNote(visible: StaleItem[]): void {
  for (const band of ["mid", "ancient"] as const) {
    if (isFunNoteDismissed(band)) {
      hideFunNote(band);
      continue;
    }
    const n = countBand(visible, band);
    if (n === 0) {
      hideFunNote(band);
      continue;
    }
    showFunNote(band, n);
  }
  syncFunNoteLayoutClass();
  // Align after layout paints so row offsets are correct
  requestAnimationFrame(() => positionFunNotes());
}

function onFunAnswer(band: FunNoteBand, answer: "yes" | "no" | "maybe"): void {
  const n = funNoteEls(band);
  const options = FUN_REPLIES[answer];
  const line = options[Math.floor(Math.random() * options.length)] ?? "";
  n.reply.textContent = line;
  n.reply.classList.remove("hidden");
  n.actions.classList.add("hidden");
  // Reposition after height change from reply text
  requestAnimationFrame(() => positionFunNotes());
  // Auto-dismiss after a beat so it stays light
  window.setTimeout(() => dismissFunNote(band), 2800);
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

  for (const band of ["mid", "ancient"] as const) {
    const n = funNoteEls(band);
    n.dismiss.addEventListener("click", () => dismissFunNote(band));
    n.actions.querySelectorAll<HTMLButtonElement>("[data-fun]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const a = btn.dataset.fun;
        if (a === "yes" || a === "no" || a === "maybe") onFunAnswer(band, a);
      });
    });
  }

  window.addEventListener("resize", () => {
    positionFunNotes();
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
