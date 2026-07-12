import { defineConfig, type Plugin } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";

const root = path.dirname(fileURLToPath(import.meta.url));

function walkFiles(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walkFiles(full, base));
    } else {
      out.push(path.relative(base, full));
    }
  }
  return out;
}

function extensionPackager(): Plugin {
  return {
    name: "extension-packager",
    closeBundle() {
      const outDir = path.resolve(root, "dist");
      const chromiumDir = path.join(outDir, "chromium");
      const firefoxDir = path.join(outDir, "firefox");

      for (const dir of [chromiumDir, firefoxDir]) {
        mkdirSync(dir, { recursive: true });
      }

      for (const asset of ["background.js", "popup.js", "report.js", "options.js"]) {
        const src = path.join(outDir, asset);
        if (existsSync(src)) {
          copyFileSync(src, path.join(chromiumDir, asset));
          copyFileSync(src, path.join(firefoxDir, asset));
        }
        const map = `${asset}.map`;
        const mapSrc = path.join(outDir, map);
        if (existsSync(mapSrc)) {
          copyFileSync(mapSrc, path.join(chromiumDir, map));
          copyFileSync(mapSrc, path.join(firefoxDir, map));
        }
      }

      for (const folder of ["chunks", "assets"]) {
        const src = path.join(outDir, folder);
        if (existsSync(src)) {
          cpSync(src, path.join(chromiumDir, folder), { recursive: true });
          cpSync(src, path.join(firefoxDir, folder), { recursive: true });
        }
      }

      const htmlNames = ["popup.html", "report.html", "options.html"];
      for (const html of htmlNames) {
        const candidates = [
          path.join(outDir, html),
          path.join(outDir, "src", path.basename(html, ".html"), html),
        ];
        const found =
          candidates.find((c) => existsSync(c)) ??
          walkFiles(outDir)
            .filter((f) => f.replace(/\\/g, "/").endsWith(html))
            .map((f) => path.join(outDir, f))[0];

        if (!found || !existsSync(found)) {
          console.warn(`[extension-packager] missing ${html}`);
          continue;
        }

        let content = readFileSync(found, "utf-8");
        content = content
          .replace(/(src|href)="(?:\.\.\/)+([^"]+)"/g, '$1="./$2"')
          .replace(/(src|href)="\/([^"]+)"/g, '$1="./$2"')
          .replace(/\s+crossorigin(?:="[^"]*")?/g, "");

        writeFileSync(path.join(chromiumDir, html), content);
        writeFileSync(path.join(firefoxDir, html), content);
      }

      const iconsSrc = path.join(root, "icons");
      if (existsSync(iconsSrc)) {
        cpSync(iconsSrc, path.join(chromiumDir, "icons"), { recursive: true });
        cpSync(iconsSrc, path.join(firefoxDir, "icons"), { recursive: true });
      }

      const localesSrc = path.join(root, "_locales");
      if (existsSync(localesSrc)) {
        cpSync(localesSrc, path.join(chromiumDir, "_locales"), { recursive: true });
        cpSync(localesSrc, path.join(firefoxDir, "_locales"), { recursive: true });
      }

      const chromiumManifest = path.join(root, "manifest.chromium.json");
      const firefoxManifest = path.join(root, "manifest.firefox.json");
      if (existsSync(chromiumManifest)) {
        copyFileSync(chromiumManifest, path.join(chromiumDir, "manifest.json"));
      }
      if (existsSync(firefoxManifest)) {
        copyFileSync(firefoxManifest, path.join(firefoxDir, "manifest.json"));
      }

      for (const dir of [chromiumDir, firefoxDir]) {
        const required = [
          "manifest.json",
          "background.js",
          "popup.html",
          "report.html",
          "options.html",
          "icons/16.png",
          "_locales/en/messages.json",
        ];
        const missing = required.filter((r) => !existsSync(path.join(dir, r)));
        if (missing.length) {
          console.warn(`[extension-packager] ${path.basename(dir)} missing:`, missing);
        }
      }

      console.log("[extension-packager] Built dist/chromium and dist/firefox");
    },
  };
}

export default defineConfig({
  root,
  base: "./",
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
    modulePreload: false,
    rollupOptions: {
      input: {
        background: path.resolve(root, "src/background/index.ts"),
        popup: path.resolve(root, "src/popup/popup.html"),
        report: path.resolve(root, "src/report/report.html"),
        options: path.resolve(root, "src/options/options.html"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  plugins: [extensionPackager()],
});
