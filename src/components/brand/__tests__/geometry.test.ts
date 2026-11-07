// @vitest-environment node
// The mark's geometry (mark-geometry.ts, written by design/brand/vitals-mark.py) and everything that repeats it:
// public/brand/mark*.svg, index.html's start screen and public/brand/launch.css.
import { BISECTOR_DEG, CENTRE, CROP, CROP_VIEWBOX, cutFor, DRAW_ON, EMBER, MEDIUM, OUTER, PALETTE, SMALL, SMALL_CUT_MAX_PX, MEDIUM_CUT_MAX_PX, STANDARD, trimOffset, type MarkCut } from '../geometry';
import { read } from './brandFiles';

const num = (src: string, re: RegExp) => {
  const m = src.match(re);
  if (!m) throw new Error(`not found: ${re}`);
  return Number(m[1]);
};
const angle = (x: number, y: number) => ((Math.atan2(y - CENTRE, x - CENTRE) * 180) / Math.PI + 360) % 360;
const CUTS: [string, MarkCut][] = [
  ['standard', STANDARD],
  ['medium', MEDIUM],
  ['small', SMALL],
];

describe('the plan ring', () => {
  for (const [name, c] of CUTS) {
    it(`${name} cut: outer edge 9.95, the arc on its circle, open over openDeg centred on the bisector`, () => {
      expect(c.ring.r + c.ring.stroke / 2).toBeCloseTo(OUTER, 9);
      const n = c.ring.d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      expect(n).toHaveLength(9);
      expect(n[2]).toBe(c.ring.r);
      const [x0, y0, x1, y1] = [n[0]!, n[1]!, n[7]!, n[8]!];
      for (const [x, y] of [
        [x0, y0],
        [x1, y1],
      ] as const)
        expect(Math.hypot(x - CENTRE, y - CENTRE)).toBeCloseTo(c.ring.r, 2);
      // the arc starts just after the opening and runs clockwise round to it
      expect(angle(x0, y0)).toBeCloseTo(BISECTOR_DEG + c.ring.openDeg / 2, 1);
      expect(angle(x1, y1)).toBeCloseTo(BISECTOR_DEG - c.ring.openDeg / 2, 1);
      expect(c.ring.length).toBeCloseTo((c.ring.r * Math.PI * (360 - c.ring.openDeg)) / 180, 1);
      if (c.track) expect(c.track.r).toBe(c.ring.r);
    });

    it(`${name} cut: the gold dot sits on the bisector, clear inside the ring`, () => {
      expect(angle(c.dot.cx, c.dot.cy)).toBeCloseTo(BISECTOR_DEG, 0);
      expect(Math.hypot(c.dot.cx - CENTRE, c.dot.cy - CENTRE) + c.dot.r).toBeLessThan(c.ring.r - c.ring.stroke / 2 - 1);
    });
  }

  it('gets heavier and more open as it gets small, and loses the hairline at 24 px and under', () => {
    expect(STANDARD.ring.stroke).toBeLessThan(MEDIUM.ring.stroke);
    expect(MEDIUM.ring.stroke).toBeLessThan(SMALL.ring.stroke);
    expect(STANDARD.ring.openDeg).toBeLessThan(SMALL.ring.openDeg);
    expect(STANDARD.dot.r).toBeLessThan(SMALL.dot.r);
    expect(STANDARD.track).not.toBeNull();
    expect(SMALL.track).toBeNull();
    expect([SMALL_CUT_MAX_PX, MEDIUM_CUT_MAX_PX]).toEqual([24, 40]);
    expect([cutFor(16), cutFor(24), cutFor(25), cutFor(40), cutFor(41), cutFor(88)]).toEqual([SMALL, SMALL, MEDIUM, MEDIUM, STANDARD, STANDARD]);
  });

  it('the crop holds the outer edge', () => {
    expect(CROP_VIEWBOX).toBe('2 2 20 20');
    expect(CROP.x).toBeLessThanOrEqual(CENTRE - OUTER);
    expect(CROP.x + CROP.size).toBeGreaterThanOrEqual(CENTRE + OUTER);
  });

  it('public/brand/mark.svg and mark-small.svg carry the standard and small cuts', () => {
    for (const [file, c] of [
      ['mark.svg', STANDARD],
      ['mark-small.svg', SMALL],
    ] as const) {
      const src = read(`public/brand/${file}`);
      expect(src).toContain('viewBox="0 0 24 24"');
      expect(src.match(/<path id="ring"[^>]*\sd="([^"]+)"/)?.[1], file).toBe(c.ring.d);
      expect(num(src, /\.ring\s*{[^}]*stroke-width:\s*([\d.]+)/)).toBe(c.ring.stroke);
      const dot = src.match(/<circle id="dot"[^>]*\/>/)?.[0] ?? '';
      expect([num(dot, /cx="([\d.]+)"/), num(dot, /cy="([\d.]+)"/), num(dot, /\sr="([\d.]+)"/)]).toEqual([c.dot.cx, c.dot.cy, c.dot.r]);
      expect(num(src, /\.dot\s*{[^}]*stroke-width:\s*([\d.]+)/)).toBe(c.dot.edge);
      expect(src.includes('<circle id="track"'), file).toBe(c.track !== null);
      const [light, dark] = src.split('@media');
      expect(light).toMatch(new RegExp(`\\.ring\\s*{[^}]*stroke:\\s*${PALETTE.light.ink}`));
      expect(light).toMatch(new RegExp(`\\.dot\\s*{[^}]*fill:\\s*${PALETTE.light.signal};\\s*stroke:\\s*${PALETTE.light.edge}`));
      expect(dark).toMatch(new RegExp(`\\.track, \\.ring\\s*{\\s*stroke:\\s*${PALETTE.dark.ink}`));
      expect(dark).toMatch(/\.dot\s*{\s*stroke:\s*none/);
    }
  });

  it('the brand-file palette is Ember: dark grounds get EMBER, light grounds the Ember ground colour as ink', () => {
    expect(PALETTE.dark).toEqual(EMBER);
    expect(PALETTE.light).toEqual({ ground: EMBER.ink, ink: EMBER.ground, signal: EMBER.signal, edge: EMBER.ground });
  });

  it('the in-app (Ember) palette is the one tokens.css gives the auto tone: backdrop, ivory ring, gold dot, no edge', () => {
    const tokens = read('src/styles/tokens.css');
    const token = (name: string) => tokens.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim().toLowerCase();
    expect(token('lm-chassis')).toBe(EMBER.ground);
    expect(token('lm-ink')).toBe(EMBER.ink);
    expect(token('lm-signal')).toBe(EMBER.signal);
    expect(EMBER.edge).toBeNull();
  });
});

describe('the pre-JS start screen (index.html + public/brand/launch.css) uses the same mark and timing', () => {
  const html = read('index.html');
  const css = read('public/brand/launch.css');

  it('index.html links launch.css in <head> and holds the still standard cut inside #root', () => {
    expect(html).toMatch(/<head>[\s\S]*<link rel="stylesheet" href="\/brand\/launch\.css" \/>[\s\S]*<\/head>/);
    const root = html.match(/<div id="root">([\s\S]*?)<\/div>\s*<noscript>/)?.[1] ?? '';
    expect(root).toContain('class="vitals-launch" aria-hidden="true"');
    expect(root).toContain(`viewBox="${CROP_VIEWBOX}"`);
    expect(root).toContain(`<circle class="vitals-launch__track" cx="${CENTRE}" cy="${CENTRE}" r="${STANDARD.track!.r}" />`);
    expect(root).toContain(`d="${STANDARD.ring.d}"`);
    expect(root).toContain(`cx="${STANDARD.dot.cx}" cy="${STANDARD.dot.cy}" r="${STANDARD.dot.r}"`);
  });

  it('launch.css draws the standard cut with the computed length, trim, palette and timing', () => {
    expect(num(css, /\.vitals-launch__track\s*{[^}]*stroke-width:\s*([\d.]+)/)).toBe(STANDARD.track!.stroke);
    expect(num(css, /\.vitals-launch__track\s*{[^}]*stroke-opacity:\s*([\d.]+)/)).toBe(STANDARD.track!.opacity);
    expect(num(css, /\.vitals-launch__ring\s*{[^}]*stroke-width:\s*([\d.]+)/)).toBe(STANDARD.ring.stroke);
    expect(num(css, /\.vitals-launch__ring\s*{[^}]*stroke-dasharray:\s*([\d.]+)/)).toBeCloseTo(STANDARD.ring.length, 1);
    expect(num(css, /@keyframes vitals-launch-draw\s*{\s*from\s*{\s*stroke-dashoffset:\s*([\d.]+)/)).toBeCloseTo(trimOffset(STANDARD), 1);
    expect(num(css, /--vl-edge-width:\s*([\d.]+)/)).toBe(STANDARD.dot.edge);
    expect(css).toMatch(new RegExp(`animation: vitals-launch-draw ${DRAW_ON.ringMs}ms cubic-bezier\\(0\\.4, 0, 0\\.2, 1\\) both`));
    expect(css).toMatch(new RegExp(`animation: vitals-launch-pop ${DRAW_ON.dotMs}ms cubic-bezier\\(0\\.34, 1\\.36, 0\\.64, 1\\) ${DRAW_ON.dotDelayMs}ms both`));
    expect(DRAW_ON.dotDelayMs + DRAW_ON.dotMs).toBeLessThan(1000);
    expect(css.toLowerCase()).toMatch(new RegExp(`\\.vitals-launch\\s*{[^}]*--vl-ink:\\s*${EMBER.ink};[^}]*--vl-signal:\\s*${EMBER.signal};[^}]*--vl-edge:\\s*transparent`));
  });

  it('launch.css is dark only (the Ember backdrop, no theme branch) and has the reduced-motion still rule', () => {
    expect(css).toMatch(new RegExp(`html\\s*{[^}]*background:\\s*${EMBER.ground}`));
    expect(css).toMatch(new RegExp(`\\.vitals-launch\\s*{[^}]*background:\\s*${EMBER.ground}`));
    expect(css).not.toMatch(/data-theme|prefers-color-scheme/);
    expect(css).toMatch(/html\[data-motion='reduce'\] \.vitals-launch__ring,\s*html\[data-motion='reduce'\] \.vitals-launch__dot\s*{\s*animation: none;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*{\s*html:not\(\[data-motion='full'\]\) \.vitals-launch__ring,[\s\S]*?animation: none;/);
  });
});
