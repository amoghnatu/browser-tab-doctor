/**
 * Post-build package integrity check against Spec packaging requirements.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let failed = 0;

function ok(msg) {
  console.log(`  ✓ ${msg}`);
}
function fail(msg) {
  console.error(`  ✗ ${msg}`);
  failed++;
}

function checkBrowser(name) {
  console.log(`\n[${name}]`);
  const dir = path.join(root, "dist", name);
  if (!existsSync(dir)) {
    fail(`missing dist/${name}`);
    return;
  }

  const required = [
    "manifest.json",
    "background.js",
    "popup.html",
    "popup.js",
    "report.html",
    "report.js",
    "options.html",
    "options.js",
    "icons/16.png",
    "icons/32.png",
    "icons/48.png",
    "icons/128.png",
    "_locales/en/messages.json",
  ];
  for (const r of required) {
    const p = path.join(dir, r);
    if (existsSync(p) && statSync(p).size > 0) ok(r);
    else fail(`missing or empty: ${r}`);
  }

  const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf-8"));
  if (manifest.manifest_version !== 3) fail("manifest_version !== 3");
  else ok("manifest_version 3");

  const perms = new Set(manifest.permissions ?? []);
  for (const p of ["tabs", "storage", "alarms"]) {
    if (perms.has(p)) ok(`permission:${p}`);
    else fail(`missing permission:${p}`);
  }

  // No host_permissions / content_scripts (privacy posture)
  if (manifest.host_permissions) fail("unexpected host_permissions");
  else ok("no host_permissions");
  if (manifest.content_scripts) fail("unexpected content_scripts");
  else ok("no content_scripts");

  if (name === "chromium") {
    if (manifest.background?.service_worker === "background.js") ok("service_worker");
    else fail("chromium background.service_worker");
  }
  if (name === "firefox") {
    if (manifest.background?.scripts?.includes("background.js")) ok("background.scripts");
    else fail("firefox background.scripts");
    if (manifest.browser_specific_settings?.gecko?.id) ok("gecko id");
    else fail("missing gecko id");
  }

  const bg = readFileSync(path.join(dir, "background.js"), "utf-8");
  for (const needle of [
    "onInstalled",
    "onStartup",
    "onCreated",
    "onActivated",
    "onUpdated",
    "onRemoved",
    "onAlarm",
    "onMessage",
    "setBadgeText",
    "daily-check",
    "recompute",
  ]) {
    if (bg.includes(needle)) ok(`background contains ${needle}`);
    else fail(`background missing ${needle}`);
  }

  // Single-file: no relative chunk imports
  if (/^import\s+.+from\s+["']\.\//m.test(bg)) {
    fail("background still has relative imports (expected single-file bundle)");
  } else {
    ok("background is self-contained (no relative imports)");
  }

  for (const html of ["popup.html", "report.html", "options.html"]) {
    const content = readFileSync(path.join(dir, html), "utf-8");
    if (content.includes('src="./') || content.includes("src='./")) ok(`${html} relative script`);
    else if (content.includes("src=")) {
      // still ok if module path is relative without ./
      if (/src="\//.test(content)) fail(`${html} absolute / script path`);
      else ok(`${html} has script`);
    } else fail(`${html} no script tag`);
  }
}

console.log("Validating Browser Tab Doctor packages…");
checkBrowser("chromium");
checkBrowser("firefox");

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll package checks passed.");
