import { describe, expect, it } from 'vitest';
import { makeChartData, makeComparison } from '../fixtures';
import { comparisonSummary, laneSummary } from '../lib/summary';
import { energyStep, intakeKcal } from '../lib/intake';

const data = makeChartData({ days: 84 });
const s = (id: string) => data.series.find((x) => x.id === id)!;

describe('accessible summaries', () => {
  it('names the metric, unit words, grade, direction, range and duration', () => {
    const t = laneSummary(s('fat_mass'));
    expect(t).toMatch(/^Fat mass, kilograms, grade A\. Falls from 24\.1 to 20\.\d \(likely \d+\.\d to \d+\.\d\) over 12 weeks; fastest in weeks \d+ to \d+/);
    expect(t.endsWith('Press T for the data table.')).toBe(true);
  });
  it('flags grade D as exploratory and uses index wording', () => {
    const t = laneSummary(s('autophagy'));
    expect(t).toContain('index, 0 to 100');
    expect(t).toContain('Exploratory');
  });
  it('summarises a plan comparison in goal order', () => {
    const cmp = makeComparison();
    const txt = comparisonSummary(cmp.goals[0]!, cmp.plans);
    expect(txt).toMatch(/^1\. lose 10 kg\. Plan A changes by minus \d+\.\d kg, plan B minus \d+\.\d, plan C minus \d+\.\d; target −10 kg\.$/);
  });
});

describe('intake derivations', () => {
  it('derives kcal with Atwater factors; fibre only in the detail total', () => {
    const k = intakeKcal(data.intake!);
    const g = data.intake!.grams;
    const d = 0;
    expect(k.byMacro.protein[d]).toBeCloseTo(g.protein[d]! * 4, 3);
    expect(k.byMacro.fat[d]).toBeCloseTo(g.fat[d]! * 9, 3);
    expect(k.totalWithFibre[d]! - k.total[d]!).toBeCloseTo(g.fibre[d]! * 2, 3);
  });
  it('steps energy tints by percent of maintenance (tokens §8)', () => {
    expect(energyStep(0)).toEqual({ side: 'fast', step: 4 });
    expect(energyStep(0.85)).toEqual({ side: 'deficit', step: 2 });
    expect(energyStep(0.7)).toEqual({ side: 'deficit', step: 3 });
    expect(energyStep(1)).toEqual({ side: 'neutral', step: 0 });
    expect(energyStep(1.4)).toEqual({ side: 'surplus', step: 4 });
  });
});
