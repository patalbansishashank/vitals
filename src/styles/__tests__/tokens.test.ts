/**
 * Ember foundation (.e6-tmp/unslop/SPEC.md §1–3), r071 revision (r071/RESEARCH.md §2–§5, r071/AUDIT.md §5.5). jsdom computes
 * no styles, so the stylesheets are read as text: one dark palette with the SPEC values under the v1 --lm-* names, the
 * design/ masters copied byte for byte, eight domain hues on one wheel and the sets derived from them (each held to the
 * dataviz gates), the Geist + Geist Mono pairing self-hosted with its weight floors and fallbacks, the grain backdrop,
 * the card material with its one opt-in glow, the motion tokens, and every theme switch gone from the boot path.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { blend, contrast, deltaE, deltaECvd, oklch } from './colorMath';

const root = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const tokens = read('src/styles/tokens.css');
const fonts = read('src/styles/fonts.css');
const base = read('src/styles/base.css');
const theme = read('src/styles/tailwind-theme.css');
const components = read('src/styles/components.css');
const code = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Value of `--name` in the :root block. */
function token(name: string): string {
  const m = tokens.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`--${name} not declared`);
  return m[1]!.trim();
}

/** The hex a token resolves to, following `var(--other)` aliases (the five coinciding category slots alias a domain). */
function hexOf(name: string): string {
  let v = token(name);
  for (let i = 0; i < 4; i++) {
    const alias = v.match(/^var\(--([\w-]+)\)$/);
    if (!alias) break;
    v = token(alias[1]!);
  }
  if (!/^#[0-9A-Fa-f]{6}$/.test(v)) throw new Error(`--${name} does not resolve to a hex (${v})`);
  return v.toUpperCase();
}

const FACE = token('lm-face');
const IVORY = token('lm-ink');
const DOMAINS = ['heart', 'energy', 'food', 'steps', 'recovery', 'body', 'sleep', 'videos'] as const; // the wheel, in order
const solid = (d: string) => hexOf(`lm-hue-${d}`);
const ink = (d: string) => hexOf(`lm-hue-${d}-ink`);
const deep = (d: string) => hexOf(`lm-hue-${d}-deep`);
const dim = (d: string) => hexOf(`lm-hue-${d}-dim`);

describe('Ember tokens', () => {
  it('design/ is the master and src/styles holds byte-identical copies', () => {
    expect(tokens).toBe(read('design/tokens.css'));
    expect(theme).toBe(read('design/tailwind-theme.css'));
  });

  it('declares one dark palette: no light block, no prefers-color-scheme or [data-theme] branch, no theme scopes', () => {
    expect(tokens).toMatch(/:root \{\s*color-scheme: dark;/);
    expect(code(tokens)).not.toMatch(/color-scheme: light|prefers-color-scheme|data-theme/);
    expect(code(theme)).not.toMatch(/prefers-color-scheme|data-theme/);
    expect(code(base)).not.toMatch(/prefers-color-scheme|data-theme|lm-theme-fading/);
    // every colour token is declared exactly once
    for (const name of ['lm-chassis', 'lm-face', 'lm-ink', 'lm-signal', 'lm-cat-body', 'lm-macro-fat', 'lm-plan-a', 'lm-hue-heart', 'lm-hue-videos-deep', 'lm-stage-deep', 'lm-balance-deficit-1']) {
      expect(tokens.match(new RegExp(`--${name}:`, 'g')), name).toHaveLength(1);
    }
  });

  it.each([
    ['lm-chassis', '#090909'],
    ['lm-chassis-2', '#11100F'],
    ['lm-face', '#1B1916'],
    ['lm-well', '#11100F'],
    ['lm-raised', '#22201C'],
    ['lm-elevated', '#2B2721'],
    ['lm-line', 'rgb(198 171 124 / 0.20)'],
    ['lm-line-strong', 'rgb(198 171 124 / 0.40)'],
    ['lm-edge', 'rgb(198 171 124 / 0.20)'],
    ['lm-ink', '#F5F1E9'],
    ['lm-ink-2', '#C3BCB0'],
    ['lm-ink-3', '#AAA296'],
    ['lm-ink-faint', 'rgb(170 162 150 / 0.40)'],
    ['lm-signal', '#E3BF78'],
    ['lm-signal-ink', '#090909'],
    ['lm-gold-soft', 'rgb(227 191 120 / 0.18)'],
    ['lm-gold-wash', 'rgb(227 191 120 / 0.15)'],
    ['lm-info-fg', '#C7C3BC'],
    ['lm-ok-fg', '#C9C5AF'],
    ['lm-caution-fg', '#E3BF78'],
    ['lm-danger-fg', '#E5A39B'],
    ['lm-focus', '#E3BF78'],
    ['lm-caret', '#E3BF78'],
    ['lm-text-selection', 'rgb(227 191 120 / 0.35)'],
  ])('--%s is %s', (name, value) => {
    expect(token(name)).toBe(value);
  });

  it('has no shadows; the radii: 4 / 8 / 10 / 12 and 24 for sheets and dialogs, a 20 px card, a 12 px track, 14 px fields', () => {
    for (const s of ['face', 'key', 'key-pressed', 'well', 'thumb', 'pop', 'sheet', 'drawer']) expect(token(`lm-shadow-${s}`), s).toBe('none');
    expect([token('lm-radius-xs'), token('lm-radius-sm'), token('lm-radius-md'), token('lm-radius-lg'), token('lm-radius-xl'), token('lm-radius-full')]).toEqual([
      '4px',
      '8px',
      '10px',
      '12px',
      '24px',
      '999px',
    ]);
    expect([token('lm-card-radius'), token('lm-radius-track'), token('lm-radius-field')]).toEqual(['20px', '12px', '14px']);
    // 24 / 18: cards keep their padding concentric with the corner (20 radius, 18 padding)
    expect([token('lm-card-pad'), token('lm-card-pad-lg'), token('lm-card-gap'), token('lm-card-inner-gap')]).toEqual(['18px', '24px', '12px', '12px']);
    expect(tokens).toMatch(/@media \(min-width: 1024px\) \{\s*:root \{\s*--lm-card-pad: 24px;\s*--lm-card-gap: 16px;\s*--lm-card-inner-gap: 16px;/);
  });

  it('no custom property is declared twice in the main :root block (a second declaration silently wins: the (i) key once overrode the info severity)', () => {
    const body = tokens.slice(tokens.indexOf(':root {'), tokens.indexOf('\n}\n', tokens.indexOf(':root {')));
    const names = [...code(body).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]);
    const seen = new Set<string>();
    const twice = names.filter((n) => (seen.has(n!) ? true : (seen.add(n!), false)));
    expect(twice).toEqual([]);
  });

  it('the (i) key stays quiet at rest with a 48 px hit area, and the info severity keeps its own tokens', () => {
    expect([token('lm-info-size'), token('lm-info-hit')]).toEqual(['24px', '48px']);
    expect(token('lm-info-key-bg')).toBe('transparent');
    expect(token('lm-info-key-bg-hover')).toBe('rgb(245 241 233 / 0.07)');
    expect(token('lm-info-key-edge')).toBe('transparent');
    expect([token('lm-info-fg'), token('lm-info-bg'), token('lm-info-edge')]).toEqual(['#C7C3BC', '#24221E', '#46443F']);
    const css = read('src/components/card.css');
    expect(css).toMatch(/\.lm-info \{[^}]*border: var\(--lm-hairline\) solid var\(--lm-info-key-edge\);[^}]*background: var\(--lm-info-key-bg\);/);
    expect(css).toContain('background: var(--lm-info-key-bg-hover);');
  });

  it('card-gap is between cards and card-inner-gap is inside one: the card material never reads card-gap, only a grid or a stack of cards does', () => {
    // the Faceplate head, foot and Section (inside a card) read the inner gap
    expect(components).not.toMatch(/var\(--lm-card-gap\)/);
    expect(components).toMatch(/\.lm-face-head \{[^}]*gap: var\(--lm-row-gap\) var\(--lm-card-inner-gap\);/);
    // the shell reads card-gap once: `<Stack gap="card">`, a stack of cards
    const shell = read('src/styles/shell.css');
    expect([...shell.matchAll(/var\(--lm-card-gap\)/g)]).toHaveLength(1);
    expect(shell).toMatch(/\.lm-stack\[data-gap='card'\] \{\s*gap: var\(--lm-card-gap\);/);
    // and the card grid, in the components
    expect(read('src/components/cardgrid.css')).toMatch(/gap: var\(--lm-card-gap\);/);
    for (const f of ['card', 'hero', 'infopanel', 'rail', 'library', 'mono', 'status']) expect(read(`src/components/${f}.css`), f).not.toMatch(/--lm-card-gap/);
  });

  it('keeps the neutrals warm: surfaces and ink are gold-tan (OKLCH hue 60–100) with chroma under 0.02', () => {
    for (const n of ['lm-chassis', 'lm-chassis-2', 'lm-face', 'lm-well', 'lm-raised', 'lm-elevated', 'lm-ink', 'lm-ink-2', 'lm-ink-3']) {
      const { C, H } = oklch(hexOf(n));
      expect(C, `--${n} chroma`).toBeLessThan(0.02);
      if (C > 0.004) expect(H >= 60 && H <= 100, `--${n} hue ${H.toFixed(0)}`).toBe(true);
    }
  });

  it('gold marks the action, the selection and the moment: no data token wears it (the plan trio\'s A is the plan)', () => {
    const signal = token('lm-signal').toUpperCase();
    const data = [...tokens.matchAll(/--(lm-(?:cat|macro|hr-zone|intensity|stage|hue|steps|balance)-[\w-]+):\s*(#[0-9A-Fa-f]{6});/g)];
    expect(data.length).toBeGreaterThan(60);
    for (const [, name, value] of data) expect(value!.toUpperCase(), `--${name}`).not.toBe(signal);
    expect(token('lm-hue-gold-deep')).toBe('#8D6D1F');
  });
});

describe('the eight domain hues (r071)', () => {
  it('each domain has a solid, an ink tint, a deep glow core and a dim remainder, in hex, all distinct', () => {
    const all = DOMAINS.flatMap((d) => [solid(d), ink(d), deep(d), dim(d)]);
    expect(all).toHaveLength(32);
    expect(new Set(all).size).toBe(32);
    for (const d of DOMAINS) for (const part of ['', '-ink', '-deep', '-dim']) expect(token(`lm-hue-${d}${part}`), `${d}${part}`).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('every solid reads as a mark on the card (3:1 or more, 5.1 in practice), chroma 0.10 or more, and the ink tint is text (12:1)', () => {
    for (const d of DOMAINS) {
      expect(contrast(solid(d), FACE), `${d} solid on the card`).toBeGreaterThanOrEqual(5.1);
      expect(oklch(solid(d)).C, `${d} chroma`).toBeGreaterThanOrEqual(0.1);
      expect(contrast(ink(d), FACE), `${d} ink on the card`).toBeGreaterThanOrEqual(12);
      expect(oklch(dim(d)).L, `${d} dim is darker than its solid`).toBeLessThan(oklch(solid(d)).L - 0.25);
    }
  });

  it('wheel neighbours (heart, energy, food, steps, recovery, body, sleep, videos, and back to heart) separate: ΔE 15 and 8 under colour-vision simulation', () => {
    for (let i = 0; i < DOMAINS.length; i++) {
      const a = solid(DOMAINS[i]!);
      const b = solid(DOMAINS[(i + 1) % DOMAINS.length]!);
      expect(deltaE(a, b), `${DOMAINS[i]} / next`).toBeGreaterThanOrEqual(15);
      expect(deltaECvd(a, b), `${DOMAINS[i]} / next (CVD)`).toBeGreaterThanOrEqual(8);
    }
    // lightness alternates around the wheel (the Ember rule): neighbours part by lightness as well as hue
    const ls = DOMAINS.map((d) => oklch(solid(d)).L);
    expect(ls.map((l) => (l > 0.73 ? 'light' : 'dark')).join(' ')).toBe('light dark light dark light dark light dark');
  });

  it('the eight are never a set: all pairs fail by design (sleep and recovery under deutan), so the sets below exist', () => {
    const worst = Math.min(...DOMAINS.flatMap((a, i) => DOMAINS.slice(i + 1).map((b) => deltaECvd(solid(a), solid(b)))));
    expect(worst).toBeLessThan(8);
  });

  it('the glow cores keep ivory text and marks safe everywhere: 5.1:1 against the brightest point of every glow', () => {
    const alpha = (d: string) => Number(token(`lm-glow-${d}-a`));
    for (const [d, core] of [...DOMAINS.map((x) => [x, deep(x)] as const), ['gold', hexOf('lm-hue-gold-deep')] as const]) {
      const peak = blend(core, alpha(d), FACE);
      expect(contrast(IVORY, peak), `${d} glow peak ${peak}`).toBeGreaterThanOrEqual(5.1);
    }
  });

  it('the glow tokens are the RESEARCH §3.3 table: where the core sits, how big it is, how strong', () => {
    const rows: Array<[string, string, string, string]> = [
      ['energy', '50% 112%', '80% 62%', '0.78'],
      ['heart', '100% 100%', '115% 100%', '0.60'],
      ['steps', '0% 0%', '105% 80%', '0.55'],
      ['sleep', '100% 0%', '78% 105%', '0.62'],
      ['body', '50% 120%', '105% 70%', '0.60'],
      ['recovery', '100% 0%', '95% 85%', '0.58'],
      ['food', '100% 0%', '82% 105%', '0.58'],
      ['videos', '100% 100%', '100% 100%', '0.60'],
      ['gold', '0% 50%', '60% 150%', '0.34'],
    ];
    for (const [d, pos, size, a] of rows) {
      expect(token(`lm-glow-${d}-pos`), `${d} pos`).toBe(pos);
      expect(token(`lm-glow-${d}-size`), `${d} size`).toBe(size);
      expect(token(`lm-glow-${d}-a`), `${d} alpha`).toBe(a);
    }
    expect(token('lm-glow-k')).toBe('1');
    expect(token('lm-unlit')).toBe('rgb(245 241 233 / 0.17)');
  });
});

describe('the sets that appear together, derived from the hues (r071 Q12 and RESEARCH §3.5)', () => {
  it('the five category slots that coincide with a domain alias its solid; fuel, cellular and hormones stay warm', () => {
    expect([token('lm-cat-body'), token('lm-cat-energy'), token('lm-cat-recovery'), token('lm-cat-cardio'), token('lm-cat-performance')]).toEqual([
      'var(--lm-hue-body)',
      'var(--lm-hue-energy)',
      'var(--lm-hue-recovery)',
      'var(--lm-hue-heart)',
      'var(--lm-hue-steps)',
    ]);
    for (const c of ['fuel', 'cellular', 'hormones']) {
      const { H, C } = oklch(hexOf(`lm-cat-${c}`));
      expect(H >= 20 && H <= 135, `${c} hue ${H.toFixed(0)}`).toBe(true);
      expect(C).toBeLessThan(0.1);
    }
    // the series and the steps role follow
    expect(token('lm-series-1')).toBe('var(--lm-cat-body)');
    expect(token('lm-steps')).toBe('var(--lm-hue-steps)');
  });

  it('the eight category slots: 3.5:1 on the card, distinct, neighbours in slot order ΔE 15 (7.5 under colour vision: fuel beside energy is 7.6)', () => {
    const cats = ['body', 'fuel', 'energy', 'cellular', 'performance', 'recovery', 'cardio', 'hormones'].map((c) => hexOf(`lm-cat-${c}`));
    expect(new Set(cats).size).toBe(8);
    for (const c of cats) expect(contrast(c, FACE), `${c} on the card`).toBeGreaterThanOrEqual(3.5);
    for (let i = 1; i < cats.length; i++) {
      expect(deltaE(cats[i - 1]!, cats[i]!), `${cats[i - 1]} / ${cats[i]}`).toBeGreaterThanOrEqual(15);
      expect(deltaECvd(cats[i - 1]!, cats[i]!), `${cats[i - 1]} / ${cats[i]} (CVD)`).toBeGreaterThanOrEqual(7.5);
    }
  });

  it('macros (protein, carbs, fibre, fat, alcohol): neighbours in stack order ΔE 18 and 12 under colour vision, 3.8:1 on the card, protein clear of carbs, fat and gold', () => {
    const m = ['protein', 'carbs', 'fibre', 'fat', 'alcohol'].map((x) => hexOf(`lm-macro-${x}`));
    expect(m).toEqual(['#6CB35D', '#EACE8C', '#677D51', '#F3A07D', '#A57DA1']);
    for (const c of m) expect(contrast(c, FACE), c).toBeGreaterThanOrEqual(3.8);
    for (let i = 1; i < m.length; i++) {
      expect(deltaE(m[i - 1]!, m[i]!), `${m[i - 1]} / ${m[i]}`).toBeGreaterThanOrEqual(17.9);
      expect(deltaECvd(m[i - 1]!, m[i]!), `${m[i - 1]} / ${m[i]} (CVD)`).toBeGreaterThanOrEqual(12);
    }
    for (const other of [hexOf('lm-macro-carbs'), hexOf('lm-macro-fat'), hexOf('lm-signal')]) expect(deltaE(m[0]!, other)).toBeGreaterThanOrEqual(15);
    expect(token('lm-macro-gap')).toBe('var(--lm-face)');
  });

  it('sleep stages (deep, light, REM, awake): ΔE 15 between neighbours, 10 under colour vision, 3.3:1 on the card, lightness climbs with arousal', () => {
    const s = ['deep', 'light', 'rem', 'awake'].map((x) => hexOf(`lm-stage-${x}`));
    expect(s).toEqual(['#6060C3', '#8895E2', '#ECADF6', '#F4E3BF']);
    for (const c of s) expect(contrast(c, FACE), c).toBeGreaterThanOrEqual(3.3);
    for (let i = 1; i < s.length; i++) {
      expect(deltaE(s[i - 1]!, s[i]!), `${s[i - 1]} / ${s[i]}`).toBeGreaterThanOrEqual(15);
      expect(deltaECvd(s[i - 1]!, s[i]!), `${s[i - 1]} / ${s[i]} (CVD)`).toBeGreaterThanOrEqual(10);
      expect(oklch(s[i]!).L).toBeGreaterThan(oklch(s[i - 1]!).L);
    }
    // a night the ring could not stage: the OKLab midpoint of deep and light, shown alone
    const u = hexOf('lm-stage-unspecified');
    expect(Math.abs(deltaE(u, s[0]!) - deltaE(u, s[1]!))).toBeLessThan(0.5);
    expect(token('lm-intensity-sleep')).toBe('var(--lm-hue-sleep)');
  });

  it.each([
    ['energy intensity (resting, light, active, exercise)', ['resting', 'light', 'active', 'exercise'].map((x) => `lm-intensity-${x}`), 3.3, 0.06],
    ['ketosis (forming, nutritional, deep)', [1, 2, 3].map((n) => `lm-keto-${n}`), 3.3, 0.06],
    ['heart-rate zones 1 to 5', [1, 2, 3, 4, 5].map((n) => `lm-hr-zone-${n}`), 3.0, 0.06],
  ])('%s is an ordinal ramp: monotone lightness, every gap 0.06 or more, the dim end legible on the card, neighbours named by their value', (_name, names, floor, gap) => {
    const r = (names as string[]).map(hexOf);
    for (const c of r) expect(contrast(c, FACE), c).toBeGreaterThanOrEqual(floor as number);
    for (let i = 1; i < r.length; i++) expect(oklch(r[i]!).L - oklch(r[i - 1]!).L, `${r[i - 1]} → ${r[i]}`).toBeGreaterThanOrEqual(gap as number);
  });

  it('the energy intensities are the ember ramp (hue within 35° of energy: it warms to sand as it lightens) and the zones the ruby one (within 12° of heart)', () => {
    const hueGap = (a: string, b: string) => Math.abs(((oklch(a).H - oklch(b).H + 540) % 360) - 180);
    for (const n of ['resting', 'light', 'active', 'exercise']) expect(hueGap(hexOf(`lm-intensity-${n}`), solid('energy'))).toBeLessThan(35);
    for (const n of [1, 2, 3]) expect(hueGap(hexOf(`lm-keto-${n}`), solid('energy'))).toBeLessThan(35);
    for (const n of [1, 2, 3, 4, 5]) expect(hueGap(hexOf(`lm-hr-zone-${n}`), solid('heart'))).toBeLessThan(12);
  });

  it('the energy balance (r071): tide for a deficit, ember for a surplus, rising above the card in 10 % bands, matching steps one lightness', () => {
    const d = [1, 2, 3, 4, 5, 6].map((n) => hexOf(`lm-balance-deficit-${n}`));
    const s = [1, 2, 3, 4].map((n) => hexOf(`lm-balance-surplus-${n}`));
    const neutral = hexOf('lm-raised');
    expect(token('lm-balance-neutral')).toBe('var(--lm-raised)');
    expect(token('lm-balance-fast')).toBe('#F5F1E9');
    const faceL = oklch(FACE).L;
    for (const [arm, steps, hue] of [
      ['deficit', d, 254],
      ['surplus', s, 48],
    ] as const) {
      steps.forEach((c, i) => {
        const o = oklch(c);
        expect(Math.abs(o.H - hue), `${arm}-${i + 1} hue ${o.H.toFixed(0)}`).toBeLessThan(8);
        expect(o.L, `${arm}-${i + 1} rises above the card`).toBeGreaterThan(faceL + 0.05);
        expect(contrast(IVORY, c), `${arm}-${i + 1} ink`).toBeGreaterThanOrEqual(7.5);
        expect(contrast(token('lm-ink-2'), c), `${arm}-${i + 1} ink-2`).toBeGreaterThanOrEqual(4.5);
        // each step reads as a step: about 3 ΔE from the one before (the first from maintenance)
        expect(deltaE(i === 0 ? neutral : steps[i - 1]!, c), `${arm}-${i + 1} step`).toBeGreaterThanOrEqual(2.8);
        if (i > 0) expect(o.L).toBeGreaterThan(oklch(steps[i - 1]!).L);
      });
    }
    for (let i = 0; i < s.length; i++) expect(Math.abs(oklch(d[i]!).L - oklch(s[i]!).L), `step ${i + 1}`).toBeLessThan(0.002);
    // the arms part by hue, and still do under protan and deutan from step 2 on
    for (let i = 1; i < s.length; i++) expect(deltaECvd(d[i]!, s[i]!), `step ${i + 1} CVD`).toBeGreaterThanOrEqual(8);
  });

  it('the legacy warm balance stays for the Simulator and the charts until the planning tools move: matching steps share one lightness', () => {
    const lum = (h: string) => oklch(h).L;
    for (let i = 1; i <= 4; i++) {
      const dd = hexOf(`lm-energy-deficit-${i}`);
      const ss = hexOf(`lm-energy-surplus-${i}`);
      expect(dd).not.toBe(ss);
      expect(Math.abs(lum(dd) - lum(ss)), `step ${i}`).toBeLessThan(0.03);
      if (i > 1) expect(lum(dd)).toBeGreaterThan(lum(hexOf(`lm-energy-deficit-${i - 1}`)));
    }
  });

  it('keeps the bar control height contract', () => {
    expect(tokens).toMatch(/--lm-bar-control-h:\s*36px/);
    expect(tokens).toMatch(/@media \(pointer: coarse\)\s*\{\s*:root\s*\{\s*--lm-bar-control-h:\s*44px/);
  });
});

describe('type pairing (r071: Geist for text and numerals, Geist Mono for facts)', () => {
  const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
  const faces = (family: string) => fonts.match(new RegExp(`@font-face\\s*\\{[^}]*font-family: '${family}';[^}]*\\}`, 'g')) ?? [];

  it('self-hosts Geist and Geist Mono (latin + latin-ext, exact versions); Inter, Figtree, Manrope and Archivo are gone', () => {
    for (const css of [fonts, tokens, base]) {
      expect(css).not.toMatch(/archivo/i);
      expect(code(css)).not.toMatch(/manrope|figtree|\binter\b/i);
    }
    for (const gone of ['inter', 'figtree', 'manrope', 'archivo']) expect(pkg.dependencies[`@fontsource-variable/${gone}`], gone).toBeUndefined();
    for (const [name, files] of [
      ['geist', ['geist-latin-wght-normal.woff2', 'geist-latin-ext-wght-normal.woff2']],
      ['geist-mono', ['geist-mono-latin-wght-normal.woff2', 'geist-mono-latin-ext-wght-normal.woff2']],
    ] as const) {
      // the exact versions r071 measured (a caret would let the metrics below drift)
      expect(pkg.dependencies[`@fontsource-variable/${name}`], name).toBe('5.3.0');
      for (const f of files) {
        expect(fonts).toContain(`@fontsource-variable/${name}/files/${f}`);
        expect(existsSync(resolve(root, `node_modules/@fontsource-variable/${name}/files`, f)), f).toBe(true);
      }
    }
    // only latin + latin-ext: no other subset is ever declared
    expect(fonts).not.toMatch(/cyrillic|greek|vietnamese/);
    expect(token('lm-font-sans')).toMatch(/^"Geist", "Geist Fallback",/);
    expect(token('lm-font-title')).toMatch(/^"Geist", "Geist Title Fallback",/);
    expect(token('lm-font-display')).toBe('var(--lm-font-title)');
    expect(token('lm-font-mono')).toMatch(/^"Geist Mono", "Geist Mono Fallback",/);
  });

  it('floors the weights: Geist 300–600 (light only for big numerals, nothing heavier than 600), Geist Mono 400–600, no width axis', () => {
    expect(faces('Geist')).toHaveLength(2);
    for (const f of faces('Geist')) expect(f).toMatch(/font-weight: 300 600;/);
    expect(faces('Geist Mono')).toHaveLength(2);
    for (const f of faces('Geist Mono')) expect(f).toMatch(/font-weight: 400 600;/);
    expect(code(fonts)).not.toMatch(/font-stretch/);
  });

  it('has metric-matched fallback faces (Arial for text and titles, Courier / Liberation Mono for mono), re-measured against the installed files', () => {
    const expected: Array<[string, string, string, string, RegExp]> = [
      ['Geist Fallback', '107.5%', '93.5%', '27.4%', /local\('Arial'\)/],
      ['Geist Title Fallback', '113.4%', '88.6%', '26%', /local\('Arial'\)/],
      ['Geist Mono Fallback', '100%', '100.5%', '29.5%', /local\('Courier New'\), local\('Liberation Mono'\)/],
    ];
    for (const [fam, size, asc, desc, local] of expected) {
      const fb = fonts.match(new RegExp(`@font-face\\s*\\{[^}]*font-family: '${fam}';[^}]*\\}`))?.[0] ?? '';
      expect(fb, fam).toMatch(local);
      expect(fb).toContain(`size-adjust: ${size};`);
      expect(fb).toContain(`ascent-override: ${asc};`);
      expect(fb).toContain(`descent-override: ${desc};`);
      expect(fb).toContain('line-gap-override: 0%;');
    }
  });

  it('sets tabular numerals and no font synthesis globally, headings in the display face; width tokens are neutral', () => {
    const html = base.match(/\n {2}html \{([^}]*)\}/)?.[1] ?? '';
    expect(html).toMatch(/font-feature-settings: 'tnum' 1;/);
    expect(html).toMatch(/font-synthesis: none;/);
    expect(base).toMatch(/h4 \{\s*font-family: var\(--lm-font-display\);/);
    for (const w of ['condensed', 'normal', 'wide', 'display']) {
      expect(token(`lm-wdth-${w}`)).toBe('100');
      expect(theme).toMatch(new RegExp(`@utility wdth-${w}\\s*\\{ font-stretch: normal; \\}`));
    }
    expect(theme).not.toMatch(/font-stretch: \d/);
    expect(token('lm-num-pnum')).toBe('"tnum" 0, "pnum" 1');
    expect(token('lm-num-tnum')).toBe('"tnum" 1');
    expect(components).toMatch(/\.lm-num-prop \{[^}]*font-variant-numeric: proportional-nums;[^}]*font-feature-settings: var\(--lm-num-pnum\);/);
  });

  it('the type roles are the RESEARCH §2.4 scale: size / line / tracking / weight / family, stepped at 1024', () => {
    const role = (r: string) => [token(`lm-text-${r}`), token(`lm-text-${r}--lh`), token(`lm-text-${r}--ls`), token(`lm-text-${r}--wt`), token(`lm-text-${r}--font`)];
    expect(role('page')).toEqual(['1.5rem', '1.75rem', '-0.02em', '600', 'var(--lm-font-title)']); // 24/28, SPEC Q2
    expect(role('card')).toEqual(['0.9375rem', '1.25rem', '-0.005em', '600', 'var(--lm-font-sans)']);
    expect(role('hero')).toEqual(['4rem', '1', '-0.035em', '300', 'var(--lm-font-display)']);
    expect(role('num-l')).toEqual(['3.25rem', '1', '-0.035em', '300', 'var(--lm-font-display)']);
    expect(role('num')).toEqual(['2.75rem', '1', '-0.035em', '300', 'var(--lm-font-display)']);
    expect(role('time')).toEqual(['2.25rem', '1', '-0.035em', '300', 'var(--lm-font-display)']);
    expect(role('stat')).toEqual(['0.9375rem', '1.25rem', '-0.005em', '500', 'var(--lm-font-sans)']);
    expect(role('unit')).toEqual(['0.9375rem', '1', '0', '400', 'var(--lm-font-sans)']);
    expect(role('body')).toEqual(['0.875rem', '1.3125rem', '0', '400', 'var(--lm-font-sans)']);
    expect(role('read')).toEqual(['0.9375rem', '1.4375rem', '0', '400', 'var(--lm-font-sans)']);
    expect(role('meta')).toEqual(['0.6875rem', '0.875rem', '0.08em', '500', 'var(--lm-font-mono)']);
    const desk = tokens.match(/@media \(min-width: 1024px\) \{\s*:root \{([^}]*)\}/)?.[1] ?? '';
    for (const [k, v] of [
      ['--lm-text-card', '1rem'],
      ['--lm-text-card--lh', '1.375rem'],
      ['--lm-text-hero', '5.5rem'],
      ['--lm-text-num-l', '4rem'],
      ['--lm-text-num', '3.25rem'],
      ['--lm-text-read', '1rem'],
      ['--lm-text-read--lh', '1.5rem'],
      ['--lm-text-meta', '0.75rem'],
      ['--lm-text-meta--lh', '1rem'],
    ] as const) expect(desk, k).toContain(`${k}: ${v};`);
    // the one uppercase sans role is gone: mono caps is the only uppercase in the product
    expect(tokens).not.toMatch(/--lm-text-section/);
    expect(theme).not.toMatch(/--text-section/);
  });

  it('titles are 600 in the display face; only the numeral roles are light (300), only at 36 px and up; nothing reaches 700', () => {
    for (const r of ['display', 'headline', 'title-l', 'title-m']) {
      expect(token(`lm-text-${r}--wt`)).toBe('600');
      expect(token(`lm-text-${r}--font`)).toBe('var(--lm-font-display)');
    }
    const light = [...tokens.matchAll(/--lm-text-([\w-]+)--wt:\s*300;/g)].map((m) => m[1]);
    expect(light.sort()).toEqual(['hero', 'num', 'num-l', 'time']);
    for (const r of light) expect(parseFloat(token(`lm-text-${r}`)) * 16, `${r} size`).toBeGreaterThanOrEqual(36);
    expect(token('lm-weight-light')).toBe('300');
    expect(tokens).not.toMatch(/--lm-weight-[a-z]+:\s*(7|8|9)00/);
    expect(theme).not.toMatch(/--font-weight-[a-z]+:\s*(7|8|9)00/);
    expect(theme).toMatch(/--font-weight-light: 300;/);
  });

  it('no stylesheet asks for a weight Geist would render light or heavy: no 350, nothing above 600, 300 only through the numeral roles', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '__tests__') continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.css')) files.push(p);
      }
    };
    walk(resolve(root, 'src'));
    walk(resolve(root, 'public'));
    expect(files.length).toBeGreaterThan(30);
    for (const f of files) {
      const css = code(readFileSync(f, 'utf8'));
      const name = f.slice(root.length + 1);
      expect(css, name).not.toMatch(/font-weight:\s*350\b/);
      expect(css, name).not.toMatch(/font-weight:\s*(?:[789]00|bold|bolder)\b/);
      if (!name.endsWith('tokens.css') && !name.endsWith('fonts.css')) {
        expect(css, name).not.toMatch(/font-weight:\s*(?:[12]00|300|light|lighter)\b|var\(--lm-weight-light\)/);
      }
    }
  });
});

describe('material', () => {
  it('ships the grain as small lossless WebP tiles with their provenance next to them', () => {
    for (const name of ['vitals-grain', 'vitals-grain-backdrop', 'vitals-grain-card', 'vitals-grain-sidebar']) {
      const webp = resolve(root, `public/brand/grain/${name}.webp`);
      expect(existsSync(webp)).toBe(true);
      expect(statSync(webp).size).toBeLessThan(200 * 1024);
      const head = readFileSync(webp).subarray(0, 16).toString('latin1');
      expect(head.slice(0, 4)).toBe('RIFF');
      expect(head.slice(8, 12)).toBe('WEBP');
      // VP8L: lossless, so the grain carries no compression blocks
      expect(head.slice(12, 16)).toBe('VP8L');
      const prov = JSON.parse(read(`public/brand/grain/${name}.webp.json`)) as Record<string, string>;
      expect(prov.source).toMatch(/procedural/);
      expect(prov.method).toMatch(/seamless film grain: per-pixel Gaussian white noise/);
      expect(prov.method).toMatch(/low cut/);
    }
  });

  it('tiles the grain at one image pixel per device pixel', () => {
    expect(token('lm-grain')).toBe('url("/brand/grain/vitals-grain.webp")');
    expect(token('lm-grain-backdrop')).toBe('url("/brand/grain/vitals-grain-backdrop.webp")');
    expect(token('lm-grain-card')).toBe('url("/brand/grain/vitals-grain-card.webp")');
    expect(token('lm-grain-sidebar')).toBe('url("/brand/grain/vitals-grain-sidebar.webp")');
    expect(token('lm-grain-size')).toBe('512px');
    for (const [dppx, size] of [
      ['1.25', '409.6px'],
      ['1.5', '341.33px'],
      ['2', '256px'],
      ['3', '170.67px'],
    ] as const) {
      expect(tokens).toMatch(new RegExp(`@media \\(min-resolution: ${dppx}dppx\\)[^{]*\\{\\s*:root \\{ --lm-grain-size: ${size}; \\}`));
    }
  });

  it('paints the backdrop on body::before (wash over the tone-baked grain tile, one gradient) over a transparent body', () => {
    expect(token('lm-backdrop-bg')).toMatch(/^var\(--lm-wash-backdrop\),\s*var\(--lm-grain-backdrop\) 0 0 \/ var\(--lm-grain-size\) repeat,\s*var\(--lm-chassis\)$/);
    expect(token('lm-wash-backdrop')).toBe('radial-gradient(circle farthest-corner at 95% 0, rgb(227 191 120 / 0.055), rgb(227 191 120 / 0))');
    // no flat tint gradient on any material: each CSS gradient adds the browser's ordered dither (the "woven" grid)
    expect(token('lm-backdrop-bg')).not.toMatch(/linear-gradient/);
    expect(token('lm-card-bg')).not.toMatch(/linear-gradient/);
    const before = base.match(/body::before \{([^}]*)\}/)?.[1] ?? '';
    expect(before).toMatch(/position: fixed;/);
    expect(before).toMatch(/z-index: -1;/);
    expect(before).toMatch(/pointer-events: none;/);
    expect(before).toMatch(/background: var\(--lm-backdrop-bg\);/);
    expect(base.match(/\n {2}body \{([^}]*)\}/)?.[1]).toMatch(/background: transparent;/);
  });

  it('the DEFAULT card is the gold-wash material at a 20 px corner, and a class: `.lm-material-card`, `.lm-face`, `.lm-material`, `.lm-card`', () => {
    // the card grain is anchored to the viewport: a card edge between device pixels never resamples it
    expect(token('lm-card-bg')).toMatch(/^var\(--lm-wash-card\),\s*var\(--lm-grain-card\) 0 0 \/ var\(--lm-grain-size\) repeat fixed,\s*var\(--lm-face\)$/);
    expect(token('lm-wash-card')).toBe('radial-gradient(circle farthest-corner at 95% 0, rgb(227 191 120 / 0.035), rgb(227 191 120 / 0))');
    expect(theme).toMatch(/@utility lm-material-card \{\s*background: var\(--lm-card-bg\);\s*border: var\(--lm-hairline\) solid var\(--lm-line\);\s*border-radius: var\(--lm-card-radius\);\s*box-shadow: none;/);
    expect(token('lm-card-radius')).toBe('20px');
    const base = components.match(/\.lm-face,\s*\.lm-material,\s*\.lm-card,\s*\.lm-sidepanel\[data-mode='docked'\] \{([^}]*)\}/)?.[1] ?? '';
    expect(base).toMatch(/background: var\(--lm-card-bg\);/);
    expect(base).toMatch(/border: var\(--lm-hairline\) solid var\(--lm-line\);/);
    expect(base).toMatch(/border-radius: var\(--lm-card-radius\);/);
    expect(base).toMatch(/box-shadow: none;/);
    expect(components).toMatch(/:is\(\.lm-face, \.lm-card\)\[data-size='slim'\] \{\s*padding: 14px 20px 14px 14px;/);
  });

  it('a card opts into its domain with data-domain: ONE eased radial glow in oklab (five stops) over the grain over the card colour, behind @supports', () => {
    const at = components.indexOf("[data-domain='energy'] {");
    expect(at).toBeGreaterThan(0);
    // every domain wires its hue variables on ANY element (marks read --lm-hue, --lm-ink-h, --lm-deep, --lm-dim)
    for (const d of DOMAINS) {
      const rule = components.match(new RegExp(`\\[data-domain='${d}'\\] \\{([^}]*)\\}`))?.[1] ?? '';
      for (const [v, t] of [
        ['--lm-hue', `var(--lm-hue-${d})`],
        ['--lm-ink-h', `var(--lm-hue-${d}-ink)`],
        ['--lm-deep', `var(--lm-hue-${d}-deep)`],
        ['--lm-dim', `var(--lm-hue-${d}-dim)`],
        ['--lm-glow-pos', `var(--lm-glow-${d}-pos)`],
        ['--lm-glow-size', `var(--lm-glow-${d}-size)`],
        ['--lm-glow-a', `var(--lm-glow-${d}-a)`],
      ] as const) expect(rule, `${d} ${v}`).toContain(`${v}: ${t};`);
    }
    const gold = components.match(/\[data-domain='plan'\],\s*\[data-domain='gold'\] \{([^}]*)\}/)?.[1] ?? '';
    expect(gold).toContain('--lm-hue: var(--lm-signal);');
    expect(gold).toContain('--lm-deep: var(--lm-hue-gold-deep);');
    expect(gold).toContain('--lm-glow-a: var(--lm-glow-gold-a);');

    const supports = components.match(/@supports \(background: radial-gradient\(in oklab[^\n]*\) and \(color: color-mix\(in oklab[^\n]*\) \{([\s\S]*?)\n {2}\}\n/)?.[1] ?? '';
    expect(supports).toMatch(/:is\(\.lm-face, \.lm-material, \.lm-card\)\[data-domain\]:not\(\[data-domain='neutral'\], \[data-variant='inset'\]\)/);
    expect(supports.match(/radial-gradient\(/g)).toHaveLength(1);
    expect(supports).not.toMatch(/linear-gradient|conic-gradient/);
    expect(supports).toMatch(/radial-gradient\(\s*in oklab ellipse var\(--lm-glow-size\) at var\(--lm-glow-pos\),/);
    // five stops: alpha 1, .84, .50, .16, 0 (a smoothstep) at 0, 20, 42, 64, 86 %
    const stops = [...supports.matchAll(/color-mix\(in oklab, var\(--lm-deep\) calc\(var\(--lm-glow-a\) \* (\d+)%\), transparent\) (\d+)%/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(stops).toEqual([
      [100, 0],
      [84, 20],
      [50, 42],
      [16, 64],
    ]);
    expect(supports).toMatch(/transparent 86%\s*\);/);
    expect(supports).toContain('background: var(--lm-grain-card) 0 0 / var(--lm-grain-size) repeat fixed, var(--lm-face);');
    // The same glow fades on a composited layer; the inherited dial never interpolates gradient stops.
    expect(supports).toMatch(/::before \{[^}]*pointer-events: none;[^}]*opacity: var\(--lm-glow-k\);[^}]*transition: opacity var\(--lm-dur-glow\) var\(--lm-ease-out\);/);
    expect(supports).not.toMatch(/transition: --lm-glow-k|calc\(var\(--lm-glow-k\)/);
    expect(components).not.toMatch(/@keyframes[^{]*glow/);
    expect(components).toMatch(/\[data-glow='pending'\] \{\s*--lm-glow-k: 0;/);
    expect(tokens).toMatch(/@property --lm-glow-k \{\s*syntax: '<number>';\s*inherits: true;\s*initial-value: 1;\s*\}/);
  });

  it('a banner is not a data card: the Notice takes the card material, no glow, and the field radius', () => {
    const notice = components.match(/\n {2}\.lm-notice \{([^}]*)\}/)?.[1] ?? '';
    expect(notice).toMatch(/background: var\(--lm-card-bg\);/);
    expect(notice).toMatch(/border-radius: var\(--lm-radius-field\);/);
    expect(notice).not.toMatch(/gradient|data-domain/);
    expect(read('src/components/Notice.tsx')).not.toMatch(/data-domain/);
  });
});

describe('motion (r071)', () => {
  it('the picture motion tokens are the prototype\'s measured values', () => {
    expect([token('lm-dur-count'), token('lm-dur-draw'), token('lm-dur-glow'), token('lm-dur-bars'), token('lm-dur-fill')]).toEqual(['1100ms', '1200ms', '900ms', '700ms', '900ms']);
    expect([token('lm-stagger-tick'), token('lm-stagger-bar'), token('lm-pulse-cycles')]).toEqual(['14ms', '60ms', '2']);
    // the AUDIT §4.5 names are aliases of the same values
    expect([token('lm-dur-tick'), token('lm-dur-grow'), token('lm-ease-expo-out')]).toEqual(['var(--lm-stagger-tick)', 'var(--lm-dur-bars)', 'var(--lm-ease-out)']);
    expect([token('lm-dur-spring'), token('lm-dur-exit'), token('lm-dur-glide')]).toEqual(['320ms', '220ms', '280ms']);
    expect(token('lm-ease-in')).toBe('cubic-bezier(0.4, 0, 1, 1)');
    expect(token('lm-ease-needle')).toBe('cubic-bezier(0.34, 1.36, 0.64, 1)');
  });

  it('the spring is a damped oscillator: starts at 0, overshoots once by at most 3 %, settles on 1', () => {
    const pts = token('lm-ease-spring')
      .match(/^linear\((.*)\)$/)![1]!
      .split(',')
      .map(Number);
    expect(pts.length).toBeGreaterThan(20);
    expect(pts[0]).toBe(0);
    expect(pts[pts.length - 1]).toBe(1);
    const peak = Math.max(...pts);
    expect(peak).toBeGreaterThan(1.01);
    expect(peak).toBeLessThanOrEqual(1.03);
    // rises to the peak, then eases back: one overshoot
    const top = pts.indexOf(peak);
    for (let i = 1; i <= top; i++) expect(pts[i]!).toBeGreaterThan(pts[i - 1]!);
    for (let i = top + 1; i < pts.length; i++) expect(pts[i]!).toBeLessThanOrEqual(pts[i - 1]!);
  });

  it('reduced motion collapses every picture duration and stops the pulse, under the OS setting and under data-motion="reduce"', () => {
    const names = ['lm-dur-count', 'lm-dur-draw', 'lm-dur-glow', 'lm-dur-bars', 'lm-dur-fill', 'lm-dur-spring', 'lm-dur-exit', 'lm-dur-glide'];
    const os = tokens.match(/@media \(prefers-reduced-motion: reduce\) \{\s*:root \{([^}]*)\}/)?.[1] ?? '';
    const forced = base.match(/:root\[data-motion='reduce'\] \{([^}]*)\}/)?.[1] ?? '';
    for (const css of [os, forced]) {
      for (const n of names) expect(css, n).toMatch(new RegExp(`--${n}: 0\\.01ms;`));
      expect(css).toMatch(/--lm-stagger-tick: 0ms;/);
      expect(css).toMatch(/--lm-stagger-bar: 0ms;/);
      expect(css).toMatch(/--lm-pulse-cycles: 0;/);
    }
    // "full" over an OS preference restores them
    const full = base.match(/:root\[data-motion='full'\] \{([^}]*)\}/)?.[1] ?? '';
    for (const [n, v] of [
      ['lm-dur-count', '1100ms'],
      ['lm-dur-draw', '1200ms'],
      ['lm-dur-glow', '900ms'],
      ['lm-dur-bars', '700ms'],
      ['lm-dur-spring', '320ms'],
      ['lm-dur-glide', '280ms'],
    ] as const) expect(full, n).toContain(`--${n}: ${v};`);
  });
});

describe('browser surfaces and boot', () => {
  it('themes selection, caret, focus ring, scrollbars and accent controls', () => {
    expect(base).toMatch(/::selection \{\s*background: var\(--lm-text-selection\);\s*color: var\(--lm-ink\);/);
    expect(base).toMatch(/:focus-visible \{\s*outline: 2px solid var\(--lm-focus\);\s*outline-offset: 2px;/);
    // r068 U6/U7: thin theme-ink thumbs on transparent tracks; no native bar on the page itself (its track would be a
    // flat black strip) and none at all on touch
    expect(base).toMatch(/scrollbar-color: var\(--lm-scrollbar-thumb\) transparent;/);
    expect(base).toMatch(/\n {2}html \{\s*scrollbar-width: none;\s*\}/);
    expect(base).toMatch(/@media \(pointer: coarse\), \(max-width: 47\.99rem\) \{\s*\* \{\s*scrollbar-width: none !important;/);
    expect(tokens).toMatch(/:root \{ caret-color: var\(--lm-caret\); accent-color: var\(--lm-signal\); \}/);
  });

  it('index.html is dark only and opens <body> with the direction contract', () => {
    const html = read('index.html');
    expect(html).toMatch(/<html lang="en" data-theme="dark">/);
    expect(html).toMatch(/<meta name="color-scheme" content="dark" \/>/);
    expect(html.match(/<meta name="theme-color"[^>]*>/g)).toEqual(['<meta name="theme-color" content="#090909" />']);
    const body = html.slice(html.indexOf('<body>') + '<body>'.length).trimStart();
    expect(body.startsWith('<!-- DIRECTION CONTRACT')).toBe(true);
    const contract = body.slice(0, body.indexOf('-->'));
    expect(contract).toContain('97bfc117');
    expect(contract).toContain(
      'FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.',
    );
    expect(contract.replace('<!--', '').split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(150);
    // r071: the contract says what the app is now (20 px corners, Geist), not Inter and Figtree
    expect(contract).toMatch(/Geist/);
    expect(contract).not.toMatch(/Inter|Figtree|12px corners/);
  });

  it('theme-boot.js always pins dark and ignores ?theme= and the stored theme', () => {
    const boot = read('public/theme-boot.js');
    expect(boot).toMatch(/setAttribute\('data-theme', 'dark'\)/);
    expect(boot).not.toMatch(/get\('theme'\)|s\.theme|'light'/);
  });

  it('the start screen is the Ember backdrop', () => {
    const launch = read('public/brand/launch.css');
    expect(launch).not.toMatch(/prefers-color-scheme|data-theme/);
    expect(launch).toMatch(/\.vitals-launch \{[^}]*background: #090909;/);
  });
});
