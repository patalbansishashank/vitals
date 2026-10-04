/**
 * Safety store: screening answers, acknowledgements, fasting opt-ins and danger acknowledgements. A projection of
 * the `safety` document; boot cache and export key `vitals.safety`. The gate outcome is derived with
 * `evaluateScreening` from the answers — never stored as the source of truth.
 *
 * Privacy (dossier 17 DS-10, §4.7): SCOFF item answers are never persisted — only the `scoffRisk` flag.
 * Answers to hidden questions and follow-ups of "no" answers are dropped before storage.
 *
 * Every timestamp is an ISO string supplied by the caller (`at`); the store never reads the clock. Every change goes
 * through the `safety.*` commands (UI-only where it relaxes a boundary).
 */
import { evaluateScreening } from '@/features/onboarding/safetyRules';
import { MODE_LABEL } from '@/features/onboarding/copyEarly';
import { dispatchSync } from '@/commands/bus';
import '@/commands/defs/safety'; // registers the commands the actions below dispatch
import { registerStore } from './persistence';
import { createProjection } from './projection';
import { createScope, runInScope, withSystemWrite } from './scope';
import { DEFAULT_SAFETY, SAFETY_KEY, SAFETY_VERSION, isSafetyState, pickSafetyValues, type SafetyState, type SafetyValues } from './internal/safetyModel';
import { adoptLegacyLongFasts as adoptLegacy, resetSafety as resetSafetyInternal } from './internal/safety';

export { DEFAULT_SAFETY, SAFETY_KEY, SAFETY_VERSION, isSafetyState, pickSafetyValues, type SafetyActions, type SafetyState, type SafetyValues } from './internal/safetyModel';

const PERSISTED = Object.keys(DEFAULT_SAFETY) as Array<keyof SafetyValues & string>;

export const useSafetyStore = createProjection<SafetyState, SafetyValues>({
  name: 'safety',
  key: SAFETY_KEY,
  version: SAFETY_VERSION,
  persistedFields: PERSISTED,
  creator: () => ({
    ...DEFAULT_SAFETY,
    commitAnswers: (answers, at) => void dispatchSync('safety.commitScreening', { answers: answers as Record<string, unknown>, at }),
    clearAgeAnswer: () => void dispatchSync('safety.clearAgeAnswer', {}),
    acknowledge: (id, version, at) => void dispatchSync('safety.acknowledge', { id, version, at }),
    setFastingOptIn: (optIn) => void dispatchSync('safety.setFastingOptIn', { optIn: optIn as never }),
    clearFastingOptIn: () => void dispatchSync('safety.clearFastingOptIn', {}),
    reportRecentIllness: (at) => void dispatchSync('safety.reportIllness', { at }),
    setShortWindow: (value) => void dispatchSync('safety.setShortWindow', { value }),
    acknowledgeDanger: (scenarioId, ack) => void dispatchSync('safety.acknowledgeDanger', { scenarioId, ack }),
    // settings v2 → v3 hand-off: part of the one-time migration, not a user action
    adoptLegacyLongFasts: () => runInScope(createScope('migration', { label: 'settings v3 hand-off' }), adoptLegacy),
    resetSafety: () => withSystemWrite(resetSafetyInternal, 'resetSafety'),
  }),
  partialize: (s) => pickSafetyValues(s),
  // v1 is the first schema; unknown or older shapes are reduced to the known fields.
  migrate: (persisted) => pickSafetyValues(persisted),
  merge: (persisted, current) => ({ ...current, ...pickSafetyValues(persisted) }),
  binding: {
    owns: ['safety'],
    toDocs: (v) => [{ col: 'safety', id: 'me', body: v as unknown as Record<string, unknown> }],
    fromDocs: (read) => {
      const doc = read.get('safety', 'me');
      return doc ? pickSafetyValues(doc) : null;
    },
  },
});

let r1Memo: { answers: SafetyValues['answers']; r1: boolean } | null = null;
/**
 * The stored answers put the person in safety mode R1 ("gentle": eating-disorder history or risk). Memoised on the
 * answers object, so selectors can call it on every read. Quiet mode is on by default in R1 (SUITE_SPEC §3.7).
 */
export function inSafetyModeR1(answers: SafetyValues['answers'] = useSafetyStore.getState().answers): boolean {
  if (!answers) return false;
  if (r1Memo?.answers !== answers) r1Memo = { answers, r1: evaluateScreening(answers).restrictions.includes('R1') };
  return r1Memo.r1;
}

/** Mode label for summaries ("safety answers (Standard mode)"). */
function describeSafety(state: unknown): string | null {
  const v = pickSafetyValues(state);
  if (!v.answers) return null;
  return `safety answers (${MODE_LABEL[evaluateScreening(v.answers).modeName]})`;
}

registerStore(SAFETY_KEY, SAFETY_VERSION, {
  label: 'safety answers',
  describe: describeSafety,
  validate: isSafetyState,
  // Merge keeps this device's answers: a file must never silently lift a safety mode.
  merge: (current) => current,
  // Synchronous (the boot cache is), so the review flag is set in the importing command's scope.
  rehydrate: () => {
    const before = JSON.stringify(useSafetyStore.getState().answers);
    const done = useSafetyStore.persist.rehydrate();
    const s = useSafetyStore.getState();
    // Imported answers apply only after the user confirms them in the screening view.
    if (s.answers && JSON.stringify(s.answers) !== before) useSafetyStore.setState({ pendingReview: true });
    return done;
  },
});
