// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { carbShortfall, deficitPhi, rt3Target, t3fTarget } from '@/engine/model/hormones/equations';
import { DayDriver, makeProfile } from '@/engine/model/hormones/testHarness';
import { CYCLE_PHASE, moderatorsModule } from '@/engine/model/moderators';
import { makeCtx, person } from '@/engine/model/moderators/testkit';
import { createSignalBus } from '@/engine/types/signals';
import type { AnyEngineModule } from '@/engine/types/module';
import { makeHarness, MAN } from '@/engine/model/wellbeing/__tests__/harness';
import { phiInd, phiMaxFor } from '@/engine/model/wellbeing/equations';
import { combineWellbeingConcern } from '@/engine/model/wellbeing/concerns';
import { PARAM_INDEX } from '../params';
import thyroidTopic from '../topics/12-hormones-appetite';
import transitions, {
  INDUCTION_MODEL_DESCRIPTION,
  INDUCTION_MODEL_EQUATION,
} from '../topics/13-transitions-periodisation';
import cycles from '../topics/16-sleep-sex-age';
import wellbeing from '../topics/19-performance-wellbeing-bone';

const p = (id: string): number => PARAM_INDEX.get(id)!.value;
const thyroid = thyroidTopic.mechanisms.find((m) => m.id === '12-thyroid-t3')!;
const induction = transitions.mechanisms.find((m) => m.id === '13-induction-symptoms')!;
const concern = wellbeing.mechanisms.find((m) => m.id === '19-mood-energy-and-keto-induction-symptoms')!;
const cycle = cycles.mechanisms.find((m) => m.id === '16-menstrual-cycle-and-contraception')!;
const target = (u: number, c: number) =>
  t3fTarget(
    u,
    deficitPhi(u, p('hormones.uScaleEnergy')),
    carbShortfall(c, p('hormones.t3CarbKneeG')),
    p('hormones.t3EnergyCoef'),
    p('hormones.t3CarbCoef'),
    p('hormones.t3SurplusCoef'),
    p('hormones.t3SurplusScale'),
  );

describe('A2-028: current thyroid definition, not the rejected cortisol knee', () => {
  it.each([
    [0, 0.78],
    [50, 1],
    [100, 1],
    [130, 1],
  ])('at energy balance and %s g/day, internal fast target is %s', (c, expected) => {
    expect(p('hormones.t3CarbKneeG')).toBe(50);
    expect(target(0, c)).toBeCloseTo(expected, 12);
    expect(thyroid.equation).toContain('DC_T3 = clamp(1 − C / 50, 0, 1)');
    expect(p('hormones.carbKneeCortG')).toBe(130);
    expect(carbShortfall(100, p('hormones.carbKneeCortG'))).toBeCloseTo(30 / 130, 12);
  });

  it('retains the carbohydrate component in surplus and the selected time constants', () => {
    expect(target(0.01, 0)).toBeCloseTo(1 + (0.1 * 0.01) / 0.3 - 0.22, 12);
    expect(thyroid.equation).toContain('T3f* = 1 + 0.10 · min(1, u / 0.3) − 0.22 · DC_T3 for u > 0');
    expect(p('hormones.t3TauDownD')).toBe(2);
    expect(p('hormones.t3TauUpD')).toBe(3);
    expect(thyroid.equation).toContain('τ_down = 2 d, τ_up = 3 d');
    const oldTargetAt100 = 1 - 0.22 * carbShortfall(100, 130);
    // This discrepancy concerns the internal direct target with all other drivers fixed, never a personal lab error.
    expect(100 * (target(0, 100) - oldTargetAt100)).toBeCloseTo(5.07692307692308, 10);
  });

  it('normalizes actual T3 and rT3 states to the habitual carbohydrate reference', () => {
    const profile = makeProfile(MAN, { habitualCarbG: 20 });
    const dr = new DayDriver(profile, { startDay: -7 });
    dr.bus.tdeeEstKcalD = profile.tdee0Kcal;
    for (let d = 0; d < 7; d++) dr.runDay();
    dr.endBurnIn();
    expect(dr.hs.t3fRef).toBeCloseTo(target(0, 20), 12);
    const dc = carbShortfall(20, p('hormones.t3CarbKneeG'));
    expect(dr.hs.rt3Ref).toBeCloseTo(rt3Target(0, dc, 0.6, 0.7, 0.3, 0.15), 12);
    expect(dr.hs.t3Rel).toBe(1);
    expect(dr.hs.rt3).toBe(1);
    dr.runDay();
    expect(dr.hs.t3Rel).toBeCloseTo(
      (dr.hs.t3f / dr.hs.t3fRef) * (dr.hs.lFmLag / dr.hk.l0) ** p('hormones.t3LeanExp'),
      12,
    );
    expect(dr.hs.rt3).toBeCloseTo(dr.hs.rt3S / dr.hs.rt3Ref, 12);
    expect(thyroid.equation).toContain('(T3f / T3fRef) · (L_FM_lag / L0)^0.30');
    expect(thyroid.equation).toContain('rT3_rel = rT3S / rT3Ref');
  });

  it('keeps measured study results, labels unused hooks and omits unreproduced historical fit examples', () => {
    expect(thyroid.keyNumbers.some((k) => k.value.includes('T3 −53 %, rT3 +58 %'))).toBe(true);
    expect(thyroid.keyNumbers.some((k) => k.label.startsWith('Fit check'))).toBe(false);
    expect(thyroid.caveats).not.toContain('model gives −31 %');
    expect(thyroid.howModelled).toMatch(/not a diagnostic threshold or a universal carbohydrate minimum/);
    expect(transitions.mechanisms.find((m) => m.id === '13-hormone-transients')!.equation).toMatch(
      /^Proposed alternatives, not run:/,
    );
  });
});

describe('A2-029: one induction definition agrees with the current provider', () => {
  it('shares both the trigger description and curve across the articles, with no plateau equation', () => {
    expect(induction.howModelled).toBe(INDUCTION_MODEL_DESCRIPTION);
    expect(concern.howModelled).toContain(INDUCTION_MODEL_DESCRIPTION);
    expect(induction.equation).toBe(INDUCTION_MODEL_EQUATION);
    expect(concern.equation).toContain(INDUCTION_MODEL_EQUATION);
    for (const m of [induction, concern]) {
      expect(`${m.howModelled} ${m.equation}`).not.toMatch(
        /holds for days|2 consecutive days|7-day mean net carbohydrate|KI = 0 for \(t/,
      );
      expect(m.equation).toContain('fastSeenDay === 0');
      expect(m.howModelled).toContain('not a personal symptom probability');
    }
  });

  it.each([
    [0.5, 2.5],
    [0.9, 6],
  ])('same-energy habitual-to-20 g/day transition: selector %s gives tau %s', (selector, tau) => {
    const h = makeHarness(MAN, { overrides: { 'wellbeing.ketoHeavyTailQuantile': selector } });
    expect(h.k.ketoTau).toBe(tau);
    const previousEMA = h.s.carbEma7;
    const amplitude = Math.max(0, Math.min(1, (previousEMA - 20) / previousEMA));
    const actual: number[] = [];
    for (let day = 0; day <= 4; day++) {
      h.run({ ei: h.base.ei, carb: 20, fat: h.base.fat + (4 * (h.base.carb - 20)) / 9 }, 1);
      actual.push(h.s.ketoInduction);
      expect(h.s.ketoStartDay).toBe(0);
      expect(h.s.phiMax).toBeCloseTo(amplitude, 12);
      const described = day <= 0 ? 0 : Math.min(1, amplitude * (day / tau) * Math.exp(1 - day / tau));
      expect(h.s.ketoInduction).toBeCloseTo(described, 12);
      expect(h.s.ketoInduction).toBeCloseTo(phiInd(day, amplitude, tau), 12);
    }
    expect(actual[0]).toBe(0);
    expect(actual[1]).toBeGreaterThan(0);
    expect(actual[2]).not.toBe(actual[4]);
  });

  it('uses the previous EMA for a new amplitude and keeps a stronger running curve at a weak retrigger', () => {
    const h = makeHarness(MAN);
    const previous = h.s.carbEma7;
    h.run({ carb: 20 }, 1);
    expect(h.s.phiMax).toBeCloseTo(phiMaxFor(previous, 20, 3000, h.k.ketoNaThrMg, 0), 12);
    h.run({ carb: 50 }, 1); // leave low carbohydrate, without letting the seven-day EMA recover
    const oldStart = h.s.ketoStartDay;
    const oldAmplitude = h.s.phiMax;
    const weakAmplitude = phiMaxFor(h.s.carbEma7, 49, 3000, h.k.ketoNaThrMg, 0);
    expect(weakAmplitude).toBeLessThan(phiInd(h.dayIdx - oldStart, oldAmplitude, h.k.ketoTau));
    h.run({ carb: 49 }, 1);
    expect(h.s.ketoStartDay).toBe(oldStart);
    expect(h.s.phiMax).toBe(oldAmplitude);
    h.run({ carb: h.base.carb }, 20); // permit recovery, then a genuinely stronger crossing
    const newAmplitude = phiMaxFor(h.s.carbEma7, 0, 3000, h.k.ketoNaThrMg, 0);
    expect(newAmplitude).toBeGreaterThan(phiInd(h.dayIdx - oldStart, oldAmplitude, h.k.ketoTau));
    const newStart = h.dayIdx;
    h.run({ carb: 0 }, 1);
    expect(h.s.ketoStartDay).toBe(newStart);
    expect(h.s.ketoInduction).toBe(0);
  });

  it('does not trigger on fasting-only days or habitual low carbohydrate, or mitigate with sodium by default', () => {
    const fast = makeHarness(MAN);
    fast.run({ fast: true, ei: 0, carb: 0, fat: 0 }, 4);
    expect(fast.s.ketoStartDay).toBe(-1);
    expect(fast.s.ketoInduction).toBe(0);
    const habitual = makeHarness({ ...MAN, habits: { habitualCarbPctEnergy: 5 } });
    habitual.run({ carb: 20 }, 4);
    expect(habitual.s.ketoInduction).toBe(0);
    const low = makeHarness(MAN);
    const high = makeHarness(MAN);
    low.run({ carb: 20, sodiumMg: 1500 }, 4);
    high.run({ carb: 20, sodiumMg: 2500 }, 4);
    expect(p('wellbeing.ketoNaMitigation')).toBe(0);
    expect(low.s.ketoInduction).toBe(high.s.ketoInduction);
    expect(induction.howModelled).toContain('not measured symptom prevalence');
    expect(induction.caveats).toContain('not prevalence or a validated personal time course');
    expect(
      combineWellbeingConcern({
        modelTier: 0,
        observed: [{ date: '2026-10-01', concerns: ['persistentFatigue'] }],
      }).status,
    ).toBe('review');
  });
});

describe('A2-033: LH observation and estimated ovarian phase stay distinct', () => {
  it.each(['lhTest', 'clinician'] as const)(
    'keeps a legacy %s date unchanged while anchoring only an estimate',
    (method) => {
      const input = person({
        body: { sex: 'female' },
        cycle: {
          tracking: true,
          regularity: 'regular',
          cycleLengthD: 28,
          periodStarts: ['2026-09-21'],
          ovulation: [{ date: '2026-10-03', method }],
        },
      });
      const original = structuredClone(input);
      const ctx = makeCtx([moderatorsModule as unknown as AnyEngineModule], input);
      const k = moderatorsModule.prepare(ctx);
      const s = moderatorsModule.init(k, ctx, createSignalBus());
      expect(s.cyclePhaseSource).toBe(CYCLE_PHASE.ovulationAnchored);
      expect(input).toEqual(original);
      expect(ctx.profile.cycle.ovulation).toEqual(original.cycle!.ovulation);
      expect(cycle.howModelled).toContain('observed LH signal; it does not confirm that ovulation occurred');
      expect(cycle.howModelled).toContain('separately user-reported clinician-confirmed event');
      expect(cycle.howModelled).toContain('may already be your inferred event date');
      expect(cycle.howModelled).toContain('not fertility or contraception advice');
      expect(cycle.timeCourse).toContain('All phases remain estimated');
      expect(cycle.equation).toContain('LH-informed assumed date');
      expect(cycle.howModelled).not.toContain('manually confirmed ovulation (an LH test');
    },
  );

  it('retains the optional unknown-phase average and gives LH timing its useful but scoped evidence', () => {
    const input = person({
      body: { sex: 'female' },
      cycle: {
        tracking: true,
        regularity: 'unknown',
        periodStarts: ['2026-09-21'],
        ovulation: [{ date: '2026-10-03', method: 'lhTest' }],
      },
    });
    const ctx = makeCtx([moderatorsModule as unknown as AnyEngineModule], input);
    const k = moderatorsModule.prepare(ctx);
    const s = moderatorsModule.init(k, ctx, createSignalBus());
    expect(s.cyclePhaseSource).toBe(CYCLE_PHASE.phaseAverage);
    expect(s.cycleDay).toBe(-1);
    expect(s.lutealWeight).toBe(k.phaseMean);
    expect(cycle.howModelled).toContain('optional');
    expect(cycle.howModelled).toContain('no phase is asserted');
    expect(
      cycle.keyNumbers.some(
        (n) =>
          n.label.includes('107 initially enrolled') && n.label.includes('102 women, 283 analyzed cycles'),
      ),
    ).toBe(true);
    expect(cycle.referenceIds).toContain('leiva2018corrigendum');
    expect(
      cycle.keyNumbers.some((n) => n.value.includes('96 %') && n.referenceIds?.includes('bouchard2026')),
    ).toBe(true);
  });
});
