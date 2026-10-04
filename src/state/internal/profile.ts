/**
 * Profile store actions (importable only from `src/commands/**`, SUITE_SPEC §1.1 item 4). Each runs inside the
 * dispatching command's write scope; the bridge turns the change into `profile` / `uiPrefs` document ops.
 */
import type { CycleProfile } from '@/engine';
import { summarizeBody } from '@/features/body/model';
import { useProfileStore } from '../profileStore';
import {
  BODY_RANGES,
  DEFAULT_BODY,
  SHAPE_RANGES,
  clampTo,
  finite,
  pickBodyValues,
  pickCycle,
  pickHabits,
  pickLabs,
  profileDocOf,
  sanitizeFrame,
  type BodyProfileValues,
  type KnownBodyFatInput,
  type SetupStep,
  type ShapeInputs,
  type ShapeKey,
  type TrainingInput,
  type WaistInput,
} from './profileModel';

type Nullable<T> = { [K in keyof T]?: T[K] | null };

/** RFC 7396-style patch of the body profile (null clears / un-touches). */
export interface ProfilePatchInput {
  sex?: BodyProfileValues['sex'];
  /** Drawing only. null resets to "match my basics"; `frame: null` likewise; a number is clamped to 0..1. */
  figure?: { frame?: number | null } | null;
  ageYears?: number | null;
  heightCm?: number | null;
  weightKg?: number | null;
  ethnicity?: BodyProfileValues['ethnicity'];
  shape?: Nullable<ShapeInputs> | null;
  waist?: Nullable<WaistInput> | null;
  knownBodyFat?: Nullable<KnownBodyFatInput> | null;
  training?: Nullable<TrainingInput> | null;
  habits?: Record<string, unknown> | null;
  cycle?: Nullable<CycleProfile> | null;
  menopause?: BodyProfileValues['menopause'];
  labs?: Record<string, number | null> | null;
  /** Weight edits while a plan runs must say they set a new starting point (precondition). */
  asStartingPoint?: boolean;
}

const defined = <T extends object>(o: T | null | undefined): Partial<T> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o ?? {})) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
};
const clampOrNull = (v: number | null | undefined, range: readonly [number, number]) => (v === null || v === undefined || !finite(v) ? null : clampTo(v, range));

/** The fields a patch would change (for coalescing keys and change cards). */
export function patchFields(p: ProfilePatchInput): string[] {
  return Object.keys(p)
    .filter((k) => k !== 'asStartingPoint' && (p as Record<string, unknown>)[k] !== undefined)
    .sort();
}

/** Apply a profile patch with the v0.1 setters' clamping rules, as one change (one revision). */
export function applyProfilePatch(p: ProfilePatchInput): boolean {
  const s = useProfileStore.getState();
  const next: Partial<BodyProfileValues> = {};
  if (p.sex !== undefined) next.sex = p.sex;
  if (p.figure !== undefined) {
    if (p.figure === null || p.figure.frame === null) next.figure = { frame: null };
    else if (finite(p.figure.frame)) next.figure = { frame: sanitizeFrame(p.figure.frame) };
  }
  if (p.ageYears !== undefined) next.ageYears = p.ageYears === null ? null : clampTo(Math.round(p.ageYears), BODY_RANGES.ageYears);
  if (p.heightCm !== undefined) next.heightCm = clampOrNull(p.heightCm, BODY_RANGES.heightCm);
  if (p.weightKg !== undefined) next.weightKg = clampOrNull(p.weightKg, BODY_RANGES.weightKg);
  if (p.ethnicity !== undefined) next.ethnicity = p.ethnicity;
  if (p.shape !== undefined) {
    if (p.shape === null) next.shape = {};
    else {
      const shape: ShapeInputs = { ...s.shape };
      for (const key of Object.keys(p.shape) as ShapeKey[]) {
        const v = p.shape[key];
        if (v === null) delete shape[key];
        else if (finite(v)) shape[key] = clampTo(v, SHAPE_RANGES[key]);
      }
      next.shape = shape;
    }
  }
  if (p.waist !== undefined) {
    const w = p.waist === null ? DEFAULT_BODY.waist : { ...s.waist, ...defined(p.waist) };
    next.waist = {
      use: w.use === true,
      cm: clampOrNull(w.cm, BODY_RANGES.waistCm),
      neckCm: clampOrNull(w.neckCm, BODY_RANGES.neckCm),
      hipCm: clampOrNull(w.hipCm, BODY_RANGES.hipCm),
    };
  }
  if (p.knownBodyFat !== undefined) {
    const k = p.knownBodyFat === null ? DEFAULT_BODY.knownBodyFat : { ...s.knownBodyFat, ...defined(p.knownBodyFat) };
    next.knownBodyFat = { use: k.use === true, pct: clampOrNull(k.pct, BODY_RANGES.knownBodyFatPct), source: k.source ?? 'dxa' };
  }
  if (p.training !== undefined) {
    const t = p.training === null ? DEFAULT_BODY.training : { ...s.training, ...defined(p.training) };
    next.training = { years: clampOrNull(t.years, BODY_RANGES.trainingYears), quality: t.quality ?? null };
  }
  if (p.habits !== undefined) {
    const habits: Record<string, unknown> = p.habits === null ? {} : { ...s.habits };
    for (const [key, v] of Object.entries(p.habits ?? {})) {
      if (v === null || v === undefined) delete habits[key];
      else habits[key] = v;
    }
    next.habits = pickHabits(habits);
  }
  if (p.cycle !== undefined) {
    const merged: Record<string, unknown> = p.cycle === null ? {} : { ...s.cycle };
    for (const [key, v] of Object.entries(p.cycle ?? {})) {
      if (v === null || v === undefined) delete merged[key];
      else merged[key] = v;
    }
    next.cycle = pickCycle(merged);
  }
  if (p.menopause !== undefined) next.menopause = p.menopause;
  if (p.labs !== undefined) {
    const labs: Record<string, number> = p.labs === null ? {} : { ...(s.labs as Record<string, number>) };
    for (const [key, v] of Object.entries(p.labs ?? {})) {
      if (v === null || v === undefined || !finite(v)) delete labs[key];
      else labs[key] = v;
    }
    next.labs = pickLabs(labs);
  }
  if (Object.keys(next).length === 0) return false;
  useProfileStore.setState((st) => ({ ...next, updatedAt: new Date().toISOString(), revision: st.revision + 1 }));
  return true;
}

/** "Reset to estimate": body fat, distribution and muscle back to untouched. */
export function resetShape(): void {
  useProfileStore.setState((st) => ({ shape: {}, updatedAt: new Date().toISOString(), revision: st.revision + 1 }));
}

export function setSetupStep(step: SetupStep, skipped?: { shape?: boolean; habits?: boolean }): void {
  useProfileStore.setState((st) => ({
    setup: step,
    shapeSkipped: skipped?.shape ?? st.shapeSkipped,
    habitsSkipped: skipped?.habits ?? st.habitsSkipped,
    updatedAt: new Date().toISOString(),
    revision: st.revision + 1,
  }));
}

/** Forget everything (tests; "Reset everything" erases and reloads instead). */
export function resetBody(): void {
  useProfileStore.setState({ ...DEFAULT_BODY });
}

export function bodyValues(): BodyProfileValues {
  return pickBodyValues(useProfileStore.getState());
}

/** `ProfileView`: stored values (SI units) plus setup progress; no estimate (cheap, for every patch). */
export function profileView(): { profile: ReturnType<typeof profileDocOf>; setup: SetupStep; complete: boolean } {
  const v = bodyValues();
  return { profile: profileDocOf(v), setup: v.setup, complete: v.sex !== null && v.ageYears !== null && v.heightCm !== null && v.weightKg !== null };
}

/** `profile.get` adds the live estimate (the same `summarizeBody` the Your-body screen renders). */
export function profileEstimate(): {
  bodyFatPct: number;
  bodyFatSdPct: number;
  bmi: number;
  fatMassKg: number;
  leanMassKg: number;
  maintenanceKcal: number;
  maintenanceBand80: [number, number];
  missing: string[];
  basedOnAverages: boolean;
} {
  const s = summarizeBody(bodyValues());
  const r = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
  return {
    bodyFatPct: r(s.bodyFatPct),
    bodyFatSdPct: r(s.bodyFatSdPct),
    bmi: r(s.bmi),
    fatMassKg: r(s.fatMassKg),
    leanMassKg: r(s.leanMassKg),
    maintenanceKcal: Math.round(s.maintenance.kcal),
    maintenanceBand80: [Math.round(s.maintenance.band80[0]), Math.round(s.maintenance.band80[1])],
    missing: [...s.missing],
    basedOnAverages: s.basedOnAverages,
  };
}
