// @vitest-environment node
/**
 * Phase 0C joint checks of the clinical providers with their consumers (C1/C3/C4/C7; D7-02, D7-03):
 *  - the markers document converges under reload, sync (JSON) and import: normalising is idempotent, a newer writer's
 *    fields survive a read-modify-write, readings (sample facts, a legacy mL/min eGFR) are never rewritten, and the
 *    evaluation and engine baselines derived from it keep the same content hash;
 *  - the baselines' out-of-domain provenance (`labMeta`) and the engine's anchor provider (`cardiometabolicObservedAnchors`,
 *    read by the core loop and the planner) apply one calibration-domain rule;
 *  - one suggestion policy reaches the supplement consumers: the `supplements.*` view, the Food/Coach supplements line
 *    (W0-food `supplementLine`, policy injected) and the planner's supplement levers. Logging stays permissive.
 */
import { describe, expect, it } from 'vitest';
import { supplementPlannerInputs, supplementSuggestionPolicy } from '@/catalogues/supplements/planner';
import type { SupplementsSectionV2 } from '@/catalogues/supplements/types';
import { supplementLine } from '@/commands/food/extras';
import type { FoodSetup } from '@/commands/food/context';
import { SEED_SUPPLEMENTS } from '@/content/catalogues/supplements';
import { cardiometabolicObservedAnchors } from '@/engine/model/cardiometabolic/constants';
import type { LabBaselines } from '@/engine/types/profile';
import { suggestionSafetyFrom, type ScreeningAnswers } from '@/features/onboarding/safetyRules';
import { contentHash } from '@/lib/bodyContracts';
import { suggestionDecision, type SuggestionSafetyInput } from '@/lib/safetyPolicy';
import { labBaselinesWithDates } from '../baselines';
import { normaliseDoc, readingFromInput } from '../doc';
import { evaluateMarkers } from '../rules';
import type { MarkerReading, MarkersDoc, RuleContext } from '../types';

const TODAY = '2026-10-02';
const DATE = '2026-09-14';
const AT = `${DATE}T09:00:00Z`;
const ctx: RuleContext = { sex: 'male', today: TODAY, ageYears: 45, referencePhysiology: 'adultMale', defaultDeficitCapPct: 25 };

const STD: ScreeningAnswers = {
  ageBand: '18-64',
  pregnancy: 'no',
  eatingDisorder: 'no',
  scoffRisk: false,
  diabetes: 'no',
  conditions: 'no',
  metabolic: 'no',
  medications: 'no',
  symptoms: 'no',
  supervisedExercise: 'no',
  musculoskeletal: 'no',
  alcohol: 'no',
};

const readings: MarkerReading[] = [
  readingFromInput({ id: 'egfr', value: 40, unit: 'mL/min', date: DATE }, 'manual', AT), // legacy shorthand: indexing unconfirmed
  readingFromInput({ id: 'testosterone', value: 250, unit: 'ng/dL', date: DATE, sampleId: 'draw-1', sampledAt: '2026-09-14T07:40:00+05:30', fastingHours: 11 }, 'manual', AT, { sampleLocalClockH: 7.67, hormoneTherapy: 'no' }),
  readingFromInput({ id: 'ldl', value: 310, unit: 'mg/dL', date: DATE, sampleId: 'draw-1' }, 'manual', AT),
  readingFromInput({ id: 'tg', value: 1200, unit: 'mg/dL', date: DATE, sampleId: 'draw-1', fasting: true }, 'manual', AT),
  readingFromInput({ id: 'hdl', value: 48, unit: 'mg/dL', date: DATE, sampleId: 'draw-1' }, 'manual', AT),
];

/** The stored record as the document store hands it over (meta keys, a newer writer's fields). */
const stored = {
  _id: 'me',
  _col: 'markers',
  _rev: '7',
  _updated: '2026-10-01T10:00:00Z',
  readings,
  displayOnly: [],
  context: { recentIllness: false },
  chapter: 'manual',
  reviews: [{ id: 'r1', markerId: 'egfr', readingIds: ['x'], state: 'needsRepeat', since: DATE, authority: 'rule' }],
  futureWriterField: { kept: true, n: 3 },
};

/** `writeMarkers` (src/commands/markers/view.ts): the body without `_schema`, under the store's id. */
const writeBody = (d: MarkersDoc): Record<string, unknown> => {
  const { _schema: _s, ...body } = d;
  void _s;
  return { ...body, _id: 'me', _rev: '8' };
};

describe('markers document: reload / sync / import converge (0C, C7)', () => {
  it('normalising is idempotent, keeps a newer writer\'s fields and drops only store meta', () => {
    const n1 = normaliseDoc(stored);
    expect(normaliseDoc(n1)).toEqual(n1);
    expect((n1 as unknown as Record<string, unknown>).futureWriterField).toEqual({ kept: true, n: 3 });
    expect(n1.reviews).toEqual(stored.reviews);
    for (const k of ['_id', '_col', '_rev', '_updated']) expect(n1).not.toHaveProperty(k);
    // write → read (reload), JSON (sync), and a second import of the same record all give the same document
    expect(normaliseDoc(writeBody(n1))).toEqual(n1);
    expect(normaliseDoc(JSON.parse(JSON.stringify(writeBody(n1))))).toEqual(n1);
    expect(normaliseDoc(writeBody(normaliseDoc(writeBody(n1))))).toEqual(n1);
  });

  it('readings are never rewritten: sample facts and the legacy mL/min eGFR stay as entered', () => {
    const n = normaliseDoc(JSON.parse(JSON.stringify(stored)));
    expect(n.readings).toEqual(JSON.parse(JSON.stringify(readings)));
    const egfr = n.readings.find((r) => r.id === 'egfr')!;
    expect(egfr.unit).toBe('mL/min');
    expect(egfr).not.toHaveProperty('quantityKind');
    expect(n.readings.find((r) => r.id === 'testosterone')).toMatchObject({ sampleId: 'draw-1', fastingHours: 11, sampleLocalClockH: 7.67, hormoneTherapy: 'no' });
  });

  it('the derived evaluation and engine baselines keep their content hash across reload and sync', () => {
    const a = normaliseDoc(stored);
    const b = normaliseDoc(JSON.parse(JSON.stringify(writeBody(a))));
    expect(contentHash(evaluateMarkers(b, ctx))).toBe(contentHash(evaluateMarkers(a, ctx)));
    expect(contentHash(labBaselinesWithDates(b, TODAY))).toBe(contentHash(labBaselinesWithDates(a, TODAY)));
    // the ambiguous eGFR stays out of the baseline and out of CKD staging after every round trip
    const base = labBaselinesWithDates(b, TODAY);
    expect(base.labs.egfr).toBeUndefined();
    expect(base.labMeta.egfr).toMatchObject({ quantityKind: 'indexingUnconfirmed', original: { value: 40, unit: 'mL/min' } });
    const ev = evaluateMarkers(b, ctx);
    expect(ev.safety.flags).not.toContain('kidney-disease');
    expect(ev.notes.some((n) => n.rule.startsWith('W-L-EGFR-'))).toBe(false);
    // the measured lipids pass through exactly (unit conversion only), with the entered value as provenance
    expect(base.labs.ldlMmolL! * 38.67).toBeCloseTo(310, 3);
    expect(base.labMeta.ldlMmolL).toMatchObject({ original: { value: 310, unit: 'mg/dL' }, sampleId: 'draw-1', outOfDomain: true });
    expect(base.labMeta.tgMmolL).toMatchObject({ original: { value: 1200, unit: 'mg/dL' }, fastingStatus: 'fasting' });
  });
});

describe('one calibration-domain rule for baselines and engine anchors (0C, D7-02)', () => {
  it('labMeta.outOfDomain agrees with cardiometabolicObservedAnchors for every measured field', () => {
    const doc: MarkersDoc = {
      _schema: 1,
      readings: [
        readingFromInput({ id: 'ldl', value: 310, unit: 'mg/dL', date: DATE }, 'manual', AT),
        readingFromInput({ id: 'tg', value: 1200, unit: 'mg/dL', date: DATE }, 'manual', AT),
        readingFromInput({ id: 'fpg', value: 300, unit: 'mg/dL', date: DATE }, 'manual', AT),
        readingFromInput({ id: 'hba1c', value: 14, unit: '%', date: DATE }, 'manual', AT),
        readingFromInput({ id: 'hdl', value: 50, unit: 'mg/dL', date: DATE }, 'manual', AT),
        readingFromInput({ id: 'apoB', value: 90, unit: 'mg/dL', date: DATE }, 'manual', AT),
      ],
      displayOnly: [],
      context: {},
      chapter: 'manual',
    };
    const { labs, labMeta } = labBaselinesWithDates(doc, TODAY);
    const provider = cardiometabolicObservedAnchors(labs as LabBaselines);
    const field: Record<string, keyof LabBaselines> = { ldl: 'ldlMmolL', tg: 'tgMmolL', fpg: 'fastingGlucoseMmolL', a1c: 'hba1cPct', hdl: 'hdlMmolL', apoB: 'apoBgL' };
    for (const [lab, f] of Object.entries(field)) expect(labMeta[f]?.outOfDomain === true, lab).toBe(provider.outOfDomain.includes(lab as never));
    expect([...provider.outOfDomain].sort()).toEqual(['a1c', 'fpg', 'ldl', 'tg']);
    // anchors are the measured values exactly (engine units), never a clamped replacement
    const ldl = provider.anchors.find((x) => x.series === 'ldl')!;
    expect(ldl.value).toBe(labs.ldlMmolL);
    expect(ldl.outOfDomain).toBe(true);
  });
});

describe('one suggestion policy across the supplement consumers (0C, D7-03)', () => {
  const lowEgfr: MarkersDoc = { _schema: 1, readings: [readingFromInput({ id: 'egfr', value: 45, unit: 'mL/min/1.73 m²', date: DATE }, 'manual', AT)], displayOnly: [], context: {}, chapter: 'manual' };
  const ev = evaluateMarkers(lowEgfr, ctx);
  const safety: SuggestionSafetyInput = suggestionSafetyFrom(STD, { markers: { flags: ev.safety.flags, noSuggest: ev.noSuggest ?? [] }, diet: { rulesComplete: true, allergies: [] } });
  const section: SupplementsSectionV2 = { version: 2, stance: 'open', rows: [{ supplementId: 'creatine_monohydrate', state: 'taking', dose: 5, unit: 'g', timesOfDay: ['morning'] }] } as unknown as SupplementsSectionV2;
  const setup: FoodSetup = { diet: null, pantry: [], supplementStance: 'open', takingSupplements: ['creatine_monohydrate'], onHandSupplements: [], refusedSupplements: [] };

  it('the marker decision (low indexed eGFR) withholds the same products on every surface; the taken product keeps its row', () => {
    expect(ev.safety.flags).toContain('kidney-disease');
    const view = supplementSuggestionPolicy(section, SEED_SUPPLEMENTS, safety);
    const line = supplementLine({ setup, policy: (r) => suggestionDecision(r, safety) });
    const planner = supplementPlannerInputs(section, safety);
    const notNew = supplementPlannerInputs({ ...section, rows: [] }, safety);
    // creatine: not suggested (product policy + marker noSuggest); the person's own row is kept with a Review status
    expect(view.decisions.find((d) => d.subject === 'creatine_monohydrate')!.state).toBe('noSuggest');
    expect(view.rowStatus).toEqual([expect.objectContaining({ supplementId: 'creatine_monohydrate', status: 'review' })]);
    expect(line.taking).toEqual([expect.objectContaining({ id: 'creatine_monohydrate', policy: 'noSuggest' })]);
    expect(planner.habitual).toEqual(['L7']); // already taken: part of the baseline, never deleted
    expect(notNew.optInLevers).not.toContain('creatine'); // the open stance does not add it as a new lever
    // whey: clinician review (a protein exposure question) on both suggestion surfaces
    expect(view.decisions.find((d) => d.subject === 'whey_protein')!.state).toBe('clinicianReview');
    expect(line.withheld).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'whey_protein', policy: 'clinicianReview' })]));
    expect(line.items.map((i) => i.id)).not.toContain('whey_protein');
    // every withheld line item has the same state as the view's decision
    for (const w of line.withheld ?? []) expect(view.decisions.find((d) => d.subject === w.id)!.state).toBe(w.policy);
  });

  it('unknown screening stays unchecked on every surface (never an empty negative screen, never a known disease)', () => {
    const unknown = suggestionSafetyFrom(null);
    const view = supplementSuggestionPolicy({ ...section, rows: [] }, SEED_SUPPLEMENTS, unknown);
    const line = supplementLine({ setup: { ...setup, takingSupplements: [] }, policy: (r) => suggestionDecision(r, unknown) });
    expect(view.decisions.find((d) => d.subject === 'creatine_monohydrate')!.state).toBe('unchecked');
    expect(line.withheld).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'creatine_monohydrate', policy: 'unchecked' })]));
    expect(line.hiddenForSafety).toBe((line.withheld ?? []).filter((w) => w.policy !== 'unchecked').length);
    expect(supplementPlannerInputs({ ...section, rows: [] }, unknown).optInLevers).not.toContain('creatine');
    // a screened-negative person gets the suggestion
    const clear = suggestionSafetyFrom(STD, { diet: { rulesComplete: true, allergies: [] } });
    expect(supplementPlannerInputs({ ...section, rows: [] }, clear).optInLevers).toContain('creatine');
  });
});
