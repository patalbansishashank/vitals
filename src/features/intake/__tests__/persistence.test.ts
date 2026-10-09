/**
 * Persistence round trip: answers → `intake.answer` (merge patches per section) → `intake/me` → turns read back; the
 * habit fields the answers set reach the profile through `profile.patch`.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { resetBusState, resetHistory } from '@/commands';
import { createDocumentStore, createMemoryBackend } from '@/store';
import { useProfileStore } from '@/state/profileStore';
import { setDocumentStore } from '@/state/runtime';
import { withSystemWrite } from '@/state/scope';
import { reduceActivity } from '../chapters/activity';
import { readIntake, turnsOf } from '../doc';
import { DEFAULT_CONTEXT } from '../flow';
import { saveChapter, settleIntakeSaves, skipChapterSave } from '../persist';
import { applyMergePatch, mergePatch, type SectionContext } from '../sections';
import type { ChapterAnswers, TurnStatus } from '../types';

const sctx: SectionContext = { ...DEFAULT_CONTEXT, india: true, safety: null, now: '2026-10-01T09:00:00.000Z' };

function turns(values: Record<string, unknown>, skipped: string[] = []): ChapterAnswers {
  const status: Record<string, TurnStatus> = {};
  for (const k of Object.keys(values)) status[k] = 'answered';
  for (const k of skipped) status[k] = 'skipped';
  return { values, status };
}

beforeEach(() => {
  localStorage.clear();
  setDocumentStore(createDocumentStore({ backend: createMemoryBackend({ device: 'TESTDEVICE000001' }), device: 'TESTDEVICE000001' }));
  resetHistory();
  resetBusState();
  withSystemWrite(() => useProfileStore.getState().resetBody());
});

describe('merge patches', () => {
  it('nulls keys that disappear (a nested one too) and leaves equal values out', () => {
    const before = { commute: { mode: 'walk', activeMinPerWorkday: 30 }, work: 'desk', recreation: [{ label: 'x' }] };
    const after = { commute: { mode: 'passive' }, work: 'desk' };
    const patch = mergePatch(before, after);
    expect(patch).toEqual({ commute: { mode: 'passive', activeMinPerWorkday: null }, recreation: null });
    expect(applyMergePatch(before, patch)).toEqual(after);
  });
});

describe('round trip through intake.answer', () => {
  it('saves the activity section and its turns, stamps it, and writes the habit fields on the profile', async () => {
    const a = turns({ work: 'yes', job: 'desk', workTime: { days: 5, hours: 8 }, commute: 'walk', commuteMin: 30, stepsKnown: 'roughly', stepsRough: 6000, trainNow: '1-2', sleep: { bed: 22, wake: 6 } });
    await saveChapter('activity', a, sctx);
    await settleIntakeSaves();
    const doc = readIntake();
    const { turns: stored, ...activity } = doc.activity!;
    expect(activity).toEqual(reduceActivity(a, DEFAULT_CONTEXT).activity);
    expect(stored).toEqual(a);
    expect(turnsOf(doc, 'activity')).toEqual(a);
    expect(doc.answeredAt.activity).toBeTruthy();
    expect(doc.questionSetVersion.activity).toBe(2);
    expect(useProfileStore.getState().habits).toMatchObject({ typicalSteps: 6000, sessionsPerWeek: 2, bedTimeH: 22, wakeTimeH: 6 });

    // change: ride instead of walking → the minutes go away in the stored document too
    const b = turns({ ...a.values, commute: 'ride' });
    await saveChapter('activity', b, sctx, { habitsNow: useProfileStore.getState().habits as Record<string, unknown> });
    await settleIntakeSaves();
    expect(readIntake().activity?.commute).toEqual({ mode: 'passive' });
    expect(turnsOf(readIntake(), 'activity').values.commuteMin).toBe(30); // kept, "not used"

    // "I don't know my steps" clears the stale rough tick
    await saveChapter('activity', turns({ ...b.values, stepsKnown: 'no' }), sctx, { habitsNow: useProfileStore.getState().habits as Record<string, unknown> });
    await settleIntakeSaves();
    expect(useProfileStore.getState().habits.typicalSteps).toBeUndefined();
    expect(readIntake().activity?.steps).toEqual({ source: 'unknown' });
  });

  it('food: the diet appears only when the rules are answered, and goes again if they are reopened and skipped', async () => {
    const base = { eat: { preset: 'jain', foods: ['dairy'] }, allergies: ['none'], rules: ['jain'], jain: ['noRootVeg', 'noOnionGarlic'] };
    await saveChapter('food', turns({ eat: base.eat }), sctx);
    await settleIntakeSaves();
    expect(readIntake().diet).toMatchObject({ rulesComplete: false });
    expect((readIntake().diet as { animalFoods?: unknown }).animalFoods).toBeUndefined();

    await saveChapter('food', turns(base), sctx);
    await settleIntakeSaves();
    const diet = readIntake().diet;
    expect(diet?.rulesComplete).toBe(true);
    if (!diet?.rulesComplete) throw new Error('diet expected');
    expect(diet.jain).toMatchObject({ noRootVeg: true, noOnionGarlic: true });
    expect(readIntake().kitchen?.equipment).toEqual(['pressure_cooker', 'tawa', 'kadhai', 'gas_2burner', 'fridge']);
    expect(readIntake().supplements).toEqual({ _v: 2, stance: 'food_first', rows: [] });
    expect(useProfileStore.getState().habits.dietAnimalLevel).toBe('vegetarian');

    await saveChapter('food', turns({ eat: base.eat, rules: ['jain'], jain: base.jain }, ['allergies']), sctx);
    await settleIntakeSaves();
    const again = readIntake().diet as unknown as Record<string, unknown>;
    expect(again.rulesComplete).toBe(false);
    expect(again.animalFoods).toBeUndefined();
    expect(again.jain).toBeUndefined();
  });

  it('training and devices round trip; "Skip this part" marks the sections skipped', async () => {
    await skipChapterSave('training', { values: {}, status: { experience: 'skipped' }, skippedAll: true }, sctx);
    await settleIntakeSaves();
    const doc = readIntake();
    expect(doc.skipped?.training).toBeTruthy();
    expect(doc.training).toMatchObject({ skill: 2, owned: [], prefs: { daysPerWeek: 3, minPerSession: 30 } });
    expect(turnsOf(doc, 'training').skippedAll).toBe(true);

    await saveChapter('devices', turns({ has: ['scale'], models: { scale: 'Withings' }, platform: 'ios', routes: 'seen', streams: [{ stream: 'weight', imported: true, scores: false, engine: true, coach: 'hidden' }] }), sctx);
    await settleIntakeSaves();
    expect(readIntake().devices).toMatchObject({
      has: ['scale'],
      models: ['Withings'],
      platforms: ['ios'],
      streams: [
        { stream: 'weight', imported: true, scores: false, engine: true, coach: 'hidden' },
        { stream: 'body_fat', imported: false, scores: false, engine: false, coach: 'hidden' },
      ],
    });
  });

  it('a measured resting energy from a breath test becomes the profile lab value, through intake.answer', async () => {
    const m = turns({ measuredEver: 'rmr', measured: { value: 1720, unit: 'kcal', method: 'metabolic_cart', date: '2026-03' } });
    await saveChapter('activity', m, sctx);
    await settleIntakeSaves();
    expect(useProfileStore.getState().labs.measuredRmrKcal).toBe(1720);
    expect(readIntake().activity?.measured).toEqual({ kind: 'rmr', value: 1720, unit: 'kcal', method: 'metabolic_cart', date: '2026-03' });
    // the engine's activity intake never carries the measured figure
    expect((useProfileStore.getState().habits.activity as Record<string, unknown> | undefined)?.measured).toBeUndefined();

    // changed to a calculator figure: stored and shown, and the lab value the intake wrote is cleared
    await saveChapter('activity', turns({ measuredEver: 'rmr', measured: { value: 1720, unit: 'kcal', method: 'calculator' } }), sctx);
    await settleIntakeSaves();
    expect(useProfileStore.getState().labs.measuredRmrKcal).toBeUndefined();
    expect(readIntake().activity?.measured?.method).toBe('calculator');
  });

  it('a lab value typed on Your body is never cleared by the intake', async () => {
    useProfileStore.getState().setLabs({ measuredRmrKcal: 1650 });
    expect(useProfileStore.getState().labs.measuredRmrKcal).toBe(1650);
    await saveChapter('activity', turns({ measuredEver: 'no' }), sctx);
    await settleIntakeSaves();
    expect(useProfileStore.getState().labs.measuredRmrKcal).toBe(1650);
  });
});
