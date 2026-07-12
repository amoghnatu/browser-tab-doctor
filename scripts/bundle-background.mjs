/**
 * Re-bundle background.js into a single file (no chunk imports).
 * Safer for Chromium service workers and Firefox event pages.
 */
import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, copyFileSync } from "node:fs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const entry = path.join(root, "src/background/index.ts");

async function bundleTo(outfile) {
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    outfile,
    format: "esm",
    platform: "browser",
    target: ["chrome121", "firefox121"],
    sourcemap: true,
    // webextension-polyfill expects a browser-like global
    define: {
      "process.env.NODE_ENV": '"production"',
    },
  });
}

const outRoot = path.join(root, "dist", "background.js");
await bundleTo(outRoot);

for (const browser of ["chromium", "firefox"]) {
  const dir = path.join(root, "dist", browser);
  if (!existsSync(dir)) continue;
  copyFileSync(outRoot, path.join(dir, "background.js"));
  const map = `${outRoot}.map`;
  if (existsSync(map)) {
    copyFileSync(map, path.join(dir, "background.js.map"));
  }
}

console.log("[bundle-background] wrote single-file background.js");
