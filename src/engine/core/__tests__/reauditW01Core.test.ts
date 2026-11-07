// @vitest-environment node
/**
 * Re-audit 2026-10-19, stage 1 (waves 0-1), package F02-core: compiler, recorder boundaries, ensemble and worker transport.
 * Each block names its finding. Probe values are the audit's own fixtures (illustrative bounds, never clinical guidance).
 */
import { BAND_DAY_METHOD } from '@/lib/bodyContracts';
import type { DayTemplate, MealSpec, PersonProfile, Schedule } from '../../types';
import { NUTRIENT_UNKNOWN_BIT, type DayInput } from '../../types/inputs';
import type { EnsembleMemberEnvelope } from '../../types/result';
import { DayHourTable, compileSchedule, expandDayToHours, loadHour, newHourInput, resolvedDayExposure } from '../compileSchedule';
import { ensembleMemberVectors, runEngine, simulate, simulateEnsemble } from '../loop';
import { ensembleBands, memberEnvelope } from '../bands';
import { buildModelParams, drawKindOf } from '../paramsRegistry';
import { MODULES } from '../moduleRegistry';
import { resolveProfile } from '../resolveProfile';
import { DEFAULTS } from '../defaults';
import { STUB_MODULES } from './stubModules';
import { runGoalStatus } from '../../planner/domain/capabilities';

const START = '2026-10-05';
const MAN35: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 35, heightCm: 178, weightKg: 82 }, startDate: START };
const p = resolveProfile(MAN35);

/** A logged day: reported meals replay exactly; the template's macro numbers are placeholders the meals supersede. */
const logged = (meals: MealSpec[], extra: Partial<DayTemplate> = {}): DayTemplate => ({
  id: 'L',
  label: 'as logged',
  energy: { kind: 'kcal', kcal: meals.reduce((a, m) => a + (m.energyKcal ?? 0), 0) },
  macros: { protein: { unit: 'g', value: 0 }, carbs: { unit: 'remainder' }, fat: { unit: 'remainder' } },
  meals: { meals },
  observed: { coverage: { energy: 'complete', protein: 'complete', carbohydrate: 'complete', fat: 'complete', fibre: 'complete', alcohol: 'complete' }, resolution: 'daily' },
  ...extra,
});
const sched = (days: number, tmpl: DayTemplate | DayTemplate[]): Schedule => {
  const programs = Array.isArray(tmpl) ? tmpl : [tmpl];
  return { schemaVersion: 1, startDate: START, horizonDays: days, programs, days: Array.from({ length: days }, (_, d) => ({ program: d % programs.length })) };
};
/** Three 700 kcal meals with no macro analysis (the audit's calorie-only record). */
const energyOnly = (protein?: number): MealSpec[] =>
  [8, 13, 19].map((h, i) => ({ clockH: h, share: 700, energyKcal: 700, ...(protein !== undefined ? { macros: { proteinG: protein } } : {}), eventId: `m${i}` }));
const hourly = (d: DayInput, prev: DayInput | null = null): DayHourTable => {
  const t = new DayHourTable();
  expandDayToHours(d, 23, 8, null, d.day * 24, t, prev);
  return t;
};
const sum = (a: ArrayLike<number>): number => Array.from(a).reduce((s, v) => s + v, 0);

// =====================================================================================================================
describe('A1-014: nutrient knowledge survives the compiler; a known contribution is only a lower bound', () => {
  it('energy-only 700 kcal × 3: energy complete 2100 kcal, absent protein/carbohydrate/fat analysis unknown (never a known 0)', () => {
    const d = compileSchedule(sched(1, logged(energyOnly())), p).days[0]!;
    expect(d.energyKcal).toBeCloseTo(2100, 9);
    for (let i = 0; i < 3; i++) expect(d.meals[i]!.nutrientMask).toEqual({ protein: 'unknown', carbohydrate: 'unknown', fat: 'unknown', fibre: 'unknown', ethanol: 'unknown' });
    expect(d.nutrientUnknownMask).toBe(31);
    const e = resolvedDayExposure(d);
    expect(e.energy).toEqual({ knownSum: 2100, unit: 'kcal', coverage: 'complete' });
    // the logged day is attested complete, but complete day logging never invents a nutrient analysis
    for (const id of ['protein', 'carbAvailable', 'fat', 'fibre', 'ethanol']) expect(e[id]).toMatchObject({ knownSum: 0, coverage: 'unknown', knownContributions: 0, unknownContributions: 3 });
  });

  it('explicit known protein 30 g per meal: protein exact 90 g, carbohydrate/fat still unknown', () => {
    const e = resolvedDayExposure(compileSchedule(sched(1, logged(energyOnly(30))), p).days[0]!);
    expect(e.protein).toEqual({ knownSum: 90, unit: 'g', coverage: 'complete' });
    expect(e.carbAvailable!.coverage).toBe('unknown');
    expect(e.fat!.coverage).toBe('unknown');
  });

  it('known 60 g protein plus an unknown-protein meal: a lower bound of 60 g (partial), counts beside it', () => {
    const d = compileSchedule(sched(1, logged([{ clockH: 8, share: 600, energyKcal: 600, macros: { proteinG: 60 }, eventId: 'a' }, { clockH: 18, share: 500, energyKcal: 500, eventId: 'b' }])), p).days[0]!;
    expect(resolvedDayExposure(d).protein).toEqual({ knownSum: 60, unit: 'g', coverage: 'partial', knownContributions: 1, unknownContributions: 1 });
  });

  it('the mixed 1999 kcal (P110/C210/F75/fibre22) + 500 kcal unknown record: protein 110 g is a lower bound, not complete', () => {
    const d = compileSchedule(
      sched(1, logged([{ clockH: 8, share: 1999, energyKcal: 1999, macros: { proteinG: 110, carbG: 210, fatG: 75, fibreG: 22 }, eventId: 'k' }, { clockH: 19, share: 500, energyKcal: 500, eventId: 'u' }])),
      p,
    ).days[0]!;
    expect(d.energyKcal).toBeCloseTo(2499, 9);
    const e = resolvedDayExposure(d);
    expect(e.protein).toMatchObject({ knownSum: 110, coverage: 'partial' });
    expect(e.carbAvailable).toMatchObject({ knownSum: 210, coverage: 'partial' });
  });

  it('explicit 0 grams are known zeros; an ordinary prescription stays construction-scope complete', () => {
    const zero = compileSchedule(sched(1, logged([{ clockH: 12, share: 400, energyKcal: 400, macros: { proteinG: 0, carbG: 0, fatG: 44.4, fibreG: 0, alcoholG: 0 }, eventId: 'z' }])), p).days[0]!;
    expect(zero.nutrientUnknownMask).toBe(0);
    expect(resolvedDayExposure(zero).protein).toEqual({ knownSum: 0, unit: 'g', coverage: 'complete' });
    const rx: DayTemplate = { id: 'R', label: 'rx', energy: { kind: 'kcal', kcal: 2200 }, macros: { protein: { unit: 'g', value: 140 }, carbs: { unit: 'g', value: 220 }, fat: { unit: 'remainder' } } };
    const d = compileSchedule(sched(1, rx), p).days[0]!;
    expect(d.nutrientUnknownMask).toBe(0);
    expect(resolvedDayExposure(d).protein).toEqual({ knownSum: 140, unit: 'g', coverage: 'complete' });
  });

  it('a stated nutrient knowledge overrides key presence: an "unknown" compatibility 0 is no known zero', () => {
    const d = compileSchedule(sched(1, logged([{ clockH: 12, share: 500, energyKcal: 500, macros: { proteinG: 0, carbG: 40 }, nutrientKnowledge: { protein: 'unknown' }, eventId: 'x' }])), p).days[0]!;
    expect(d.meals[0]!.nutrientMask!.protein).toBe('unknown');
    expect(d.meals[0]!.nutrientMask!.carbohydrate).toBe('known');
    expect(resolvedDayExposure(d).protein!.coverage).toBe('unknown');
  });

  it('fast suppression removes a dropped meal’s unknown analysis with it; masks survive runtime re-resolution and hourly ingestion', () => {
    const rx: DayTemplate = { ...logged([{ clockH: 8, share: 400, energyKcal: 400, macros: { proteinG: 30, carbG: 40, fatG: 6, fibreG: 3, alcoholG: 0 } }, { clockH: 14, share: 300, energyKcal: 300 }]), observed: undefined };
    const c = compileSchedule({ ...sched(1, rx), events: [{ kind: 'fast', startDay: 0, startH: 8, durationH: 12 }] }, p);
    expect(c.days[0]!.meals[1]!.kcal).toBe(0);
    expect(c.days[0]!.nutrientUnknownMask).toBe(0);
    // a 'current' reference day is re-resolved at run time: the meal masks are rewritten in place, identical
    const cur: DayTemplate = { ...logged(energyOnly(30)), energy: { kind: 'pctMaintenance', pct: 90, reference: 'current' }, macros: { protein: { unit: 'gPerKgBw', value: 1.6 }, carbs: { unit: 'remainder' }, fat: { unit: 'pctEnergy', value: 30 } } };
    const cs = compileSchedule(sched(3, cur), p, { exposure: true });
    const before = cs.days[2]!.nutrientUnknownMask;
    runEngine(p, cs, { record: 'none' });
    expect(cs.days[2]!.nutrientUnknownMask).toBe(before);
    expect(cs.days[2]!.exposure!.carbAvailable!.coverage).toBe('unknown');
    const t = hourly(compileSchedule(sched(1, logged(energyOnly(30))), p).days[0]!);
    const hi = newHourInput();
    loadHour(t, 13, hi);
    expect(hi.nutrientUnknownMask).toBe(NUTRIENT_UNKNOWN_BIT.carbohydrate | NUTRIENT_UNKNOWN_BIT.fat | NUTRIENT_UNKNOWN_BIT.fibre | NUTRIENT_UNKNOWN_BIT.ethanol);
    loadHour(t, 14, hi);
    expect(hi.nutrientUnknownMask).toBe(0);
  });
});

// =====================================================================================================================
describe('A1-013: an unknown allocation conditions every dependent output from its first day, whatever the mask', () => {
  const s14 = sched(14, logged(energyOnly()));

  it('a 14-day 2100 kcal calorie-only record: energy stays 2100 kcal, substrate/tissue/marker statuses are conditional', () => {
    const r = simulate(MAN35, s14, { record: 'daily', checks: true });
    expect(r.daily.inEnergy![0]).toBeCloseTo(2100, 3);
    expect(r.meta.checks!.energyMaxAbsKcal).toBeLessThan(1e-3); // the energy ledger still closes
    const st = r.meta.outputStatus!;
    for (const id of ['glucose', 'insulin', 'bhb', 'glycogenTotal', 'waterWeight', 'fatMass', 'leanTissue', 'scaleWeight', 'nitrogenBalance', 'fatArms', 'muscleArms'] as const)
      expect(st[id], id).toMatchObject({ status: 'scenario', reasonCode: 'unknownMacroAllocation', fromDay: 0 });
    expect(st.mps!.status).toBe('exploratory'); // a stronger provider status stays
    expect(r.meta.assumptions).toEqual(expect.arrayContaining(['unknownMacroAllocation', 'unknownProteinAllocation']));
    expect(r.meta.assumptionDetails!.find((a) => a.id === 'unknownMacroAllocation')).toMatchObject({ fromDay: 0, scenario: 'energyOnlyNoSubstrateRoute' });
    // the fat/scale goals cannot read as an estimated forecast
    expect(runGoalStatus(r, 'fatMass').status).not.toBe('estimated');
    expect(runGoalStatus(r, 'scaleWeight').status).not.toBe('estimated');
  });

  it('known protein 30 g/meal with unknown C/F: protein stays known (30 g/meal), C/F-driven outputs conditional, no protein assumption', () => {
    const r = simulate(MAN35, sched(5, logged(energyOnly(30))), { record: 'daily' });
    expect(r.daily.inProtein![0]).toBeCloseTo(90, 4);
    expect(r.meta.outputStatus!.glucose).toMatchObject({ reasonCode: 'unknownMacroAllocation' });
    expect(r.meta.assumptions).not.toContain('unknownProteinAllocation');
    // complete macros reconciled against specific factors: no absent-composition status at all
    const full = simulate(MAN35, sched(5, logged([{ clockH: 12, share: 900, energyKcal: 900, macros: { proteinG: 50, carbG: 100, fatG: 30, fibreG: 10, alcoholG: 0 }, energyResidual: 'reconciliation', eventId: 'f' }])), { record: 'daily' });
    expect(full.meta.assumptions ?? []).not.toContain('unknownMacroAllocation');
    expect(full.meta.outputStatus?.glucose?.reasonCode).not.toBe('unknownMacroAllocation');
  });

  it('a minimal series mask and a day-stamped continuation report the same status, reason and first day as the full run', () => {
    const later: Schedule = { ...sched(14, [{ ...logged(energyOnly(30)), observed: undefined, meals: { meals: energyOnly(30).map((m) => ({ ...m, macros: { proteinG: 30, carbG: 60, fatG: 20, fibreG: 5, alcoholG: 0 }, energyKcal: 600 })) } }]) };
    later.days = later.days.map((d, i) => (i >= 4 ? { program: 1 } : d));
    later.programs = [...later.programs, logged(energyOnly())];
    const full = simulate(MAN35, later, { record: 'daily' });
    expect(full.meta.outputStatus!.bhb).toMatchObject({ status: 'scenario', reasonCode: 'unknownMacroAllocation', fromDay: 4 });
    for (const id of ['bhb', 'fatMass'] as const) {
      const one = simulate(MAN35, later, { record: 'daily', series: [id] });
      expect(one.meta.outputStatus![id]).toEqual(full.meta.outputStatus![id]);
    }
    const rp = resolveProfile(MAN35);
    const cs = compileSchedule(later, rp);
    const cap = runEngine(rp, cs, { record: 'daily', series: ['fatMass'], captureSnapshotAt: [6] });
    const cont = runEngine(rp, cs, { record: 'daily', series: ['fatMass'], initialSnapshot: cap.snapshots![6]! });
    expect(cont.meta.outputStatus!.fatMass).toEqual(full.meta.outputStatus!.fatMass);
  });

  it('a known low-protein surplus also conditions nitrogen balance and the regional details (partition closure)', () => {
    const surplus: DayTemplate = { id: 'S', label: 's', energy: { kind: 'kcal', kcal: 3500 }, macros: { protein: { unit: 'g', value: 30 }, carbs: { unit: 'pctEnergy', value: 55 }, fat: { unit: 'remainder' } } };
    const r = simulate(MAN35, sched(28, surplus), { record: 'daily' });
    const st = r.meta.outputStatus!;
    expect(st.leanTissue).toBeDefined();
    for (const id of ['nitrogenBalance', 'fatArms', 'muscleArms', 'muscleLegs', 'fatTrunk'] as const) expect(st[id], id).toBeDefined();
    expect(r.daily.inEnergy![0]).toBeCloseTo(3500, 2); // supported energy intake is retained
  });
});

// =====================================================================================================================
describe('A1-025: reported ME is the energy for every ledger status', () => {
  it('a 150 kcal label with 190 kcal of known grams keeps 150 kcal in the meal, the day and every hour; the grams stay the record', () => {
    const c = compileSchedule(sched(1, logged([{ clockH: 12, share: 150, energyKcal: 150, macros: { proteinG: 20, carbG: 5, fatG: 10, fibreG: 0 }, eventId: 'lbl' }])), p);
    const d = c.days[0]!;
    const m = d.meals[0]!;
    expect([m.kcal, m.reportedKcal, m.energyStatus]).toEqual([150, 150, 'conflict']);
    expect([m.proteinG, m.carbG, m.fatG]).toEqual([20, 5, 10]);
    expect(m.unallocatedKcal).toBeCloseTo(-40, 9);
    expect(d.energyKcal).toBeCloseTo(150, 9);
    const t = hourly(d);
    expect(sum(t.kcal)).toBeCloseTo(150, 9);
    expect(t.unallocatedKcal[12]).toBeCloseTo(-40, 9);
  });

  it('small negative rounding keeps the reported energy too (consistent, signed correction)', () => {
    const d = compileSchedule(sched(1, logged([{ clockH: 9, share: 498, energyKcal: 498, macros: { proteinG: 30, carbG: 50, fatG: 20, fibreG: 0, alcoholG: 0 }, eventId: 'r' }])), p).days[0]!;
    expect(d.meals[0]!.energyStatus).toBe('consistent');
    expect(d.energyKcal).toBeCloseTo(498, 9);
    expect(sum(hourly(d).kcal)).toBeCloseTo(498, 9);
  });

  it('in the run: the 150 kcal stay the physiology’s energy and the conflict-dependent outputs await review without any positive residual', () => {
    const r = simulate(MAN35, sched(4, logged([{ clockH: 12, share: 150, energyKcal: 150, macros: { proteinG: 20, carbG: 5, fatG: 10, fibreG: 0, alcoholG: 0 }, eventId: 'lbl' }, ...energyOnly(40).slice(0, 2)])), { record: 'daily' });
    expect(r.daily.inEnergy![0]).toBeCloseTo(150 + 1400, 3);
    for (const id of ['glucose', 'fatMass', 'tef', 'ldl'] as const) expect(r.meta.outputStatus![id], id).toMatchObject({ status: 'review', reasonCode: 'reportedEnergyConflict', fromDay: 0 });
    expect(r.meta.outputStatus?.hunger).toBeUndefined(); // independent outputs are not touched
  });

  it('the existing 600 kcal / 30 g protein case still conserves the reported energy', () => {
    const d = compileSchedule(sched(1, logged([{ clockH: 12.5, share: 600, energyKcal: 600, macros: { proteinG: 30 }, eventId: 'e' }])), p).days[0]!;
    expect(d.energyKcal).toBeCloseTo(600, 9);
    expect(d.unallocatedKcal).toBeCloseTo(480, 9);
  });
});

// =====================================================================================================================
describe('A1-029: food ethanol and a standalone drink are two exposures unless explicitly the same event', () => {
  const drink = (clockH: number, eventId: string) => ({ clockH, drinks: 1, eventId });
  const food = (): MealSpec => ({ clockH: 12, share: 98, energyKcal: 98, macros: { proteinG: 0, carbG: 0, fatG: 0, fibreG: 0, alcoholG: 14 }, eventId: 'food:wine' });

  it('food 14 g / 98 kcal at 12:00 plus an extra drink of 14 g at 16:00 compile to 28 g / 196 kcal with distinct hourly doses', () => {
    const d = compileSchedule(sched(1, logged([food()], { substances: { alcohol: [drink(16, 'drink:1')] } })), p).days[0]!;
    expect(DEFAULTS.gramsPerDrink).toBe(14);
    expect(d.meals[0]!.alcoholG).toBe(14);
    expect(d.alcoholG).toBeCloseTo(28, 9);
    expect(d.energyKcal).toBeCloseTo(196, 9);
    const t = hourly(d);
    expect([t.alcoholG[12], t.alcoholG[16]]).toEqual([14, 14]);
    expect([t.kcal[12], t.kcal[16]]).toEqual([98, 98]);
    expect(resolvedDayExposure(d).ethanol).toMatchObject({ knownSum: 28 });
  });

  it('two unlinked equal-time drinks stay two; food-only and drink-only days keep their energy and timing', () => {
    const two = compileSchedule(sched(1, logged([], { energy: { kind: 'kcal', kcal: 0 }, substances: { alcohol: [drink(20, 'a'), drink(20, 'b')] } })), p).days[0]!;
    expect(sum(hourly(two).alcoholG)).toBeCloseTo(28, 9);
    const only = compileSchedule(sched(1, logged([food()])), p).days[0]!;
    expect([only.alcoholG, only.energyKcal]).toEqual([14, 98]);
  });

  it('an explicit same-event identity (the drink entry carries the meal’s event id) counts 14 g / 98 kcal once, with the meal', () => {
    const d = compileSchedule(sched(1, logged([food()], { substances: { alcohol: [drink(12, 'food:wine')] } })), p).days[0]!;
    expect(d.alcoholG).toBeCloseTo(14, 9);
    expect(d.energyKcal).toBeCloseTo(98, 9);
    const t = hourly(d);
    expect(sum(t.alcoholG)).toBeCloseTo(14, 9);
    expect(sum(t.kcal)).toBeCloseTo(98, 9);
  });

  it('a prospective day keeps the drink-budget convention (planned drinks in substances, never counted twice)', () => {
    const rx: DayTemplate = { ...logged([{ clockH: 19, share: 600, energyKcal: 600, macros: { proteinG: 30, alcoholG: 14 } }], { substances: { alcohol: [{ clockH: 20, drinks: 1 }] } }), observed: undefined };
    const d = compileSchedule(sched(1, rx), p).days[0]!;
    expect(d.meals[0]!.alcoholG).toBe(0);
    expect(d.alcoholG).toBe(14);
  });
});

// =====================================================================================================================
describe('A1-031: polyols keep their identities; their unmodelled route conditions glucose/insulin/fuel outputs', () => {
  const polyolMeal = (): MealSpec => ({ clockH: 15, share: 240, energyKcal: 240, macros: { proteinG: 0, carbG: 0, fatG: 0, fibreG: 0, alcoholG: 0 }, polyolsG: { maltitol: 60, erythritol: 20, unidentified: 20 }, eventId: 'bar' });

  it('identities, reported ME and the non-polyol carbohydrate survive compile, JSON and the hour table', () => {
    const s = sched(1, logged([polyolMeal()]));
    const a = compileSchedule(s, p).days[0]!;
    const b = compileSchedule(JSON.parse(JSON.stringify(s)) as Schedule, p).days[0]!;
    for (const d of [a, b]) {
      expect(d.meals[0]!.polyolsG).toEqual({ maltitol: 60, erythritol: 20, unidentified: 20 });
      expect(d.polyolsG).toEqual({ maltitol: 60, erythritol: 20, unidentified: 20 });
      expect(d.energyKcal).toBeCloseTo(240, 9);
      expect(d.carbG).toBe(0);
    }
    expect(hourly(a).polyolG[15]).toBeCloseTo(100, 9);
    expect(compileSchedule(s, p).notes.some((n) => n.code === 'polyolRouteUnmodelled')).toBe(true);
    expect(resolvedDayExposure(a).polyol).toMatchObject({ knownSum: 100, unit: 'g' });
    // no polyol record: the amount is unknown, not zero
    expect(resolvedDayExposure(compileSchedule(sched(1, logged(energyOnly(30))), p).days[0]!).polyol!.coverage).toBe('unknown');
  });

  it('a full run names the zero-route scenario on the affected outputs while the energy stays complete', () => {
    const r = simulate(MAN35, sched(3, logged([polyolMeal(), { clockH: 8, share: 600, energyKcal: 600, macros: { proteinG: 40, carbG: 70, fatG: 18, fibreG: 5, alcoholG: 0 }, eventId: 'b' }])), { record: 'daily' });
    expect(r.daily.inEnergy![0]).toBeCloseTo(840, 3);
    for (const id of ['glucose', 'insulin', 'bhb', 'glycogenTotal'] as const) expect(r.meta.outputStatus![id], id).toMatchObject({ status: 'scenario', reasonCode: 'polyolRouteUnmodelled', fromDay: 0 });
    expect(r.meta.assumptions).toContain('polyolRouteUnmodelled');
  });
});

// =====================================================================================================================
describe('A1-020/A1-022: bout identity and an unknown hard-set count travel through the compiler', () => {
  const rt = (startH: number, groups: NonNullable<Extract<NonNullable<DayTemplate['exercise']>[number], { kind: 'resistance' }>['groups']>, extra: Record<string, unknown> = {}) =>
    ({ kind: 'resistance' as const, startH, durationMin: 30, groups, ...extra });
  const g6 = { sets: 6, regionWeights: { chest: 1 }, contraction: 'dynamic' as const, loadPct1RM: 75, rir: 0, restSec: 120 };

  it('two distinct bouts in the same clock hour keep distinct keys; a bout carried past midnight keeps its origin key and end', () => {
    const day: DayTemplate = { ...logged([]), observed: undefined, energy: { kind: 'kcal', kcal: 2000 }, macros: { protein: { unit: 'g', value: 120 }, carbs: { unit: 'remainder' }, fat: { unit: 'pctEnergy', value: 30 } }, exercise: [rt(17, [g6], { sessionId: 'a' }), rt(17.5, [g6], { sessionId: 'b' })] };
    const d = compileSchedule(sched(1, day), p).days[0]!;
    expect(d.rtGroups![0]!.boutKey).toBe('bout:a');
    expect(d.rtGroups![1]!.boutKey).toBe('bout:b');
    expect(d.sessions[1]!.boutEndH).toBeCloseTo(18, 9);
    const late: DayTemplate = { ...day, exercise: [rt(23.5, [g6], { durationMin: 60 })] };
    const c = compileSchedule(sched(2, late), p);
    const carried = c.days[1]!.rtGroups!.find((g) => g.session === -1)!;
    expect(carried.boutKey).toBe(c.days[0]!.sessions[0]!.boutKey); // legacy identity-less key: origin day + session index
    expect(carried.boutKey).toBe('legacy:0:0');
    expect(carried.boutEndH).toBeCloseTo(0.5, 9); // on the carrying day's clock
  });

  it('a minutes-only record compiles as the named legacy scenario (setsUnknown), apart from ordinary inferred fields', () => {
    const minutes = { ...g6, provenance: { sets: 'unknown' as const, regions: 'inferred' as const } };
    const day: DayTemplate = { ...logged([]), observed: undefined, energy: { kind: 'kcal', kcal: 2300 }, macros: { protein: { unit: 'g', value: 130 }, carbs: { unit: 'remainder' }, fat: { unit: 'pctEnergy', value: 30 } }, exercise: [rt(18, [minutes], { sessionId: 'flow' })] };
    const d = compileSchedule(sched(1, day), p).days[0]!;
    expect(d.rtGroups![0]).toMatchObject({ setsUnknown: 1, unknownDoseScenario: 'legacyMinuteConversion', assumed: 1, provenance: { sets: 'unknown', regions: 'inferred' } });
    expect(d.sessions[0]!.doseStatus).toBe('unknown');
    expect(compileSchedule(sched(1, day), p).notes.some((n) => n.code === 'unknownDoseScenario')).toBe(true);
    const reported = compileSchedule(sched(1, { ...day, exercise: [rt(18, [{ ...g6, provenance: { sets: 'reported' } }])] }), p).days[0]!;
    expect(reported.rtGroups![0]!.setsUnknown).toBeUndefined();
    // the run carries the named assumption and conditions growth/strength/lean from that day; energy outputs stay
    const r = simulate(MAN35, sched(6, [{ ...day, exercise: [] }, day]), { record: 'daily' });
    expect(r.meta.assumptionDetails!.find((a) => a.id === 'unknownHardSetCount')).toMatchObject({ fromDay: 1, scenario: 'legacyMinuteConversion' });
    for (const id of ['rtMuscleGain', 'leanTissue', 'strength'] as const) expect(r.meta.outputStatus![id], id).toMatchObject({ status: 'scenario' });
    expect(r.meta.outputStatus!.leanTissue).toMatchObject({ reasonCode: 'unknownHardSetCount', fromDay: 1 });
    expect(r.meta.outputStatus?.tdee?.reasonCode).not.toBe('unknownHardSetCount');
  });
});

// =====================================================================================================================
describe('A1-062: effort-scale identity travels; a phase inherits only an explicitly declared scale', () => {
  const ride = (extra: Record<string, unknown>, phases = [{ kind: 'work' as const, durationMin: 10, rpe: 7 }, { kind: 'recovery' as const, durationMin: 10, rpe: 3, rpeScale: 'relativeEffort0To10' as const }]): DayTemplate =>
    ({ ...logged([]), observed: undefined, energy: { kind: 'kcal', kcal: 2200 }, macros: { protein: { unit: 'g', value: 120 }, carbs: { unit: 'remainder' }, fat: { unit: 'pctEnergy', value: 30 } }, exercise: [{ kind: 'cardio', modality: 'cycle', startH: 18, durationMin: 20, phases, ...extra }] });

  it('cr10 stays Borg CR10; a generic relative scale stays distinct; the class source travels', () => {
    const cr = compileSchedule(sched(1, ride({ rpe: 3, rpeScale: 'cr10' })), p).days[0]!.sessions[0]!;
    expect(cr.rpeScale).toBe('cr10');
    expect(cr.phases![0]!.rpeScale).toBe('cr10'); // inherited from the explicit session scale
    expect(cr.phases![1]!.rpeScale).toBe('relativeEffort0To10'); // the phase's own scale wins
    const gen = compileSchedule(sched(1, ride({ rpe: 5, rpeScale: 'relativeEffort0To10', healthClassSource: 'relativeEffort0To10' })), p).days[0]!.sessions[0]!;
    expect(gen.rpeScale).toBe('relativeEffort0To10');
    expect(gen.healthClassSource).toBe('relativeEffort0To10');
  });

  it('an unscaled session leaves unscaled phases without a scale (never a known guideline class)', () => {
    const s = compileSchedule(sched(1, ride({ rpe: 7 })), p).days[0]!.sessions[0]!;
    expect(s.rpeScale).toBeUndefined();
    expect(s.phases![0]!.rpeScale).toBeUndefined();
  });
});

// =====================================================================================================================
describe('A1-053: the waking day keeps its known total apart from the main timing; quality reaches day zero', () => {
  const tz = 'Europe/Berlin';
  const ep = (bedAt: string, wakeAt: string, extra: Record<string, unknown> = {}) => ({ bedAt, wakeAt, tz, ...extra });

  it('5 h main + 1 h nap: compiled total 6 h, main timing 01:00–06:00 in the hour expansion', () => {
    const wake: DayTemplate = { ...logged(energyOnly(30)), sleep: { observed: ep('2026-10-06T01:00:00+02:00', '2026-10-06T06:00:00+02:00', { eventId: 's1' }), observedEpisodes: [ep('2026-10-06T01:00:00+02:00', '2026-10-06T06:00:00+02:00', { eventId: 's1' }), ep('2026-10-06T14:00:00+02:00', '2026-10-06T15:00:00+02:00', { kind: 'nap', eventId: 's2' })] } };
    const c = compileSchedule(sched(2, [logged(energyOnly(30)), wake]), p);
    const [mon, tue] = c.days as [DayInput, DayInput];
    expect(tue.sleepEndingToday).toMatchObject({ bedClockH: 1, wakeClockH: 6, hours: 5, totalAsleepHours: 6, eventIds: ['s1', 's2'], coverage: 'complete' });
    expect(mon.sleepHours).toBe(5); // the nap never stretches the night
    expect(c.notes.some((n) => n.code === 'sleepTotalFromEpisodes' && n.day === 1)).toBe(true);
    const t = new DayHourTable();
    expandDayToHours(tue, mon.sleepBedH, mon.sleepHours, null, 24, t, mon);
    expect(Array.from(t.asleep.slice(0, 7))).toEqual([0, 1, 1, 1, 1, 1, 0]);
    // the living reduction's legacy form (template hours = the union total beside the observed main) is honoured too
    const legacy: DayTemplate = { ...logged(energyOnly(30)), sleep: { hours: 6, observed: ep('2026-10-06T01:00:00+02:00', '2026-10-06T06:00:00+02:00') } };
    expect(compileSchedule(sched(2, [logged(energyOnly(30)), legacy]), p).days[1]!.sleepEndingToday).toMatchObject({ hours: 5, totalAsleepHours: 6 });
  });

  it('two non-overlapping main segments and a duplicate entry: the union is counted exactly once', () => {
    const segs = [ep('2026-10-05T23:00:00+02:00', '2026-10-06T02:00:00+02:00'), ep('2026-10-06T03:00:00+02:00', '2026-10-06T07:00:00+02:00'), ep('2026-10-06T03:00:00+02:00', '2026-10-06T07:00:00+02:00')];
    const wake: DayTemplate = { ...logged(energyOnly(30)), sleep: { observedEpisodes: segs } };
    const se = compileSchedule(sched(2, [logged(energyOnly(30)), wake]), p).days[1]!.sleepEndingToday!;
    expect(se.totalAsleepHours).toBeCloseTo(7, 9);
    expect(se.hours).toBeCloseTo(7, 9);
  });

  it('day-zero quality behaves as a later waking day: poor/good reach initialSleep and day 0; absent is unrated, never planned poor', () => {
    const night = (quality?: 'poor' | 'good'): DayTemplate => ({ ...logged(energyOnly(30)), sleep: { quality: 'poor', observed: ep('2026-10-04T23:00:00+02:00', '2026-10-05T06:00:00+02:00', quality ? { quality } : {}) } });
    for (const q of ['poor', 'good'] as const) {
      const c = compileSchedule(sched(2, [night(q), logged(energyOnly(30))]), p);
      const code = q === 'poor' ? 0 : 2;
      expect(c.initialSleep).toMatchObject({ sleepHours: 7, totalAsleepHours: 7, quality: code, qualityStatus: 'rated' });
      expect(c.days[0]!.sleepEndingToday).toMatchObject({ quality: code, qualityStatus: 'rated' });
    }
    const unrated = compileSchedule(sched(2, [night(), logged(energyOnly(30))]), p);
    expect(unrated.initialSleep!.quality).toBeUndefined();
    expect(unrated.initialSleep!.qualityStatus).toBe('unrated');
    // a later waking day: the replaced planned night's poor label is cleared when the observed night is unrated
    const plannedPoor: DayTemplate = { ...logged(energyOnly(30)), sleep: { quality: 'poor' } };
    const later: DayTemplate = { ...logged(energyOnly(30)), sleep: { observed: ep('2026-10-05T23:00:00+02:00', '2026-10-06T06:00:00+02:00') } };
    const c2 = compileSchedule(sched(2, [plannedPoor, later]), p);
    expect(c2.days[1]!.sleepEndingToday).toMatchObject({ qualityStatus: 'unrated' });
    expect(c2.days[1]!.sleepEndingToday!.quality).toBeUndefined();
    expect(c2.days[0]!.sleepQuality).not.toBe(0);
  });

  it('a nap-only record stays partial: the planned night keeps the timing, the nap is the known dose', () => {
    const napOnly: DayTemplate = { ...logged(energyOnly(30)), sleep: { observedEpisodes: [ep('2026-10-06T14:00:00+02:00', '2026-10-06T15:30:00+02:00', { kind: 'nap', eventId: 'n' })], observedCoverage: 'partial' } };
    const d = compileSchedule(sched(2, [logged(energyOnly(30)), napOnly]), p).days[1]!;
    expect(d.sleepEndingToday).toMatchObject({ hours: 8, totalAsleepHours: 1.5, coverage: 'partial', eventIds: ['n'] });
    expect(d.sleepSource).not.toBe('observed');
  });
});

// =====================================================================================================================
describe('A1-040: both operands of the step ledger disclose an unresolved overlap', () => {
  const habit = (overlap?: { status: 'known' | 'unknown'; includedStepsPerDay?: number }): PersonProfile => ({
    ...MAN35,
    body: { ...MAN35.body, weightKg: 75 },
    habits: { typicalSteps: 10000, sessionsPerWeek: 7, lifingCardioMix: 1, stepsScope: 'totalDay', ...(overlap ? { habitualStepsOverlap: overlap } : {}) },
  });
  const week = (stepsScope?: 'totalDay', inc?: number): Schedule =>
    sched(7, { ...logged([]), observed: undefined, energy: { kind: 'pctMaintenance', pct: 100 }, macros: { protein: { unit: 'gPerKgBw', value: 1.6 }, carbs: { unit: 'pctEnergy', value: 45 }, fat: { unit: 'remainder' } }, habitualTraining: true, steps: 10000, ...(stepsScope ? { stepsScope } : {}), ...(inc !== undefined ? { sessionIncludedSteps: inc } : {}) });

  it('current overlap known, habit unknown: the unresolved reference is disclosed (full/subset masks, resumed runs)', () => {
    const rp = resolveProfile(habit());
    const cs = compileSchedule(week('totalDay', 3000), rp);
    const full = runEngine(rp, cs, { record: 'daily' });
    expect(full.meta.assumptions).toContain('habitualStepsOverlapUnknown');
    expect(full.meta.assumptions).not.toContain('stepsOverlapUnknown');
    expect(runEngine(rp, cs, { record: 'daily', series: ['fatMass'] }).meta.assumptions).toContain('habitualStepsOverlapUnknown');
    const cap = runEngine(rp, cs, { record: 'daily', series: ['fatMass'], captureSnapshotAt: [3] });
    expect(runEngine(rp, cs, { record: 'daily', series: ['fatMass'], initialSnapshot: cap.snapshots![3]! }).meta.assumptions).toContain('habitualStepsOverlapUnknown');
  });

  it('current overlap unknown, habit known: only the current-day scenario is disclosed', () => {
    const rp = resolveProfile(habit({ status: 'known', includedStepsPerDay: 3000 }));
    const walk = week();
    walk.programs = [{ ...walk.programs[0]!, habitualTraining: false, exercise: [{ kind: 'cardio', modality: 'walk', startH: 7, durationMin: 30 }], stepsScope: 'totalDay' }];
    const r = runEngine(rp, compileSchedule(walk, rp), { record: 'daily' });
    expect(r.meta.assumptions).toContain('stepsOverlapUnknown');
    expect(r.meta.assumptions).not.toContain('habitualStepsOverlapUnknown');
  });

  it('known included steps on both sides with the habitual routine unchanged: the step-only reference difference is exactly 0', () => {
    const rp = resolveProfile(habit({ status: 'known', includedStepsPerDay: 3000 }));
    const cs = compileSchedule(week('totalDay', 3000), rp);
    for (const d of cs.days) expect(Math.abs(d.activityDeltaKcal!)).toBeLessThan(1e-6);
    // the same current week against an unknown habit: the no-subtraction reference scenario (never borrowed 3000 steps)
    const unk = resolveProfile(habit());
    const cu = compileSchedule(week('totalDay', 3000), unk);
    expect(cu.days[0]!.activityDeltaKcal!).toBeLessThan(-1);
  });
});

// =====================================================================================================================
describe('A1-041: the activity and muscle providers reach every run’s status sidecar', () => {
  it('full and subset runs, JSON round trip and a day-stamped continuation carry vo2max/mps/strength/rtMuscleGain statuses', () => {
    const tr: DayTemplate = { ...logged([]), observed: undefined, energy: { kind: 'pctMaintenance', pct: 100 }, macros: { protein: { unit: 'gPerKgBw', value: 1.8 }, carbs: { unit: 'pctEnergy', value: 45 }, fat: { unit: 'remainder' } }, exercise: [{ kind: 'resistance', startH: 17, volume: 'moderate' }] };
    const s = sched(6, tr);
    const full = simulate({ ...MAN35, habits: { sessionsPerWeek: 3, trainingHistory: '1to3y' } }, s, { record: 'daily' });
    const st = full.meta.outputStatus!;
    expect(st.vo2max).toMatchObject({ status: 'scenario', reasonCode: 'fitnessResponseScenario' });
    expect(st.mps).toMatchObject({ status: 'exploratory' });
    expect(st.strength).toMatchObject({ status: 'scenario' });
    expect(st.rtMuscleGain!.reasonCode).toMatch(/^growth/);
    const sub = simulate({ ...MAN35, habits: { sessionsPerWeek: 3, trainingHistory: '1to3y' } }, s, { record: 'daily', series: ['vo2max', 'rtMuscleGain'] });
    expect(sub.meta.outputStatus).toEqual({ vo2max: st.vo2max, rtMuscleGain: st.rtMuscleGain });
    expect(JSON.parse(JSON.stringify(full.meta.outputStatus))).toEqual(full.meta.outputStatus);
    const rp = resolveProfile({ ...MAN35, habits: { sessionsPerWeek: 3, trainingHistory: '1to3y' } });
    const cs = compileSchedule(s, rp);
    const cap = runEngine(rp, cs, { record: 'daily', captureSnapshotAt: [2] });
    expect(runEngine(rp, cs, { record: 'daily', initialSnapshot: cap.snapshots![2]! }).meta.outputStatus!.vo2max).toEqual(st.vo2max);
    // stub modules (no provider state) run without these statuses and without errors
    const stub = runEngine(rp, cs, { record: 'daily' }, STUB_MODULES);
    expect(stub.meta.outputStatus?.vo2max).toBeUndefined();
  });
});

// =====================================================================================================================
describe('A1-052: an out-of-domain measured baseline makes every modelled sample unsupported from index 0', () => {
  const labs = { ldlMmolL: 8.02, hdlMmolL: 1.3 };
  const rp = resolveProfile({ ...MAN35, labs, labMeta: { ldlMmolL: { source: 'manual' }, hdlMmolL: { source: 'manual' } } });
  const rx: DayTemplate = { ...logged([]), observed: undefined, energy: { kind: 'kcal', kcal: 2100 }, macros: { protein: { unit: 'g', value: 110 }, carbs: { unit: 'pctEnergy', value: 45 }, fat: { unit: 'remainder' } } };

  it('day 0 and a one-day horizon: the anchor stays exactly 8.02, the status applies from index 0; in-domain HDL stays readable', () => {
    for (const days of [1, 14]) {
      const r = runEngine(rp, compileSchedule(sched(days, rx), rp), { record: 'daily', series: ['ldl', 'hdl', 'fatMass'] });
      expect(r.initial.ldl).toBe(8.02);
      expect(r.meta.observedAnchors!.find((a) => a.series === 'ldl')!.value).toBe(8.02);
      expect(r.meta.outputStatus!.ldl).toMatchObject({ status: 'outOfDomain', fromDay: 0 });
      expect(r.meta.outputStatus?.hdl).toBeUndefined();
    }
  });

  it('a day-stamped continuation re-applies the restored anchor with the same index-0 status', () => {
    const cs = compileSchedule(sched(10, rx), rp);
    const cap = runEngine(rp, cs, { record: 'daily', series: ['ldl', 'hdl'], captureSnapshotAt: [4] });
    const cont = runEngine(rp, cs, { record: 'daily', series: ['ldl', 'hdl'], initialSnapshot: cap.snapshots![4]! });
    expect(cont.meta.outputStatus!.ldl).toMatchObject({ status: 'outOfDomain', fromDay: 0 });
    expect(cont.meta.observedAnchors!.find((a) => a.series === 'ldl')!.value).toBe(8.02);
  });
});

// =====================================================================================================================
describe('A1-049: members cross the reducer as envelopes; per-day counts, reasons and availability', () => {
  const nominal = { fatMass: new Float32Array([10, 10, 10]) };
  const env = (v: number[], extra: Partial<EnsembleMemberEnvelope> = {}): EnsembleMemberEnvelope => ({ daily: { fatMass: new Float32Array(v) }, nDays: v.length, ...extra });

  it('all members aborted after day 0: later days have no usable range, valid 0, finite storage (never NaN)', () => {
    const b = ensembleBands(nominal, undefined, [8, 9, 11, 12].map((x) => env([x, Number.NaN, Number.NaN], { aborted: { day: 0, bound: 'x', magnitude: 1 } })));
    const av = b.bandDays.fatMass!;
    expect(Array.from(av.method)).toEqual([BAND_DAY_METHOD.full, BAND_DAY_METHOD.none, BAND_DAY_METHOD.none]);
    expect(Array.from(av.valid)).toEqual([4, 0, 0]);
    expect(Array.from(av.excludedBy.aborted!)).toEqual([0, 4, 4]);
    expect(b.p50.fatMass![0]).toBeCloseTo(10, 6);
    for (const a of [b.p10.fatMass!, b.p50.fatMass!, b.p90.fatMass!]) expect(Array.from(a).every(Number.isFinite)).toBe(true);
    expect(b.bandMeta.fatMass!.draws).toBe(4); // the scalar attempted count is kept
  });

  it('one model-limited member withholds the full-ensemble band that day (unless the named valid-domain range is asked for)', () => {
    const members = [env([8, 8, 8]), env([9, 9, 9]), env([11, 11, 11], { validity: { status: 'modelLimit', validThroughHour: 35, reasonCode: 'tissueFloorModelLimit', version: 1 } })];
    const b = ensembleBands(nominal, undefined, members);
    expect(Array.from(b.bandDays.fatMass!.method)).toEqual([BAND_DAY_METHOD.full, BAND_DAY_METHOD.none, BAND_DAY_METHOD.none]);
    expect(Array.from(b.bandDays.fatMass!.excludedBy.modelLimit!)).toEqual([0, 1, 1]);
    const named = ensembleBands(nominal, undefined, members, { conditionalValidDomain: true });
    expect(named.bandDays.fatMass!.method[1]).toBe(BAND_DAY_METHOD.conditionalValid);
    expect(named.p50.fatMass![1]).toBeCloseTo(8.5, 6);
  });

  it('a member’s forbidding status is excluded although its number is finite; scenario members stay, labelled with their onset', () => {
    const b = ensembleBands(nominal, undefined, [
      env([8, 8, 8], { status: { fatMass: { status: 'outOfDomain', reasonCode: 'x', fromDay: 2 } } }),
      env([9, 9, 9], { status: { fatMass: { status: 'scenario', reasonCode: 'lowProteinSurplus', fromDay: 1, uncertaintyKind: 'scenario' } } }),
      env([11, 11, 11]),
    ]);
    const av = b.bandDays.fatMass!;
    expect(Array.from(av.valid)).toEqual([3, 3, 2]);
    expect(av.excludedBy.outOfDomain![2]).toBe(1);
    expect(av.method[2]).toBe(BAND_DAY_METHOD.none);
    expect(av).toMatchObject({ status: 'scenario', fromDay: 1, reasonCode: 'lowProteinSurplus', uncertaintyKind: 'scenario' });
  });

  it('a public simulateEnsemble with abortOn: every member stops after day 0, every later day has no band and valid 0', () => {
    const s = sched(5, { ...logged([]), observed: undefined, energy: { kind: 'kcal', kcal: 1800 }, macros: { protein: { unit: 'g', value: 120 }, carbs: { unit: 'pctEnergy', value: 40 }, fat: { unit: 'remainder' } } });
    const e = simulateEnsemble(MAN35, s, { draws: 3, seed: 1, series: ['fatMass'], abortOn: [{ id: 'stop', series: 'fatMass', op: '<', value: 1e6 }] });
    const av = e.bandDays!.fatMass!;
    expect(av.method[0]).not.toBe(BAND_DAY_METHOD.none);
    for (let d = 1; d < 5; d++) {
      expect(av.method[d]).toBe(BAND_DAY_METHOD.none);
      expect(av.valid[d]).toBe(0);
      expect(Number.isFinite(e.p50.fatMass![d]!)).toBe(true);
    }
  });

  it('a member envelope carries the run’s status, validity and abort', () => {
    const r = runEngine(p, compileSchedule(sched(2, logged(energyOnly())), p), { record: 'daily', series: ['fatMass'] });
    const m = memberEnvelope(r);
    expect(m.nDays).toBe(2);
    expect(m.status!.fatMass).toMatchObject({ reasonCode: 'unknownMacroAllocation' });
  });
});

// =====================================================================================================================
describe('A1-065: selected structural modes hold in every member; stochastic parameters keep their law', () => {
  const params = buildModelParams(MODULES);
  const idx = (id: string): number => params.index.get(id)!;

  it('a caller-fixed draw-fixed value is copied into every member vector; defaults stay production in every member', () => {
    for (const [id, v] of [['muscle.growthScenarioUnknown', 1], ['muscle.eDistMode', 1], ['activity.epocRt', 0.05]] as const) {
      expect(drawKindOf(params.defs[idx(id)]!)).toBe('fixed');
      const over = Float64Array.from(params.values);
      over[idx(id)] = v;
      const vs = ensembleMemberVectors(params.defs, { count: 5, seed: 3 }, over);
      for (const m of vs) expect(m[idx(id)]).toBe(v);
    }
    const plain = ensembleMemberVectors(params.defs, { count: 5, seed: 3 });
    for (const m of plain) {
      expect(m[idx('muscle.growthScenarioUnknown')]).toBe(0);
      expect(m[idx('muscle.eDistMode')]).toBe(0);
      expect(m[idx('activity.epocRt')]).toBe(0);
    }
    // a stochastic parameter keeps its sampling law even when the full override vector carries another value
    const stoch = params.defs.findIndex((d) => drawKindOf(d) !== 'fixed');
    const over = Float64Array.from(params.values);
    over[stoch] = 12345;
    expect(ensembleMemberVectors(params.defs, { count: 4, seed: 3 }, over).every((m) => m[stoch] !== 12345)).toBe(true);
  });

  it('structuralModes reach the nominal run and every member, and are echoed; an unknown or sampled id is refused', () => {
    const s = sched(5, { ...logged([]), observed: undefined, energy: { kind: 'pctMaintenance', pct: 100 }, macros: { protein: { unit: 'gPerKgBw', value: 1.8 }, carbs: { unit: 'pctEnergy', value: 45 }, fat: { unit: 'remainder' } } });
    const modes = { 'muscle.growthScenarioUnknown': 1 };
    const e = simulateEnsemble(MAN35, s, { draws: 4, seed: 2, series: ['fatMass', 'leanTissue'], structuralModes: modes });
    expect(e.structuralModes).toEqual(modes);
    expect(e.nominal.meta.structuralModes).toEqual(modes);
    // the members run under the same mode: the band equals one built from members run with the mode explicitly
    const vs = ensembleMemberVectors(params.defs, { count: 4, seed: 2 });
    const members = vs.map((v) => memberEnvelope(simulate(MAN35, s, { record: 'daily', series: ['fatMass', 'leanTissue'], paramOverrides: v, structuralModes: modes, collectEvents: false })));
    const b = ensembleBands(e.nominal.daily, e.nominal.initial, members);
    expect(Array.from(b.p50.leanTissue!)).toEqual(Array.from(e.p50.leanTissue!));
    expect(() => simulate(MAN35, s, { structuralModes: { 'muscle.nope': 1 } })).toThrow(/unknown parameter/);
    const stoch = params.defs.find((d) => drawKindOf(d) !== 'fixed')!.id;
    expect(() => simulate(MAN35, s, { structuralModes: { [stoch]: 1 } })).toThrow(/not a structural mode/);
  });
});
