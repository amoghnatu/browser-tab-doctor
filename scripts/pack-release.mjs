/**
 * Zip dist/chromium and dist/firefox for store upload.
 * Output: release/browser-tab-doctor-{chromium|firefox}-{version}.zip
 *
 * Cross-platform: PowerShell Compress-Archive on Windows, `zip` on macOS/Linux.
 */
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { platform } from "node:os";

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

function zipDir(sourceDir, outZip) {
  if (existsSync(outZip)) unlinkSync(outZip);

  if (platform() === "win32") {
    const ps = `
      Compress-Archive -Path '${join(sourceDir, "*").replace(/'/g, "''")}' -DestinationPath '${outZip.replace(/'/g, "''")}' -Force
    `;
    execFileSync("powershell.exe", ["-NoProfile", "-Command", ps], {
      stdio: "inherit",
    });
    return;
  }

  // Unix: zip contents of sourceDir so manifest.json is at zip root
  execFileSync("zip", ["-r", "-q", outZip, "."], {
    cwd: sourceDir,
    stdio: "inherit",
  });
}

const targets = [
  {
    dir: join(root, "dist", "chromium"),
    name: `browser-tab-doctor-chromium-${version}.zip`,
  },
  {
    dir: join(root, "dist", "firefox"),
    name: `browser-tab-doctor-firefox-${version}.zip`,
  },
];

for (const t of targets) {
  assertPackage(t.dir, t.name);
  const out = join(releaseDir, t.name);
  zipDir(t.dir, out);
  const size = statSync(out).size;
  console.log(`wrote ${out} (${size} bytes)`);
}

console.log("Done. Upload these to Chrome Web Store / AMO.");
