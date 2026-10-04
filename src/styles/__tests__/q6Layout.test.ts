/**
 * Q6 visual pass (PLAN 02 item 12): layout fixes measured in the browser by qa/scripts/Q6 (shoot.mjs, checks.mjs,
 * ladder.mjs) at 390 / 768 / 1440 px in both themes. jsdom computes no layout, so this keeps the declarations that
 * fixed each finding from regressing; the browser scripts remain the measurement.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatNumber, GROUP_SPACE, parseNumber } from '@/components/lib/format';
import { energyInText } from '@/components/lib/energy';

const read = (p: string) => readFileSync(resolve(__dirname, '../../..', p), 'utf8');

function rule(css: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|\\n)\\s*${esc} \\{([^}]*)\\}`));
  if (!m) throw new Error(`${selector} not found`);
  return m[1]!;
}

describe('Q6 layout fixes', () => {
  it('key-value lists keep a label column (Food supplements: "why" no longer runs into its value at 390 px)', () => {
    expect(rule(read('src/styles/components.css'), '.lm-kv')).toMatch(/grid-template-columns: minmax\(6em, 1fr\) minmax\(0, max-content\);/);
  });

  it('ladder cards label their phase strip (no blank tinted bar); narrow segments still hide the label', () => {
    const css = read('src/features/planner/planner.css');
    expect(css).not.toMatch(/\.lp-phases\[data-size='card'\] \.lp-phases__label \{\s*display: none;/);
    expect(css).toMatch(/@container \(max-width: 72px\) \{\s*\.lp-phases__label \{\s*display: none;/);
  });

  it('ladder graph labels drop below their dot when a neighbour is close', () => {
    expect(read('src/features/planner/components/LadderScale.tsx')).toMatch(/data-crowd=\{search \? undefined : crowd\(p\)\}/);
    const css = read('src/features/planner/ladder.css');
    expect(rule(css, ".lp-scale__mark[data-crowd='close'] .lp-scale__label")).toMatch(/translate: 0 14px;/);
    expect(css).toMatch(/@container lp-scale \(max-width: 640px\)/);
  });

  it('markers receipt rows are a grid (question over answer, Change on the right)', () => {
    const css = read('src/features/intake/chapters/markers.css');
    expect(rule(css, '.lm-mk-receipt__row')).toMatch(/grid-template-columns: minmax\(0, 1fr\) auto;/);
    expect(rule(css, '.lm-mk-receipt__row .lm-ik-receipt__change')).toMatch(/grid-row: 1 \/ span 2;/);
  });

  it('chapter progress labels are blocks, so long names end in an ellipsis instead of being cut', () => {
    const css = read('src/features/intake/intake.css');
    expect(css).toMatch(/\.lm-ik-progress__label \{\s*display: block;\s*\}/);
    expect(css).toMatch(/flex: 0 0 420px;/);
  });

  it('a complete chapter never reads "question 3 of 2"', () => {
    expect(read('src/features/intake/IntakePage.tsx')).toMatch(/complete \? TURN\.answeredOf\(prog\.done, prog\.total\) : TURN\.questionOf/);
  });

  it('the adherence dial caption wraps inside the ring', () => {
    expect(rule(read('src/features/charts/living/living-charts.css'), '.lmc-dial__sub')).toMatch(/max-width: calc\(var\(--lmc-dial-px, 120px\) \* 0\.7\);/);
  });

  it('plan versions rows line up with the title and wrap with a readable line height', () => {
    const r = rule(read('src/features/living/plan/plan.css'), '.lv-plan-versions__link');
    expect(r).toMatch(/margin-inline: -8px;/);
    expect(r).toMatch(/line-height: 1\.4;/);
  });

  it('settings deep links keep the target aligned while sections above load, without doubling the scroll offset', () => {
    const page = read('src/features/settings/SettingsPage.tsx');
    expect(page).toMatch(/new ResizeObserver\(\(\) => !done && go\(\)\)/);
    expect(page).toMatch(/window\.setTimeout\(stop, 3000\)/);
    expect(read('src/features/settings/sections.tsx')).toMatch(/<Faceplate as="section" id=\{id\} aria-labelledby=\{titleId\} className="scroll-mt-2">/);
  });

  it('the catalogue picker never makes a page wider than the phone (Settings › Kitchen at 390 px)', () => {
    const css = read('src/features/components/picker.css');
    expect(rule(css, '.lm-pk__body')).toMatch(/grid-template-columns: minmax\(0, 1fr\);/);
    expect(rule(css, '.lm-pk__region-keys .lm-key')).toMatch(/white-space: normal;/);
  });

  it('the mobile settings chip rail keeps the lit chip in view', () => {
    expect(read('src/features/settings/SettingsPage.tsx')).toMatch(/rail\.scrollTo\(\{ left: rail\.scrollLeft \+ c\.left - r\.left - 16 \}\)/);
  });

  it('grouped numbers cannot break across lines and still parse', () => {
    expect(GROUP_SPACE).toBe('\u00a0');
    const s = formatNumber(2890, 0);
    expect(s).toBe('2\u00a0890');
    expect(parseNumber(s)).toBe(2890);
    expect(energyInText(`about ${formatNumber(2000, 0)} kcal a day`, 'kJ')).toBe(`about ${formatNumber(8370, 0)} kJ a day`);
  });
});
