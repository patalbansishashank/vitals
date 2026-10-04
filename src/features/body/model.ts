/**
 * Pure mapping from the Your-body inputs (profile store, SI) to the engine: `BodyInputs`, `PersonProfile`, and the
 * live summary (posterior estimate with likely ranges + maintenance). No React, no DOM.
 *
 * Slider semantics (design/AVATAR_SPEC.md §10.1, dossier 14 M2/M3):
 *   body fat      → engine adiposity slider (a visual observation, σ 5.5 %BF), via the sex's FAT_ANCHORS;
 *   upper/lower   → mean = engine muscularity slider (FFMI anchors); their difference re-allocates regional muscle
 *                   (muscleTorso/muscleArms vs muscleLegs, drawing + regional state only);
 *   belly − hips  → engine belly-vs-hips axis s_b = belly − hips, clamped (ignored by the engine when the waist is measured);
 *   chest, arms   → engine avatar extras (drawing only).
 * Untouched sliders are left `undefined` (engine rule: default positions are for display only).
 */
import type { BodyEstimate, BodyInputs, BodySliders, BodyWarning, Sex } from '@/engine/body';
// the modules, not the package index: the body store reaches this file, so it is in the app's initial bundle
import { estimateInitialState } from '@/engine/body/estimateBody';
import { bodyFatToSlider } from '@/engine/body/sliders';
import type { ActivityIntake, HabitProfile, PersonProfile, PhysiologySex, TrainingHistory } from '@/engine/types/profile';
import type { SafetyBodyContext } from '@/features/onboarding/useSafetyAccess';
import type { BasicField, BodyProfileValues, ShapeInputs } from '@/state/profileStore';
import { estimateMaintenance, Z80, type MaintenanceEstimate } from './maintenance';

/* ---------------------------------------------------------------------------------------------- basics */

/**
 * Placeholder basics shown (and used) until the user enters their own: rounded adult medians
 * (≈ NHANES 2015–2018: men 175 cm / 86 kg, women 162 cm / 74 kg; age 40). Marked "typical" in the UI.
 */
export const TYPICAL_BASICS = {
  ageYears: 40,
  heightCm: { male: 175, female: 162, unspecified: 169 },
  weightKg: { male: 86, female: 74, unspecified: 80 },
} as const;

export interface EffectiveBasics {
  sex: PhysiologySex;
  ageYears: number;
  heightCm: number;
  weightKg: number;
  /** Which of sex/age/height/weight still show typical values. */
  missing: BasicField[];
}

export function effectiveBasics(v: Pick<BodyProfileValues, 'sex' | 'ageYears' | 'heightCm' | 'weightKg'>): EffectiveBasics {
  const sex: PhysiologySex = v.sex ?? 'unspecified';
  const missing: BasicField[] = [];
  if (v.sex === null) missing.push('sex');
  if (v.ageYears === null) missing.push('age');
  if (v.heightCm === null) missing.push('height');
  if (v.weightKg === null) missing.push('weight');
  return {
    sex,
    ageYears: v.ageYears ?? TYPICAL_BASICS.ageYears,
    heightCm: v.heightCm ?? TYPICAL_BASICS.heightCm[sex],
    weightKg: v.weightKg ?? TYPICAL_BASICS.weightKg[sex],
    missing,
  };
}

/**
 * The equation set for the P50 run (`PersonProfile.body.sex`). For "prefer not to say" the engine averages its
 * sex-specific forms where it can (`sexUnspecified`); the body estimate itself needs one set: female. The drawing's
 * frame is never read here (body-figure-v2.md §5.4). TODO(engine): estimateInitialState has no 'unspecified' mode, so
 * the Simulator's starting body fat can differ from the averaged estimate shown here.
 */
export function equationSex(v: Pick<BodyProfileValues, 'sex'>): Sex {
  return v.sex === 'male' ? 'male' : 'female';
}

/** Sexes whose estimates are averaged for display: both for "prefer not to say" (and before a choice). */
export function displaySexes(v: Pick<BodyProfileValues, 'sex'>): Sex[] {
  return v.sex === 'male' || v.sex === 'female' ? [v.sex] : ['male', 'female'];
}

/* ---------------------------------------------------------------------------------------------- sliders */

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const defined = <T>(x: T | undefined): x is T => x !== undefined;

/** Overall muscularity (engine 0…1) the user expressed, or undefined when neither muscle scale was touched. */
export function touchedMuscularity(shape: ShapeInputs): number | undefined {
  const m = [shape.muscleUpper, shape.muscleLower].filter(defined);
  return m.length ? m.reduce((a, b) => a + b, 0) / m.length : undefined;
}

/** Upper-minus-lower muscle difference → regional muscle sliders (only when both scales were touched). */
export function regionalMuscle(shape: ShapeInputs): number | undefined {
  if (shape.muscleUpper === undefined || shape.muscleLower === undefined) return undefined;
  const d = clamp(shape.muscleUpper - shape.muscleLower, -1, 1);
  return Math.abs(d) < 1e-9 ? undefined : d;
}

/**
 * Belly & waist vs hips & thighs → the engine's single axis s_b ∈ [−1, 1] (AVATAR_SPEC §10.1: belly minus hips).
 * Either scale alone reaches the engine's full range (s_b = ±1 ↔ trunk:limb z = ±2); together they clamp.
 */
export function bellyAxis(shape: ShapeInputs): number | undefined {
  if (shape.belly === undefined && shape.hips === undefined) return undefined;
  return clamp((shape.belly ?? 0) - (shape.hips ?? 0), -1, 1);
}

/** Engine sliders for the touched shape controls only. */
export function engineSliders(shape: ShapeInputs, sex: Sex): BodySliders {
  const s: BodySliders = {};
  if (shape.bodyFatPct !== undefined) s.adiposity = bodyFatToSlider(sex, shape.bodyFatPct);
  const m = touchedMuscularity(shape);
  if (m !== undefined) s.muscularity = m;
  const d = regionalMuscle(shape);
  if (d !== undefined) {
    s.muscleTorso = d;
    s.muscleArms = d;
    s.muscleLegs = -d;
  }
  const b = bellyAxis(shape);
  if (b !== undefined) s.bellyVsHips = b;
  if (shape.chest !== undefined) s.chest = shape.chest;
  if (shape.arms !== undefined) s.arms = shape.arms;
  return s;
}

function compact<T extends object>(o: T): T {
  const out = {} as T;
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

/** `BodyInputs` for one equation set (engine contract, dossier 14). */
export function bodyInputsFor(v: BodyProfileValues, sex: Sex): BodyInputs {
  const b = effectiveBasics(v);
  const waist = v.waist.use && v.waist.cm !== null ? v.waist.cm : undefined;
  const sliders = engineSliders(v.shape, sex);
  return compact<BodyInputs>({
    sex,
    ageYears: b.ageYears,
    heightCm: b.heightCm,
    weightKg: b.weightKg,
    waistCm: waist,
    neckCm: waist !== undefined && v.waist.neckCm !== null ? v.waist.neckCm : undefined,
    hipCm: waist !== undefined && sex === 'female' && v.waist.hipCm !== null ? v.waist.hipCm : undefined,
    knownBodyFatPct: v.knownBodyFat.use && v.knownBodyFat.pct !== null ? v.knownBodyFat.pct : undefined,
    knownBodyFatSource: v.knownBodyFat.use && v.knownBodyFat.pct !== null ? v.knownBodyFat.source : undefined,
    sliders: Object.keys(sliders).length ? sliders : undefined,
    trainingYears: v.training.years ?? undefined,
    trainingQuality: v.training.quality ?? undefined,
    ethnicity: v.ethnicity ?? undefined,
    menopause: sex === 'female' && v.sex === 'female' ? (v.menopause ?? undefined) : undefined,
  });
}

/* ---------------------------------------------------------------------------------------------- habits → profile */

/** Representative years for the training-history keys (your-body.md §6 Habits). */
export const TRAINING_KEY_YEARS: Record<TrainingHistory, number> = { none: 0, lt1y: 0.5, '1to3y': 2, gt3y: 5 };

export function trainingHistoryOf(years: number | null): TrainingHistory | undefined {
  if (years === null) return undefined;
  if (years <= 0) return 'none';
  if (years < 1) return 'lt1y';
  if (years < 3) return '1to3y';
  return 'gt3y';
}

/**
 * The stored inputs with the intake's "a normal day" answers as `habits.activity` (engine MODEL_SPEC §5.5) when the
 * profile does not carry them yet. The raw turns that ride along in the intake document are dropped.
 * TODO(E4): keep `habits.activity` in the profile document (`pickHabits`, `profile.patch` Habits schema) and have
 * `intake.answer` write it, so the Simulator and Planner read the same activity; this merge then becomes a no-op.
 */
export function withIntakeActivity(v: BodyProfileValues, activity: (ActivityIntake & { turns?: unknown }) | undefined): BodyProfileValues {
  if (!activity || v.habits.activity) return v;
  const { turns, ...intake } = activity;
  const touched = Object.keys(intake).length > 0 || Object.keys((turns as { status?: object } | undefined)?.status ?? {}).length > 0;
  return touched ? { ...v, habits: { ...v.habits, activity: intake } } : v;
}

function habitsFor(v: BodyProfileValues): HabitProfile | undefined {
  const h: HabitProfile = compact({ ...v.habits, trainingHistory: trainingHistoryOf(v.training.years) });
  return Object.keys(h).length ? h : undefined;
}

/**
 * The engine `PersonProfile` (src/engine/types/profile.ts). Always valid for `resolveProfile`: basics that are not
 * entered yet use typical values (see `summarizeBody().complete`). Safety flags and `startDate` belong to the caller.
 */
export function buildPersonProfile(v: BodyProfileValues): PersonProfile {
  const sex = equationSex(v);
  const female = v.sex === 'female';
  const profile: PersonProfile = compact<PersonProfile>({
    schemaVersion: 1,
    body: bodyInputsFor(v, sex),
    sexUnspecified: v.sex === 'female' || v.sex === 'male' ? undefined : true,
    habits: habitsFor(v),
    cycle: female ? v.cycle : undefined,
    menopause: female ? (v.menopause ?? undefined) : undefined,
    labs: Object.keys(v.labs).length ? { ...v.labs } : undefined,
  });
  // Habitual carbohydrate sets initial muscle glycogen (dossier 14 M5): g/kg/d from the stated %E at the engine's own
  // weight-stable intake, so the two can't disagree.
  const carbPct = v.habits.habitualCarbPctEnergy;
  if (carbPct !== undefined) {
    const m = estimateMaintenance(profile);
    const g = m.resolved.habitualCarbG / profile.body.weightKg;
    if (Number.isFinite(g)) profile.body = { ...profile.body, habitualCarbGPerKg: Math.round(g * 100) / 100 };
  }
  return profile;
}

/* ---------------------------------------------------------------------------------------------- summary */

export type Band = [number, number];

export interface BodySummary {
  /** Sex, age, height and weight are the user's own (not typical placeholders). */
  complete: boolean;
  missing: BasicField[];
  /** Physiology sex ('unspecified' until chosen). */
  sex: PhysiologySex;
  /** Equation set of the P50 run (`profile.body.sex`). */
  equationSex: Sex;
  ageYears: number;
  heightCm: number;
  weightKg: number;
  bmi: number;
  profile: PersonProfile;
  /** Engine estimate of the P50 equation set: the Simulator's starting body. */
  estimate: BodyEstimate;
  /** Displayed estimate (averaged over both equation sets for "prefer not to say"). */
  bodyFatPct: number;
  bodyFatSdPct: number;
  bodyFatBand80: Band;
  fatMassKg: number;
  fatMassBand80: Band;
  leanMassKg: number;
  leanMassBand80: Band;
  ffmi: number;
  ffmiBand80: Band;
  vatKg: number;
  vatBand80: Band;
  maintenance: MaintenanceEstimate;
  /** No shape, measurement or training input yet: estimates rest on population averages. */
  basedOnAverages: boolean;
  measured: { waist: boolean; bodyFat: boolean };
  warnings: BodyWarning[];
  updatedAt: string | null;
  revision: number;
}

/** Mixture of the per-sex posteriors (equal weights): mean and SD including the between-set spread. */
function mixture(means: number[], sds: number[]): { mean: number; sd: number } {
  const n = means.length;
  const mean = means.reduce((a, b) => a + b, 0) / n;
  const within = sds.reduce((a, s) => a + s * s, 0) / n;
  const between = means.reduce((a, m) => a + (m - mean) ** 2, 0) / n;
  return { mean, sd: Math.sqrt(within + between) };
}

export function summarizeBody(v: BodyProfileValues): BodySummary {
  const basics = effectiveBasics(v);
  const eqSex = equationSex(v);
  const profile = buildPersonProfile(v);
  const maintenance = estimateMaintenance(profile);
  const estimate = maintenance.resolved.body;
  const sexes = displaySexes(v);
  const ests = sexes.map((s) => (s === eqSex ? estimate : estimateInitialState(bodyInputsFor(v, s))));
  const W = basics.weightKg;
  const h2 = (basics.heightCm / 100) ** 2;

  let bf: number;
  let sd: number;
  let bfBand: Band;
  if (ests.length === 1) {
    bf = estimate.bodyFatPct;
    sd = estimate.bodyFatSdPct;
    bfBand = [...estimate.uncertainty.bodyFatBand80];
  } else {
    const mix = mixture(
      ests.map((e) => e.bodyFatPct),
      ests.map((e) => e.bodyFatSdPct),
    );
    bf = mix.mean;
    sd = mix.sd;
    bfBand = [clamp(bf - Z80 * sd, 3, 60), clamp(bf + Z80 * sd, 3, 60)];
  }
  const fm = (W * bf) / 100;
  const lean = W - fm;
  const fmBand: Band = [(W * bfBand[0]) / 100, (W * bfBand[1]) / 100];
  const leanBand: Band = [W - fmBand[1], W - fmBand[0]];
  const vat = ests.reduce((a, e) => a + e.fat.vatKg, 0) / ests.length;
  const vatRel = estimate.uncertainty.vatRelativeSd;
  const warnings = ests.flatMap((e) => e.warnings).filter((w, i, all) => all.findIndex((x) => x.code === w.code) === i);

  return {
    complete: basics.missing.length === 0,
    missing: basics.missing,
    sex: basics.sex,
    equationSex: eqSex,
    ageYears: basics.ageYears,
    heightCm: basics.heightCm,
    weightKg: W,
    bmi: W / h2,
    profile,
    estimate,
    bodyFatPct: bf,
    bodyFatSdPct: sd,
    bodyFatBand80: bfBand,
    fatMassKg: fm,
    fatMassBand80: fmBand,
    leanMassKg: lean,
    leanMassBand80: leanBand,
    ffmi: lean / h2,
    ffmiBand80: [leanBand[0] / h2, leanBand[1] / h2],
    vatKg: vat,
    vatBand80: [Math.max(0, vat * (1 - Z80 * vatRel)), vat * (1 + Z80 * vatRel)],
    maintenance,
    basedOnAverages:
      Object.keys(v.shape).length === 0 && !(v.waist.use && v.waist.cm !== null) && !(v.knownBodyFat.use && v.knownBodyFat.pct !== null) && v.training.years === null,
    measured: { waist: v.waist.use && v.waist.cm !== null, bodyFat: v.knownBodyFat.use && v.knownBodyFat.pct !== null },
    warnings,
    updatedAt: v.updatedAt,
    revision: v.revision,
  };
}

/**
 * High training load (EX-L "high training load / EA < 45", dossier 17): PROPOSED (own) heuristic from Habits:
 * ≥ 10 sessions a week, or ≥ 6 with mostly cardio. The safety layer decides what it changes.
 */
export function highTrainingLoad(habits: BodyProfileValues['habits']): boolean {
  const n = habits.sessionsPerWeek ?? 0;
  const cardio = habits.lifingCardioMix ?? 0.5;
  return n >= 10 || (n >= 6 && cardio >= 0.5);
}

/** Body facts for `useSafetyAccess()`: only facts the user actually gave (typical placeholders are withheld). */
export function bodyContextOf(s: BodySummary): SafetyBodyContext {
  const has = (f: BasicField) => !s.missing.includes(f);
  const heightAndWeight = has('height') && has('weight');
  return {
    ageYears: has('age') ? s.ageYears : undefined,
    bmi: heightAndWeight ? s.bmi : undefined,
    bodyFatPct: heightAndWeight ? s.bodyFatPct : undefined,
    sex: s.sex === 'unspecified' ? undefined : s.sex,
    highTrainingLoad: highTrainingLoad(s.profile.habits ?? {}),
  };
}
