/**
 * Row hover contrast (PLAN 02 item 11; COMPONENTS §14.1): the ladder card's row hover is the card's own surface with 6 %
 * ink mixed in (oklab), never a tinted fill, and text keeps its colour. Computed from the actual token values in
 * src/styles/tokens.css and the mix declared in ladder.css (jsdom computes no styles), for both themes and both card
 * surfaces (a rung's faceplate; the Ideal's 70 % face / chassis mix): every text ink keeps ≥ 4.5:1 on hover.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type RGB = [number, number, number];
const tokens = readFileSync(resolve(__dirname, '../../../styles/tokens.css'), 'utf8');
const ladderCss = readFileSync(resolve(__dirname, '../ladder.css'), 'utf8');

/** `--name: #hex` from the first block (light) and from the forced-dark block. */
function token(name: string, theme: 'light' | 'dark'): string {
  const src = theme === 'light' ? tokens : tokens.slice(tokens.indexOf(':root[data-theme="dark"]'));
  const m = src.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`token --${name} (${theme}) not found`);
  return m[1]!;
}

const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function toOklab([r, g, b]: RGB): RGB {
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function fromOklab([L, a, b]: RGB): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return rgb.map((c) => Math.min(1, Math.max(0, gam(c)))) as RGB;
}
/** CSS `color-mix(in oklab, a, b p%)`. */
const mix = (a: RGB, b: RGB, p: number): RGB => {
  const A = toOklab(a);
  const B = toOklab(b);
  return fromOklab(A.map((x, i) => x * (1 - p) + B[i]! * p) as RGB);
};
const lum = (c: RGB) => {
  const [r, g, b] = c.map(lin) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: RGB, b: RGB) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

/**
 * The hover token (src/styles/tokens.css, COMPONENTS §14.1): `--lm-face-hover: color-mix(in oklab, var(--lm-face),
 * var(--lm-ink) N%)`; the plain card uses it, the Ideal card applies the same share over its own surface.
 */
function hoverShare(): number {
  const m = tokens.match(/--lm-face-hover:\s*color-mix\(in oklab,\s*var\(--lm-face\),\s*var\(--lm-ink\)\s*(\d+(?:\.\d+)?)%\)/);
  if (!m) throw new Error('--lm-face-hover not declared in tokens.css as an ink mix of the face');
  expect(ladderCss).toMatch(/--lp-face-hover:\s*var\(--lm-face-hover\)/);
  const ideal = ladderCss.match(/--lp-face-hover:\s*color-mix\(in oklab,\s*var\(--lp-surface\),\s*var\(--lm-ink\)\s*(\d+(?:\.\d+)?)%\)/);
  expect(ideal?.[1]).toBe(m[1]);
  return Number(m[1]) / 100;
}

describe('ladder row hover keeps text readable', () => {
  it('is a 4–6 % ink mix of the card’s own surface, painted only on controls, with no text colour change', () => {
    const p = hoverShare();
    expect(p).toBeGreaterThanOrEqual(0.04);
    expect(p).toBeLessThanOrEqual(0.06);
    // the old wash (ink-faint over whole rows, compared across cards) is gone
    expect(ladderCss).not.toMatch(/\[data-hover\]/);
    const hoverRules = ladderCss.match(/:hover\s*\{[^}]*\}/g) ?? [];
    for (const r of hoverRules) expect(r).not.toMatch(/(^|[^-])color:/);
    expect(hoverRules.join('\n')).toMatch(/background: var\(--lp-face-hover\)/);
  });

  for (const theme of ['light', 'dark'] as const) {
    it(`gives every text ink ≥ 4.5:1 on the hover surface (${theme})`, () => {
      const face = hex(token('lm-face', theme));
      const chassis = hex(token('lm-chassis', theme));
      const ink = hex(token('lm-ink', theme));
      const surfaces = { rung: face, ideal: mix(face, chassis, 0.3) };
      const p = hoverShare();
      for (const [name, surface] of Object.entries(surfaces)) {
        const hover = mix(surface, ink, p);
        // the shift is a few percent of lightness, not a new colour
        const dL = Math.abs(toOklab(hover)[0] - toOklab(surface)[0]);
        expect(dL, `${theme} ${name} lightness shift`).toBeGreaterThan(0.02);
        expect(dL, `${theme} ${name} lightness shift`).toBeLessThan(0.07);
        for (const t of ['lm-ink', 'lm-ink-2', 'lm-ink-3']) {
          const c = contrast(hex(token(t, theme)), hover);
          expect(c, `${t} on ${theme} ${name} hover = ${c.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }

  it('measures the bug it replaces: ink-3 over the old ink-faint wash fell below 4.5:1', () => {
    const c = contrast(hex(token('lm-ink-3', 'light')), hex(token('lm-ink-faint', 'light')));
    expect(c).toBeLessThan(4.5);
  });
});
