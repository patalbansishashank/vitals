/** `intake.answer`: per-section validation, derived habit fields (one change), and the maintenance explanation. */
import { beforeEach, describe, expect, it } from 'vitest';
import { getDocumentStore } from '@/state/runtime';
import { useProfileStore } from '@/state/profileStore';
import { simulatorProfileNow } from '@/state/internal/simulatorProfile';
import { dispatch, outputOf, settleCommits } from '..';
import { freshState } from './harness';

beforeEach(() => {
  freshState({ cleared: true });
});

const desk = { work: 'desk', turns: { values: { work: 'desk' }, status: { work: 'answered' } } };

describe('intake.answer', () => {
  it('writes the activity intake into the profile habits in the same change, so every screen resolves the same maintenance', async () => {
    const r = await dispatch('intake.answer', { section: 'activity', answers: desk });
    expect(r.ok).toBe(true);
    await settleCommits();
    expect(useProfileStore.getState().habits.activity).toMatchObject({ work: 'desk' });
    expect(useProfileStore.getState().habits.activity).not.toHaveProperty('turns');
    expect(simulatorProfileNow().habits?.activity).toMatchObject({ work: 'desk' });
    expect(getDocumentStore().peek<{ habits: { activity?: unknown } }>('profile', 'me')?.habits.activity).toMatchObject({ work: 'desk' });
    expect(r.ok && 'changeSet' in r && r.changeSet?.docs.map((d) => d.col).sort()).toEqual(['intake', 'profile']);
    // undo takes both back
    await dispatch('history.undo', { changeSetId: r.ok && 'changeSet' in r ? r.changeSet!.id : '' });
    expect(useProfileStore.getState().habits.activity).toBeUndefined();
  });

  it('validates the merged section against its schema', async () => {
    const bad = await dispatch('intake.answer', { section: 'devices', answers: { has: ['spaceship'] } });
    expect(bad.ok ? null : bad.error).toMatchObject({ code: 'invalid_input', detail: { path: '/answers/has/0' } });
    const diet = await dispatch('intake.answer', { section: 'diet', answers: { rulesComplete: true } });
    expect(diet.ok ? null : diet.error.code).toBe('invalid_input');
    expect((await dispatch('intake.answer', { section: 'diet', answers: { rulesComplete: false } })).ok).toBe(true);
  });

  it('explains maintenance with its drivers, assumed parts and activity level', async () => {
    await dispatch('profile.patch', { sex: 'female', ageYears: 40, heightCm: 165, weightKg: 68 });
    await dispatch('intake.answer', { section: 'activity', answers: desk });
    const ex = outputOf(await dispatch('profile.explainMaintenance', {}))!;
    expect(ex.drivers.length).toBeGreaterThan(3);
    expect(Math.abs(ex.drivers.reduce((s, d) => s + d.kcal, 0) - ex.tdee0Kcal)).toBeLessThanOrEqual(ex.drivers.length);
    expect(ex.band80[0]).toBeLessThan(ex.tdee0Kcal);
    expect(Array.isArray(ex.defaulted)).toBe(true);
    expect(['ok', 'high', 'capped']).toContain(ex.palFlag);
  });
});
