/**
 * Resize branding/logo-source.jpg into icons/16|32|48|128.png and branding/logo.png
 */
import sharp from "sharp";
import { mkdirSync, existsSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcCandidates = [
  join(root, "branding", "logo-source.jpg"),
  join(root, "branding", "logo-source.png"),
  join(root, "branding", "logo.png"),
];
const src = srcCandidates.find((p) => existsSync(p));
if (!src) {
  console.error("No branding/logo-source.jpg found. Generate a logo first.");
  process.exit(1);
}

const iconsDir = join(root, "icons");
const brandingDir = join(root, "branding");
mkdirSync(iconsDir, { recursive: true });
mkdirSync(brandingDir, { recursive: true });

const logoPng = join(brandingDir, "logo.png");
await sharp(src)
  .resize(512, 512, { fit: "cover" })
  .png()
  .toFile(logoPng);
console.log("wrote", logoPng);

for (const size of [16, 32, 48, 128]) {
  const out = join(iconsDir, `${size}.png`);
  await sharp(src)
    .resize(size, size, { fit: "cover" })
    .png()
    .toFile(out);
  console.log("wrote", out);
}

// Store listing hero (optional square asset)
await sharp(src)
  .resize(440, 280, { fit: "contain", background: { r: 15, g: 20, b: 25, alpha: 1 } })
  .png()
  .toFile(join(brandingDir, "store-tile.png"));
console.log("wrote branding/store-tile.png");
