// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs generator without types
import { BRAND_DIR, PALETTE, readMark } from '../../../../scripts/brand/mark.mjs';

const read = (name: string) => readFileSync(path.join(BRAND_DIR as string, name), 'utf8');
const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

const SVGS = readdirSync(BRAND_DIR as string).filter((f) => f.endsWith('.svg'));

describe('brand lockups', () => {
  it('has every lockup, header and social file', () => {
    for (const f of [
      'wordmark.svg',
      'lockup-light.svg',
      'lockup-dark.svg',
      'lockup-mono.svg',
      'lockup-light-512w.png',
      'readme-header.svg',
      'readme-header-dark.svg',
      'social-preview.png',
      'og-image.png',
    ])
      expect(existsSync(path.join(BRAND_DIR as string, f)), f).toBe(true);
  });

  it('writes PNGs at their exact sizes', async () => {
    const size = async (f: string) => {
      const m = await sharp(path.join(BRAND_DIR as string, f)).metadata();
      return [m.width, m.height];
    };
    expect(await size('social-preview.png')).toEqual([1280, 640]);
    expect(await size('og-image.png')).toEqual([1200, 630]);
    expect((await size('lockup-light-512w.png'))[0]).toBe(512);
  });

  it('has no <text> element in any brand SVG (GitHub renders without our fonts)', () => {
    expect(SVGS.length).toBeGreaterThanOrEqual(8);
    for (const f of SVGS) expect(read(f).replace(/<!--[\s\S]*?-->/g, ''), f).not.toMatch(/<text[\s>]/);
  });

  it('draws the wordmark as outlines, not live text', () => {
    expect(read('wordmark.svg')).toMatch(/<path id="wordmark" d="M[^"]{500,}"/);
  });

  it('embeds the same ring path as mark.svg in every lockup and header', () => {
    const { d } = readMark('mark.svg') as { d: string };
    for (const f of ['lockup-light.svg', 'lockup-dark.svg', 'lockup-mono.svg', 'readme-header.svg', 'readme-header-dark.svg'])
      expect(read(f), f).toContain(`d="${d}"`);
  });

  it('uses currentColor in the mono lockup only', () => {
    expect(read('lockup-mono.svg')).toContain('currentColor');
    expect(read('lockup-light.svg')).not.toContain('currentColor');
  });

  it('puts the ground colour in the social preview corners and dark ink in the middle', async () => {
    const { data, info } = await sharp(path.join(BRAND_DIR as string, 'social-preview.png'))
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => [0, 1, 2].map((c) => data[(y * info.width + x) * info.channels + c] ?? -1);
    const ground = hex(PALETTE.light.ground as string);
    const w = info.width - 1;
    const h = info.height - 1;
    for (const [x, y] of [
      [0, 0],
      [w, 0],
      [0, h],
      [w, h],
    ] as const)
      expect(px(x, y)).toEqual(ground);
    const ink = hex(PALETTE.light.ink as string);
    let dark = 0;
    for (let x = 360; x < 920; x++) {
      const p = px(x, 280);
      if (p.every((v, i) => Math.abs(v - (ink[i] ?? 0)) < 24)) dark++;
    }
    expect(dark).toBeGreaterThan(40);
  });
});
