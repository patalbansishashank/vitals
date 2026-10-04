/**
 * Sheet inset (PLAN 02 item 1, sheet pass). The shared panel body (`.lm-panel__body`, Sheet and SidePanel) has no
 * padding, so every sheet's content root insets itself 16 px like the panel head and foot (20 at the end). Before E23
 * the Living sheets (start, busy/away, pause, row, check-in, meal and session loggers, swap, recipe, measurement, food
 * panels) had none and their text and fields touched the screen edge. Measured in the browser by
 * qa/scripts/E23/sheets.mjs; this test keeps the declarations from regressing (jsdom computes no styles).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(__dirname, '../../..', p), 'utf8');

function rule(css: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|\\n)\\s*${esc} \\{([^}]*)\\}`));
  if (!m) throw new Error(`${selector} not found`);
  return m[1]!;
}

const INSET = /padding: var\(--lm-space-4\) var\(--lm-space-4\) var\(--lm-space-5\);/;

const ROOTS: [file: string, selector: string][] = [
  ['src/features/living/living.css', '.lv-sheet'],
  ['src/features/living/start/start.css', '.lv-start'],
  ['src/features/living/today/today.css', '.lv-checkin'],
  ['src/features/living/food/food.css', '.lv-food-sheet'],
  ['src/features/living/food/food.css', '.lv-food-logger'],
  ['src/features/living/train/train.css', '.lv-train-panel'],
  ['src/features/living/progress/progress.css', '.lv-measure'],
  ['src/features/living/coach/coach.css', '.lm-panel__body > .lv-coach-brief__body'],
];

describe('sheet content inset', () => {
  it('the shared panel body still leaves padding to its content (so the roots below must pad)', () => {
    expect(rule(read('src/styles/components.css'), '.lm-panel__body')).not.toMatch(/padding/);
  });

  it.each(ROOTS)('%s %s insets 16 / 16 / 20', (file, selector) => {
    expect(rule(read(file), selector)).toMatch(INSET);
  });

  it('the Food panels put their content inside a padded root', () => {
    const src = read('src/features/living/food/components/panels.tsx');
    const panels = src.split('<ResponsivePanel').slice(1);
    expect(panels).toHaveLength(3);
    for (const p of panels) expect(p.slice(p.indexOf('>') + 1).trimStart()).toMatch(/^<div className="lv-food-sheet">/);
  });

  it('row and busy sheets keep one track no wider than the sheet, with banks that fold to two columns', () => {
    const css = read('src/features/living/living.css');
    expect(rule(css, '.lv-sheet')).toMatch(/grid-template-columns: minmax\(0, 1fr\);/);
    expect(css).toMatch(/@container lv-sheet \(max-width: 520px\)/);
  });
});
