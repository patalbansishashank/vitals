// @vitest-environment node
/** The committed Android brand resources (apps/android/brand, written by design/brand/vitals-mark.py). */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { CENTRE, EMBER, MONO, NOTIFICATION, STANDARD } from '../geometry';
import { A, all, at, find, LAUNCHER_MASKS, maskSvg, parseXml, rasterise, read as readRepo, readColours, vectorToSvg } from './brandFiles';

// A second, independent XML parser for the well-formedness check.
// @ts-expect-error jsdom ships without types here
const { JSDOM } = (await import('jsdom')) as { JSDOM: new (html: string) => { window: { DOMParser: typeof DOMParser } } };

const BRAND = 'apps/android/brand';
const RES = `${BRAND}/res`;
const read = (rel: string) => readRepo(`${RES}/${rel}`);
const xml = (rel: string) => parseXml(read(rel));
const DENSITIES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 } as const;

const XMLS = [
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
  'interpolator/vitals_splash_overshoot.xml',
  'drawable/ic_stat_vitals.xml',
];
const colours = readColours(read('values/vitals_brand_colors.xml'));

describe('Android brand resources', () => {
  it('are committed and well-formed XML, with nothing else in the res folder', () => {
    const dom = new JSDOM('');
    for (const rel of XMLS) {
      expect(existsSync(at(`${RES}/${rel}`)), rel).toBe(true);
      const doc = new dom.window.DOMParser().parseFromString(read(rel), 'application/xml');
      expect(doc.getElementsByTagName('parsererror').length, rel).toBe(0);
      expect(() => xml(rel), rel).not.toThrow();
    }
    const pngs = Object.keys(DENSITIES).flatMap((d) => [`mipmap-${d}/ic_launcher.png`, `mipmap-${d}/ic_launcher_round.png`]);
    const everything = readdirSync(at(RES), { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => join(e.parentPath, e.name).slice(at(RES).length + 1))
      .sort();
    expect(everything).toEqual([...XMLS, ...pngs].sort());
    for (const png of ['playstore-512.png', ...Object.keys(LAUNCHER_MASKS).map((m) => `preview/launcher-${m}.png`)])
      expect(existsSync(at(`${BRAND}/${png}`)), png).toBe(true);
  });

  it('draw the ring with the generated path data: standard on the launcher and splash, mono on the themed icon, the notification ring on the notification icon', () => {
    const ring = (rel: string) => A(find(xml(rel), 'path', ['name', 'ring'])[0]!, 'pathData');
    expect(ring('drawable/vitals_launcher_foreground.xml')).toBe(STANDARD.ring.d);
    expect(ring('drawable/vitals_splash_mark.xml')).toBe(STANDARD.ring.d);
    expect(ring('drawable/vitals_launcher_monochrome.xml')).toBe(MONO.ring.d);
    expect(ring('drawable/ic_stat_vitals.xml')).toBe(NOTIFICATION.ring.d);
    // the notification keeps the hairline bezel, at half alpha, like Gauge's
    const track = find(xml('drawable/ic_stat_vitals.xml'), 'path', ['name', 'track']);
    expect(track.map((t) => [A(t, 'strokeWidth'), A(t, 'strokeAlpha')])).toEqual([[String(NOTIFICATION.track!.stroke), String(NOTIFICATION.track!.opacity)]]);
    // the mark's 24-unit space scaled 3x onto the 108 dp layer, centred
    for (const rel of ['drawable/vitals_launcher_foreground.xml', 'drawable/vitals_launcher_monochrome.xml', 'drawable/vitals_splash_mark.xml']) {
      const g = find(xml(rel), 'group')[0]!;
      expect([A(g, 'translateX'), A(g, 'translateY'), A(g, 'scaleX'), A(g, 'scaleY')], rel).toEqual(['18', '18', '3', '3']);
    }
  });

  it('launcher and splash in the Ember palette in light and night mode alike', () => {
    const night = readColours(read('values-night/vitals_brand_colors.xml'));
    const ember = {
      vitals_launcher_background: EMBER.ground,
      vitals_mark_ink: EMBER.ink,
      vitals_mark_signal: EMBER.signal,
      vitals_splash_background: EMBER.ground,
    };
    expect(colours).toEqual(ember);
    expect(night).toEqual(ember);
    // the launcher foreground is fixed Ember: an ivory bezel and ring, the gold dot, no edge
    const fg = find(xml('drawable/vitals_launcher_foreground.xml'), 'path');
    expect(fg.map((p) => [A(p, 'name'), A(p, 'strokeColor'), A(p, 'fillColor'), A(p, 'strokeAlpha')])).toEqual([
      ['track', EMBER.ink, '#00000000', String(STANDARD.track!.opacity)],
      ['ring', EMBER.ink, '#00000000', undefined],
      [undefined, undefined, EMBER.signal, undefined],
    ]);
  });

  it('adaptive icons reference existing drawables', () => {
    for (const rel of ['mipmap-anydpi-v26/ic_launcher.xml', 'mipmap-anydpi-v26/ic_launcher_round.xml']) {
      const root = xml(rel);
      expect(root.name).toBe('adaptive-icon');
      expect(root.children.map((c) => c.name)).toEqual(['background', 'foreground', 'monochrome']);
      for (const c of root.children) {
        const ref = A(c, 'drawable')!.match(/^@drawable\/(\w+)$/)?.[1];
        expect(ref && existsSync(at(`${RES}/drawable/${ref}.xml`)), `${rel} ${c.name}`).toBe(true);
      }
    }
  });

  it('keep the foreground inside the 66 dp safe circle and every launcher mask', async () => {
    const S = 432;
    const fg = await rasterise(vectorToSvg(read('drawable/vitals_launcher_foreground.xml'), colours), S);
    const bg = await rasterise(vectorToSvg(read('drawable/vitals_launcher_background.xml'), colours), S);
    expect([...bg.data.subarray(0, 4)]).toEqual([0x09, 0x09, 0x09, 255]);
    const safe = ((66 / 108) * S) / 2;
    const ink: number[] = [];
    let far = 0;
    for (let i = 0; i < S * S; i++) {
      if (fg.data[i * 4 + 3]! === 0) continue;
      ink.push(i);
      far = Math.max(far, Math.hypot((i % S) + 0.5 - S / 2, Math.floor(i / S) + 0.5 - S / 2));
    }
    expect(ink.length).toBeGreaterThan(1000);
    expect(far).toBeLessThan(safe - 8);
    for (const mask of Object.keys(LAUNCHER_MASKS)) {
      const m = await rasterise(maskSvg(mask), S);
      expect(ink.filter((i) => m.data[i * 4 + 3]! < 255).length, mask).toBe(0);
    }
  });

  it('ship legacy square and round launcher PNGs at every density, opaque Ember inside, round ones circular', async () => {
    for (const [dpi, size] of Object.entries(DENSITIES)) {
      for (const name of ['ic_launcher', 'ic_launcher_round']) {
        const f = at(`${RES}/mipmap-${dpi}/${name}.png`);
        const meta = await sharp(f).metadata();
        expect([meta.width, meta.height, meta.channels], `${dpi} ${name}`).toEqual([size, size, 4]);
        const { data } = await sharp(f).raw().toBuffer({ resolveWithObject: true });
        const c = (size / 2) * (size + 1) * 4; // centre pixel
        expect(data[c + 3]).toBe(255);
        if (name === 'ic_launcher_round') expect(data[3]).toBe(0);
      }
    }
  });

  it('monochrome and notification icons are white only; the notification icon keeps 2 dp padding', async () => {
    for (const rel of ['drawable/vitals_launcher_monochrome.xml', 'drawable/ic_stat_vitals.xml']) {
      const paints = find(xml(rel), 'path').flatMap((p) => [A(p, 'fillColor'), A(p, 'strokeColor')]).filter(Boolean);
      expect(new Set(paints), rel).toEqual(new Set(['#ffffff', '#00000000']));
    }
    const stat = xml('drawable/ic_stat_vitals.xml');
    expect([A(stat, 'width'), A(stat, 'height'), A(stat, 'viewportWidth')]).toEqual(['24dp', '24dp', '24']);
    // 10 px per dp: the glyph stays inside the 20 dp live area and renders white
    const S = 240;
    const r = await rasterise(vectorToSvg(read('drawable/ic_stat_vitals.xml')), S);
    let n = 0;
    for (let i = 0; i < S * S; i++) {
      if (r.data[i * 4 + 3]! === 0) continue;
      n++;
      const [x, y] = [i % S, Math.floor(i / S)];
      expect(x >= 20 && x < 220 && y >= 20 && y < 220, `pixel ${x},${y}`).toBe(true);
      expect(Math.min(r.data[i * 4]!, r.data[i * 4 + 1]!, r.data[i * 4 + 2]!)).toBeGreaterThan(250);
    }
    expect(n).toBeGreaterThan(1000);
  });

  it('splash keeps the bezel, draws the ring on, pops the dot and plays once', () => {
    const avd = xml('drawable/vitals_splash_animated.xml');
    expect(avd.name).toBe('animated-vector');
    expect(A(avd, 'drawable')).toBe('@drawable/vitals_splash_mark');
    expect(Object.fromEntries(avd.children.map((t) => [A(t, 'name'), A(t, 'animation')]))).toEqual({
      ring: '@animator/vitals_splash_ring_draw',
      dot: '@animator/vitals_splash_dot_pop',
    });
    const mark = xml('drawable/vitals_splash_mark.xml');
    expect(find(mark, 'path', ['name', 'track'])).toHaveLength(1);
    expect(find(mark, 'path', ['name', 'ring'])).toHaveLength(1);
    const dot = find(mark, 'group', ['name', 'dot'])[0]!;
    expect([A(dot, 'pivotX'), A(dot, 'pivotY'), A(dot, 'scaleX'), A(dot, 'scaleY')]).toEqual([String(STANDARD.dot.cx), String(STANDARD.dot.cy), '0', '0']);
    expect(A(dot.children[0]!, 'fillColor')).toBe('@color/vitals_mark_signal');

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
    // the theme's windowSplashScreenAnimationDuration
    const styles = readRepo('apps/android/android/app/src/main/res/values/styles.xml');
    const total = Number(styles.match(/windowSplashScreenAnimationDuration">(\d+)</)?.[1]);
    expect(Math.max(...ends)).toBeLessThanOrEqual(total);
    const interp = xml('interpolator/vitals_splash_overshoot.xml');
    expect(interp.name).toBe('overshootInterpolator');
    expect(Number(A(interp, 'tension'))).toBeLessThan(2);
    for (const rel of ['animator/vitals_splash_ring_draw.xml', 'animator/vitals_splash_dot_pop.xml'])
      expect(all(xml(rel)).some((n) => A(n, 'repeatCount') !== undefined || A(n, 'repeatMode') !== undefined), rel).toBe(false);
  });

  it('splash mark fits the 192 dp circle of the 288 dp icon', () => {
    const mark = xml('drawable/vitals_splash_mark.xml');
    expect([A(mark, 'width'), A(mark, 'viewportWidth')]).toEqual(['288dp', '108']);
    const g = find(mark, 'group', ['name', 'mark'])[0]!;
    const k = Number(A(g, 'scaleX'));
    expect(Number(A(g, 'translateX')) + CENTRE * k).toBe(54);
    expect((STANDARD.ring.r + STANDARD.ring.stroke / 2) * k).toBeLessThan((192 / 288) * 54);
  });
});
