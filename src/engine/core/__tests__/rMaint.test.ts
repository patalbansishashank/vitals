// @vitest-environment node
/**
 * Ruling R-MAINT (docs/QA_FINDINGS.md, MODEL_SPEC §5.2 "Maintenance reference"): "% of maintenance" means weight-stable at
 * the activity the schedule PLANS. The maintenance reference = habitual maintenance − habitual exercise energy + the
 * schedule's planned exercise energy (as the activity module books it, averaged over the week/phase, with the engine's own
 * compensation, TEF and AT rules), for both 'baseline' and 'current' references. All tests run the real 16-module engine.
 *
 * (a) a habitual lifter who keeps the same training at 100 % is weight-stable (and gets a zero adjustment);
 * (b) a sedentary person who starts cardio 4×/wk at 100 % stays within ±0.3 kg over 12 weeks while VO2max rises;
 * (c) a lean man with 4 RT sessions/wk at 106 % for 26 weeks gains weight and lean mass with no restriction warning;
 * (d) RT volume dose-response at 100 % and 110 %: lean gain is non-decreasing in weekly sets up to dossier 09's V_cap
 *     (40 effective sets/region/wk), for a novice and a trained man;
 * (e) stopping habitual training at 100 %: intake falls with the lower reference (by the habitual exercise energy plus its
 *     TEF/AT share), so energy balance is kept and fat gain is only what the detraining itself releases — the tissue energy
 *     balance ρF·ΔFM + ρL·ΔLT stays ≈ 0 with the 'current' reference, and the old semantics' surplus is gone.
 */
import { compileSchedule, habitualWeekPrograms } from '../compileSchedule';
import { runEngine } from '../loop';
import { resolveProfile } from '../resolveProfile';
import { TRAINING_REGIONS } from '../../types/inputs';
import type { DayTemplate, EnergyReference, MacroSpec, PersonProfile, Schedule, TrainingRegion } from '../../types';

vi.setConfig({ testTimeout: 120_000 });

const START = '2026-10-05'; // a Monday
const person = (body: Partial<PersonProfile['body']> = {}, habits: PersonProfile['habits'] = {}): PersonProfile => ({
  schemaVersion: 1,
  body: { sex: 'male', ageYears: 30, heightCm: 180, weightKg: 75, ...body },
  habits: { typicalSteps: 7000, sessionsPerWeek: 0, ...habits },
  startDate: START,
});
const MACROS_16: MacroSpec = { protein: { unit: 'gPerKgBw', value: 1.6 }, carbs: { unit: 'pctEnergy', value: 45 }, fat: { unit: 'remainder' } };
/** The habitual split (protein 15.6 %E, carbohydrate 45.4 %E): isolates the activity effect from diet-composition TEF. */
const MACROS_HAB: MacroSpec = { protein: { unit: 'pctEnergy', value: 15.6 }, carbs: { unit: 'pctEnergy', value: 45.4 }, fat: { unit: 'remainder' } };

function weekSchedule(programs: DayTemplate[], week: readonly number[], days: number, reference?: EnergyReference): Schedule {
  return {
    schemaVersion: 1,
    startDate: START,
    horizonDays: days,
    programs,
    days: Array.from({ length: days }, (_, d) => ({ program: week[d % 7]! })),
    ...(reference ? { defaults: { energyReference: reference } } : {}),
  };
}
const pct = (p: number, macros: MacroSpec, exercise?: DayTemplate['exercise']): DayTemplate => ({
  id: `p${p}`,
  label: `p${p}`,
  energy: { kind: 'pctMaintenance', pct: p },
  macros,
  ...(exercise ? { exercise } : {}),
});
const CARDIO = { kind: 'cardio' as const, modality: 'other' as const, startH: 18, durationMin: 60 };
const RT = { kind: 'resistance' as const, startH: 18, durationMin: 60, volume: 'moderate' as const };

function run(p: PersonProfile, s: Schedule) {
  const rp = resolveProfile(p);
  const cs = compileSchedule(s, rp);
  const r = runEngine(rp, cs, { record: 'daily', checks: true });
  return { rp, cs, r, d: r.daily };
}
const last = (a: Float32Array | undefined): number => a![a!.length - 1]!;
const first = (a: Float32Array | undefined): number => a![0]!;

describe('R-MAINT contract: compiled days carry the reference, its activity adjustment and the planned balance', () => {
  it('every day has maintenanceKcal = TDEE0 + activityAdjKcal, plannedBalanceKcal = energyKcal − maintenanceKcal', () => {
    const { rp, cs } = run(person(), weekSchedule([pct(90, MACROS_16, [CARDIO]), pct(90, MACROS_16)], [0, 1, 0, 1, 0, 0, 1], 14));
    for (const day of cs.days) {
      expect(day.maintenanceKcal).toBeCloseTo(rp.tdee0Kcal + day.activityAdjKcal!, 6);
      expect(day.plannedBalanceKcal).toBeCloseTo(day.energyKcal - day.maintenanceKcal, 6);
      expect(day.energyKcal).toBeCloseTo(0.9 * day.maintenanceKcal, 3);
    }
    // weekly averaging: the adjustment is the same on training and rest days of a week (intake is not jagged)
    expect(cs.days[0]!.activityAdjKcal).toBeCloseTo(cs.days[1]!.activityAdjKcal!, 9);
    expect(cs.days[0]!.activityAdjKcal!).toBeGreaterThan(200);
    expect(cs.days[0]!.plannedBalanceKcal!).toBeLessThan(0);
  });

  it("activity 'habitual' opts a day out (reference = the habitual-activity maintenance)", () => {
    const tmpl: DayTemplate = { ...pct(100, MACROS_16, [CARDIO]), energy: { kind: 'pctMaintenance', pct: 100, activity: 'habitual' } };
    const rp = resolveProfile(person());
    const cs = compileSchedule(weekSchedule([tmpl], [0, 0, 0, 0, 0, 0, 0], 7), rp);
    expect(cs.days[0]!.activityAdjKcal).toBe(0);
    expect(cs.days[0]!.energyKcal).toBeCloseTo(rp.tdee0Kcal, 3);
  });

  it('the realised-input series echo the reference and the planned balance', () => {
    const { cs, d } = run(person(), weekSchedule([pct(110, MACROS_16, [RT]), pct(110, MACROS_16)], [0, 1, 0, 1, 0, 1, 1], 7));
    for (let i = 0; i < 7; i++) {
      expect(d.inMaintRef![i]).toBeCloseTo(cs.days[i]!.maintenanceKcal, 0);
      expect(d.inBalancePlanned![i]).toBeCloseTo(cs.days[i]!.plannedBalanceKcal!, 0);
      expect(d.inEnergyPctMaint![i]).toBeCloseTo(110, 3);
    }
  });
});

describe('(a) habitual lifter continuing the same training at 100 %', () => {
  for (const sessions of [3, 4] as const) {
    it(`${sessions} RT sessions/wk (1-3 y): zero adjustment, weight-stable over 90 days`, () => {
      const p = person({}, { sessionsPerWeek: sessions, lifingCardioMix: 0, trainingHistory: '1to3y' });
      const rp = resolveProfile(p);
      const programs = habitualWeekPrograms(rp).map((t) => ({ ...t, energy: { kind: 'pctMaintenance' as const, pct: 100 } }));
      const { cs, d } = run(p, weekSchedule(programs, [0, 1, 2, 3, 4, 5, 6], 90));
      for (const day of cs.days) expect(Math.abs(day.activityAdjKcal!)).toBeLessThan(1e-6);
      expect(Math.abs(last(d.fatMass) - first(d.fatMass))).toBeLessThan(0.15);
      expect(Math.abs(last(d.leanTissue) - first(d.leanTissue))).toBeLessThan(0.15);
      expect(Math.abs(d.scaleWeight![84]! - d.scaleWeight![0]!)).toBeLessThan(0.3);
    });
  }
});

describe('(b) sedentary person starting cardio 4×/wk at 100 %', () => {
  const sched = (macros: MacroSpec, ref?: EnergyReference) =>
    weekSchedule([pct(100, macros, [CARDIO]), pct(100, macros)], [0, 1, 0, 1, 0, 0, 1], 84, ref);
  for (const [label, macros, ref] of [
    ['habitual macro split, baseline reference', MACROS_HAB, undefined],
    ['1.6 g/kg protein, baseline reference', MACROS_16, undefined],
    ['1.6 g/kg protein, current reference', MACROS_16, 'current'],
  ] as const) {
    it(`${label}: |Δ scale| ≤ 0.3 kg over 12 weeks while VO2max rises ≥ 10 %`, () => {
      const { d, cs } = run(person(), sched(macros, ref));
      expect(cs.days[0]!.activityAdjKcal!).toBeGreaterThan(250);
      expect(last(d.vo2max) / first(d.vo2max)).toBeGreaterThan(1.1);
      expect(Math.abs(d.scaleWeight![83]! - d.scaleWeight![0]!)).toBeLessThanOrEqual(0.3);
    });
  }
});

describe('(c) lean man, 4 RT sessions/wk, 106 % for 26 weeks', () => {
  it('weight and lean mass rise; no restriction warning', () => {
    const { r, d } = run(
      person({ weightKg: 72 }, { trainingHistory: 'none' }),
      weekSchedule([pct(106, MACROS_16, [RT]), pct(106, MACROS_16)], [0, 0, 1, 0, 0, 1, 1], 182),
    );
    expect(d.scaleWeight![181]! - d.scaleWeight![0]!).toBeGreaterThan(1);
    expect(last(d.leanTissue) - first(d.leanTissue)).toBeGreaterThan(1);
    const restriction = new Set(['W-E01', 'W-E02', 'W-E03', 'W-E04', 'W-E05', 'W-E06', 'W-E07', 'W-E08', 'W-E10', 'W-E19', 'W-E20', 'W-13-ALPERT']);
    expect(r.warnings.filter((w) => restriction.has(w.id)).map((w) => w.id)).toEqual([]);
    expect(Math.max(...Array.from(d.inBalancePlanned!))).toBeGreaterThan(0);
  });
});

describe('(d) RT volume dose-response (dossier 09 §4.2: monotone up to V_cap 40 sets/region/wk)', () => {
  const VOLUMES = [0, 2, 4, 8, 12, 16, 20, 25, 30, 40];
  const MACROS = { protein: { unit: 'gPerKgBw', value: 1.8 }, carbs: { unit: 'pctEnergy', value: 45 }, fat: { unit: 'remainder' } } as MacroSpec;
  for (const trained of [false, true])
    for (const level of [100, 110]) {
      it(`${trained ? 'trained (> 3 y, 3 RT/wk habitually)' : 'novice'} at ${level} %: 12-week lean gain non-decreasing in weekly sets`, () => {
        const p = person({ ageYears: 28 }, trained ? { sessionsPerWeek: 3, lifingCardioMix: 0, trainingHistory: 'gt3y' } : { trainingHistory: 'none' });
        const gains: number[] = [];
        for (const v of VOLUMES) {
          const sets: Partial<Record<TrainingRegion, number>> = {};
          for (const r of TRAINING_REGIONS) sets[r as TrainingRegion] = v / 3;
          const train = pct(level, MACROS, v > 0 ? [{ kind: 'resistance', startH: 17, setsByRegion: sets, rir: 1 }] : undefined);
          const rp = resolveProfile(p);
          const cs = compileSchedule(weekSchedule([train, pct(level, MACROS)], [0, 1, 0, 1, 0, 1, 1], 84), rp);
          const res = runEngine(rp, cs, { record: 'daily', series: ['leanTissue'] });
          gains.push(last(res.daily.leanTissue) - first(res.daily.leanTissue));
        }
        for (let i = 1; i < gains.length; i++) expect(gains[i]!, `sets ${VOLUMES[i]} vs ${VOLUMES[i - 1]}: ${gains.map((g) => g.toFixed(3)).join(' ')}`).toBeGreaterThanOrEqual(gains[i - 1]! - 1e-3);
      });
    }
});

describe('(e) a habitual exerciser who stops training at 100 %', () => {
  const p = person({}, { sessionsPerWeek: 4, lifingCardioMix: 0.5, trainingHistory: '1to3y' });
  const RHO_F = 9441;
  const RHO_L = 1816;
  it('intake falls with the lower reference (≈ the habitual exercise energy plus its TEF/AT share)', () => {
    const rp = resolveProfile(p);
    const cs = compileSchedule(weekSchedule([pct(100, MACROS_HAB)], [0, 0, 0, 0, 0, 0, 0], 7), rp);
    const adj = cs.days[0]!.activityAdjKcal!;
    expect(adj).toBeLessThan(-150);
    expect(-cs.days[0]!.activityDeltaKcal!).toBeLessThan(-adj); // |Δ| < |adj|: TEF and AT scale it up
    expect(cs.days[0]!.energyKcal).toBeCloseTo(rp.tdee0Kcal + adj, 3);
  });
  it("with the 'current' reference the tissue energy balance stays ≈ 0 over 12 weeks while detraining proceeds", () => {
    const { d } = run(p, weekSchedule([pct(100, MACROS_HAB)], [0, 0, 0, 0, 0, 0, 0], 84, 'current'));
    const stored = RHO_F * (last(d.fatMass) - first(d.fatMass)) + RHO_L * (last(d.leanTissue) - first(d.leanTissue));
    // ≤ 25 kcal/d over 84 days: fat gain is only the energy the detraining lean loss released
    expect(Math.abs(stored) / 84).toBeLessThan(25);
    expect(last(d.leanTissue) - first(d.leanTissue)).toBeLessThan(0); // detraining proceeds
  });
  it('with the baseline reference the fat gain is far below the old "% of habitual maintenance" surplus', () => {
    const planned = run(p, weekSchedule([pct(100, MACROS_HAB)], [0, 0, 0, 0, 0, 0, 0], 84)).d;
    const habitualTmpl: DayTemplate = { ...pct(100, MACROS_HAB), energy: { kind: 'pctMaintenance', pct: 100, activity: 'habitual' } };
    const old = run(p, weekSchedule([habitualTmpl], [0, 0, 0, 0, 0, 0, 0], 84)).d;
    const dfPlanned = last(planned.fatMass) - first(planned.fatMass);
    const dfOld = last(old.fatMass) - first(old.fatMass);
    expect(dfPlanned).toBeLessThan(0.5 * dfOld);
  });
});

describe('the `maintenance` metric (final-round definition): current body, scheduled activity, habitual diet mix', () => {
  it('starts at the static reference and falls as weight is lost and adaptation develops (no ramp from a high-protein plan)', () => {
    const { rp, r, d, cs } = run(person({ weightKg: 85 }), weekSchedule([pct(80, MACROS_16)], [0, 0, 0, 0, 0, 0, 0], 84));
    expect(r.initial.maintenance!).toBeCloseTo(cs.days[0]!.maintenanceKcal, 0);
    expect(r.initial.maintenance!).toBeCloseTo(rp.tdee0Kcal, 0);
    const m = Array.from(d.maintenance!);
    expect(m[0]!).toBeLessThanOrEqual(r.initial.maintenance! + 1);
    for (let i = 1; i < m.length; i++) expect(m[i]!, `day ${i}`).toBeLessThanOrEqual(m[i - 1]! + 1);
    expect(m[83]!).toBeLessThan(m[0]! - 50);
  });
  it('with planned training it includes the planned activity (above TDEE0) and still falls in a deficit', () => {
    const { rp, r, d, cs } = run(person({ weightKg: 85 }), weekSchedule([pct(80, MACROS_16, [RT]), pct(80, MACROS_16)], [0, 1, 0, 1, 0, 1, 1], 84));
    // t = 0: TDEE0 + Δ/(1 − α0), Δ = the planned − habitual booked activity (α0 ≈ 0.09)
    const delta = cs.days[0]!.activityDeltaKcal!;
    expect(delta).toBeGreaterThan(100);
    expect(r.initial.maintenance! - rp.tdee0Kcal).toBeGreaterThan(delta);
    expect(r.initial.maintenance! - rp.tdee0Kcal).toBeLessThan(1.15 * delta);
    expect(d.maintenance![83]!).toBeLessThan(d.maintenance![6]!);
  });
});
