// 开发辅助：把 build/icon.png 缩放为多尺寸 PNG，并打包成多尺寸 ICO
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csl-ico-'));
const sizes = [16, 24, 32, 48, 64, 128, 256];
const src = path.join(root, 'build', 'icon.png');

// 先规整为 512x512（Electron 捕获可能带高分屏缩放）
const base = await sharp(src)
  .resize(512, 512, { fit: 'cover' })
  .png({ compressionLevel: 9 })
  .toBuffer();
fs.writeFileSync(src, base);
await sharp(base).png({ compressionLevel: 9 }).toFile(path.join(dir, 'icon-512.png'));

const pngs = [];
for (const s of sizes) {
  const file = path.join(dir, `icon-${s}.png`);
  await sharp(base).resize(s, s, { fit: 'cover' }).png().toFile(file);
  pngs.push({ s, data: fs.readFileSync(file) });
}

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(pngs.length, 4);

let offset = 6 + 16 * pngs.length;
const entries = [];
for (const p of pngs) {
  const e = Buffer.alloc(16);
  e.writeUInt8(p.s >= 256 ? 0 : p.s, 0);
  e.writeUInt8(p.s >= 256 ? 0 : p.s, 1);
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(p.data.length, 8);
  e.writeUInt32LE(offset, 12);
  entries.push(e);
  offset += p.data.length;
}

const ico = Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
const out = path.join(root, 'build', 'icon.ico');
fs.writeFileSync(out, ico);
console.log('saved', out, ico.length, 'bytes');
