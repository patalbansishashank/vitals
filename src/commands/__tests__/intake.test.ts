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
  it('rejects edits that break a linked habitual cardio source before either document commits', async () => {
    const row = { id: 'air-bike-report', label: 'air bike', intensity: 'moderate' as const, minPerWeek: 90 };
    const cardio = { modality: 'cycle' as const, sessionsPerWeek: 6, minutesPerSession: 15, weekdays: [0, 1, 2, 3, 4, 5], source: 'userReport' as const, recreationSourceId: row.id };
    expect((await dispatch('intake.answer', { section: 'activity', answers: { recreation: [row] } })).ok).toBe(true);
    expect((await dispatch('profile.patch', { habits: { habitualCardio: cardio } })).ok).toBe(true);
    await settleCommits();
    const revision = useProfileStore.getState().revision;

    const badProfile = await dispatch('profile.patch', { habits: { habitualCardio: { ...cardio, minutesPerSession: 16 } } });
    expect(badProfile.ok ? null : badProfile.error).toMatchObject({ code: 'invalid_input', detail: { path: '/habits/habitualCardio/recreationSourceId' } });
    expect(useProfileStore.getState().revision).toBe(revision);
    expect(simulatorProfileNow().habits?.habitualCardio?.minutesPerSession).toBe(15);

    const badIntake = await dispatch('intake.answer', { section: 'activity', answers: { recreation: [{ ...row, minPerWeek: 95 }] } });
    expect(badIntake.ok ? null : badIntake.error).toMatchObject({ code: 'invalid_input', detail: { path: '/answers/recreation' } });
    expect(outputOf(await dispatch('intake.get', { section: 'activity' }))?.sections.activity).toMatchObject({ recreation: [row] });
    expect(useProfileStore.getState().habits.activity?.recreation).toEqual([row]);

    expect((await dispatch('profile.patch', { habits: { habitualCardio: null } })).ok).toBe(true);
    expect((await dispatch('intake.answer', { section: 'activity', answers: { recreation: [{ ...row, minPerWeek: 95 }] } })).ok).toBe(true);
  });

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
    const bad = await dispatch('intake.answer', { section: 'activity', answers: { work: 'spaceship' } });
    expect(bad.ok ? null : bad.error).toMatchObject({ code: 'invalid_input', detail: { path: '/answers/work' } });
    // the devices section went with the devices chapter
    const devices = await dispatch('intake.answer', { section: 'devices' as never, answers: { has: ['ring'] } });
    expect(devices.ok ? null : devices.error.code).toBe('invalid_input');
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
