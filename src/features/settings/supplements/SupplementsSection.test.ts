/**
 * D7-03: Settings › Supplements summarises the shared policy status of the rows the person takes with one word, worst
 * first (Review, then Unchecked, then Caution); taking stays recordable.
 */
import { describe, expect, it } from 'vitest';
import { foodSafetyInput } from '@/features/living/food/profile';
import { takingCaution } from '@/features/living/food/supplements';
import { takingStatusWord } from './SupplementsSection';

describe('Settings › Supplements status word (D7-03)', () => {
  it('reads the worst status of the taking rows, or nothing when all are clear', () => {
    expect(takingStatusWord([null, 'Unchecked · kidney disease (not answered)', 'Review · kidney disease'])).toBe('Review');
    expect(takingStatusWord(['Caution · bowel obstruction (not asked)', 'Unchecked'])).toBe('Unchecked');
    expect(takingStatusWord([null, null])).toBeNull();
  });

  it('comes from the shared policy: kidney disease on the screening puts creatine in Review', () => {
    const kidney = foodSafetyInput({ answers: { conditions: 'yes', conditionItems: ['kidney'] }, profile: { safetyFlags: [] } });
    expect(takingStatusWord([takingCaution('creatine', kidney)])).toBe('Review');
    const clear = foodSafetyInput({ answers: { conditions: 'no' }, profile: { safetyFlags: [] } });
    expect(takingStatusWord([takingCaution('creatine', clear)])).toBeNull();
  });
});
