// E20: markers — blood-marker lab locks in the planner's safety compile.
import { describe, expect, it } from 'vitest';
import { resolveProfile } from '../../../core/resolveProfile';
import { HC, compileLabLocks, compileSafetyCaps } from '../safety';
import { MAN_95 } from './personas';

const rp = resolveProfile(MAN_95);
const caps = (plannerLocks: Array<{ id: string; value?: number }>) => compileSafetyCaps(rp, { plannerLocks });

describe('lab locks', () => {
  it('creatine-cap 0 stops the planner adding creatine, with a plain reason', () => {
    expect(caps([]).creatineAllowed).toBe(true);
    const c = caps([{ id: 'creatine-cap', value: 0 }]);
    expect(c.creatineAllowed).toBe(false);
    expect(c.reasons.join(' ')).toMatch(/will not add creatine/);
  });

  it('creatine-cap above 0 leaves creatine allowed', () => {
    expect(caps([{ id: 'creatine-cap', value: 3 }]).creatineAllowed).toBe(true);
  });

  it('surplus-cap limits the gaining-phase surplus (research shape: % above maintenance)', () => {
    const base = caps([]);
    const c = caps([{ id: 'surplus-cap', value: 10 }]);
    expect(c.maxPctTdee).toBe(110);
    expect(c.surplusPhaseMaxPct).toBe(Math.min(base.surplusPhaseMaxPct, 110));
    expect(c.reasons.join(' ')).toMatch(/10 % above maintenance/);
  });

  it('surplus-cap as % of maintenance, strictest duplicate wins, never below maintenance', () => {
    expect(caps([{ id: 'surplus-cap', value: 115 }, { id: 'surplus-cap', value: 108 }]).maxPctTdee).toBe(108);
    expect(caps([{ id: 'surplus-cap', value: 100 }]).maxPctTdee).toBe(100);
    expect(caps([{ id: 'surplus-cap', value: 150 }]).maxPctTdee).toBe(HC.surplus.maxPctTdee);
  });

  it('display-only locks add a reason line and change nothing else', () => {
    const base = caps([]);
    const c = caps([
      { id: 'satfat-cap', value: 7 },
      { id: 'alcohol-cap', value: 0 },
      { id: 'caffeine-cap', value: 200 },
      { id: 'potassium-supp-cap', value: 0 },
      { id: 'fat-cap', value: 30 },
      { id: 'added-sugar-cap', value: 5 },
    ]);
    const { reasons, ...rest } = c;
    const { reasons: baseReasons, ...baseRest } = base;
    expect(rest).toEqual(baseRest);
    expect(reasons.length).toBe(baseReasons.length + 6);
    expect(reasons.join(' ')).toMatch(/Saturated fat kept under 7 %/);
    expect(reasons.join(' ')).toMatch(/adds no alcohol/);
    for (const r of reasons) expect(r).not.toMatch(/W-L|R13|§|cap\b/);
  });

  it('compileLabLocks ignores unrelated locks', () => {
    expect(compileLabLocks([{ id: 'deficit-cap', value: 10 }])).toEqual({ creatineOff: false, displayReasons: [] });
  });
});
