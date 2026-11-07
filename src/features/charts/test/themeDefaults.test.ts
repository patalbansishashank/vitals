/**
 * The chart theme's fallback table against the stylesheets (r071). `readChartTheme` falls back to THEME_DEFAULTS when a
 * token is not computed (jsdom, early boot), so a table that drifts from the tokens would draw canvas charts in last
 * release's colours exactly where nobody looks: in tests. jsdom computes no styles, so the token files are read as text.
 *
 *   - every entry equals the token it names, with `var(--alias)` chains followed (a category slot that aliases a domain
 *     hue is compared as that hue's hex);
 *   - every token the theme reads has an entry;
 *   - the eight domain hues carry all four roles (solid, ink, deep, dim), so the canvas can draw any card's hue.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEME_DEFAULTS } from '../core/theme';

const root = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const files = [strip(read('src/styles/tokens.css')), strip(read('src/features/charts/charts.css'))];
const themeSource = read('src/features/charts/core/theme.ts');

/** The first declaration of `--name` in the token files (a later @media or forced-colors override never wins). */
function declared(name: string): string | undefined {
  for (const css of files) {
    const m = css.match(new RegExp(`(?:^|[\\s{;])${name}\\s*:\\s*([^;}]+);`));
    if (m) return m[1]!.trim();
  }
  return undefined;
}

/** What a token is worth: aliases followed, whitespace collapsed, hex upper-cased. */
function resolved(name: string, depth = 0): string | undefined {
  const v = declared(name);
  if (v === undefined || depth > 6) return v;
  const alias = v.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/);
  if (alias) return resolved(alias[1]!, depth + 1) ?? alias[2]?.trim();
  return v;
}

const norm = (v: string): string => {
  const t = v.replace(/\s+/g, ' ').trim();
  return /^#[0-9a-f]{3,8}$/i.test(t) ? t.toUpperCase() : t;
};

describe('chart theme DEFAULTS follow the tokens', () => {
  it.each(Object.entries(THEME_DEFAULTS))('%s', (name, value) => {
    const token = resolved(name);
    expect(token, `${name} is not declared in tokens.css or charts.css`).toBeDefined();
    if (/^[\d.]+$/.test(value) && /^[\d.]+$/.test(token!)) expect(parseFloat(value)).toBeCloseTo(parseFloat(token!), 6);
    else expect(norm(value)).toBe(norm(token!));
  });

  it('has an entry for every token the theme reads', () => {
    const read = new Set([...themeSource.matchAll(/\b(?:v|num)\('(--[\w-]+)'\)/g)].map((m) => m[1]!));
    expect(read.size).toBeGreaterThan(40);
    const missing = [...read].filter((n) => !(n in THEME_DEFAULTS));
    expect(missing).toEqual([]);
  });

  it('carries solid, ink, deep and dim for each of the eight domain hues', () => {
    for (const d of ['heart', 'energy', 'food', 'steps', 'recovery', 'body', 'sleep', 'videos']) {
      for (const role of ['', '-ink', '-deep', '-dim']) expect(THEME_DEFAULTS[`--lm-hue-${d}${role}`], `--lm-hue-${d}${role}`).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it('keeps the five category slots that coincide with a domain on that domain\'s solid', () => {
    expect(THEME_DEFAULTS['--lm-cat-body']).toBe(THEME_DEFAULTS['--lm-hue-body']);
    expect(THEME_DEFAULTS['--lm-cat-energy']).toBe(THEME_DEFAULTS['--lm-hue-energy']);
    expect(THEME_DEFAULTS['--lm-cat-performance']).toBe(THEME_DEFAULTS['--lm-hue-steps']);
    expect(THEME_DEFAULTS['--lm-cat-recovery']).toBe(THEME_DEFAULTS['--lm-hue-recovery']);
    expect(THEME_DEFAULTS['--lm-cat-cardio']).toBe(THEME_DEFAULTS['--lm-hue-heart']);
  });
});
