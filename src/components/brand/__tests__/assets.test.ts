// @vitest-environment node
// The committed icons (written by design/brand/vitals-mark.py): every file there at its size, the .ico and .icns
// containers holding exactly the listed images, and the pixels doing what each icon promises (safe area, glyph
// colours, the 16 px favicon still reading as an open ivory ring with a gold dot). Every tile and ground is Ember.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { BISECTOR_DEG, EMBER, SMALL, STANDARD } from '../geometry';
import { at, decodeIcns, decodeIco, dist, hex, ICNS_TYPES, luma, onIcon, px, raw, read } from './brandFiles';

const D = 'apps/desktop/build/icons';
const PNGS: [string, number][] = [
  ['public/icons/icon-192.png', 192],
  ['public/icons/icon-512.png', 512],
  ['public/icons/icon-192-maskable.png', 192],
  ['public/icons/icon-512-maskable.png', 512],
  ['public/icons/icon-512-monochrome.png', 512],
  ['public/icons/apple-touch-icon-180.png', 180],
  [`${D}/icon.png`, 1024],
  ...[16, 24, 32, 48, 64, 128, 256, 512, 1024].map((s): [string, number] => [`${D}/png/${s}x${s}.png`, s]),
  ...[16, 32].flatMap((s): [string, number][] => [
    [`${D}/tray/tray-${s}.png`, s],
    [`${D}/tray/tray-dark-${s}.png`, s],
  ]),
  [`${D}/tray/trayTemplate.png`, 16],
  [`${D}/tray/trayTemplate@2x.png`, 32],
];
const GROUND = hex(EMBER.ground);
const GOLD = hex(EMBER.signal);
/** Outer edge / side of the rounded tiles (vitals-mark.py FRAC): 48 px and under, and larger. */
const TILE_SMALL = 0.4375;
const TILE = 0.37;

const icoFrame = async (f: string, size: number) => raw(decodeIco(readFileSync(at(f))).find((e) => e.width === size)!.data);

describe('brand assets', () => {
  it('writes every file, each PNG at its nominal size, and none of the retired ones', async () => {
    for (const f of ['public/favicon.svg', 'public/favicon.ico', `${D}/icon.ico`, `${D}/icon.icns`]) expect(existsSync(at(f)), f).toBe(true);
    for (const [f, size] of PNGS) {
      expect(existsSync(at(f)), f).toBe(true);
      const meta = await sharp(at(f)).metadata();
      // opaque icons (maskable, apple-touch) may come without an alpha channel
      expect([meta.format, meta.width, meta.height, (meta.channels ?? 0) >= 3], f).toEqual(['png', size, size, true]);
    }
    for (const f of ['favicon-16.png', 'favicon-32.png', 'favicon-48.png', 'badge-96.png']) expect(existsSync(at(`public/icons/${f}`)), f).toBe(false);
  });

  it('references only files that exist from index.html and the manifest', () => {
    const html = read('index.html');
    for (const [, href] of html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)) expect(existsSync(at(`public${href}`)), href).toBe(true);
    const manifest = JSON.parse(read('public/manifest.webmanifest')) as { icons: { src: string; purpose: string }[] };
    for (const icon of manifest.icons) expect(existsSync(at(`public${icon.src}`)), icon.src).toBe(true);
    expect(new Set(manifest.icons.map((i) => i.purpose))).toEqual(new Set(['any', 'maskable', 'monochrome']));
  });

  it('packs exactly the listed sizes into the .ico files', async () => {
    for (const [f, sizes] of [
      ['public/favicon.ico', [16, 32, 48]],
      [`${D}/icon.ico`, [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]],
    ] as const) {
      const entries = decodeIco(readFileSync(at(f)));
      expect(
        entries.map((e) => e.width),
        f,
      ).toEqual(sizes);
      for (const e of entries) {
        const meta = await sharp(e.data).metadata();
        expect([meta.format, meta.width, meta.height, e.height]).toEqual(['png', e.width, e.width, e.width]);
      }
    }
  });

  it('packs exactly the listed types into the .icns file, the 1024 one a Big Sur tile', async () => {
    const blocks = decodeIcns(readFileSync(at(`${D}/icon.icns`)));
    expect(blocks.map((b) => b.type)).toEqual(Object.keys(ICNS_TYPES));
    for (const b of blocks) {
      const meta = await sharp(b.data).metadata();
      expect([b.type, meta.format, meta.width, meta.height]).toEqual([b.type, 'png', ICNS_TYPES[b.type], ICNS_TYPES[b.type]]);
    }
    const big = await raw(blocks.find((b) => b.type === 'ic10')!.data);
    expect(px(big, 60, 512)[3]).toBe(0);
    expect(px(big, 120, 512)[3]).toBe(255);
  });

  for (const [what, load, size, frac, cut] of [
    ['icon-512.png', () => raw(at('public/icons/icon-512.png')), 512, TILE, STANDARD],
    ['the 48 px favicon frame', () => icoFrame('public/favicon.ico', 48), 48, TILE_SMALL, STANDARD],
  ] as const) {
    it(`draws ${what} as the ivory ring on its own Ember tile with transparent corners`, async () => {
      const r = await load();
      for (const [x, y] of [
        [0, 0],
        [size - 1, 0],
        [0, size - 1],
        [size - 1, size - 1],
      ] as const)
        expect(px(r, x, y)[3]).toBe(0);
      const c = Math.floor(size / 2);
      expect(px(r, c, c)[3]).toBe(255);
      expect(dist(px(r, c, c), GROUND)).toBeLessThan(3);
      // the ring's leftmost point (9 o'clock, opposite the opening) is ivory ink
      const [x, y] = onIcon(size, frac, cut.ring.r, 180);
      expect(luma(px(r, x, y)) - luma(GROUND)).toBeGreaterThan(size > 100 ? 180 : 100);
    });
  }

  for (const size of [192, 512]) {
    it(`keeps the maskable ${size} mark inside the 40 % safe circle on an opaque ground`, async () => {
      const r = await raw(at(`public/icons/icon-${size}-maskable.png`));
      const safe = 0.4 * size;
      let marked = 0;
      const outside: string[] = [];
      const clear: string[] = [];
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const p = px(r, x, y);
          if (p[3] !== 255) clear.push(`${x},${y}`);
          if (dist(p, GROUND) > 2) {
            marked++;
            if (Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) > safe) outside.push(`${x},${y}`);
          }
        }
      expect(clear.slice(0, 5)).toEqual([]);
      expect(outside.slice(0, 5)).toEqual([]);
      expect(marked).toBeGreaterThan(size * size * 0.02);
    });
  }

  for (const [f, colour] of [
    ['public/icons/icon-512-monochrome.png', 255],
    [`${D}/tray/trayTemplate.png`, 0],
    [`${D}/tray/trayTemplate@2x.png`, 0],
  ] as const) {
    it(`draws ${path.basename(f)} in ${colour ? 'white' : 'black'} only, shape in alpha`, async () => {
      const r = await raw(at(f));
      let opaque = 0;
      let off = 0;
      for (let i = 0; i < r.data.length; i += 4) {
        if (r.data[i + 3] === 0) continue;
        if (r.data[i + 3] === 255) opaque++;
        if (dist([r.data[i]!, r.data[i + 1]!, r.data[i + 2]!], [colour, colour, colour]) > 4) off++;
      }
      expect(off).toBe(0);
      expect(opaque).toBeGreaterThan(r.size * r.size * 0.03);
      expect(px(r, 0, 0)[3]).toBe(0);
    });
  }

  it('keeps the 16 px favicon an open ivory ring with a gold dot on the Ember tile', async () => {
    const r = await icoFrame('public/favicon.ico', 16);
    // the opening, on the bisector at the ring's radius, shows the ground; the opposite side of the ring is ivory
    const [gx, gy] = onIcon(16, TILE_SMALL, SMALL.ring.r, BISECTOR_DEG);
    expect(dist(px(r, gx, gy), GROUND)).toBeLessThan(60);
    const [ox, oy] = onIcon(16, TILE_SMALL, SMALL.ring.r, BISECTOR_DEG + 180);
    expect(luma(px(r, ox, oy)) - luma(GROUND)).toBeGreaterThan(120);
    let gold = false;
    for (let i = 0; i < r.data.length; i += 4) if (dist([r.data[i]!, r.data[i + 1]!, r.data[i + 2]!], GOLD) < 30) gold = true;
    expect(gold).toBe(true);
  });

  it('public/favicon.svg is the Ember tile with the small cut', () => {
    const svg = read('public/favicon.svg');
    expect(svg).toMatch(new RegExp(`<rect width="32" height="32" rx="[\\d.]+" fill="${EMBER.ground}"/>`));
    expect(svg).toContain(`d="${SMALL.ring.d}"`);
    expect(svg).toContain(`fill="${EMBER.signal}"`);
  });

  it('builds the tray glyphs without a tile (transparent corners and centre)', async () => {
    for (const f of [`${D}/tray/tray-16.png`, `${D}/tray/tray-dark-32.png`]) {
      const r = await raw(at(f));
      expect(px(r, 0, 0)[3], f).toBe(0);
      expect(px(r, Math.floor(r.size / 2) - 1, Math.floor(r.size / 2) - 1)[3], f).toBe(0);
    }
  });
});
