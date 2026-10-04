/**
 * Safety store actions and the headless safety access (importable only from `src/commands/**`).
 *
 * `safetyAccessNow()` evaluates the stored answers exactly as `useSafetyAccess(useBodyContext())` does on screen
 * (same pure functions, same day-precision clock), so command gates and the UI agree (SUITE_SPEC §1.1 item 5).
 */
import { bodyContextOf, summarizeBody } from '@/features/body/model';
import { ACK_VERSIONS, FASTING_ACK_VERSION, MODE_LABEL, SHORT_WINDOW_ACK_VERSION } from '@/features/onboarding/copyEarly';
import { gateStatus, type GateStatus } from '@/features/onboarding/gate';
import {
  EXPERT_MODE_AVAILABLE,
  QUESTION_SET_VERSION,
  evaluateScreening,
  pendingAcknowledgements,
  resolveOptIns,
  sanitizeAnswers,
  type AcknowledgementId,
  type DangerAcknowledgement,
  type FastingOptIn,
  type OptInTier,
  type ScreeningAnswers,
  type ScreeningOutcome,
} from '@/features/onboarding/safetyRules';
import { useProfileStore } from '../profileStore';
import { useSafetyStore } from '../safetyStore';
import { pickBodyValues } from './profileModel';
import { DEFAULT_SAFETY, pickSafetyValues, type SafetyValues } from './safetyModel';

export function commitAnswers(answers: ScreeningAnswers, at: string): void {
  useSafetyStore.setState({ answers: sanitizeAnswers(answers), answeredAt: at, questionSetVersion: QUESTION_SET_VERSION, pendingReview: false });
}

export function clearAgeAnswer(): void {
  useSafetyStore.setState((s) => {
    if (!s.answers) return {};
    const rest: ScreeningAnswers = { ...s.answers };
    delete rest.ageBand;
    return { answers: Object.keys(rest).length ? rest : null, answeredAt: null };
  });
}

export function acknowledge(id: AcknowledgementId, version: number, at: string): void {
  useSafetyStore.setState((s) => ({ acknowledgements: { ...s.acknowledgements, [id]: { version, at } } }));
}

export function setFastingOptIn(optIn: FastingOptIn): void {
  useSafetyStore.setState({ fastingOptIn: { ...optIn, acknowledged: [...new Set(optIn.acknowledged)].sort() }, legacyLongFastsRequest: false });
}

export function clearFastingOptIn(): void {
  useSafetyStore.setState({ fastingOptIn: null, legacyLongFastsRequest: false });
}

export function reportRecentIllness(at: string): void {
  useSafetyStore.setState({ recentIllnessAt: at });
}

export function setShortWindow(value: { version: number; at: string } | null): void {
  useSafetyStore.setState({ shortWindow: value });
}

export function acknowledgeDanger(scenarioId: string, ack: DangerAcknowledgement): void {
  useSafetyStore.setState((s) => ({ dangerAcks: { ...s.dangerAcks, [scenarioId]: { ...ack, rules: [...new Set(ack.rules)].sort() } } }));
}

export function adoptLegacyLongFasts(): void {
  useSafetyStore.setState((s) => (s.fastingOptIn ? {} : { legacyLongFastsRequest: true }));
}

export function resetSafety(): void {
  useSafetyStore.setState({ ...DEFAULT_SAFETY });
}

export function safetyValues(): SafetyValues {
  return pickSafetyValues(useSafetyStore.getState());
}

/* ---------------------------------------------------------------- headless access */

export interface SafetyAccessNow {
  gate: GateStatus;
  ready: boolean;
  outcome: ScreeningOutcome;
  /** "Standard mode", "Gentle mode" … */
  modeLabel: string;
  simulatorAccess: ScreeningOutcome['simulatorAccess'];
  plannerAccess: ScreeningOutcome['plannerAccess'];
  plannerLocks: ScreeningOutcome['plannerLocks'];
  optedTier: OptInTier | null;
  shortWindowOn: boolean;
  pendingAcknowledgements: AcknowledgementId[];
}

/** Same evaluation as `useSafetyAccess(useBodyContext())` (day precision, body facts from Your body). */
export function safetyAccessNow(nowIso: string = new Date().toISOString()): SafetyAccessNow {
  const s = useSafetyStore.getState();
  const body = bodyContextOf(summarizeBody(pickBodyValues(useProfileStore.getState())));
  const at = `${nowIso.slice(0, 10)}T12:00:00.000Z`;
  const gate = gateStatus(s, at);
  const optIns = resolveOptIns(
    { fastingOptIn: s.fastingOptIn, shortWindow: s.shortWindow, recentIllnessAt: s.recentIllnessAt },
    at,
    { fasting: FASTING_ACK_VERSION, shortWindow: SHORT_WINDOW_ACK_VERSION },
    EXPERT_MODE_AVAILABLE,
  );
  const outcome = evaluateScreening(s.answers ?? {}, {
    ageYears: body.ageYears,
    bmi: body.bmi,
    bodyFatPct: body.bodyFatPct,
    sex: body.sex,
    highTrainingLoad: body.highTrainingLoad,
    optIns,
  });
  const ready = gate.status === 'ready';
  return {
    gate,
    ready,
    outcome,
    modeLabel: MODE_LABEL[outcome.modeName],
    simulatorAccess: ready ? outcome.simulatorAccess : 'blocked',
    plannerAccess: ready ? outcome.plannerAccess : 'blocked',
    plannerLocks: ready ? outcome.plannerLocks : [],
    optedTier: optIns.fastingTier ?? null,
    shortWindowOn: optIns.shortEatingWindow === true,
    pendingAcknowledgements: pendingAcknowledgements(outcome, s.acknowledgements, ACK_VERSIONS),
  };
}
