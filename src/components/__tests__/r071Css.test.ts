/**
 * Guards for the r071 0B stylesheets (the cards, the new pictures, the layout and the library). viz.css has its own
 * contract test (src/components/viz/__tests__/contract.test.tsx) and keeps its old rules (flat, no uppercase); the new
 * files are the opposite house: uppercase only in MonoMeta, and nothing else that the old rules banned. None of them
 * draws a gradient: the one glow is the card material's (src/styles/components.css). Every file here follows the same
 * mechanical rules:
 *
 * - tokens only: no hex and no rgb()/hsl() (every value is a token of src/styles/tokens.css);
 * - weights 300 to 600, never 350; uppercase only in mono.css;
 * - flat: no text-shadow, filter or blur; a box-shadow only as a 0-blur ring; no gradient anywhere (the card's glow,
 *   RESEARCH §3.3, is the material's);
 * - motion on compositor-friendly properties only (AUDIT §4.2 rule 1): transform, opacity, clip-path, stroke-dashoffset,
 *   stroke and fill colours, colours, and the registered --lm-glow-k; never a layout property;
 * - each picture's file has a forced-colours block, and everything sits in `@layer components`.
 *
 * The domain wiring and the glow recipe are pinned where they live (src/styles/components.css, tokens.test.ts); the
 * last describe here checks the 0B stylesheets read them and do not re-declare them.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const CARD_FILES = ['card', 'hero', 'infopanel', 'mono', 'overflow', 'status', 'rail', 'cardgrid', 'library'].map((n) => `src/components/${n}.css`);
const VIZ_FILES = ['radial', 'track', 'bars', 'glow', 'scale', 'stack', 'window'].map((n) => `src/components/viz/${n}.css`);
const SHARED_FILES = ['src/components/viz/viz-base.css'];
const ALL = [...CARD_FILES, ...VIZ_FILES, ...SHARED_FILES];

/** Split a CSS value on its top-level commas (var() fallbacks nest). */
function topLevel(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const TRANSITIONABLE = new Set(['transform', 'opacity', 'clip-path', 'stroke-dashoffset', 'stroke', 'fill', 'stroke-opacity', 'fill-opacity', 'color', 'background-color', 'border-color', '--lm-glow-k', 'translate', 'scale', 'visibility']);

describe('r071 0B stylesheets', () => {
  it('the set is complete: every stylesheet the components import exists', () => {
    for (const f of ALL) expect(() => read(f), f).not.toThrow();
  });

  it('draws colours from tokens only: no hex, rgb() or hsl()', () => {
    for (const f of ALL) {
      const code = strip(read(f));
      expect(code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], `${f} hex`).toEqual([]);
      expect(code.match(/\b(?:rgba?|hsla?)\(/g) ?? [], `${f} rgb/hsl`).toEqual([]);
    }
  });

  it('reads the tokens as they are: no token of tokens.css is given a literal fallback that could hide a drift', () => {
    const real = /var\(--lm-(?:text-[a-z0-9-]+|info-[a-z]+|thumb|dot-[a-z]+|dur-[a-z0-9-]+|stagger-[a-z]+|radius-[a-z]+|card-[a-z]+|gutter|ease-[a-z]+|font-[a-z]+)\s*,/g;
    for (const f of ALL) expect(strip(read(f)).match(real) ?? [], f).toEqual([]);
  });

  it('keeps weights between 300 and 600 (never 350), uppercase only in MonoMeta', () => {
    for (const f of ALL) {
      const code = strip(read(f));
      for (const [, w] of code.matchAll(/font-weight:\s*(\d+)/g)) {
        expect(Number(w), `${f} font-weight ${w}`).toBeGreaterThanOrEqual(300);
        expect(Number(w), `${f} font-weight ${w}`).toBeLessThanOrEqual(600);
        expect(Number(w), `${f} font-weight ${w}`).not.toBe(350);
      }
      if (f.endsWith('/mono.css')) expect(code).toMatch(/text-transform:\s*uppercase/);
      else expect(code, `${f} uppercase`).not.toMatch(/text-transform:\s*uppercase/);
    }
  });

  it('is flat: no text-shadow, filter or blur, a box-shadow only as a ring, and no gradient (the one glow is the material\'s)', () => {
    for (const f of ALL) {
      const code = strip(read(f));
      expect(code, `${f} shadow/filter/blur`).not.toMatch(/text-shadow|filter:|blur\(|backdrop-filter/);
      for (const [, v = ''] of code.matchAll(/box-shadow:\s*([^;]+);/g)) expect(v.trim(), `${f} box-shadow ${v}`).toMatch(/^(none|0 0 0 [\d.]+px[^,]*)$/);
      expect(code, `${f} gradient`).not.toMatch(/(?:linear|radial|conic)-gradient\(|repeating-/);
    }
  });

  it('moves only on compositor-friendly properties, never a layout property', () => {
    for (const f of ALL) {
      const code = strip(read(f));
      const props: string[] = [];
      for (const [, t = ''] of code.matchAll(/transition:\s*([^;]+);/g)) {
        for (const part of topLevel(t)) {
          const name = part.trim().split(/\s+/)[0] ?? '';
          if (name && name !== 'none') props.push(name);
        }
      }
      for (const [, t = ''] of code.matchAll(/transition-property:\s*([^;]+);/g)) props.push(...t.split(',').map((x) => x.trim()));
      for (const p of props) expect(TRANSITIONABLE.has(p), `${f} transitions ${p}`).toBe(true);
    }
  });

  it('every picture and every card stylesheet sits in @layer components and has a forced-colours block', () => {
    for (const f of [...VIZ_FILES, ...SHARED_FILES, 'src/components/card.css', 'src/components/status.css', 'src/components/infopanel.css', 'src/components/rail.css', 'src/components/cardgrid.css', 'src/components/library.css']) {
      const code = strip(read(f));
      expect(code, `${f} layer`).toMatch(/@layer components\s*\{/);
      expect(code, `${f} forced colours`).toMatch(/@media \(forced-colors: active\)/);
    }
  });
});

/** The eight domains of the wheel (RESEARCH §3.2). The values are the tokens', pinned in src/styles/__tests__/tokens.test.ts. */
const WHEEL = ['heart', 'energy', 'food', 'steps', 'recovery', 'body', 'sleep', 'videos'];

describe('r071 card recipe: one source (src/styles/components.css)', () => {
  const material = strip(read('src/styles/components.css'));
  /** The declarations of the rule whose selector list names `selector`. */
  const ruleOf = (selector: string): string => material.match(new RegExp(`${selector.replace(/[[\]()'.]/g, '\\$&')}[^{]*\\{([^}]*)\\}`))?.[1] ?? '';

  it('wires every domain, plan and neutral to the role variables, for a card (data-domain) and a picture (data-hue)', () => {
    for (const d of [...WHEEL, 'plan']) {
      for (const attr of ['data-domain', 'data-hue']) {
        const rule = ruleOf(`[${attr}='${d}']`);
        for (const v of ['--lm-hue', '--lm-ink-h', '--lm-deep', '--lm-dim', '--lm-tone-2']) expect(rule, `${attr}=${d} ${v}`).toContain(`${v}:`);
      }
    }
    expect(material).toMatch(/:where\(\[data-domain\], \[data-hue\]\) \{[^}]*--lm-hue: var\(--lm-ink-2\);/);
  });

  it('is declared once: card.css and the component sources carry no role variables, glow inputs or gradient of their own', () => {
    const css = strip(read('src/components/card.css'));
    expect(css).not.toMatch(/gradient|--lm-glow-(?:size|a):|\[data-domain=|--lm-hue:|--lm-deep:|--lm-dim:|--lm-ink-h:|--lm-tone-2:/);
    expect(read('src/components/domain.ts')).not.toMatch(/\.css'/);
    expect(() => read('src/components/domain.css')).toThrow();
    // GradientCard IS the material (the glow is the material's), plus the layout class
    const card = read('src/components/GradientCard.tsx');
    expect(card).toMatch(/cx\('lm-material', 'lm-gcard'/);
    expect(card).toMatch(/data-glow=\{typeof glow === 'string' \? glow : glow \? 'custom' : undefined\}/);
    expect(card).toMatch(/data-reveal=\{pending \? 'pending' : undefined\}/);
  });

  it('lists the stylesheet folder: no new css file escapes the guard above', () => {
    const known = new Set(ALL.map((f) => f.split('/').pop()));
    const found = [...readdirSync(resolve(root, 'src/components')), ...readdirSync(resolve(root, 'src/components/viz'))].filter((n) => n.endsWith('.css'));
    // viz.css and living-charts copies belong to the old contract test; brand.css is another owner's
    const others = new Set(['viz.css', 'brand.css']);
    for (const n of found) expect(known.has(n) || others.has(n), `${n} is not covered by r071Css.test.ts`).toBe(true);
  });
});
