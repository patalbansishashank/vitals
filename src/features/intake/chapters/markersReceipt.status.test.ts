/**
 * D7-06/D7-09: a fasting glucose or insulin reading without a stated fasting sample reads "Fasting unknown"; its value is
 * kept and never classified as a fasting value. A stated status, hours or the legacy flag settle it either way.
 */
import { describe, expect, it } from 'vitest';
import { fastingUnknown } from './markersReceipt';

describe('fasting state of glycaemic readings (D7-06/D7-09)', () => {
  it('unknown without any stated fasting fact', () => {
    expect(fastingUnknown({ id: 'fpg' })).toBe(true);
    expect(fastingUnknown({ id: 'insulin', fastingStatus: 'unknown' })).toBe(true);
  });

  it('known with a status, hours or the legacy flag, and never asked of other markers', () => {
    expect(fastingUnknown({ id: 'fpg', fasting: true })).toBe(false);
    expect(fastingUnknown({ id: 'fpg', fasting: false })).toBe(false);
    expect(fastingUnknown({ id: 'fpg', fastingHours: 10 })).toBe(false);
    expect(fastingUnknown({ id: 'insulin', fastingStatus: 'nonFasting' })).toBe(false);
    expect(fastingUnknown({ id: 'ldl' })).toBe(false);
  });
});
