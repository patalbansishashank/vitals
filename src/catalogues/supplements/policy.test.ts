// @vitest-environment node
/**
 * D7-03: one typed suggestion policy for Food, the Coach, the commands and the planner. Every shipped contraindication
 * resolves to a supported predicate (no dangling alias); a real kidney-disease screening or a low-eGFR marker patch
 * withholds creatine and whey suggestions through every alias; unanswered screening is unchecked, not screened-negative;
 * the person's own taking row stays visible with a status; noSuggest marker decisions survive into the policy.
 */
import { describe, expect, it } from 'vitest';
import { SEED_SUPPLEMENTS } from '@/content/catalogues';
import { evaluateMarkers } from '@/markers/rules';
import { readingFromInput } from '@/markers/doc';
import type { MarkersDoc } from '@/markers/types';
import { screeningAnswerMap } from '@/features/onboarding/safetyRules';
import {
  PREDICATES,
  PREDICATE_ALIASES,
  PRODUCT_POLICY,
  canonicalPredicate,
  isSuggestible,
  suggestionDecision,
  type SuggestionSafetyInput,
} from '@/lib/safetyPolicy';
import { supplementPlannerInputs, supplementSuggestionPolicy } from './planner';
import type { SupplementsSectionV2 } from './types';

const rec = (id: string) => SEED_SUPPLEMENTS.find((s) => s.id === id)!;
const decide = (id: string, input: SuggestionSafetyInput) => suggestionDecision(rec(id), input);

/** A complete, all-negative screening (plus answered food rules without allergies). */
const CLEAR: SuggestionSafetyInput = {
  screening: screeningAnswerMap({ ageBand: '18-64', pregnancy: 'no', eatingDisorder: 'no', scoffRisk: false, diabetes: 'no', conditions: 'no', metabolic: 'no', medications: 'no', symptoms: 'no', supervisedExercise: 'no', musculoskeletal: 'no', alcohol: 'no' }),
  allergies: { milk: 'no', soy: 'no' },
};
const KIDNEY: SuggestionSafetyInput = { ...CLEAR, screening: screeningAnswerMap({ ageBand: '18-64', pregnancy: 'no', conditions: 'yes', conditionItems: ['kidney'], medications: 'no', metabolic: 'no' }) };

describe('predicate registry', () => {
  it('every shipped contraindication resolves to a supported predicate (CI rejects unsupported ids)', () => {
    const bad: string[] = [];
    for (const s of SEED_SUPPLEMENTS) for (const c of s.contraindications) if (!canonicalPredicate(c.flag)) bad.push(`${s.id}:${c.flag}`);
    expect(bad).toEqual([]);
  });

  it('the catalogue stores canonical ids; every reviewed alias maps to a registered predicate', () => {
    for (const s of SEED_SUPPLEMENTS) for (const c of s.contraindications) expect(canonicalPredicate(c.flag), c.flag).toBe(c.flag);
    for (const [alias, id] of Object.entries(PREDICATE_ALIASES)) expect(PREDICATES[id], alias).toBeDefined();
    expect(canonicalPredicate('ckd')).toBe('kidney-disease');
    expect(canonicalPredicate('kidney_disease')).toBe('kidney-disease');
    expect(canonicalPredicate('liver_disease')).toBe('liver-disease');
    expect(canonicalPredicate('kidney')).toBeNull();
    for (const key of Object.keys(PRODUCT_POLICY)) {
      const [product, predicate] = key.split('|');
      expect(SEED_SUPPLEMENTS.some((s) => s.id === product && s.contraindications.some((c) => c.flag === predicate)), key).toBe(true);
    }
  });

  it('an unsupported predicate is unchecked, never silently ignored', () => {
    const d = suggestionDecision({ id: 'x', contraindications: [{ flag: 'mystery_condition' }] }, CLEAR);
    expect(d.state).toBe('unchecked');
    expect(d.reasons[0]).toMatchObject({ rule: 'predicate:unsupported:mystery_condition', applicability: 'unresolved' });
  });
});

describe('real safety state reaches the suggestion decision', () => {
  it('kidney disease from the screening: creatine not suggested, whey clinician review, both off the cards', () => {
    expect(decide('creatine_monohydrate', KIDNEY).state).toBe('noSuggest');
    expect(decide('whey_protein', KIDNEY).state).toBe('clinicianReview');
    expect(decide('potassium_salt_substitute', KIDNEY).state).toBe('noSuggest');
    for (const id of ['creatine_monohydrate', 'whey_protein', 'magnesium', 'electrolytes_fasting']) expect(isSuggestible(decide(id, KIDNEY)), id).toBe(false);
    // a healthy screen allows them
    expect(decide('creatine_monohydrate', CLEAR).state).toBe('allow');
    expect(decide('whey_protein', CLEAR).state).toBe('allow');
  });

  it('every alias of the kidney predicate reaches the same policy', () => {
    for (const flag of ['ckd', 'kidney_disease', 'kidney-disease']) {
      const d = suggestionDecision({ id: 'creatine_monohydrate', contraindications: [{ flag }] }, KIDNEY);
      expect(d.state, flag).toBe('noSuggest');
    }
  });

  it('unanswered screening is unchecked (not screened-negative and not a known disease)', () => {
    const none: SuggestionSafetyInput = { screening: {} };
    const d = decide('whey_protein', none);
    expect(d.state).toBe('unchecked');
    expect(d.reasons.map((r) => r.rule)).toEqual(expect.arrayContaining(['predicate:kidney-disease:unknown', 'predicate:milk-allergy:unknown']));
    expect(d.reasons.every((r) => r.applicability === 'unresolved')).toBe(true);
    const preferNot = decide('creatine_monohydrate', { ...CLEAR, screening: screeningAnswerMap({ conditions: 'prefer-not' }) });
    expect(preferNot.state).toBe('unchecked');
    expect(preferNot.reasons[0]!.rule).toBe('predicate:kidney-disease:preferNot');
  });

  it('a predicate the app never asks about is a caution shown with the card, never a hidden blanket ban', () => {
    const d = decide('caffeine', CLEAR);
    expect(d.state).toBe('caution');
    expect(isSuggestible(d)).toBe(true);
    expect(d.reasons.map((r) => r.rule)).toContain('predicate:anxiety-disorder:notScreened');
  });

  it('a low-eGFR marker patch reaches Food and the Coach as well as the planner (flags and noSuggest with provenance)', () => {
    const doc: MarkersDoc = { _schema: 1, readings: [readingFromInput({ id: 'egfr', value: 52, unit: 'mL/min/1.73 m²', date: '2026-09-12' }, 'manual', '2026-09-12T09:00:00Z')], displayOnly: [], context: {}, chapter: 'manual' };
    const ev = evaluateMarkers(doc, { sex: 'male', today: '2026-10-02', ageYears: 50, referencePhysiology: 'adultMale' });
    const input: SuggestionSafetyInput = { ...CLEAR, markerFlags: ev.safety.flags, markerNoSuggest: ev.noSuggest };
    const creatine = decide('creatine_monohydrate', input);
    expect(creatine.state).toBe('noSuggest');
    expect(creatine.reasons).toContainEqual({ rule: 'W-L-EGFR-2', source: 'marker', applicability: 'applicable', sampleDate: '2026-09-12', stale: false });
    expect(creatine.reasons.map((r) => r.rule)).toContain('predicate:kidney-disease');
    expect(decide('whey_protein', input).state).toBe('clinicianReview');
    // the planner path withholds the open-stance creatine opt-in under the same policy
    const open: SupplementsSectionV2 = { _v: 2, stance: 'open', rows: [] } as SupplementsSectionV2;
    expect(supplementPlannerInputs(open).optInLevers).toEqual(['creatine']);
    expect(supplementPlannerInputs(open, input).optInLevers).toEqual([]);
    expect(supplementPlannerInputs(open, CLEAR).optInLevers).toEqual(['creatine']);
  });

  it('an unresolved marker noSuggest (ambiguous eGFR unit) stays visible as unchecked', () => {
    const doc: MarkersDoc = { _schema: 1, readings: [readingFromInput({ id: 'egfr', value: 52, unit: 'mL/min', date: '2026-09-12' }, 'manual', '2026-09-12T09:00:00Z')], displayOnly: [], context: {}, chapter: 'manual' };
    const ev = evaluateMarkers(doc, { sex: 'male', today: '2026-10-02' });
    const d = decide('creatine_monohydrate', { ...CLEAR, markerFlags: ev.safety.flags, markerNoSuggest: ev.noSuggest });
    expect(d.state).toBe('unchecked');
    expect(d.reasons).toContainEqual(expect.objectContaining({ rule: 'W-L-EGFR-2', source: 'marker', applicability: 'unresolved' }));
  });
});

describe('logs stay permissive; refusal, clinician stop and on-hand compose', () => {
  const section = (rows: SupplementsSectionV2['rows']): SupplementsSectionV2 => ({ _v: 2, stance: 'open', rows }) as SupplementsSectionV2;

  it('a creatine taking row with kidney disease stays a taking row (observed exposure) with a review status', () => {
    const s = section([{ supplementId: 'creatine_monohydrate', state: 'taking', dose: 5, unit: 'g', timesOfDay: ['morning'] }]);
    const p = supplementSuggestionPolicy(s, SEED_SUPPLEMENTS, KIDNEY);
    expect(p.rowStatus).toContainEqual(expect.objectContaining({ supplementId: 'creatine_monohydrate', status: 'review' }));
    expect(supplementPlannerInputs(s, KIDNEY)).toMatchObject({ habitual: ['L7'], optInLevers: ['creatine'] });
    expect(p.suggestible.has('creatine_monohydrate')).toBe(false);
  });

  it('unknown safety on a taken product shows Unchecked; a clear screen shows nothing', () => {
    const s = section([{ supplementId: 'whey_protein', state: 'taking', dose: 25, unit: 'g', timesOfDay: ['morning'] }]);
    expect(supplementSuggestionPolicy(s, SEED_SUPPLEMENTS, { screening: {} }).rowStatus).toContainEqual(expect.objectContaining({ supplementId: 'whey_protein', status: 'unchecked' }));
    expect(supplementSuggestionPolicy(s, SEED_SUPPLEMENTS, CLEAR).rowStatus).toEqual([]);
  });

  it('a clinician stop ends the planned continuation and the suggestion; the row and its history stay', () => {
    const s = section([{ supplementId: 'omega3_epa_dha', state: 'taking', dose: 1, unit: 'g', timesOfDay: ['morning'], clinicianStop: { on: '2026-09-01' } }]);
    expect(supplementPlannerInputs(s, CLEAR)).toMatchObject({ excludedLevers: ['L8'], habitual: [] });
    const p = supplementSuggestionPolicy(s, SEED_SUPPLEMENTS, CLEAR);
    expect(p.withheld.find((d) => d.subject === 'omega3_epa_dha')?.reasons.map((r) => r.rule)).toContain('clinicianStop');
    expect(p.rowStatus).toContainEqual(expect.objectContaining({ supplementId: 'omega3_epa_dha', status: 'review' }));
    expect(s.rows).toHaveLength(1);
  });

  it('on hand with a holding contraindication: no purchase, no opt-in; a refusal is not suggested', () => {
    const s = section([
      { supplementId: 'creatine_monohydrate', state: 'onHand', timesOfDay: [] },
      { supplementId: 'psyllium', state: 'notForMe', timesOfDay: [] },
    ]);
    expect(supplementPlannerInputs(s, KIDNEY)).toMatchObject({ onHand: ['L7'], optInLevers: [], excludedLevers: ['L9'] });
    const p = supplementSuggestionPolicy(s, SEED_SUPPLEMENTS, CLEAR);
    const psyllium = p.withheld.find((d) => d.subject === 'psyllium')!;
    expect(psyllium.state).toBe('noSuggest');
    expect(psyllium.reasons.map((r) => r.rule)).toContain('refused');
  });
});
