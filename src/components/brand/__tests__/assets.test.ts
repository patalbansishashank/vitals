// @vitest-environment node
// The committed icons (written by scripts/brand/generate.mjs): every file there at its size, the .ico and .icns
// containers holding exactly the listed images, and the pixels doing what each icon promises (crisp, safe area,
// glyph colours, the 16 px favicon still reading as an open ring with a yellow dot).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../../..');
const at = (rel: string) => path.join(ROOT, rel);

type Opts = { tone?: 'light' | 'dark' | 'mono'; mono?: string; small?: boolean };
type Generate = {
  RADIUS: Record<'tile' | 'tileSmall' | 'maskable' | 'badge' | 'tray', number>;
  markExtent: (small?: boolean) => number;
  tileSvg: (size: number, opts?: { inset?: number; corner?: number; small?: boolean }) => string;
  glyphSvg: (size: number, radius: number, opts?: Opts) => string;
};
type Mark = {
  GRID: number;
  PALETTE: { light: { ground: string; ink: string; signal: string } };
  readMark: (file: string) => { dot: { cx: number; cy: number } };
};
// @ts-expect-error plain ESM script without types
const gen = (await import('../../../../scripts/brand/generate.mjs')) as Generate;
// @ts-expect-error plain ESM script without types
const mark = (await import('../../../../scripts/brand/mark.mjs')) as Mark;
// @ts-expect-error plain ESM script without types
const { decodeIco } = (await import('../../../../scripts/brand/ico.mjs')) as {
  decodeIco: (b: Buffer) => { width: number; height: number; data: Buffer }[];
};
// @ts-expect-error plain ESM script without types
const { decodeIcns, ICNS_TYPES } = (await import('../../../../scripts/brand/icns.mjs')) as {
  decodeIcns: (b: Buffer) => { type: string; data: Buffer }[];
  ICNS_TYPES: Record<string, number>;
};

const D = 'apps/desktop/build/icons';
const PNGS: [string, number][] = [
  ...[16, 32, 48].map((s): [string, number] => [`public/icons/favicon-${s}.png`, s]),
  ['public/icons/icon-192.png', 192],
  ['public/icons/icon-512.png', 512],
  ['public/icons/icon-192-maskable.png', 192],
  ['public/icons/icon-512-maskable.png', 512],
  ['public/icons/icon-512-monochrome.png', 512],
  ['public/icons/apple-touch-icon-180.png', 180],
  ['public/icons/badge-96.png', 96],
  [`${D}/icon.png`, 1024],
  ...[16, 24, 32, 48, 64, 128, 256, 512, 1024].map((s): [string, number] => [`${D}/png/${s}x${s}.png`, s]),
  ...[16, 32].flatMap((s): [string, number][] => [
    [`${D}/tray/tray-${s}.png`, s],
    [`${D}/tray/tray-dark-${s}.png`, s],
  ]),
  [`${D}/tray/trayTemplate.png`, 16],
  [`${D}/tray/trayTemplate@2x.png`, 32],
];

type Raw = { data: Buffer; size: number };
const raw = async (input: string | Buffer): Promise<Raw> => {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect(info.channels).toBe(4);
  expect(info.width).toBe(info.height);
  return { data, size: info.width };
};
const px = (r: Raw, x: number, y: number) => {
  const i = (y * r.size + x) * 4;
  return [r.data[i]!, r.data[i + 1]!, r.data[i + 2]!, r.data[i + 3]!] as const;
};
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const dist = (a: readonly number[], b: readonly number[]) =>
  Math.max(...[0, 1, 2].map((i) => Math.abs(a[i]! - b[i]!)));
const luma = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
const GROUND = hex(mark.PALETTE.light.ground);
const YELLOW = hex(mark.PALETTE.light.signal);

describe('brand assets', () => {
  it('writes every file, each PNG at its nominal size and RGBA', async () => {
    for (const f of ['public/favicon.svg', 'public/favicon.ico', `${D}/icon.ico`, `${D}/icon.icns`])
      expect(existsSync(at(f)), f).toBe(true);
    for (const [f, size] of PNGS) {
      expect(existsSync(at(f)), f).toBe(true);
      const meta = await sharp(at(f)).metadata();
      expect([meta.format, meta.width, meta.height, meta.channels], f).toEqual(['png', size, size, 4]);
    }
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

  it('packs exactly the listed types into the .icns file', async () => {
    const blocks = decodeIcns(readFileSync(at(`${D}/icon.icns`)));
    expect(blocks.map((b) => b.type)).toEqual([
      'icp4',
      'icp5',
      'ic07',
      'ic08',
      'ic09',
      'ic10',
      'ic11',
      'ic12',
      'ic13',
      'ic14',
    ]);
    for (const b of blocks) {
      const meta = await sharp(b.data).metadata();
      expect([b.type, meta.format, meta.width, meta.height]).toEqual([
        b.type,
        'png',
        ICNS_TYPES[b.type],
        ICNS_TYPES[b.type],
      ]);
    }
    // Big Sur tile: transparent margin around an opaque rounded square of 824/1024
    const big = await raw(blocks.find((b) => b.type === 'ic10')!.data);
    expect(px(big, 60, 512)[3]).toBe(0);
    expect(px(big, 120, 512)[3]).toBe(255);
  });

  for (const [f, size, small] of [
    ['public/icons/icon-512.png', 512, false],
    ['public/icons/favicon-32.png', 32, true],
  ] as const) {
    it(`renders ${path.basename(f)} crisp, with the ring standing off its tile on light and dark pages`, async () => {
      const committed = await raw(at(f));
      // rasterise at 4x into its own buffer (sharp would otherwise shrink-on-load straight to the target size), then
      // average each 4x4 block (exact pixel coverage) and compare premultiplied, so transparent pixels count as equal
      const big = await raw(
        await sharp(Buffer.from(gen.tileSvg(size)), { density: 72 * 4 })
          .png()
          .toBuffer(),
      );
      expect(big.size).toBe(size * 4);
      const pre = (r: Raw, x: number, y: number) => {
        const p = px(r, x, y);
        return [(p[0] * p[3]) / 255, (p[1] * p[3]) / 255, (p[2] * p[3]) / 255, p[3]];
      };
      let sum = 0;
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const avg = [0, 0, 0, 0];
          for (let j = 0; j < 4; j++)
            for (let i = 0; i < 4; i++)
              pre(big, x * 4 + i, y * 4 + j).forEach((v, ch) => (avg[ch]! += v / 16));
          pre(committed, x, y).forEach((v, ch) => (sum += Math.abs(v - avg[ch]!)));
        }
      expect(sum / (size * size * 4)).toBeLessThan(2);

      // the any-purpose tile is its own ground: transparent corners, opaque inside
      for (const [x, y] of [
        [0, 0],
        [size - 1, 0],
        [0, size - 1],
        [size - 1, size - 1],
      ] as const)
        expect(px(committed, x, y)[3]).toBe(0);
      const c = size / 2;
      // ring's leftmost point (radius 30 of the 108 grid) and the ground at the centre
      const k = ((small ? gen.RADIUS.tileSmall : gen.RADIUS.tile) * size) / gen.markExtent(small);
      const ringX = Math.floor(c - 30 * k);
      for (const page of ['#e8eaec', '#151618']) {
        const flat = await raw(await sharp(at(f)).flatten({ background: page }).png().toBuffer());
        const ring = px(flat, ringX, Math.floor(c));
        const ground = px(flat, Math.floor(c), Math.floor(c));
        expect(px(committed, Math.floor(c), Math.floor(c))[3]).toBe(255);
        expect(luma(ground) - luma(ring), page).toBeGreaterThan(150);
      }
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
      expect(marked).toBeGreaterThan(size * size * 0.05);
    });
  }

  for (const [f, colour] of [
    ['public/icons/icon-512-monochrome.png', 255],
    ['public/icons/badge-96.png', 255],
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
      expect(opaque).toBeGreaterThan(r.size * r.size * 0.1);
      expect(px(r, 0, 0)[3]).toBe(0);
    });
  }

  it('keeps the 16 px favicon an open ring with a yellow dot', async () => {
    const r = await raw(at('public/icons/favicon-16.png'));
    // the dot sits on the bisector of the opening: walk out along it to the ring's radius
    const { cx, cy } = mark.readMark('mark-small.svg').dot;
    const g = mark.GRID / 2;
    const a = Math.atan2(cy - g, cx - g);
    const k = (gen.RADIUS.tileSmall * 16) / gen.markExtent(true);
    const gap = px(r, Math.floor(8 + 30 * Math.cos(a) * k), Math.floor(8 + 30 * Math.sin(a) * k));
    expect(dist(gap, GROUND)).toBeLessThan(60);
    // the opposite side of the ring is ink
    const closed = px(r, Math.floor(8 - 30 * Math.cos(a) * k), Math.floor(8 - 30 * Math.sin(a) * k));
    expect(luma(GROUND) - luma(closed)).toBeGreaterThan(120);
    let yellow = false;
    for (let i = 0; i < r.data.length; i += 4)
      if (dist([r.data[i]!, r.data[i + 1]!, r.data[i + 2]!], YELLOW) < 30) yellow = true;
    expect(yellow).toBe(true);
  });

  it('builds the tray glyphs without a tile (transparent corners, glyph on alpha)', async () => {
    for (const f of [`${D}/tray/tray-16.png`, `${D}/tray/tray-dark-32.png`]) {
      const r = await raw(at(f));
      expect(px(r, 0, 0)[3], f).toBe(0);
      expect(px(r, Math.floor(r.size / 2), Math.floor(r.size / 2))[3], f).toBe(0);
    }
  });
});
