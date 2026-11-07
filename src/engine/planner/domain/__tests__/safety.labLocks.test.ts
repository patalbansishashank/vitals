// @vitest-environment node
/**
 * E20/D4-01 (C5): blood-marker and screening locks as typed constraints in the planner's safety compile — strictest
 * duplicate aggregation in any order, explicit units (never inferred from magnitude), percent-of-maintenance surplus
 * semantics, conflicts and reviews, and no enforcement sentence written before a final check. D7-05/D7-09: an expired
 * baseline, a non-fasting glucose sample or a glycaemic medication change stops a lab-anchored goal's quantitative use
 * while readings and safety locks stay.
 */
import { describe, expect, it } from 'vitest';
import { resolveProfile } from '../../../core/resolveProfile';
import type { PersonProfile } from '../../../types/profile';
import { compileRequest, labBaselineForecastIssue } from '../context';
import { HC, PLANNER_LOCK_DEFS, compileSafetyCaps, resolveLockConstraints } from '../safety';
import type { PlannerSafetyInput } from '../types';
import { MAN_95, request } from './personas';

type Lock = NonNullable<PlannerSafetyInput['plannerLocks']>[number];
const rp = resolveProfile(MAN_95);
const caps = (plannerLocks: Lock[]) => compileSafetyCaps(rp, { plannerLocks });

/** Every permutation of a short list. */
function permutations<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [xs.slice()];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

describe('lab locks (typed, D4-01)', () => {
  it('creatine-cap 0 stops the planner adding creatine, with a plain reason', () => {
    expect(caps([]).creatineAllowed).toBe(true);
    const c = caps([{ id: 'creatine-cap', value: 0 }]);
    expect(c.creatineAllowed).toBe(false);
    expect(c.reasons.join(' ')).toMatch(/will not add creatine/);
  });

  it('a positive creatine cap (3 g/day) stays allowed and bounds the dose the plan may add', () => {
    const c = caps([{ id: 'creatine-cap', value: 3 }]);
    expect(c.creatineAllowed).toBe(true);
    expect(c.creatineMaxG).toBe(3);
    expect(caps([]).creatineMaxG).toBe(HC.creatineMaxG);
  });

  it('surplus-cap is percent OF maintenance: 110 means 110 %, 90 is a conflict (never 190 %), 10 is never "10 % above"', () => {
    const base = caps([]);
    const c110 = caps([{ id: 'surplus-cap', value: 110 }]);
    expect(c110.maxPctTdee).toBe(110);
    expect(c110.surplusPhaseMaxPct).toBe(Math.min(base.surplusPhaseMaxPct, 110));
    expect(c110.constraints.review).toEqual([]);
    for (const v of [90, 10]) {
      const c = caps([{ id: 'surplus-cap', value: v }]);
      expect(c.maxPctTdee).toBe(100);
      expect(c.maxPctTdee).not.toBe(190);
      expect(c.constraints.review).toEqual([{ id: 'surplus-cap', status: 'conflict', reason: 'belowMaintenanceConflictsNoDeficitPolicy', value: v, unit: '% of maintenance', mandatory: true }]);
    }
  });

  it('an imported surplus cap without a unit needs review (no magnitude inference); an explicit unit is accepted', () => {
    const amb = caps([{ id: 'surplus-cap', value: 110, source: 'import' }]);
    expect(amb.constraints.review.map((r) => [r.status, r.reason])).toEqual([['review', 'ambiguousUnit']]);
    expect(amb.maxPctTdee).toBe(100);
    const ok = caps([{ id: 'surplus-cap', value: 110, source: 'import', unit: '% of maintenance' }]);
    expect(ok.constraints.review).toEqual([]);
    expect(ok.maxPctTdee).toBe(110);
  });

  it('surplus-cap duplicates: the strictest wins in any order, never below maintenance, never above policy', () => {
    for (const p of permutations([115, 108, 112])) expect(caps(p.map((value) => ({ id: 'surplus-cap', value }))).maxPctTdee).toBe(108);
    expect(caps([{ id: 'surplus-cap', value: 100 }]).maxPctTdee).toBe(100);
    expect(caps([{ id: 'surplus-cap', value: 150 }]).maxPctTdee).toBe(HC.surplus.maxPctTdee);
  });

  it('every lab cap id intersects duplicates by min, floors by max, independently of order', () => {
    const capIds = Object.entries(PLANNER_LOCK_DEFS).filter(([id, d]) => d.comparator === 'cap' && id !== 'surplus-cap').map(([id]) => id);
    for (const id of capIds) {
      const vals = [7, 3, 5];
      const results = permutations(vals).map((p) => resolveLockConstraints(p.map((value) => ({ id, value }))).merged.find((m) => m.id === id)?.value);
      expect(new Set(results), id).toEqual(new Set([3]));
    }
    for (const id of ['carb-floor', 'protein-floor']) {
      const results = permutations([0.9, 1.4, 1.1]).map((p) => resolveLockConstraints(p.map((value) => ({ id, value }))).merged.find((m) => m.id === id)?.value);
      expect(new Set(results), id).toEqual(new Set([1.4]));
    }
  });

  it('screening caps no longer keep the first duplicate (deficit cap, longest fast): the strictest applies', () => {
    for (const p of permutations([15, 10, 20])) expect(caps(p.map((value) => ({ id: 'deficit-cap', value }))).deficitCapPct).toBe(10);
    for (const p of permutations([36, 24, 48])) expect(caps(p.map((value) => ({ id: 'max-fast', value }))).maxFastH).toBeLessThanOrEqual(24);
  });

  it('unknown units, non-finite and missing values need review; nothing is silently reinterpreted', () => {
    const c = caps([
      { id: 'fat-cap', value: 30, unit: 'g/d' },
      { id: 'caffeine-cap', value: Number.NaN },
      { id: 'alcohol-cap' },
      { id: 'creatine-cap', value: Number.POSITIVE_INFINITY },
    ]);
    expect(c.constraints.review.map((r) => `${r.id}:${r.reason}`).sort()).toEqual([
      'alcohol-cap:missingOrNonFiniteValue',
      'caffeine-cap:missingOrNonFiniteValue',
      'creatine-cap:missingOrNonFiniteValue',
      'fat-cap:unknownUnit',
    ]);
    expect(c.fatMaxPctEnergy).toBeNull();
    expect(c.caffeineMaxMgPerDay).toBeNull();
  });

  it('a cap below a floor is a conflict with both units and values (lock vs lock and lock vs the HC-M3 policy floor)', () => {
    const c = caps([
      { id: 'protein-floor', value: 1.6, source: 'clinician' },
      { id: 'protein-cap', value: 1.2, source: 'clinician' },
    ]);
    expect(c.constraints.conflicts).toHaveLength(1);
    expect(c.constraints.conflicts[0]!.cap.value).toBe(1.2);
    expect(c.constraints.conflicts[0]!.floor.value).toBe(1.6);
    expect(c.constraints.conflicts[0]!.cap.unit).toBe('g/kg/d');
    const f = caps([{ id: 'fat-cap', value: 10 }]);
    expect(f.constraints.conflicts.map((x) => [x.cap.id, x.floor.id, x.cap.value, x.floor.value])).toEqual([['fat-cap', 'HC-M3', 10, HC.fat.minPctEnergy]]);
  });

  it('current production marker locks: TG fat cap 30 %E and a caffeine mg/day cap are typed and enforceable', () => {
    const c = caps([
      { id: 'fat-cap', value: 30, unit: '%E', source: 'marker', mandatory: true },
      { id: 'caffeine-cap', value: 200, unit: 'mg/d', source: 'marker', mandatory: true },
    ]);
    expect(c.fatMaxPctEnergy).toBe(30);
    expect(c.caffeineMaxMgPerDay).toBe(200);
    const fat = c.constraints.merged.find((m) => m.id === 'fat-cap')!;
    expect([fat.quantity, fat.unit, fat.comparator, fat.window.kind, fat.mandatory, fat.zeroDenominator]).toEqual(['fatPctEnergy', '%E', 'cap', 'day', true, 'notApplicable']);
  });

  it('no enforcement sentence is written at compile time for food-quality locks (only after a final check)', () => {
    const c = caps([
      { id: 'satfat-cap', value: 7 },
      { id: 'alcohol-cap', value: 0 },
      { id: 'caffeine-cap', value: 200 },
      { id: 'potassium-supp-cap', value: 0 },
      { id: 'fat-cap', value: 30 },
      { id: 'added-sugar-cap', value: 5 },
    ]);
    const text = c.reasons.join(' ');
    expect(text).not.toMatch(/kept under|kept to|adds no alcohol/);
    for (const r of c.reasons) expect(r).not.toMatch(/W-L|R13|§|cap\b/);
    // the bounds themselves are typed and kept
    expect(c.constraints.merged.filter((m) => m.source.kind === 'marker').map((m) => m.id).sort()).toEqual(['added-sugar-cap', 'alcohol-cap', 'caffeine-cap', 'fat-cap', 'potassium-supp-cap', 'satfat-cap']);
  });

  it('a user-entered lock is optional; clinician, marker and screening locks are mandatory by default', () => {
    const r = resolveLockConstraints([
      { id: 'caffeine-cap', value: 300, source: 'user' },
      { id: 'creatine-cap', value: 3, source: 'clinician' },
      { id: 'carb-floor', value: 80 },
    ]);
    expect(Object.fromEntries(r.merged.filter((m) => m.source.kind !== 'policy').map((m) => [m.id, m.mandatory]))).toEqual({ 'caffeine-cap': false, 'creatine-cap': true, 'carb-floor': true });
  });
});

describe('baseline freshness, fasting eligibility and medication changes (D7-05, D7-09)', () => {
  // D4-05: fasting glucose needs a target (no open-ended minimisation); the lab-baseline rules are tested on a target goal
  const FPG = { metric: 'fastingGlucose' as const, direction: 'target' as const, target: 5.2 };
  const FAT = { metric: 'fatMass' as const, direction: 'minimise' as const };
  const withLabs = (labMeta: PersonProfile['labMeta'], medications?: PersonProfile['medications']): PersonProfile => ({
    ...MAN_95,
    labs: { fastingGlucoseMmolL: 5.9, ldlMmolL: 3.4 },
    labMeta,
    ...(medications ? { medications } : {}),
  });

  it('an expired baseline stops quantitative use (Repeat due) while the reading, other goals and every safety lock stay (D7-05)', () => {
    const p = withLabs({ fastingGlucoseMmolL: { source: 'marker', measuredOn: '2025-09-01', freshness: 'expired', fastingStatus: 'fasting' } });
    expect(labBaselineForecastIssue(p, 'fastingGlucose')).toEqual({ issue: 'stale', date: '2025-09-01' });
    const ctx = compileRequest(request(p, [FPG, FAT], { safety: { plannerLocks: [{ id: 'carb-floor', value: 100, source: 'marker', mandatory: true }, { id: 'protein-cap', value: 1.3, source: 'marker', mandatory: true }] } }));
    expect(ctx.goals.map((g) => g.metric)).toEqual(['fatMass']);
    expect(ctx.problems.join(' ')).toMatch(/out of date \(Repeat due\)/);
    // expiry never erases a safety bound: a lock from a prior abnormal reading stays typed and mandatory
    expect(ctx.caps.constraints.merged.find((m) => m.id === 'protein-cap')).toMatchObject({ value: 1.3, mandatory: true });
    expect(ctx.caps.carbFloorG).toBeGreaterThanOrEqual(100);
    // the measured value itself is untouched
    expect(ctx.request.profile.labs?.fastingGlucoseMmolL).toBe(5.9);
    // a repeat that is merely due keeps the baseline usable
    expect(labBaselineForecastIssue(withLabs({ fastingGlucoseMmolL: { source: 'marker', freshness: 'repeatDue', fastingStatus: 'fasting' } }), 'fastingGlucose')).toBeNull();
  });

  it('a non-fasting glucose sample is no fasting-glucose baseline; unknown fasting status stays a labelled scenario (D7-09)', () => {
    expect(labBaselineForecastIssue(withLabs({ fastingGlucoseMmolL: { source: 'manual', fastingStatus: 'nonFasting' } }), 'fastingGlucose')).toEqual({ issue: 'nonFastingSample' });
    expect(labBaselineForecastIssue(withLabs({ fastingGlucoseMmolL: { source: 'manual', fastingStatus: 'fasting', fastingHours: 6 } }), 'fastingGlucose')).toEqual({ issue: 'nonFastingSample' });
    expect(labBaselineForecastIssue(withLabs({ fastingGlucoseMmolL: { source: 'manual', fastingStatus: 'fasting', fastingHours: 10 } }), 'fastingGlucose')).toBeNull();
    expect(labBaselineForecastIssue(withLabs({ fastingGlucoseMmolL: { source: 'manual', fastingStatus: 'unknown' } }), 'fastingGlucose')).toBeNull();
    expect(labBaselineForecastIssue(withLabs(undefined), 'fastingGlucose')).toBeNull();
    // the sample's eligibility concerns the fasting-glucose goal only
    expect(labBaselineForecastIssue(withLabs({ fastingGlucoseMmolL: { source: 'manual', fastingStatus: 'nonFasting' } }), 'ldl')).toBeNull();
  });

  it('a glucose-lowering medication change on or after the sample segments the baseline: no causal credit or target for glycaemic goals (D7-09)', () => {
    const meta = { fastingGlucoseMmolL: { source: 'marker' as const, measuredOn: '2026-08-01', fastingStatus: 'fasting' as const } };
    const after = withLabs(meta, [{ id: 'm1', medicationClass: 'metformin', change: 'start', date: '2026-09-10' }]);
    expect(labBaselineForecastIssue(after, 'fastingGlucose')).toEqual({ issue: 'medicationChange', date: '2026-09-10' });
    expect(labBaselineForecastIssue(after, 'insulinSensitivity')).toEqual({ issue: 'medicationChange', date: '2026-09-10' });
    const ctx = compileRequest(request(after, [FPG, FAT]));
    expect(ctx.goals.map((g) => g.metric)).toEqual(['fatMass']);
    expect(ctx.problems.join(' ')).toMatch(/glucose-lowering medication changed on 2026-09-10/);
    // a change before the sample: the baseline reflects the current treatment
    expect(labBaselineForecastIssue(withLabs(meta, [{ id: 'm0', medicationClass: 'metformin', change: 'start', date: '2025-01-10' }]), 'fastingGlucose')).toBeNull();
    // no dated sample: a stable treatment cannot be assumed
    expect(labBaselineForecastIssue(withLabs(undefined, [{ id: 'm2', medicationClass: 'glp1', change: 'doseChange', date: '2024-03-01' }]), 'fastingGlucose')?.issue).toBe('medicationChange');
    // a non-glycaemic class does not touch glycaemic goals, and glycaemic changes do not touch other goals
    expect(labBaselineForecastIssue(withLabs(meta, [{ id: 'm3', medicationClass: 'statin', change: 'start', date: '2026-09-10' }]), 'fastingGlucose')).toBeNull();
    expect(labBaselineForecastIssue(after, 'ldl')).toBeNull();
  });
});
