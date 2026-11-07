/**
 * D7-04: a taken product's row says what one occasion carries — the known active amount from its label ("200 mg elemental
 * magnesium") — or "Dose unknown" when the potency is not known (a valid record whose safety is Unchecked, never a pass).
 * A dose already typed in the active's own unit is not repeated.
 */
import { describe, expect, it } from 'vitest';
import type { SupplementRow } from '@/catalogues/supplements';
import { DOSE_UNKNOWN, activeText } from './SupplementRow';

const row = (over: Partial<SupplementRow>): SupplementRow => ({ supplementId: 'magnesium', state: 'taking', timesOfDay: ['evening'], ...over });

describe('supplement row active amounts (D7-04)', () => {
  it('reads the label’s elemental amount per occasion', () => {
    const r = row({
      dose: 2,
      unit: 'tablets',
      product: { servingAmount: 1, servingUnit: 'tablets', actives: [{ ingredient: 'magnesium', amount: 100, unit: 'mg', basis: 'elemental' }] },
    });
    expect(activeText(r)).toBe('200 mg elemental magnesium');
  });

  it('an unknown potency reads "Dose unknown"', () => {
    const r = row({ dose: 2, unit: 'tablets', product: { servingAmount: 1, servingUnit: 'tablets', actives: [{ ingredient: 'magnesium', amount: null, unit: 'mg', basis: 'elemental' }] } });
    expect(activeText(r)).toBe(DOSE_UNKNOWN);
  });

  it('a dose typed in the active’s unit is not repeated, and a row not taken says nothing', () => {
    expect(activeText(row({ dose: 200, unit: 'mg' }))).toBeNull();
    expect(activeText(row({ state: 'onHand', dose: 2, unit: 'tablets' }))).toBeNull();
  });
});
