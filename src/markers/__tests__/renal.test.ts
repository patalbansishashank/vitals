// @vitest-environment node
/**
 * Kidney readings and the renal scope (D4-07, marker side). A single creatinine result creates no stage, clearance, flag
 * or finding; a low eGFR (one reading or several) is an unconfirmed current abnormality — a neutral review with no stage
 * and no automatic protein bound (its precaution flag and supplement caps stay); an expired one is a prior abnormality; a
 * clinician-confirmed condition carries the clinician's own stage. The planner request receives the renal context through
 * `withMarkerSafety`, which never relaxes it.
 */
import { describe, expect, it } from 'vitest';
import { request, MAN_95, FAT_LOSS_KEEP_LEAN } from '@/engine/planner/domain/__tests__/personas';
import type { PersonProfile } from '@/engine/types/profile';
import { resolveRenalScope, type RenalNutritionEnvelope } from '@/features/onboarding/renalScope';
import { becauseText } from '../because';
import { readingFromInput } from '../doc';
import { markerRenalFindings, renalFindingsFromEvaluation } from '../renal';
import { recordCondition } from '../review';
import { RENAL_WITHHELD_LOCKS, evaluateMarkers, isRenalScopeRule } from '../rules';
import { TABLE } from '../table';
import type { MarkerReadingInput, MarkersDoc, RuleContext } from '../types';
import { withMarkerSafety } from '../ui/request';

const TODAY = '2026-10-02';
const DATE = '2026-09-12';
const ctx: RuleContext = { sex: 'male', today: TODAY, defaultDeficitCapPct: 25, ageYears: 45, referencePhysiology: 'adultMale' };
const doc = (inputs: MarkerReadingInput[]): MarkersDoc => ({ _schema: 1, readings: inputs.map((i) => readingFromInput(i, 'manual', `${i.date}T09:00:00Z`)), displayOnly: [], context: {}, chapter: 'manual' });
const egfr = (value: number, date = DATE): MarkerReadingInput => ({ id: 'egfr', value, unit: 'mL/min/1.73 m²', date });

describe('no stage, persistence or clearance from a reading (D4-07)', () => {
  it('a single creatinine result yields no stage, clearance, flag, lock or renal finding', () => {
    const d = doc([{ id: 'creatinine', value: 2.1, unit: 'mg/dL', date: DATE, labRange: { high: 1.2, unit: 'mg/dL' } }]);
    const ev = evaluateMarkers(d, ctx);
    expect(ev.safety.flags).not.toContain('kidney-disease');
    expect(ev.safety.plannerLocks).toEqual([]);
    expect(ev.states.map((s) => s.markerId)).toEqual(['creatinine']); // no eGFR or clearance derived from it
    const findings = markerRenalFindings(d, ev, TODAY);
    expect(findings).toEqual([]);
    expect(resolveRenalScope({ flags: ev.safety.flags, findings })).toMatchObject({ status: 'none', stage: null });
  });

  it('a single low eGFR: an unconfirmed current abnormality, a neutral review, no stage and no automatic protein bound', () => {
    const d = doc([egfr(52)]);
    const ev = evaluateMarkers(d, ctx);
    const locks = Object.fromEntries(ev.safety.plannerLocks.map((l) => [l.id, l.value]));
    expect(locks['protein-cap']).toBeUndefined();
    expect(locks['creatine-cap']).toBe(0);
    expect(locks['potassium-supp-cap']).toBe(0);
    expect(ev.safety.flags).toContain('kidney-disease'); // the suggestion-policy precaution, not a diagnosis
    const findings = markerRenalFindings(d, ev, TODAY);
    expect(findings).toEqual([{ kind: 'currentAbnormal', source: 'egfr', ref: 'egfr:2026-09-12', date: DATE, rule: 'W-L-EGFR-1' }]);
    const scope = resolveRenalScope({ flags: [], findings });
    expect(scope).toMatchObject({ status: 'review', context: 'priorAbnormalityReview', label: 'Review', stage: null });
    expect(scope.withheld).toEqual(['protein', 'sodium', 'potassium', 'fluid']);
    const n = ev.notes.find((x) => x.rule === 'W-L-EGFR-1')!;
    expect(n.text).toBe("Because your eGFR was 52 mL/min/1.73 m² on 12 Sep 2026, kidney targets for protein, potassium and fluid wait for a repeat test or your clinician's numbers.");
    expect(becauseText(n)).toBe('because your eGFR was 52 mL/min/1.73 m² on 12 Sep 2026');
  });

  it('repeated low values stay unconfirmed: no stage, no confirmed condition, no protein bound', () => {
    const d = doc([egfr(55, '2026-05-01'), egfr(52), { id: 'uacr', value: 45, unit: 'mg/g', date: DATE }]);
    const ev = evaluateMarkers(d, ctx);
    const findings = markerRenalFindings(d, ev, TODAY);
    expect(findings.map((f) => f.kind)).toEqual(['currentAbnormal', 'currentAbnormal']);
    expect(findings.every((f) => f.stage === undefined)).toBe(true);
    expect(ev.safety.plannerLocks.map((l) => l.id)).not.toContain('protein-cap');
    expect(ev.notes.find((x) => x.rule === 'W-L-ACR-1')!.text).toBe("Because your urine ACR was 45 mg/g on 12 Sep 2026, kidney targets for protein, potassium and fluid wait for a repeat test or your clinician's numbers.");
    expect(resolveRenalScope({ flags: [], findings }).stage).toBeNull();
  });

  it('an expired low eGFR is a prior abnormality; a confirmed condition carries only the clinician stage', () => {
    const old = doc([egfr(25, '2025-01-12')]);
    const evOld = evaluateMarkers(old, { ...ctx, today: '2026-03-01' });
    expect(markerRenalFindings(old, evOld, '2026-03-01')).toEqual([{ kind: 'priorAbnormality', source: 'egfr', ref: 'egfr:2025-01-12', date: '2025-01-12', rule: 'W-L-REVIEW-EGFR' }]);
    const ckd = recordCondition(old, { id: 'c1', condition: 'ckd', confirmedOn: '2026-01-05', stage: 'G3b', source: 'selfEnteredClinician' });
    const ev = evaluateMarkers(ckd, { ...ctx, today: '2026-03-01' });
    const findings = markerRenalFindings(ckd, ev, '2026-03-01');
    expect(findings).toContainEqual({ kind: 'clinicianConfirmed', source: 'ckd', ref: 'c1', date: '2026-01-05', stage: 'G3b' });
    expect(resolveRenalScope({ flags: [], findings })).toMatchObject({ status: 'incomplete', context: 'contextIncomplete', stage: 'G3b' });
    // without the document the evaluation still tells a confirmed condition from a fresh reading (stage unknown there)
    expect(renalFindingsFromEvaluation(ev).map((f) => f.kind)).toContain('clinicianConfirmed');
  });

  it('the table rules that mark kidney context are exactly the eGFR < 60 and ACR ≥ 30 rules, and only their protein cap is withheld', () => {
    const renal = TABLE.rules.filter(isRenalScopeRule).map((r) => r.id).sort();
    expect(renal).toEqual(['W-L-ACR-1', 'W-L-EGFR-1']);
    for (const r of TABLE.rules.filter(isRenalScopeRule)) expect((r.effect.locks ?? []).map((l) => l.lock).filter((l) => !RENAL_WITHHELD_LOCKS.has(l))).toEqual([]);
    // no other rule's locks are touched (e.g. the eGFR supplement caps)
    expect(TABLE.rules.find((r) => r.id === 'W-L-EGFR-2')!.effect.locks!.map((l) => l.lock)).toEqual(['creatine-cap', 'potassium-supp-cap']);
  });
});

describe('current renal sources without a marker warning', () => {
  it('composes a confirmed condition even when the marker evaluation has no notes or locks', () => {
    const ev = evaluateMarkers(doc([]), ctx);
    expect(ev.notes).toEqual([]);
    expect(ev.safety.plannerLocks).toEqual([]);
    const base = request(MAN_95, FAT_LOSS_KEEP_LEAN);
    const out = withMarkerSafety(base, ev, [{ kind: 'clinicianConfirmed', source: 'ckd', ref: 'confirmed-current', date: DATE, stage: 'G3b' }], TODAY);
    expect(out.profile.safety?.flags).toMatchObject({ renalContext: 'contextIncomplete', renalScope: { stage: 'G3b', context: 'contextIncomplete' } });
    expect(base.profile.safety).toBeUndefined();
    expect(out.goals).toBe(base.goals);
  });
});

describe('the planner request carries the renal context (D4-07)', () => {
  const withSafety = (flags: NonNullable<PersonProfile['safety']>['flags']): PersonProfile => ({ ...MAN_95, safety: { mode: 'M0', flags } });

  it('a kidney reading makes the context a review; with a kidney answer it stays incomplete; nothing changes without findings', () => {
    const ev = evaluateMarkers(doc([egfr(52)]), ctx);
    const out = withMarkerSafety(request(withSafety({}), FAT_LOSS_KEEP_LEAN), ev);
    expect(out.profile.safety?.flags.renalContext).toBe('priorAbnormalityReview');
    expect(out.safety?.plannerLocks?.map((l) => l.id)).not.toContain('protein-cap');
    const legacy = withMarkerSafety(request(withSafety({ kidneyDisease: true }), FAT_LOSS_KEEP_LEAN), ev);
    expect(legacy.profile.safety?.flags.renalContext).toBe('contextIncomplete');
    expect(legacy.profile.safety?.flags.kidneyDisease).toBe(true); // the original flag is kept

    const normal = evaluateMarkers(doc([egfr(95), { id: 'ldl', value: 192, unit: 'mg/dL', date: DATE }]), ctx);
    const base = request(withSafety({}), FAT_LOSS_KEEP_LEAN);
    expect(withMarkerSafety(base, normal).profile).toBe(base.profile);
  });

  it('an entered kidney envelope stays unless a clinician-level result after its assessment puts it in review', () => {
    const env = (assessedAt: string): RenalNutritionEnvelope => ({ id: 'e', condition: 'ckd', dialysis: 'none', stability: 'stable', weightBasis: 'actual', bounds: [{ id: 'protein', quantity: 'proteinPerDay', unit: 'g/d', value: 130, comparator: 'cap', basis: 'notApplicable', scope: 'total', window: { kind: 'day' }, applicability: 'applicable', mandatory: true, source: { kind: 'clinician', ref: 'e' }, policyVersion: 1 }], assessedAt, source: 'selfEnteredClinician' });
    const ev = evaluateMarkers(doc([egfr(25)]), ctx); // eGFR < 30: the table's clinician rule
    expect(renalFindingsFromEvaluation(ev).map((f) => f.kind)).toEqual(['clinicianLevel', 'currentAbnormal']);
    const before = request(withSafety({ kidneyDisease: true, renalContext: 'envelopeEntered', nutritionEnvelopes: [env('2026-09-01')] }), FAT_LOSS_KEEP_LEAN);
    const out = withMarkerSafety(before, ev);
    expect(out.profile.safety?.flags.renalContext).toBe('contextIncomplete');
    expect(out.profile.safety?.flags.nutritionEnvelopes).toEqual([env('2026-09-01')]);
    expect(out.profile.safety?.flags.renalScope?.needsReview[0]?.reasons).toContain('newClinicalFinding');
    const after = request(withSafety({ kidneyDisease: true, renalContext: 'envelopeEntered', nutritionEnvelopes: [env('2026-09-20')] }), FAT_LOSS_KEEP_LEAN);
    const retained = withMarkerSafety(after, ev);
    expect(retained.profile.safety?.flags.renalContext).toBe('envelopeEntered');
    expect(retained.profile.safety?.flags.nutritionEnvelopes).toEqual(after.profile.safety?.flags.nutritionEnvelopes);
  });
});
