/**
 * Capture store screenshots from branding/store-screenshots/html/*.html
 * using Chrome/Edge headless. Output: branding/store-screenshots/*.png
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const htmlDir = join(root, "branding", "store-screenshots", "html");
const outDir = join(root, "branding", "store-screenshots");
mkdirSync(outDir, { recursive: true });

const chromeCandidates = [
  join(process.env["ProgramFiles"] || "", "Google/Chrome/Application/chrome.exe"),
  join(process.env["ProgramFiles(x86)"] || "", "Google/Chrome/Application/chrome.exe"),
  join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
  join(process.env["ProgramFiles"] || "", "Microsoft/Edge/Application/msedge.exe"),
  join(process.env["ProgramFiles(x86)"] || "", "Microsoft/Edge/Application/msedge.exe"),
];
const chrome = chromeCandidates.find((p) => existsSync(p));
if (!chrome) {
  console.error("Chrome/Edge not found for headless screenshots");
  process.exit(1);
}

const shots = [
  { html: "report-stale.html", out: "01-report-stale-tabs.png", w: 1280, h: 800 },
  { html: "report-selected.html", out: "02-report-bulk-select.png", w: 1280, h: 800 },
  { html: "report-allclear.html", out: "03-report-all-clear.png", w: 1280, h: 800 },
  { html: "popup.html", out: "04-toolbar-popup.png", w: 1280, h: 800 },
  { html: "options-modal.html", out: "05-options-modal.png", w: 1280, h: 800 },
];

const userData = join(tmpdir(), `btd-shot-${Date.now()}`);
mkdirSync(userData, { recursive: true });

for (const shot of shots) {
  const htmlPath = join(htmlDir, shot.html);
  if (!existsSync(htmlPath)) {
    console.warn("skip missing", shot.html);
    continue;
  }
  const url = pathToFileURL(htmlPath).href;
  const outPath = join(outDir, shot.out);
  execFileSync(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      `--user-data-dir=${userData}`,
      `--window-size=${shot.w},${shot.h}`,
      `--screenshot=${outPath}`,
      url,
    ],
    { stdio: "inherit" },
  );
  console.log("wrote", outPath);
}

console.log("Done. Screenshots in branding/store-screenshots/");
console.log(
  "HTML sources:",
  readdirSync(htmlDir).filter((f) => f.endsWith(".html")).join(", "),
);
