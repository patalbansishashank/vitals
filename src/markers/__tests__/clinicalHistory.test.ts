// @vitest-environment node
/**
 * Review 2026-10-18, marker clinical semantics:
 *   D7-09  fasting eligibility per draw and bounded prediabetes bands (100 ≤ FPG < 126 mg/dL, 5.7 ≤ HbA1c < 6.5 %);
 *   D7-06  HOMA-IR only from an eligible same-draw pair (no pairing by date, no newest-glucose pairing, no insulin);
 *   D7-05  freshness vs unresolved history vs clinician-confirmed condition vs documented resolution; one freshness
 *          context (diet exposure + medication changes) for the rules and the engine baseline builder; stale Body
 *          fallbacks never re-enter; old electrolytes expire without a perpetual alert.
 */
import { describe, expect, it } from 'vitest';
import type { PersonProfile } from '@/engine/types/profile';
import { labBaselinesWithDates, withMarkerLabs } from '../baselines';
import { dietChangeDateOf, markerRuleContext } from '../context';
import { freshnessOf, isStaleIn, readingFromInput } from '../doc';
import { markerReviewStates, recordCondition, renalContextFromMarkers, resolveCondition, resolveReview, withInitialReviewRecords } from '../review';
import { blockingReasks, evaluateMarkers, homaFor } from '../rules';
import type { MarkerReading, MarkerReadingInput, MarkersDoc, RuleContext } from '../types';
import { MGDL_PER_MMOLL_GLC } from '@/engine/model/cardiometabolic/baselines';

const TODAY = '2026-10-02';

const rd = (i: MarkerReadingInput, extra: Partial<MarkerReading> = {}): MarkerReading => readingFromInput(i, 'manual', `${i.date}T09:00:00Z`, extra);
const docOf = (readings: MarkerReading[], extra: Partial<MarkersDoc> = {}): MarkersDoc => ({ _schema: 1, readings, displayOnly: [], context: {}, chapter: 'manual', ...extra });
const ctxAt = (today: string, extra: Partial<RuleContext> = {}): RuleContext => ({ sex: 'male', today, ageYears: 45, defaultDeficitCapPct: 25, flags: [], ...extra });
const fired = (d: MarkersDoc, c: RuleContext): string[] => evaluateMarkers(d, c).notes.map((n) => n.rule);

/* ------------------------------------------------------------------------------------------- D7-09 */

describe('D7-09 fasting eligibility and bounded prediabetes bands', () => {
  const fpg = (value: number, extra: Partial<MarkerReading>) => docOf([rd({ id: 'fpg', value, unit: 'mg/dL', date: '2026-09-20' }, extra)]);
  const FASTING = { fastingHours: 10 };

  it('126 mg/dL fasting is diabetes range (re-ask, clinician confirmation), never a prediabetes-only label', () => {
    const f = fired(fpg(126, FASTING), ctxAt(TODAY));
    expect(f).toContain('W-L-FPG-1');
    expect(f).toContain('W-L-FPG-C1');
    expect(f).not.toContain('W-L-FPG-2');
    expect(fired(fpg(125.9, FASTING), ctxAt(TODAY))).toContain('W-L-FPG-2');
    expect(fired(fpg(100, FASTING), ctxAt(TODAY))).toContain('W-L-FPG-2');
  });

  it('a non-fasting or unknown-fasting glucose never gets the impaired-fasting-glucose (prediabetes) label', () => {
    const non = evaluateMarkers(fpg(110, { fastingHours: 3 }), ctxAt(TODAY));
    expect(non.notes.map((n) => n.rule)).not.toContain('W-L-FPG-2');
    expect(non.notes.map((n) => n.rule)).not.toContain('W-L-FPG-4');
    const unk = evaluateMarkers(fpg(110, {}), ctxAt(TODAY));
    expect(unk.notes.map((n) => n.rule)).not.toContain('W-L-FPG-2');
    expect(unk.unresolved).toContainEqual({ rule: 'W-L-FPG-2', field: 'reading.fasting' });
    // the observed value stays exactly as entered
    expect(unk.states.find((s) => s.markerId === 'fpg')?.reading.value).toBe(110);
  });

  it('an unknown-fasting 130 mg/dL keeps the diabetes re-ask (safety) but is not labelled diabetes range; a known non-fasting one is neither', () => {
    const unk = fired(fpg(130, {}), ctxAt(TODAY));
    expect(unk).toContain('W-L-FPG-1');
    expect(unk).not.toContain('W-L-FPG-C1');
    const non = fired(fpg(130, { fastingStatus: 'nonFasting' }), ctxAt(TODAY));
    expect(non).not.toContain('W-L-FPG-1');
    expect(non).not.toContain('W-L-FPG-C1');
  });

  it('fasting hours decide over a legacy flag (6 h is not ≥ 8 h without calories)', () => {
    expect(fired(fpg(110, { fasting: true, fastingHours: 6 }), ctxAt(TODAY))).not.toContain('W-L-FPG-2');
    expect(fired(fpg(110, { fasting: true }), ctxAt(TODAY))).toContain('W-L-FPG-2');
  });

  it('HbA1c 6.5 % is not prediabetes-only; 5.7–6.4 % is', () => {
    const a1c = (v: number) => docOf([rd({ id: 'hba1c', value: v, unit: '%', date: '2026-09-20' })]);
    const at65 = fired(a1c(6.5), ctxAt(TODAY));
    expect(at65).not.toContain('W-L-HBA1C-2');
    expect(at65).toContain('W-L-HBA1C-1');
    expect(at65).toContain('W-L-HBA1C-5');
    expect(fired(a1c(6.4), ctxAt(TODAY))).toContain('W-L-HBA1C-2');
    expect(fired(a1c(5.7), ctxAt(TODAY))).toContain('W-L-HBA1C-2');
    expect(fired(a1c(5.6), ctxAt(TODAY))).not.toContain('W-L-HBA1C-2');
  });

  it('a haemoglobin variant prompts an assay-specific review, not a blanket "use fasting glucose instead"', () => {
    const ev = evaluateMarkers(docOf([rd({ id: 'hba1c', value: 6.0, unit: '%', date: '2026-09-20' })]), ctxAt(TODAY, { flags: ['anaemia_or_haemoglobinopathy'] }));
    const n = ev.notes.find((x) => x.rule === 'W-L-HBA1C-3');
    expect(n?.text).toContain('may read wrong with some test methods');
    expect(n?.text).not.toContain('fasting glucose instead');
  });

  it('existing drug fasting guards are unchanged: an HbA1c of 6.8 % still holds fasting for a clinician', () => {
    const ev = evaluateMarkers(docOf([rd({ id: 'hba1c', value: 6.8, unit: '%', date: '2026-09-20' })]), ctxAt(TODAY, { flags: ['insulin'] }));
    expect(ev.notes.find((n) => n.rule === 'W-L-HBA1C-5')?.levers).toEqual(['fast48plus']);
    expect(ev.reasks).toContainEqual({ rule: 'W-L-HBA1C-1', markerId: 'hba1c', about: 'diabetes' });
  });
});

/* ------------------------------------------------------------------------------------------- D7-06 */

describe('D7-06 HOMA-IR only from an eligible same-draw pair', () => {
  const g = (date: string, extra: Partial<MarkerReading>, value = 126, unit = 'mg/dL') => rd({ id: 'fpg', value, unit, date }, extra);
  const ins = (date: string, extra: Partial<MarkerReading>, value = 15) => rd({ id: 'insulin', value, unit: 'µU/mL', date }, extra);

  it('nonfasting February glucose and October insulin: no HOMA, no 16:8 preference', () => {
    const d = docOf([g('2026-02-10', { fastingStatus: 'nonFasting' }), ins('2026-09-20', {})]);
    const ev = evaluateMarkers(d, ctxAt(TODAY));
    expect(homaFor(d.readings[1]!, d, ctxAt(TODAY))).toMatchObject({ status: 'unavailable', reasons: ['pairingUnknown'] });
    expect(ev.notes.map((n) => n.rule)).not.toContain('W-L-INS-1');
    expect(ev.preferLevers.map((p) => p.lever)).not.toContain('fast16_8');
    expect(ev.unresolved).toContainEqual({ rule: 'W-L-INS-1', field: 'HOMA-IR:pairingUnknown' });
  });

  it('an eligible same-draw pair gives the standard formula (126 mg/dL × 15 µU/mL ≈ 4.67), unit invariant, with both readings', () => {
    const d = docOf([g('2026-09-20', { sampleId: 'd1', fastingHours: 10 }), ins('2026-09-20', { sampleId: 'd1', fastingHours: 10 })]);
    const h = homaFor(d.readings[1]!, d, ctxAt(TODAY));
    expect(h.status).toBe('eligible');
    if (h.status !== 'eligible') return;
    expect(h.value).toBeCloseTo(((126 / MGDL_PER_MMOLL_GLC) * 15) / 22.5, 5);
    expect(Math.abs(h.value - (126 * 15) / 405)).toBeLessThan(0.01);
    expect(h.glucose.sampleId).toBe('d1');
    expect(h.insulin.sampleId).toBe('d1');
    const mmol = docOf([g('2026-09-20', { sampleId: 'd1', fastingHours: 10 }, 126 / MGDL_PER_MMOLL_GLC, 'mmol/L'), ins('2026-09-20', { sampleId: 'd1', fastingHours: 10 })]);
    const hm = homaFor(mmol.readings[1]!, mmol, ctxAt(TODAY));
    expect(hm.status === 'eligible' && hm.value).toBeCloseTo(h.value, 5);
    expect(fired(d, ctxAt(TODAY))).toContain('W-L-INS-1');
  });

  it('a confirmed same-report pairing works; a same date alone (or two separate draws that day) does not pair', () => {
    const confirmed = docOf([g('2026-09-20', { sampleId: 'g1', fastingHours: 10 }), ins('2026-09-20', { sampleId: 'i1', fastingHours: 10, confirmedPairWith: 'g1' })]);
    expect(homaFor(confirmed.readings[1]!, confirmed, ctxAt(TODAY)).status).toBe('eligible');
    const sameDate = docOf([g('2026-09-20', { fastingHours: 10 }), ins('2026-09-20', { fastingHours: 10 })]);
    expect(homaFor(sameDate.readings[1]!, sameDate, ctxAt(TODAY))).toMatchObject({ status: 'unavailable', reasons: ['pairingUnknown'] });
    const twoDraws = docOf([g('2026-09-20', { sampleId: 'am', fastingHours: 10 }), ins('2026-09-20', { sampleId: 'pm', fastingHours: 10 })]);
    expect(homaFor(twoDraws.readings[1]!, twoDraws, ctxAt(TODAY)).status).toBe('unavailable');
  });

  it('repeats pair each historical insulin with its own draw, never the newest glucose', () => {
    const d = docOf([
      g('2026-02-10', { sampleId: 'feb', fastingHours: 10 }, 90),
      ins('2026-02-10', { sampleId: 'feb', fastingHours: 10 }, 10),
      g('2026-09-20', { sampleId: 'sep', fastingHours: 10 }, 126),
      ins('2026-09-20', { sampleId: 'sep', fastingHours: 10 }, 15),
    ]);
    const old = homaFor(d.readings.find((r) => r.id === 'insulin' && r.date === '2026-02-10')!, d, ctxAt(TODAY));
    expect(old.status === 'eligible' && old.value).toBeCloseTo(((90 / MGDL_PER_MMOLL_GLC) * 10) / 22.5, 5);
    expect(old.status === 'eligible' && old.glucose.date).toBe('2026-02-10');
  });

  it('missing/false fasting, exogenous insulin or unknown insulin treatment: no HOMA; observed values stay intact', () => {
    const pair = (gx: Partial<MarkerReading>, ix: Partial<MarkerReading>) => docOf([g('2026-09-20', { sampleId: 'd1', ...gx }), ins('2026-09-20', { sampleId: 'd1', ...ix })]);
    expect(homaFor(pair({}, { fastingHours: 10 }).readings[1]!, pair({}, { fastingHours: 10 }), ctxAt(TODAY))).toMatchObject({ reasons: ['fastingUnknown'] });
    const nf = pair({ fastingStatus: 'nonFasting' }, { fastingHours: 10 });
    expect(homaFor(nf.readings[1]!, nf, ctxAt(TODAY))).toMatchObject({ reasons: ['notFasting'] });
    const ok = pair({ fastingHours: 10 }, { fastingHours: 10 });
    expect(homaFor(ok.readings[1]!, ok, ctxAt(TODAY, { flags: ['insulin'] }))).toMatchObject({ status: 'unavailable', reasons: ['exogenousInsulin'] });
    expect(homaFor(ok.readings[1]!, ok, ctxAt(TODAY, { flags: ['diabetes-undisclosed'] }))).toMatchObject({ status: 'unavailable', reasons: ['insulinTherapyUnknown'] });
    const started = { ...ok, medications: [{ id: 'm', medicationClass: 'insulin' as const, change: 'start' as const, date: '2026-01-01' }] };
    expect(homaFor(ok.readings[1]!, started, ctxAt(TODAY)).status).toBe('unavailable');
    const ev = evaluateMarkers(ok, ctxAt(TODAY, { flags: ['insulin'] }));
    expect(ev.notes.map((n) => n.rule)).not.toContain('W-L-INS-1');
    expect(ok.readings.map((r) => r.value)).toEqual([126, 15]);
  });
});

/* ------------------------------------------------------------------------------------------- D7-05 */

describe('D7-05 freshness, unresolved history, confirmed condition and resolution', () => {
  const egfr = (value: number, date: string) => rd({ id: 'egfr', value, unit: 'mL/min/1.73 m²', date });

  it('11 months 30 days: a current low eGFR applies its rules; at 12 months it is stale for forecasts but keeps a review', () => {
    const d = docOf([egfr(25, '2025-01-12')]);
    const before = evaluateMarkers(d, ctxAt('2026-01-11'));
    expect(before.safety.flags).toContain('kidney-disease');
    expect(before.safety.plannerLocks.map((l) => l.id)).toContain('creatine-cap');
    expect(labBaselinesWithDates(d, ctxAt('2026-01-11')).labs.egfr).toBe(25);
    // its own retest (13 weeks) is long due: Repeat due for quantitative use, Review for the finding
    expect(markerReviewStates(d, ctxAt('2026-01-11'), before)[0]).toMatchObject({ freshness: 'repeatDue', history: 'abnormal', label: 'Review' });

    const after = evaluateMarkers(d, ctxAt('2026-01-12'));
    // no automatic chronic-kidney-disease flag or permanent low-protein cap from an old value
    expect(after.safety.flags).not.toContain('kidney-disease');
    expect(after.safety.plannerLocks).toEqual([]);
    expect(after.reasks).toEqual([{ rule: 'W-L-REVIEW-EGFR', markerId: 'egfr', about: 'kidney' }]);
    const note = after.notes.find((n) => n.rule === 'W-L-REVIEW-EGFR')!;
    expect(note).toMatchObject({ kind: 'reask', severity: 'info', levers: [] });
    expect(note.text).toBe('Because your eGFR was 25 mL/min/1.73 m² on 12 Jan 2025: repeat the test or confirm it with your doctor before the plan uses it.');
    const base = labBaselinesWithDates(d, ctxAt('2026-01-12'));
    expect(base.labs.egfr).toBeUndefined();
    expect(base.labMeta.egfr).toMatchObject({ freshness: 'expired', measuredOn: '2025-01-12', original: { value: 25 } });
    expect(markerReviewStates(d, ctxAt('2026-01-12'), after)[0]).toMatchObject({ freshness: 'expired', history: 'unresolvedPriorAbnormality', label: 'Review' });
  });

  it('a newer normal repeat or a documented clearance resolves the review; a clinician-confirmed CKD stays', () => {
    const today = '2026-04-01';
    const repeat = docOf([egfr(25, '2025-01-12'), egfr(85, '2026-03-01')]);
    const ev = evaluateMarkers(repeat, ctxAt(today));
    expect(ev.reasks).toEqual([]);
    expect(markerReviewStates(repeat, ctxAt(today), ev)[0]).toMatchObject({ history: 'none', label: 'Current' });

    const cleared = resolveReview(docOf([egfr(25, '2025-01-12')]), 'egfr', '2026-02-01', 'clinician', ['egfr:2025-01-12']);
    expect(evaluateMarkers(cleared, ctxAt(today)).reasks).toEqual([]);

    const ckd = recordCondition(repeat, { id: 'c1', condition: 'ckd', confirmedOn: '2025-03-01', source: 'selfEnteredClinician' });
    const evCkd = evaluateMarkers(ckd, ctxAt(today));
    expect(evCkd.safety.flags).toContain('kidney-disease');
    expect(markerReviewStates(ckd, ctxAt(today), evCkd)[0]).toMatchObject({ history: 'clinicianConfirmed', label: 'Review', condition: { id: 'c1' } });
  });

  it('old electrolytes expire without a perpetual alert; a current one still asks for a clinician', () => {
    const k = (date: string) => docOf([rd({ id: 'potassium', value: 6.2, unit: 'mmol/L', date })]);
    const old = evaluateMarkers(k('2025-08-01'), ctxAt(TODAY));
    expect(old.notes).toEqual([]);
    expect(old.reasks).toEqual([]);
    expect(fired(k('2026-09-01'), ctxAt(TODAY))).toContain('W-L-K-4');
  });

  it('history-aware blocking: an old abnormality the person already answered about does not block again', () => {
    const d = docOf([rd({ id: 'fpg', value: 140, unit: 'mg/dL', date: '2025-01-12' }, { fastingHours: 10 })]);
    const ev = evaluateMarkers(d, ctxAt('2026-02-01'));
    expect(ev.reasks).toEqual([{ rule: 'W-L-REVIEW-FPG', markerId: 'fpg', about: 'diabetes' }]);
    expect(blockingReasks(ev, { diabetes: '2025-06-01' })).toEqual([]);
    expect(blockingReasks(ev, { diabetes: '2024-12-01' })).toHaveLength(1);
    expect(blockingReasks(ev, {})).toHaveLength(1);
  });

  it('a big carbohydrate change inside the omnivore category is a diet change; rules and the baseline builder use one date', () => {
    const plan = { status: 'active', startDate: '2026-08-01', dietPattern: 'omnivore', carbClass: 'vlc' as const };
    const earlier = [{ startDate: '2026-01-10', dietPattern: 'omnivore', carbClass: 'moderate' as const }];
    expect(dietChangeDateOf({ plan, earlierPlans: earlier }, TODAY)).toBe('2026-08-01');
    expect(dietChangeDateOf({ plan, earlierPlans: [{ ...earlier[0]!, carbClass: 'vlc' }] }, TODAY)).toBe('2026-01-10');
    // legacy plans without a carbohydrate class keep the animal-level comparison
    expect(dietChangeDateOf({ plan: { ...plan, carbClass: undefined }, earlierPlans: [{ startDate: '2026-01-10', dietPattern: 'omnivore' }] }, TODAY)).toBe('2026-01-10');
    // an explicit, later diet change the person entered wins; a future one is not in force
    expect(dietChangeDateOf({ plan: null, dietChangeDate: '2026-05-01' }, TODAY)).toBe('2026-05-01');
    expect(dietChangeDateOf({ plan: null, dietChangeDate: '2026-12-01' }, TODAY)).toBeUndefined();

    const ctx = markerRuleContext({ plan, earlierPlans: earlier }, TODAY);
    expect(ctx.dietChangeDate).toBe('2026-08-01');
    const d = docOf([rd({ id: 'ldl', value: 160, unit: 'mg/dL', date: '2026-05-01' }), rd({ id: 'tsh', value: 2, unit: 'µIU/mL', date: '2026-05-01' })]);
    const ev = evaluateMarkers(d, ctx);
    expect(ev.states.find((s) => s.markerId === 'ldl')?.stale).toBe(true);
    expect(ev.states.find((s) => s.markerId === 'tsh')?.stale).toBe(false);
    const base = labBaselinesWithDates(d, ctx);
    expect(base.labs.ldlMmolL).toBeUndefined();
    expect(base.labs.tshMiuL).toBe(2);
  });

  it('a dated medication change segments the markers it acts on (statin → lipids, not thyroid)', () => {
    const d = docOf([rd({ id: 'ldl', value: 160, unit: 'mg/dL', date: '2026-03-01' }), rd({ id: 'tsh', value: 2, unit: 'µIU/mL', date: '2026-03-01' })], {
      medications: [{ id: 'm1', medicationClass: 'statin', change: 'start', date: '2026-06-01' }],
    });
    const f = freshnessOf(d, ctxAt(TODAY));
    expect(isStaleIn(d.readings[0]!, f)).toBe(true);
    expect(isStaleIn(d.readings[1]!, f)).toBe(false);
    // a change after the reading but in the future is not yet in force
    expect(isStaleIn(d.readings[0]!, freshnessOf({ medications: [{ id: 'm', medicationClass: 'statin', change: 'start', date: '2026-12-01' }] }, ctxAt(TODAY)))).toBe(false);
  });

  it('dated medication changes reach the engine profile (merged by id, by date); none are invented without them', () => {
    const d = docOf([rd({ id: 'hba1c', value: 6.8, unit: '%', date: '2026-09-01' })], {
      medications: [
        { id: 'm2', medicationClass: 'metformin', change: 'start', date: '2026-07-01' },
        { id: 'm1', medicationClass: 'statin', change: 'start', date: '2026-06-01' },
      ],
    });
    const profile: Pick<PersonProfile, 'labs' | 'labMeta' | 'medications'> = { labs: {}, medications: [{ id: 'm1', medicationClass: 'statin', change: 'doseChange', date: '2026-05-01' }] };
    const out = withMarkerLabs(profile, d, ctxAt(TODAY));
    expect(out.medications?.map((m) => [m.id, m.change, m.date])).toEqual([
      ['m1', 'start', '2026-06-01'],
      ['m2', 'start', '2026-07-01'],
    ]);
    // a document with medications only still reaches the profile; one without leaves it untouched
    const medsOnly = withMarkerLabs<Pick<PersonProfile, 'labs' | 'medications'>>({ labs: {} }, docOf([], { medications: [{ id: 'i1', medicationClass: 'insulin', change: 'start', date: '2026-08-01' }] }), ctxAt(TODAY));
    expect(medsOnly.medications).toEqual([{ id: 'i1', medicationClass: 'insulin', change: 'start', date: '2026-08-01' }]);
    const none = { labs: {} };
    expect(withMarkerLabs(none, docOf([]), ctxAt(TODAY))).toBe(none);
  });

  it('a stale marker plus the same stale Body value does not resurrect the baseline; a newer current Body value stays', () => {
    const profile = { labs: { ldlMmolL: 4.1, hdlMmolL: 1.2 } } as Pick<PersonProfile, 'labs' | 'labMeta'>;
    const d = docOf([rd({ id: 'ldl', value: 158, unit: 'mg/dL', date: '2025-06-01' })]);
    const out = withMarkerLabs(profile, d, ctxAt(TODAY));
    expect(out.labs?.ldlMmolL).toBeUndefined();
    expect(out.labs?.hdlMmolL).toBe(1.2);
    expect(out.labMeta?.ldlMmolL).toMatchObject({ freshness: 'expired' });
    const newer = withMarkerLabs({ labs: { ldlMmolL: 3.9 }, labMeta: { ldlMmolL: { source: 'manual', measuredOn: '2026-09-01' } } }, d, ctxAt(TODAY));
    expect(newer.labs?.ldlMmolL).toBe(3.9);
  });

  it('a known non-fasting glucose is not a fasting baseline (provenance kept); unknown fasting passes with its status unknown', () => {
    const non = labBaselinesWithDates(docOf([rd({ id: 'fpg', value: 140, unit: 'mg/dL', date: '2026-09-20' }, { fastingStatus: 'nonFasting' })]), ctxAt(TODAY));
    expect(non.labs.fastingGlucoseMmolL).toBeUndefined();
    expect(non.labMeta.fastingGlucoseMmolL).toMatchObject({ fastingStatus: 'nonFasting', original: { value: 140, unit: 'mg/dL' } });
    const unk = labBaselinesWithDates(docOf([rd({ id: 'fpg', value: 95, unit: 'mg/dL', date: '2026-09-20' })]), ctxAt(TODAY));
    expect(unk.labs.fastingGlucoseMmolL).toBeCloseTo(95 / MGDL_PER_MMOLL_GLC, 5);
    expect(unk.labMeta.fastingGlucoseMmolL?.fastingStatus).toBeUndefined();
  });

  it('migration adds one conservative review record per unresolved prior abnormality, idempotently, with no diagnosis', () => {
    const d = docOf([egfr(25, '2025-01-12')]);
    const ev = evaluateMarkers(d, ctxAt('2026-03-01'));
    const once = withInitialReviewRecords(d, ev, '2026-03-01');
    expect(once.reviews).toEqual([{ id: 'review:egfr:2025-01-12', markerId: 'egfr', readingIds: ['egfr:2025-01-12'], state: 'unresolvedPriorAbnormality', since: '2026-03-01', authority: 'rule', ruleId: 'W-L-REVIEW-EGFR' }]);
    expect(withInitialReviewRecords(once, ev, '2026-03-02')).toBe(once);
    expect(once.conditions).toBeUndefined();
    expect(once.readings).toEqual(d.readings);
  });

  it('renal context for the planner: an expired kidney finding is a prior-abnormality review, a confirmed CKD is context to complete', () => {
    const d = docOf([egfr(25, '2025-01-12')]);
    expect(renalContextFromMarkers(d, evaluateMarkers(d, ctxAt('2026-03-01')), '2026-03-01')).toBe('priorAbnormalityReview');
    const ckd = recordCondition(d, { id: 'c1', condition: 'ckd', confirmedOn: '2025-02-01', source: 'document' });
    expect(renalContextFromMarkers(ckd, evaluateMarkers(ckd, ctxAt('2026-03-01')), '2026-03-01')).toBe('contextIncomplete');
    const resolved = resolveCondition(ckd, 'c1', '2026-01-01');
    expect(resolved.conditions?.[0]?.resolvedOn).toBe('2026-01-01');
    expect(renalContextFromMarkers(docOf([egfr(85, '2026-02-01')]), evaluateMarkers(docOf([egfr(85, '2026-02-01')]), ctxAt('2026-03-01')), '2026-03-01')).toBeUndefined();
  });

  it('a clinician-confirmed liver condition is not cleared by a later normal ALT (no simulated or measured value clears it)', () => {
    const d = recordCondition(docOf([rd({ id: 'alt', value: 22, unit: 'U/L', date: '2026-09-20' })]), { id: 'l1', condition: 'liver', confirmedOn: '2025-05-01', source: 'selfEnteredClinician' });
    const ev = evaluateMarkers(d, ctxAt(TODAY));
    expect(markerReviewStates(d, ctxAt(TODAY), ev)[0]).toMatchObject({ markerId: 'alt', history: 'clinicianConfirmed', label: 'Review' });
  });
});
