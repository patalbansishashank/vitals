// @vitest-environment node
/**
 * D7-03 supplements line: one tri-state policy per catalogue item. Unknown safety is `unchecked` (never an empty negative
 * screen), a reviewed noSuggest decision withholds the suggestion by name with its reasons, and a product already taken
 * stays visible with its status (taking is never refused or deleted).
 */
import { describe, expect, it } from 'vitest';
import type { SupplementRecord } from '@/catalogues/types';
import { SEED_SUPPLEMENTS } from '@/content/catalogues/supplements';
import type { SuggestionDecision } from '@/lib/bodyContracts';
import { supplementLine, type SupplementPolicy } from '../extras';
import type { FoodSetup } from '../context';

const setup = (o: Partial<FoodSetup> = {}): FoodSetup => ({ diet: null, pantry: [], supplementStance: 'open', takingSupplements: [], onHandSupplements: [], refusedSupplements: [], ...o });

/** A stand-in for the shared evaluator: renal context known (marker noSuggest) for whey and creatine, others allowed. */
const renal: SupplementPolicy = (r: SupplementRecord): SuggestionDecision =>
  r.id === 'creatine_monohydrate' || r.id === 'whey_protein'
    ? { subject: r.id, state: 'noSuggest', reasons: [{ rule: 'W-L-egfr-low', source: 'marker', applicability: 'applicable', sampleDate: '2026-09-01', stale: false }] }
    : { subject: r.id, state: 'allow', reasons: [] };

describe('supplements line policy (D7-03)', () => {
  it('food first: no suggestions, the legacy shape', () => {
    expect(supplementLine({ setup: setup({ supplementStance: 'food_first' }) })).toEqual({ optedIn: false, items: [], hiddenForSafety: 0 });
  });

  it('unknown safety state: items with a contraindication are Unchecked (named, withheld), not allowed and not a safety hide', () => {
    const line = supplementLine({ setup: setup() });
    const withheld = Object.fromEntries((line.withheld ?? []).map((w) => [w.id, w]));
    expect(withheld.creatine_monohydrate?.policy).toBe('unchecked');
    expect(withheld.whey_protein?.policy).toBe('unchecked');
    expect(withheld.whey_protein?.reasons.every((r) => r.applicability === 'unresolved')).toBe(true);
    expect(line.items.every((i) => i.policy === 'allow')).toBe(true);
    expect(line.items.length).toBeGreaterThan(0); // items without contraindications stay useful
    expect(line.hiddenForSafety).toBe(0); // unknown is not "hidden because of your safety answers"
  });

  it('an answered negative screen (no matching flag) differs from an unanswered one', () => {
    const answered = supplementLine({ setup: setup(), safetyFlags: [] });
    expect(answered.items.find((i) => i.id === 'creatine_monohydrate')?.policy).toBe('allow');
    const unanswered = supplementLine({ setup: setup() });
    expect(unanswered.items.find((i) => i.id === 'creatine_monohydrate')).toBeUndefined();
    expect(unanswered.withheld?.find((w) => w.id === 'creatine_monohydrate')?.policy).toBe('unchecked');
  });

  it('caution is suggested with its status; clinician review is withheld as Review', () => {
    const policy: SupplementPolicy = (r) =>
      r.id === 'creatine_monohydrate'
        ? { subject: r.id, state: 'caution', reasons: [{ rule: 'predicate:x', source: 'policy', applicability: 'unresolved' }] }
        : r.id === 'whey_protein'
          ? { subject: r.id, state: 'clinicianReview', reasons: [{ rule: 'predicate:kidney-disease', source: 'screening', applicability: 'applicable' }] }
          : { subject: r.id, state: 'allow', reasons: [] };
    const line = supplementLine({ setup: setup(), policy });
    expect(line.items.find((i) => i.id === 'creatine_monohydrate')).toMatchObject({ policy: 'caution', reasons: [{ rule: 'predicate:x' }] });
    expect(line.withheld).toEqual([{ id: 'whey_protein', name: expect.any(String), policy: 'clinicianReview', reasons: expect.any(Array) }]);
    expect(line.hiddenForSafety).toBe(1);
  });

  it('a noSuggest decision withholds the suggestion by name with rule, source and applicability', () => {
    const line = supplementLine({ setup: setup(), policy: renal });
    expect(line.items.map((i) => i.id)).not.toContain('creatine_monohydrate');
    expect(line.items.map((i) => i.id)).not.toContain('whey_protein');
    expect(line.withheld?.map((w) => w.id).sort()).toEqual(['creatine_monohydrate', 'whey_protein']);
    expect(line.withheld?.[0]).toMatchObject({ policy: 'noSuggest' });
    expect(line.withheld?.[0]?.reasons[0]).toMatchObject({ rule: 'W-L-egfr-low', source: 'marker', applicability: 'applicable', stale: false });
    expect(line.hiddenForSafety).toBe(2);
  });

  it('a product already taken stays visible with its status; it is not re-suggested and never refused', () => {
    const line = supplementLine({ setup: setup({ takingSupplements: ['creatine_monohydrate'] }), policy: renal });
    expect(line.taking).toEqual([{ id: 'creatine_monohydrate', name: 'Creatine monohydrate', policy: 'noSuggest', reasons: expect.any(Array) }]);
    expect(line.items.map((i) => i.id)).not.toContain('creatine_monohydrate');
    expect(line.withheld?.map((w) => w.id)).toEqual(['whey_protein']);
    // allowed taken products need no status row
    expect(supplementLine({ setup: setup({ takingSupplements: ['psyllium'] }), policy: renal }).taking).toBeUndefined();
  });

  it('legacy exact flags still withhold (the shared evaluator owns aliases)', () => {
    const flag = SEED_SUPPLEMENTS.find((r) => r.id === 'whey_protein')!.contraindications[0]!.flag;
    const line = supplementLine({ setup: setup(), safetyFlags: [flag] });
    expect(line.withheld?.map((w) => w.id)).toContain('whey_protein');
    expect(line.withheld?.find((w) => w.id === 'whey_protein')?.reasons[0]).toMatchObject({ rule: `contraindication:${flag}`, source: 'screening', applicability: 'applicable' });
  });
});
