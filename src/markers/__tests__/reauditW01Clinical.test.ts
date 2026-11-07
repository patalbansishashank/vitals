/**
 * Re-audit of waves 0–1 (2026-10-19), package F09-clinical — clinical predicates, marker transport and comparable history:
 *   A1-002  current clinical safety composed headlessly (no goals, no mounted Planner, no prepared request)
 *   A1-009  optional clinical sample facts survive markers.set / markers.confirm into the saved document
 *   A1-010  unresolved abnormal episodes over the full confirmed history; only a comparable measurement resolves one
 *   A1-033  a confirmed soy allergy is never suggested the generic soy-or-pea plant protein; allergen-safe food-first copy
 *   A1-034  HOMA same-draw pairing refuses contradictory dates/instants (rules and engine agree)
 *   A1-046  a heart-rhythm medicine is its own predicate, never atrial-fibrillation or arrhythmia history
 *   A1-047  HOMA routine-basal context: known illness / prolonged fast keep only a contextual ratio
 *   A1-063  as-of insulin chronology for HOMA (future starts and old stopped courses are not current exposure)
 */
import { describe, expect, it } from 'vitest';
import { bodyOf } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import { dispatch, settleCommits, type CommandResult } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { clearPendingExtractions, setMarkerExtractor } from '@/commands/markers';
import { resolveProfile } from '@/engine/core/resolveProfile';
import { homaPairEligible, homaPairEligibility } from '@/engine/model/cardiometabolic/constants';
import { contextForSchedule, evaluatePlanSafety } from '@/engine/planner/domain/safetyAudit';
import type { PlannerRequest, PlannerSafetyInput } from '@/engine/planner/domain/types';
import type { PersonProfile } from '@/engine/types/profile';
import type { Schedule } from '@/engine/types/schedule';
import { MAN_95 } from '@/engine/planner/domain/__tests__/personas';
import { suggestionSafetyFrom, type ScreeningAnswers } from '@/features/onboarding/safetyRules';
import { SOY_FREE_PLANT_PROTEIN_ID, allergenSafeFoodFirst, foodFirstLines, supplementCards, takingCaution, type FoodSafetyContext } from '@/features/living/food/supplements';
import { SEED_SUPPLEMENTS } from '@/content/catalogues';
import { reasonWords, resolvePredicate, suggestionDecision, PREDICATES } from '@/lib/safetyPolicy';
import { withMarkerLabs } from '../baselines';
import { readingFromInput } from '../doc';
import { markerReviewStates, renalContextFromMarkers, recordCondition, withInitialReviewRecords } from '../review';
import { blockingReasks, evaluateMarkers, homaFor, insulinTherapyAt } from '../rules';
import type { MarkerExtraction, MarkerReading, MarkerReadingInput, MarkersDoc, RuleContext } from '../types';
import { indexedEgfrOf } from '../units';
import { withCurrentSafety } from '../ui/request';

const rd = (i: MarkerReadingInput, extra: Partial<MarkerReading> = {}): MarkerReading => readingFromInput(i, 'manual', `${i.date}T09:00:00Z`, extra);
const docOf = (readings: MarkerReading[], extra: Partial<MarkersDoc> = {}): MarkersDoc => ({ _schema: 1, readings, displayOnly: [], context: {}, chapter: 'manual', ...extra });
const ctxAt = (today: string, extra: Partial<RuleContext> = {}): RuleContext => ({ sex: 'male', today, ageYears: 45, defaultDeficitCapPct: 25, flags: [], referencePhysiology: 'adultMale', ...extra });
const fired = (d: MarkersDoc, c: RuleContext): string[] => evaluateMarkers(d, c).notes.map((n) => n.rule);

/* ------------------------------------------------------------------------------------------- A1-002 */

describe('A1-002 current clinical safety is composed headlessly (no goals, no Planner view, no prepared request)', () => {
  const TODAY = '2026-10-04';
  /** The current screening input of a healthy adult (as `toSafetyInput` builds it): no screening locks. */
  const SCREENING: PlannerSafetyInput = {
    plannerAccess: 'full',
    mode: 'M0',
    restrictions: [],
    plannerLocks: [],
    fasting: { maxFastHours: 16, maxEligibleTier: 'T1', effectiveTier: 'T1', optInTiers: [], shortWindowAvailable: true },
    flags: [],
  };
  /** A custom scenario's request: no Planner goals (the production no-goal state), stored without any safety input. */
  const scenarioRequest = (extra: Partial<PlannerRequest> = {}): PlannerRequest => ({ profile: MAN_95, goals: [], horizonDays: 28, startDate: '2026-10-05', ...extra });
  /** 28 days at 2500 kcal, protein 150 g, carbohydrate 180 g, fat the remainder (≈ 47 % of energy). */
  const HIGH_FAT: Schedule = {
    schemaVersion: 1,
    startDate: '2026-10-05',
    horizonDays: 28,
    programs: [{ id: 'p', label: 'p', energy: { kind: 'kcal', kcal: 2500 }, macros: { protein: { unit: 'g', value: 150 }, carbs: { unit: 'g', value: 180 }, fat: { unit: 'remainder' } }, meals: { count: 3, window: { startH: 8, lengthH: 12 } }, exercise: [] }],
    days: Array.from({ length: 28 }, () => ({ program: 0 })),
  };
  const tg = (mgdl: number) => docOf([rd({ id: 'tg', value: mgdl, unit: 'mg/dL', date: '2026-10-01' })]);
  const fatCap = (safety: PlannerSafetyInput | undefined) => safety?.plannerLocks?.find((l) => l.id === 'fat-cap');

  it('a fresh TG of 1000 mg/dL brings its existing 30 %E fat cap to a goal-less scenario, which the final validator then rejects', () => {
    const doc = tg(1000);
    const markers = evaluateMarkers(doc, ctxAt(TODAY));
    const out = withCurrentSafety(scenarioRequest(), { screening: SCREENING, markers, markersDoc: doc, today: TODAY });
    expect(out.status).toBe('current');
    if (out.status !== 'current') return;
    expect(fatCap(out.request.safety)).toMatchObject({ value: 30, unit: '%E', source: 'marker', mandatory: true });
    const e = evaluatePlanSafety(contextForSchedule(out.request, HIGH_FAT), HIGH_FAT);
    expect(e.evaluations.find((v) => v.constraintId === 'fat-cap')?.status).toBe('violation');
    expect(e.status).toBe('violation');
    // the same scenario checked against the screening-only input (the old path) carries no fat cap at all
    const old = evaluatePlanSafety(contextForSchedule({ ...scenarioRequest(), safety: SCREENING }, HIGH_FAT), HIGH_FAT);
    expect(old.evaluations.some((v) => v.constraintId === 'fat-cap')).toBe(false);
  });

  it('a stale stored or prepared request never stands in for the current markers; a marker lock gone from the current evaluation is dropped', () => {
    // stored: an older run's request whose safety lacked the lock (a stale prepare() / no published request)
    const stale = scenarioRequest({ safety: { ...SCREENING, plannerLocks: [] }, markerWarnings: [{ rule: 'W-L-OLD' }], preferLevers: [{ lever: 'fast16_8', weight: 0.01, rule: 'W-L-INS-1' }] });
    const now = withCurrentSafety(stale, { screening: SCREENING, markers: evaluateMarkers(tg(1000), ctxAt(TODAY)), stored: stale.safety, today: TODAY });
    expect(now.status === 'current' && fatCap(now.request.safety)?.value).toBe(30);
    // the stored request's old marker notes and prefer biases are replaced by the current evaluation's
    expect(now.status === 'current' && (now.request.markerWarnings as Array<{ rule: string }>).map((n) => n.rule)).not.toContain('W-L-OLD');
    expect(now.status === 'current' && (now.request.preferLevers ?? []).map((p) => p.rule)).not.toContain('W-L-INS-1');
    // a new benign TG (after the old high one): the stored marker lock does not survive; use stays available
    const storedWithMarker: PlannerSafetyInput = { ...SCREENING, plannerLocks: [{ id: 'fat-cap', value: 30, unit: '%E', source: 'marker', mandatory: true }] };
    const benign = withCurrentSafety(scenarioRequest({ safety: storedWithMarker }), { screening: SCREENING, markers: evaluateMarkers(tg(90), ctxAt(TODAY)), stored: storedWithMarker, today: TODAY });
    expect(benign.status === 'current' && fatCap(benign.request.safety)).toBeUndefined();
    if (benign.status !== 'current') return;
    expect(evaluatePlanSafety(contextForSchedule(benign.request, HIGH_FAT), HIGH_FAT).evaluations.some((v) => v.constraintId === 'fat-cap')).toBe(false);
  });

  it('explicit clinician bounds carry over (same-source supersession and revocation resolved) and intersect by typed unit', () => {
    const stored: PlannerSafetyInput = {
      ...SCREENING,
      plannerLocks: [
        { id: 'fat-cap', value: 25, unit: '%E', source: 'clinician', mandatory: true },
        { id: 'protein-cap', value: 1.2, unit: 'g/kg/d', source: 'clinician', mandatory: true },
        { id: 'caffeine-cap', value: 300, unit: 'mg/d', source: 'user' },
      ],
    };
    const out = withCurrentSafety(scenarioRequest({ safety: stored }), {
      screening: SCREENING,
      markers: evaluateMarkers(tg(1000), ctxAt(TODAY)),
      stored,
      // the clinician replaced their protein cap; the person withdrew their own caffeine limit
      bounds: [{ id: 'protein-cap', value: 1.0, unit: 'g/kg/d', source: 'clinician', mandatory: true }],
      revoked: [{ id: 'caffeine-cap', source: 'user' }],
      today: TODAY,
    });
    expect(out.status).toBe('current');
    if (out.status !== 'current') return;
    const locks = out.request.safety?.plannerLocks ?? [];
    // clinician fat cap 25 %E and the marker's 30 %E intersect in one typed unit: the stricter 25 holds, mandatory
    expect(locks.filter((l) => l.id === 'fat-cap')).toEqual([expect.objectContaining({ value: 25, unit: '%E', mandatory: true })]);
    expect(locks.filter((l) => l.id === 'protein-cap').map((l) => l.value)).toEqual([1.0]);
    expect(locks.some((l) => l.id === 'caffeine-cap')).toBe(false);
  });

  it('missing current screening or markers is Unchecked (required coverage missing), never the older clinical input', () => {
    const stored = { ...SCREENING, plannerLocks: [{ id: 'fat-cap', value: 30, unit: '%E', source: 'marker' as const }] };
    expect(withCurrentSafety(scenarioRequest({ safety: stored }), { screening: SCREENING, markers: null, stored, today: TODAY })).toEqual({ status: 'unchecked', missing: ['markers'] });
    expect(withCurrentSafety(scenarioRequest(), { screening: null, markers: null, today: TODAY })).toEqual({ status: 'unchecked', missing: ['screening', 'markers'] });
  });

  it('an unresolved prior kidney abnormality is a blocking re-ask with a neutral review, no lock or flag', () => {
    const doc = docOf([rd({ id: 'egfr', value: 40, unit: 'mL/min/1.73 m²', date: '2024-01-01' })]);
    const out = withCurrentSafety(scenarioRequest(), { screening: SCREENING, markers: evaluateMarkers(doc, ctxAt(TODAY)), markersDoc: doc, today: TODAY });
    expect(out.status).toBe('current');
    if (out.status !== 'current') return;
    expect(out.blockingReasks).toEqual([{ rule: 'W-L-REVIEW-EGFR', markerId: 'egfr', about: 'kidney' }]);
    expect(out.request.safety?.plannerLocks ?? []).toEqual([]);
    expect(out.request.safety?.flags ?? []).not.toContain('kidney-disease');
    // answering the kidney question after the reading clears the pause; the review note stays
    const answered = withCurrentSafety(scenarioRequest(), { screening: SCREENING, markers: evaluateMarkers(doc, ctxAt(TODAY)), today: TODAY, answeredOn: { kidney: '2024-06-01' } });
    expect(answered.status === 'current' && answered.blockingReasks).toEqual([]);
  });
});

/* ------------------------------------------------------------------------------------------- A1-009 */

describe('A1-009 optional clinical sample facts through the real producers', () => {
  const out = <T,>(r: CommandResult): T => {
    if (!r.ok || !('output' in r)) throw new Error(JSON.stringify(r));
    return r.output as T;
  };
  const stored = (): MarkersDoc => bodyOf(getDocumentStore().peek<MarkersDoc>('markers', 'me')!) as unknown as MarkersDoc;
  const T_CTX = ctxAt('2026-10-04');
  const testosteroneRules = (d: MarkersDoc) => fired(d, T_CTX).filter((r) => r.startsWith('W-L-TESTOSTERONE'));

  beforeEach(() => {
    freshState({ cleared: true });
    clearPendingExtractions();
  });

  it('markers.set keeps hormone therapy, local clock, instant and fasting hours; an on-therapy draw fires no male-reference rule', async () => {
    out(
      await dispatch('markers.set', {
        readings: [{ id: 'testosterone', value: 200, unit: 'ng/dL', date: '2026-09-12', hormoneTherapy: 'yes', sampleLocalClockH: 8, sampledAt: '2026-09-12T08:00+05:30', fastingHours: 10 }],
      }),
    );
    await settleCommits();
    const r = stored().readings.find((x) => x.id === 'testosterone')!;
    expect(r).toMatchObject({ value: 200, unit: 'ng/dL', date: '2026-09-12', hormoneTherapy: 'yes', sampleLocalClockH: 8, sampledAt: '2026-09-12T08:00+05:30', fastingHours: 10 });
    expect(testosteroneRules(stored())).toEqual([]);
    expect(evaluateMarkers(stored(), T_CTX).applicability).toContainEqual(expect.objectContaining({ rule: 'W-L-TESTOSTERONE-1', status: 'unresolved', reason: 'hormoneTherapy' }));
    // control: the same value without the therapy fact applies the male-reference rules
    freshState({ cleared: true });
    out(await dispatch('markers.set', { readings: [{ id: 'testosterone', value: 200, unit: 'ng/dL', date: '2026-09-12' }] }));
    await settleCommits();
    expect(testosteroneRules(stored())).toEqual(expect.arrayContaining(['W-L-TESTOSTERONE-1', 'W-L-TESTOSTERONE-5']));
    expect(stored().readings[0]).not.toHaveProperty('hormoneTherapy');
  });

  it('a sample claim rests on both saved draws: two morning fasting draws claim it, one without a clock hour does not', async () => {
    const draw = (date: string, clock?: number) => ({ id: 'testosterone', value: 220, unit: 'ng/dL', date, fastingHours: 10, ...(clock !== undefined ? { sampleLocalClockH: clock } : {}) });
    out(await dispatch('markers.set', { readings: [draw('2026-08-20', 8), draw('2026-09-12', 7.5)] }));
    await settleCommits();
    const both = evaluateMarkers(stored(), T_CTX).notes.find((n) => n.rule === 'W-L-TESTOSTERONE-2');
    expect(both?.text).toContain('two morning fasting tests');
    freshState({ cleared: true });
    out(await dispatch('markers.set', { readings: [draw('2026-08-20', 8), draw('2026-09-12')] }));
    await settleCommits();
    const ev = evaluateMarkers(stored(), T_CTX);
    expect(ev.notes.find((n) => n.rule === 'W-L-TESTOSTERONE-2')?.text).not.toContain('morning');
    expect(ev.applicability).toContainEqual({ rule: 'W-L-TESTOSTERONE-2', status: 'unresolved', reason: 'sampleTimingUnknown' });
  });

  it('a confirmed GFR quantity kind is kept beside the printed unit; without it the value stays unresolved', async () => {
    out(await dispatch('markers.set', { readings: [{ id: 'egfr', value: 70, unit: 'mL/min', date: '2026-09-12', quantityKind: 'egfrIndexed' }] }));
    await settleCommits();
    const r = stored().readings[0]!;
    expect(r).toMatchObject({ value: 70, unit: 'mL/min', quantityKind: 'egfrIndexed' });
    expect(indexedEgfrOf(r)).toEqual({ status: 'resolved', value: 70, source: 'confirmedIndexed' });
    freshState({ cleared: true });
    out(await dispatch('markers.set', { readings: [{ id: 'egfr', value: 70, unit: 'mL/min', date: '2026-09-12' }] }));
    await settleCommits();
    expect(stored().readings[0]).not.toHaveProperty('quantityKind');
    expect(indexedEgfrOf(stored().readings[0]!)).toEqual({ status: 'unresolved', reason: 'indexingUnconfirmed' });
  });

  it('an absolute GFR enters as indexed only with its explicit sample-date Mosteller conversion; a bare label converts nothing', async () => {
    const bsa = Math.sqrt((180 * 95) / 3600);
    const indexed = { valueMlMin173: (90 * 1.73) / bsa, bsaM2: bsa, bsaMethod: 'mosteller' as const, heightCm: 180, weightKg: 95, anthropometryDate: '2026-09-12' };
    out(await dispatch('markers.set', { readings: [{ id: 'egfr', value: 90, unit: 'mL/min', date: '2026-09-12', quantityKind: 'gfrAbsolute', indexed }] }));
    await settleCommits();
    expect(stored().readings[0]).toMatchObject({ value: 90, unit: 'mL/min', quantityKind: 'gfrAbsolute', indexed });
    expect(indexedEgfrOf(stored().readings[0]!)).toMatchObject({ status: 'resolved', source: 'bsaConverted' });
    // anthropometry from another date is refused, never re-dated or converted silently
    const bad = await dispatch('markers.set', { readings: [{ id: 'egfr', value: 90, unit: 'mL/min', date: '2026-09-12', quantityKind: 'gfrAbsolute', indexed: { ...indexed, anthropometryDate: '2026-01-01' } }] });
    expect(bad.ok ? null : bad.error).toMatchObject({ code: 'invalid_input', detail: { path: '/readings/0/indexed' } });
    // a quantity label alone: kept, not converted
    freshState({ cleared: true });
    out(await dispatch('markers.set', { readings: [{ id: 'egfr', value: 90, unit: 'mL/min', date: '2026-09-12', quantityKind: 'gfrAbsolute' }] }));
    await settleCommits();
    expect(stored().readings[0]).not.toHaveProperty('indexed');
    expect(indexedEgfrOf(stored().readings[0]!)).toEqual({ status: 'unresolved', reason: 'absoluteNeedsBsa' });
  });

  it('invalid facts are refused with their path; a GFR quantity kind on another marker is refused', async () => {
    const clock = await dispatch('markers.set', { readings: [{ id: 'ldl', value: 120, unit: 'mg/dL', date: '2026-09-12', sampleLocalClockH: 24 }] });
    expect(clock.ok).toBe(false);
    const kind = await dispatch('markers.set', { readings: [{ id: 'ldl', value: 120, unit: 'mg/dL', date: '2026-09-12', quantityKind: 'egfrIndexed' }] });
    expect(kind.ok ? null : kind.error).toMatchObject({ code: 'invalid_input', detail: { path: '/readings/0/quantityKind' } });
  });

  it('report confirmation preserves the same supplied facts as typed entry; absent facts stay absent', async () => {
    const EXTRACTION: MarkerExtraction & { pages: number } = {
      pages: 1,
      extractionId: '01JEXTRACTIONA1009000000001',
      route: 'textLayer',
      sampleDate: '2026-09-12',
      rows: [
        { row: 0, markerId: 'fpg', nameOnReport: 'Glucose, fasting', value: 99, unit: 'mg/dL', calculated: false, confidence: 0.97, issues: [] },
        { row: 1, markerId: 'insulin', nameOnReport: 'Insulin', value: 9, unit: 'µU/mL', calculated: false, confidence: 0.95, issues: [] },
      ],
      displayOnly: [],
      notInReport: [],
    };
    setMarkerExtractor(async () => structuredClone(EXTRACTION));
    const { createMemoryBlobStore, getBlobStore, setBlobStore } = await import('@/state/blobStore');
    setBlobStore(createMemoryBlobStore());
    await (await getBlobStore()).put(new TextEncoder().encode('%PDF-1.4 fake report'), { purpose: 'photo', aadId: 'report-a1009' });
    const { jobs } = await import('@/commands');
    const imp = await dispatch('markers.import', { attachmentId: 'report-a1009' });
    if (!imp.ok || !('job' in imp)) throw new Error(JSON.stringify(imp));
    await jobs.wait(imp.job.jobId);
    const facts = { sampleId: 'acc-1', sampledAt: '2026-09-12T07:40+05:30', fastingHours: 12, sampleContext: { illness: false, prolongedFastProtocol: false } };
    out(await dispatch('markers.confirm', { extractionId: EXTRACTION.extractionId, accept: [{ row: 0, date: '2026-09-12', ...facts }, { row: 1, date: '2026-09-12', ...facts }] }));
    await settleCommits();
    const readings = stored().readings;
    for (const r of readings) expect(r).toMatchObject({ provenance: 'pdf', ...facts });
    for (const r of readings) for (const k of ['hormoneTherapy', 'quantityKind', 'sampleLocalClockH', 'lab', 'assay']) expect(r).not.toHaveProperty(k);
    // the confirmed pair is one routine same draw: HOMA is available from the saved document
    const ins = readings.find((r) => r.id === 'insulin')!;
    expect(homaFor(ins, stored(), ctxAt('2026-10-04')).status).toBe('eligible');
    setMarkerExtractor(null);
  });
});

/* ------------------------------------------------------------------------------------------- A1-010 */

describe('A1-010 unresolved abnormal episodes over the full confirmed history', () => {
  const TODAY = '2026-10-18';
  const egfr = (value: number, date: string, unit = 'mL/min/1.73 m²', extra: Partial<MarkerReading> = {}) => rd({ id: 'egfr', value, unit, date }, extra);

  it('an expired indexed eGFR 40 followed by an unknown-index eGFR 100 keeps the review, the kidney re-ask and the source identity', () => {
    const d = docOf([egfr(40, '2024-01-01'), egfr(100, '2026-10-01', 'mL/min')]);
    const ev = evaluateMarkers(d, ctxAt(TODAY));
    expect(ev.reasks).toContainEqual({ rule: 'W-L-REVIEW-EGFR', markerId: 'egfr', about: 'kidney' });
    expect(blockingReasks(ev)).toContainEqual({ rule: 'W-L-REVIEW-EGFR', markerId: 'egfr', about: 'kidney' });
    const note = ev.notes.find((n) => n.rule === 'W-L-REVIEW-EGFR')!;
    expect(note.because).toMatchObject({ value: 40, unit: 'mL/min/1.73 m²', date: '2024-01-01' });
    // the newest result stays visible exactly as entered, with Review and the prior source carried separately
    const view = markerReviewStates(d, ctxAt(TODAY), ev).find((v) => v.markerId === 'egfr')!;
    expect(view).toMatchObject({ history: 'unresolvedPriorAbnormality', label: 'Review', freshness: 'current', readingIds: ['egfr:2024-01-01'] });
    expect(view.reading).toMatchObject({ value: 100, unit: 'mL/min', date: '2026-10-01' });
    expect(view.source).toMatchObject({ value: 40, date: '2024-01-01' });
    expect(renalContextFromMarkers(d, ev, TODAY)).toBe('priorAbnormalityReview');
    // a neutral review: no CKD flag, no protein bound, no stage
    expect(ev.safety.flags).not.toContain('kidney-disease');
    expect(ev.safety.plannerLocks).toEqual([]);
    // the persisted review record names the episode reading, not the newest one
    expect(withInitialReviewRecords(d, ev, TODAY).reviews).toEqual([expect.objectContaining({ id: 'review:egfr:2024-01-01', readingIds: ['egfr:2024-01-01'], state: 'unresolvedPriorAbnormality' })]);
  });

  it('creatinine clearance or an unconverted absolute GFR cannot resolve it; an explicit conversion or a confirmed indexed normal can', () => {
    const old = egfr(40, '2024-01-01');
    expect(fired(docOf([old, egfr(100, '2026-10-01', 'mL/min', { quantityKind: 'creatinineClearance' })]), ctxAt(TODAY))).toContain('W-L-REVIEW-EGFR');
    expect(fired(docOf([old, egfr(100, '2026-10-01', 'mL/min', { quantityKind: 'gfrAbsolute' })]), ctxAt(TODAY))).toContain('W-L-REVIEW-EGFR');
    const bsa = Math.sqrt((180 * 95) / 3600);
    const converted = egfr(100, '2026-10-01', 'mL/min', { quantityKind: 'gfrAbsolute', indexed: { valueMlMin173: (100 * 1.73) / bsa, bsaM2: bsa, bsaMethod: 'mosteller', heightCm: 180, weightKg: 95, anthropometryDate: '2026-10-01' } });
    expect(fired(docOf([old, converted]), ctxAt(TODAY))).not.toContain('W-L-REVIEW-EGFR');
    const indexedNormal = docOf([old, egfr(100, '2026-10-01')]);
    const ev = evaluateMarkers(indexedNormal, ctxAt(TODAY));
    expect(ev.reasks).toEqual([]);
    expect(markerReviewStates(indexedNormal, ctxAt(TODAY), ev)[0]).toMatchObject({ history: 'none', label: 'Current' });
    expect(fired(docOf([old, egfr(100, '2026-10-01', 'mL/min', { quantityKind: 'egfrIndexed' })]), ctxAt(TODAY))).not.toContain('W-L-REVIEW-EGFR');
  });

  it('a fresh abnormal reading superseded by an ambiguous one keeps only a neutral review (no lock or flag from the older reading)', () => {
    const d = docOf([egfr(40, '2026-09-01'), egfr(100, '2026-10-01', 'mL/min')]);
    const ev = evaluateMarkers(d, ctxAt(TODAY));
    expect(ev.reasks).toEqual([{ rule: 'W-L-REVIEW-EGFR', markerId: 'egfr', about: 'kidney' }]);
    expect(ev.safety.flags).not.toContain('kidney-disease');
    // a current abnormal comparable reading carries the finding itself (its own rules), with no duplicate review
    const cur = evaluateMarkers(docOf([egfr(40, '2024-01-01'), egfr(45, '2026-10-01')]), ctxAt(TODAY));
    expect(cur.notes.map((n) => n.rule)).toContain('W-L-EGFR-1');
    expect(cur.notes.map((n) => n.rule)).not.toContain('W-L-REVIEW-EGFR');
  });

  it('a non-fasting or unknown-fasting glucose cannot clear an old fasting diabetic-range episode; a known fasting normal can', () => {
    const old = rd({ id: 'fpg', value: 200, unit: 'mg/dL', date: '2025-06-01' }, { fastingHours: 10 });
    const later = (extra: Partial<MarkerReading>) => docOf([old, rd({ id: 'fpg', value: 92, unit: 'mg/dL', date: '2026-10-01' }, extra)]);
    for (const extra of [{ fastingStatus: 'nonFasting' as const }, {}, { fastingHours: 3 }]) {
      const ev = evaluateMarkers(later(extra), ctxAt(TODAY));
      expect(ev.reasks).toContainEqual({ rule: 'W-L-REVIEW-FPG', markerId: 'fpg', about: 'diabetes' });
      expect(ev.notes.find((n) => n.rule === 'W-L-REVIEW-FPG')?.because).toMatchObject({ value: 200, date: '2025-06-01' });
    }
    expect(fired(later({ fastingHours: 12 }), ctxAt(TODAY))).not.toContain('W-L-REVIEW-FPG');
  });

  it('a clinician-confirmed CKD stays distinct from episode resolution; no automatic diagnosis or protein bound', () => {
    const d = recordCondition(docOf([egfr(40, '2024-01-01'), egfr(95, '2026-10-01')]), { id: 'c1', condition: 'ckd', confirmedOn: '2024-03-01', source: 'selfEnteredClinician' });
    const ev = evaluateMarkers(d, ctxAt(TODAY));
    expect(ev.reasks).toEqual([]);
    expect(ev.safety.flags).toContain('kidney-disease');
    expect(ev.safety.plannerLocks.some((l) => l.id === 'protein-cap')).toBe(false);
    expect(markerReviewStates(d, ctxAt(TODAY), ev)[0]).toMatchObject({ history: 'clinicianConfirmed', label: 'Review' });
    // without the condition the same history resolves (a documented comparable normal repeat), with no diagnosis added
    const plain = docOf([egfr(40, '2024-01-01'), egfr(95, '2026-10-01')]);
    expect(evaluateMarkers(plain, ctxAt(TODAY)).safety.flags).toEqual([]);
  });
});

/* ------------------------------------------------------------------------------------------- A1-033 */

describe('A1-033 soy allergy and the plant protein suggestion', () => {
  const plant = SEED_SUPPLEMENTS.find((s) => s.id === 'plant_protein')!;
  const safety = (soy: 'yes' | 'no' | 'unknown', milk: 'yes' | 'no' = 'no'): FoodSafetyContext => ({ screening: {}, allergies: { milk, soy } });

  it('command policy: a confirmed soy allergy is Not suggested for the generic product; no stays allowed; unknown stays Unchecked', () => {
    expect(suggestionDecision(plant, safety('yes'))).toMatchObject({ state: 'noSuggest', reasons: [expect.objectContaining({ rule: 'predicate:soy-allergy', applicability: 'applicable' })] });
    expect(suggestionDecision(plant, safety('no')).state).toBe('allow');
    expect(suggestionDecision(plant, { screening: {} }).state).toBe('unchecked');
    expect(reasonWords(suggestionDecision(plant, { screening: {} }))).toEqual(['soy allergy (not answered)']);
  });

  it('Food cards: no generic plant protein and no soy food-first example with a soy allergy; the soy-free pea:rice formulation may be suggested', () => {
    const r = supplementCards({ prescribed: [], dietKind: 'vegan', safety: safety('yes'), goals: ['strength'] });
    const ids = r.cards.map((c) => c.record.id);
    expect(ids).not.toContain('plant_protein');
    expect(r.held).toContainEqual(expect.objectContaining({ name: 'plant protein powder', state: 'noSuggest', reason: 'soy allergy' }));
    const free = r.cards.find((c) => c.record.id === SOY_FREE_PLANT_PROTEIN_ID)!;
    expect(free).toMatchObject({ name: 'pea and rice protein powder', status: 'allow' });
    expect(free.record.form).toMatch(/pea:rice/);
    expect(free.record.contraindications.some((c) => c.flag === 'soy-allergy')).toBe(false);
    expect(free.record.diet.allergens.some((a) => /soy/i.test(a))).toBe(false);
    expect(free.caution).toContain('labelled soy-free');
    for (const c of r.cards) expect(c.foodFirst ?? '').not.toMatch(/soy|tofu|tempeh/i);
    expect(free.foodFirst).toBe('Dal with grains.');
    // a refusal of the soy-free product still applies to it (other screens decide as for any product)
    const refused = supplementCards({ prescribed: [], dietKind: 'vegan', safety: { ...safety('yes'), refused: [SOY_FREE_PLANT_PROTEIN_ID] }, goals: ['strength'] });
    expect(refused.cards.map((c) => c.record.id)).not.toContain(SOY_FREE_PLANT_PROTEIN_ID);
  });

  it('other cards drop soy examples too (whey "dal with soy chunks"), and a milk allergy drops dairy examples', () => {
    const whey = supplementCards({ prescribed: [], dietKind: 'eggetarian', safety: { ...safety('yes'), screening: { 'kidney-disease': 'no' } }, goals: ['strength'] }).cards.find((c) => c.record.id === 'whey_protein')!;
    expect(whey.foodFirst).toBe('Curd, paneer, or eggs.');
    expect(allergenSafeFoodFirst('Curd, paneer, eggs, or dal with soy chunks.', { milk: true, soy: true })).toBe('Eggs.');
    expect(allergenSafeFoodFirst('Soy chunks, tofu.', { milk: false, soy: true })).toBeNull();
    expect(allergenSafeFoodFirst('Oats, dal, chana.', { milk: true, soy: true })).toBe('Oats, dal, chana.');
    // the generic food-first lines follow the same known facts (a milk allergy drops the curd/paneer line)
    expect(foodFirstLines('vegetarian', { milk: true, soy: false }).suggestions.some((t) => /curd|paneer/.test(t))).toBe(false);
    expect(foodFirstLines('vegetarian').suggestions.some((t) => /curd|paneer/.test(t))).toBe(true);
  });

  it('no soy allergy keeps the ordinary card and its examples; unknown keeps today\'s Unchecked; a logged row keeps its exposure with Review', () => {
    const no = supplementCards({ prescribed: [], dietKind: 'vegan', safety: safety('no'), goals: ['strength'] });
    const generic = no.cards.find((c) => c.record.id === 'plant_protein')!;
    expect(generic.status).toBe('allow');
    expect(generic.foodFirst).toBe('Soy chunks, tofu, dal with grains.');
    expect(no.cards.map((c) => c.record.id)).not.toContain(SOY_FREE_PLANT_PROTEIN_ID);
    const unk = supplementCards({ prescribed: [], dietKind: 'vegan', safety: { screening: {} }, goals: ['strength'] });
    expect(unk.held).toContainEqual(expect.objectContaining({ name: 'plant protein powder', state: 'unchecked' }));
    expect(unk.cards.map((c) => c.record.id)).not.toContain(SOY_FREE_PLANT_PROTEIN_ID);
    // the person's own logged product: recordable, its status shown, never a stop instruction
    expect(takingCaution('plant_protein', safety('yes'))).toBe('Review · soy allergy');
    expect(resolvePredicate(PREDICATES['soy-allergy'], safety('yes')).answer).toBe('yes');
  });
});

/* ------------------------------------------------------------------------------------------- A1-034 / A1-047 / A1-063 */

/** The engine's view of the same document (withMarkerLabs → resolveProfile → homaPairEligibility). */
function enginePair(d: MarkersDoc, ctx: RuleContext, profile: Partial<PersonProfile> = {}) {
  const base: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 45, heightCm: 178, weightKg: 82 }, startDate: ctx.today, ...profile };
  const rp = resolveProfile(withMarkerLabs(base, d, ctx));
  return { eligible: homaPairEligible(rp), detail: homaPairEligibility(rp) };
}
const g = (date: string, extra: Partial<MarkerReading>, value = 108) => rd({ id: 'fpg', value, unit: 'mg/dL', date }, extra);
const ins = (date: string, extra: Partial<MarkerReading>, value = 18) => rd({ id: 'insulin', value, unit: 'µU/mL', date }, extra);
const insulinOf = (d: MarkersDoc) => d.readings.find((r) => r.id === 'insulin')!;

describe('A1-034 same-draw pairing refuses contradictory occurrences (rules and engine agree)', () => {
  const TODAY = '2026-10-18';

  it('a February glucose and an October insulin reusing one sample id: no HOMA, no 16:8 preference, engine not eligible', () => {
    const d = docOf([g('2026-02-01', { sampleId: 'panel-1', fastingHours: 12 }, 180), ins('2026-10-01', { sampleId: 'panel-1', fastingHours: 12 }, 20)]);
    expect(homaFor(insulinOf(d), d, ctxAt(TODAY))).toMatchObject({ status: 'unavailable', reasons: ['samplingConflict'] });
    const ev = evaluateMarkers(d, ctxAt(TODAY));
    expect(ev.notes.map((n) => n.rule)).not.toContain('W-L-INS-1');
    expect(ev.preferLevers.map((p) => p.lever)).not.toContain('fast16_8');
    expect(enginePair(d, ctxAt(TODAY)).eligible).toBe(false);
    // both raw readings stay exactly as entered
    expect(d.readings.map((r) => [r.id, r.value, r.date])).toEqual([['fpg', 180, '2026-02-01'], ['insulin', 20, '2026-10-01']]);
  });

  it('two recorded instants on one date conflict; equivalent instants in other offsets or precision do not', () => {
    const at = (gAt: string, iAt: string) => docOf([g('2026-09-20', { sampleId: 'd1', fastingHours: 12, sampledAt: gAt }), ins('2026-09-20', { sampleId: 'd1', fastingHours: 12, sampledAt: iAt })]);
    const conflict = at('2026-09-20T07:30+05:30', '2026-09-20T15:10+05:30');
    expect(homaFor(insulinOf(conflict), conflict, ctxAt(TODAY))).toMatchObject({ status: 'unavailable', reasons: ['samplingConflict'] });
    expect(enginePair(conflict, ctxAt(TODAY)).detail?.reasons).toContain('samplingConflict');
    const same = at('2026-09-20T07:30+05:30', '2026-09-20T02:00:00Z');
    expect(homaFor(insulinOf(same), same, ctxAt(TODAY)).status).toBe('eligible');
    expect(enginePair(same, ctxAt(TODAY)).eligible).toBe(true);
  });

  it('unknown times with a consistent identity, a confirmed pairing and a historical own-draw pair stay eligible with their descriptive HOMA', () => {
    const d = docOf([g('2026-09-20', { sampleId: 'd1', fastingHours: 12 }), ins('2026-09-20', { sampleId: 'd1', fastingHours: 12 })]);
    const h = homaFor(insulinOf(d), d, ctxAt(TODAY));
    expect(h.status === 'eligible' && h.value).toBeCloseTo((108 * 18) / 405.3, 1);
    expect(enginePair(d, ctxAt(TODAY)).eligible).toBe(true);
    const confirmed = docOf([g('2026-09-20', { sampleId: 'g1', fastingHours: 12 }), ins('2026-09-20', { sampleId: 'i1', fastingHours: 12, confirmedPairWith: 'g1' })]);
    expect(homaFor(insulinOf(confirmed), confirmed, ctxAt(TODAY)).status).toBe('eligible');
    expect(enginePair(confirmed, ctxAt(TODAY)).eligible).toBe(true);
    // a confirmed pairing whose dates contradict it is a conflict, not a pairing
    const badConfirm = docOf([g('2026-03-20', { sampleId: 'g1', fastingHours: 12 }), ins('2026-09-20', { sampleId: 'i1', fastingHours: 12, confirmedPairWith: 'g1' })]);
    expect(homaFor(insulinOf(badConfirm), badConfirm, ctxAt(TODAY))).toMatchObject({ reasons: ['samplingConflict'] });
    // a reused id: the consistent same-date glucose is chosen, never the last-entered match
    const reused = docOf([g('2026-09-20', { sampleId: 'p', fastingHours: 12 }, 90), ins('2026-09-20', { sampleId: 'p', fastingHours: 12 }, 10), g('2026-10-02', { sampleId: 'p', fastingHours: 12 }, 150)]);
    const hr = homaFor(insulinOf(reused), reused, ctxAt(TODAY));
    expect(hr.status === 'eligible' && hr.glucose.date).toBe('2026-09-20');
  });
});

describe('A1-047 HOMA routine-basal context', () => {
  const TODAY = '2026-10-18';
  const pair = (gx: Partial<MarkerReading>, ix: Partial<MarkerReading>) => docOf([g('2026-09-20', { sampleId: 'd1', fastingHours: 12, ...gx }, 126), ins('2026-09-20', { sampleId: 'd1', fastingHours: 12, ...ix }, 15)]);

  it('a matched 12 h draw with known illness: no standard HOMA preference, a contextual ratio only, engine not eligible; raw values kept', () => {
    const d = pair({ sampleContext: { illness: true } }, { sampleContext: { illness: true } });
    const h = homaFor(insulinOf(d), d, ctxAt(TODAY));
    expect(h).toMatchObject({ status: 'unavailable', reasons: ['illnessUnresolved'] });
    expect(h.status === 'unavailable' && h.contextual?.label).toBe('contextual');
    expect(h.status === 'unavailable' && h.contextual?.value).toBeCloseTo((126 * 15) / 405.3, 1);
    const ev = evaluateMarkers(d, ctxAt(TODAY));
    expect(ev.notes.map((n) => n.rule)).not.toContain('W-L-INS-1');
    expect(ev.preferLevers).toEqual([]);
    expect(enginePair(d, ctxAt(TODAY))).toMatchObject({ eligible: false, detail: { context: 'confounded' } });
    expect(d.readings.map((r) => r.value)).toEqual([126, 15]);
  });

  it('a 72 h sample, an explicit prolonged-fast protocol or a draw inside a logged extended fast is not a routine baseline', () => {
    for (const d of [pair({ fastingHours: 72 }, { fastingHours: 72 }), pair({ sampleContext: { prolongedFastProtocol: true } }, {}), pair({}, { sampleContext: { loggedFastHoursAtSample: 30 } })]) {
      expect(homaFor(insulinOf(d), d, ctxAt(TODAY))).toMatchObject({ status: 'unavailable', reasons: ['prolongedFast'] });
      expect(fired(d, ctxAt(TODAY))).not.toContain('W-L-INS-1');
      expect(enginePair(d, ctxAt(TODAY))).toMatchObject({ eligible: false, detail: { context: 'nonroutine' } });
    }
  });

  it('an ordinary 12 h panel stays available; unknown illness context alone creates no illness and forces no clearance', () => {
    const d = pair({}, {});
    expect(homaFor(insulinOf(d), d, ctxAt(TODAY)).status).toBe('eligible');
    expect(fired(d, ctxAt(TODAY))).toContain('W-L-INS-1');
    expect(enginePair(d, ctxAt(TODAY))).toMatchObject({ eligible: true, detail: { context: 'routine' } });
    const explicitRoutine = pair({ sampleContext: { illness: false, prolongedFastProtocol: false, hardTraining48h: true, afterFastHours: 60 } }, {});
    expect(homaFor(insulinOf(explicitRoutine), explicitRoutine, ctxAt(TODAY)).status).toBe('eligible');
  });

  it('rule and engine paths receive the same eligibility and reasons after metadata transport', () => {
    const cases = [pair({}, {}), pair({ sampleContext: { illness: true } }, {}), pair({ fastingHours: 72 }, {}), pair({ sampledAt: '2026-09-20T07:00+05:30' }, { sampledAt: '2026-09-20T18:00+05:30' })];
    for (const d of cases) {
      const rule = homaFor(insulinOf(d), d, ctxAt(TODAY));
      const eng = enginePair(d, ctxAt(TODAY));
      expect(eng.eligible).toBe(rule.status === 'eligible');
      expect([...(eng.detail?.reasons ?? [])].sort()).toEqual(rule.status === 'eligible' ? [] : [...rule.reasons].sort());
    }
  });
});

describe('A1-063 as-of insulin chronology for HOMA', () => {
  const TODAY = '2026-10-18';
  const ok = () => docOf([g('2026-09-20', { sampleId: 'd1', fastingHours: 12 }), ins('2026-09-20', { sampleId: 'd1', fastingHours: 12 })]);
  const withMeds = (meds: MarkersDoc['medications']) => ({ ...ok(), medications: meds });

  it('a future insulin start leaves the earlier draw untouched (rules and engine)', () => {
    const d = withMeds([{ id: 'i1', medicationClass: 'insulin', change: 'start', date: '2027-01-01' }]);
    expect(insulinTherapyAt(d, ctxAt(TODAY), '2026-09-20')).toBe('no');
    expect(homaFor(insulinOf(d), d, ctxAt(TODAY)).status).toBe('eligible');
    expect(enginePair(d, ctxAt(TODAY)).eligible).toBe(true);
  });

  it('an insulin course started and stopped in 2024 is not current exposure for a later ordinary paired sample', () => {
    const d = withMeds([
      { id: 'i1', medicationClass: 'insulin', change: 'start', date: '2024-02-01' },
      { id: 'i2', medicationClass: 'insulin', change: 'stop', date: '2024-08-01' },
    ]);
    expect(insulinTherapyAt(d, ctxAt(TODAY), '2026-09-20')).toBe('no');
    expect(homaFor(insulinOf(d), d, ctxAt(TODAY)).status).toBe('eligible');
    expect(enginePair(d, ctxAt(TODAY), { safety: { mode: 'M0', flags: { diabetesMedication: 'none' } } }).eligible).toBe(true);
  });

  it('a current insulin screen, an open course before the draw or an ambiguous history keeps HOMA unavailable', () => {
    expect(homaFor(insulinOf(ok()), ok(), ctxAt(TODAY, { flags: ['insulin'] }))).toMatchObject({ status: 'unavailable', reasons: ['exogenousInsulin'] });
    expect(enginePair(ok(), ctxAt(TODAY), { safety: { mode: 'M0', flags: { diabetesMedication: 'insulin' } } }).eligible).toBe(false);
    // a withheld diabetes answer: unknown insulin treatment on both paths
    expect(homaFor(insulinOf(ok()), ok(), ctxAt(TODAY, { flags: ['diabetes-undisclosed'] }))).toMatchObject({ reasons: ['insulinTherapyUnknown'] });
    expect(enginePair(ok(), ctxAt(TODAY), { safety: { mode: 'M0', flags: { answers: { insulin: 'preferNot' } } } }).detail?.insulin).toBe('unknown');
    const open = withMeds([{ id: 'i1', medicationClass: 'insulin', change: 'start', date: '2026-01-01' }]);
    expect(homaFor(insulinOf(open), open, ctxAt(TODAY))).toMatchObject({ reasons: ['exogenousInsulin'] });
    expect(enginePair(open, ctxAt(TODAY)).eligible).toBe(false);
    // two unidentified insulin starts and one stop: the class is not assumed cleared
    const ambiguous = withMeds([
      { id: 'i1', medicationClass: 'insulin', change: 'start', date: '2025-01-01' },
      { id: 'i2', medicationClass: 'insulin', change: 'start', date: '2025-03-01' },
      { id: 'i3', medicationClass: 'insulin', change: 'stop', date: '2025-06-01' },
    ]);
    expect(insulinTherapyAt(ambiguous, ctxAt(TODAY), '2026-09-20')).toBe('unknown');
    expect(homaFor(insulinOf(ambiguous), ambiguous, ctxAt(TODAY))).toMatchObject({ status: 'unavailable', reasons: ['insulinTherapyUnknown'] });
    expect(enginePair(ambiguous, ctxAt(TODAY)).eligible).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------- A1-046 */

describe('A1-046 heart-rhythm medicine is not atrial-fibrillation or arrhythmia history', () => {
  const omega3 = SEED_SUPPLEMENTS.find((s) => s.id === 'omega3_epa_dha')!;
  const caffeine = SEED_SUPPLEMENTS.find((s) => s.id === 'caffeine')!;
  const answers = (a: Partial<ScreeningAnswers>): ScreeningAnswers => ({ pregnancy: 'no', conditions: 'no', metabolic: 'no', medications: 'no', diabetes: 'no', ...a }) as ScreeningAnswers;

  it('only a rhythm-affecting medicine: no AF or arrhythmia reason; the retained review names the medicine', () => {
    const input = suggestionSafetyFrom(answers({ medications: 'yes', medicationItems: ['heart-rhythm'] }));
    expect(resolvePredicate(PREDICATES['af-history'], input).answer).toBe('no');
    expect(resolvePredicate(PREDICATES.arrhythmia, input).answer).toBe('no');
    expect(resolvePredicate(PREDICATES['rhythm-medication'], input).answer).toBe('yes');
    const d = suggestionDecision(omega3, input);
    expect(d.state).toBe('clinicianReview');
    expect(reasonWords(d)).toEqual(['heart-rhythm medicine']);
    const c = reasonWords(suggestionDecision(caffeine, input));
    expect(c).toContain('heart-rhythm medicine');
    expect(c).not.toContain('heart rhythm problem');
    expect(c).not.toContain('atrial fibrillation');
  });

  it('an explicit atrial-fibrillation history still reaches the AF-specific policy', () => {
    const d = suggestionDecision(omega3, { ...suggestionSafetyFrom(answers({})), flags: ['af-history'] });
    expect(d.state).toBe('clinicianReview');
    expect(reasonWords(d)).toEqual(['atrial fibrillation']);
    expect(reasonWords(suggestionDecision(caffeine, { ...suggestionSafetyFrom(answers({})), flags: ['af-history'] }))).toContain('heart rhythm problem');
  });

  it('no heart condition and no medicine adds no review; a broad heart-condition answer leaves the subtype unresolved', () => {
    expect(suggestionDecision(omega3, suggestionSafetyFrom(answers({}))).state).toBe('allow');
    const broad = suggestionSafetyFrom(answers({ conditions: 'yes', conditionItems: ['heart'] }));
    expect(resolvePredicate(PREDICATES['af-history'], broad).answer).toBe('unknown');
    const d = suggestionDecision(omega3, broad);
    expect(d.state).toBe('unchecked');
    expect(reasonWords(d)).toEqual(['atrial fibrillation (not answered)']);
  });
});
