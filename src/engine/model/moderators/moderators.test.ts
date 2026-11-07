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
import { SIGNAL_DEFS, SIGNAL_META, type SignalBus } from '../../types/signals';
import { MI, N_SERIES } from '../../types/metrics';
import { MODULE_ORDER } from '../../core/moduleRegistry';
import { wellbeingModule } from '../wellbeing';
import {
  CYCLE_PHASE,
  alcoholRecoveryPenalty,
  caffeineHalfLifeH,
  caffeineResidualMg,
  cycleDayOn,
  daysFromCivil,
  isoDayNumber,
  lutealMeanWeight,
  lutealStartDay,
  lutealWeightAt,
  lutealWeightFrom,
  mapEpisodesToWakeDates,
  medianCycleLength,
  moderatorsModule,
  observedEpisodeHours,
  partitionSleepShift,
  resolveCycleTiming,
  resolveInstant,
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
    expect(off({ ...cyc, cycle: { ...cyc.cycle!, menstruating: 'no' } })).toEqual([-1, 0]);
    // D8-07: a tracked cycle without a period date asserts no phase: no cycle day, the phase-AVERAGE luteal weight (zero
    // centred deviation for energy/appetite; cycle water off) instead of a static follicular 0
    expect(off({ ...cyc, cycle: { tracking: true } })).toEqual([-1, lutealMeanWeight(28, 2)]);
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

// ------------------------------------------------------------------------------------------------------------ D8-06
describe('D8-06 sleep date contract: observed episodes map to the wake date, planned nights keep the starting date', () => {
  /** dS / dF read after startDay of each day (hour 0), for a run of the given days. */
  function debts(days: DayInput[], p = person(), ov: Record<string, number> = {}, ctxPatch?: (c: ReturnType<typeof ctxFor>) => ReturnType<typeof ctxFor>) {
    const base = ctxFor(p, ov);
    const ctx = ctxPatch ? ctxPatch(base) : base;
    const dS: number[] = [];
    const dF: number[] = [];
    const run = miniRun(mods, ctx, days.map((day, i) => ({ clockDay: i, day })), {
      beforeHour: (_c, h, bus) => {
        if (h === 0) {
          dS.push(bus.sleepDebtSlowH);
          dF.push(bus.sleepDebtFastH);
        }
      },
    });
    return { dS, dF, s: run.S[0] as ModeratorsState };
  }
  const observed = (profile: ReturnType<typeof ctxFor>['profile'], hours: number, patch: Partial<DayInput> = {}): DayInput =>
    nightDay(profile, 8, { sleepSource: 'observed', sleepEndingToday: { bedClockH: 7 - hours - 24, wakeClockH: 7, hours }, ...patch });

  it('a short observed night ending Tuesday changes Tuesday\'s multipliers, not Wednesday\'s (no off-by-one, no double count)', () => {
    const ctx = ctxFor();
    const mon = nightDay(ctx.profile, 8);
    const tue = observed(ctx.profile, 4); // ended Tuesday morning
    const wed = nightDay(ctx.profile, 8);
    const r = debts([mon, tue, wed, nightDay(ctx.profile, 8)]);
    expect(r.dF[0]).toBe(0);
    expect(r.dF[1]).toBeCloseTo(3 * (1 - Math.exp(-1)), 9); // Tuesday: d = 7 − 4 = 3 h, τ 1 d rise
    // Wednesday relaxes from Tuesday's value toward the planned 8 h night (no second application of the 4 h episode)
    expect(r.dF[2]).toBeCloseTo(r.dF[1]! * Math.exp(-1 / 2), 9);
    expect(r.s.lastNightObserved).toBe(0);
  });

  it('a future PLANNED short Tuesday night affects Wednesday (starting-date convention)', () => {
    const ctx = ctxFor();
    const r = debts([nightDay(ctx.profile, 8), nightDay(ctx.profile, 4), nightDay(ctx.profile, 8)]);
    expect(r.dF[1]).toBe(0); // Tuesday morning: Monday's 8 h night
    expect(r.dF[2]).toBeCloseTo(3 * (1 - Math.exp(-1)), 9); // Wednesday morning: the planned Tuesday night
  });

  it('day 0 is initialised from the last observed episode before day 0 (schedule.initialSleep)', () => {
    const ctx = ctxFor();
    const days = [nightDay(ctx.profile, 8), nightDay(ctx.profile, 8)];
    const plain = debts(days);
    const init = debts(days, person(), {}, (c) => ({ ...c, schedule: { ...c.schedule, initialSleep: { bedClockH: 3, sleepHours: 4.5 } } }));
    expect(plain.dF[0]).toBe(0);
    expect(init.dF[0]).toBeCloseTo(2.5 * (1 - Math.exp(-1)), 9);
    // an observed episode ending on day 0 itself takes precedence over initialSleep
    const both = debts([observed(ctx.profile, 6), nightDay(ctx.profile, 8)], person(), {}, (c) => ({ ...c, schedule: { ...c.schedule, initialSleep: { bedClockH: 3, sleepHours: 4.5 } } }));
    expect(both.dF[0]).toBeCloseTo(1 * (1 - Math.exp(-1)), 9);
  });

  it('observed duration is used exactly: caffeine and alcohol heuristics never decrement it again', () => {
    const ctx = ctxFor();
    const days = [nightDay(ctx.profile, 8, { alcoholG: 120 }), observed(ctx.profile, 7, { alcoholG: 120 }), nightDay(ctx.profile, 8)];
    let lastNight = Number.NaN;
    let tst = Number.NaN;
    let pen = Number.NaN;
    miniRun(mods, ctx, days.map((day, i) => ({ clockDay: i, day })), {
      beforeHour: (_c, _h, bus) => {
        bus.caffeineLoadMg = 400; // a large bedtime residual every night
      },
      afterHour: (c, h) => {
        void c;
        void h;
      },
      afterInit: () => {},
      afterDay: () => {},
    }).S.forEach((st) => {
      const s = st as ModeratorsState;
      lastNight = s.lastNightSleepH;
      tst = s.caffeineTstRiskMin;
      pen = s.alcoholRecoveryPen;
    });
    expect(tst).toBe(120); // capped heuristic risk, stored apart
    expect(pen).toBe(0); // last day had no alcohol
    expect(lastNight).toBe(8); // tomorrow's carried planned night, untouched by the heuristic
    const r = debts(days);
    expect(r.dF[1]).toBe(0); // the observed 7 h night (= hRef) gives no deficit despite caffeine and alcohol
  });

  it('an observed episode\'s entered quality counts; an unknown quality is not poor', () => {
    const ctx = ctxFor();
    const unknownQ = debts([nightDay(ctx.profile, 8), observed(ctx.profile, 8)]);
    expect(unknownQ.dF[1]).toBe(0);
    const poorEp = nightDay(ctx.profile, 8, { sleepSource: 'observed', sleepEndingToday: { bedClockH: -1, wakeClockH: 7, hours: 8, quality: 0 } as DayInput['sleepEndingToday'] });
    const poor = debts([nightDay(ctx.profile, 8), poorEp]);
    expect(poor.dF[1]).toBeCloseTo(0.75 * (1 - Math.exp(-1)), 9);
  });

  it('planned/habitual days ignore a compiler-set sleepEndingToday (it is the same carried night)', () => {
    const ctx = ctxFor();
    const d = nightDay(ctx.profile, 5, { sleepSource: 'planned', sleepEndingToday: { bedClockH: -1, wakeClockH: 7, hours: 8 } });
    const r = debts([d, d, d]);
    expect(r.dF[1]).toBeCloseTo(2 * (1 - Math.exp(-1)), 9); // the planned 5 h night of day 0 reaches day 1
  });

  it('snapshot replay of the carried sleep state equals the uninterrupted mapping', () => {
    const ctx = ctxFor();
    const days = [nightDay(ctx.profile, 6), observed(ctx.profile, 4), nightDay(ctx.profile, 5), observed(ctx.profile, 9), nightDay(ctx.profile, 8)];
    const full = debts(days);
    const k = moderatorsModule.prepare(ctx);
    const head = miniRun(mods, ctx, days.slice(0, 2).map((day, i) => ({ clockDay: i, day })));
    const snap = structuredClone(head.S[0] as ModeratorsState);
    const bus = head.bus;
    const dS: number[] = [];
    const clock = { day: 0, hourOfDay: 0, hourIndex: 0, weekday: 0 };
    for (let i = 2; i < days.length; i++) {
      clock.day = i;
      moderatorsModule.startDay(snap, k, bus, days[i]!, clock);
      dS.push(bus.sleepDebtSlowH);
      moderatorsModule.endOfDay(snap, k, bus, days[i]!, clock);
    }
    expect(dS).toEqual(full.dS.slice(2));
  });

  it('a bedtime after midnight (clock ≥ 24) samples the 23:00 load decayed to the bedtime', () => {
    const ctx = ctxFor();
    const day = nightDay(ctx.profile, 6, { sleepBedH: 25 });
    const run = miniRun(mods, ctx, [{ clockDay: 0, day }], { beforeHour: (_c, h, bus) => { bus.caffeineLoadMg = h === 23 ? 200 : 999; } });
    expect((run.S[0] as ModeratorsState).caffeineAtBedMg).toBeCloseTo(200 * Math.pow(2, -2 / 5.4), 9);
  });
});

describe('D8-06 observed episode instants → wake dates (timezone, DST, midnight, shift work, naps, overlaps)', () => {
  it('durations come from absolute instants: midnight crossing, DST spring-forward and fall-back', () => {
    expect(observedEpisodeHours({ bedAt: '2026-10-12T23:15:00+02:00', wakeAt: '2026-10-13T06:30:00+02:00' })).toBeCloseTo(7.25, 12);
    // Europe/London 2026-03-29: clocks go 01:00 → 02:00; 00:30 GMT to 07:30 BST is 6 h, not 7
    expect(observedEpisodeHours({ bedAt: '2026-03-29T00:30:00+00:00', wakeAt: '2026-03-29T07:30:00+01:00' })).toBeCloseTo(6, 12);
    // 2026-10-25 fall-back: 00:30 BST to 07:30 GMT is 8 h
    expect(observedEpisodeHours({ bedAt: '2026-10-25T00:30:00+01:00', wakeAt: '2026-10-25T07:30:00+00:00' })).toBeCloseTo(8, 12);
    // UTC instants resolved in a named zone keep the absolute duration and the local wake date
    const r = resolveInstant('2026-10-12T22:30:00Z', 'Asia/Kolkata');
    expect(r?.localDate).toBe('2026-10-13');
    expect(r?.localClockH).toBeCloseTo(4, 9);
    expect(observedEpisodeHours({ bedAt: '2026-10-12T17:00:00Z', wakeAt: '2026-10-13T00:30:00Z', tz: 'Asia/Kolkata' })).toBeCloseTo(7.5, 12);
    // reported awake minutes are subtracted, floating times without an offset are not guessed
    expect(observedEpisodeHours({ bedAt: '2026-10-12T23:00:00+02:00', wakeAt: '2026-10-13T07:00:00+02:00', awakeMin: 45 })).toBeCloseTo(7.25, 12);
    expect(observedEpisodeHours({ bedAt: '2026-10-12T23:00:00', wakeAt: '2026-10-13T07:00:00' })).toBeNull();
  });

  it('an episode belongs to its local WAKE date: a night ending Tuesday and a daytime shift-work sleep', () => {
    const m = mapEpisodesToWakeDates([
      { bedAt: '2026-10-12T23:30:00+02:00', wakeAt: '2026-10-13T03:30:00+02:00', quality: 'poor', eventId: 'n1' }, // Mon→Tue
      { bedAt: '2026-10-14T08:00:00+02:00', wakeAt: '2026-10-14T15:00:00+02:00', eventId: 's1' }, // daytime sleep Wed
    ]);
    expect(m.byWakeDate.map((d) => [d.wakeDate, d.hours])).toEqual([
      ['2026-10-13', 4],
      ['2026-10-14', 7],
    ]);
    expect(m.byWakeDate[0]!.quality).toBe('poor');
    expect(m.byWakeDate[1]!.quality).toBeUndefined(); // only when actually entered
    expect(m.byWakeDate[1]!.bedClockH).toBe(8);
  });

  it('naps add to the day\'s duration but not to the main timing; overlapping duplicates are merged, never double-counted', () => {
    const m = mapEpisodesToWakeDates([
      { bedAt: '2026-10-12T23:00:00+02:00', wakeAt: '2026-10-13T06:00:00+02:00', eventId: 'a' },
      { bedAt: '2026-10-12T23:30:00+02:00', wakeAt: '2026-10-13T06:30:00+02:00', eventId: 'dup' }, // overlapping duplicate
      { bedAt: '2026-10-13T14:00:00+02:00', wakeAt: '2026-10-13T14:45:00+02:00', kind: 'nap', eventId: 'nap' },
      { bedAt: 'garbage', wakeAt: '2026-10-13T07:00:00+02:00' },
    ]);
    const tue = m.byWakeDate[0]!;
    expect(tue.mainHours).toBeCloseTo(7.5, 12); // 23:00-06:30 union
    expect(tue.napHours).toBeCloseTo(0.75, 12);
    expect(tue.hours).toBeCloseTo(8.25, 12);
    expect(tue.wakeClockH).toBeCloseTo(6.5, 12);
    expect(tue.eventIds.sort()).toEqual(['a', 'dup', 'nap']);
    expect(m.invalid).toHaveLength(1);
  });
});

// ------------------------------------------------------------------------------------------------------------ D8-07
describe('D8-07 cycle phase: estimated, observed period starts, confirmed ovulation, unknown phase averaged', () => {
  const woman = (cycle: NonNullable<ReturnType<typeof person>['cycle']>) => person({ body: { sex: 'female', ageYears: 30, heightCm: 165, weightKg: 62 }, cycle });
  function series(p: ReturnType<typeof person>, n: number) {
    const ctx = ctxFor(p);
    const cd: number[] = [];
    const lw: number[] = [];
    const src: number[] = [];
    const run = miniRun(mods, ctx, Array.from({ length: n }, (_, d) => ({ clockDay: d, day: nightDay(ctx.profile, 8) })), {
      beforeHour: (_c, h, bus) => {
        if (h === 0) {
          cd.push(bus.cycleDay);
          lw.push(bus.lutealWeight);
        }
      },
      afterDay: () => {},
    });
    void run;
    // provenance per day from a second pass (state is per-run)
    const k = moderatorsModule.prepare(ctx);
    const bus = miniRun(mods, ctx, []).bus;
    const s = moderatorsModule.init(k, ctx, bus);
    const clock = { day: 0, hourOfDay: 0, hourIndex: 0, weekday: 0 };
    for (let d = 0; d < n; d++) {
      clock.day = d;
      moderatorsModule.startDay(s, k, bus, nightDay(ctx.profile, 8), clock);
      src.push(s.cyclePhaseSource);
    }
    return { cd, lw, src };
  }

  it('irregular or unknown regularity asserts no phase: cycle day −1, constant phase-average weight (zero centred deviation)', () => {
    for (const regularity of ['irregular', 'unknown'] as const) {
      const r = series(woman({ tracking: true, lastPeriodStart: '2026-09-21', cycleLengthD: 28, regularity }), 40);
      expect(new Set(r.cd)).toEqual(new Set([-1]));
      const mean = lutealMeanWeight(28, 2);
      for (const w of r.lw) expect(w).toBeCloseTo(mean, 12);
      // energy/appetite centre on the running cycle mean: a constant has zero deviation, so no static follicular bias
      const avg = r.lw.reduce((a, b) => a + b, 0) / r.lw.length;
      for (const w of r.lw) expect(w - avg).toBeCloseTo(0, 12);
      expect(new Set(r.src)).toEqual(new Set([CYCLE_PHASE.phaseAverage]));
    }
  });

  it('a calendar phase is labelled an estimate, never an observed luteal phase', () => {
    const r = series(woman({ tracking: true, lastPeriodStart: '2026-09-21', cycleLengthD: 28 }), 3);
    expect(r.cd[0]).toBe(15);
    expect(new Set(r.src)).toEqual(new Set([CYCLE_PHASE.calendarEstimate]));
    expect(SIGNAL_META.lutealWeight?.provenance).toBe('assumed');
    expect(SIGNAL_META.cycleDay?.note).toMatch(/estimated/i);
  });

  it('variable history: the median observed interval sets the typical length (duplicates within 15 d ignored)', () => {
    const iso = (s: string) => isoDayNumber(s);
    expect(medianCycleLength([iso('2026-06-01'), iso('2026-07-01'), iso('2026-07-03'), iso('2026-07-27'), iso('2026-08-29')], 15)).toBe(30); // 30, 26, 33
    const r = series(woman({ tracking: true, periodStarts: ['2026-07-27', '2026-06-01', '2026-07-01', '2026-08-29'] }), 1);
    // last start 2026-08-29, day 0 = 2026-10-05: 37 d later, cycle length 30 → cycle day 8
    expect(r.cd[0]).toBe(8);
  });

  it('an updated (newly observed) period start re-anchors future phase without rewriting observations', () => {
    const cycle = { tracking: true, cycleLengthD: 28, lastPeriodStart: '2026-09-21', periodStarts: ['2026-09-21', '2026-10-09'] } as const;
    const p = woman({ ...cycle, periodStarts: [...cycle.periodStarts] });
    const r = series(p, 10);
    expect(r.cd.slice(0, 4)).toEqual([15, 16, 17, 18]); // up to 2026-10-08
    expect(r.cd[4]).toBe(1); // 2026-10-09: the observed start (a short 18-d cycle), not the calendar day 19
    expect(r.cd[9]).toBe(6);
    expect(p.cycle!.periodStarts).toEqual(['2026-09-21', '2026-10-09']); // inputs untouched
    const without = series(woman({ tracking: true, cycleLengthD: 28, lastPeriodStart: '2026-09-21' }), 10);
    expect(without.cd[4]).toBe(19);
  });

  it('a manually confirmed ovulation (LH test/clinician) anchors the luteal start; "other" methods and weight never do', () => {
    // last start 2026-09-21 (day 0 = cycle day 15); LH-confirmed ovulation on cycle day 18 (2026-10-08) → luteal from day 19
    const lh = series(woman({ tracking: true, cycleLengthD: 30, lastPeriodStart: '2026-09-21', ovulation: [{ date: '2026-10-08', method: 'lhTest' }] }), 6);
    expect(lh.lw[0]).toBeCloseTo(lutealWeightFrom(15, 19, 2), 12); // 0 (4 days before the anchored luteal start)
    expect(lh.lw[4]).toBe(1); // cycle day 19
    expect(lh.src[0]).toBe(CYCLE_PHASE.ovulationAnchored);
    const other = series(woman({ tracking: true, cycleLengthD: 30, lastPeriodStart: '2026-09-21', ovulation: [{ date: '2026-10-08', method: 'other' }] }), 1);
    expect(other.lw[0]).toBe(lutealWeightAt(15, 30, 2));
    expect(other.src[0]).toBe(CYCLE_PHASE.calendarEstimate);
  });

  it('resolveCycleTiming exposes the mode and cycle length moderators uses, for centring consumers (energy, appetite)', () => {
    const at = (cycle: Parameters<typeof woman>[0]) => resolveCycleTiming(ctxFor(woman(cycle)).profile, '2026-10-05', 28);
    const hist = at({ tracking: true, periodStarts: ['2026-07-27', '2026-06-01', '2026-07-01', '2026-08-29'] });
    expect(hist).toMatchObject({ mode: 1, cycleLen: 30 }); // median observed history, not the 28-d default
    expect(Array.from(hist.periodStarts)).toEqual(['2026-06-01', '2026-07-01', '2026-07-27', '2026-08-29'].map(isoDayNumber));
    expect(at({ tracking: true, cycleLengthD: 32, lastPeriodStart: '2026-09-21' })).toMatchObject({ mode: 1, cycleLen: 32 });
    expect(at({ tracking: true }).mode).toBe(2); // tracked, no observed start: phase average
    expect(at({ tracking: true, lastPeriodStart: '2026-09-21', regularity: 'irregular' }).mode).toBe(2);
    expect(at({ tracking: true, lastPeriodStart: '2026-09-21', menstruating: 'no' }).mode).toBe(0);
    expect(at({ tracking: true, lastPeriodStart: '2026-09-21', contraception: 'combinedOral' }).mode).toBe(0);
    expect(at({ tracking: false, lastPeriodStart: '2026-09-21' }).mode).toBe(0);
    const lh = at({ tracking: true, lastPeriodStart: '2026-09-21', ovulation: [{ date: '2026-10-08', method: 'lhTest' }, { date: '2026-10-07', method: 'other' }] });
    expect(Array.from(lh.ovulationDays)).toEqual([isoDayNumber('2026-10-08')]);
    // the module's emitted cycle follows the same resolution (median 30 d → day 0 = cycle day 8, see above)
    const k = moderatorsModule.prepare(ctxFor(woman({ tracking: true, periodStarts: ['2026-07-27', '2026-06-01', '2026-07-01', '2026-08-29'] })));
    expect(k.cycleLen).toBe(hist.cycleLen);
    expect(k.cycleMode).toBe(hist.mode);
  });

  it('inactive menopause drift and stress are not presented as active physiology', () => {
    for (const id of ['moderators.menopauseFatDriftKgYr', 'moderators.menopauseLeanDriftKgYr']) {
      const p = MODERATORS_PARAMS.find((x) => x.id === id)!;
      expect(p.note).toMatch(/INACTIVE/);
      expect(p.label).toMatch(/inactive/);
      expect(p.distribution?.basis).toMatch(/INACTIVE/);
    }
    // no bus signal carries the drift (no exogenous mass flux) and nobody reads stress
    expect(SIGNAL_DEFS.some((d) => /menopause|drift/i.test(d.name))).toBe(false);
    expect(SIGNAL_DEFS.find((d) => d.name === 'stressLevel')!.readers).toEqual([]);
    expect(SIGNAL_META.stressLevel?.provenance).toBe('informational');
  });

  it('proposed per-hour sleep curves carry scenario metadata with a zero-effect alternative not excluded', () => {
    for (const n of ['siPerH', 'mpsPerH', 'testoPerH', 'partitionPerH', 'qualityPoorH', 'shiftWorkH']) {
      const p = MODERATORS_PARAMS.find((x) => x.id === `moderators.${n}`)!;
      expect(p.distribution?.uncertaintyKind).toBe('scenario');
      expect(p.distribution?.basis).toMatch(/zero-effect/);
    }
    expect(validateParamDefs(mods)).toEqual([]);
  });

  it('the zero-effect structural alternative keeps the debt and logged sleep but removes every per-hour slope (D8-06)', () => {
    const legacy = sleepSeries(7, 5);
    const zero = sleepSeries(7, 5, { 'moderators.sleepDebtEffectStructure': 0 }, person(), {}, -0.3);
    expect(zero[6]!.sleepDebtSlowH).toBeCloseTo(legacy[6]!.sleepDebtSlowH, 12);
    expect(zero[6]!.sleepDebtSlowH).toBeGreaterThan(1);
    expect(legacy[6]!.siSleepMult).toBeLessThan(1);
    for (const b of zero) {
      expect(b.siSleepMult).toBe(1);
      expect(b.mpsSleepMult).toBe(1);
      expect(b.testoSleepMult).toBe(1);
      expect(b.partitionSleepShift).toBe(0);
    }
    expect(MODERATORS_PARAMS.find((x) => x.id === 'moderators.sleepDebtEffectStructure')).toMatchObject({ value: 1, draw: 'fixed' });
  });
});

describe('D8-07 hook-aware signal timing', () => {
  it('declares the hourly caffeine lag (unchanged) and yesterday\'s energy balance', () => {
    const hooks = moderatorsModule.signalHooks!;
    expect(hooks).toContainEqual({ signal: 'caffeineLoadMg', access: 'read', hook: 'stepHour', lag: 1 });
    expect(hooks).toContainEqual({ signal: 'energyBalanceFrac', access: 'read', hook: 'startDay', lag: 1 });
    for (const w of moderatorsModule.writes) expect(hooks).toContainEqual({ signal: w, access: 'write', hook: 'startDay' });
    // every declared read/write is a declared module read/write
    for (const h of hooks) expect(h.access === 'read' ? moderatorsModule.reads : moderatorsModule.writes).toContain(h.signal);
  });

  it('daily activity EEE reaches wellbeing the same endOfDay; strengthEaMult reaches the earlier muscle module the next day', () => {
    const order = (id: string) => MODULE_ORDER.indexOf(id as never);
    const hooks = wellbeingModule.signalHooks!;
    expect(hooks).toContainEqual({ signal: 'exSessionNetKcalD', access: 'read', hook: 'endOfDay', lag: 0 });
    expect(order('activity')).toBeLessThan(order('wellbeing')); // written earlier in the same endOfDay pass
    expect(SIGNAL_META.exSessionNetKcalD?.reads).toEqual([{ module: 'wellbeing', hook: 'endOfDay', lag: 0 }]);
    expect(hooks).toContainEqual({ signal: 'strengthEaMult', access: 'write', hook: 'endOfDay' });
    expect(order('muscle')).toBeLessThan(order('wellbeing')); // muscle's endOfDay ran before the write → previous day's value
    expect(SIGNAL_META.strengthEaMult?.reads).toEqual([{ module: 'muscle', hook: 'endOfDay', lag: 1 }]);
    for (const h of hooks) expect(h.access === 'read' ? wellbeingModule.reads : wellbeingModule.writes).toContain(h.signal);
  });
});
