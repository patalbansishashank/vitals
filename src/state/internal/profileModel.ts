/**
 * Body profile model (pure): the persisted shape of Your body (SI units), its ranges, defaults, sanitisers and schema
 * migration. Shared by the projection (`../profileStore.ts`), the profile commands and the document mapping.
 */
import type { Ethnicity, KnownBodyFatSource, TrainingQuality } from '@/engine/body';
import { frameForSex } from '@/engine/body/frame'; // not the package index: keeps the avatar maths out of the initial bundle
import type { CycleProfile, HabitProfile, LabBaselines, PhysiologySex } from '@/engine';
import type { ActivityIntake } from '@/engine/types/profile';

export const BODY_KEY = 'vitals.body';
/** v2: the drawing-only figure base (female / neutral / male) became the continuous `figure.frame`. */
export const BODY_VERSION = 2;
/** Autosave debounce (your-body.md §7). */
export const BODY_SAVE_DEBOUNCE_MS = 300;

export type SetupStep = 'basics' | 'shape' | 'habits' | 'done';
export type BasicField = 'sex' | 'age' | 'height' | 'weight';

/**
 * The shape sliders as the screen shows them. `undefined` = never touched.
 * - `bodyFatPct`: body fat of the figure as the user set it, % (4–60).
 * - `belly`, `hips`, `chest`, `arms`: where fat sits, −1 (less) … +1 (more). Chest and arms change the drawing only.
 * - `muscleUpper`, `muscleLower`: 0…1 positions on the engine's muscularity anchors (FFMI_ANCHORS, dossier 14 T3).
 */
export interface ShapeInputs {
  bodyFatPct?: number;
  belly?: number;
  hips?: number;
  chest?: number;
  arms?: number;
  muscleUpper?: number;
  muscleLower?: number;
}

export type ShapeKey = keyof ShapeInputs;

export interface WaistInput {
  /** "use measurement" switch. The value is kept when the switch goes off. */
  use: boolean;
  /** Waist at the top of the hip bones (iliac crest, NHANES protocol), cm. */
  cm: number | null;
  /** Optional, for the US-Navy estimator (neck always; hip for female physiology). Used only with the waist. */
  neckCm: number | null;
  hipCm: number | null;
}

/** Drawing-only figure settings (body-figure-v2.md §5.4). Synced with the profile document as `profile.figure`. */
export interface FigureInputs {
  /** 0 = hips-led … 1 = shoulders-led; null = "Match my basics" (follows the sex choice). Never read by the physiology. */
  frame: number | null;
}

export interface KnownBodyFatInput {
  use: boolean;
  pct: number | null;
  source: KnownBodyFatSource;
}

export interface TrainingInput {
  /** Years of regular resistance training (null = not answered). */
  years: number | null;
  quality: TrainingQuality | null;
}

export interface BodyProfileValues {
  /** Physiology sex for the equations; null = not chosen yet. */
  sex: PhysiologySex | null;
  /** Drawing-only figure settings (Frame); never read by the equations. */
  figure: FigureInputs;
  ageYears: number | null;
  heightCm: number | null;
  weightKg: number | null;
  ethnicity: Ethnicity | null;
  shape: ShapeInputs;
  waist: WaistInput;
  knownBodyFat: KnownBodyFatInput;
  training: TrainingInput;
  /** Engine habit fields (src/engine/types/profile.ts); absent = engine default. `trainingHistory` is derived from `training.years`. */
  habits: Omit<HabitProfile, 'trainingHistory'>;
  cycle: CycleProfile;
  menopause: 'pre' | 'peri' | 'post' | null;
  /** Optional measured baselines, SI / engine units. */
  labs: LabBaselines;
  /** First-run progress: basics → shape → habits → done. */
  setup: SetupStep;
  shapeSkipped: boolean;
  habitsSkipped: boolean;
  /** ISO time of the last change (Simulator: "Your body changed on …"). */
  updatedAt: string | null;
  /** Increments on every change. */
  revision: number;
}

export interface BodyProfileActions {
  setSex: (sex: PhysiologySex) => void;
  /** Frame of the drawing, 0 (hips-led) … 1 (shoulders-led); null = match my basics again. */
  setFigureFrame: (frame: number | null) => void;
  setAge: (years: number) => void;
  setHeight: (cm: number) => void;
  setWeight: (kg: number) => void;
  setEthnicity: (e: Ethnicity | null) => void;
  /** Touch one or more shape sliders (values are clamped to their ranges). `undefined` un-touches a slider. */
  setShape: (patch: Partial<ShapeInputs>) => void;
  /** "Reset to estimate": body fat, distribution and muscle back to untouched. */
  resetShape: () => void;
  setWaist: (patch: Partial<WaistInput>) => void;
  setKnownBodyFat: (patch: Partial<KnownBodyFatInput>) => void;
  setTraining: (patch: Partial<TrainingInput>) => void;
  setHabits: (patch: Partial<BodyProfileValues['habits']>) => void;
  setCycle: (patch: Partial<CycleProfile>) => void;
  setMenopause: (m: BodyProfileValues['menopause']) => void;
  setLabs: (patch: Partial<Record<keyof LabBaselines, number | undefined>>) => void;
  clearLabs: () => void;
  setSetup: (step: SetupStep, skipped?: { shape?: boolean; habits?: boolean }) => void;
  /** Forget everything (tests; Reset everything reloads instead). */
  resetBody: () => void;
}

export type BodyProfileState = BodyProfileValues & BodyProfileActions;

/* ---------------------------------------------------------------------------------------------- ranges */

/** Input ranges (your-body.md §6). Stored values are always clamped into these. */
export const BODY_RANGES = {
  ageYears: [18, 90],
  heightCm: [140, 210],
  weightKg: [35, 250],
  bodyFatPct: [4, 60],
  distribution: [-1, 1],
  muscle: [0, 1],
  waistCm: [55, 160],
  neckCm: [25, 60],
  hipCm: [60, 180],
  knownBodyFatPct: [3, 60],
  trainingYears: [0, 50],
  sessionsPerWeek: [0, 14],
  steps: [1000, 25000],
  cycleLengthD: [21, 40],
} as const satisfies Record<string, readonly [number, number]>;

export const clampTo = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));
export const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const DEFAULT_BODY: BodyProfileValues = {
  sex: null,
  figure: { frame: null },
  ageYears: null,
  heightCm: null,
  weightKg: null,
  ethnicity: null,
  shape: {},
  waist: { use: false, cm: null, neckCm: null, hipCm: null },
  knownBodyFat: { use: false, pct: null, source: 'dxa' },
  training: { years: null, quality: null },
  habits: {},
  cycle: { tracking: false },
  menopause: null,
  labs: {},
  setup: 'basics',
  shapeSkipped: false,
  habitsSkipped: false,
  updatedAt: null,
  revision: 0,
};

/* ---------------------------------------------------------------------------------------------- sanitising */

export const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
export const oneOf = <T extends string>(x: unknown, vals: readonly T[]): x is T => typeof x === 'string' && (vals as readonly string[]).includes(x);
const numOrNull = (x: unknown, range: readonly [number, number]): number | null => (finite(x) ? clampTo(x, range) : null);

export const SEXES = ['female', 'male', 'unspecified'] as const;
/** The v1 drawing-only figure bases; read only to migrate old data into `figure.frame`. */
const LEGACY_BASES = ['female', 'neutral', 'male'] as const;
export const ETHNICITIES = ['white', 'black', 'eastAsian', 'southeastAsian', 'southAsian', 'hispanic', 'other'] as const;
export const SOURCES = ['dxa', 'bia', 'skinfold', 'navy'] as const;
export const QUALITIES = ['casual', 'regular', 'serious'] as const;
export const STEPS = ['basics', 'shape', 'habits', 'done'] as const;

export const SHAPE_RANGES: Record<ShapeKey, readonly [number, number]> = {
  bodyFatPct: BODY_RANGES.bodyFatPct,
  belly: BODY_RANGES.distribution,
  hips: BODY_RANGES.distribution,
  chest: BODY_RANGES.distribution,
  arms: BODY_RANGES.distribution,
  muscleUpper: BODY_RANGES.muscle,
  muscleLower: BODY_RANGES.muscle,
};

export function pickShape(raw: unknown): ShapeInputs {
  const out: ShapeInputs = {};
  if (!isObj(raw)) return out;
  for (const k of Object.keys(SHAPE_RANGES) as ShapeKey[]) {
    const v = raw[k];
    if (finite(v)) out[k] = clampTo(v, SHAPE_RANGES[k]);
  }
  return out;
}

/* ---------------------------------------------------------------------------------------------- figure (Frame) */

/** Range of `figure.frame`: 0 = hips-led … 1 = shoulders-led. */
export const FRAME_RANGE = [0, 1] as const;

/** "Match my basics": 0 for female physiology, 1 for male, 0.5 for "prefer not to say" or not chosen yet. */
export function defaultFigureFrame(sex: PhysiologySex | null): number {
  return sex === 'female' || sex === 'male' ? frameForSex(sex) : 0.5;
}

/** A stored frame: finite → clamped to 0..1 and rounded to 3 decimals; anything else → null (match my basics). */
export function sanitizeFrame(x: unknown): number | null {
  return finite(x) ? Math.round(clampTo(x, FRAME_RANGE) * 1000) / 1000 : null;
}

/** The frame the drawing uses: the stored one, else the "Match my basics" default for the sex choice. */
export function figureFrameOf(v: Pick<BodyProfileValues, 'sex' | 'figure'>): number {
  const stored = sanitizeFrame(v.figure?.frame);
  return stored ?? defaultFigureFrame(v.sex);
}

/**
 * Map a v1 `figureBase` (female / neutral / male) onto `figure.frame` (0 / 0.5 / 1). Null when the value is not a
 * base, or when it equals what "Match my basics" gives for that sex, so a person who never left the default keeps
 * following their basics.
 */
export function frameOfLegacyBase(base: unknown, sex: unknown): number | null {
  if (!oneOf(base, LEGACY_BASES)) return null;
  const frame = base === 'female' ? 0 : base === 'male' ? 1 : 0.5;
  return frame === defaultFigureFrame(oneOf(sex, SEXES) ? sex : null) ? null : frame;
}

/** `figure` from a stored or imported state; an old state without it maps its `figureBase` instead. */
export function pickFigure(raw: Record<string, unknown>): FigureInputs {
  if (isObj(raw.figure)) return { frame: sanitizeFrame(raw.figure.frame) };
  return { frame: frameOfLegacyBase(raw.figureBase, raw.sex) };
}

export const HABIT_NUMBERS = [
  'sessionsPerWeek',
  'lifingCardioMix',
  'typicalSteps',
  'bedTimeH',
  'wakeTimeH',
  'habitualProteinGPerKg',
  'habitualCarbPctEnergy',
  'habitualFibreGPer1000Kcal',
  'habitualSodiumG',
  'habitualCaffeineMg',
  'habitualAlcoholDrinksPerWeek',
  'habitualMealsPerDay',
  'habitualWindowStartH',
  'habitualWindowLengthH',
  'upfShare',
  'habitualLiquidKcal',
  'habitualEnergyDensityKcalPerG',
] as const;

export function pickHabits(raw: unknown): BodyProfileValues['habits'] {
  const out: BodyProfileValues['habits'] = {};
  if (!isObj(raw)) return out;
  for (const k of HABIT_NUMBERS) if (finite(raw[k])) out[k] = raw[k];
  if (oneOf(raw.sleepQuality, ['poor', 'fair', 'good'] as const)) out.sleepQuality = raw.sleepQuality;
  if (oneOf(raw.stress, ['low', 'moderate', 'high'] as const)) out.stress = raw.stress;
  if (oneOf(raw.dietAnimalLevel, ['omnivore', 'pescatarian', 'vegetarian', 'vegan'] as const)) out.dietAnimalLevel = raw.dietAnimalLevel;
  if (raw.foodQuality === 1 || raw.foodQuality === 2 || raw.foodQuality === 3) out.foodQuality = raw.foodQuality;
  if (typeof raw.multivitamin === 'boolean') out.multivitamin = raw.multivitamin;
  if (typeof raw.smoker === 'boolean') out.smoker = raw.smoker;
  // the activity intake (written by `intake.answer`): the raw turns stay in the intake document
  if (isObj(raw.activity)) {
    const { turns: _turns, ...activity } = raw.activity;
    void _turns;
    if (Object.keys(activity).length) out.activity = activity as ActivityIntake;
  }
  return out;
}

export const LAB_KEYS = [
  'measuredRmrKcal',
  'vo2maxMlKgMin',
  'ldlMmolL',
  'hdlMmolL',
  'tgMmolL',
  'apoBgL',
  'fastingGlucoseMmolL',
  'fastingInsulinUuMl',
  'hba1cPct',
  'sbpMmHg',
  'dbpMmHg',
  'liverFatPct',
  'crpMgL',
  'urateMgDl',
  'leptinNgMl',
  'testosteroneNmolL',
  'igf1NgMl',
] as const satisfies ReadonlyArray<keyof LabBaselines>;

export function pickLabs(raw: unknown): LabBaselines {
  const out: LabBaselines = {};
  if (!isObj(raw)) return out;
  for (const k of LAB_KEYS) if (finite(raw[k]) && (raw[k] as number) >= 0) out[k] = raw[k] as number;
  return out;
}

export function pickCycle(raw: unknown): CycleProfile {
  if (!isObj(raw)) return { tracking: false };
  const out: CycleProfile = { tracking: raw.tracking === true };
  if (finite(raw.cycleLengthD)) out.cycleLengthD = clampTo(Math.round(raw.cycleLengthD), BODY_RANGES.cycleLengthD);
  if (typeof raw.lastPeriodStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.lastPeriodStart)) out.lastPeriodStart = raw.lastPeriodStart;
  if (oneOf(raw.contraception, ['none', 'combinedOral', 'progestinOnly', 'iud', 'other'] as const)) out.contraception = raw.contraception;
  return out;
}

/** Keep known fields with plausible shapes; everything else falls back to defaults (import, rehydrate). */
export function pickBodyValues(raw: unknown): BodyProfileValues {
  const s = isObj(raw) ? raw : {};
  const w = isObj(s.waist) ? s.waist : {};
  const k = isObj(s.knownBodyFat) ? s.knownBodyFat : {};
  const t = isObj(s.training) ? s.training : {};
  return {
    sex: oneOf(s.sex, SEXES) ? s.sex : null,
    figure: pickFigure(s),
    ageYears: numOrNull(s.ageYears, BODY_RANGES.ageYears),
    heightCm: numOrNull(s.heightCm, BODY_RANGES.heightCm),
    weightKg: numOrNull(s.weightKg, BODY_RANGES.weightKg),
    ethnicity: oneOf(s.ethnicity, ETHNICITIES) ? s.ethnicity : null,
    shape: pickShape(s.shape),
    waist: {
      use: w.use === true,
      cm: numOrNull(w.cm, BODY_RANGES.waistCm),
      neckCm: numOrNull(w.neckCm, BODY_RANGES.neckCm),
      hipCm: numOrNull(w.hipCm, BODY_RANGES.hipCm),
    },
    knownBodyFat: {
      use: k.use === true,
      pct: numOrNull(k.pct, BODY_RANGES.knownBodyFatPct),
      source: oneOf(k.source, SOURCES) ? k.source : 'dxa',
    },
    training: {
      years: numOrNull(t.years, BODY_RANGES.trainingYears),
      quality: oneOf(t.quality, QUALITIES) ? t.quality : null,
    },
    habits: pickHabits(s.habits),
    cycle: pickCycle(s.cycle),
    menopause: oneOf(s.menopause, ['pre', 'peri', 'post'] as const) ? s.menopause : null,
    labs: pickLabs(s.labs),
    setup: oneOf(s.setup, STEPS) ? s.setup : 'basics',
    shapeSkipped: s.shapeSkipped === true,
    habitsSkipped: s.habitsSkipped === true,
    updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : null,
    revision: finite(s.revision) ? Math.max(0, Math.round(s.revision)) : 0,
  };
}

/** Import validation: an object whose basic fields, if present, have the right types. */
export function isBodyProfileState(x: unknown): boolean {
  if (!isObj(x)) return false;
  const numOrNil = (v: unknown) => v === undefined || v === null || finite(v);
  if (!numOrNil(x.ageYears) || !numOrNil(x.heightCm) || !numOrNil(x.weightKg)) return false;
  if (x.sex !== undefined && x.sex !== null && !oneOf(x.sex, SEXES)) return false;
  if (x.shape !== undefined && !isObj(x.shape)) return false;
  return true;
}

/**
 * Schema migrations. v1 is the first persisted shape; older or unknown versions are sanitised field by field
 * (unknown fields are dropped, missing ones take defaults). Add `if (version < 3) …` steps here.
 */
export function migrateBody(persisted: unknown, version: number): BodyProfileValues {
  const raw = isObj(persisted) ? { ...persisted } : {};
  if (version < 1) {
    // Pre-release drafts stored `waistCm` at the top level.
    if (finite(raw.waistCm) && !isObj(raw.waist)) raw.waist = { use: true, cm: raw.waistCm };
  }
  if (version < 2) {
    // v2: the drawing-only figure base (female / neutral / male) became the continuous `figure.frame` (0 / 0.5 / 1);
    // a base equal to the sex default becomes null, so the drawing keeps following the basics.
    if (!isObj(raw.figure)) raw.figure = { frame: frameOfLegacyBase(raw.figureBase, raw.sex) };
    delete raw.figureBase;
  }
  return pickBodyValues(raw);
}

/* ---------------------------------------------------------------------------------------------- documents */

/** Setup progress lives in `uiPrefs` (SUITE_SPEC §2.3: ProfileDoc = BodyProfileValues minus setup/*Skipped). */
export const BODY_UI_FIELDS = ['bodySetup', 'shapeSkipped', 'habitsSkipped'] as const;
export type ProfileDoc = Omit<BodyProfileValues, 'setup' | 'shapeSkipped' | 'habitsSkipped'>;

export function profileDocOf(v: BodyProfileValues): ProfileDoc {
  const { setup: _setup, shapeSkipped: _s, habitsSkipped: _h, ...doc } = v;
  return doc;
}

export function bodyUiOf(v: BodyProfileValues): Record<(typeof BODY_UI_FIELDS)[number], unknown> {
  return { bodySetup: v.setup, shapeSkipped: v.shapeSkipped, habitsSkipped: v.habitsSkipped };
}

/**
 * `profile` document body from `_schema` 1 to 2 (for `COLLECTIONS.profile.migrate`): `figureBase` becomes
 * `figure.frame` (mapped with the document's own `sex`); every other field is left as it is.
 */
export function migrateProfileDocBody(body: Record<string, unknown>): Record<string, unknown> {
  const { figureBase: _base, ...rest } = body;
  return { ...rest, figure: pickFigure(body) };
}

/**
 * Rebuild the persisted values from the profile document and the uiPrefs fields. Goes through `pickBodyValues`, so
 * a document written by an older app (with `figureBase`, no `figure`) maps too.
 */
export function bodyFromDocs(profile: Record<string, unknown> | null, ui: Record<string, unknown> | null): BodyProfileValues | null {
  if (!profile) return null;
  // uiPrefs is device-local: a device that joined with a complete synced profile has finished setup
  if (ui?.bodySetup === undefined && oneOf(profile.sex, SEXES) && [profile.ageYears, profile.heightCm, profile.weightKg].every(finite))
    return pickBodyValues({ ...profile, setup: 'done', shapeSkipped: false, habitsSkipped: false });
  return pickBodyValues({ ...profile, setup: ui?.bodySetup, shapeSkipped: ui?.shapeSkipped, habitsSkipped: ui?.habitsSkipped });
}
