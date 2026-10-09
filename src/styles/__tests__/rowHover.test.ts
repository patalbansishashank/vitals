/**
 * Row hover sweep (PLAN 02 item 11; COMPONENTS §14.1). The hover fill is computed here from the actual token values in
 * src/styles/tokens.css for both themes (jsdom computes no styles): every text ink keeps ≥ 4.5:1 on the hover fill and
 * on the touch pressed fill, and the shift is a few percent of lightness, not a tint. The stylesheets are then read as
 * text: interactive rows paint the token and never change text colour; rows that open nothing have no hover rule.
 * The ladder has its own test (src/features/planner/__tests__/hoverContrast.test.ts).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type RGB = [number, number, number];
const root = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const tokens = read('src/styles/tokens.css');

/** `--name: #hex` from the first (light) block and from the forced-dark block. */
function token(name: string, theme: 'light' | 'dark'): RGB {
  const src = theme === 'light' ? tokens : tokens.slice(tokens.indexOf(':root[data-theme="dark"]'));
  const m = src.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`token --${name} (${theme}) not found`);
  return [1, 3, 5].map((i) => parseInt(m[1]!.slice(i, i + 2), 16) / 255) as RGB;
}

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
/** `color-mix(in oklab, transparent, ink p%)` painted over a surface: ink at p alpha, composited in sRGB. */
const over = (surface: RGB, ink: RGB, p: number): RGB => surface.map((c, i) => c * (1 - p) + ink[i]! * p) as RGB;
const lum = (c: RGB) => {
  const [r, g, b] = c.map(lin) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: RGB, b: RGB) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

function hoverShare(): number {
  const m = tokens.match(/--lm-face-hover:\s*color-mix\(in oklab,\s*var\(--lm-face\),\s*var\(--lm-ink\)\s*(\d+(?:\.\d+)?)%\)/);
  if (!m) throw new Error('--lm-face-hover not declared in tokens.css as an ink mix of the face');
  return Number(m[1]) / 100;
}

const INKS = ['lm-ink', 'lm-ink-2', 'lm-ink-3'] as const;

describe('row hover token keeps text readable', () => {
  it('is a 4–6 % ink mix of the face, declared the same in design/tokens.css', () => {
    const p = hoverShare();
    expect(p).toBeGreaterThanOrEqual(0.04);
    expect(p).toBeLessThanOrEqual(0.06);
    expect(read('design/tokens.css')).toMatch(/--lm-face-hover:\s*color-mix\(in oklab,\s*var\(--lm-face\),\s*var\(--lm-ink\)\s*6%\)/);
  });

  for (const theme of ['light', 'dark'] as const) {
    it(`gives ink, ink-2 and ink-3 ≥ 4.5:1 on the hover and pressed fills (${theme})`, () => {
      const ink = token('lm-ink', theme);
      const face = token('lm-face', theme);
      const p = hoverShare();
      const fills: Record<string, RGB> = {
        'face hover': mix(face, ink, p),
        'face pressed (10 %)': mix(face, ink, 0.1),
        // menu rows over a popover (raised) or a sheet (face): ink at 4 % alpha (6 % fails ink-3 on dark raised: 4.3:1)
        'raised menu row': over(token('lm-raised', theme), ink, 0.04),
        'face menu row': over(face, ink, 0.04),
      };
      const dL = Math.abs(toOklab(fills['face hover']!)[0] - toOklab(face)[0]);
      expect(dL, `${theme} lightness shift`).toBeGreaterThan(0.02);
      expect(dL, `${theme} lightness shift`).toBeLessThan(0.07);
      for (const [name, fill] of Object.entries(fills)) {
        for (const t of INKS) {
          const c = contrast(token(t, theme), fill);
          expect(c, `${t} on ${theme} ${name} = ${c.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }
});

/** All `{…}` bodies of rules whose selector list contains `selector` and `:hover`. */
function hoverRules(css: string, selector: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1]!;
    if (sel.includes(':hover') && sel.split(',').some((s) => s.includes(selector) && s.includes(':hover'))) out.push(m[2]!);
  }
  return out;
}

const INTERACTIVE: [file: string, selector: string, fill: RegExp][] = [
  ['src/features/living/living.css', '.lv-item.is-open', /background: var\(--lm-face-hover\)/],
  ['src/features/living/train/train.css', '.lv-train-weekrow', /background: var\(--lm-face-hover\)/],
  ['src/features/living/train/train.css', '.lv-train-result', /background: var\(--lm-face-hover\)/],
  ['src/features/living/progress/progress.css', 'a.lv-prog-cal__key', /background: var\(--lm-face-hover\)/],
  ['src/features/evidence/evidence.css', '.ev-row', /background: var\(--lm-face-hover\)/],
  ['src/features/evidence/evidence.css', '.ev-pager__a', /background: var\(--lm-face-hover\)/],
  ['src/features/planner/planner.css', '.lp-week tbody tr', /background: var\(--lm-face-hover\)/],
  ['src/features/simulator/simulator.css', '.sim-scenarios__item', /background: color-mix\(in oklab, transparent, var\(--lm-ink\) 4%\)/],
];

const NO_TEXT_COLOUR: [file: string, selector: string][] = [
  ...INTERACTIVE.map(([f, s]) => [f, s] as [string, string]),
  ['src/features/living/components/ScoreTile.css', '.lv-score__link'],
  ['src/features/living/components/ScoreTile.css', '.lv-score__ver'],
];

/** Rows that open nothing (their control is a key inside them, or nothing at all): no hover rule at all. */
const NON_INTERACTIVE: [file: string, selector: string][] = [
  ['src/features/evidence/evidence.css', '.ev-table'],
  ['src/features/charts/charts.css', '.lmc-table'],
  ['src/features/intake/intake.css', '.lm-ik-row-a'],
  ['src/features/components/SupplementRow.css', '.lm-supprow'],
];

describe('row hover sweep', () => {
  it.each(INTERACTIVE)('%s %s paints the surface hover inside @media (hover: hover)', (file, selector, fill) => {
    const css = read(file);
    const rules = hoverRules(css, selector);
    expect(rules.length, `${selector} has a hover rule`).toBeGreaterThan(0);
    expect(rules.join('\n')).toMatch(fill);
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const at = css.search(new RegExp(`${esc}[^{,]*:hover`));
    expect(css.slice(Math.max(0, at - 200), at), `${selector} hover is guarded by @media (hover: hover)`).toMatch(/@media \(hover: hover\) \{\s*(\/\*[^*]*\*\/\s*)?$/);
  });

  it.each(NO_TEXT_COLOUR)('%s %s keeps its text colour on hover', (file, selector) => {
    for (const r of hoverRules(read(file), selector)) expect(r).not.toMatch(/(^|[^-])color:/);
  });

  it('menu rows (shared Menu/Listbox) use the 4 % share that stays readable on the dark popover', () => {
    const rules = hoverRules(read('src/styles/components.css'), '.lm-menu__item');
    expect(rules.join('\n')).toMatch(/background: color-mix\(in oklab, transparent, var\(--lm-ink\) 4%\)/);
  });

  it.each(NON_INTERACTIVE)('%s %s has no row hover', (file, selector) => {
    expect(hoverRules(read(file), selector)).toEqual([]);
  });
});
