import { appDay } from '@/living/appDay';
import { resolveRenalScope } from '@/lib/renalScope';
import { usePersonProfile } from '@/state/profileStore';
import { markerRuleContext } from '@/markers/context';
import { markerRenalFindings } from '@/markers/renal';
import { evaluateMarkers } from '@/markers/rules';
import { useMarkersDoc } from '@/markers/ui/markersDoc';
import { useMarkerContextSources } from '@/markers/ui/contextSources';
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSafetyStore } from '@/state/safetyStore';
import { nowIso } from './clock';
import { ACK_VERSIONS, FASTING_ACK_VERSION, MODE_LABEL, SHORT_WINDOW_ACK_VERSION } from './copy';
import { gateStatus, type GateStatus } from './gate';
import {
  EXPERT_MODE_AVAILABLE,
  RECENT_ILLNESS_BLOCK_DAYS,
  daysBetween,
  evaluateScreening,
  pendingAcknowledgements,
  resolveOptIns,
  validFastingTier,
  type AcknowledgementId,
  type FastingEligibility,
  type FastingOptIn,
  type OptInTier,
  type PlannerAccess,
  type PlannerLock,
  type SafetyContext,
  type ScreeningOutcome,
  type SimulatorAccess,
} from './safetyRules';
import { sendCommand } from '@/features/lib/sendCommand';
import '@/commands/defs/safety'; // registers the commands dispatched here

/** Body facts the caller knows (Your body); opt-ins come from the store. */
export type SafetyBodyContext = Omit<SafetyContext, 'optIns'>;

export interface SafetyAccess {
  gate: GateStatus;
  /** Screening done, consent current, nothing waiting for review. */
  ready: boolean;
  outcome: ScreeningOutcome;
  modeLabel: string;
  /** 'blocked' until the gate is ready. */
  simulatorAccess: SimulatorAccess;
  /** 'blocked' until the gate is ready. */
  plannerAccess: PlannerAccess;
  plannerLocks: PlannerLock[];
  fasting: FastingEligibility & {
    optIn: FastingOptIn | null;
    /** The opt-in that counts now (acknowledgements current, not paused by illness). */
    optedTier: OptInTier | null;
    /** An opt-in exists but its acknowledgements are for older copy. */
    needsReconfirm: boolean;
    /** Migrated from the interim settings switch; needs the new acknowledgements. */
    legacyRequest: boolean;
    /** Days left in the recent-illness pause (0 = none). */
    illnessDaysLeft: number;
    shortWindowOn: boolean;
  };
  /** Required acknowledgements missing or outdated (e.g. 'clinician-first' before the Planner). */
  pendingAcknowledgements: AcknowledgementId[];
  acknowledge: (id: AcknowledgementId) => void;
}

/**
 * The safety gate for feature pages: evaluates the stored answers with the current opt-ins (and the body
 * context when the caller has it). The Planner should pass `{ ageYears, bmi, bodyFatPct, sex }` from Your body.
 *
 *   const { plannerAccess, plannerLocks, fasting } = useSafetyAccess(bodyContext);
 */
export function useSafetyAccess(context: SafetyBodyContext = {}): SafetyAccess {
  const profile = usePersonProfile();
  const markerDoc = useMarkersDoc();
  const markerSources = useMarkerContextSources();
  const s = useSafetyStore(
    useShallow((st) => ({
      answers: st.answers,
      nutritionGuidance: st.nutritionGuidance,
      answeredAt: st.answeredAt,
      questionSetVersion: st.questionSetVersion,
      acknowledgements: st.acknowledgements,
      pendingReview: st.pendingReview,
      fastingOptIn: st.fastingOptIn,
      legacy: st.legacyLongFastsRequest,
      recentIllnessAt: st.recentIllnessAt,
      shortWindow: st.shortWindow,
    })),
  );
  // Day precision is enough for expiry windows; it also keeps the memo stable within a day.
  const now = nowIso();
  const today = now.slice(0, 10);
  const { ageYears, bmi, bodyFatPct, sex, highTrainingLoad, symptoms, exerciseEnvelopes, nutritionEnvelopes, medicationChanges, renalFindings, weightKg, weightOn, heightCm } = context;
  // D4-02/D4-07: the dated facts a caller has (symptom reports, reviewed envelopes, kidney findings, actual weight) reach
  // the evaluation as given; envelopes are judged on the caller's day, else today (without a day none could apply)
  const day = context.today ?? appDay(new Date(now));

  return useMemo<SafetyAccess>(() => {
    const at = `${today}T12:00:00.000Z`;
    const gate = gateStatus(s, at);
    const optIns = resolveOptIns({ fastingOptIn: s.fastingOptIn, shortWindow: s.shortWindow, recentIllnessAt: s.recentIllnessAt }, at, { fasting: FASTING_ACK_VERSION, shortWindow: SHORT_WINDOW_ACK_VERSION }, EXPERT_MODE_AVAILABLE);
    const outcome = evaluateScreening(s.answers ?? {}, {
      ageYears,
      bmi,
      bodyFatPct,
      sex,
      highTrainingLoad,
      optIns,
      today: day,
      ...(symptoms ? { symptoms } : {}),
      ...(exerciseEnvelopes ? { exerciseEnvelopes } : {}),
      ...(nutritionEnvelopes ? { nutritionEnvelopes } : {}),
      ...(medicationChanges ? { medicationChanges } : {}),
      ...(renalFindings ? { renalFindings } : {}),
      ...(weightKg !== undefined ? { weightKg } : {}),
      ...(weightOn !== undefined ? { weightOn } : {}),
      ...(heightCm !== undefined ? { heightCm } : {}),
    });
    const markerContext = markerRuleContext({ profile, flags: outcome.flags, ...markerSources }, day);
    const findings = renalFindings ?? markerRenalFindings(markerDoc, evaluateMarkers(markerDoc, markerContext), markerContext.today);
    outcome.renal = resolveRenalScope({ sourceKnown: s.nutritionGuidance !== null, flags: outcome.flags, envelopes: s.nutritionGuidance ?? nutritionEnvelopes ?? [], findings, medicationChanges: medicationChanges ?? markerDoc.medications, recentIllnessAt: s.recentIllnessAt ?? undefined, recentIllness: optIns.recentIllness, today: day, body: { weightKg: weightKg ?? profile.body.weightKg, weightOn, heightCm: heightCm ?? profile.body.heightCm }, locks: outcome.plannerLocks });
    const ready = gate.status === 'ready';
    const illnessDaysLeft =
      optIns.recentIllness && s.recentIllnessAt ? Math.min(RECENT_ILLNESS_BLOCK_DAYS, Math.max(0, RECENT_ILLNESS_BLOCK_DAYS - daysBetween(s.recentIllnessAt, at))) : 0;
    const needsReconfirm = s.fastingOptIn !== null && validFastingTier(s.fastingOptIn, FASTING_ACK_VERSION, EXPERT_MODE_AVAILABLE) === null;
    return {
      gate,
      ready,
      outcome,
      modeLabel: MODE_LABEL[outcome.modeName],
      simulatorAccess: ready ? outcome.simulatorAccess : 'blocked',
      plannerAccess: ready ? outcome.plannerAccess : 'blocked',
      plannerLocks: ready ? outcome.plannerLocks : [],
      fasting: {
        ...outcome.fasting,
        optIn: s.fastingOptIn,
        optedTier: optIns.fastingTier ?? null,
        needsReconfirm,
        legacyRequest: s.legacy,
        illnessDaysLeft,
        shortWindowOn: optIns.shortEatingWindow === true,
      },
      pendingAcknowledgements: pendingAcknowledgements(outcome, s.acknowledgements, ACK_VERSIONS),
      acknowledge: (id) => void sendCommand('safety.acknowledge', { id, version: ACK_VERSIONS[id], at: nowIso() }),
    };
  }, [s, profile, markerDoc, markerSources, today, day, ageYears, bmi, bodyFatPct, sex, highTrainingLoad, symptoms, exerciseEnvelopes, nutritionEnvelopes, medicationChanges, renalFindings, weightKg, weightOn, heightCm]);
}
