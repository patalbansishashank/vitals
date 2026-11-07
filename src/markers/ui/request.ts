/**
 * The planner request with the blood-marker evaluation applied (SUITE_SPEC §13.5.3). Pure.
 *   - lab locks merged into `safety` by `mergeSafety` (the stricter of lab and screening wins);
 *   - `markerWarnings`: the active notes (shown before the ladder and on the rungs they touch; not a margin);
 *   - `preferLevers`: the ranking bias of prefer rules (≤ 0.02 each; regulariser only);
 *   - (D4-07) kidney findings folded into `profile.safety.flags.renalContext` / `nutritionEnvelopes` by
 *     `withRenalFindings`: a kidney result makes the context at least a review, a confirmed condition at least
 *     incomplete, a clinician-level result after an envelope's assessment makes it need review; never relaxed.
 */
import type { PlannerRequest, PlannerSafetyInput } from '@/engine/planner/domain/types';
import { withRenalFindings, type RenalFinding } from '@/features/onboarding/renalScope';
import type { LocalDate } from '@/store';
import { contentHash } from '@/lib/bodyContracts';
import { markerRenalFindings, renalFindingsFromEvaluation } from '../renal';
import { BLOCKING_REASKS, blockingReasks, mergeSafety } from '../rules';
import type { MarkerEvaluation, MarkersDoc } from '../types';

export const MAX_PREFER_WEIGHT = 0.02;

/**
 * Unchanged object when the evaluation adds nothing (stable request hashes). `renalFindings` (from `markerRenalFindings`,
 * which also reads confirmed conditions and their clinician stage) replaces the findings read from the evaluation alone.
 */
export function withMarkerSafety<R extends PlannerRequest>(request: R, ev: MarkerEvaluation | null | undefined, renalFindings?: readonly RenalFinding[], today?: LocalDate): R {
  if (!ev) return request;
  const hasPatch = ev.safety.plannerLocks.length > 0 || ev.safety.flags.length > 0;
  const findings = renalFindings ?? renalFindingsFromEvaluation(ev);
  if (!hasPatch && ev.notes.length === 0 && ev.preferLevers.length === 0 && findings.length === 0) return request;
  const out: R = { ...request };
  if (hasPatch) out.safety = mergeSafety(request.safety, ev.safety);
  if (ev.notes.length) out.markerWarnings = ev.notes;
  if (ev.preferLevers.length) out.preferLevers = ev.preferLevers.map((p) => ({ lever: p.lever, weight: Math.min(MAX_PREFER_WEIGHT, p.weight), rule: p.rule }));
  const safety = request.profile.safety ?? { mode: 'M0' as const, flags: {} };
  if (findings.length) {
    const pf = safety.flags;
    const renal = withRenalFindings(pf, findings, today ?? request.profile.startDate, { weightKg: request.profile.body.weightKg, heightCm: request.profile.body.heightCm });
    if (contentHash(renal) !== contentHash({ renalContext: pf.renalContext, nutritionEnvelopes: pf.nutritionEnvelopes, renalScope: pf.renalScope })) {
      const { renalContext: _c, nutritionEnvelopes: _e, renalScope: _scope, ...rest } = pf;
      void _c; void _e; void _scope;
      out.profile = { ...request.profile, safety: { ...safety, flags: { ...rest, ...renal } } };
    }
  }
  return out;
}

/* ------------------------------------------------------------------------------------------- current safety (A1-002) */

/** Sources of explicit bounds the screening encoding does not express; they carry over until their own source replaces them. */
const EXPLICIT_BOUND_SOURCES: ReadonlySet<string> = new Set(['clinician', 'user', 'import']);

type SafetyLock = NonNullable<PlannerSafetyInput['plannerLocks']>[number];

/**
 * The CURRENT clinical facts a prescription is checked against, read at the boundary (A1-002) — never a mounted Planner, a
 * goal or a previously prepared request. Each is injected by the caller from persisted state with the SAME rule context the
 * Planner uses (`markerRuleContext` at the current app day: diet and medication change dates, freshness).
 */
export interface CurrentSafetySources {
  /**
   * The current screening and opt-in safety input (`toSafetyInput` of the current safety snapshot: screening locks with
   * units, fasting tiers, opt-ins, restrictions, flags). `null` = it could not be loaded.
   */
  screening: PlannerSafetyInput | null;
  /** `evaluateMarkers(currentMarkersDoc, markerRuleContext(…, today))`; `null` = the markers could not be loaded or evaluated. */
  markers: MarkerEvaluation | null;
  /** The current markers document (its clinician-confirmed conditions and stage feed the renal findings). */
  markersDoc?: Pick<MarkersDoc, 'conditions'> | null;
  /** The current app day (the evaluation's `ctx.today`). */
  today: LocalDate;
  /** Explicit, independently applicable bounds active now (clinician / user / import), each with its unit and source. */
  bounds?: PlannerSafetyInput['plannerLocks'];
  /** Explicit bounds revoked by their own source since the stored request (`{ id, source }`): not carried over. */
  revoked?: ReadonlyArray<{ id: string; source: string }>;
  /** The stored request's safety input: its explicit clinician/user/import bounds carry over unless superseded or revoked. */
  stored?: PlannerSafetyInput | null;
  /** When each blocking re-ask topic was last answered (`screeningAnsweredOn`). */
  answeredOn?: Readonly<Partial<Record<string, LocalDate>>>;
}

export type CurrentSafety<R extends PlannerRequest> =
  | {
      status: 'current';
      /** The request with the current safety input, marker locks/flags/warnings/preferences and renal findings applied. */
      request: R;
      /** Blocking marker re-asks raised by readings newer than the screening answer (they pause a new prescription). */
      blockingReasks: MarkerEvaluation['reasks'];
    }
  | {
      /** Required clinical coverage is missing: the boundary is Unchecked and not startable (never an older input). */
      status: 'unchecked';
      missing: Array<'screening' | 'markers'>;
    };

/**
 * Explicit bounds that stay in force (A1-002): the stored request's clinician/user/import bounds unless the same source
 * supplies that lock again now (a supersession) or revoked it, plus the current ones. Screening- and marker-sourced locks
 * (and legacy locks without a source) are never carried over: they are re-derived from the current facts.
 */
function explicitBounds(s: Pick<CurrentSafetySources, 'bounds' | 'revoked' | 'stored'>): SafetyLock[] {
  const current = [...(s.bounds ?? [])];
  const replaced = (l: SafetyLock): boolean =>
    current.some((c) => c.id === l.id && (c.source ?? '') === (l.source ?? '')) || (s.revoked ?? []).some((r) => r.id === l.id && r.source === (l.source ?? ''));
  const carried = (s.stored?.plannerLocks ?? []).filter((l) => l.source !== undefined && EXPLICIT_BOUND_SOURCES.has(l.source) && !replaced(l));
  return [...carried, ...current];
}

/**
 * The request with the CURRENT clinical safety applied, headless (A1-002; C5/D4-01/D7-05): one composer for every
 * lifecycle boundary (start, scenario start, adopt, resume), the re-plan request and Planner publishing, so a custom
 * scenario or a plan without Planner goals is checked against the same clinical locks.
 *  - the current screening input replaces the stored one (screening locks, fasting tiers, opt-ins, restrictions, flags);
 *  - explicit clinician/user/import bounds carry over (same-source supersession and revocation resolved) and intersect with
 *    the screening's by typed unit (`mergeSafety`: caps by minimum, floors by maximum, unaccepted units kept apart for the
 *    planner's typed resolver);
 *  - the current marker evaluation's locks and flags merge in, its notes and prefer biases replace any stored ones, and
 *    its kidney findings fold into the profile (`withMarkerSafety`);
 *  - blocking re-asks are returned for the caller's gate.
 * The request's profile must already carry the CURRENT profile safety. Missing current screening or markers is
 * `unchecked` (required coverage missing, not startable) — never a silent fallback to an older clinical input. No goal is
 * needed and no clinical threshold is introduced here: the locks are the rules' own (e.g. TG ≥ 1000 mg/dL → fat ≤ 30 %E).
 */
export function withCurrentSafety<R extends PlannerRequest>(request: R, s: CurrentSafetySources): CurrentSafety<R> {
  const missing: Array<'screening' | 'markers'> = [];
  if (!s.screening) missing.push('screening');
  if (!s.markers) missing.push('markers');
  if (missing.length || !s.screening || !s.markers) return { status: 'unchecked', missing };
  const safety = mergeSafety(s.screening, { plannerLocks: explicitBounds(s), flags: [] });
  // the stored request's marker notes and prefer biases describe an older evaluation: the current one replaces them
  const { markerWarnings: _w, preferLevers: _p, ...rest } = request;
  void _w;
  void _p;
  const base = { ...rest, safety } as R;
  const findings = s.markersDoc ? markerRenalFindings(s.markersDoc, s.markers, s.today) : undefined;
  return { status: 'current', request: withMarkerSafety(base, s.markers, findings, s.today), blockingReasks: blockingReasks(s.markers, s.answeredOn ?? {}) };
}

/**
 * When each re-asked screening item was last answered. The screening stores one answer time for the whole set, so
 * every blocking re-ask reads it: answering the safety questions again clears re-asks raised by older readings (the
 * reading that raised each re-ask decides, D7-05 — an old abnormality answered about since does not block again).
 */
export function screeningAnsweredOn(answeredAt: string | null | undefined): Partial<Record<string, LocalDate>> {
  if (!answeredAt) return {};
  const day = answeredAt.slice(0, 10);
  return Object.fromEntries([...BLOCKING_REASKS].map((k) => [k, day]));
}

/** Plain words for the screening item a re-ask is about. */
export const REASK_TOPIC: Readonly<Record<string, string>> = {
  diabetes: 'diabetes',
  kidney: 'kidney disease',
  gout: 'gout',
  foodAllergy: 'food allergies',
  // D7-05: an old lipid finding's review (a question, never blocking)
  lipids: 'cholesterol',
};

export function reaskMessage(about: string, markerLabel?: string): string {
  const topic = REASK_TOPIC[about] ?? 'your health';
  return `${markerLabel ? `Your ${markerLabel} result` : 'A blood result'} raises a question about ${topic}. Answer it again in your safety settings, then find plans.`;
}
