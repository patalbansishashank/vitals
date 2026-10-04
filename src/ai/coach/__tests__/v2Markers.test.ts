/** Review V2 (V1e-17): a lab reading with a non-number confidence or a broken sample date never reaches the card as "NaN" or "undefined". */
import { describe, expect, it } from 'vitest';
import { markersReviewCard, reviewOf } from '../markers';

describe('markers review card input checks', () => {
  it('drops a NaN confidence and a malformed sample date', () => {
    const review = reviewOf({ extractionId: 'x1', route: 'textLayer', sampleDate: '2026-45-01', rows: [{ row: 0, nameOnReport: 'LDL', value: 3.1, unit: 'mmol/L', confidence: Number.NaN }] }, 'a1');
    expect(review).not.toBeNull();
    expect(review!.sampleDate).toBeUndefined();
    expect(review!.rows[0]!.confidence).toBe(0);
    const text = JSON.stringify(markersReviewCard('c1', review!, '2026-10-03T08:00:00Z'));
    expect(text).not.toMatch(/NaN|undefined/);
  });

  it('keeps a real sample date', () => {
    expect(reviewOf({ extractionId: 'x1', sampleDate: '2026-09-30', rows: [] }, 'a1')!.sampleDate).toBe('2026-09-30');
  });
});
