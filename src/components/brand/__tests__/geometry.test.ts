// @vitest-environment node
// The SVGs under public/brand are the mark's source of truth; geometry.ts, index.html's start screen and
// public/brand/launch.css must all agree with them.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { arcLength, arcSweepDeg, CROP, CROP_VIEWBOX, cutFor, DRAW_ON, PALETTE, RING_CENTRE, RING_RADIUS, SMALL, SMALL_CUT_MAX_PX, STANDARD, trimOffset, type MarkCut } from '../geometry';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const num = (src: string, re: RegExp) => {
  const m = src.match(re);
  if (!m) throw new Error(`not found: ${re}`);
  return Number(m[1]);
};

/** The same reader scripts/brand/mark.mjs uses. */
function readMark(file: string) {
  const src = read(`public/brand/${file}`);
  const circle = src.match(/<circle id="dot"[^>]*\/>/)?.[0] ?? '';
  return {
    d: src.match(/<path id="ring"[^>]*\sd="([^"]+)"/)?.[1],
    stroke: num(src, /\.ring\s*{[^}]*stroke-width:\s*([\d.]+)/),
    dot: { cx: num(circle, /cx="([\d.]+)"/), cy: num(circle, /cy="([\d.]+)"/), r: num(circle, /\sr="([\d.]+)"/), edge: num(src, /\.dot\s*{[^}]*stroke-width:\s*([\d.]+)/) },
    src,
  };
}

const sameAsSvg = (cut: MarkCut, file: string) => {
  const m = readMark(file);
  expect(cut.ring.d).toBe(m.d);
  expect(cut.ring.stroke).toBe(m.stroke);
  expect(cut.dot).toEqual(m.dot);
};

describe('mark geometry mirrors public/brand/*.svg', () => {
  it('standard cut equals mark.svg', () => sameAsSvg(STANDARD, 'mark.svg'));
  it('small cut equals mark-small.svg', () => sameAsSvg(SMALL, 'mark-small.svg'));

  it('both arcs are circles of radius 30 around 54,54 (start and end points lie on the ring)', () => {
    for (const c of [STANDARD, SMALL]) {
      const nums = c.ring.d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      expect(nums[2]).toBe(RING_RADIUS);
      const points: Array<[number, number]> = [
        [nums[0]!, nums[1]!],
        [nums[7]!, nums[8]!],
      ];
      for (const [x, y] of points) {
        expect(Math.hypot(x - RING_CENTRE, y - RING_CENTRE)).toBeCloseTo(RING_RADIUS, 1);
      }
    }
  });

  it('the opening is 23 degrees (standard) and 34 (small), and the length is the arc of radius 30 over the sweep', () => {
    expect(360 - STANDARD.ring.sweepDeg).toBeCloseTo(23.46, 1);
    expect(360 - SMALL.ring.sweepDeg).toBeCloseTo(34, 1);
    for (const c of [STANDARD, SMALL]) {
      expect(c.ring.length).toBeCloseTo((2 * Math.PI * RING_RADIUS * c.ring.sweepDeg) / 360, 1);
      expect(c.ring.length).toBe(arcLength(arcSweepDeg(c.ring.d)));
    }
    expect(STANDARD.ring.length).toBeCloseTo(176.21, 2);
    expect(SMALL.ring.length).toBeCloseTo(170.69, 2);
  });

  it('the dot sits on the bisector of the opening (35 degrees) inside the ring', () => {
    for (const c of [STANDARD, SMALL]) {
      const angle = (Math.atan2(c.dot.cy - RING_CENTRE, c.dot.cx - RING_CENTRE) * 180) / Math.PI;
      expect(angle).toBeCloseTo(35, 0);
      expect(Math.hypot(c.dot.cx - RING_CENTRE, c.dot.cy - RING_CENTRE) + c.dot.r).toBeLessThan(RING_RADIUS - c.ring.stroke / 2);
    }
  });

  it('the crop holds the heavier ring with a margin and the small cut starts at 32 px', () => {
    const outer = RING_RADIUS + SMALL.ring.stroke / 2;
    expect(CROP.x).toBeLessThan(RING_CENTRE - outer);
    expect(CROP.x + CROP.size).toBeGreaterThan(RING_CENTRE + outer);
    expect(CROP_VIEWBOX).toBe('18 18 72 72');
    expect(SMALL_CUT_MAX_PX).toBe(32);
    expect(cutFor(32)).toBe(SMALL);
    expect(cutFor(33)).toBe(STANDARD);
  });

  it('the palette equals the colours in the SVGs and the chassis in tokens.css', () => {
    const { src } = readMark('mark.svg');
    const light = src.split('@media')[0]!;
    const dark = src.split('@media')[1]!;
    expect(light).toMatch(new RegExp(`\\.ring\\s*{[^}]*stroke:\\s*${PALETTE.light.ink}`));
    expect(light).toMatch(new RegExp(`\\.dot\\s*{[^}]*fill:\\s*${PALETTE.light.signal};\\s*stroke:\\s*${PALETTE.light.edge}`));
    expect(dark).toMatch(new RegExp(`\\.ring\\s*{[^}]*stroke:\\s*${PALETTE.dark.ink}`));
    expect(dark).toMatch(new RegExp(`\\.dot\\s*{[^}]*fill:\\s*${PALETTE.dark.signal};\\s*stroke:\\s*none`));
    const tokens = read('src/styles/tokens.css');
    expect(tokens).toMatch(new RegExp(`--lm-chassis:\\s*${PALETTE.light.ground}`));
    expect(tokens).toMatch(new RegExp(`--lm-chassis:\\s*${PALETTE.dark.ground}`));
  });
});

describe('the pre-JS start screen (index.html + public/brand/launch.css) uses the same mark and timing', () => {
  const html = read('index.html');
  const css = read('public/brand/launch.css');

  it('index.html links launch.css in <head> and holds the still mark inside #root', () => {
    expect(html).toMatch(/<head>[\s\S]*<link rel="stylesheet" href="\/brand\/launch\.css" \/>[\s\S]*<\/head>/);
    const root = html.match(/<div id="root">([\s\S]*?)<\/div>\s*<noscript>/)?.[1] ?? '';
    expect(root).toContain('class="vitals-launch" aria-hidden="true"');
    expect(root).toContain(`viewBox="${CROP_VIEWBOX}"`);
    expect(root).toContain(`d="${STANDARD.ring.d}"`);
    expect(root).toContain(`cx="${STANDARD.dot.cx}" cy="${STANDARD.dot.cy}" r="${STANDARD.dot.r}"`);
  });

  it('launch.css draws the standard cut with the computed length, trim, palette and timing', () => {
    expect(num(css, /\.vitals-launch__ring\s*{[^}]*stroke-width:\s*([\d.]+)/)).toBe(STANDARD.ring.stroke);
    expect(num(css, /\.vitals-launch__ring\s*{[^}]*stroke-dasharray:\s*([\d.]+)/)).toBeCloseTo(STANDARD.ring.length, 1);
    expect(num(css, /@keyframes vitals-launch-draw\s*{\s*from\s*{\s*stroke-dashoffset:\s*([\d.]+)/)).toBeCloseTo(trimOffset(STANDARD), 1);
    expect(num(css, /--vl-edge-width:\s*([\d.]+)/)).toBe(STANDARD.dot.edge);
    expect(css).toMatch(new RegExp(`animation: vitals-launch-draw ${DRAW_ON.ringMs}ms cubic-bezier\\(0\\.4, 0, 0\\.2, 1\\) both`));
    expect(css).toMatch(new RegExp(`animation: vitals-launch-pop ${DRAW_ON.dotMs}ms cubic-bezier\\(0\\.34, 1\\.36, 0\\.64, 1\\) ${DRAW_ON.dotDelayMs}ms both`));
    expect(DRAW_ON.dotDelayMs + DRAW_ON.dotMs).toBeLessThan(1000);
    for (const v of [PALETTE.light.ground, PALETTE.light.ink, PALETTE.light.signal, PALETTE.dark.ground, PALETTE.dark.ink, PALETTE.dark.signal]) {
      expect(css).toContain(v);
    }
  });

  it('launch.css follows html[data-theme] and the OS, and has the reduced-motion still rule', () => {
    expect(css).toMatch(/html\[data-theme='dark'\] \.vitals-launch\s*{[^}]*background: #151618/);
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)\s*{[\s\S]*html:not\(\[data-theme='light'\]\) \.vitals-launch\s*{[^}]*background: #151618/);
    expect(css).toMatch(/html\[data-motion='reduce'\] \.vitals-launch__ring,\s*html\[data-motion='reduce'\] \.vitals-launch__dot\s*{\s*animation: none;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*{\s*html:not\(\[data-motion='full'\]\) \.vitals-launch__ring,[\s\S]*?animation: none;/);
  });
});
