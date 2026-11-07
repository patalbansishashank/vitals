/**
 * Marker review states (D7-05). Pure.
 *
 * Four things are kept apart: a reading's freshness for quantitative use (current / repeat due / expired), an unresolved
 * clinically important history (an expired renal, glycaemic or lipid finding still needing a repeat or a clinician's
 * word), a clinician-confirmed condition, and a documented resolution. Freshness expiry only disables numeric baseline use;
 * it never erases raw history or a confirmed condition, and a later normal value ends an episode review without removing a
 * clinician-confirmed condition (CKD, albuminuria, diabetes). No diagnosis is inferred from the age of a low value.
 *
 * Inline words (C6): `Current`, `Repeat due`, `Review`. The details (why a forecast expired, which history stays open,
 * which rule threshold made it important) belong in the info sheet.
 */
import type { LocalDate } from '@/store';
import { currentReadings, freshnessOf, isStaleIn, type FreshnessContext } from './doc';
import { HISTORY_REVIEW_TOPIC, activeConditions, historyReviewRuleId, isClinicalFindingRule } from './rules';
import { ruleById } from './table';
import type { ClinicianCondition, MarkerEvaluation, MarkerId, MarkerReading, MarkerReviewRecord, MarkersDoc } from './types';
import type { MedicationChange } from '@/engine/types/profile';
import type { RenalContextStatus } from '@/lib/bodyContracts';

export type MarkerFreshness = 'current' | 'repeatDue' | 'expired';
export type MarkerHistoryState = 'none' | 'abnormal' | 'unresolvedPriorAbnormality' | 'clinicianConfirmed' | 'resolved';

export interface MarkerReviewView {
  markerId: MarkerId;
  /** The newest confirmed reading (the value and unit shown exactly as entered). */
  reading: MarkerReading;
  freshness: MarkerFreshness;
  history: MarkerHistoryState;
  /** Reading ids (`<marker>:<date>`) the history state rests on (for an unresolved prior abnormality: its source reading). */
  readingIds: string[];
  /**
   * (A1-010) The earlier reading an unresolved prior abnormality rests on, when it is not the newest one (e.g. an indexed
   * eGFR 40 still open after a newer eGFR whose indexing is unconfirmed): carried separately, `reading` stays the newest.
   */
  source?: Pick<MarkerReading, 'id' | 'value' | 'unit' | 'date'>;
  /** The clinician-confirmed condition behind `clinicianConfirmed`. */
  condition?: ClinicianCondition;
  /** Short inline status word. */
  label: 'Current' | 'Repeat due' | 'Review';
}

/** Stable reading identity (a marker has at most one reading per date: re-entry is a correction). */
export const readingId = (r: Pick<MarkerReading, 'id' | 'date'>): string => `${r.id}:${r.date}`;

/** Markers a clinician-confirmed condition speaks for (its review outlives expiry and later normal values). */
export const CONDITION_MARKERS: Readonly<Record<ClinicianCondition['condition'], readonly MarkerId[]>> = {
  ckd: ['egfr', 'creatinine', 'uacr'],
  albuminuria: ['uacr'],
  diabetes: ['fpg', 'hba1c', 'insulin'],
  dyslipidaemia: ['ldl', 'hdl', 'tg', 'nonHdl', 'apoB', 'lpa'],
  liver: ['alt', 'ast', 'ggt'],
  other: [],
};

export const MARKER_REVIEW_LABEL = { current: 'Current', repeatDue: 'Repeat due', review: 'Review' } as const;

/** The source reading of a marker's history review note (`W-L-REVIEW-*`): its "because" is the episode reading (A1-010). */
function reviewSourceOf(ev: Partial<Pick<MarkerEvaluation, 'notes'>>, m: MarkerId): Pick<MarkerReading, 'id' | 'value' | 'unit' | 'date'> | undefined {
  const n = (ev.notes ?? []).find((x) => x.rule === historyReviewRuleId(m) && x.markerId === m);
  return n ? { id: n.because.markerId, value: n.because.value, unit: n.because.unit, date: n.because.date } : undefined;
}

/**
 * Review state of every marker with a reading, from the document, the rules' freshness context and the evaluation of the
 * same context (`evaluateMarkers(doc, ctx)`): `repeatDue` when a retest the rules set is due; `abnormal` when the current
 * reading fired a clinical finding rule; `unresolvedPriorAbnormality` for a finding still open over the history (the rules'
 * `W-L-REVIEW-*`: expired, or superseded by a reading that cannot reassess it — A1-010; the newest reading is shown exactly,
 * the source reading is carried separately when the evaluation's notes are passed); `clinicianConfirmed` while a confirmed
 * condition covers the marker; `resolved` when a recorded resolution covers it.
 */
export function markerReviewStates(doc: MarkersDoc, ctx: FreshnessContext, ev: Pick<MarkerEvaluation, 'states' | 'retests'> & Partial<Pick<MarkerEvaluation, 'notes'>>): MarkerReviewView[] {
  const fresh = freshnessOf(doc, ctx);
  const conditions = activeConditions(doc, fresh.today);
  return currentReadings(doc).map((reading) => {
    const m = reading.id;
    const st = ev.states.find((s) => s.markerId === m);
    const expired = st ? st.stale : isStaleIn(reading, fresh);
    const due = ev.retests.some((t) => t.markerId === m && t.due <= fresh.today);
    const freshness: MarkerFreshness = expired ? 'expired' : due ? 'repeatDue' : 'current';
    const condition = conditions.find((c) => CONDITION_MARKERS[c.condition].includes(m));
    const fired = st?.rules ?? [];
    let history: MarkerHistoryState = 'none';
    if (condition) history = 'clinicianConfirmed';
    else if (fired.includes(historyReviewRuleId(m))) history = 'unresolvedPriorAbnormality';
    else if (fired.some((id) => {
      const rule = ruleById(id);
      return !!rule && isClinicalFindingRule(rule);
    }))
      history = 'abnormal';
    else if ((doc.reviews ?? []).some((v) => v.markerId === m && v.state === 'resolved')) history = 'resolved';
    const label = history === 'clinicianConfirmed' || history === 'unresolvedPriorAbnormality' || history === 'abnormal' ? MARKER_REVIEW_LABEL.review : freshness === 'current' ? MARKER_REVIEW_LABEL.current : MARKER_REVIEW_LABEL.repeatDue;
    const source = history === 'unresolvedPriorAbnormality' ? reviewSourceOf(ev, m) : undefined;
    const prior = source && readingId(source) !== readingId(reading) ? source : undefined;
    const view: MarkerReviewView = { markerId: m, reading, freshness, history, readingIds: [readingId(prior ?? reading)], label };
    if (prior) view.source = prior;
    if (condition) view.condition = condition;
    return view;
  });
}

/* ------------------------------------------------------------------------------------------- persisted review records */

/**
 * Migration of review records (D7-05, additive and idempotent): every marker with an unresolved prior abnormality in `ev`
 * gets one persisted `unresolvedPriorAbnormality` record (authority `rule`) with its source reading id (A1-010: the
 * episode reading named by the review note, not merely the newest reading) — conservatively, without assigning any
 * diagnosis. Existing records are kept as stored; running it again adds nothing.
 */
export function withInitialReviewRecords(doc: MarkersDoc, ev: Pick<MarkerEvaluation, 'states'> & Partial<Pick<MarkerEvaluation, 'notes'>>, today: LocalDate): MarkersDoc {
  const existing = doc.reviews ?? [];
  const add: MarkerReviewRecord[] = [];
  for (const st of ev.states) {
    const id = historyReviewRuleId(st.markerId);
    if (!st.rules.includes(id) || !HISTORY_REVIEW_TOPIC[st.markerId]) continue;
    const rid = readingId(reviewSourceOf(ev, st.markerId) ?? st.reading);
    const recId = `review:${rid}`;
    if (existing.some((v) => v.id === recId)) continue;
    add.push({ id: recId, markerId: st.markerId, readingIds: [rid], state: 'unresolvedPriorAbnormality', since: today, authority: 'rule', ruleId: id });
  }
  return add.length ? { ...doc, reviews: [...existing, ...add] } : doc;
}

/**
 * Record a documented resolution of a marker's review (a newer normal repeat or a clinician clearance; D7-05). It ends the
 * episode review for readings up to `on`; it never removes a clinician-confirmed condition (see `resolveCondition`).
 */
export function resolveReview(doc: MarkersDoc, markerId: MarkerId, on: LocalDate, authority: MarkerReviewRecord['authority'], readingIds: readonly string[] = []): MarkersDoc {
  const rec: MarkerReviewRecord = { id: `resolved:${markerId}:${on}`, markerId, readingIds: [...readingIds], state: 'resolved', since: on, resolvedOn: on, authority };
  const rest = (doc.reviews ?? []).filter((v) => v.id !== rec.id);
  return { ...doc, reviews: [...rest, rec] };
}

/** Add or replace a clinician-confirmed condition (separate from readings). */
export function recordCondition(doc: MarkersDoc, condition: ClinicianCondition): MarkersDoc {
  const rest = (doc.conditions ?? []).filter((c) => c.id !== condition.id);
  return { ...doc, conditions: [...rest, condition] };
}

/** A documented clinician resolution of a condition (kept as a record with its date, never deleted). */
export function resolveCondition(doc: MarkersDoc, conditionId: string, on: LocalDate): MarkersDoc {
  return { ...doc, conditions: (doc.conditions ?? []).map((c) => (c.id === conditionId ? { ...c, resolvedOn: on } : c)) };
}

/** Add or replace a dated medication change (D7-09; segments freshness and calibration, never a dose instruction). */
export function recordMedicationChange(doc: MarkersDoc, change: MedicationChange): MarkersDoc {
  const rest = (doc.medications ?? []).filter((m) => m.id !== change.id);
  return { ...doc, medications: [...rest, change].sort((a, b) => a.date.localeCompare(b.date)) };
}

/** Whether a finding rule id belongs to the history-review set (for callers grouping notes). */
export const isHistoryReviewRule = (id: string): boolean => id.startsWith('W-L-REVIEW-');

/**
 * The renal context the markers establish (D7-05 → D4-07 `profile.safety.flags.renalContext`): an expired kidney finding
 * still under review is `priorAbnormalityReview` (neutral review, never a stage or a CKD diagnosis); a clinician-confirmed
 * CKD or albuminuria without an entered nutrition envelope is `contextIncomplete`; otherwise nothing (undefined).
 *
 * @deprecated It misses a current abnormal reading. Use `markerRenalFindings` (./renal) with `resolveRenalScope` /
 * `withRenalFindings` (features/onboarding/renalScope), where a current abnormal reading is `priorAbnormalityReview`.
 */
export function renalContextFromMarkers(doc: Pick<MarkersDoc, 'conditions'>, ev: Pick<MarkerEvaluation, 'reasks'>, today: LocalDate): RenalContextStatus | undefined {
  if (activeConditions(doc, today).some((c) => c.condition === 'ckd' || c.condition === 'albuminuria')) return 'contextIncomplete';
  if (ev.reasks.some((q) => q.about === 'kidney' && isHistoryReviewRule(q.rule))) return 'priorAbnormalityReview';
  return undefined;
}
