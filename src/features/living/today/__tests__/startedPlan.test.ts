import { describe, expect, it } from 'vitest';
import { todayState } from '../model';
import { planOn } from '../../mode';

const plan = (startDate: string, status: 'scheduled' | 'active' | 'paused' = 'scheduled') => ({ status, startDate, plannedEndDate: '2026-12-31', pauses: [] });

describe('a plan stored as scheduled', () => {
  it('is running once its start date has come (started yesterday)', () => {
    expect(todayState(null, plan('2026-10-07'), '2026-10-08', '2026-10-08')).toBe('active');
    expect(planOn(plan('2026-10-07'), '2026-10-08').status).toBe('active');
    expect(planOn(plan('2026-10-08'), '2026-10-08').status).toBe('active');
  });
  it('stays a preview before its start date', () => {
    expect(todayState(null, plan('2026-10-09'), '2026-10-08', '2026-10-08')).toBe('scheduled');
    expect(planOn(plan('2026-10-09'), '2026-10-08').status).toBe('scheduled');
  });
  it('leaves a paused plan paused', () => {
    expect(planOn(plan('2026-10-01', 'paused'), '2026-10-08').status).toBe('paused');
  });
});
