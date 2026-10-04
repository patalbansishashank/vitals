// One-off icon generator for the installable app (PWA). Run: node scripts/icons.mjs
// Reads public/favicon.svg (the single source of truth for the mark) and writes
// public/icons/*.png with sharp. Colours come from design/tokens.css (--lm-chassis, --lm-ink,
// --lm-signal); the favicon itself carries them, so only the full-bleed backgrounds are set here.
//
//   icon-192.png / icon-512.png   purpose "any": the favicon tile, rounded, transparent corners
//   icon-512-maskable.png         purpose "maskable": full-bleed chassis colour, mark inside the
//                                 safe zone (centre circle, radius 40 %) so any OS mask keeps it
//   apple-touch-icon-180.png      iOS applies its own corner mask and fills transparency with
//                                 black, so this one is opaque and full-bleed too
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'icons');

const CHASSIS = '#e8eaec'; // --lm-chassis (light): the page background, also manifest background_color

const favicon = await readFile(path.join(root, 'public', 'favicon.svg'), 'utf8');

// The mark inside the favicon, without its rounded tile: bar + yellow dot.
const mark = [...favicon.matchAll(/<(?:rect class="k"|circle)\s[^>]*\/>/g)].map((m) => m[0]);
if (mark.length !== 2) throw new Error(`expected 2 mark shapes in favicon.svg, found ${mark.length}`);
// Glyph bbox is x 9–25.5, y 7–25.5 on the 32 grid; shift it so its centre is the tile's centre.
const centred = `<g transform="translate(-1.25 -0.25)">${mark.join('')}</g>`;
// ink colour for the bar (the favicon's class `.k` is theme-aware via a media query; fix it to light here)
const style = '<style>.k{fill:#191c20}</style>';

/** Full-bleed square: chassis background + mark scaled about the centre (scale 1 = favicon proportions). */
const fullBleed = (scale) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${style}` +
  `<rect width="32" height="32" fill="${CHASSIS}"/>` +
  `<g transform="translate(16 16) scale(${scale}) translate(-16 -16)">${centred}</g></svg>`;

// Farthest glyph point from the centre is ≈ 11.4 of 32 (0.36), inside the 0.40 safe radius at scale 1.
const MASKABLE_SCALE = 1;

const render = (svg, size, file) =>
  sharp(Buffer.from(svg), { density: (72 * size) / 32 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(path.join(outDir, file));

await mkdir(outDir, { recursive: true });
await Promise.all([
  render(favicon, 192, 'icon-192.png'),
  render(favicon, 512, 'icon-512.png'),
  render(fullBleed(MASKABLE_SCALE), 512, 'icon-512-maskable.png'),
  render(fullBleed(1.12), 180, 'apple-touch-icon-180.png'),
]);
console.log('icons written to', path.relative(root, outDir));
