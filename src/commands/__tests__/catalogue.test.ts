/**
 * `catalogue.*`, `train.*` and `food.dayTargets` executors (I1-C): search merges the person's own items with the seed,
 * additions are idempotent by name, and `train.*` compose from the person's setup (intake + own equipment) and the
 * running plan's prescription.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersonProfile } from '@/engine';
import { DEFAULT_ITEM_WEIGHTS, type PlanDoc, type PlanVersionDoc } from '@/living';
import { mintWriteToken } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import { dispatch, getCommand, settleCommits, type CommandResult } from '..';
import { resetSetupCaches } from '../catalogue/setup';
import { AI, freshState } from './harness';

const PLAN_ID = '01JABCDEFGHJKMNPQRSTVWXYZ1';
const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 90 }, startDate: '2026-09-28' };

/** A 28-day plan: a lift on even days, a walk on odd days. 2026-10-05 is plan day 7 (odd: walk), 10-06 day 8 (lift). */
async function seedPlan(rung: 'hard' | 'medium' | 'easy' = 'medium') {
  const plan = {
    name: 'Medium plan', rung, origin: { kind: 'planner', requestHash: 'h', runAt: '2026-09-27T10:00:00.000Z' }, status: 'active',
    startDate: '2026-09-28', plannedEndDate: '2026-10-26', request: { profile: MAN, goals: [], horizonDays: 28 }, baselineProfile: MAN, headVersion: 1,
    pauses: [], intentions: {}, policy: { checkInWeekday: 0, autoApplyLoadLowering: true }, createdAt: '2026-09-27T10:00:00.000Z',
  } as unknown as PlanDoc;
  const base = { energy: { kind: 'kcal' as const, kcal: 2000 }, macros: { protein: { unit: 'g' as const, value: 150 }, carbs: { unit: 'g' as const, value: 200 }, fat: { unit: 'remainder' as const } }, steps: 8000 };
  const lift = { id: 'L', label: 'lift', ...base, exercise: [{ kind: 'resistance', startH: 18, durationMin: 50, setsByRegion: { chest: 3, upperBack: 3, quads: 4, glutes: 2 }, rir: 2, loadPct1RM: 70 }] };
  const walk = { id: 'W', label: 'walk', ...base, exercise: [{ kind: 'cardio', modality: 'walk', startH: 7, durationMin: 30, pctVo2max: 0.45 }] };
  const version = {
    planId: PLAN_ID, version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0,
    schedule: { schemaVersion: 1, startDate: '2026-09-28', horizonDays: 28, programs: [lift, walk], days: Array.from({ length: 28 }, (_, d) => ({ program: d % 2 })) },
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

function out<T>(r: CommandResult): T {
  if (!r.ok || !('output' in r)) throw new Error(`command failed: ${JSON.stringify(r)}`);
  return r.output as T;
}

const userDocs = () => getDocumentStore().peekAll<{ kind: string; key: string; ref?: string; item?: { id: string } }>('catalogueCustom');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-01T12:00:00.000Z'));
  freshState({ cleared: true });
  resetSetupCaches();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('catalogue commands are implemented', () => {
  it('replaces the catalogue and train stubs (food.* are E9b’s, src/commands/food)', () => {
    for (const id of ['catalogue.searchExercises', 'catalogue.getExercise', 'catalogue.searchFoods', 'catalogue.getFood', 'catalogue.supplements', 'catalogue.equipment', 'catalogue.equivalence', 'catalogue.addExercise', 'catalogue.addFood', 'catalogue.addEquipment', 'train.session', 'train.alternatives', 'train.shoppingList', 'food.dayTargets'])
      expect(getCommand(id)?.notImplemented, id).toBeUndefined();
  });
});

describe('search and read', () => {
  it('finds seed exercises by local name, with availability for the person', async () => {
    const r = out<Array<{ id: string; available: boolean; own: boolean }>>(await dispatch('catalogue.searchExercises', { q: 'bethak' }));
    expect(r[0]).toMatchObject({ id: 'baithak', own: false, available: true });
    const mudgar = out<Array<{ id: string; available: boolean }>>(await dispatch('catalogue.searchExercises', { q: 'mudgar swing' }));
    expect(mudgar.find((x) => x.id === 'mudgar_two_hand')?.available).toBe(false);
    const avail = out<Array<{ available: boolean }>>(await dispatch('catalogue.searchExercises', { filters: { available: true }, limit: 50 }));
    expect(avail.length).toBeGreaterThan(5);
    expect(avail.every((x) => x.available)).toBe(true);
    const bad = await dispatch('catalogue.searchExercises', { filters: { colour: 'red' } });
    expect(bad.ok).toBe(false);
  });

  it('merges the person’s own equipment and exercises into search and reads', async () => {
    const wheel = out<{ id: string; created: boolean }>(await dispatch('catalogue.addEquipment', { equipment: { name: 'Wooden wheel', patterns: ['coreAntiExtension'] } }));
    expect(wheel).toMatchObject({ id: 'user-wooden-wheel', created: true });
    await settleCommits();
    const ex = out<{ id: string; created: boolean }>(
      await dispatch('catalogue.addExercise', { exercise: { name: 'Wooden wheel rollout', description: 'kneeling rollouts on a cart wheel', pattern: 'coreAntiExtension', regions: { core: 1, shoulders: 0.5 }, equipmentAnyOf: [[wheel.id]] } }),
    );
    expect(ex.created).toBe(true);
    await settleCommits();
    const found = out<Array<{ id: string; own: boolean; available: boolean; origin: string }>>(await dispatch('catalogue.searchExercises', { q: 'wooden wheel' }));
    expect(found.find((x) => x.id === ex.id)).toMatchObject({ own: true, available: true, origin: 'user' });
    const own = out<Array<{ id: string }>>(await dispatch('catalogue.searchExercises', { filters: { origin: 'own' } }));
    expect(own.map((x) => x.id)).toEqual([ex.id]);
    const read = out<{ exercise: { id: string }; equipment: Array<{ id: string; owned: boolean; own: boolean }>; dose: { sets: number; minutes: number } }>(await dispatch('catalogue.getExercise', { id: ex.id }));
    expect(read.equipment).toEqual([expect.objectContaining({ id: wheel.id, owned: true, own: true })]);
    expect(read.dose.minutes).toBeGreaterThan(0);
    const eq = out<Array<{ id: string; owned: boolean }>>(await dispatch('catalogue.equipment', { q: 'wheel' }));
    expect(eq.find((q) => q.id === wheel.id)?.owned).toBe(true);
    expect((await dispatch('catalogue.getExercise', { id: 'no_such_thing' })).ok).toBe(false);
  });

  it('lists supplements with their evidence and the "no expected benefit" entries', async () => {
    const all = out<Array<{ kind: string; id: string; evidence?: unknown[] }>>(await dispatch('catalogue.supplements', {}));
    expect(all.filter((x) => x.kind === 'supplement')).toHaveLength(23);
    expect(all.filter((x) => x.kind === 'noExpectedBenefit')).toHaveLength(12);
    const creatine = out<Array<{ id: string; evidence: unknown[] }>>(await dispatch('catalogue.supplements', { q: 'creatine' }));
    expect(creatine[0]!.id).toBe('creatine_monohydrate');
    expect(creatine[0]!.evidence.length).toBeGreaterThan(0);
  });

  it('scores performed work against a prescription (R3 example: baithak for back squat is partial credit)', async () => {
    const r = out<{ band: string; credit: number; unresolved: string[] }>(
      await dispatch('catalogue.equivalence', {
        prescribed: { exercises: [{ exerciseId: 'bb_back_squat', setCount: 3, reps: 8 }] },
        performed: [{ exerciseId: 'baithak', setCount: 3, reps: 30 }, { freeText: 'some stretching' }],
      }),
    );
    expect(r.credit).toBeGreaterThan(0);
    expect(r.credit).toBeLessThanOrEqual(1);
    expect(r.unresolved).toEqual(['some stretching']);
    const same = out<{ band: string; parity: boolean }>(await dispatch('catalogue.equivalence', { prescribed: { exerciseId: 'baithak', setCount: 3, reps: 30 }, performed: [{ exerciseId: 'baithak', setCount: 3, reps: 30 }] }));
    expect(same).toMatchObject({ band: 'full', parity: true });
    expect((await dispatch('catalogue.equivalence', { prescribed: {}, performed: [] })).ok).toBe(false);
  });
});

describe('additions', () => {
  it('equipment: one item per name; a seed name records ownership once; AI calls need and honour a key', async () => {
    const a = out<{ id: string; created: boolean }>(await dispatch('catalogue.addEquipment', { equipment: { name: 'Sandbag I made', patterns: ['carry', 'squat'], loadKg: 15 } }));
    await settleCommits();
    const b = out<{ id: string; created: boolean }>(await dispatch('catalogue.addEquipment', { equipment: { name: '  sandbag  I MADE ' } }));
    expect(b).toEqual({ id: a.id, name: 'Sandbag I made', created: false });
    expect(userDocs()).toHaveLength(1);

    const kb = out<{ id: string; created: boolean }>(await dispatch('catalogue.addEquipment', { equipment: { name: 'kettlebell' } }));
    expect(kb).toMatchObject({ id: 'kettlebell', created: true });
    await settleCommits();
    expect(out<{ created: boolean }>(await dispatch('catalogue.addEquipment', { equipment: { name: 'Kettlebell' } })).created).toBe(false);
    expect(userDocs().filter((d) => d.ref === 'kettlebell')).toHaveLength(1);
    const eq = out<Array<{ id: string; owned: boolean }>>(await dispatch('catalogue.equipment', { q: 'kettlebell' }));
    expect(eq.find((q) => q.id === 'kettlebell')?.owned).toBe(true);

    expect((await dispatch('catalogue.addEquipment', { equipment: { name: 'Rope' } }, { actor: AI })).ok).toBe(false); // AI needs a key
    const k1 = await dispatch('catalogue.addEquipment', { equipment: { name: 'Tyre' } }, { actor: AI, idempotencyKey: 'conv:call-7' });
    const k2 = await dispatch('catalogue.addEquipment', { equipment: { name: 'Tyre' } }, { actor: AI, idempotencyKey: 'conv:call-7' });
    expect(out<{ id: string }>(k2).id).toBe(out<{ id: string }>(k1).id);
    await settleCommits();
    expect(userDocs().filter((d) => d.key === 'tyre')).toHaveLength(1);

    const bad = await dispatch('catalogue.addEquipment', { equipment: { name: 'Thing', patterns: ['flying'] } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('invalid_input');
  });

  it('exercise: a known name returns the seed exercise; wrong fields are reported; undo removes the item', async () => {
    expect(out<{ id: string; created: boolean }>(await dispatch('catalogue.addExercise', { exercise: { name: 'Bethak' } }))).toMatchObject({ id: 'baithak', created: false });
    const bad = await dispatch('catalogue.addExercise', { exercise: { name: 'Odd lift', pattern: 'sideways', metGross: 99 } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.message).toMatch(/pattern/);
    const r = await dispatch('catalogue.addExercise', { exercise: { name: 'Rice sack shoulder walk', description: 'walking the yard with a rice sack on one shoulder' } });
    const added = out<{ id: string; created: boolean }>(r);
    expect(added.created).toBe(true);
    await settleCommits();
    expect(userDocs()).toHaveLength(1);
    const cs = r.ok && 'changeSet' in r ? r.changeSet : null;
    await dispatch('history.undo', { changeSetId: cs!.id });
    await settleCommits();
    expect(userDocs()).toHaveLength(0);
  });

  it('food: stored unverified, found by search and read; mismatched energy is kept with a caution', async () => {
    const r = await dispatch('catalogue.addFood', { food: { name: 'Homemade besan chilla', per100g: { energyKcal: 210, proteinG: 11, fatG: 7, carbG: 25, fibreG: 5 }, portions: [{ label: '1 chilla', g: 80 }] } });
    const f = out<{ id: string }>(r);
    await settleCommits();
    const found = out<Array<{ id: string; source: string; verified: boolean; own: boolean }>>(await dispatch('catalogue.searchFoods', { q: 'chilla' }));
    expect(found[0]).toMatchObject({ id: f.id, source: 'user', verified: false, own: true });
    expect(out<{ portions: unknown[] }>(await dispatch('catalogue.getFood', { id: f.id })).portions).toHaveLength(1);
    const odd = await dispatch('catalogue.addFood', { food: { name: 'Odd bar', per100g: { energyKcal: 100, proteinG: 30, fatG: 20, carbG: 40 } } });
    expect(odd.ok && 'notices' in odd && odd.notices.some((n) => n.level === 'caution')).toBe(true);
    expect((await dispatch('catalogue.addFood', { food: { name: 'Impossible', per100g: { energyKcal: 100, proteinG: 60, fatG: 30, carbG: 40 } } })).ok).toBe(false);
  });
});

describe('train.*', () => {
  it('composes a bodyweight session when the person has said nothing about equipment', async () => {
    await seedPlan();
    const r = out<{ planId: string; equipmentAnswered: boolean; sessions: Array<{ kind: string; composedHere: boolean; items: Array<{ equipment: string[]; text: string }> }> }>(
      await dispatch('train.session', { date: '2026-10-06' }),
    );
    expect(r.planId).toBe(PLAN_ID);
    expect(r.equipmentAnswered).toBe(false);
    expect(r.sessions).toHaveLength(1);
    const s = r.sessions[0]!;
    expect(s).toMatchObject({ kind: 'resistance', composedHere: true });
    expect(s.items.length).toBeGreaterThan(0);
    expect(s.items.every((i) => i.equipment.length === 0)).toBe(true);
    expect(s.items[0]!.text.length).toBeGreaterThan(5);
    const walk = out<{ sessions: Array<{ kind: string }> }>(await dispatch('train.session', { date: '2026-10-05' }));
    expect(walk.sessions[0]!.kind).toBe('cardio');
    const none = out<{ planId: string | null; sessions: unknown[] }>(await dispatch('train.session', { date: '2027-01-05' }));
    expect(none.sessions).toEqual([]);
  });

  it('uses the intake’s equipment and the person’s own items', async () => {
    await seedPlan();
    await dispatch('intake.answer', {
      section: 'training',
      answers: {
        owned: ['mudgar_heavy'],
        access: [{ place: 'home', equipment: ['mudgar_heavy'], weekdays: [0, 1, 2, 3, 4, 5, 6] }],
        refused: [],
        liked: ['indian'],
        injuries: [],
        skill: 3,
        purchaseAllowance: { maxPriceTier: 2, maxItems: 2 },
        loadsKg: { mudgar_heavy: [10] },
        prefs: { customEquipment: ['pull-up bar'] },
      },
    });
    await settleCommits();
    const r = out<{ equipmentAnswered: boolean; sessions: Array<{ items: Array<{ equipment: string[] }> }> }>(await dispatch('train.session', { date: '2026-10-06' }));
    expect(r.equipmentAnswered).toBe(true);
    const used = new Set(r.sessions.flatMap((s) => s.items.flatMap((i) => i.equipment)));
    for (const q of used) expect(['mudgar_heavy', 'pullup_bar']).toContain(q);
    const eq = out<Array<{ id: string; owned: boolean }>>(await dispatch('catalogue.equipment', { q: 'pull' }));
    expect(eq.find((q) => q.id === 'pullup_bar')?.owned).toBe(true); // typed "something else" resolved to the catalogue item
  });

  it('offers alternatives that keep the stimulus with the person’s equipment', async () => {
    await seedPlan();
    const session = out<{ sessions: Array<{ items: Array<{ exerciseId: string }> }> }>(await dispatch('train.session', { date: '2026-10-06' }));
    const first = session.sessions[0]!.items[0]!.exerciseId;
    const alts = out<Array<{ exerciseId: string; credit: number; equipment: string[] }>>(await dispatch('train.alternatives', { exerciseId: first, date: '2026-10-06' }));
    expect(alts.length).toBeGreaterThan(0);
    expect(alts.every((a) => a.exerciseId !== first && a.equipment.length === 0)).toBe(true);
    expect(alts[0]!.credit).toBeGreaterThanOrEqual(alts[alts.length - 1]!.credit);
    expect((await dispatch('train.alternatives', { exerciseId: 'nope' })).ok).toBe(false);
  });

  it('lists equipment worth buying for the running plan (the Ideal ignores the allowance)', async () => {
    await seedPlan();
    const none = out<unknown[]>(await dispatch('train.shoppingList', { planId: PLAN_ID }));
    expect(none.every((x) => (x as { priceTier: number }).priceTier === 0)).toBe(true); // allowance 0: only "use what you have"
    const ideal = out<Array<{ equipmentIds: string[]; priceTier: number; text: string }>>(await dispatch('train.shoppingList', { kind: 'ideal' }));
    expect(ideal.length).toBeGreaterThan(0);
    expect(ideal.some((x) => x.priceTier > 0)).toBe(true);
    expect((await dispatch('train.shoppingList', { planId: 'other' })).ok).toBe(false);
    expect((await dispatch('train.shoppingList', { kind: 'hard' })).ok).toBe(false);
    expect(out<unknown[]>(await dispatch('train.shoppingList', { kind: 'medium' }))).toBeInstanceOf(Array);
  });

  it('food.dayTargets reads the prescription’s meals', async () => {
    expect(out<unknown[]>(await dispatch('food.dayTargets', { date: '2026-10-06' }))).toEqual([]);
    await seedPlan();
    const meals = out<Array<{ slot: string; energyKcal: number }>>(await dispatch('food.dayTargets', { date: '2026-10-06' }));
    expect(meals.length).toBeGreaterThan(0);
    expect(meals.reduce((a, m) => a + m.energyKcal, 0)).toBeCloseTo(2000, -1);
  });
});
