/**
 * Reusable invariant harness (MODEL_SPEC §9.1, WP-V). Every function runs the REAL engine (`runEngine`) and returns an
 * `InvariantReport` (a list of named checks with value and limit) so it can be asserted in a test, printed in a report,
 * or called by other work packages (module owners, planner, bands) on their own profile/schedule.
 *
 *   O-4  checkConservation     hourly S_h identity 1e-6 kcal, daily identity 1 kcal (engine `checks`), + O-5 mass identity
 *   O-5  checkConservation     scale = FM + FFM_act + labile water (1e-9 kg); t = 0 scale = entered weight (0.05 kg)
 *        checkSteadyState      maintenance intake for 30 d keeps weight, fat, lean, glycogen and TDEE steady
 *   O-6  checkZeroIntake       21-d / 28-d water-only: finite series, no negative pools, monotone FM, finite BHB
 *   O-7  checkDeterminism      same inputs → bit-identical results; parameter draws reproducible from the seed
 *        checkHourlyDailyAgreement   daily aggregates equal the catalogue aggregation of the hourly series
 *   O-12 checkMaintenanceDrift  a weight-stable person, habitual exerciser included, shows no drift at maintenance (30 d)
 *   O-4b checkMealFrequencyNull  1 vs 3 meals/d isocaloric: no expenditure effect (signed deposition cost, ruling B2)
 *   O-8  checkCarbFatSwap      R-NOINS: isocaloric isoprotein carbohydrate↔fat swap, 14 d
 *   O-9  checkSequenceInvariance   R-SEQ: permutations of the same weekly blocks, 12 wk
 *   O-11 measureRunMs          180-d all-module run, record 'daily'
 * Tolerances that are not in the spec (steady-state drifts) are WP-V proposals, exported as constants and overridable.
 */
import { compileSchedule } from '../../core/compileSchedule';
import { runEngine, simulateEnsemble } from '../../core/loop';
import { MODULES } from '../../core/moduleRegistry';
import { buildModelParams, sampleParams } from '../../core/paramsRegistry';
import { resolveProfile } from '../../core/resolveProfile';
import { wakeRecordHour } from '../../core/math';
import type { PersonProfile, RunOptions, Schedule, SimulationResult } from '../../types';
import { SERIES, seriesDef, type SeriesId } from '../../types/metrics';
import { buildSchedule, constantSchedule, habitualWeekSchedule, neutralMacros, pctMacros, pctProgram, waterOnlyProgram } from '../fixtures/programs';
import { DEFAULT_ARM_OPTIONS, runArm } from './run';
import type { ArmSpec } from './types';
import { ArmView } from './view';

// ------------------------------------------------------------------ report shape

export interface InvariantCheck {
  name: string;
  pass: boolean;
  /** Measured quantity (units in `unit`). */
  value: number;
  /** Limit the value was held to. */
  limit: number;
  unit: string;
  detail?: string;
  /** Advisory checks are reported but never fail the invariant (thresholds that are WP-V judgement, not spec). */
  advisory?: boolean;
}

export interface InvariantReport {
  /** Spec id, e.g. 'O-4'. */
  id: string;
  title: string;
  /** True when every check passed. */
  pass: boolean;
  checks: InvariantCheck[];
  /** Convenience: names of failed (non-advisory) checks with their value and limit. */
  failures: string[];
  /** Advisory checks that were out of range (informational). */
  advisories: string[];
}

function report(id: string, title: string, checks: InvariantCheck[]): InvariantReport {
  const fmt = (c: InvariantCheck): string => `${c.name}: ${c.value} (limit ${c.limit} ${c.unit})${c.detail ? ` - ${c.detail}` : ''}`;
  return {
    id,
    title,
    pass: checks.filter((c) => !c.advisory).every((c) => c.pass),
    checks,
    failures: checks.filter((c) => !c.advisory && !c.pass).map(fmt),
    advisories: checks.filter((c) => c.advisory && !c.pass).map(fmt),
  };
}

const le = (name: string, value: number, limit: number, unit: string, detail?: string): InvariantCheck => ({ name, pass: Number.isFinite(value) && value <= limit, value, limit, unit, ...(detail ? { detail } : {}) });

// ------------------------------------------------------------------ tolerances

/** O-4 / O-5 (spec). */
export const CONSERVATION_TOL = { hourlyKcal: 1e-6, dailyKcal: 1, massKg: 1e-9, t0Kg: 0.05 } as const;

/** Steady-state drift limits over 30 d at maintenance (WP-V proposals; the spec only says "stays steady"). */
export const STEADY_TOL = { days: 30, scaleKg: 0.3, fatKg: 0.2, leanKg: 0.2, glycogenRel: 0.05, tdeeRel: 0.02 } as const;

/** O-8 / O-9 (spec). */
export const SWAP_TOL = { fatBalanceGPerDay: 20, teeKcalPer10PctE: 50 } as const;
export const SEQUENCE_TOL = { fatKg: 0.2 } as const;

/** O-11 (spec): desktop budget, ms per 180-day run. */
/** MODEL_SPEC §9.1 O-11: planner-mode run ≤ 10 ms desktop, ≤ 50 ms phone; Simulator (simulate mode, incl. record 'full') ≤ 15 ms desktop. */
export const PERF_BUDGET_MS = { desktop: 10, phone: 50, simulate: 15 } as const;

// ------------------------------------------------------------------ helpers

function runView(profile: PersonProfile, schedule: Schedule, options: RunOptions = {}): ArmView {
  const spec: ArmSpec = { profile, schedule, options };
  const r = runArm('inv', spec);
  return new ArmView('inv', r.profile, r.compiled, r.result);
}

/** Series applicable to the persona's sex. */
function applicable(id: SeriesId, sex: 'male' | 'female'): boolean {
  const s = seriesDef(id).sexes;
  return !s || s.includes(sex);
}

/** Maintenance program at the habitual macro split for the profile's sex. */
function maintenanceFor(profile: PersonProfile) {
  return pctProgram('maintenance', 100, neutralMacros(profile.body.sex));
}

// ------------------------------------------------------------------ O-4 / O-5 conservation

/**
 * Energy and mass conservation (O-4, O-5). Runs the schedule with the engine's `checks` on.
 * hourly: eAbs − TEE_pre − DNL heat − ketone loss − ΔE_glycogen − S_h; daily: Σ S_h − (ρF+ηF)ΔFM − (ρL+ηL)ΔLT;
 * mass: scale − (FM + FFM_act + labile water); O-5: the day-0 wake-hour scale weight equals the entered (morning) weight.
 */
export function checkConservation(profile: PersonProfile, schedule: Schedule, tol: typeof CONSERVATION_TOL = CONSERVATION_TOL, options: RunOptions = {}): InvariantReport {
  const v = runView(profile, schedule, { checks: true, ...options });
  const c = v.result.meta.checks;
  const checks: InvariantCheck[] = [];
  if (!c) {
    checks.push({ name: 'checks present', pass: false, value: 0, limit: 1, unit: '', detail: 'RunOptions.checks produced no meta.checks' });
  } else {
    checks.push(le('hourly energy identity (S_h)', c.energyMaxAbsKcal, tol.hourlyKcal, 'kcal'));
    checks.push(le('daily energy identity', c.energyDayMaxAbsKcal, tol.dailyKcal, 'kcal'));
    checks.push(le('mass identity: scale = FM + FFM_act + labile water', c.massMaxAbsKg, tol.massKg, 'kg'));
  }
  // O-5 morning anchor: the day-0 wake-hour scale weight (the scale series' t = 0 value) equals the entered morning weight
  const w0 = v.initial('scaleWeight');
  checks.push(le('day-0 wake-hour scale weight = entered weight', Math.abs(w0 - v.profile.weightKg), tol.t0Kg, 'kg', `scale ${w0.toFixed(4)} vs entered ${v.profile.weightKg}`));
  return report('O-4/O-5', 'energy and mass conservation', checks);
}

// ------------------------------------------------------------------ steady state at maintenance

/** 30 d at 100 % of baseline maintenance doing the person's habitual week: everything stays where the burn-in left it. */
export function checkSteadyState(profile: PersonProfile, tol: typeof STEADY_TOL = STEADY_TOL): InvariantReport {
  const n = tol.days;
  const v = runView(profile, habitualWeekSchedule(profile, n));
  const checks: InvariantCheck[] = [];
  const drift = (id: SeriesId): number => Math.abs(v.after(id, n) - v.initial(id));
  checks.push(le('scale weight drift', drift('scaleWeight'), tol.scaleKg, 'kg'));
  checks.push(le('fat mass drift', drift('fatMass'), tol.fatKg, 'kg'));
  checks.push(le('lean tissue drift', drift('leanTissue'), tol.leanKg, 'kg'));
  const g0 = v.initial('glycogenTotal');
  checks.push(le('glycogen drift (relative)', g0 > 0 ? drift('glycogenTotal') / g0 : Number.NaN, tol.glycogenRel, 'fraction'));
  checks.push(le('mean TDEE vs baseline maintenance (relative)', Math.abs(v.mean('tdee', 0, n) / v.profile.tdee0Kcal - 1), tol.tdeeRel, 'fraction'));
  checks.push(le('mean energy balance', Math.abs(v.mean('energyBalance', 0, n)), 0.02 * v.profile.tdee0Kcal, 'kcal/d', 'intake at maintenance ⇒ balance ≈ 0'));
  return report('SS', `steady state at maintenance for ${n} d`, checks);
}

// ------------------------------------------------------------------ O-12 maintenance drift (ruling B3)

/**
 * O-12 limits (MODEL_SPEC_REVIEW B3 / MODEL_SPEC_DECISIONS): after the 14-day burn-in, a person at 100 % of baseline
 * maintenance doing exactly their habitual week does not drift. The review states |ΔFM| < 0.15 kg and |Δ scale (wake)| < 0.3 kg;
 * lean tissue is held to 0.2 kg and TDEE to ±2 % of TDEE0 (WP-V additions).
 */
export const MAINTENANCE_DRIFT_TOL = { days: 30, fatKg: 0.15, scaleKg: 0.3, leanKg: 0.2, tdeeRel: 0.02 } as const;

/** Habitual week (sessions per week from the profile) at 100 % of baseline maintenance for `tol.days` days. */
export function checkMaintenanceDrift(profile: PersonProfile, tol: typeof MAINTENANCE_DRIFT_TOL = MAINTENANCE_DRIFT_TOL): InvariantReport {
  const n = tol.days;
  const v = runView(profile, habitualWeekSchedule(profile, n));
  const drift = (id: SeriesId): number => Math.abs(v.after(id, n) - v.initial(id));
  const spw = profile.habits?.sessionsPerWeek ?? 0;
  return report('O-12', `no drift at maintenance over ${n} d (${spw} sessions/wk)`, [
    le('fat mass drift', drift('fatMass'), tol.fatKg, 'kg'),
    le('scale weight drift (wake)', drift('scaleWeight'), tol.scaleKg, 'kg'),
    le('lean tissue drift', drift('leanTissue'), tol.leanKg, 'kg'),
    le('mean TDEE vs baseline maintenance (relative)', Math.abs(v.mean('tdee', 0, n) / v.profile.tdee0Kcal - 1), tol.tdeeRel, 'fraction', `TDEE0 ${v.profile.tdee0Kcal.toFixed(0)} kcal/d`),
  ]);
}

// ------------------------------------------------------------------ O-4b meal-frequency null (deposition cost must be signed)

/**
 * Isocaloric maintenance eaten as 1 vs 3 meals/d for 14 d must not change expenditure: dossier 02 §4.4 (grade A null); a
 * rectified hourly deposition cost would leak ≈ 12 kcal/d here (review B2). Limit 15 kcal/d is a WP-V proposal.
 */
export function checkMealFrequencyNull(profile: PersonProfile, days = 14, limitKcalPerDay = 15): InvariantReport {
  const macros = neutralMacros(profile.body.sex);
  const mk = (count: number): Schedule => constantSchedule(days, pctProgram(`meals${count}`, 100, macros, { meals: { count, window: { startH: 8, lengthH: count === 1 ? 0 : 12 } } }));
  const a = runView(profile, mk(3));
  const b = runView(profile, mk(1));
  const half = Math.floor(days / 2);
  const dTee = b.mean('tdee', half, days) - a.mean('tdee', half, days);
  const dFatG = (1000 * (b.after('fatMass', days) - a.after('fatMass', days))) / days;
  return report('O-4b', `meal-frequency null, 1 vs 3 meals/d, ${days} d`, [
    le('expenditure difference', Math.abs(dTee), limitKcalPerDay, 'kcal/d', `${dTee.toFixed(1)} kcal/d`),
    le('fat balance difference', Math.abs(dFatG), SWAP_TOL.fatBalanceGPerDay, 'g/d', `${dFatG.toFixed(2)} g/d`),
  ]);
}

// ------------------------------------------------------------------ O-6 zero intake

/** Pools that can never be negative (unit-based rule replaced by an explicit list: delta series such as waterWeight are excluded). */
export const NONNEGATIVE_SERIES: readonly SeriesId[] = [
  'scaleWeight',
  'fatMass',
  'leanMass',
  'leanTissue',
  'skeletalMuscle',
  'bodyFatPct',
  'glycogenTotal',
  'liverGlycogen',
  'muscleGlycogen',
  'bhb',
  'glucose',
  'insulin',
  'tdee',
  'rmr',
  'tef',
  'exerciseEE',
  'choOxidation',
  'hunger',
];

/** Water-only fast at zero intake for `days` (21 and 28 in O-6). */
export function checkZeroIntake(profile: PersonProfile, days: number): InvariantReport {
  const v = runView(profile, constantSchedule(days, waterOnlyProgram('water')), { record: 'daily' });
  const sex = v.profile.sex;
  const checks: InvariantCheck[] = [];
  const nonFinite: string[] = [];
  for (const d of SERIES) {
    const id = d.id as SeriesId;
    const a = v.daily(id);
    if (!a || !applicable(id, sex)) continue;
    for (let i = 0; i < a.length; i++) {
      if (!Number.isFinite(a[i]!)) {
        nonFinite.push(`${id}[${i}]`);
        break;
      }
    }
  }
  checks.push({ name: 'no NaN/Infinity in any recorded series', pass: nonFinite.length === 0, value: nonFinite.length, limit: 0, unit: 'series', detail: nonFinite.slice(0, 6).join(', ') });
  const negative: string[] = [];
  for (const id of NONNEGATIVE_SERIES) {
    const m = v.min(id);
    if (v.has(id) && m < 0) negative.push(`${id} min ${m}`);
  }
  checks.push({ name: 'no negative pools', pass: negative.length === 0, value: negative.length, limit: 0, unit: 'series', detail: negative.slice(0, 6).join(', ') });
  const fm = v.daily('fatMass');
  let worstRise = 0;
  if (fm) {
    let prev = v.initial('fatMass');
    for (let i = 0; i < fm.length; i++) {
      worstRise = Math.max(worstRise, fm[i]! - prev);
      prev = fm[i]!;
    }
  }
  checks.push(le('fat mass monotone (largest day-to-day rise)', worstRise, 1e-4, 'kg'));
  const dFm = v.after('fatMass', days) - v.initial('fatMass');
  checks.push({ name: 'fat mass ends below its start', pass: dFm < 0, value: dFm, limit: 0, unit: 'kg' });
  const bhbMax = v.has('bhb') ? v.max('bhb') : Number.NaN;
  checks.push({ name: 'BHB finite (max)', pass: Number.isFinite(bhbMax), value: bhbMax, limit: Number.POSITIVE_INFINITY, unit: 'mmol/L' });
  checks.push({ ...le('BHB physiological (max ≤ 12 mmol/L)', bhbMax, 12, 'mmol/L', 'advisory: dossier 05 §6 fasting ketosis 6-8 mM, alert band > 6; the 12 mM ceiling is a WP-V judgement'), advisory: true });
  checks.push({ name: 'run not aborted', pass: v.result.meta.aborted === undefined, value: v.result.meta.aborted ? v.result.meta.aborted.day : 0, limit: 0, unit: 'day' });
  return report('O-6', `water-only fast ${days} d at zero intake`, checks);
}

// ------------------------------------------------------------------ O-7 determinism

function sameFloat(a: ArrayLike<number> | undefined, b: ArrayLike<number> | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

function firstDifference(a: SimulationResult, b: SimulationResult): string | null {
  for (const id of Object.keys(a.daily) as SeriesId[]) if (!sameFloat(a.daily[id], b.daily[id])) return `daily ${id}`;
  for (const id of Object.keys(a.hourly) as SeriesId[]) if (!sameFloat(a.hourly[id], b.hourly[id])) return `hourly ${id}`;
  for (const id of Object.keys(a.safety) as (keyof SimulationResult['safety'])[]) if (!sameFloat(a.safety[id], b.safety[id])) return `safety ${id}`;
  if (JSON.stringify(a.initial) !== JSON.stringify(b.initial)) return 'initial';
  if (JSON.stringify(a.final) !== JSON.stringify(b.final)) return 'final';
  if (JSON.stringify(a.events) !== JSON.stringify(b.events)) return 'events';
  if (JSON.stringify(a.warnings) !== JSON.stringify(b.warnings)) return 'warnings';
  return null;
}

/**
 * Same inputs → bit-identical outputs in one JS engine; draws reproducible from the seed; `record` mode must not change
 * the daily values. Each run compiles the schedule again so no cached state can hide a difference.
 */
export function checkDeterminism(profile: PersonProfile, schedule: Schedule): InvariantReport {
  const run = (o: RunOptions): SimulationResult => {
    const rp = resolveProfile(profile);
    return runEngine(rp, compileSchedule(schedule, rp), { ...DEFAULT_ARM_OPTIONS, ...o });
  };
  const checks: InvariantCheck[] = [];
  const a = run({ record: 'full' });
  const b = run({ record: 'full' });
  const d1 = firstDifference(a, b);
  checks.push({ name: 'two full runs are bit-identical', pass: d1 === null, value: d1 === null ? 0 : 1, limit: 0, unit: 'differences', ...(d1 ? { detail: d1 } : {}) });
  const c = run({ record: 'daily' });
  let modeDiff: string | null = null;
  for (const id of Object.keys(c.daily) as SeriesId[]) if (!sameFloat(a.daily[id], c.daily[id])) modeDiff = id;
  checks.push({ name: "record 'daily' equals record 'full' (daily series)", pass: modeDiff === null, value: modeDiff === null ? 0 : 1, limit: 0, unit: 'differences', ...(modeDiff ? { detail: modeDiff } : {}) });

  const defs = buildModelParams(MODULES).defs;
  const v1 = sampleParams(defs, { count: 3, seed: 20260930 });
  const v2 = sampleParams(defs, { count: 3, seed: 20260930 });
  checks.push({ name: 'parameter draws reproducible from the seed', pass: v1.every((v, i) => sameFloat(v, v2[i])), value: 0, limit: 0, unit: 'differences' });
  const v3 = sampleParams(defs, { count: 3, seed: 20260931 });
  const varies = defs.some((d) => d.low < d.high);
  if (varies) checks.push({ name: 'a different seed gives different draws', pass: v1.some((v, i) => !sameFloat(v, v3[i])), value: 1, limit: 1, unit: 'flag' });
  const p1 = run({ paramOverrides: v1[0]!, record: 'daily' });
  const p2 = run({ paramOverrides: v1[0]!, record: 'daily' });
  const d2 = firstDifference(p1, p2);
  checks.push({ name: 'runs with the same parameter vector are bit-identical', pass: d2 === null, value: d2 === null ? 0 : 1, limit: 0, unit: 'differences', ...(d2 ? { detail: d2 } : {}) });

  const rp = resolveProfile(profile);
  const cs = compileSchedule(schedule, rp);
  const e1 = simulateEnsemble(rp, cs, { draws: 3, seed: 11, record: 'daily' });
  const e2 = simulateEnsemble(rp, cs, { draws: 3, seed: 11, record: 'daily' });
  let ensDiff: string | null = null;
  for (const id of Object.keys(e1.p10) as SeriesId[]) if (!sameFloat(e1.p10[id], e2.p10[id]) || !sameFloat(e1.p90[id], e2.p90[id])) ensDiff = id;
  checks.push({ name: 'ensemble bands reproducible from the seed', pass: ensDiff === null, value: ensDiff === null ? 0 : 1, limit: 0, unit: 'differences', ...(ensDiff ? { detail: ensDiff } : {}) });
  return report('O-7', 'determinism', checks);
}

// ------------------------------------------------------------------ hourly → daily flux agreement

/**
 * Every hourly series must aggregate to its daily series exactly as the catalogue says ('sum', 'mean', 'min', 'max', 'end',
 * 'wake'), to Float32 rounding. Needs `record: 'full'`.
 */
export function checkHourlyDailyAgreement(profile: PersonProfile, schedule: Schedule, relTol = 1e-5): InvariantReport {
  const v = runView(profile, schedule, { record: 'full' });
  const checks: InvariantCheck[] = [];
  const nDays = v.nDays;
  let compared = 0;
  for (const id of Object.keys(v.result.hourly) as SeriesId[]) {
    const h = v.hourly(id);
    const d = v.daily(id);
    if (!h || !d) continue;
    const agg = seriesDef(id).agg;
    let worst = 0;
    for (let day = 0; day < nDays; day++) {
      const base = day * 24;
      let expected: number;
      if (agg === 'sum' || agg === 'mean') {
        let s = 0;
        for (let k = 0; k < 24; k++) s += h[base + k]!;
        expected = agg === 'sum' ? s : s / 24;
      } else if (agg === 'min') {
        expected = Number.POSITIVE_INFINITY;
        for (let k = 0; k < 24; k++) expected = Math.min(expected, h[base + k]!);
      } else if (agg === 'max') {
        expected = Number.NEGATIVE_INFINITY;
        for (let k = 0; k < 24; k++) expected = Math.max(expected, h[base + k]!);
      } else if (agg === 'end') {
        expected = h[base + 23]!;
      } else {
        expected = h[base + wakeRecordHour(v.compiled.days[day]!.sleepWakeH)]!;
      }
      const got = d[day]!;
      const err = Math.abs(got - expected) / (Math.abs(expected) + 1);
      if (!(err <= worst)) worst = Number.isNaN(err) ? Number.POSITIVE_INFINITY : err;
    }
    compared++;
    checks.push(le(`${id} (${agg}) daily = aggregate of 24 hourly values`, worst, relTol, 'relative'));
  }
  checks.push({ name: 'hourly series were compared', pass: compared > 0, value: compared, limit: 1, unit: 'series' });
  return report('FLUX', 'hourly-to-daily flux agreement', checks);
}

// ------------------------------------------------------------------ O-8 R-NOINS

/**
 * Isocaloric, isoprotein carbohydrate↔fat swap of `swapPctE` (carbohydrate 45 %E vs 45 − swap %E, protein fixed at 15.6 %E of identical energy)
 * at 100 % of maintenance for 14 d: 14-d fat mass differs by < 20 g/d and expenditure by < 50 kcal/d per 10 %E.
 */
export function checkCarbFatSwap(profile: PersonProfile, swapPctE: number, days = 14): InvariantReport {
  const proteinPct = 15.6;
  const base = 45;
  const mk = (carbPct: number): Schedule => constantSchedule(days, pctProgram(`carb${carbPct}`, 100, pctMacros(proteinPct, carbPct)));
  const a = runView(profile, mk(base));
  const b = runView(profile, mk(base - swapPctE));
  const dFatGPerDay = (1000 * (b.after('fatMass', days) - a.after('fatMass', days))) / days;
  const dTee = b.mean('tdee', Math.floor(days / 2), days) - a.mean('tdee', Math.floor(days / 2), days);
  return report('O-8', `R-NOINS carbohydrate ↔ fat swap of ${swapPctE} %E, ${days} d`, [
    le('fat balance difference', Math.abs(dFatGPerDay), SWAP_TOL.fatBalanceGPerDay, 'g/d', `${dFatGPerDay.toFixed(2)} g/d`),
    le('expenditure difference per swap', Math.abs(dTee), (SWAP_TOL.teeKcalPer10PctE * Math.abs(swapPctE)) / 10, 'kcal/d', `${dTee.toFixed(1)} kcal/d`),
  ]);
}

// ------------------------------------------------------------------ O-9 R-SEQ

/** One weekly block: energy as % of maintenance and protein in g/kg body weight (fat = remainder, carbohydrate 45 %E). */
export interface WeekBlock {
  pct: number;
  proteinGPerKg: number;
}

/** Default blocks of O-9: same weekly energy and protein set in different orders (mean energy 100 %). */
export const SEQUENCE_BLOCKS: readonly WeekBlock[] = [
  { pct: 75, proteinGPerKg: 1.2 },
  { pct: 100, proteinGPerKg: 1.6 },
  { pct: 125, proteinGPerKg: 2.0 },
  { pct: 100, proteinGPerKg: 1.6 },
];

/** Orders (indices into the block list) tested by default: cyclic, reversed, sorted, interleaved. */
export const SEQUENCE_ORDERS: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3],
  [3, 2, 1, 0, 3, 2, 1, 0, 3, 2, 1, 0],
  [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3],
  [2, 0, 3, 1, 1, 3, 0, 2, 0, 2, 1, 3],
];

/** 12 weeks of the same weekly blocks in different orders: end fat mass must agree within `tol` kg. */
export function checkSequenceInvariance(profile: PersonProfile, blocks: readonly WeekBlock[] = SEQUENCE_BLOCKS, orders: readonly (readonly number[])[] = SEQUENCE_ORDERS, tol = SEQUENCE_TOL.fatKg): InvariantReport {
  const programs = blocks.map((b, i) => pctProgram(`week${i}`, b.pct, { protein: { unit: 'gPerKgBw', value: b.proteinGPerKg }, carbs: { unit: 'pctEnergy', value: 45 }, fat: { unit: 'remainder' } }));
  const ends: number[] = [];
  for (const order of orders) {
    const sched = buildSchedule({ days: order.length * 7, programs, use: (d) => order[Math.floor(d / 7)] as number });
    const v = runView(profile, sched);
    ends.push(v.after('fatMass', order.length * 7));
  }
  const spread = Math.max(...ends) - Math.min(...ends);
  return report('O-9', `R-SEQ permutations of weekly blocks, ${orders[0]!.length} wk`, [le('end fat mass spread across orders', spread, tol, 'kg', ends.map((x) => x.toFixed(3)).join(' / '))]);
}

// ------------------------------------------------------------------ O-11 performance

export interface PerfResult {
  /** Best and median engine time over the runs, ms (RunOptions.checks off, record 'daily'). */
  bestMs: number;
  medianMs: number;
  runs: number;
}

/** Times `runs` warm 180-day runs (default profile/schedule: MAN-like maintenance) and returns best/median `meta.runtimeMs`. */
export function measureRunMs(profile: PersonProfile, days = 180, runs = 7): PerfResult {
  const rp = resolveProfile(profile);
  const cs = compileSchedule(constantSchedule(days, maintenanceFor(profile)), rp);
  runEngine(rp, cs, { record: 'daily', checks: false }); // warm-up (JIT, params cache)
  const t: number[] = [];
  for (let i = 0; i < runs; i++) t.push(runEngine(rp, cs, { record: 'daily', checks: false }).meta.runtimeMs);
  t.sort((x, y) => x - y);
  return { bestMs: t[0]!, medianMs: t[Math.floor(t.length / 2)]!, runs };
}
