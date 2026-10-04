// @vitest-environment node
/** The committed Android brand resources (apps/android/brand, regenerate with node scripts/brand/android.mjs). */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

type XmlNode = { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string };
type Mark = { d: string; stroke: number; dot: { cx: number; cy: number; r: number; edge: number } };
type Tone = { ground: string; ink: string; signal: string; edge: string | null };
type Android = {
  RES_DIR: string;
  LAUNCHER_MASKS: Record<string, string>;
  androidResources: () => Record<string, string>;
  parseXml: (src: string) => XmlNode;
  readColours: (xml: string) => Record<string, string>;
  vectorToSvg: (xml: string, colours?: Record<string, string>) => string;
  maskSvg: (name: string) => string;
  rasterise: (svg: string, size: number) => Promise<Buffer>;
};

// @ts-expect-error plain ESM script without types
const brand = (await import('../../../../scripts/brand/android.mjs')) as Android;
// @ts-expect-error plain ESM script without types
const markSrc = (await import('../../../../scripts/brand/mark.mjs')) as { PALETTE: { light: Tone; dark: Tone }; readMark: (f: string) => Mark };
const { PALETTE, readMark } = markSrc;
// A second, independent XML parser for the well-formedness check.
// @ts-expect-error jsdom ships without types here
const { JSDOM } = (await import('jsdom')) as { JSDOM: new (html: string) => { window: { DOMParser: typeof DOMParser } } };

const read = (rel: string) => readFileSync(join(brand.RES_DIR, rel), 'utf8');
const xml = (rel: string) => brand.parseXml(read(rel));
const A = (n: XmlNode, k: string) => n.attrs[`android:${k}`];
const all = (n: XmlNode): XmlNode[] => [n, ...n.children.flatMap(all)];
const find = (n: XmlNode, name: string, attr?: [string, string]) =>
  all(n).filter((c) => c.name === name && (!attr || A(c, attr[0]) === attr[1]));

const FILES = Object.keys(brand.androidResources());
const colours = brand.readColours(read('values/vitals_brand_colors.xml'));

/** RGBA pixels of an SVG rasterised at size × size. */
const pixels = async (svg: string, size: number) => {
  const { data } = await sharp(await brand.rasterise(svg, size)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return data;
};

describe('Android brand resources', () => {
  it('are committed, current and well-formed XML', () => {
    expect(FILES).toEqual(
      expect.arrayContaining([
        'values/vitals_brand_colors.xml',
        'values-night/vitals_brand_colors.xml',
        'drawable/vitals_launcher_foreground.xml',
        'drawable/vitals_launcher_background.xml',
        'drawable/vitals_launcher_monochrome.xml',
        'mipmap-anydpi-v26/ic_launcher.xml',
        'mipmap-anydpi-v26/ic_launcher_round.xml',
        'drawable/vitals_splash_mark.xml',
        'drawable/vitals_splash_animated.xml',
        'animator/vitals_splash_ring_draw.xml',
        'animator/vitals_splash_dot_pop.xml',
        'drawable/ic_stat_vitals.xml',
      ]),
    );
    const dom = new JSDOM('');
    for (const rel of FILES) {
      expect(existsSync(join(brand.RES_DIR, rel)), rel).toBe(true);
      expect(read(rel), `${rel} is stale: run node scripts/brand/android.mjs`).toBe(brand.androidResources()[rel]);
      const doc = new dom.window.DOMParser().parseFromString(read(rel), 'application/xml');
      expect(doc.getElementsByTagName('parsererror').length, rel).toBe(0);
      expect(() => brand.parseXml(read(rel)), rel).not.toThrow();
    }
    expect(FILES.every((f) => /\/(vitals_|ic_)/.test(`/${f.split('/').at(-1)}`))).toBe(true);
    for (const png of ['playstore-512.png', ...Object.keys(brand.LAUNCHER_MASKS).map((m) => `preview/launcher-${m}.png`)]) {
      expect(existsSync(join(brand.RES_DIR, '..', png)), png).toBe(true);
    }
  });

  it('draw the ring with the source path data', () => {
    const { d } = readMark('mark.svg');
    for (const rel of ['drawable/vitals_launcher_foreground.xml', 'drawable/vitals_launcher_monochrome.xml', 'drawable/vitals_splash_mark.xml']) {
      expect(find(xml(rel), 'path')[0] && A(find(xml(rel), 'path')[0]!, 'pathData'), rel).toBe(d);
    }
    expect(A(find(xml('drawable/ic_stat_vitals.xml'), 'path')[0]!, 'pathData')).toBe(readMark('mark-small.svg').d);
  });

  it('use the palette, light and night', () => {
    const night = brand.readColours(read('values-night/vitals_brand_colors.xml'));
    const { light, dark } = PALETTE;
    expect(colours).toEqual({
      vitals_launcher_background: light.ground,
      vitals_mark_ink: light.ink,
      vitals_mark_signal: light.signal,
      vitals_mark_edge: light.edge,
      vitals_splash_background: light.ground,
    });
    expect(night).toEqual({
      vitals_launcher_background: light.ground,
      vitals_mark_ink: dark.ink,
      vitals_mark_signal: dark.signal,
      vitals_mark_edge: '#00000000',
      vitals_splash_background: dark.ground,
    });
    // The launcher foreground is fixed light-ground ink (its background never goes dark).
    const fg = find(xml('drawable/vitals_launcher_foreground.xml'), 'path');
    expect(fg.map((p) => [A(p, 'strokeColor'), A(p, 'fillColor')])).toEqual([
      [light.ink, '@android:color/transparent'],
      [light.edge, light.signal],
    ]);
  });

  it('adaptive icons reference existing drawables', () => {
    for (const rel of ['mipmap-anydpi-v26/ic_launcher.xml', 'mipmap-anydpi-v26/ic_launcher_round.xml']) {
      const root = xml(rel);
      expect(root.name).toBe('adaptive-icon');
      expect(root.children.map((c) => c.name)).toEqual(['background', 'foreground', 'monochrome']);
      for (const c of root.children) {
        const ref = A(c, 'drawable')!.match(/^@drawable\/(\w+)$/)?.[1];
        expect(ref && existsSync(join(brand.RES_DIR, 'drawable', `${ref}.xml`)), `${rel} ${c.name}`).toBe(true);
      }
    }
  });

  it('keep the foreground inside the safe circle and every launcher mask', async () => {
    const S = 432;
    const fg = await pixels(brand.vectorToSvg(read('drawable/vitals_launcher_foreground.xml'), colours), S);
    const bg = await pixels(brand.vectorToSvg(read('drawable/vitals_launcher_background.xml'), colours), S);
    expect([...bg.subarray(0, 4)]).toEqual([0xe8, 0xea, 0xec, 255]);
    expect(bg[(S * S - 1) * 4 + 3]).toBe(255);
    const safe = ((66 / 108) * S) / 2;
    const ink: number[] = [];
    let far = 0;
    for (let i = 0; i < S * S; i++) {
      if (fg[i * 4 + 3]! === 0) continue;
      ink.push(i);
      far = Math.max(far, Math.hypot((i % S) + 0.5 - S / 2, Math.floor(i / S) + 0.5 - S / 2));
    }
    expect(ink.length).toBeGreaterThan(1000);
    expect(far).toBeLessThan(safe - 8);
    for (const mask of ['circle', 'squircle', 'rounded-square', 'teardrop']) {
      const m = await pixels(brand.maskSvg(mask), S);
      expect(ink.filter((i) => m[i * 4 + 3]! < 255).length, mask).toBe(0);
    }
  });

  it('monochrome and notification icons are white only', async () => {
    for (const rel of ['drawable/vitals_launcher_monochrome.xml', 'drawable/ic_stat_vitals.xml']) {
      const paints = find(xml(rel), 'path').flatMap((p) => [A(p, 'fillColor'), A(p, 'strokeColor')]).filter(Boolean);
      expect(new Set(paints), rel).toEqual(new Set(['#ffffff', '@android:color/transparent']));
    }
    const stat = xml('drawable/ic_stat_vitals.xml');
    expect([A(stat, 'width'), A(stat, 'height')]).toEqual(['24dp', '24dp']);
    // 10 px per dp: the glyph stays inside the 20 dp live area (2 dp padding) and renders white.
    const S = 240;
    const px = await pixels(brand.vectorToSvg(read('drawable/ic_stat_vitals.xml')), S);
    let n = 0;
    for (let i = 0; i < S * S; i++) {
      if (px[i * 4 + 3]! === 0) continue;
      n++;
      const [x, y] = [i % S, Math.floor(i / S)];
      expect(x >= 20 && x < 220 && y >= 20 && y < 220, `pixel ${x},${y}`).toBe(true);
      expect(Math.min(px[i * 4]!, px[i * 4 + 1]!, px[i * 4 + 2]!)).toBeGreaterThan(250);
    }
    expect(n).toBeGreaterThan(1000);
  });

  it('splash draws the ring on, pops the dot and plays once', () => {
    const avd = xml('drawable/vitals_splash_animated.xml');
    expect(avd.name).toBe('animated-vector');
    expect(A(avd, 'drawable')).toBe('@drawable/vitals_splash_mark');
    const targets = Object.fromEntries(avd.children.map((t) => [A(t, 'name'), A(t, 'animation')]));
    expect(targets).toEqual({ ring: '@animator/vitals_splash_ring_draw', dot: '@animator/vitals_splash_dot_pop' });

    const mark = xml('drawable/vitals_splash_mark.xml');
    expect(find(mark, 'path', ['name', 'ring'])).toHaveLength(1);
    const dot = find(mark, 'group', ['name', 'dot'])[0]!;
    const m = readMark('mark.svg');
    expect([A(dot, 'pivotX'), A(dot, 'pivotY'), A(dot, 'scaleX'), A(dot, 'scaleY')]).toEqual([String(m.dot.cx), String(m.dot.cy), '0', '0']);
    expect([A(dot.children[0]!, 'fillColor'), A(dot.children[0]!, 'strokeColor')]).toEqual(['@color/vitals_mark_signal', '@color/vitals_mark_edge']);

    const ring = xml('animator/vitals_splash_ring_draw.xml');
    expect([A(ring, 'propertyName'), A(ring, 'valueFrom'), A(ring, 'valueTo'), A(ring, 'duration'), A(ring, 'interpolator')]).toEqual([
      'trimPathEnd',
      '0.05',
      '1',
      '500',
      '@android:interpolator/fast_out_slow_in',
    ]);
    const pop = find(xml('animator/vitals_splash_dot_pop.xml'), 'objectAnimator');
    expect(pop.map((a) => [A(a, 'propertyName'), A(a, 'valueFrom'), A(a, 'valueTo')])).toEqual([
      ['scaleX', '0', '1'],
      ['scaleY', '0', '1'],
    ]);
    const ends = [Number(A(ring, 'duration')), ...pop.map((a) => Number(A(a, 'startOffset')) + Number(A(a, 'duration')))];
    expect(Math.max(...ends)).toBeLessThanOrEqual(700);
    for (const a of pop) {
      const ref = A(a, 'interpolator')!.match(/^@interpolator\/(\w+)$/)![1]!;
      const interp = xml(`interpolator/${ref}.xml`);
      expect(interp.name).toBe('overshootInterpolator');
      expect(Number(A(interp, 'tension'))).toBeLessThan(2);
    }
    // Plays once and stops.
    for (const rel of ['animator/vitals_splash_ring_draw.xml', 'animator/vitals_splash_dot_pop.xml']) {
      expect(all(xml(rel)).some((n) => A(n, 'repeatCount') !== undefined || A(n, 'repeatMode') !== undefined), rel).toBe(false);
    }
  });

  it('splash mark fits the 192 dp circle of the 288 dp icon', () => {
    const mark = xml('drawable/vitals_splash_mark.xml');
    expect([A(mark, 'width'), A(mark, 'viewportWidth')]).toEqual(['288dp', '108']);
    const g = find(mark, 'group', ['name', 'mark'])[0]!;
    expect([A(g, 'pivotX'), A(g, 'pivotY')]).toEqual(['54', '54']);
    const m = readMark('mark.svg');
    const reach = Math.max(30 + m.stroke / 2, Math.hypot(m.dot.cx - 54, m.dot.cy - 54) + m.dot.r + m.dot.edge / 2);
    expect(reach * Number(A(g, 'scaleX'))).toBeLessThan((192 / 288) * 54);
  });
});
