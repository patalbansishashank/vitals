/**
 * Drift guards (SPEC A.3.2): the helpers V4a copies out of src/features (components never import features) stay equal to
 * their originals, and viz.css keeps to the Ember rules (tokens only, flat, no heavy weights, reduced motion through the
 * motion tokens) with a valid ordinal state ramp.
 *
 * r071 (package 0B) amends it in two ways. viz.css keeps ONLY the rules of the pictures that are restyled in place
 * (Hypnogram, StateStrip, Stat, ShareBar, TwinTable) or retired later, so its guards above stand unchanged: the new look
 * (one glow, mono caps, light numerals) lives in the new stylesheets, whose own guards are
 * src/components/__tests__/r071Css.test.ts. And the new pictures share one contract, checked at the end of this file:
 * each ships its spoken sentence and its Table twin, is named for assistive technology, and stays out of the old
 * class namespaces.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cloneElement } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as components from '@/components';
import { arcPath as livingArcPath, polar as livingPolar } from '@/features/charts/living/adherenceGeometry';
import { TwinTable as LivingTwinTable } from '@/features/charts/living/TrendLane';
import { arcPath, polar } from '../geometry';
import { TwinTable } from '../TwinTable';

const root = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const vizCss = read('src/components/viz/viz.css');
const livingCss = read('src/features/charts/living/living-charts.css');

/** selector → normalised declarations, for every rule in a stylesheet (comments dropped, one level of nesting). */
function rules(css: string): Map<string, string> {
  const out = new Map<string, string>();
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}@]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const sel = m[1]!.trim().replace(/\s+/g, ' ');
    const body = m[2]!
      .split(';')
      .map((d) => d.trim().replace(/\s+/g, ' '))
      .filter(Boolean)
      .join('; ');
    out.set(sel, body);
  }
  return out;
}

describe('copied helpers stay equal to charts/living', () => {
  it('polar and arcPath', () => {
    for (const a of [0, 0.3, 1.7, Math.PI, 5.9]) {
      expect(polar(120, 120, 92, a)).toEqual(livingPolar(120, 120, 92, a));
      expect(arcPath(120, 120, 92, a, a + 1.2)).toBe(livingArcPath(120, 120, 92, a, a + 1.2));
    }
    expect(arcPath(0, 0, 10, 1, 1)).toBe(livingArcPath(0, 0, 10, 1, 1));
  });

  it('TwinTable markup', () => {
    const props = { id: 'twin', title: 'Weight table', caption: 'Weight by day', rows: 3, fileName: 'w.csv', csv: () => 'a' };
    const body = (
      <tbody>
        <tr>
          <th scope="row">1 Oct</th>
          <td>90.0</td>
        </tr>
      </tbody>
    );
    const a = render(<TwinTable {...props}>{body}</TwinTable>).container.innerHTML;
    const b = render(<LivingTwinTable {...props}>{body}</LivingTwinTable>).container.innerHTML;
    expect(a).toBe(b);
  });

  it('the lmc-lv-* and lmc-twin rules copied into viz.css', () => {
    const copy = vizCss.slice(vizCss.indexOf('/* copy:begin */'), vizCss.indexOf('/* copy:end */'));
    const mine = rules(copy);
    const theirs = rules(livingCss);
    expect(mine.size).toBeGreaterThan(20);
    for (const [sel, body] of mine) expect(theirs.get(sel), sel).toBe(body);
  });
});

describe('viz.css keeps the Ember rules', () => {
  const code = vizCss.replace(/\/\*[\s\S]*?\*\//g, '');

  it('is flat: no shadow, glow, gradient, blur or filter', () => {
    expect(code).not.toMatch(/box-shadow|text-shadow|gradient\(|blur\(|filter:/);
  });

  it('uses no weight of 600 or more and no uppercase', () => {
    for (const [, w] of code.matchAll(/font-weight:\s*(\d+)/g)) expect(Number(w)).toBeLessThanOrEqual(500);
    expect(code).not.toMatch(/text-transform:\s*uppercase/);
  });

  it('draws colours from tokens only (the state ramp fallbacks aside) and keeps tabular numerals', () => {
    const hexes = [...code.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase());
    expect(hexes).toEqual(['#746064', '#8f7a7e', '#ab9599', '#c8b1b5']);
    expect(code).not.toMatch(/rgba?\(|hsla?\(/);
    expect(code).toMatch(/\.lmv \{[^}]*font-variant-numeric: tabular-nums/);
  });

  it('moves only on the motion tokens, so reduced motion makes everything instant', () => {
    for (const [, t = ''] of code.matchAll(/transition:\s*([^;]+);/g)) {
      if (t.trim() === 'none') continue;
      expect(t, t).toMatch(/var\(--lm-dur-[a-z]+\) var\(--lm-ease-[a-z]+\)/);
      expect(t).not.toMatch(/\d+m?s/);
    }
    expect(code).toMatch(/transition: left var\(--lm-dur-needle\) var\(--lm-ease-needle\)/);
  });

  it('has a forced-colours block', () => {
    expect(code).toMatch(/@media \(forced-colors: active\)/);
  });

  it('the state ramp: one near-neutral taupe hue, monotone lightness ΔL ≥ 0.08, the dim end ≥ 2.9:1 on the card', () => {
    const lin = (h: string, i: number) => {
      const c = parseInt(h.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const oklab = (h: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => lin(h, i)) as [number, number, number];
      const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
      const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
      const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
      const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
      const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
      const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
      return { L, C: Math.hypot(A, B), H: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
    };
    const lum = (h: string) => [1, 3, 5].reduce((s, i, k) => s + lin(h, i) * [0.2126, 0.7152, 0.0722][k]!, 0);
    const ramp = [1, 2, 3, 4].map((n) => new RegExp(`--lmv-state-${n}: var\\(--lm-state-${n}, (#[0-9a-f]{6})\\)`).exec(code)![1]!);
    const steps = ramp.map(oklab);
    for (let i = 1; i < steps.length; i++) expect(steps[i]!.L - steps[i - 1]!.L).toBeGreaterThanOrEqual(0.08);
    // r071: `--lm-cat-recovery` is the recovery domain's cyan now (Q12), so the ramp no longer follows its hue; it stays one
    // hue (within 6° of its own first step) at chroma under 0.04: a neutral that reads as a state, never as a domain colour
    for (const s of steps) {
      expect(Math.abs(s.H - steps[0]!.H)).toBeLessThan(6);
      expect(s.C).toBeLessThan(0.04);
    }
    const card = lum('#1B1916');
    expect((lum(ramp[0]!) + 0.05) / (card + 0.05)).toBeGreaterThanOrEqual(2.9);
  });
});

describe('the r071 pictures keep one contract (AUDIT §5.2, §5.5)', () => {
  const T0 = Date.parse('2026-10-29T20:00:00Z');
  const H = 3_600_000;
  const days = Array.from({ length: 7 }, (_, i) => `2026-10-${String(24 + i).padStart(2, '0')}`);
  const rows = [
    { id: 'deep', label: 'Deep', valueText: '1 h 24', share: 0.2, hue: 'var(--lm-stage-deep)' },
    { id: 'light', label: 'Light', valueText: '4 h 34', share: 0.6, hue: 'var(--lm-stage-light)' },
  ];
  /** One minimal, valid instance of each picture, with its role and the names of its spoken sentence and twin. */
  const pictures: Array<{ name: string; element: React.ReactElement; role: 'img' | 'meter'; spoken: string; twin: string; hue: boolean }> = [
    { name: 'RadialTicks', element: <components.RadialTicks label="Steps" value={7605} goal={9000} animate={false} />, role: 'meter', spoken: 'spokenRadial', twin: 'radialTwin', hue: true },
    { name: 'DottedTrack', element: <components.DottedTrack label="Protein" value={32} goal={150} valueText="32 g" animate={false} />, role: 'meter', spoken: 'spokenTrack', twin: 'trackTwin', hue: true },
    { name: 'HighlightBars', element: <components.HighlightBars dates={days} values={[5, 7, 8, 4, 7, 6, 7]} name="Steps, last week" animate={false} />, role: 'img', spoken: 'spokenBars', twin: 'barsTwin', hue: true },
    { name: 'GlowLine', element: <components.GlowLine label="Energy" series={[0, 1, 3, 6, 10]} animate={false} />, role: 'img', spoken: 'spokenLine', twin: 'lineTwin', hue: true },
    { name: 'RangeScale', element: <components.RangeScale label="HRV" value={48} min={20} max={80} usual={[38, 62]} animate={false} />, role: 'meter', spoken: 'spokenRange', twin: 'rangeTwin', hue: true },
    { name: 'StackBar', element: <components.StackBar label="Sleep stages" rows={rows} animate={false} />, role: 'img', spoken: 'spokenStack', twin: 'stackTwin', hue: false },
    { name: 'WindowBar', element: <components.WindowBar label="Sleep timing" axis={[T0, T0 + 16 * H]} actual={{ from: T0 + 3 * H, to: T0 + 11 * H }} tz="UTC" animate={false} />, role: 'img', spoken: 'spokenWindow', twin: 'windowTwin', hue: false },
  ];

  it('each ships its spoken sentence and its Table twin from the barrel', () => {
    const exported = components as unknown as Record<string, unknown>;
    for (const p of pictures) {
      expect(typeof exported[p.name], p.name).toBe('function');
      expect(typeof exported[p.spoken], p.spoken).toBe('function');
      expect(typeof exported[p.twin], p.twin).toBe('function');
    }
  });

  it('each is named for assistive technology: a meter or an image with a sentence', () => {
    for (const p of pictures) {
      const { unmount } = render(p.element);
      const el = screen.getAllByRole(p.role).find((e) => e.closest('.lmz')) ?? screen.getAllByRole(p.role)[0]!;
      const name = el.getAttribute('aria-label') ?? '';
      const text = p.role === 'meter' ? (el.getAttribute('aria-valuetext') ?? name) : name;
      expect(text.length, p.name).toBeGreaterThan(8);
      unmount();
    }
  });

  it('a hue override reaches the picture as data-hue, so it inherits a card’s domain without a prop', () => {
    for (const p of pictures.filter((x) => x.hue)) {
      const { container, unmount } = render(cloneElement(p.element, { hue: 'sleep' } as never));
      expect(container.querySelector('[data-hue="sleep"]'), p.name).not.toBeNull();
      unmount();
    }
  });

  it('the new stylesheets stay out of the old namespaces (viz.css keeps lmv-/lmc-, the new files lmz- and lm-; viz-base only places the shared Table twin)', () => {
    for (const f of ['radial', 'track', 'bars', 'glow', 'scale', 'stack', 'window']) {
      const css = read(`src/components/viz/${f}.css`).replace(/\/\*[\s\S]*?\*\//g, '');
      expect(css, f).not.toMatch(/\.lmv-|\.lmc-/);
    }
    // and viz.css never grew a glow, a gradient or a hex of its own: the one glow is the card's
    expect(vizCss.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/radial-gradient|--lm-glow/);
  });
});
