import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "sample-reports");
const file = readdirSync(dir).find((f) => f.endsWith(".html"));
if (!file) throw new Error("no sample html");
const html = readFileSync(join(dir, file), "utf8");

const rows = [...html.matchAll(/<tr data-tab-id="(\d+)">([\s\S]*?)<\/tr>/g)];
console.log("rows", rows.length);

function parseRow(inner) {
  // Each data cell: title/url/first/last/idle (actions has nested buttons)
  const cells = [];
  const re = /<td\b([^>]*)>([\s\S]*?)<\/td>/g;
  let m;
  while ((m = re.exec(inner))) {
    const attrs = m[1];
    const titleMatch = attrs.match(/title="([^"]*)"/);
    const text = m[2].replace(/<[^>]+>/g, "").trim();
    cells.push({ title: titleMatch?.[1] ?? "", text });
  }
  return {
    title: cells[0]?.text?.slice(0, 70),
    url: cells[1]?.title || cells[1]?.text,
    first: cells[2]?.text,
    firstTip: cells[2]?.title,
    last: cells[3]?.text,
    lastTip: cells[3]?.title,
    idle: cells[4]?.text,
  };
}

const parsed = rows.map((m) => ({ tabId: m[1], ...parseRow(m[2]) }));
const epochish = parsed.filter((p) => /1969|1970/.test(`${p.first}${p.last}${p.firstTip}${p.lastTip}`));
const idleCounts = {};
for (const p of parsed) idleCounts[p.idle] = (idleCounts[p.idle] || 0) + 1;

console.log("epoch-like rows", epochish.length, "/", parsed.length);
console.log("idle distribution", idleCounts);

const nonEpoch = parsed.filter((p) => !/1969|1970/.test(`${p.first}${p.last}`));
console.log("non-epoch count", nonEpoch.length);
console.log("sample non-epoch", nonEpoch.slice(0, 10));
console.log("sample epoch", epochish.slice(0, 3));

// Parse tip timestamps if possible
function tipToMs(tip) {
  if (!tip) return null;
  const t = Date.parse(tip);
  return Number.isNaN(t) ? null : t;
}

let zeroish = 0;
let small = 0;
for (const p of parsed) {
  const ms = tipToMs(p.lastTip);
  if (ms != null && ms < 1000) zeroish++;
  if (ms != null && ms < 86_400_000) small++;
}
console.log("lastTip < 1s from epoch", zeroish);
console.log("lastTip < 1 day from epoch", small);

// first > last?
const inverted = parsed.filter((p) => {
  const a = tipToMs(p.firstTip);
  const b = tipToMs(p.lastTip);
  return a != null && b != null && a > b + 1000;
});
console.log("firstOpened > lastUsed", inverted.length);

// banner vs rows
const banner = html.match(/You have (\d+) tabs/);
const summary = html.match(/Open tabs: (\d+)\s+\|\s+Stale: (\d+)\s+\|\s+Unknown last-used: (\d+)/);
console.log("banner", banner?.[1], "summary", summary?.slice(1), "tbody rows", parsed.length);

// first==last always?
const same = parsed.filter((p) => p.firstTip === p.lastTip).length;
console.log("firstTip === lastTip", same, "/", parsed.length);
