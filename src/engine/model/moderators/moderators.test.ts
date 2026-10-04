// @vitest-environment node
/**
 * Unit tests of the moderators module (MODEL_SPEC §1.1; dossier 16 §4.0-4.13).
 * Acceptance (WP-M1): 16 V1-V2, V4-V5, V11-V12; equations against the dossier's worked numbers; property tests
 * (bounds, monotonicity, habitual steady state for 30 days, extreme inputs stay finite); cost of a 180-day run.
 */
import { describe, expect, it } from 'vitest';
import { validateParamDefs } from '../../core/paramsRegistry';
import { habitualDay } from '../../core/compileSchedule';
import type { AnyEngineModule } from '../../types/module';
import type { DayInput } from '../../types/inputs';
import type { SignalBus } from '../../types/signals';
import { MI, N_SERIES } from '../../types/metrics';
import {
  alcoholRecoveryPenalty,
  caffeineHalfLifeH,
  caffeineResidualMg,
  cycleDayOn,
  daysFromCivil,
  isoDayNumber,
  lutealMeanWeight,
  lutealStartDay,
  lutealWeightAt,
  moderatorsModule,
  partitionSleepShift,
  tstLossMin,
  type ModeratorsState,
} from './index';
import { MODERATORS_PARAMS } from './params';
import { makeCtx, miniRun, person } from './testkit';

const mods = [moderatorsModule] as unknown as readonly AnyEngineModule[];
const ctxFor = (p = person(), ov: Record<string, number> = {}) => makeCtx(mods, p, ov);

/** Habitual day with a night of `sleepH` hours (bed 23:00) and optional patches. */
function nightDay(profile: ReturnType<typeof makeCtx>['profile'], sleepH: number, patch: Partial<DayInput> = {}): DayInput {
  const d = habitualDay(profile);
  d.sleepHours = sleepH;
  d.sleepWakeH = (d.sleepBedH + sleepH) % 24;
  Object.assign(d, patch);
  return d;
}

/** Run `n` nights of `sleepH` (constant) and return the bus after startDay of morning 1..n (index 0 = morning of day 1). */
function sleepSeries(n: number, sleepH: number, ov: Record<string, number> = {}, p = person(), patch: Partial<DayInput> = {}, u = 0): SignalBus[] {
  const ctx = ctxFor(p, ov);
  const days = Array.from({ length: n + 1 }, (_, d) => ({ clockDay: d, day: nightDay(ctx.profile, sleepH, patch) }));
  const out: SignalBus[] = [];
  miniRun(mods, ctx, days, {
    beforeDay: (_d, bus) => {
      bus.energyBalanceFrac = u;
    },
    beforeHour: (d, h, bus) => {
      if (h === 0 && d >= 1) out.push({ ...bus });
    },
  });
  return out;
}

/** Fat share of the mass lost for a protein-energy fraction P (16 §4.1.3 conversion with the paper's own factors). */
const fatShareOfLoss = (P: number): number => 1 / (1 + (P / (1 - P)) * (9.46 / (0.21 * 4.32)));

describe('parameter registry (16 §4.0-4.13)', () => {
  it('is valid and carries the dossier numbers', () => {
    expect(validateParamDefs(mods)).toEqual([]);
    const by = (n: string) => MODERATORS_PARAMS.find((p) => p.id === `moderators.${n}`)!;
    // review M20: the rejected alternative 7.5 h is a convention (recorded in the note), not an ensemble draw
    expect([by('hRef').value, by('hRef').low, by('hRef').high]).toEqual([7.0, 7.0, 7.0]);
    expect(by('hRef').draw).toBe('fixed');
    expect(by('hRef').note).toMatch(/7\.5/);
    expect(by('qualityPoorH').value).toBe(0.75);
    expect(by('shiftWorkH').value).toBe(1.0);
    expect([by('tauDfUp').value, by('tauDfDown').value, by('tauDsUp').value, by('tauDsDown').value]).toEqual([1, 2, 3, 5]);
    expect([by('debtCap').value, by('debtCapTesto').value]).toEqual([4, 5]);
    expect([by('siPerH').value, by('mpsPerH').value, by('testoPerH').value]).toEqual([0.07, 0.05, 0.05]);
    expect([by('partitionPerH').value, by('partitionPerH').low, by('partitionPerH').high]).toEqual([0.04, 0, 0.08]);
    expect([by('partitionCap').value, by('partitionDeficitRef').value]).toEqual([0.12, 0.15]);
    expect([by('caffeineTHalfH').value, by('caffeineTHalfH').low, by('caffeineTHalfH').high]).toEqual([5.4, 4, 6]);
    expect([by('caffeineOcMult').value, by('caffeineSmokerMult').value]).toEqual([1.47, 0.56]);
    expect([by('caffeineRStarMg').value, by('tstLossPerMg').value, by('tstLossCapMin').value]).toEqual([37, 0.4, 120]);
    expect([by('lutealAmp').value, by('lutealAmp').low, by('lutealAmp').high]).toEqual([0.05, 0.02, 0.09]);
    expect([by('menopauseFatDriftKgYr').value, by('menopauseLeanDriftKgYr').value]).toEqual([0.2, -0.12]);
    expect([by('alcoholPenaltyLow').value, by('alcoholPenaltyMid').value, by('alcoholPenaltyHigh').value]).toEqual([0.09, 0.24, 0.39]);
  });

  it('caffeine half-life takes the smoker (HabitProfile.smoker) and combined-OC multipliers (16 §4.2.1)', () => {
    const tHalf = (p: ReturnType<typeof person>): number => (moderatorsModule.prepare(ctxFor(p)) as { tHalf: number }).tHalf;
    expect(tHalf(person())).toBeCloseTo(5.4, 9);
    expect(tHalf(person({ habits: { smoker: true } }))).toBeCloseTo(5.4 * 0.56, 9);
    const oc = person({ body: { sex: 'female' }, cycle: { tracking: false, contraception: 'combinedOral' } });
    expect(tHalf(oc)).toBeCloseTo(5.4 * 1.47, 9);
  });

  it('every ParamDef states unit, grade, source, dossier section and status', () => {
    for (const p of MODERATORS_PARAMS) {
      expect(p.unit.length).toBeGreaterThan(0);
      expect(['A', 'B', 'C', 'D']).toContain(p.grade);
      expect(p.source.length).toBeGreaterThan(3);
      expect(p.dossier).toMatch(/^(15|16|02) /);
      expect(p.status).toBeDefined();
    }
  });
});

describe('sleep-debt state (16 §4.1.1)', () => {
  it('reproduces the worked example: 5 h × 7 nights with hRef 7.5 → dS 0.71, 1.22, 1.58, 1.84, 2.03, 2.16, 2.26', () => {
    const s = sleepSeries(7, 5, { 'moderators.hRef': 7.5 });
    const expected = [0.71, 1.22, 1.58, 1.84, 2.03, 2.16, 2.26];
    s.forEach((b, i) => expect(b.sleepDebtSlowH).toBeCloseTo(expected[i]!, 2));
  });

  it('fast debt rises with τ 1 d and the caps hold (dF ≤ 4, dS ≤ 5)', () => {
    const s = sleepSeries(40, 0, { 'moderators.hRef': 7.5 });
    expect(s[0]!.sleepDebtFastH).toBeCloseTo(4 * (1 - Math.exp(-1)), 6); // capped target 4, first night
    expect(Math.max(...s.map((b) => b.sleepDebtFastH))).toBeLessThanOrEqual(4 + 1e-12);
    expect(Math.max(...s.map((b) => b.sleepDebtSlowH))).toBeLessThanOrEqual(5 + 1e-12);
    expect(s[39]!.sleepDebtSlowH).toBeCloseTo(5, 3);
  });

  it('sleep above the reference earns no credit (no negative debt)', () => {
    const s = sleepSeries(10, 10);
    for (const b of s) {
      expect(b.sleepDebtFastH).toBe(0);
      expect(b.sleepDebtSlowH).toBe(0);
    }
  });

  it('poor quality adds 0.75 h and shift work 1.0 h of equivalent deficit (16 §4.1.9)', () => {
    const poor = sleepSeries(60, 8, {}, person(), { sleepQuality: 0 });
    expect(poor[59]!.sleepDebtSlowH).toBeCloseTo(0.75, 3);
    const both = sleepSeries(60, 8, {}, person(), { sleepQuality: 0, shiftWork: true });
    expect(both[59]!.sleepDebtSlowH).toBeCloseTo(1.75, 3);
  });

  it('a habitual short sleeper starts at steady state (no drift at maintenance)', () => {
    const p = person({ habits: { typicalSteps: 7000, sessionsPerWeek: 0, bedTimeH: 1, wakeTimeH: 6 } }); // 5 h
    const ctx = ctxFor(p);
    const d = nightDay(ctx.profile, 5);
    const days = Array.from({ length: 31 }, (_, i) => ({ clockDay: i, day: { ...d } }));
    const seen: number[] = [];
    const run = miniRun(mods, ctx, days, { beforeHour: (_c, h, bus) => { if (h === 0) seen.push(bus.sleepDebtSlowH); } });
    const s = run.S[0] as ModeratorsState;
    expect(s.sleepDebtSlowH).toBeCloseTo(2.0, 9); // hRef 7.0 − 5 h
    for (const v of seen) expect(v).toBeCloseTo(2.0, 9);
  });
});

describe('16 V4: insulin sensitivity after sleep restriction (Buxton, Depner, Broussard)', () => {
  it('siMult at night 7 of 5 h: 0.84 with hRef 7.5, inside the band 0.77-0.93 and the measured 0.80-0.89', () => {
    const s = sleepSeries(7, 5, { 'moderators.hRef': 7.5 });
    expect(s[6]!.siSleepMult).toBeCloseTo(0.84, 2);
    expect(s[6]!.siSleepMult).toBeGreaterThanOrEqual(0.8);
    expect(s[6]!.siSleepMult).toBeLessThanOrEqual(0.89);
  });

  it('at the nominal hRef 7.0 the same protocol gives −12.7 %, still inside the measured −11 to −20 %', () => {
    const s = sleepSeries(7, 5);
    expect(s[6]!.siSleepMult).toBeCloseTo(1 - 0.07 * 1.81, 2);
    expect(1 - s[6]!.siSleepMult).toBeGreaterThanOrEqual(0.11);
    expect(1 - s[6]!.siSleepMult).toBeLessThanOrEqual(0.2);
  });

  it('two recovery nights of 10 h leave ≈ 67 % of the deficit (dS 2.26 → 1.52): Si is not restored', () => {
    const ctx = ctxFor(person(), { 'moderators.hRef': 7.5 });
    const days = [
      ...Array.from({ length: 7 }, (_, d) => ({ clockDay: d, day: nightDay(ctx.profile, 5) })),
      ...Array.from({ length: 3 }, (_, d) => ({ clockDay: 7 + d, day: nightDay(ctx.profile, 10) })),
    ];
    const dS: number[] = [];
    miniRun(mods, ctx, days, { beforeHour: (_c, h, bus) => { if (h === 0) dS.push(bus.sleepDebtSlowH); } });
    // dS[7] = after night 7 (2.26), dS[9] = after two recovery nights
    expect(dS[7]).toBeCloseTo(2.26, 2);
    expect(dS[9]).toBeCloseTo(1.52, 1); // dossier rounds 2.26·e^(−0.4) = 1.514 to 1.52
    expect(dS[9]! / dS[7]!).toBeCloseTo(0.67, 2);
  });

  it('4 h × 5 nights (d ≈ 3.7) reaches up to −25 % at the top of the range', () => {
    const s = sleepSeries(5, 3.8, { 'moderators.hRef': 7.5 });
    expect(1 - s[4]!.siSleepMult).toBeGreaterThan(0.15);
    expect(1 - s[4]!.siSleepMult).toBeLessThan(0.25);
  });
});

describe('16 V5: testosterone and MPS after sleep restriction (Leproult, Saner, Lamon)', () => {
  it('testoSleepMult at night 7-8 of 5 h ≈ 0.88 (hRef 7.5)', () => {
    const s = sleepSeries(8, 5, { 'moderators.hRef': 7.5 });
    expect(s[6]!.testoSleepMult).toBeCloseTo(0.887, 2);
    expect(s[7]!.testoSleepMult).toBeCloseTo(0.8825, 2);
    for (const i of [6, 7]) {
      expect(s[i]!.testoSleepMult).toBeGreaterThanOrEqual(0.85);
      expect(s[i]!.testoSleepMult).toBeLessThanOrEqual(0.9);
    }
  });

  it('at the nominal hRef 7.0 the week of 5 h gives −9.1 % (measured −10 to −13 %): recorded effect of ruling R-SLEEP', () => {
    const s = sleepSeries(8, 5);
    expect(1 - s[6]!.testoSleepMult).toBeCloseTo(0.091, 2);
    expect(1 - s[6]!.testoSleepMult).toBeGreaterThan(0.08);
  });

  it('testosterone term applies to men only', () => {
    const f = sleepSeries(8, 5, {}, person({ body: { sex: 'female' } }));
    expect(f[7]!.testoSleepMult).toBe(1);
    const u = sleepSeries(8, 5, {}, person({ sexUnspecified: true }));
    expect(u[7]!.testoSleepMult).toBe(1);
  });

  it('mpsSleepMult 0.85 at night 5 of 4 h TIB (≈ 3.8 h actual) and 0.815 at steady state (measured −18 to −19 %)', () => {
    const s = sleepSeries(60, 3.8, { 'moderators.hRef': 7.5 });
    expect(s[4]!.mpsSleepMult).toBeCloseTo(0.85, 2);
    expect(s[59]!.mpsSleepMult).toBeCloseTo(0.815, 3);
  });

  it('total deprivation caps the effects: MPS −20 % (cap 4 h), testosterone −25 % (cap 5 h)', () => {
    const s = sleepSeries(60, 0, { 'moderators.hRef': 7.5 });
    expect(s[59]!.mpsSleepMult).toBeCloseTo(0.8, 6);
    expect(s[59]!.testoSleepMult).toBeCloseTo(0.75, 3);
    expect(s[59]!.siSleepMult).toBeCloseTo(1 - 0.07 * 4, 6);
  });
});

describe('16 V1-V2: partition shift under sleep restriction (Nedeltcheva, Wang)', () => {
  const baseP1 = 0.093; // Nedeltcheva 8.5 h arm
  const baseP2 = 0.035; // Wang CR arm

  it('V1 central: 14 nights of 5.2 h at a 32 % deficit → fat share of loss 48 % → ≈ 30 % (−18 pp ± 2)', () => {
    const s = sleepSeries(14, 5.2, { 'moderators.hRef': 7.5 }, person(), {}, -0.32);
    const shift = s[13]!.partitionSleepShift;
    expect(shift).toBeGreaterThan(0.085);
    expect(shift).toBeLessThan(0.095);
    const before = fatShareOfLoss(baseP1);
    const after = fatShareOfLoss(baseP1 + shift);
    expect(before).toBeCloseTo(0.483, 2);
    expect(after * 100).toBeGreaterThan(28);
    expect(after * 100).toBeLessThan(32);
    expect((before - after) * 100).toBeGreaterThan(16);
    expect((before - after) * 100).toBeLessThan(20);
  });

  it('V1 lower band edge (partitionPerH 0) = no effect', () => {
    const lo = sleepSeries(14, 5.2, { 'moderators.hRef': 7.5, 'moderators.partitionPerH': 0 }, person(), {}, -0.32)[13]!.partitionSleepShift;
    expect(lo).toBe(0);
    expect(fatShareOfLoss(baseP1 + lo)).toBeCloseTo(fatShareOfLoss(baseP1), 12);
  });

  it('V1 upper band edge (partitionPerH 0.08) with the spec cap 0.12: shift saturates at 0.12 → fat share 26 %', () => {
    const hi = sleepSeries(14, 5.2, { 'moderators.hRef': 7.5, 'moderators.partitionPerH': 0.08 }, person(), {}, -0.32)[13]!.partitionSleepShift;
    expect(hi).toBe(0.12);
    expect(fatShareOfLoss(baseP1 + hi) * 100).toBeCloseTo(26.2, 0);
  });

  // MISS (reported): dossier 16 §7 V1 states the upper edge k_P = 0.08 gives ≈ 21 % (−28 pp) but that arithmetic ignores
  // the +0.12 cap of 16 §4.1.3 (0.08 · 2.29 h = 0.183 > 0.12). MODEL_SPEC §1.1 step 3 keeps the fixed cap 0.12, so the band
  // edge reaches 26 %. Fix option for the integration pass: scale the cap with the drawn slope (cap = 3 h · k_P).
  it.fails('V1 upper band edge reaches the dossier value ≈ 21 % (needs a cap that scales with k_P)', () => {
    const hi = sleepSeries(14, 5.2, { 'moderators.hRef': 7.5, 'moderators.partitionPerH': 0.08 }, person(), {}, -0.32)[13]!.partitionSleepShift;
    const fs = fatShareOfLoss(baseP1 + hi) * 100;
    expect(fs).toBeGreaterThan(19);
    expect(fs).toBeLessThan(23);
  });

  it('V1 direction: the shift is zero at energy balance or surplus and only in deficit', () => {
    expect(sleepSeries(14, 5.2, {}, person(), {}, 0)[13]!.partitionSleepShift).toBe(0);
    expect(sleepSeries(14, 5.2, {}, person(), {}, +0.2)[13]!.partitionSleepShift).toBe(0);
    expect(sleepSeries(14, 5.2, {}, person(), {}, -0.3)[13]!.partitionSleepShift).toBeGreaterThan(0);
  });

  it('V2: Wang (dS ≈ 0.4) central −8 pp, upper edge −15 pp on the fat share; the lower edge contains the absolute null', () => {
    const central = sleepSeries(56, 7.1, { 'moderators.hRef': 7.5 }, person(), {}, -0.25)[55]!;
    expect(central.sleepDebtSlowH).toBeCloseTo(0.4, 2);
    const dc = (fatShareOfLoss(baseP2) - fatShareOfLoss(baseP2 + central.partitionSleepShift)) * 100;
    expect(dc).toBeGreaterThan(6);
    expect(dc).toBeLessThan(10);
    const up = sleepSeries(56, 7.1, { 'moderators.hRef': 7.5, 'moderators.partitionPerH': 0.08 }, person(), {}, -0.25)[55]!;
    const du = (fatShareOfLoss(baseP2) - fatShareOfLoss(baseP2 + up.partitionSleepShift)) * 100;
    expect(du).toBeGreaterThan(13);
    expect(du).toBeLessThan(17);
    const zero = sleepSeries(56, 7.1, { 'moderators.hRef': 7.5, 'moderators.partitionPerH': 0 }, person(), {}, -0.25)[55]!;
    expect(zero.partitionSleepShift).toBe(0);
  });

  it('partitionSleepShift equation: ramps with the deficit up to 15 % and is capped at 0.12', () => {
    expect(partitionSleepShift(2, -0.075, 0.04, 0.12, 0.15)).toBeCloseTo(0.04, 12);
    expect(partitionSleepShift(2, -0.3, 0.04, 0.12, 0.15)).toBeCloseTo(0.08, 12);
    expect(partitionSleepShift(5, -0.5, 0.04, 0.12, 0.15)).toBe(0.12);
    expect(partitionSleepShift(3, 0.1, 0.04, 0.12, 0.15)).toBe(0);
  });
});

describe('16 V11: caffeine residual, timing and sleep loss (Gardiner, Drake)', () => {
  it('cut-offs 8.8 h (107 mg) and 13.2 h (217.5 mg) leave 34 / 40 mg (t½ 5.37 h) and cost ≤ 2 min', () => {
    expect(caffeineResidualMg(107, 8.8, 5.37)).toBeCloseTo(34, 0);
    expect(caffeineResidualMg(217.5, 13.2, 5.37)).toBeCloseTo(40, 0);
    // with the registry t½ 5.4 h
    expect(tstLossMin(caffeineResidualMg(107, 8.8, 5.4), 37, 0.4, 120)).toBeLessThanOrEqual(2);
    expect(tstLossMin(caffeineResidualMg(217.5, 13.2, 5.4), 37, 0.4, 120)).toBeLessThanOrEqual(2);
  });

  it('400 mg at 6 h before bed → ≈ −59 min (± 30); 3 h → −94 min; 0 h → capped at 120 min', () => {
    const r6 = caffeineResidualMg(400, 6, 5.4);
    expect(tstLossMin(r6, 37, 0.4, 120)).toBeGreaterThan(59 - 30);
    expect(tstLossMin(r6, 37, 0.4, 120)).toBeLessThan(59 + 30);
    expect(tstLossMin(r6, 37, 0.4, 120)).toBeCloseTo(59.3, 0);
    expect(tstLossMin(caffeineResidualMg(400, 3, 5.4), 37, 0.4, 120)).toBeCloseTo(93.6, 0);
    expect(tstLossMin(400, 37, 0.4, 120)).toBe(120);
    expect(tstLossMin(30, 37, 0.4, 120)).toBe(0);
  });

  it('half-life modifiers: combined oral contraceptive ×1.47, smoker ×0.56', () => {
    expect(caffeineHalfLifeH(5.37, true, false, 1.47, 0.56)).toBeCloseTo(7.89, 2);
    expect(caffeineHalfLifeH(5.4, false, true, 1.47, 0.56)).toBeCloseTo(3.02, 2);
    expect(caffeineHalfLifeH(5.4, false, false, 1.47, 0.56)).toBe(5.4);
  });

  it('the module samples caffeineLoadMg at the planned bed hour and turns it into the sleep-quality index', () => {
    const ctx = ctxFor();
    const day = nightDay(ctx.profile, 8, { sleepBedH: 23 });
    let quality = Number.NaN;
    let atBed = Number.NaN;
    miniRun(mods, ctx, [{ clockDay: 0, day }], {
      beforeHour: (_c, h, bus) => {
        bus.caffeineLoadMg = h === 23 ? 185 : 300; // only the value at the bed hour matters
      },
      afterDay: () => {},
    }).S.forEach((st) => {
      const s = st as ModeratorsState;
      atBed = s.caffeineAtBedMg;
      quality = s.sleepQualityIdx;
    });
    expect(atBed).toBe(185);
    // TSTloss = 0.4·(185 − 37) = 59.2 min → −59.2/3 points
    expect(quality).toBeCloseTo(100 - 59.2 / 3, 6);
  });

  it('a fractional bedtime decays the sampled load by 2^(−frac/t½)', () => {
    const ctx = ctxFor();
    const day = nightDay(ctx.profile, 8, { sleepBedH: 23.5 });
    const run = miniRun(mods, ctx, [{ clockDay: 0, day }], { beforeHour: (_c, _h, bus) => { bus.caffeineLoadMg = 100; } });
    expect((run.S[0] as ModeratorsState).caffeineAtBedMg).toBeCloseTo(100 * Math.pow(2, -0.5 / 5.4), 9);
  });

  it('alcohol next-night penalty: 0.09 / 0.24 / 0.39 for ≤ 0.25 / ≤ 0.75 / > 0.75 g/kg lowers the index by 9 / 24 / 39', () => {
    expect(alcoholRecoveryPenalty(0, 0.25, 0.75, 0.09, 0.24, 0.39)).toBe(0);
    expect(alcoholRecoveryPenalty(0.2, 0.25, 0.75, 0.09, 0.24, 0.39)).toBe(0.09);
    expect(alcoholRecoveryPenalty(0.5, 0.25, 0.75, 0.09, 0.24, 0.39)).toBe(0.24);
    expect(alcoholRecoveryPenalty(1.0, 0.25, 0.75, 0.09, 0.24, 0.39)).toBe(0.39);
    const ctx = ctxFor(); // 82 kg
    const idx = (g: number): number => {
      const day = nightDay(ctx.profile, 8, { alcoholG: g });
      return (miniRun(mods, ctx, [{ clockDay: 0, day }]).S[0] as ModeratorsState).sleepQualityIdx;
    };
    expect(idx(0)).toBe(100);
    expect(idx(14)).toBeCloseTo(91, 6); // 0.17 g/kg
    expect(idx(41)).toBeCloseTo(76, 6); // 0.5 g/kg
    expect(idx(82)).toBeCloseTo(61, 6); // 1.0 g/kg
  });

  it('diet → sleep feedback into sleep hours is OFF: caffeine and alcohol never change dF / dS', () => {
    const ctx = ctxFor();
    const days = Array.from({ length: 10 }, (_, d) => ({ clockDay: d, day: nightDay(ctx.profile, 8, { alcoholG: 100 }) }));
    const run = miniRun(mods, ctx, days, { beforeHour: (_c, _h, bus) => { bus.caffeineLoadMg = 400; } });
    const s = run.S[0] as ModeratorsState;
    expect(s.sleepDebtFastH).toBe(0);
    expect(s.sleepDebtSlowH).toBe(0);
  });
});

describe('16 V12 / 02 §4.3: menstrual cycle and luteal weight', () => {
  const cyc = person({
    body: { sex: 'female', ageYears: 30, heightCm: 165, weightKg: 62 },
    cycle: { tracking: true, cycleLengthD: 28, lastPeriodStart: '2026-09-21', contraception: 'none' },
  });

  it('civil-date arithmetic is exact (no Date)', () => {
    expect(daysFromCivil(1970, 1, 1)).toBe(0);
    expect(daysFromCivil(2000, 3, 1) - daysFromCivil(2000, 2, 28)).toBe(2);
    expect(isoDayNumber('2026-10-05') - isoDayNumber('2026-09-21')).toBe(14);
    expect(isoDayNumber('not a date')).toBeNaN();
    expect(cycleDayOn(0, 14, 0, 28)).toBe(15);
    expect(cycleDayOn(0, 14, 14, 28)).toBe(1);
    expect(cycleDayOn(0, 14, -14, 28)).toBe(1);
  });

  it('lutealWeight is 1 on days 15-28 of a 28-d cycle with 2-day linear ramps and 0 in the follicular phase', () => {
    expect(lutealStartDay(28)).toBe(15);
    for (let d = 15; d <= 28; d++) expect(lutealWeightAt(d, 28, 2)).toBe(1);
    expect(lutealWeightAt(14, 28, 2)).toBeCloseTo(0.5, 12);
    expect(lutealWeightAt(1, 28, 2)).toBeCloseTo(0.5, 12);
    for (let d = 2; d <= 13; d++) expect(lutealWeightAt(d, 28, 2)).toBe(0);
    expect(lutealWeightAt(-1, 28, 2)).toBe(0);
    expect(lutealMeanWeight(28, 2)).toBeCloseTo(15 / 28, 12);
  });

  it('the module writes cycleDay and lutealWeight from lastPeriodStart (day 0 = cycle day 15)', () => {
    const ctx = ctxFor(cyc);
    const days = Array.from({ length: 29 }, (_, d) => ({ clockDay: d, day: nightDay(ctx.profile, 8) }));
    const cd: number[] = [];
    const lw: number[] = [];
    miniRun(mods, ctx, days, { beforeHour: (_c, h, bus) => { if (h === 0) { cd.push(bus.cycleDay); lw.push(bus.lutealWeight); } } });
    expect(cd[0]).toBe(15);
    expect(cd[13]).toBe(28);
    expect(cd[14]).toBe(1);
    expect(lw[0]).toBe(1);
    expect(lw[13]).toBe(1);
    expect(lw[14]).toBeCloseTo(0.5, 12);
    expect(lw[15]).toBe(0);
    expect(lw[27]).toBeCloseTo(0.5, 12); // day 14 of the next cycle
    expect(lw[28]).toBe(1);
  });

  it('burn-in days (negative clock.day) precede day 0 consistently', () => {
    const ctx = ctxFor(cyc);
    const days = Array.from({ length: 15 }, (_, i) => ({ clockDay: i - 14, day: nightDay(ctx.profile, 8) }));
    const cd: number[] = [];
    miniRun(mods, ctx, days, { beforeHour: (_c, h, bus) => { if (h === 0) cd.push(bus.cycleDay); } });
    expect(cd[0]).toBe(1); // day −14 = cycle day 1
    expect(cd[14]).toBe(15); // day 0 = cycle day 15
  });

  it('cycle effects are OFF for hormonal contraception, post-menopause, tracking off, men and unspecified sex', () => {
    const off = (p: ReturnType<typeof person>) => {
      const ctx = ctxFor(p);
      const bus = miniRun(mods, ctx, [{ clockDay: 0, day: nightDay(ctx.profile, 8) }]).bus;
      return [bus.cycleDay, bus.lutealWeight];
    };
    expect(off({ ...cyc, cycle: { ...cyc.cycle!, contraception: 'combinedOral' } })).toEqual([-1, 0]);
    expect(off({ ...cyc, cycle: { ...cyc.cycle!, contraception: 'iud' } })).toEqual([-1, 0]);
    expect(off({ ...cyc, menopause: 'post' })).toEqual([-1, 0]);
    expect(off({ ...cyc, cycle: { ...cyc.cycle!, tracking: false } })).toEqual([-1, 0]);
    expect(off({ ...cyc, cycle: { tracking: true } })).toEqual([-1, 0]); // no last-period date
    expect(off({ ...cyc, sexUnspecified: true })).toEqual([-1, 0]);
    expect(off({ ...cyc, body: { ...cyc.body, sex: 'male' } })).toEqual([-1, 0]);
  });

  it('luteal RMR +5 % ± 4 (02 §4.3 data 5-9 %): lutealAmp at its nominal value and its registry range', () => {
    const amp = MODERATORS_PARAMS.find((p) => p.id === 'moderators.lutealAmp')!;
    expect(1 + amp.value * lutealWeightAt(20, 28, 2)).toBeCloseTo(1.05, 12);
    expect(Math.abs(amp.value * 100 - 5)).toBeLessThanOrEqual(4);
    for (const dataPct of [6.1, 5, 9]) {
      expect(dataPct / 100).toBeGreaterThanOrEqual(amp.low);
      expect(dataPct / 100).toBeLessThanOrEqual(amp.high);
    }
  });

  it('a 32-d cycle moves the luteal phase (days 17-32)', () => {
    expect(lutealStartDay(32)).toBe(17);
    expect(lutealWeightAt(16, 32, 2)).toBeCloseTo(0.5, 12);
    expect(lutealWeightAt(17, 32, 2)).toBe(1);
  });
});

describe('age, stress and menopause', () => {
  it('ageYears = profile age + clock.day/365.25 (exactly the profile age on day 0)', () => {
    const ctx = ctxFor(person({ body: { ageYears: 41 } }));
    const ages: number[] = [];
    const days = Array.from({ length: 31 }, (_, d) => ({ clockDay: d - 14, day: nightDay(ctx.profile, 8) }));
    miniRun(mods, ctx, days, { beforeHour: (_c, h, bus) => { if (h === 0) ages.push(bus.ageYears); } });
    expect(ages[14]).toBe(41);
    expect(ages[30]! - ages[14]!).toBeCloseTo(16 / 365.25, 12);
    expect(ages[0]!).toBeLessThan(41);
  });

  it('stressLevel follows the day input', () => {
    const ctx = ctxFor();
    const bus = miniRun(mods, ctx, [{ clockDay: 0, day: nightDay(ctx.profile, 8, { stress: 2 }) }], {
      beforeHour: () => {},
    }).bus;
    expect(bus.stressLevel).toBe(2);
  });

  it('peri-menopausal women carry the transition drift on the state (+0.20 fat, −0.12 lean kg/yr); others 0', () => {
    const peri = makeCtx(mods, person({ body: { sex: 'female', ageYears: 51 }, menopause: 'peri' }));
    const st = miniRun(mods, peri, [{ clockDay: 0, day: nightDay(peri.profile, 8) }]).S[0] as ModeratorsState;
    expect([st.menopauseFatDriftKgYr, st.menopauseLeanDriftKgYr]).toEqual([0.2, -0.12]);
    const pre = makeCtx(mods, person({ body: { sex: 'female', ageYears: 30 }, menopause: 'pre' }));
    const sp = miniRun(mods, pre, [{ clockDay: 0, day: nightDay(pre.profile, 8) }]).S[0] as ModeratorsState;
    expect([sp.menopauseFatDriftKgYr, sp.menopauseLeanDriftKgYr]).toEqual([0, 0]);
  });
});

describe('initial state and wiring', () => {
  it('the default habitual day (8 h, good quality) starts with no debt and unit multipliers', () => {
    const ctx = ctxFor();
    const run = miniRun(mods, ctx, []);
    expect(run.bus.sleepDebtFastH).toBe(0);
    expect(run.bus.sleepDebtSlowH).toBe(0);
    expect(run.bus.siSleepMult).toBe(1);
    expect(run.bus.mpsSleepMult).toBe(1);
    expect(run.bus.testoSleepMult).toBe(1);
    expect(run.bus.partitionSleepShift).toBe(0);
    expect(run.bus.cycleDay).toBe(-1);
    expect(run.bus.lutealWeight).toBe(0);
    expect(run.bus.ageYears).toBe(35);
    expect(Number.isFinite((run.S[0] as ModeratorsState).sleepQualityIdx)).toBe(true);
  });

  it('writes exactly the declared signals and reads only declared ones', () => {
    expect(moderatorsModule.writes).toEqual(
      expect.arrayContaining(['sleepDebtFastH', 'sleepDebtSlowH', 'siSleepMult', 'mpsSleepMult', 'testoSleepMult', 'partitionSleepShift', 'lutealWeight', 'cycleDay', 'stressLevel', 'ageYears']),
    );
    expect(moderatorsModule.reads).toEqual(['caffeineLoadMg', 'energyBalanceFrac']);
    expect(moderatorsModule.records).toEqual(['sleepQuality']);
  });

  it('records the sleep-quality index in recordDay', () => {
    const ctx = ctxFor();
    const run = miniRun(mods, ctx, [{ clockDay: 0, day: nightDay(ctx.profile, 8) }]);
    const frame = new Float64Array(N_SERIES);
    moderatorsModule.recordDay(run.S[0] as ModeratorsState, run.K[0] as never, run.bus, frame);
    expect(frame[MI.sleepQuality]).toBe(100);
  });
});

describe('property tests', () => {
  it('multipliers stay inside their physical bounds for any sleep pattern', () => {
    const ctx = ctxFor();
    const pattern = [0, 3, 5, 6.5, 7, 8, 10, 12, 4, 9, 2, 8];
    const days = Array.from({ length: 120 }, (_, d) => ({ clockDay: d, day: nightDay(ctx.profile, pattern[d % pattern.length]!, { sleepQuality: d % 5 === 0 ? 0 : 2, shiftWork: d % 7 === 0 }) }));
    miniRun(mods, ctx, days, {
      beforeDay: (d, bus) => {
        bus.energyBalanceFrac = ((d * 37) % 200) / 100 - 1;
      },
      beforeHour: (_c, h, bus) => {
        if (h !== 0) return;
        expect(bus.sleepDebtFastH).toBeGreaterThanOrEqual(0);
        expect(bus.sleepDebtFastH).toBeLessThanOrEqual(4);
        expect(bus.sleepDebtSlowH).toBeGreaterThanOrEqual(0);
        expect(bus.sleepDebtSlowH).toBeLessThanOrEqual(5);
        expect(bus.siSleepMult).toBeGreaterThanOrEqual(0.72 - 1e-12);
        expect(bus.siSleepMult).toBeLessThanOrEqual(1);
        expect(bus.mpsSleepMult).toBeGreaterThanOrEqual(0.8 - 1e-12);
        expect(bus.mpsSleepMult).toBeLessThanOrEqual(1);
        expect(bus.testoSleepMult).toBeGreaterThanOrEqual(0.75 - 1e-12);
        expect(bus.testoSleepMult).toBeLessThanOrEqual(1);
        expect(bus.partitionSleepShift).toBeGreaterThanOrEqual(0);
        expect(bus.partitionSleepShift).toBeLessThanOrEqual(0.12);
      },
    });
  });

  it('monotone: less sleep never raises a multiplier or lowers the debt', () => {
    let prev: SignalBus | undefined;
    for (const h of [9, 8, 7, 6.5, 6, 5, 4, 3, 2, 1, 0]) {
      const b = sleepSeries(21, h, {}, person(), {}, -0.3)[20]!;
      if (prev) {
        expect(b.sleepDebtSlowH).toBeGreaterThanOrEqual(prev.sleepDebtSlowH - 1e-12);
        expect(b.sleepDebtFastH).toBeGreaterThanOrEqual(prev.sleepDebtFastH - 1e-12);
        expect(b.siSleepMult).toBeLessThanOrEqual(prev.siSleepMult + 1e-12);
        expect(b.mpsSleepMult).toBeLessThanOrEqual(prev.mpsSleepMult + 1e-12);
        expect(b.testoSleepMult).toBeLessThanOrEqual(prev.testoSleepMult + 1e-12);
        expect(b.partitionSleepShift).toBeGreaterThanOrEqual(prev.partitionSleepShift - 1e-12);
      }
      prev = b;
    }
  });

  it('steady state: 30 habitual days keep every output constant', () => {
    const ctx = ctxFor();
    const day = nightDay(ctx.profile, 8);
    const days = Array.from({ length: 30 }, (_, d) => ({ clockDay: d, day: { ...day } }));
    const first: number[] = [];
    let last: number[] = [];
    miniRun(mods, ctx, days, {
      beforeHour: (d, h, bus) => {
        if (h !== 0) return;
        const v = [bus.sleepDebtFastH, bus.sleepDebtSlowH, bus.siSleepMult, bus.mpsSleepMult, bus.testoSleepMult, bus.partitionSleepShift];
        if (d === 0) first.push(...v);
        last = v;
      },
    });
    expect(last).toEqual(first);
  });

  it('extreme inputs (no sleep, poor quality, shift work, huge caffeine and alcohol) stay finite for 21 days', () => {
    const ctx = ctxFor();
    const days = Array.from({ length: 21 }, (_, d) => ({
      clockDay: d,
      day: nightDay(ctx.profile, 0, { sleepQuality: 0, shiftWork: true, alcoholG: 400, stress: 2 }),
    }));
    const run = miniRun(mods, ctx, days, { beforeHour: (_c, _h, bus) => { bus.caffeineLoadMg = 5000; bus.energyBalanceFrac = -1; } });
    const s = run.S[0] as ModeratorsState;
    for (const v of Object.values(s)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
    for (const v of Object.values(run.bus)) expect(Number.isFinite(v)).toBe(true);
    expect(s.sleepQualityIdx).toBeGreaterThanOrEqual(0);
    expect(s.sleepQualityIdx).toBeLessThanOrEqual(100);
  });

  it('state is a plain structure: structuredClone snapshots round-trip', () => {
    const ctx = ctxFor();
    const run = miniRun(mods, ctx, [{ clockDay: 0, day: nightDay(ctx.profile, 6) }]);
    const s = run.S[0] as ModeratorsState;
    expect(structuredClone(s)).toEqual(s);
  });
});

describe('performance', () => {
  it('a 180-day run of the module stays within the 0.5 ms budget (best of 15 runs)', () => {
    const ctx = ctxFor();
    const k = moderatorsModule.prepare(ctx);
    const day = nightDay(ctx.profile, 6.5);
    const clock = { day: 0, hourOfDay: 0, hourIndex: 0, weekday: 0 };
    const hour = { hourOfDay: 0 } as never;
    const frame = new Float64Array(N_SERIES);
    const times: number[] = [];
    for (let rep = 0; rep < 15; rep++) {
      const bus = miniRun(mods, ctx, []).bus;
      const s = moderatorsModule.init(k, ctx, bus);
      const t0 = performance.now();
      for (let d = 0; d < 180; d++) {
        clock.day = d;
        moderatorsModule.startDay(s, k, bus, day, clock);
        for (let h = 0; h < 24; h++) {
          clock.hourOfDay = h;
          moderatorsModule.stepHour(s, k, bus, hour, day, clock);
        }
        moderatorsModule.endOfDay(s, k, bus, day, clock);
        moderatorsModule.recordDay(s, k, bus, frame);
      }
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    console.info(`moderators: 180-day run best ${times[0]!.toFixed(3)} ms, median ${times[7]!.toFixed(3)} ms (15 runs)`);
    expect(times[0]!).toBeLessThan(0.5); // budget 0.5 ms; measured ≈ 0.09-0.18 ms even under CPU contention
  });
});
