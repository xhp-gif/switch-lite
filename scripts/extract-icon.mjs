// 开发辅助：从 exe 的 PE 资源里提取最大尺寸的图标（256 通常为 PNG）
import fs from 'node:fs';

const exePath = process.argv[2];
const outPath = process.argv[3];
const buf = fs.readFileSync(exePath);

const eLfanew = buf.readUInt32LE(0x3c);
const numSections = buf.readUInt16LE(eLfanew + 6);
const optSize = buf.readUInt16LE(eLfanew + 20);
const optStart = eLfanew + 24;
const magic = buf.readUInt16LE(optStart);
const ddStart = optStart + (magic === 0x20b ? 112 : 96);
const rsrcRva = buf.readUInt32LE(ddStart + 2 * 8);

const sections = [];
let secStart = optStart + optSize;
for (let i = 0; i < numSections; i++) {
  const off = secStart + i * 40;
  sections.push({
    name: buf.toString('ascii', off, off + 8).replace(/\0.*$/, ''),
    va: buf.readUInt32LE(off + 12),
    rawSize: buf.readUInt32LE(off + 16),
    rawPtr: buf.readUInt32LE(off + 20),
    vSize: buf.readUInt32LE(off + 8),
  });
}

function rvaToOff(rva) {
  for (const s of sections) {
    const span = Math.max(s.vSize, s.rawSize);
    if (rva >= s.va && rva < s.va + span) return s.rawPtr + (rva - s.va);
  }
  throw new Error('RVA not in any section: ' + rva.toString(16));
}

const rsrcBase = rvaToOff(rsrcRva);

function readDir(dirOff) {
  const named = buf.readUInt16LE(dirOff + 12);
  const ids = buf.readUInt16LE(dirOff + 14);
  const total = named + ids;
  const entries = [];
  for (let i = 0; i < total; i++) {
    const e = dirOff + 16 + i * 8;
    const id = buf.readUInt32LE(e) & 0x7fffffff;
    const raw = buf.readUInt32LE(e + 4);
    entries.push({ id, isDir: (raw & 0x80000000) !== 0, target: rsrcBase + (raw & 0x7fffffff) });
  }
  return entries;
}

// 第一层：资源类型（RT_ICON=3, RT_GROUP_ICON=14）
function collectIcons(typeId) {
  const result = new Map();
  const typeEntry = readDir(rsrcBase).find((e) => e.id === typeId && e.isDir);
  if (!typeEntry) return result;
  for (const nameEntry of readDir(typeEntry.target)) {
    if (!nameEntry.isDir) continue;
    for (const langEntry of readDir(nameEntry.target)) {
      const dataOff = langEntry.target;
      const dataRva = buf.readUInt32LE(dataOff);
      const size = buf.readUInt32LE(dataOff + 4);
      result.set(nameEntry.id, { off: rvaToOff(dataRva), size });
    }
  }
  return result;
}

const groups = collectIcons(14);
const icons = collectIcons(3);
if (groups.size === 0) throw new Error('no RT_GROUP_ICON found');

// 取第一个组，挑字节数最大的条目（即最高分辨率）
const grp = [...groups.values()][0];
const reserved = buf.readUInt16LE(grp.off);
const type = buf.readUInt16LE(grp.off + 2);
const count = buf.readUInt16LE(grp.off + 4);
if (reserved !== 0 || type !== 1) throw new Error('bad group header');

let best = null;
for (let i = 0; i < count; i++) {
  const e = grp.off + 6 + i * 14;
  const entry = {
    width: buf.readUInt8(e) || 256,
    height: buf.readUInt8(e + 1) || 256,
    bytes: buf.readUInt32LE(e + 8),
    nId: buf.readUInt16LE(e + 12),
  };
  if (!best || entry.bytes > best.bytes) best = entry;
}
console.log('group entries:', count, 'picked', best);

const icon = icons.get(best.nId);
if (!icon) throw new Error('icon id not found: ' + best.nId);
fs.writeFileSync(outPath, buf.subarray(icon.off, icon.off + icon.size));
console.log('saved', outPath, icon.size, 'bytes');
