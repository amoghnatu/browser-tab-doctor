/**
 * Generate simple PNG icons (16/32/48/128) without external deps.
 * Draws a dark rounded square with a red "pulse" accent — Tab Doctor branding.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "icons");
mkdirSync(outDir, { recursive: true });

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    }
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4);
  const crc = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crc);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function png(size) {
  const { width, height } = { width: size, height: size };
  // RGBA raw rows with filter byte 0
  const rowSize = 1 + width * 4;
  const raw = Buffer.alloc(rowSize * height);

  const bg = [15, 20, 25, 255];
  const accent = [192, 57, 43, 255];
  const soft = [36, 48, 68, 255];

  for (let y = 0; y < height; y++) {
    const row = y * rowSize;
    raw[row] = 0; // filter None
    for (let x = 0; x < width; x++) {
      const i = row + 1 + x * 4;
      const nx = (x + 0.5) / width;
      const ny = (y + 0.5) / height;
      // rounded rect margin
      const m = 0.08;
      const inBox = nx > m && nx < 1 - m && ny > m && ny < 1 - m;
      // cross / tab shape
      const tabTop = ny > 0.22 && ny < 0.42 && nx > 0.2 && nx < 0.8;
      const body = ny >= 0.38 && ny < 0.78 && nx > 0.28 && nx < 0.72;
      const dot = (nx - 0.72) ** 2 + (ny - 0.28) ** 2 < 0.012;

      let c = bg;
      if (inBox) c = soft;
      if (tabTop || body) c = accent;
      if (dot) c = [255, 220, 210, 255];

      raw[i] = c[0];
      raw[i + 1] = c[1];
      raw[i + 2] = c[2];
      raw[i + 3] = c[3];
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = deflateSync(raw);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of [16, 32, 48, 128]) {
  const file = join(outDir, `${size}.png`);
  writeFileSync(file, png(size));
  console.log("wrote", file);
}
