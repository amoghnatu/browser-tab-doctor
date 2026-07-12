/**
 * Zip dist/chromium and dist/firefox for store upload.
 * Output: release/browser-tab-doctor-{chromium|firefox}-{version}.zip
 */
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { pipeline } from "node:stream/promises";

// Use Node 20+ zlib + manual zip via archiver-free approach: PowerShell-compatible
// pure zip using only built-ins is painful; prefer child_process Compress-Archive on win,
// or write a minimal store-compatible zip with the 'fflate' if present.
// Simplest reliable cross-platform: use Node's child_process for best-effort.

import { execFileSync } from "node:child_process";
import { dirname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = pkg.version;
const releaseDir = join(root, "release");
mkdirSync(releaseDir, { recursive: true });

function assertPackage(dir, label) {
  const manifest = join(dir, "manifest.json");
  if (!existsSync(manifest)) {
    throw new Error(`Missing ${label} package at ${dir} — run npm run build first`);
  }
}

function zipWithPowerShell(sourceDir, outZip) {
  const ps = `
    if (Test-Path -LiteralPath '${outZip.replace(/'/g, "''")}') {
      Remove-Item -LiteralPath '${outZip.replace(/'/g, "''")}' -Force
    }
    Compress-Archive -Path '${join(sourceDir, "*").replace(/'/g, "''")}' -DestinationPath '${outZip.replace(/'/g, "''")}' -Force
  `;
  execFileSync(
    "powershell.exe",
    ["-NoProfile", "-Command", ps],
    { stdio: "inherit" },
  );
}

const targets = [
  { dir: join(root, "dist", "chromium"), name: `browser-tab-doctor-chromium-${version}.zip` },
  { dir: join(root, "dist", "firefox"), name: `browser-tab-doctor-firefox-${version}.zip` },
];

for (const t of targets) {
  assertPackage(t.dir, t.name);
  const out = join(releaseDir, t.name);
  zipWithPowerShell(t.dir, out);
  const size = statSync(out).size;
  console.log(`wrote ${out} (${size} bytes)`);
}

console.log("Done. Upload these to Chrome Web Store / AMO.");
