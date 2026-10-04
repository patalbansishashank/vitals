/**
 * Q4-17: quiet mode is the synced `settings.quietMode` (SUITE_SPEC §3.7). Turning it on through `settings.update` (the
 * Settings switch and Living's `setQuietMode`) persists it in the `settings` document and the living view goes quiet
 * (no numeric scores, no energy left), which is what the screens and the Coach briefing read; off restores the numbers.
 * The Coach can't change it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { PersonProfile } from '@/engine';
import { DEFAULT_ITEM_WEIGHTS, type PlanDoc, type PlanVersionDoc } from '@/living';
import { mintWriteToken } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import { useSettingsStore } from '@/state/settingsStore';
import { safetyLoosening } from '@/ai/coach/tools';
import { buildBriefing } from '@/ai/coach/briefing';
import { createCommandLivingActions } from '@/features/living/data/commands';
import { seedClearedSafety, STANDARD_ANSWERS } from '@/features/onboarding/testing';
import { dispatch } from '..';
import { AI, freshState } from './harness';

const PLAN_ID = '01JABCDEFGHJKMNPQRSTVWXYZ0';
const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 90 }, startDate: '2026-09-28' };

async function seedPlan() {
  const plan: PlanDoc = {
    name: 'Medium plan', rung: 'medium', origin: { kind: 'planner', requestHash: 'h', runAt: '2026-09-27T10:00:00.000Z' }, status: 'active',
    startDate: '2026-09-28', plannedEndDate: '2026-10-26', request: { profile: MAN, goals: [], horizonDays: 28 }, baselineProfile: MAN, headVersion: 1,
    pauses: [], intentions: {}, policy: { checkInWeekday: 0, autoApplyLoadLowering: true }, createdAt: '2026-09-27T10:00:00.000Z',
  } as unknown as PlanDoc;
  const day = { id: 'A', label: 'day', energy: { kind: 'kcal' as const, kcal: 2000 }, macros: { protein: { unit: 'g' as const, value: 150 }, carbs: { unit: 'g' as const, value: 200 }, fat: { unit: 'remainder' as const } }, steps: 8000 };
  const version = {
    planId: PLAN_ID, version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0,
    schedule: { schemaVersion: 1, startDate: '2026-09-28', horizonDays: 28, programs: [day], days: Array.from({ length: 28 }, () => ({ program: 0 })) },
    genome: null, sessions: {}, sensitivities: { planVersion: 'v1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} },
    forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] }, explanation: [],
    provenance: { engineVersion: 'e', registryHash: 'r', catalogueVersion: 'c' }, createdBy: { kind: 'system' }, createdAt: '2026-09-27T10:00:00.000Z',
  } as unknown as PlanVersionDoc;
  const store = getDocumentStore();
  await store.ready;
  await store.transact(mintWriteToken('migration', { label: 'test seed' }), async (tx) => {
    await tx.put('plans', { ...plan, _id: PLAN_ID });
    await tx.append('planVersions', { ...version, _id: `${PLAN_ID}:v1` });
    await tx.put('activePlan', { _id: 'me', planId: PLAN_ID, since: '2026-09-28' });
  });
}

beforeEach(() => {
  freshState({ cleared: true });
});

interface View { quietMode: boolean; remaining: unknown; adherence: { today: unknown; a7: unknown } }
async function todayView(): Promise<View> {
  const r = await dispatch('today.get', { date: '2026-10-01' });
  if (!r.ok || !('output' in r)) throw new Error(JSON.stringify(r));
  return r.output as View;
}

describe('quiet mode (Q4-17)', () => {
  it('on persists in the settings document and quiets the living view and the Coach briefing; off restores', async () => {
    await seedPlan();
    expect((await todayView()).quietMode).toBe(false);

    const on = await dispatch('settings.update', { patch: { quietMode: true } });
    expect(on.ok).toBe(true);
    expect(useSettingsStore.getState().quietMode).toBe(true);
    expect(getDocumentStore().peek<{ quietMode?: boolean }>('settings', 'me')?.quietMode).toBe(true);
    const quiet = await todayView();
    expect(quiet.quietMode).toBe(true);
    expect(quiet.remaining).toBeNull();
    expect(quiet.adherence.today).toBeNull();
    const b = buildBriefing({ todayView: quiet, safety: { mode: 'G' } } as never);
    expect(b.quiet).toBe(true);
    expect(b.text).toContain('Quiet mode: no calorie talk');
    expect(b.text).not.toContain('Remaining today');

    await dispatch('settings.update', { patch: { quietMode: false } });
    expect(getDocumentStore().peek<{ quietMode?: boolean }>('settings', 'me')?.quietMode).toBe(false);
    const loud = await todayView();
    expect(loud.quietMode).toBe(false);
    expect(loud.remaining).not.toBeNull();
    expect(buildBriefing({ todayView: loud } as never).quiet).toBe(false);
  }, 20_000);

  it('Living’s setQuietMode switches it (no longer "not available yet")', async () => {
    const actions = createCommandLivingActions({} as never);
    expect(await actions.setQuietMode(true)).toMatchObject({ ok: true });
    expect(useSettingsStore.getState().quietMode).toBe(true);
    expect(await actions.setQuietMode(false)).toMatchObject({ ok: true });
    expect(useSettingsStore.getState().quietMode).toBe(false);
  });

  it('the Coach cannot change it', async () => {
    expect(safetyLoosening('settings.update', { patch: { quietMode: false } }, 'write')).toMatch(/only changed by you/);
    const r = await dispatch('settings.update', { patch: { quietMode: true } }, { actor: AI });
    expect(r.ok).toBe(false);
    expect(useSettingsStore.getState().quietMode).toBe(false);
  });
});

describe('quiet mode is on by default in safety mode R1 (SUITE_SPEC §3.7)', () => {
  const R1 = { ...STANDARD_ANSWERS, eatingDisorder: 'yes' } as const;
  const settings = async () => {
    const r = await dispatch('settings.get', {});
    if (!r.ok || !('output' in r)) throw new Error(JSON.stringify(r));
    return r.output as { quietMode: boolean };
  };

  it('R1 and never set: on in settings.get, today.get and the Coach briefing', async () => {
    seedClearedSafety(R1);
    await seedPlan();
    expect(useSettingsStore.getState().quietModeSet).toBe(false);
    expect((await settings()).quietMode).toBe(true);
    const view = await todayView();
    expect(view.quietMode).toBe(true);
    expect(view.remaining).toBeNull();
    expect(buildBriefing({ todayView: view } as never).quiet).toBe(true);
  }, 20_000);

  it('R1 and turned off by the person: off, and the choice is synced', async () => {
    seedClearedSafety(R1);
    await seedPlan();
    expect((await dispatch('settings.update', { patch: { quietMode: false } })).ok).toBe(true);
    expect(getDocumentStore().peek<{ quietModeSet?: boolean }>('settings', 'me')?.quietModeSet).toBe(true);
    expect((await settings()).quietMode).toBe(false);
    const view = await todayView();
    expect(view.quietMode).toBe(false);
    expect(view.remaining).not.toBeNull();
  }, 20_000);

  it('not R1 and never set: off', async () => {
    seedClearedSafety(STANDARD_ANSWERS);
    await seedPlan();
    expect((await settings()).quietMode).toBe(false);
    expect((await todayView()).quietMode).toBe(false);
  }, 20_000);

  it('the Coach cannot turn the R1 default off', async () => {
    seedClearedSafety(R1);
    expect((await dispatch('settings.update', { patch: { quietMode: false } }, { actor: AI })).ok).toBe(false);
    expect(useSettingsStore.getState().quietModeSet).toBe(false);
    expect((await settings()).quietMode).toBe(true);
  });
});
