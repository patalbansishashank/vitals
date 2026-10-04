// @vitest-environment node
/**
 * Smoke test through the real loop (other modules may still be stubs holding safe defaults): the module runs inside the
 * ordered registry, respects the wiring check and records finite series. Physics is tested in the other files.
 */
import { runEngine } from '../../../core/loop';
import { compileSchedule } from '../../../core/compileSchedule';
import { resolveProfile } from '../../../core/resolveProfile';
import { checkWiring } from '../../../core/moduleRegistry';
import { MAN, repeatSchedule } from '../../../core/__tests__/fixtures';
import { wellbeingModule } from '../index';

describe('wellbeing inside the engine loop', () => {
  it('has no wiring issue and records finite daily series for 60 days (burn-in on and off)', () => {
    expect(checkWiring().issues.filter((i) => i.module === 'wellbeing')).toEqual([]);
    const profile = resolveProfile(MAN);
    const sched = compileSchedule(repeatSchedule(60, [0, 1, 0, 1, 0, 1, 1]), profile);
    for (const burnInDays of [14, 0]) {
      const r = runEngine(profile, sched, { record: 'daily', burnInDays });
      for (const id of wellbeingModule.records) {
        const a = r.daily[id];
        expect(a).toBeDefined();
        expect(a).toHaveLength(60);
        for (let d = 0; d < 60; d++) expect(Number.isFinite(a![d]!)).toBe(true);
      }
      expect(r.daily.moodTier![59]).toBeGreaterThanOrEqual(0);
      expect(r.daily.moodTier![59]).toBeLessThanOrEqual(2);
      expect(r.daily.micronutrientScore![59]).toBeLessThanOrEqual(100);
    }
  });
});
