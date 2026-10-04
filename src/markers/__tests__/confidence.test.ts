// @vitest-environment node
/** One pair of confidence cut-offs (`CONFIDENCE`) read by the extractor's documentation and the review table's chip. */
import { describe, expect, it } from 'vitest';
import { confidenceLevel } from '@/features/intake/chapters/markers';
import { CONFIDENCE } from '../types';

describe('confidence cut-offs', () => {
  it('are the extractor\'s documented values: high ≥ 0.9, medium ≥ 0.7', () => {
    expect(CONFIDENCE).toEqual({ high: 0.9, medium: 0.7 });
    expect(confidenceLevel(1)).toBe('high');
    expect(confidenceLevel(0.9)).toBe('high');
    // a name matched by rule (0.85) is medium; a value printed with "<" (0.7) is medium; no unit printed (0.6) is low
    expect(confidenceLevel(0.85)).toBe('medium');
    expect(confidenceLevel(0.7)).toBe('medium');
    expect(confidenceLevel(0.6)).toBe('low');
  });
});
