// Fills build/icons (electron-builder's icons and the tray images) from L-BRAND's generated set: the files are already
// there once that branch is merged; before that they are taken from `git show origin/wp/L-BRAND:<path>`. If neither has
// them, a plain placeholder (a grey rounded tile) is written and a warning says so.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootDir = path.resolve(appDir, '..', '..');
const iconsDir = path.join(appDir, 'build', 'icons');
const REL = 'apps/desktop/build/icons';
const BRANCH = 'origin/wp/L-BRAND';

/** Every file the package and the app use. */
const FILES = ['icon.png', 'icon.ico', 'icon.icns', 'png/16x16.png', 'png/24x24.png', 'png/32x32.png', 'png/48x48.png', 'png/64x64.png', 'png/128x128.png', 'png/256x256.png', 'png/512x512.png', 'png/1024x1024.png', 'tray/tray-16.png', 'tray/tray-32.png', 'tray/tray-dark-16.png', 'tray/tray-dark-32.png', 'tray/trayTemplate.png', 'tray/trayTemplate@2x.png'];

const missing = FILES.filter((f) => !existsSync(path.join(iconsDir, f)));
if (missing.length === 0) {
  console.log('icons.mjs: build/icons is complete');
  process.exit(0);
}

let fromGit = 0;
for (const f of missing) {
  let bytes;
  try {
    bytes = execFileSync('git', ['show', `${BRANCH}:${REL}/${f}`], { cwd: rootDir, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 });
  } catch {
    continue;
  }
  mkdirSync(path.dirname(path.join(iconsDir, f)), { recursive: true });
  writeFileSync(path.join(iconsDir, f), bytes);
  fromGit++;
}
if (fromGit) console.log(`icons.mjs: ${fromGit} icon file(s) copied from ${BRANCH}`);

const still = FILES.filter((f) => !existsSync(path.join(iconsDir, f)));
if (still.length) {
  console.warn(`icons.mjs: no brand icons found (${still.length} missing); writing placeholder icons`);
  for (const f of still) {
    const size = Number(/(\d+)x\d+|-(\d+)\.png|@2x/.exec(f)?.[1] ?? /-(\d+)\./.exec(f)?.[1] ?? (f.includes('@2x') ? 32 : f.includes('tray') ? 16 : 512));
    const target = path.join(iconsDir, f);
    mkdirSync(path.dirname(target), { recursive: true });
    if (f.endsWith('.png')) writeFileSync(target, placeholderPng(size));
    else if (f.endsWith('.ico')) writeFileSync(target, icoFromPng(placeholderPng(256), 256));
    else writeFileSync(target, icnsFromPng(placeholderPng(512)));
  }
}

/** A grey rounded tile with a lighter ring, RGBA PNG. */
function placeholderPng(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const c = size / 2;
  const r = size * 0.22;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      const dx = Math.max(0, Math.abs(x + 0.5 - c) - (c - r));
      const dy = Math.max(0, Math.abs(y + 0.5 - c) - (c - r));
      const inside = dx * dx + dy * dy <= r * r;
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      const ring = Math.abs(d - size * 0.3) < size * 0.06;
      const v = ring ? 235 : 70;
      raw.set(inside ? [v, v, v, 255] : [0, 0, 0, 0], i);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** One PNG entry in an .ico container. */
function icoFromPng(png, size) {
  const head = Buffer.alloc(6 + 16);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(1, 4);
  head.set([size === 256 ? 0 : size, size === 256 ? 0 : size, 0, 0, 1, 0, 32, 0], 6);
  head.writeUInt32LE(png.length, 14);
  head.writeUInt32LE(22, 18);
  return Buffer.concat([head, png]);
}

/** One 512 px PNG entry (ic09) in an .icns container. */
function icnsFromPng(png) {
  const entry = Buffer.concat([Buffer.from('ic09', 'ascii'), u32(png.length + 8), png]);
  return Buffer.concat([Buffer.from('icns', 'ascii'), u32(entry.length + 8), entry]);
}
function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}
