/**
 * D4-07: the kidney nutrition scope reads as one short status line — Entered (with the clinician's numbers exactly as
 * entered, plus today's g/day where the basis weight is known), Review, Incomplete or Limit conflict — and nothing
 * without a kidney context. No generic renal default is ever printed.
 */
import { describe, expect, it } from 'vitest';
import type { ConstraintDef } from '@/lib/bodyContracts';
import type { RenalBound, RenalScope } from './renalScope';
import { renalBoundText, renalLine } from './SafetySummary';

const def = (over: Partial<ConstraintDef>): ConstraintDef => ({
  id: 'renal-protein',
  quantity: 'proteinPerKg',
  unit: 'g/kg/d',
  comparator: 'cap',
  value: 0.8,
  basis: 'actual',
  scope: 'total',
  window: { kind: 'day' },
  applicability: 'applicable',
  mandatory: true,
  source: { kind: 'clinician' },
  policyVersion: 1,
  ...over,
});

const bound = (d: ConstraintDef, perDay?: number): RenalBound => ({
  envelopeId: 'env-1',
  def: d,
  status: 'enforceable',
  ...(perDay !== undefined ? { perDay: { value: perDay, unit: 'g/d' as const, basis: d.basis, basisKg: 70 } } : {}),
});

const scope = (over: Partial<RenalScope>): Pick<RenalScope, 'status' | 'label' | 'bounds'> => ({ status: 'none', label: null, bounds: [], ...over });

describe('kidney nutrition status line (D4-07)', () => {
  it('says nothing without a kidney context', () => {
    expect(renalLine(scope({}))).toBeNull();
    expect(renalLine(null)).toBeNull();
  });

  it('an entered envelope prints its bounds as entered, with today’s g/day', () => {
    const line = renalLine(
      scope({
        status: 'entered',
        label: 'Entered',
        bounds: [bound(def({}), 56), bound(def({ id: 'renal-na', quantity: 'sodiumPerDay', unit: 'mg/d', value: 2000, basis: 'notApplicable' }))],
      }),
    );
    expect(line).toMatch(/^Kidney nutrition · Entered · protein ≤ 0\.8 g\/kg\/day \(56 g\/day\) · sodium ≤ 2.000 mg\/day$/);
  });

  it('a review, an incomplete context and a conflict read their word, with no numbers', () => {
    expect(renalLine(scope({ status: 'review', label: 'Review', bounds: [bound(def({}))] }))).toBe('Kidney nutrition · Review');
    expect(renalLine(scope({ status: 'incomplete', label: 'Incomplete' }))).toBe('Kidney nutrition · Incomplete');
    expect(renalLine(scope({ status: 'conflict', label: 'Review' }))).toBe('Kidney nutrition · Limit conflict');
  });

  it('a floor reads ≥ and a fluid bound keeps mL/day', () => {
    expect(renalBoundText(bound(def({ comparator: 'floor', quantity: 'fluidPerDay', unit: 'mL/d', value: 1500, basis: 'notApplicable' })))).toMatch(/^fluid ≥ 1.500 mL\/day$/);
  });
});
