// @vitest-environment node
/**
 * D4-01 (marker side): lab locks carry their explicit unit, source and mandatory status; `mergeSafety` intersects
 * duplicates by the strictest value (caps by minimum, floors by maximum) in every order, keeps every reason and the
 * id's typed unit. D7-03 (marker side): every noSuggest effect of the table survives evaluation with its rule, marker,
 * sample date and applicability.
 */
import { describe, expect, it } from 'vitest';
import { resolveLockConstraints } from '@/engine/planner/domain/safety';
import type { PlannerSafetyInput } from '@/engine/planner/domain/types';
import { readingFromInput } from '../doc';
import { evaluateMarkers, mergeSafety } from '../rules';
import { TABLE } from '../table';
import { LAB_LOCK_UNIT, type MarkerReadingInput, type MarkerSafetyPatch, type MarkersDoc, type RuleContext } from '../types';

const TODAY = '2026-10-02';
const DATE = '2026-09-14';
const doc = (inputs: MarkerReadingInput[]): MarkersDoc => ({ _schema: 1, readings: inputs.map((i) => readingFromInput(i, 'manual', `${DATE}T09:00:00Z`)), displayOnly: [], context: {}, chapter: 'manual' });
const ctx: RuleContext = { sex: 'male', today: TODAY, defaultDeficitCapPct: 25, ageYears: 45, referencePhysiology: 'adultMale' };

function permutations<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [[...xs]];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

describe('lab locks (D4-01)', () => {
  it('carry the explicit unit of their id, the marker source and mandatory status', () => {
    const ev = evaluateMarkers(doc([{ id: 'egfr', value: 52, unit: 'mL/min/1.73 m²', date: DATE }, { id: 'ldl', value: 192, unit: 'mg/dL', date: DATE }]), ctx);
    expect(ev.safety.plannerLocks.length).toBeGreaterThan(2);
    for (const l of ev.safety.plannerLocks) expect(l).toMatchObject({ unit: LAB_LOCK_UNIT[l.id], source: 'marker', mandatory: true });
  });

  it('every surplus cap in the table is written as percent of maintenance (never inferred from magnitude)', () => {
    const caps = TABLE.rules.flatMap((r) => (r.effect.locks ?? []).filter((l) => l.lock === 'surplus-cap'));
    expect(caps.length).toBeGreaterThan(0);
    for (const l of caps) {
      expect(l.unit).toBe('% of maintenance');
      expect(l.value).toBeGreaterThanOrEqual(100);
    }
  });

  it('mergeSafety: caps by minimum and floors by maximum in every order, every reason kept, typed unit', () => {
    const entries = [
      { id: 'protein-cap', value: 1.6, reasons: [{ rule: 'S-1' }], unit: 'g/kg reference weight' },
      { id: 'protein-cap', value: 1.3, reasons: [{ rule: 'L-1' }] },
      { id: 'protein-cap', value: 1.45, reasons: [{ rule: 'C-1' }], mandatory: true },
      { id: 'carb-floor', value: 100, reasons: [{ rule: 'S-2' }], unit: 'g/day' },
      { id: 'carb-floor', value: 50, reasons: [{ rule: 'L-2' }] },
    ];
    let first: unknown = null;
    for (const order of permutations(entries)) {
      const [a, ...rest] = order;
      const patch: MarkerSafetyPatch = { plannerLocks: rest as MarkerSafetyPatch['plannerLocks'], flags: [] };
      const merged = mergeSafety({ plannerLocks: [a!] }, patch).plannerLocks!;
      const byId = Object.fromEntries(merged.map((l) => [l.id, l]));
      expect(merged.filter((l) => l.id === 'protein-cap')).toHaveLength(1);
      expect(byId['protein-cap']!.value).toBe(1.3);
      expect(byId['carb-floor']!.value).toBe(100);
      expect(byId['protein-cap']!.unit).toBe('g/kg/d');
      expect(byId['carb-floor']!.unit).toBe('g/d');
      expect(byId['protein-cap']!.mandatory).toBe(true);
      expect(byId['protein-cap']!.reasons!.map((r) => r.rule).sort()).toEqual(['C-1', 'L-1', 'S-1']);
      const shape = merged.map((l) => [l.id, l.value, l.unit, l.mandatory]).sort();
      if (first === null) first = shape;
      else expect(shape).toEqual(first);
    }
  });

  it('a lab lock wins over a laxer screening value and the merged entry is single per id', () => {
    const ev = evaluateMarkers(doc([{ id: 'sodium', value: 130, unit: 'mmol/L', date: DATE }]), ctx);
    const merged = mergeSafety({ plannerLocks: [{ id: 'max-fast', value: 48, reasons: [{ rule: 'HC-F1' }] }] }, ev.safety);
    const p = merged.plannerLocks!.filter((l) => l.id === 'max-fast');
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ value: 24, unit: 'h', mandatory: true });
    expect(p[0]!.source).toBeUndefined(); // screening + marker: no single source
  });
});

type Lock = NonNullable<PlannerSafetyInput['plannerLocks']>[number];

/** What the planner's typed resolver makes of a lock list (order-free view). */
function resolved(locks: readonly Lock[]) {
  const r = resolveLockConstraints(locks);
  return {
    merged: r.merged.map((d) => `${d.quantity}|${d.comparator}|${d.value}|${d.unit}|${d.mandatory}`).sort(),
    conflicts: r.conflicts.length,
    review: r.review.map((x) => `${x.id}|${x.status}|${x.reason}|${x.value ?? ''}|${x.unit ?? ''}`).sort(),
  };
}

describe('mergeSafety and the planner resolver agree (0C joint, D4-01)', () => {
  it('merging is neutral for the planner: the same typed constraints and reviews as the unmerged list, in every order', () => {
    const entries: Lock[] = [
      { id: 'protein-cap', value: 1.6, reasons: [{ rule: 'S-1' }], unit: 'g/kg reference weight', source: 'screening', mandatory: true },
      { id: 'protein-cap', value: 1.3, reasons: [{ rule: 'W-L-EGFR-1' }], unit: 'g/kg', source: 'marker', mandatory: true },
      { id: 'creatine-cap', value: 3000, reasons: [{ rule: 'import' }], unit: 'mg/d', source: 'import', mandatory: true },
      { id: 'creatine-cap', value: 0, reasons: [{ rule: 'W-L-EGFR-2' }], unit: 'g/d', source: 'marker', mandatory: true },
      { id: 'surplus-cap', value: 90, reasons: [{ rule: 'import' }], source: 'import', mandatory: true },
      { id: 'surplus-cap', value: 110, reasons: [{ rule: 'W-L-TG-3' }], unit: '% of maintenance', source: 'marker', mandatory: true },
      { id: 'carb-floor', value: 100, reasons: [{ rule: 'S-2' }], unit: 'g/day', source: 'screening', mandatory: true },
    ];
    const reference = resolved(entries);
    // the ambiguous imported surplus cap and the mg/d creatine cap stay open for review (never relabelled, never merged)
    expect(reference.review).toEqual(expect.arrayContaining([expect.stringMatching(/^creatine-cap\|review\|unknownUnit\|3000\|mg\/d$/), expect.stringMatching(/^surplus-cap\|review\|/)]));
    for (const order of permutations(entries)) {
      const half = Math.floor(order.length / 2);
      const merged = mergeSafety({ plannerLocks: order.slice(0, half) }, { plannerLocks: order.slice(half) as MarkerSafetyPatch['plannerLocks'], flags: [] }).plannerLocks!;
      expect(resolved(merged)).toEqual(reference);
      const creatine = merged.filter((l) => l.id === 'creatine-cap');
      expect(creatine.map((l) => l.unit).sort()).toEqual(['g/d', 'mg/d']);
      const surplus = merged.filter((l) => l.id === 'surplus-cap');
      expect(surplus).toHaveLength(2);
      expect(surplus.find((l) => l.source === 'import')!.unit).toBeUndefined();
    }
  });

  it('a lone entry keeps the unit it was given (none added, none replaced)', () => {
    const merged = mergeSafety({ plannerLocks: [{ id: 'surplus-cap', value: 90 }, { id: 'caffeine-cap', value: 0.2, unit: 'g/day' }] }, { plannerLocks: [], flags: ['kidney-disease'] }).plannerLocks!;
    expect(merged).toEqual([
      { id: 'surplus-cap', value: 90, reasons: [] },
      { id: 'caffeine-cap', value: 0.2, reasons: [], unit: 'g/day' },
    ]);
    expect(resolved(merged).review).toEqual(expect.arrayContaining([expect.stringMatching(/^caffeine-cap\|review\|unknownUnit/)]));
  });
});

describe('noSuggest decisions survive evaluation (D7-03)', () => {
  const NO_SUGGEST_RULES = TABLE.rules.filter((r) => r.effect.noSuggest?.length).map((r) => r.id).sort();

  it('the table has exactly the four reviewed noSuggest rules', () => {
    expect(NO_SUGGEST_RULES).toEqual(['W-L-EGFR-2', 'W-L-FERRITIN-8', 'W-L-K-2', 'W-L-VITD-3']);
  });

  it('each fired noSuggest rule emits its subjects with rule, marker, sample date and applicability', () => {
    const ev = evaluateMarkers(
      doc([
        { id: 'egfr', value: 52, unit: 'mL/min/1.73 m²', date: DATE },
        { id: 'potassium', value: 5.4, unit: 'mmol/L', date: DATE },
        { id: 'ferritin', value: 260, unit: 'ng/mL', date: DATE },
        { id: 'hsCrp', value: 1, unit: 'mg/L', date: DATE },
        { id: 'vitD', value: 120, unit: 'ng/mL', date: DATE },
      ]),
      ctx,
    );
    const fired = [...new Set(ev.noSuggest!.map((d) => d.rule))].sort();
    expect(fired).toEqual(NO_SUGGEST_RULES);
    for (const d of ev.noSuggest!) {
      expect(d).toMatchObject({ sampleDate: DATE, stale: false, applicability: 'applicable' });
      expect(TABLE.rules.find((r) => r.id === d.rule)!.effect.noSuggest).toContain(d.subject);
    }
    expect(ev.noSuggest!.map((d) => d.subject)).toEqual(expect.arrayContaining(['supp:creatine_monohydrate', 'supp:potassium_salt_substitute', 'supp:electrolytes_fasting', 'supp:iron', 'supp:vitamin_d3']));
  });

  it('a rule that does not fire emits nothing', () => {
    const ev = evaluateMarkers(doc([{ id: 'egfr', value: 95, unit: 'mL/min/1.73 m²', date: DATE }]), ctx);
    expect(ev.noSuggest).toEqual([]);
  });
});
