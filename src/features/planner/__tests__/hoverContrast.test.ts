/**
 * Row hover contrast (PLAN 02 item 11; COMPONENTS §14.1, Ember): the ladder card's row hover is the gold-soft
 * selection wash (`--lm-gold-soft`, gold at 18 %) over the card's own surface, painted only on controls, and text keeps
 * its colour. Computed from the actual token values in src/styles/tokens.css and the rules in ladder.css (jsdom
 * computes no styles), for both card surfaces (a rung's card #1B1916; the Ideal, transparent over the #090909
 * backdrop): every text ink keeps ≥ 4.5:1 on hover.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type RGB = [number, number, number];
const tokens = readFileSync(resolve(__dirname, '../../../styles/tokens.css'), 'utf8');
const ladderCss = readFileSync(resolve(__dirname, '../ladder.css'), 'utf8');

/** `--name: #hex` from :root (Ember is the only palette). */
function token(name: string): string {
  const m = tokens.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`token --${name} not found`);
  return m[1]!;
}
/** `--name: rgb(r g b / a)`. */
function rgba(name: string): { rgb: RGB; a: number } {
  const m = tokens.match(new RegExp(`--${name}:\\s*rgb\\((\\d+)\\s+(\\d+)\\s+(\\d+)\\s*/\\s*([\\d.]+)\\)`));
  if (!m) throw new Error(`token --${name} not found as rgb(… / a)`);
  return { rgb: [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255], a: Number(m[4]) };
}

const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** Source-over compositing of a translucent colour on an opaque one (sRGB, as browsers paint it). */
const over = (top: RGB, a: number, under: RGB): RGB => top.map((c, i) => c * a + under[i]! * (1 - a)) as RGB;
const lum = (c: RGB) => {
  const [r, g, b] = c.map(lin) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: RGB, b: RGB) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

describe('ladder row hover keeps text readable', () => {
  it('is the gold-soft wash, painted only on controls, with no text colour change', () => {
    expect(ladderCss).toMatch(/--lp-face-hover:\s*var\(--lm-gold-soft\)/);
    // the old wash (ink-faint over whole rows, compared across cards) is gone
    expect(ladderCss).not.toMatch(/\[data-hover\]/);
    const hoverRules = ladderCss.match(/:hover\s*\{[^}]*\}/g) ?? [];
    for (const r of hoverRules) expect(r).not.toMatch(/(^|[^-])color:/);
    expect(hoverRules.join('\n')).toMatch(/background: var\(--lp-face-hover\)/);
  });

  it('gives every text ink ≥ 4.5:1 on the hover surface of both cards', () => {
    const gold = rgba('lm-gold-soft');
    const surfaces = { rung: hex(token('lm-face')), ideal: hex(token('lm-chassis')) };
    for (const [name, surface] of Object.entries(surfaces)) {
      const hover = over(gold.rgb, gold.a, surface);
      for (const t of ['lm-ink', 'lm-ink-2', 'lm-ink-3']) {
        const c = contrast(hex(token(t)), hover);
        expect(c, `${t} on ${name} hover = ${c.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps the pressed shade readable too (the elevated surface, SPEC §1 “pressed rows”)', () => {
    expect(ladderCss).toMatch(/--lp-face-press:\s*var\(--lm-elevated\)/);
    const pressed = hex(token('lm-elevated'));
    for (const t of ['lm-ink', 'lm-ink-2', 'lm-ink-3']) expect(contrast(hex(token(t)), pressed)).toBeGreaterThanOrEqual(4.5);
  });
});
