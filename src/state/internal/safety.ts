import { appDay } from '@/living/appDay';
import { resolveRenalScope, type RenalNutritionEnvelope } from '@/lib/renalScope';
import { markerRuleContext } from '@/markers/context';
import { markerRenalFindings } from '@/markers/renal';
import { evaluateMarkers } from '@/markers/rules';
import { readMarkersDoc } from '@/markers/ui/markersDoc';
import { readMarkerContextSources } from '@/markers/ui/contextSources';
/**
 * Safety store actions and the headless safety access (importable only from `src/commands/**`).
 *
 * `safetyAccessNow()` evaluates the stored answers exactly as `useSafetyAccess(useBodyContext())` does on screen
 * (same pure functions, same day-precision clock), so command gates and the UI agree (SUITE_SPEC §1.1 item 5).
 *
 * `suggestionSafetyNow()` (D7-03) builds the shared suggestion-policy input from the same stored answers — tri-state, so
 * an unanswered screen stays unknown — plus an optional marker evaluation (flags and noSuggest decisions with their
 * provenance). Food, the Coach and the `supplements.*` commands all pass it to `suggestionDecision`.
 */
import { buildPersonProfile, bodyContextOf, summarizeBody } from '@/features/body/model';
import { ACK_VERSIONS, FASTING_ACK_VERSION, MODE_LABEL, SHORT_WINDOW_ACK_VERSION } from '@/features/onboarding/copyEarly';
import { gateStatus, type GateStatus } from '@/features/onboarding/gate';
import {
  EXPERT_MODE_AVAILABLE,
  QUESTION_SET_VERSION,
  evaluateScreening,
  pendingAcknowledgements,
  resolveOptIns,
  sanitizeAnswers,
  suggestionSafetyFrom,
  type AcknowledgementId,
  type DangerAcknowledgement,
  type FastingOptIn,
  type OptInTier,
  type ScreeningAnswers,
  type ScreeningOutcome,
} from '@/features/onboarding/safetyRules';
import { supplementSnapshot, toSafetyInput } from '@/features/planner/request';
import { toIntakeDoc } from '@/features/intake/doc';
import type { PlannerSafetyInput } from '@/engine/planner/domain/types';
import type { MarkerNoSuggestInput, SuggestionSafetyInput } from '@/lib/safetyPolicy';
import { useProfileStore } from '../profileStore';
import { useSafetyStore } from '../safetyStore';
import { getDocumentStore } from '../runtime';
import { pickBodyValues } from './profileModel';
import { DEFAULT_SAFETY, isNutritionGuidance, pickSafetyValues, type SafetyValues } from './safetyModel';

export function addNutritionGuidance(envelope: RenalNutritionEnvelope, at: string): void {
  if (!isNutritionGuidance(envelope)) throw new Error('Enter a dated nutrition instruction with an id and bounds.');
  useSafetyStore.setState((s) => {
    const prior = s.nutritionGuidance ?? [];
    const entered = { ...envelope, version: envelope.version ?? 1, recordedAt: at };
    const existing = prior.find((e) => e.id === envelope.id);
    if (existing) {
      if (JSON.stringify(existing) === JSON.stringify(entered)) return {};
      throw new Error('This instruction id is already recorded. Update it with a new revision id.');
    }
    return { nutritionGuidance: [...prior, entered] };
  });
}

export function updateNutritionGuidance(id: string, envelope: RenalNutritionEnvelope, at: string): void {
  if (!isNutritionGuidance(envelope) || envelope.id === id) throw new Error('Use a new revision id for the updated instruction.');
  useSafetyStore.setState((s) => {
    const prior = s.nutritionGuidance ?? [];
    const old = prior.find((e) => e.id === id);
    if (!old) throw new Error('Choose an existing instruction and a new revision id.');
    const entered = { ...envelope, version: (old.version ?? 1) + 1, supersedesId: id, recordedAt: at };
    const existing = prior.find((e) => e.id === envelope.id);
    if (existing) {
      if (JSON.stringify(existing) === JSON.stringify(entered)) return {};
      throw new Error('Choose an existing instruction and a new revision id.');
    }
    return { nutritionGuidance: [...prior.map((e) => e.id === id ? { ...e, revokedAt: at.slice(0, 10) } : e), entered] };
  });
}

export function revokeNutritionGuidance(id: string, at: string): void {
  useSafetyStore.setState((s) => ({ nutritionGuidance: (s.nutritionGuidance ?? []).map((e) => e.id === id ? { ...e, revokedAt: e.revokedAt ?? at.slice(0, 10) } : e) }));
}

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
  const day = appDay(new Date(nowIso));
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
  const profile = buildPersonProfile(pickBodyValues(useProfileStore.getState()));
  const markerDoc = readMarkersDoc();
  const markerContext = markerRuleContext({ profile, flags: outcome.flags, ...readMarkerContextSources() }, day);
  const findings = markerRenalFindings(markerDoc, evaluateMarkers(markerDoc, markerContext), markerContext.today);
  outcome.renal = resolveRenalScope({ sourceKnown: s.nutritionGuidance !== null, flags: outcome.flags, envelopes: s.nutritionGuidance ?? [], findings, medicationChanges: markerDoc.medications, recentIllnessAt: s.recentIllnessAt ?? undefined, recentIllness: optIns.recentIllness, today: day, body: { weightKg: profile.body.weightKg, heightCm: profile.body.heightCm }, locks: outcome.plannerLocks });
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

/* ---------------------------------------------------------------- shared suggestion policy input (D7-03) */

/** The pure builder, for headless callers that hold the inputs themselves. */
export { suggestionSafetyFrom };

/**
 * The suggestion-policy input from the stored screening (tri-state answers; no answers = every screened predicate
 * unknown, never a negative screen) and, when given, the current marker evaluation's flags and noSuggest decisions.
 * Answers that wait for review after an import are treated as not answered.
 */
export function suggestionSafetyNow(
  markers?: { flags?: readonly string[]; noSuggest?: readonly MarkerNoSuggestInput[] } | null,
  extra: { diet?: { rulesComplete?: boolean; allergies?: readonly string[] } | null; clinicianStops?: readonly string[]; refused?: readonly string[] } = {},
): SuggestionSafetyInput {
  const s = useSafetyStore.getState();
  return suggestionSafetyFrom(s.answers, { pendingReview: s.pendingReview, markers: markers ?? null, ...extra });
}

/* ---------------------------------------------------------------- headless Planner screening input (A1-002) */

/**
 * (A1-002) The Planner's screening safety input composed headlessly, exactly as the Planner screen builds its snapshot
 * (`features/planner/model.ts`): the screening outcome and access, the fasting opt-ins and the supplement answers under the
 * shared suggestion policy (screening, the current marker flags/noSuggest, food allergies once the food rules are
 * answered). Lifecycle boundaries compose the current marker locks onto it (`withCurrentSafety`) when no Planner request
 * has been published, so current clinical limits never depend on a mounted Planner or a goal.
 */
export function plannerSafetyInputNow(
  nowIso: string = new Date().toISOString(),
  markers?: { flags?: readonly string[]; noSuggest?: readonly MarkerNoSuggestInput[] } | null,
): PlannerSafetyInput {
  const access = safetyAccessNow(nowIso);
  // Read the document directly: the intake command helpers import onboarding hooks and the bus.
  const doc = toIntakeDoc(getDocumentStore().peek('intake', 'me'));
  const diet = doc.diet;
  const policy = suggestionSafetyNow(markers ?? null, { diet: diet && diet.rulesComplete ? { rulesComplete: true, allergies: diet.allergies } : null });
  const supp = supplementSnapshot(doc.supplements, policy);
  return toSafetyInput({ outcome: access.outcome, plannerAccess: access.plannerAccess, optedTier: access.optedTier, shortWindowOn: access.shortWindowOn, ...supp });
}
