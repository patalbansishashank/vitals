/**
 * Kidney findings from the blood markers (D4-07). Pure.
 *
 * Four things stay apart: a current abnormal kidney reading (a kidney-flag rule fired on a fresh reading), an expired one
 * still under review (`W-L-REVIEW-*`), a clinician-confirmed kidney condition, and a clinician-level result (the table's
 * own clinician rules for kidney and electrolyte markers; it makes an entered nutrition envelope assessed before it need
 * review). Nothing here stages chronic kidney disease, infers its persistence or computes a clearance: a stage is only
 * what a clinician entered, repeated low values stay `currentAbnormal` (unconfirmed), and a creatinine alone (no eGFR
 * reading, no flag rule) yields no finding. These findings feed the renal scope (src/features/onboarding/renalScope.ts),
 * which keeps renal-targeted numbers withheld until an applicable clinician envelope exists.
 */
import type { LocalDate } from '@/store';
import type { RenalFinding } from '@/features/onboarding/renalScope';
import { activeConditions, isRenalScopeRule } from './rules';
import { isHistoryReviewRule, readingId } from './review';
import { ruleById } from './table';
import type { MarkerEvaluation, MarkerId, MarkersDoc } from './types';

/** Markers whose clinician rules make an envelope assessed before the result need review (kidney and electrolytes). */
export const RENAL_REVIEW_MARKERS: ReadonlySet<MarkerId> = new Set<MarkerId>(['egfr', 'uacr', 'creatinine', 'potassium', 'sodium']);

const byRef = (a: RenalFinding, b: RenalFinding): number => (a.kind + a.ref < b.kind + b.ref ? -1 : a.kind + a.ref > b.kind + b.ref ? 1 : 0);

/**
 * Findings readable from an evaluation alone (no document): current abnormal kidney readings, expired kidney findings
 * under review, clinician-level kidney/electrolyte results, and — when the kidney flag stands without any fresh kidney
 * rule behind it — a clinician-confirmed condition (the only other source of that flag; its stage needs the document).
 */
export function renalFindingsFromEvaluation(ev: Pick<MarkerEvaluation, 'notes' | 'reasks' | 'safety'>): RenalFinding[] {
  const out = new Map<string, RenalFinding>();
  const put = (f: RenalFinding): void => {
    if (!out.has(`${f.kind}|${f.ref}`)) out.set(`${f.kind}|${f.ref}`, f);
  };
  for (const n of ev.notes) {
    const rule = ruleById(n.rule);
    const ref = readingId({ id: n.because.markerId, date: n.because.date });
    if (rule && isRenalScopeRule(rule)) put({ kind: 'currentAbnormal', source: n.markerId, ref, date: n.because.date, rule: n.rule });
    if (n.kind === 'clinician' && RENAL_REVIEW_MARKERS.has(n.markerId)) put({ kind: 'clinicianLevel', source: n.markerId, ref, date: n.because.date, rule: n.rule });
  }
  for (const q of ev.reasks) {
    if (q.about !== 'kidney' || !isHistoryReviewRule(q.rule)) continue;
    const n = ev.notes.find((x) => x.rule === q.rule && x.markerId === q.markerId);
    put({ kind: 'priorAbnormality', source: q.markerId, ref: n ? readingId({ id: n.because.markerId, date: n.because.date }) : q.markerId, ...(n ? { date: n.because.date } : {}), rule: q.rule });
  }
  const freshFlag = [...out.values()].some((f) => f.kind === 'currentAbnormal');
  if (ev.safety.flags.includes('kidney-disease') && !freshFlag) put({ kind: 'clinicianConfirmed', source: 'ckd', ref: 'condition' });
  return [...out.values()].sort(byRef);
}

/**
 * Findings from the document and its evaluation (`evaluateMarkers(doc, ctx)` with `ctx.today = today`): the evaluation's
 * reading findings plus each clinician-confirmed kidney condition in force on `today`, with the clinician's own stage.
 */
export function markerRenalFindings(doc: Pick<MarkersDoc, 'conditions'>, ev: Pick<MarkerEvaluation, 'notes' | 'reasks' | 'safety'>, today: LocalDate): RenalFinding[] {
  const fromReadings = renalFindingsFromEvaluation(ev).filter((f) => f.kind !== 'clinicianConfirmed');
  const confirmed: RenalFinding[] = activeConditions(doc, today)
    .filter((c) => c.condition === 'ckd' || c.condition === 'albuminuria')
    .map((c) => ({ kind: 'clinicianConfirmed', source: c.condition, ref: c.id, date: c.confirmedOn, ...(c.stage ? { stage: c.stage } : {}) }));
  return [...fromReadings, ...confirmed].sort(byRef);
}
