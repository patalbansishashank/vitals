// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { EMBER, PALETTE, STANDARD } from '../geometry';
import { at } from './brandFiles';

const BRAND_DIR = at('public/brand');

const read = (name: string) => readFileSync(path.join(BRAND_DIR, name), 'utf8');
const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

const SVGS = readdirSync(BRAND_DIR).filter((f) => f.endsWith('.svg'));

describe('brand lockups', () => {
  it('has every lockup, header and social file', () => {
    for (const f of [
      'wordmark.svg',
      'lockup-light.svg',
      'lockup-dark.svg',
      'lockup-mono.svg',
      'lockup-light-512w.png',
      'readme-header.svg',
      'social-preview.png',
      'og-image.png',
    ])
      expect(existsSync(path.join(BRAND_DIR, f)), f).toBe(true);
  });

  it('writes PNGs at their exact sizes', async () => {
    const size = async (f: string) => {
      const m = await sharp(path.join(BRAND_DIR, f)).metadata();
      return [m.width, m.height];
    };
    expect(await size('social-preview.png')).toEqual([1280, 640]);
    expect(await size('og-image.png')).toEqual([1200, 630]);
    expect((await size('lockup-light-512w.png'))[0]).toBe(512);
  });

  it('has no <text> element in any brand SVG (GitHub renders without our fonts)', () => {
    expect(SVGS.length).toBeGreaterThanOrEqual(7);
    for (const f of SVGS) expect(read(f).replace(/<!--[\s\S]*?-->/g, ''), f).not.toMatch(/<text[\s>]/);
  });

  it('draws the wordmark as outlines, not live text', () => {
    expect(read('wordmark.svg')).toMatch(/<path id="wordmark" d="M[^"]{500,}"/);
  });

  it('embeds the standard cut of the mark in every lockup and header', () => {
    for (const f of ['lockup-light.svg', 'lockup-dark.svg', 'lockup-mono.svg', 'readme-header.svg']) {
      expect(read(f), f).toContain(`d="${STANDARD.ring.d}"`);
      expect(read(f), f).toContain(`r="${STANDARD.track!.r}"`);
    }
  });

  it('uses currentColor in the mono lockup only', () => {
    expect(read('lockup-mono.svg')).toContain('currentColor');
    expect(read('lockup-light.svg')).not.toContain('currentColor');
  });

  it('draws the README header and the social preview in Ember: #090909 ground, ivory ink', async () => {
    const header = read('readme-header.svg');
    expect(header).toContain(`<rect width="1280" height="320" fill="${EMBER.ground}"/>`);
    expect(header).toContain(`stroke="${EMBER.ink}"`);
    expect(header).toContain(`fill="${EMBER.signal}"`);
    expect(existsSync(path.join(BRAND_DIR, 'readme-header-dark.svg'))).toBe(false);
    // the transparent lockups: Ember on dark grounds, the Ember ground colour as ink on light ones
    expect(read('lockup-dark.svg')).toContain(`stroke="${EMBER.ink}"`);
    expect(read('lockup-light.svg')).toContain(`stroke="${PALETTE.light.ink}"`);
    expect(PALETTE.light.ink).toBe(EMBER.ground);
  });

  it('puts the Ember ground in the social preview corners and ivory ink in the middle', async () => {
    const { data, info } = await sharp(path.join(BRAND_DIR, 'social-preview.png'))
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => [0, 1, 2].map((c) => data[(y * info.width + x) * info.channels + c] ?? -1);
    const ground = hex(EMBER.ground);
    const w = info.width - 1;
    const h = info.height - 1;
    for (const [x, y] of [
      [0, 0],
      [w, 0],
      [0, h],
      [w, h],
    ] as const)
      expect(px(x, y)).toEqual(ground);
    const ink = hex(EMBER.ink);
    let ivory = 0;
    for (let x = 360; x < 920; x++) {
      const p = px(x, 280);
      if (p.every((v, i) => Math.abs(v - (ink[i] ?? 0)) < 24)) ivory++;
    }
    expect(ivory).toBeGreaterThan(40);
  });
});
