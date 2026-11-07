/**
 * Audit F15: without a known body mass the activity estimators refuse (null), never an invented 75 kg. The profile read
 * is made to fail, as when the profile store cannot be read.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/state/internal/simulatorProfile', () => ({
  simulatorProfileNow: () => {
    throw new Error('profile not ready');
  },
}));

const { dispatch } = await import('@/commands');
const { freshState } = await import('@/commands/__tests__/harness');
const { personOn } = await import('../activity');

describe('F15: no invented mass', () => {
  it('personOn is null when the profile cannot be read', () => {
    expect(personOn('2026-10-20')).toBeNull();
  });

  it('a manual log is refused with a reason instead of being estimated at 75 kg', async () => {
    freshState({ cleared: true });
    const r = await dispatch('activity.logManual', { exerciseId: 'walk', date: '2026-10-19', startH: 9, durationMin: 30, intensity: { class: 'moderate' } });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe('precondition_failed');
    expect(!r.ok && r.error.message).toMatch(/body weight/);
  });
});
