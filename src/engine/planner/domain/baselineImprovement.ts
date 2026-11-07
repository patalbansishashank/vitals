/** A bounded, paired comparison against one frozen user schedule. This is scenario analysis, not prescription. */
import type { Schedule, DayTemplate, MealPlan } from '../../types/schedule';
import type { SimulationResult } from '../../types/result';
import { compileSchedule } from '../../core/compileSchedule';
import { mergeDay } from './dayMath';
import { compileRequest } from './context';
import { EnginePlanModel, MARGIN_IDS, REQUIRED_SAFETY_MARGINS, missingStateMargins, stateMargins } from './model';
import { reviewMuscleRetention } from './muscleRetention';
import { evaluatePlanSafety } from './safetyAudit';
import { generateBaselineTrainingVariants, type BaselineTrainingVariant } from './baselineTraining';
import type { PlannerRequest } from './types';

export type ImprovementFamily = 'baseline' | 'mealTiming' | 'carbCycle' | 'energyCycle' | 'flatMacroControl' | 'lowCarbRest' | 'higherProtein' | 'trainingChange' | 'trainingPlusProtein';
type NutritionItem = { id: string; family: ImprovementFamily; schedule: Schedule; comparatorId: string };
type FamilyItem = NutritionItem & { nutritionFamily: ImprovementFamily; trainingVariantId: string | null; nutritionControlId?: string; exerciseControlId?: string; trainingDetails?: ImprovementCandidate['trainingDetails'] };
export interface ImprovementCandidate {
  id: string;
  family: ImprovementFamily;
  /** Original nutrition factor, retained when crossed with a materialized training variant. */
  nutritionFamily: ImprovementFamily;
  trainingVariantId: string | null;
  schedule: Schedule;
  comparatorId: string;
  /** Same resistance schedule, with the nutrition factor's declared steady/component control. */
  nutritionControlId?: string;
  /** Same nutrition schedule with the original resistance prescription. */
  exerciseControlId?: string;
  nominal: ImprovementEndpoint;
  paired?: PairedComparison;
  vsBaseline?: PairedComparison;
  vsMatchedMacroControl?: PairedComparison;
  vsSameTrainingNutritionControl?: PairedComparison;
  /** Training variant versus the original exercise at the same calorie/protein target. */
  vsExerciseMatchedControl?: PairedComparison;
  trainingDetails?: { sourceVariantId: string; provenance: unknown; trainingMinutesByDay: unknown; countedSetsByRegionByWeek: unknown; unfulfilledTargets: unknown; doseTradeoffsVsBalanced?: unknown };
  policy: PolicyReview;
  conservation: { energyKcalDelta: number; proteinGDelta: number; horizonEnergyKcalDelta: number; horizonProteinGDelta: number; weeklyEnergyKcalDelta: number[]; weeklyProteinGDelta: number[]; weeklyFatGDeltaFromComparator: number[]; compiledWeeklyDeltaFromComparator: Array<{ energyKcal: number; proteinG: number; fatG: number; netCarbG: number; fibreG: number }>; matchedCompiledWeekly: boolean };
  auditedDraws: number;
}
export interface ImprovementEndpoint {
  fatMassKg: number | null;
  /** Engine wake-hour body-fat percentage; not recomputed from end-of-day fat and wake scale weight. */
  bodyFatPct: number | null;
  initialFatMassKg: number | null;
  fatLossKg: number | null;
  skeletalMuscleKg: number | null;
  initialSkeletalMuscleKg: number | null;
  skeletalMuscleChangeKg: number | null;
  minimumSkeletalMuscleKg: number | null;
  scaleWeightKg: number | null;
  glycogenWaterKg: number | null;
  muscleGlycogenG: number | null;
  bhbMmolL: number | null;
  meanDailyBhbMmolL: number | null;
  daysMeanBhbAtLeast0Point5: number | null;
  status: 'available' | 'unavailable';
}
export interface PairedComparison {
  draws: number;
  validDraws: number;
  meanFatDeltaKg: number | null;
  meanMuscleDeltaKg: number | null;
  fatDeltaRangeKg: [number, number] | null;
  muscleDeltaRangeKg: [number, number] | null;
  /** All 32 paired members are nonworse; mean fat or skeletal-muscle advantage is at least the declared 0.1 kg reporting threshold. */
  dominatesComparator: boolean;
  allMembersNonWorse: boolean;
  membersWithinMuscleBudget: number | null;
}
export interface PolicyReview {
  status: 'blocked' | 'notEstablished';
  failedMargins: string[];
  missingMargins: string[];
  muscleRetention: 'withinBudget' | 'overBudget' | 'unavailable' | 'notRequested';
  inputPolicyStatus: string;
  inputPolicyFailures: string[];
}
export interface BaselineImprovementResult {
  status: 'complete' | 'unsupportedBaseline';
  reason?: string;
  candidates: ImprovementCandidate[];
  evaluatedNominal: number;
  evaluatedDraws: number;
  auditSeed: string | number;
  auditMembers: number;
  energyCycleBounds: EnergyCycleBounds | null;
  family: string;
  evidenceAssumptions: string[];
  /** This solver issues no adoption certificate, so it only emits the diagnostic or no-improvement variants. */
  verdict: 'diagnosticModelImprovementFound' | 'modelPolicyFeasibleImprovementFound' | 'noPairedImprovementFound' | 'unavailable';
  trainingUnavailableReason?: string | null;
  baselineDominatorIds: string[];
  paretoFrontierIds: string[];
  diagnosticRankedIds: string[];
  bestDiagnosticCandidateId: string | null;
  bestFatLossDiagnosticId: string | null;
  bestMuscleWithoutLessFatDiagnosticId: string | null;
  noGlobalOptimum: true;
}
export interface BaselineImprovementInput {
  request: PlannerRequest;
  baseline: Schedule;
  seed?: string | number;
  /** Same declared parameter members are used for every candidate and its comparators. Default 32. */
  auditMembers?: number;
  /** Add up to two materialized training improvements, at baseline and capped-higher protein. Default true. */
  includeTrainingChanges?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: { completed: number; total: number; candidateId: string }) => void;
}

const round = (n: number) => Math.round(n * 1e9) / 1e9;
export interface EnergyCycleBounds {
  sourceDailyKcal: number;
  diagnosticDayFloorKcal: 1200;
  maxShiftKcal: number;
  halfShiftKcal: number;
  shiftsKcal: number[];
  mixedWeekBounds: Array<{ week: number; resistanceDays: number; otherDays: number; maxShiftKcal: number }>;
  dayTargets: Array<{ shiftKcal: number; resistanceKcal: number; otherKcalMin: number; otherKcalMax: number }>;
}
export function improvementEndpoint(sim: SimulationResult, expectedDays: number): ImprovementEndpoint {
  const complete = sim.meta.nDays === expectedDays && !sim.meta.aborted && (sim.meta.startDay ?? 0) === 0 && (!sim.meta.validity || sim.meta.validity.status === 'valid') && sim.daily.fatMass?.length === expectedDays && sim.daily.skeletalMuscle?.length === expectedDays && Array.from(sim.daily.fatMass).every(Number.isFinite) && Array.from(sim.daily.skeletalMuscle).every(Number.isFinite);
  const last = (id: 'fatMass' | 'bodyFatPct' | 'skeletalMuscle' | 'scaleWeight' | 'glycogenWater' | 'muscleGlycogen' | 'bhb'): number | null => {
    const a = sim.daily[id];
    if (!complete || a?.length !== expectedDays || !Number.isFinite(a[a.length - 1])) return null;
    const status = sim.meta.outputStatus?.[id]?.status;
    const fromDay = sim.meta.outputStatus?.[id]?.fromDay ?? 0;
    if (status && fromDay < expectedDays && !['estimated', 'predicted', 'scenario', 'conditional'].includes(status)) return null;
    return a[a.length - 1]!;
  };
  const fatMassKg = last('fatMass');
  const skeletalMuscleKg = last('skeletalMuscle');
  const initialFatMassKg = Number.isFinite(sim.initial.fatMass) ? sim.initial.fatMass! : null;
  const initialSkeletalMuscleKg = Number.isFinite(sim.initial.skeletalMuscle) ? sim.initial.skeletalMuscle! : null;
  const sm = sim.daily.skeletalMuscle;
  const minimumSkeletalMuscleKg = complete && sm?.length && Array.from(sm).every(Number.isFinite) ? Math.min(...sm) : null;
  const bhb = sim.daily.bhb;
  const meanDailyBhbMmolL = bhb?.length && Array.from(bhb).every(Number.isFinite) ? Array.from(bhb).reduce((a, b) => a + b, 0) / bhb.length : null;
  const daysMeanBhbAtLeast0Point5 = bhb?.length && Array.from(bhb).every(Number.isFinite) ? Array.from(bhb).filter((v) => v >= 0.5).length : null;
  return { fatMassKg, bodyFatPct: last('bodyFatPct'), initialFatMassKg, fatLossKg: fatMassKg !== null && initialFatMassKg !== null ? initialFatMassKg - fatMassKg : null, skeletalMuscleKg, initialSkeletalMuscleKg, skeletalMuscleChangeKg: skeletalMuscleKg !== null && initialSkeletalMuscleKg !== null ? skeletalMuscleKg - initialSkeletalMuscleKg : null, minimumSkeletalMuscleKg, scaleWeightKg: last('scaleWeight'), glycogenWaterKg: last('glycogenWater'), muscleGlycogenG: last('muscleGlycogen'), bhbMmolL: last('bhb'), meanDailyBhbMmolL, daysMeanBhbAtLeast0Point5, status: fatMassKg === null || skeletalMuscleKg === null ? 'unavailable' : 'available' };
}

function effectiveDay(schedule: Schedule, day: number): DayTemplate {
  const d = schedule.days[day]!;
  return mergeDay(schedule.programs[d.program]!, d.override);
}
function fixedIntake(schedule: Schedule): { kcal: number; proteinG: number; fatG: number; rtDays: number[]; restDays: number[] } | null {
  if (schedule.events?.length || schedule.days.length !== schedule.horizonDays) return null;
  const rtDays: number[] = [], restDays: number[] = [];
  let kcal = NaN, proteinG = NaN, fatG = NaN;
  for (let d = 0; d < schedule.horizonDays; d++) {
    const p = effectiveDay(schedule, d);
    const e = p.energy, pr = p.macros.protein, f = p.macros.fat;
    if (e.kind !== 'kcal' || pr.unit !== 'g' || f.unit !== 'g' || p.macros.carbs.unit !== 'remainder' || p.macros.carbShareNonProtein !== undefined) return null;
    if (d === 0) { kcal = e.kcal; proteinG = pr.value; fatG = f.value; }
    if (e.kcal !== kcal || pr.value !== proteinG || f.value !== fatG) return null;
    ((p.exercise ?? []).some((x) => x.kind === 'resistance') ? rtDays : restDays).push(d);
  }
  if (!(kcal > 0 && proteinG > 0 && fatG > 0) || !rtDays.length || !restDays.length) return null;
  return { kcal, proteinG, fatG, rtDays, restDays };
}

/** Largest integer lifting-day shift compatible with every mixed calendar week and the declared diagnostic floor. */
export function deriveEnergyCycleBounds(baseline: Schedule): EnergyCycleBounds | null {
  const fixed = fixedIntake(baseline);
  if (!fixed) return null;
  const mixedWeekBounds: EnergyCycleBounds['mixedWeekBounds'] = [];
  for (let week = 0; week < Math.ceil(baseline.horizonDays / 7); week++) {
    const start = week * 7, end = Math.min(start + 7, baseline.horizonDays);
    let resistanceDays = 0;
    for (let d = start; d < end; d++) if ((effectiveDay(baseline, d).exercise ?? []).some((x) => x.kind === 'resistance')) resistanceDays++;
    const otherDays = end - start - resistanceDays;
    if (!resistanceDays || !otherDays) continue;
    mixedWeekBounds.push({ week, resistanceDays, otherDays, maxShiftKcal: Math.max(0, Math.floor((fixed.kcal - 1200) * otherDays / resistanceDays)) });
  }
  const maxShiftKcal = mixedWeekBounds.length ? Math.min(...mixedWeekBounds.map((w) => w.maxShiftKcal)) : 0;
  const halfShiftKcal = Math.floor(maxShiftKcal / 2);
  const shiftsKcal = [...new Set([0, halfShiftKcal, maxShiftKcal])].sort((a, b) => a - b);
  const dayTargets = shiftsKcal.map((shiftKcal) => ({
    shiftKcal,
    resistanceKcal: fixed.kcal + shiftKcal,
    otherKcalMin: mixedWeekBounds.length ? Math.min(...mixedWeekBounds.map((w) => fixed.kcal - Math.ceil(shiftKcal * w.resistanceDays / w.otherDays))) : fixed.kcal,
    otherKcalMax: mixedWeekBounds.length ? Math.max(...mixedWeekBounds.map((w) => fixed.kcal - Math.floor(shiftKcal * w.resistanceDays / w.otherDays))) : fixed.kcal,
  }));
  return { sourceDailyKcal: fixed.kcal, diagnosticDayFloorKcal: 1200, maxShiftKcal, halfShiftKcal, shiftsKcal, mixedWeekBounds, dayTargets };
}

function modify(schedule: Schedule, id: string, family: ImprovementFamily, change: (p: DayTemplate, rt: boolean, day: number) => Pick<DayTemplate, 'energy' | 'macros' | 'meals'>): { id: string; family: ImprovementFamily; schedule: Schedule; comparatorId: string } {
  const days = schedule.days.map((day, d) => {
    const p = effectiveDay(schedule, d);
    const rt = (p.exercise ?? []).some((x) => x.kind === 'resistance');
    return { ...day, override: { ...day.override, ...change(p, rt, d) } };
  });
  return { id, family, schedule: { ...schedule, days }, comparatorId: 'baseline' };
}

/** Exported for exact arithmetic and exercise-preservation tests; no simulation or hidden search. */
export function declaredImprovementFamily(baseline: Schedule, proteinTargetG?: number): Array<{ id: string; family: ImprovementFamily; schedule: Schedule; comparatorId: string }> {
  const input = fixedIntake(baseline);
  if (!input) return [];
  const { kcal, proteinG, fatG } = input;
  const cycleBounds = deriveEnergyCycleBounds(baseline)!;
  const n = baseline.horizonDays;
  const isRt = Array.from({ length: n }, (_, d) => (effectiveDay(baseline, d).exercise ?? []).some((x) => x.kind === 'resistance'));
  const weeks = Array.from({ length: Math.ceil(n / 7) }, (_, w) => {
    const ds = Array.from({ length: Math.min(7, n - 7 * w) }, (_, i) => 7 * w + i);
    const nr = ds.filter((d) => isRt[d]).length;
    return { ds, nr, nn: ds.length - nr };
  });
  const timing: MealPlan = { meals: [{ clockH: 9, share: 0.2 }, { clockH: 16, share: 0.35 }, { clockH: 19.5, share: 0.45 }] };
  const macro = (p: DayTemplate, energy: number, protein: number, fat: number, meals = p.meals) => ({ energy: { kind: 'kcal' as const, kcal: energy }, macros: { ...p.macros, protein: { unit: 'g' as const, value: protein }, fat: { unit: 'g' as const, value: fat } }, meals });
  const energyAt = (shift: number, d: number): number => {
    if (!shift) return kcal;
    const w = weeks[Math.floor(d / 7)]!;
    if (!w.nr || !w.nn) return kcal;
    if (isRt[d]) return kcal + shift;
    const restOrdinal = w.ds.filter((i) => i < d && !isRt[i]).length;
    const reduction = shift * w.nr;
    const q = Math.floor(reduction / w.nn), r = reduction % w.nn;
    return kcal - q - (restOrdinal < r ? 1 : 0);
  };
  const proteinLevels = proteinTargetG && proteinTargetG > proteinG ? [proteinG, proteinTargetG] : [proteinG];
  const result: Array<{ id: string; family: ImprovementFamily; schedule: Schedule; comparatorId: string }> = [{ id: 'baseline', family: 'baseline', schedule: baseline, comparatorId: 'baseline' }];
  for (let pi = 0; pi < proteinLevels.length; pi++) {
    const protein = proteinLevels[pi]!;
    const steadyId = pi ? 'higher-protein-steady' : 'baseline';
    if (pi) result.push(modify(baseline, steadyId, 'higherProtein', (p) => macro(p, kcal, protein, fatG)));
    for (const shift of cycleBounds.shiftsKcal) {
      const baseId = `p${pi}-e${shift}`;
      if (shift) {
        const balanced = modify(baseline, `${baseId}-balanced`, 'energyCycle', (p, _rt, d) => macro(p, energyAt(shift, d), protein, fatG));
        balanced.comparatorId = steadyId;
        result.push(balanced);
      }
      // The low-carbohydrate rest-day option has 30 g fat on resistance days. Rest-day fat takes the
      // isocaloric remainder after protein and at most 50 g net carbohydrate, provided this is feasible.
      const fatAt = (d: number): number => {
        const w = weeks[Math.floor(d / 7)]!;
        if (!w.nr || !w.nn || isRt[d]) return fatG;
        return Math.max(fatG, (energyAt(shift, d) - 4 * protein - 4 * 50) / 9);
      };
      const lowId = `${baseId}-lowcarb-rest`;
      const controlId = `${baseId}-flat-macro-control`;
      const control = modify(baseline, controlId, 'flatMacroControl', (p, _rt, d) => {
        const w = weeks[Math.floor(d / 7)]!;
        const averageFat = w.ds.reduce((sum, i) => sum + fatAt(i), 0) / w.ds.length;
        return macro(p, kcal, protein, averageFat);
      });
      control.comparatorId = steadyId;
      result.push(control);
      const low = modify(baseline, lowId, 'lowCarbRest', (p, _rt, d) => macro(p, energyAt(shift, d), protein, fatAt(d)));
      low.comparatorId = controlId;
      result.push(low);
    }
  }
  const timed = modify(baseline, 'timing-rt', 'mealTiming', (p, rt) => macro(p, kcal, proteinG, fatG, rt ? timing : p.meals));
  result.push(timed);
  if (proteinLevels.length > 1) {
    const maxLowCarbId = `p1-e${cycleBounds.maxShiftKcal}-lowcarb-rest`;
    const combined = modify(baseline, `${maxLowCarbId}-timed`, 'mealTiming', (p, rt, d) => {
      const source = result.find((c) => c.id === maxLowCarbId);
      const recipe = source ? effectiveDay(source.schedule, d) : p;
      return macro(recipe, recipe.energy.kind === 'kcal' ? recipe.energy.kcal : kcal, proteinLevels[1]!, recipe.macros.fat.unit === 'g' ? recipe.macros.fat.value : fatG, rt ? timing : p.meals);
    });
    combined.comparatorId = maxLowCarbId;
    result.push(combined);
  }
  return result.filter((c) => {
    for (let d = 0; d < n; d++) {
      const p = effectiveDay(c.schedule, d);
      const f = p.macros.fat;
      if (p.energy.kind !== 'kcal' || p.energy.kcal < 1200 || f.unit !== 'g' || f.value < 30 || 4 * (p.macros.protein.unit === 'g' ? p.macros.protein.value : 0) + 9 * f.value >= p.energy.kcal) return false;
    }
    return true;
  });
}

/** Exact cross of declared nutrition rows and materialized training rows; original baseline object stays untouched. */
export function crossImprovementFamily(nutrition: readonly NutritionItem[], trainingVariants: readonly BaselineTrainingVariant[]): FamilyItem[] {
  const family: FamilyItem[] = nutrition.map((c) => ({ ...c, nutritionFamily: c.family, trainingVariantId: null, ...(c.id === 'baseline' ? {} : { nutritionControlId: c.comparatorId }) }));
  for (const v of trainingVariants.slice(0, 2)) {
    const details = { sourceVariantId: v.id, provenance: v.provenance, trainingMinutesByDay: v.trainingMinutesByDay, countedSetsByRegionByWeek: v.countedSetsByRegionByWeek, unfulfilledTargets: v.unfulfilledTargets, doseTradeoffsVsBalanced: v.doseTradeoffsVsBalanced };
    for (const c of nutrition) {
      const id = `training-${v.id}__${c.id}`;
      const days = c.schedule.days.map((day, d) => ({ ...day, override: { ...day.override, exercise: effectiveDay(v.schedule, d).exercise } }));
      const schedule: Schedule = { ...c.schedule, days };
      const nutritionControlId = c.id === 'baseline' ? undefined : `training-${v.id}__${c.comparatorId}`;
      const p0 = effectiveDay(nutrition[0]!.schedule, 0).macros.protein;
      const pc = effectiveDay(c.schedule, 0).macros.protein;
      const proteinChanged = p0.unit === 'g' && pc.unit === 'g' && pc.value > p0.value + 1e-6;
      family.push({ id, family: proteinChanged ? 'trainingPlusProtein' : 'trainingChange', nutritionFamily: c.family, trainingVariantId: v.id, schedule, comparatorId: nutritionControlId ?? id, ...(nutritionControlId ? { nutritionControlId } : {}), exerciseControlId: c.id, trainingDetails: details });
    }
  }
  if (family.length > 60) throw new Error(`Declared family exceeded 60 schedules (${family.length})`);
  return family;
}

function conservation(baseline: Schedule, schedule: Schedule, comparator: Schedule, profile: ReturnType<typeof compileRequest>['rp']) {
  let energy = 0, protein = 0;
  const weeklyEnergyKcalDelta: number[] = [], weeklyProteinGDelta: number[] = [], weeklyFatGDeltaFromComparator: number[] = [];
  for (let d = 0; d < baseline.horizonDays; d++) {
    const a = effectiveDay(baseline, d), b = effectiveDay(schedule, d), c = effectiveDay(comparator, d);
    if (a.energy.kind !== 'kcal' || b.energy.kind !== 'kcal' || a.macros.protein.unit !== 'g' || b.macros.protein.unit !== 'g' || b.macros.fat.unit !== 'g' || c.macros.fat.unit !== 'g') throw new Error('Unsupported intake form');
    const w = Math.floor(d / 7);
    const de = b.energy.kcal - a.energy.kcal, dp = b.macros.protein.value - a.macros.protein.value;
    energy += de; protein += dp;
    weeklyEnergyKcalDelta[w] = (weeklyEnergyKcalDelta[w] ?? 0) + de;
    weeklyProteinGDelta[w] = (weeklyProteinGDelta[w] ?? 0) + dp;
    weeklyFatGDeltaFromComparator[w] = (weeklyFatGDeltaFromComparator[w] ?? 0) + b.macros.fat.value - c.macros.fat.value;
  }
  const a = compileSchedule(schedule, profile).days, b = compileSchedule(comparator, profile).days;
  const compiledWeeklyDeltaFromComparator = Array.from({ length: Math.ceil(baseline.horizonDays / 7) }, (_, w) => {
    const delta = (field: 'energyKcal' | 'proteinG' | 'fatG' | 'carbG' | 'fibreG') => round(a.slice(w * 7, w * 7 + 7).reduce((s, d) => s + d[field], 0) - b.slice(w * 7, w * 7 + 7).reduce((s, d) => s + d[field], 0));
    return { energyKcal: delta('energyKcal'), proteinG: delta('proteinG'), fatG: delta('fatG'), netCarbG: delta('carbG'), fibreG: delta('fibreG') };
  });
  const matchedCompiledWeekly = compiledWeeklyDeltaFromComparator.every((w) => Object.values(w).every((v) => Math.abs(v) < 1e-6));
  return { energyKcalDelta: round(energy), proteinGDelta: round(protein), horizonEnergyKcalDelta: round(energy), horizonProteinGDelta: round(protein), weeklyEnergyKcalDelta: weeklyEnergyKcalDelta.map(round), weeklyProteinGDelta: weeklyProteinGDelta.map(round), weeklyFatGDeltaFromComparator: weeklyFatGDeltaFromComparator.map(round), compiledWeeklyDeltaFromComparator, matchedCompiledWeekly };
}

function policy(ctx: ReturnType<typeof compileRequest>, sim: SimulationResult, schedule: Schedule): PolicyReview {
  const margins = stateMargins(ctx, sim, schedule, null);
  const failedMargins = Array.from(margins, (v, i) => v < 0 ? MARGIN_IDS[i] : null).filter((x): x is NonNullable<typeof x> => x != null);
  const missingIndices = new Set([...missingStateMargins(sim, ctx), ...REQUIRED_SAFETY_MARGINS.filter((i) => !Number.isFinite(margins[i]))]);
  const missingMargins: string[] = [...missingIndices].map((i) => MARGIN_IDS[i]!).filter(Boolean);
  if (sim.meta.aborted || (sim.meta.validity && sim.meta.validity.status !== 'valid')) missingMargins.push('incompleteTrajectory');
  const budget = ctx.request.constraints?.muscleRetention;
  const muscleRetention = budget ? reviewMuscleRetention(budget, sim).status : 'notRequested';
  const input = evaluatePlanSafety(ctx, schedule, sim);
  const inputPolicyFailures = [...input.validator.reasons, ...(input.validator.unchecked ?? []), ...input.exercise.reasons, ...input.evaluations.filter((e) => e.mandatory && e.status !== 'pass' && e.status !== 'notApplicable').map((e) => e.constraintId), ...input.review.filter((r) => r.mandatory).map((r) => r.id), ...input.rejected.filter((r) => r.mandatory).map((r) => r.constraintId)];
  if (ctx.caps.blocked) inputPolicyFailures.push('profileSafetyBlocked');
  return { status: failedMargins.length || missingMargins.length || muscleRetention === 'overBudget' || muscleRetention === 'unavailable' || input.status !== 'verified' || ctx.caps.blocked ? 'blocked' : 'notEstablished', failedMargins, missingMargins, muscleRetention, inputPolicyStatus: input.status, inputPolicyFailures };
}

function paired(base: ImprovementEndpoint[], trial: ImprovementEndpoint[], muscleFloorKg: number | null): PairedComparison {
  const fat: number[] = [], muscle: number[] = [];
  let membersWithinMuscleBudget = 0;
  for (let i = 0; i < Math.min(base.length, trial.length); i++) {
    const a = base[i]!, b = trial[i]!;
    if (a.fatMassKg === null || b.fatMassKg === null || a.skeletalMuscleKg === null || b.skeletalMuscleKg === null) continue;
    fat.push(b.fatMassKg - a.fatMassKg);
    muscle.push(b.skeletalMuscleKg - a.skeletalMuscleKg);
    if (muscleFloorKg !== null && b.minimumSkeletalMuscleKg !== null && b.minimumSkeletalMuscleKg >= muscleFloorKg - 1e-6) membersWithinMuscleBudget++;
  }
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const mf = fat.length ? mean(fat) : null, mm = muscle.length ? mean(muscle) : null;
  const draws = Math.min(base.length, trial.length);
  const allMembersNonWorse = fat.length === draws && fat.every((x) => x <= 1e-6) && muscle.every((x) => x >= -1e-6);
  return { draws, validDraws: fat.length, meanFatDeltaKg: mf, meanMuscleDeltaKg: mm, fatDeltaRangeKg: fat.length ? [Math.min(...fat), Math.max(...fat)] : null, muscleDeltaRangeKg: muscle.length ? [Math.min(...muscle), Math.max(...muscle)] : null, allMembersNonWorse, membersWithinMuscleBudget: muscleFloorKg === null ? null : membersWithinMuscleBudget, dominatesComparator: allMembersNonWorse && (muscleFloorKg === null || membersWithinMuscleBudget === draws) && (mf !== null && mm !== null) && (mf <= -0.1 || mm >= 0.1) };
}

/** Rank only complete, budget-respecting diagnostic scenarios; component controls attribute effects but never veto baseline dominance. */
export function diagnosticRanking(candidates: readonly ImprovementCandidate[], draws: number, muscleFloorKg: number | null): Pick<BaselineImprovementResult, 'verdict' | 'baselineDominatorIds' | 'paretoFrontierIds' | 'diagnosticRankedIds' | 'bestDiagnosticCandidateId' | 'bestFatLossDiagnosticId' | 'bestMuscleWithoutLessFatDiagnosticId'> {
  const conserved = (c: ImprovementCandidate) =>
    c.conservation.weeklyEnergyKcalDelta.every((v) => Math.abs(v) < 1e-6) &&
    (c.vsMatchedMacroControl === undefined || c.conservation.matchedCompiledWeekly);
  const eligible = candidates.filter((c) => c.id !== 'baseline' && c.nominal.status === 'available' && c.vsBaseline?.validDraws === draws && (muscleFloorKg === null || c.vsBaseline.membersWithinMuscleBudget === draws) && conserved(c));
  eligible.sort((a, b) => (a.vsBaseline!.meanFatDeltaKg! - b.vsBaseline!.meanFatDeltaKg!) || (b.vsBaseline!.meanMuscleDeltaKg! - a.vsBaseline!.meanMuscleDeltaKg!) || a.id.localeCompare(b.id));
  const diagnosticRankedIds = eligible.map((c) => c.id);
  const baselineDominatorIds = eligible.filter((c) => c.vsBaseline!.dominatesComparator).map((c) => c.id);
  const bestFatLossDiagnosticId = baselineDominatorIds[0] ?? null;
  const bestMuscleWithoutLessFatDiagnosticId = [...eligible].filter((c) => c.vsBaseline!.dominatesComparator).sort((a, b) => (b.vsBaseline!.meanMuscleDeltaKg! - a.vsBaseline!.meanMuscleDeltaKg!) || (a.vsBaseline!.meanFatDeltaKg! - b.vsBaseline!.meanFatDeltaKg!) || a.id.localeCompare(b.id))[0]?.id ?? null;
  const paretoFrontierIds = eligible.filter((c) => !eligible.some((other) => other !== c && other.vsBaseline!.meanFatDeltaKg! <= c.vsBaseline!.meanFatDeltaKg! + 1e-9 && other.vsBaseline!.meanMuscleDeltaKg! >= c.vsBaseline!.meanMuscleDeltaKg! - 1e-9 && (other.vsBaseline!.meanFatDeltaKg! < c.vsBaseline!.meanFatDeltaKg! - 1e-9 || other.vsBaseline!.meanMuscleDeltaKg! > c.vsBaseline!.meanMuscleDeltaKg! + 1e-9))).map((c) => c.id);
  return { verdict: baselineDominatorIds.length ? 'diagnosticModelImprovementFound' : 'noPairedImprovementFound', baselineDominatorIds, paretoFrontierIds, diagnosticRankedIds, bestDiagnosticCandidateId: bestFatLossDiagnosticId ?? diagnosticRankedIds[0] ?? null, bestFatLossDiagnosticId, bestMuscleWithoutLessFatDiagnosticId };
}

/** Nominal screen of the full declared family, then the same parameter draws for every candidate. */
export async function searchBaselineImprovement(input: BaselineImprovementInput): Promise<BaselineImprovementResult> {
  const { request, baseline, signal, onProgress } = input;
  const seed = input.seed ?? 'baseline-improvement/v1';
  const M = Math.max(1, Math.min(64, Math.floor(input.auditMembers ?? 32)));
  if (!fixedIntake(baseline) || baseline.startDate !== (request.startDate ?? request.profile.startDate) || baseline.horizonDays !== request.horizonDays) {
    return { status: 'unsupportedBaseline', reason: 'Requires a matching fixed-kcal, fixed-protein, fixed-fat schedule with resistance and non-resistance days.', candidates: [], evaluatedNominal: 0, evaluatedDraws: 0, auditSeed: seed, auditMembers: M, energyCycleBounds: null, family: 'Declared bounded nutrition family', evidenceAssumptions: [], verdict: 'unavailable', baselineDominatorIds: [], paretoFrontierIds: [], diagnosticRankedIds: [], bestDiagnosticCandidateId: null, bestFatLossDiagnosticId: null, bestMuscleWithoutLessFatDiagnosticId: null, noGlobalOptimum: true };
  }
  const ctx = compileRequest(request);
  // HC-M2's 35%-of-energy rule is a policy check below, not a physiological search ceiling in this diagnostic.
  // Individual renal/clinician bounds remain search ceilings, and the policy result still reports HC-M2 violations.
  const proteinTargetG = Math.floor(Math.min(
    2 * ctx.caps.weightKg,
    ctx.caps.proteinCapRw * ctx.caps.rwKg,
    ctx.caps.proteinCapGPerKgFfm * ctx.caps.ffmKg,
    ctx.caps.renal.proteinGPerDay?.cap ?? Infinity,
    ctx.caps.renal.withheld.includes('protein') ? (ctx.caps.renal.habitualProteinG ?? 0) : Infinity,
  ));
  const nutrition = declaredImprovementFamily(baseline, proteinTargetG);
  const empty: BaselineImprovementResult = { status: 'unsupportedBaseline', candidates: [], evaluatedNominal: 0, evaluatedDraws: 0, auditSeed: seed, auditMembers: M, energyCycleBounds: deriveEnergyCycleBounds(baseline), family: 'Complete declared cross of the original resistance routine and up to two materialized equipment-composed resistance variants with every nutrition candidate: baseline or up to 2 g/kg protein; baseline, half-boundary, or full-boundary resistance-day energy with exact weekly compensation; balanced or low-carbohydrate rest-day macros and steady weekly controls; two meal-timing probes. The boundary is the largest integer high-day shift keeping every mixed calendar week at or above 1200 kcal on other days; all-RT or all-rest partial weeks remain flat. At most 60 schedules; all audited with the same declared parameter members. The 1200 kcal daily search floor and 0.1 kg paired-mean reporting threshold are not clinical safety or significance thresholds.', evidenceAssumptions: ['Model scenario; parameter draws are sensitivity samples, not validated confidence intervals.', 'The diagnostic higher-protein level may exceed the current 35%-of-energy policy cap. The cap remains active in policy review and any violation blocks adoption.', 'All candidates hold weekly and whole-horizon calories against the baseline. Cycling candidates hold protein, fat, remainder carbohydrate, and fibre against their same-training nutrition control for each calendar week. Higher-protein cases deliberately change protein against the actual baseline.', 'Resistance variants alter stated resistance session dose and duration on original resistance weekdays; the exercise-matched control has identical nutrition and the original resistance prescription.', 'Model skeletal muscle is reported separately from glycogen and scale-water changes.', 'Daily BHB is an hourly-mean-derived value; counted days have a daily mean at least 0.5 mmol/L, not proven continuous ketosis.', 'Clinical policy failures block adoption even when a paired model outcome improves. No global optimum or personal guarantee is claimed.'], verdict: 'unavailable', baselineDominatorIds: [], paretoFrontierIds: [], diagnosticRankedIds: [], bestDiagnosticCandidateId: null, bestFatLossDiagnosticId: null, bestMuscleWithoutLessFatDiagnosticId: null, noGlobalOptimum: true };
  if (!nutrition.length) return { ...empty, reason: 'No candidate meets the declared energy and macro bounds.' };
  let trainingUnavailableReason: string | null = null;
  let trainingVariants: BaselineTrainingVariant[] = [];
  if (input.includeTrainingChanges !== false) {
    const training = await generateBaselineTrainingVariants(request, baseline);
    trainingUnavailableReason = training.unavailableReason;
    trainingVariants = training.variants;
  }
  const family = crossImprovementFamily(nutrition, trainingVariants);
  const model = new EnginePlanModel(ctx, { bindings: [], extraSeries: ['fatMass', 'bodyFatPct', 'skeletalMuscle', 'scaleWeight', 'glycogenWater', 'muscleGlycogen', 'bhb'], fullMode: true, recordAll: true, ensemble: { seed, size: M } });
  const candidates: ImprovementCandidate[] = [];
  const yieldNow = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const checkAbort = () => { if (signal?.aborted) throw new DOMException('Baseline improvement search cancelled', 'AbortError'); };
  for (const item of family) {
    checkAbort();
    const sim = model.simulate(item.schedule, -1);
    const comparator = family.find((c) => c.id === item.comparatorId)!.schedule;
    candidates.push({ ...item, nominal: improvementEndpoint(sim, baseline.horizonDays), policy: policy(ctx, sim, item.schedule), conservation: conservation(baseline, item.schedule, comparator, ctx.rp), auditedDraws: 0 });
    onProgress?.({ completed: candidates.length, total: family.length + family.length * M, candidateId: item.id });
    await yieldNow();
  }
  const draws = new Map<string, ImprovementEndpoint[]>();
  let completed = family.length, evaluatedDraws = 0;
  for (let m = 0; m < M; m++) {
    for (const c of candidates) {
      checkAbort();
      const e = improvementEndpoint(model.simulate(c.schedule, m), baseline.horizonDays);
      const arr = draws.get(c.id) ?? [];
      arr.push(e); draws.set(c.id, arr);
      c.auditedDraws++;
      evaluatedDraws++;
      completed++;
      onProgress?.({ completed, total: family.length + family.length * M, candidateId: c.id });
      await yieldNow();
    }
  }
  const budget = ctx.request.constraints?.muscleRetention;
  const muscleFloorKg = budget?.baseline ? budget.baseline.kg * (1 - budget.maxLossPct / 100) : null;
  for (const c of candidates) {
    c.vsBaseline = paired(draws.get('baseline') ?? [], draws.get(c.id) ?? [], muscleFloorKg);
    if (c.nutritionControlId) c.vsSameTrainingNutritionControl = paired(draws.get(c.nutritionControlId) ?? [], draws.get(c.id) ?? [], muscleFloorKg);
    if (c.nutritionFamily === 'energyCycle' || c.nutritionFamily === 'lowCarbRest' || c.nutritionFamily === 'mealTiming')
      c.vsMatchedMacroControl = c.vsSameTrainingNutritionControl;
    if (c.exerciseControlId) c.vsExerciseMatchedControl = paired(draws.get(c.exerciseControlId) ?? [], draws.get(c.id) ?? [], muscleFloorKg);
    c.paired = c.vsBaseline;
  }
  const ranking = diagnosticRanking(candidates, M, muscleFloorKg);
  return { ...empty, ...ranking, status: 'complete', candidates, evaluatedNominal: family.length, evaluatedDraws, trainingUnavailableReason };
}
