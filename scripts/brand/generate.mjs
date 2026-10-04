// Every raster, .ico and .icns icon of Vitals, built from the mark (scripts/brand/mark.mjs). Run: node scripts/brand/generate.mjs
// Output is deterministic: the same mark.svg and mark-small.svg give byte-identical files. Afterwards it runs the sibling
// generators (android.mjs: launcher icons, lockup.mjs: wordmark lockups and the og image) when they are present.
//
// Sizes are given as the ring's outer radius (ring or dot, whichever reaches further) as a fraction of the icon's side.
// Icons of 48 px and under use the small cut (mark-small.svg: heavier stroke, wider opening).
//
//   public/favicon.svg, favicon.ico, icons/favicon-16|32|48.png   rounded tile, ring 2 px in from a 32 px tile's edge
//   public/icons/icon-192|512.png                                 purpose "any": rounded light tile, transparent corners
//   public/icons/icon-192|512-maskable.png                        full-bleed ground, whole mark inside the 40 % safe circle
//   public/icons/icon-512-monochrome.png, badge-96.png            white glyph on transparent (the OS tints it)
//   public/icons/apple-touch-icon-180.png                         opaque full-bleed ground: iOS masks it and fills alpha black
//   apps/desktop/build/icons/                                     icon.ico, icon.icns (Big Sur tile), icon.png, png/, tray/
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { GRID, PALETTE, ROOT, markShapes, readMark } from './mark.mjs';
import { encodeIco } from './ico.mjs';
import { ICNS_TYPES, encodeIcns } from './icns.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DESKTOP = path.join(ROOT, 'apps', 'desktop', 'build', 'icons');

/** Largest size that still gets the small cut. */
export const SMALL_MAX = 48;

/** Ring outer radius / side, per use. */
export const RADIUS = {
  tile: 0.35, // rounded tiles from 64 px up (PWA any, apple-touch, Windows and Linux)
  tileSmall: 14 / 32, // rounded tiles of 48 px and under: outer edge 2 px in from a 32 px tile's edge
  maskable: 0.38, // maskable and monochrome: inside the 0.40 safe circle with a small margin
  badge: 0.46, // notification badge: the glyph alone, nearly edge to edge
  tray: 0.45, // tray and menu bar: about 1 px clear of the edge at 16 px
};

/** Corner radius / tile side: rounded tiles everywhere, the macOS Big Sur template a touch rounder. */
const CORNER = 0.22;
const MAC_CORNER = 0.225;
/** macOS Big Sur: the tile is 824 of 1024, centred, leaving room for the system shadow. */
const MAC_TILE = 824 / 1024;

/** Distance from the grid centre to the mark's farthest painted point, in grid units. */
export function markExtent(small = false) {
  const m = readMark(small ? 'mark-small.svg' : 'mark.svg');
  const r = Number(m.d.match(/A([\d.]+),/)?.[1]);
  if (!r) throw new Error('mark: ring radius not found');
  const c = GRID / 2;
  const dot = Math.hypot(m.dot.cx - c, m.dot.cy - c) + m.dot.r + m.dot.edge / 2;
  return Math.max(r + m.stroke / 2, dot);
}

const n = (v) => +v.toFixed(4);

/**
 * The mark scaled about the centre of a size×size canvas so its farthest point sits at radius × size.
 * @param {number} size
 * @param {number} radius
 * @param {{ tone?: 'light' | 'dark' | 'mono', mono?: string, small?: boolean }} [opts]
 */
export function glyph(size, radius, { tone = 'light', mono, small = size <= SMALL_MAX } = {}) {
  const k = (radius * size) / markExtent(small);
  const c = size / 2;
  return `<g transform="translate(${n(c)} ${n(c)}) scale(${n(k)}) translate(${-GRID / 2} ${-GRID / 2})">${markShapes({ tone, mono, small })}</g>`;
}

const svg = (size, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;

/**
 * Rounded light tile with the mark, transparent around it. inset (fraction of the side) shrinks the tile (macOS).
 * @param {number} size
 * @param {{ inset?: number, corner?: number, small?: boolean }} [opts]
 */
export function tileSvg(size, { inset = 0, corner = CORNER, small = size <= SMALL_MAX } = {}) {
  const x = inset * size;
  const w = size - 2 * x;
  const radius = (small ? RADIUS.tileSmall : RADIUS.tile) * (w / size);
  return svg(
    size,
    `<rect x="${n(x)}" y="${n(x)}" width="${n(w)}" height="${n(w)}" rx="${n(corner * w)}" fill="${PALETTE.light.ground}"/>` +
      glyph(size, radius, { small }),
  );
}

/** Opaque light ground edge to edge with the mark (maskable, apple-touch). */
export function fullBleedSvg(size, radius, { small = size <= SMALL_MAX } = {}) {
  return svg(
    size,
    `<rect width="${size}" height="${size}" fill="${PALETTE.light.ground}"/>` +
      glyph(size, radius, { small }),
  );
}

/**
 * The mark alone on transparent.
 * @param {number} size
 * @param {number} radius
 * @param {{ tone?: 'light' | 'dark' | 'mono', mono?: string, small?: boolean }} [opts]
 */
export function glyphSvg(size, radius, opts = {}) {
  return svg(size, glyph(size, radius, opts));
}

/** public/favicon.svg: the 32 px small-cut tile; dark tab strips get the dark face ground and light ink. */
export function faviconSvg() {
  const shapes = glyph(32, RADIUS.tileSmall, { small: true })
    .replace('<path ', '<path class="r" ')
    .replace('<circle ', '<circle class="d" ');
  const { light, dark } = PALETTE;
  const style =
    `.t{fill:${light.ground}}.r{stroke:${light.ink}}.d{fill:${light.signal};stroke:${light.edge}}` +
    `@media (prefers-color-scheme:dark){.t{fill:#1d1f22}.r{stroke:${dark.ink}}.d{fill:${dark.signal};stroke:none}}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><style>${style}</style><rect class="t" width="32" height="32" rx="${n(CORNER * 32)}"/>${shapes}</svg>\n`;
}

/** Rasterises an SVG built at its own pixel size (librsvg renders it 1:1) to an RGBA PNG. */
export async function png(source, size) {
  const out = await sharp(Buffer.from(source), { density: 72 })
    .ensureAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();
  const meta = await sharp(out).metadata();
  if (meta.width !== size || meta.height !== size)
    throw new Error(`rendered ${meta.width}x${meta.height}, wanted ${size}`);
  return out;
}

const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const LINUX_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const macTile = (size) => tileSvg(size, { inset: (1 - MAC_TILE) / 2, corner: MAC_CORNER });

/** Every file this script writes: relative path → () => Promise<Buffer | string>. */
export function outputs() {
  /** @type {Record<string, () => Promise<Buffer | string>>} */
  const o = {};
  const pub = (p) => path.join('public', p);
  const desk = (p) => path.join('apps', 'desktop', 'build', 'icons', p);

  o[pub('favicon.svg')] = async () => faviconSvg();
  for (const s of [16, 32, 48]) o[pub(`icons/favicon-${s}.png`)] = () => png(tileSvg(s), s);
  o[pub('favicon.ico')] = async () =>
    encodeIco(
      await Promise.all([16, 32, 48].map(async (size) => ({ size, png: await png(tileSvg(size), size) }))),
    );

  for (const s of [192, 512]) {
    o[pub(`icons/icon-${s}.png`)] = () => png(tileSvg(s), s);
    o[pub(`icons/icon-${s}-maskable.png`)] = () => png(fullBleedSvg(s, RADIUS.maskable), s);
  }
  o[pub('icons/icon-512-monochrome.png')] = () =>
    png(glyphSvg(512, RADIUS.maskable, { tone: 'mono', mono: '#ffffff' }), 512);
  o[pub('icons/apple-touch-icon-180.png')] = () => png(fullBleedSvg(180, RADIUS.tile), 180);
  o[pub('icons/badge-96.png')] = () =>
    png(glyphSvg(96, RADIUS.badge, { tone: 'mono', mono: '#ffffff', small: true }), 96);

  o[desk('icon.ico')] = async () =>
    encodeIco(
      await Promise.all(ICO_SIZES.map(async (size) => ({ size, png: await png(tileSvg(size), size) }))),
    );
  o[desk('icon.icns')] = async () =>
    encodeIcns(
      await Promise.all(
        Object.entries(ICNS_TYPES).map(async ([type, size]) => ({
          type,
          png: await png(macTile(size), size),
        })),
      ),
    );
  o[desk('icon.png')] = () => png(tileSvg(1024), 1024);
  for (const s of LINUX_SIZES) o[desk(`png/${s}x${s}.png`)] = () => png(tileSvg(s), s);
  for (const s of [16, 32]) {
    o[desk(`tray/tray-${s}.png`)] = () => png(glyphSvg(s, RADIUS.tray, { tone: 'dark' }), s); // dark panels
    o[desk(`tray/tray-dark-${s}.png`)] = () => png(glyphSvg(s, RADIUS.tray, { tone: 'light' }), s); // light panels
  }
  o[desk('tray/trayTemplate.png')] = () =>
    png(glyphSvg(16, RADIUS.tray, { tone: 'mono', mono: '#000000' }), 16);
  o[desk('tray/trayTemplate@2x.png')] = () =>
    png(glyphSvg(32, RADIUS.tray, { tone: 'mono', mono: '#000000', small: true }), 32);
  return o;
}

/** Writes every icon; returns the written paths relative to the repo root. */
export async function writeIcons() {
  const entries = Object.entries(outputs());
  await Promise.all(
    entries.map(async ([rel, make]) => {
      const file = path.join(ROOT, rel);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, await make());
    }),
  );
  return entries.map(([rel]) => rel);
}

async function main() {
  const written = await writeIcons();
  console.log(`icons (${written.length}):\n  ${written.join('\n  ')}`);
  for (const [file, fn, what] of [
    ['android.mjs', 'writeAndroid', 'android'],
    ['lockup.mjs', 'writeLockups', 'lockups'],
  ]) {
    const at = path.join(HERE, file);
    if (!existsSync(at)) {
      console.log(`${what}: skipped, scripts/brand/${file} not found`);
      continue;
    }
    try {
      const paths = await (await import(pathToFileURL(at).href))[fn]();
      console.log(
        `${what} (${paths.length}):\n  ${paths.map((p) => (path.isAbsolute(p) ? path.relative(ROOT, p) : p)).join('\n  ')}`,
      );
    } catch (err) {
      // the icons above are written either way; report the sibling's failure and keep going
      console.error(`${what}: scripts/brand/${file} failed:`, err);
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
