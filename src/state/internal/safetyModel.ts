/**
 * Safety model (pure): the persisted screening state, its sanitiser and import validation. SCOFF item answers are
 * never persisted — only the `scoffRisk` flag (dossier 17 DS-10, §4.7).
 */
import {
  sanitizeAnswers,
  type AcknowledgementId,
  type AcknowledgementRecord,
  type DangerAcknowledgement,
  type FastingOptIn,
  type ScreeningAnswers,
} from '@/features/onboarding/safetyRules';

export const SAFETY_KEY = 'vitals.safety';
export const SAFETY_VERSION = 1;

export interface SafetyValues {
  /** Committed answers (sanitised). null = not answered yet. */
  answers: ScreeningAnswers | null;
  /** ISO time the answers were committed (clearance lapses after 12 months). */
  answeredAt: string | null;
  /** QUESTION_SET_VERSION the answers were given against. */
  questionSetVersion: number | null;
  /** Acknowledged copy, by id, with the copy version acknowledged. */
  acknowledgements: AcknowledgementRecord;
  /** Fasting over 24 h: opt-in with its tier acknowledgements. */
  fastingOptIn: FastingOptIn | null;
  /** Migrated from the interim settings flag `allowLongFasts`: intent without the new acknowledgements. */
  legacyLongFastsRequest: boolean;
  /** Q19 answered "yes" at a fasting opt-in: fasts over T1 pause for 4 weeks from this time. */
  recentIllnessAt: string | null;
  /** HC-F5 4–6 h eating-window opt-in. */
  shortWindow: { version: number; at: string } | null;
  /** Danger acknowledgements per scenario id (until the schedule changes). */
  dangerAcks: Record<string, DangerAcknowledgement>;
  /** Imported answers wait for the user's confirmation before the gate clears (settings-data.md §6). */
  pendingReview: boolean;
}

export interface SafetyActions {
  /** Commit screening answers (sanitised here). Clears `pendingReview`. */
  commitAnswers: (answers: ScreeningAnswers, at: string) => void;
  /** "I entered my age by mistake": forget the under-18 answer so the questions start again. */
  clearAgeAnswer: () => void;
  acknowledge: (id: AcknowledgementId, version: number, at: string) => void;
  setFastingOptIn: (optIn: FastingOptIn) => void;
  clearFastingOptIn: () => void;
  reportRecentIllness: (at: string) => void;
  setShortWindow: (value: { version: number; at: string } | null) => void;
  acknowledgeDanger: (scenarioId: string, ack: DangerAcknowledgement) => void;
  /** Settings-store migration hand-off (settings v2 `allowLongFasts: true`). */
  adoptLegacyLongFasts: () => void;
  /** Forget everything (tests; Reset everything reloads instead). */
  resetSafety: () => void;
}

export type SafetyState = SafetyValues & SafetyActions;

export const DEFAULT_SAFETY: SafetyValues = {
  answers: null,
  answeredAt: null,
  questionSetVersion: null,
  acknowledgements: {},
  fastingOptIn: null,
  legacyLongFastsRequest: false,
  recentIllnessAt: null,
  shortWindow: null,
  dangerAcks: {},
  pendingReview: false,
};

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const orNull = <T>(x: unknown, ok: (v: unknown) => v is T): T | null => (ok(x) ? x : null);

function isAnswers(x: unknown): x is ScreeningAnswers {
  return isObj(x);
}
function isOptIn(x: unknown): x is FastingOptIn {
  return isObj(x) && (x.tier === 'T2' || x.tier === 'T3' || x.tier === 'T4') && Array.isArray(x.acknowledged) && typeof x.ackVersion === 'number' && isStr(x.at);
}
function isVersioned(x: unknown): x is { version: number; at: string } {
  return isObj(x) && typeof x.version === 'number' && isStr(x.at);
}

/** Pick known fields with the right shapes; answers are re-sanitised (drops any SCOFF items a file may carry). */
export function pickSafetyValues(raw: unknown): SafetyValues {
  const s = isObj(raw) ? raw : {};
  const acks: AcknowledgementRecord = {};
  if (isObj(s.acknowledgements)) {
    for (const [k, v] of Object.entries(s.acknowledgements)) if (isVersioned(v)) acks[k as AcknowledgementId] = { version: v.version, at: v.at };
  }
  const danger: Record<string, DangerAcknowledgement> = {};
  if (isObj(s.dangerAcks)) {
    for (const [k, v] of Object.entries(s.dangerAcks)) {
      if (isObj(v) && isStr(v.scheduleHash) && Array.isArray(v.rules) && typeof v.version === 'number' && isStr(v.at)) {
        danger[k] = { scheduleHash: v.scheduleHash, rules: v.rules.filter(isStr), version: v.version, at: v.at };
      }
    }
  }
  const answers = isAnswers(s.answers) ? sanitizeAnswers(s.answers) : null;
  return {
    answers,
    answeredAt: answers ? orNull(s.answeredAt, isStr) : null,
    questionSetVersion: answers && typeof s.questionSetVersion === 'number' ? s.questionSetVersion : null,
    acknowledgements: acks,
    fastingOptIn: orNull(s.fastingOptIn, isOptIn),
    legacyLongFastsRequest: s.legacyLongFastsRequest === true,
    recentIllnessAt: orNull(s.recentIllnessAt, isStr),
    shortWindow: orNull(s.shortWindow, isVersioned),
    dangerAcks: danger,
    pendingReview: s.pendingReview === true && answers !== null,
  };
}

/** Import validation: an object whose known fields have plausible shapes. */
export function isSafetyState(x: unknown): boolean {
  if (!isObj(x)) return false;
  if (x.answers !== undefined && x.answers !== null && !isAnswers(x.answers)) return false;
  if (x.acknowledgements !== undefined && !isObj(x.acknowledgements)) return false;
  if (x.fastingOptIn !== undefined && x.fastingOptIn !== null && !isOptIn(x.fastingOptIn)) return false;
  return true;
}

