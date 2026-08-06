/**
 * Bump extension version in package.json + both manifests.
 *
 * Usage:
 *   node scripts/bump-version.mjs 1.2.0
 *   node scripts/bump-version.mjs patch   # 1.1.4 → 1.1.5
 *   node scripts/bump-version.mjs minor   # 1.1.4 → 1.2.0
 *   node scripts/bump-version.mjs major   # 1.1.4 → 2.0.0
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv[2];
if (!arg) {
  console.error("Usage: node scripts/bump-version.mjs <x.y.z|patch|minor|major>");
  process.exit(1);
}

function parseSemver(v) {
  const m = String(v).trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`Invalid semver: ${v}`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function format({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

const pkgPath = join(root, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const current = parseSemver(pkg.version);

let next;
if (arg === "patch") next = { ...current, patch: current.patch + 1 };
else if (arg === "minor") next = { major: current.major, minor: current.minor + 1, patch: 0 };
else if (arg === "major") next = { major: current.major + 1, minor: 0, patch: 0 };
else next = parseSemver(arg);

const version = format(next);
pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

for (const name of ["manifest.chromium.json", "manifest.firefox.json"]) {
  const p = join(root, name);
  const m = JSON.parse(readFileSync(p, "utf8"));
  m.version = version;
  writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
}

console.log(`version ${format(current)} → ${version}`);
console.log("Updated package.json, manifest.chromium.json, manifest.firefox.json");
