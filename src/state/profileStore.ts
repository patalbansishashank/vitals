/**
 * Body profile store: the raw inputs of the Your-body screen, in SI units. A projection of the `profile` document
 * (plus setup progress in `uiPrefs`); boot cache and export key `vitals.body`.
 *
 * - Everything is stored metric (kg, cm, kcal); imperial is a display concern (settings store `units`), so switching
 *   units never rounds a stored value.
 * - Shape sliders are stored only once the user has touched them (`undefined` = untouched). The engine's rule
 *   (src/engine/body README) is that untouched sliders are passed as `undefined`; their displayed positions are
 *   derived from the estimate at render time and never written back.
 * - Basics may be `null` until entered; typical placeholder values are used for the figure and the profile, and
 *   `useBodyEstimate().complete` says whether they are the user's own.
 * - Every change goes through the `profile.*` commands (the actions below dispatch them). The boot-cache write is
 *   debounced (300 ms) so a slider drag never writes localStorage per frame; consecutive edits of the same field
 *   coalesce into one ChangeSet.
 *
 * Selectors for other features:
 *   useBodyEstimate()  → live estimate with likely ranges + maintenance (same resolveProfile the Simulator uses)
 *   usePersonProfile() → engine `PersonProfile` (src/engine/types/profile.ts)
 *   useBodyContext()   → `SafetyBodyContext` for useSafetyAccess()
 */
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { PersonProfile } from '@/engine';
import type { SafetyBodyContext } from '@/features/onboarding/useSafetyAccess';
import { bodyContextOf, buildPersonProfile, summarizeBody, type BodySummary } from '@/features/body/model';
import { dispatchSync } from '@/commands/bus';
import '@/commands/defs/profile'; // registers the commands the actions below dispatch
import { cancelMirror, flushMirror } from './bridge';
import { registerStore } from './persistence';
import { createProjection } from './projection';
import { withSystemWrite } from './scope';
import {
  BODY_KEY,
  BODY_SAVE_DEBOUNCE_MS,
  BODY_UI_FIELDS,
  BODY_VERSION,
  DEFAULT_BODY,
  FRAME_RANGE,
  bodyFromDocs,
  bodyUiOf,
  clampTo,
  isBodyProfileState,
  migrateBody,
  pickBodyValues,
  profileDocOf,
  type BodyProfileState,
  type BodyProfileValues,
  type ShapeInputs,
} from './internal/profileModel';
import { resetBody as resetBodyInternal } from './internal/profile';

export {
  BODY_KEY,
  BODY_RANGES,
  BODY_SAVE_DEBOUNCE_MS,
  BODY_VERSION,
  DEFAULT_BODY,
  FRAME_RANGE,
  defaultFigureFrame,
  figureFrameOf,
  isBodyProfileState,
  migrateBody,
  pickBodyValues,
  type BasicField,
  type BodyProfileActions,
  type BodyProfileState,
  type BodyProfileValues,
  type FigureInputs,
  type KnownBodyFatInput,
  type SetupStep,
  type ShapeInputs,
  type ShapeKey,
  type TrainingInput,
  type WaistInput,
} from './internal/profileModel';

/* ---------------------------------------------------------------------------------------------- save status */

type SaveStatus = 'saved' | 'saving' | 'unavailable';
const saveListeners = new Set<() => void>();
let saveStatus: SaveStatus = 'saved';

function setSaveStatus(s: SaveStatus) {
  if (s === saveStatus) return;
  saveStatus = s;
  saveListeners.forEach((l) => l());
}

/** Write any pending change now (tests, export, page hide). */
export function flushBodyPersistence(): void {
  flushMirror(BODY_KEY);
}

/** "saved on this device" / "saving…" / storage unavailable, for the context bar. */
export function getBodySaveStatus(): SaveStatus {
  return saveStatus;
}
export function subscribeBodySaveStatus(fn: () => void): () => void {
  saveListeners.add(fn);
  return () => saveListeners.delete(fn);
}

/* ---------------------------------------------------------------------------------------------- store */

/** Persisted fields (user data, guarded): everything but the actions. */
const PERSISTED = Object.keys(DEFAULT_BODY) as Array<keyof BodyProfileValues & string>;

/** undefined → null (JSON merge patch: null clears / un-touches). */
function nullify<T extends object>(patch: T): { [K in keyof T]: T[K] | null } {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) out[k] = v === undefined ? null : v;
  return out as { [K in keyof T]: T[K] | null };
}

const patch = (input: Parameters<typeof dispatchSync<'profile.patch'>>[1]) => void dispatchSync('profile.patch', input);

export const useProfileStore = createProjection<BodyProfileState, BodyProfileValues>({
  name: 'profile',
  key: BODY_KEY,
  version: BODY_VERSION,
  persistedFields: PERSISTED,
  creator: () => ({
    ...DEFAULT_BODY,
    setSex: (sex) => patch({ sex }),
    // clamped here so a slider's float overshoot never fails the schema (0..1)
    setFigureFrame: (frame) => patch({ figure: { frame: frame === null ? null : clampTo(frame, FRAME_RANGE) } }),
    setAge: (ageYears) => patch({ ageYears }),
    setHeight: (heightCm) => patch({ heightCm }),
    setWeight: (weightKg) => patch({ weightKg }),
    setEthnicity: (ethnicity) => patch({ ethnicity }),
    setShape: (shape: Partial<ShapeInputs>) => patch({ shape: nullify(shape) }),
    resetShape: () => void dispatchSync('profile.resetShape', {}),
    setWaist: (waist) => patch({ waist: nullify(waist) as never }),
    setKnownBodyFat: (knownBodyFat) => patch({ knownBodyFat: nullify(knownBodyFat) as never }),
    setTraining: (training) => patch({ training: nullify(training) }),
    setHabits: (habits) => patch({ habits: nullify(habits) as never }),
    setCycle: (cycle) => patch({ cycle: nullify(cycle) }),
    setMenopause: (menopause) => patch({ menopause }),
    setLabs: (labs) => patch({ labs: nullify(labs) as Record<string, number | null> }),
    clearLabs: () => patch({ labs: null }),
    setSetup: (step, skipped) => void dispatchSync('profile.setSetupStep', { step, ...(skipped?.shape !== undefined ? { shapeSkipped: skipped.shape } : {}), ...(skipped?.habits !== undefined ? { habitsSkipped: skipped.habits } : {}) }),
    resetBody: () => withSystemWrite(resetBodyInternal, 'resetBody'),
  }),
  partialize: (s) => pickBodyValues(s),
  migrate: (persisted, version) => migrateBody(persisted, version),
  merge: (persisted, current) => ({ ...current, ...pickBodyValues(persisted) }),
  binding: {
    owns: ['profile'],
    shares: [{ col: 'uiPrefs', id: 'me', fields: BODY_UI_FIELDS }],
    toDocs: (v) => [
      { col: 'profile', id: 'me', body: profileDocOf(v) as unknown as Record<string, unknown> },
      { col: 'uiPrefs', id: 'me', body: bodyUiOf(v), fields: BODY_UI_FIELDS },
    ],
    fromDocs: (read) => bodyFromDocs(read.get('profile', 'me'), read.get('uiPrefs', 'me')),
    mirrorDebounceMs: BODY_SAVE_DEBOUNCE_MS,
    onSaveStatus: setSaveStatus,
  },
});

registerStore(BODY_KEY, BODY_VERSION, {
  label: 'body',
  describe: (s) => {
    const v = pickBodyValues(s);
    if (v.weightKg === null && v.heightCm === null) return 'your body (not set up)';
    const touched = Object.keys(v.shape).length;
    return `your body${touched ? ` · ${touched} shape setting${touched === 1 ? '' : 's'}` : ''}`;
  },
  validate: isBodyProfileState,
  // Merging keeps this device's body: one body per person (IA §1).
  merge: (current) => current,
  rehydrate: () => {
    cancelMirror(BODY_KEY);
    return useProfileStore.persist.rehydrate();
  },
});

/* ---------------------------------------------------------------------------------------------- selectors */

/** The persisted values only (no actions), shallow-stable between unrelated renders. */
export function selectBodyValues(s: BodyProfileState): BodyProfileValues {
  return {
    sex: s.sex,
    figure: s.figure,
    ageYears: s.ageYears,
    heightCm: s.heightCm,
    weightKg: s.weightKg,
    ethnicity: s.ethnicity,
    shape: s.shape,
    waist: s.waist,
    knownBodyFat: s.knownBodyFat,
    training: s.training,
    habits: s.habits,
    cycle: s.cycle,
    menopause: s.menopause,
    labs: s.labs,
    setup: s.setup,
    shapeSkipped: s.shapeSkipped,
    habitsSkipped: s.habitsSkipped,
    updatedAt: s.updatedAt,
    revision: s.revision,
  };
}

/** Raw inputs of the body profile (subscribe with shallow equality). */
export function useBodyValues(): BodyProfileValues {
  return useProfileStore(useShallow(selectBodyValues));
}

/**
 * Live body estimate for any screen: posterior body fat ± SD and its 80 % range, fat and lean mass, FFMI, visceral fat
 * and maintenance energy (the Simulator's own `resolveProfile` baseline) with its likely range.
 */
export function useBodyEstimate(): BodySummary {
  const v = useBodyValues();
  return useMemo(() => summarizeBody(v), [v]);
}

/** The engine `PersonProfile` built from the stored inputs (safety flags are merged by the caller). */
export function usePersonProfile(): PersonProfile {
  const v = useBodyValues();
  return useMemo(() => buildPersonProfile(v), [v]);
}

/** Body facts for the safety layer: `useSafetyAccess(useBodyContext())`. Empty until the basics are the user's own. */
export function useBodyContext(): SafetyBodyContext {
  const summary = useBodyEstimate();
  const { ageYears, bmi, bodyFatPct, sex, highTrainingLoad } = bodyContextOf(summary);
  return useMemo<SafetyBodyContext>(
    () => ({ ageYears, bmi, bodyFatPct, sex, highTrainingLoad }),
    [ageYears, bmi, bodyFatPct, sex, highTrainingLoad],
  );
}
