/**
 * The adaptation commands (E5b) through the command bus on an in-memory store, with E6's receding-horizon `replan`
 * running in-process at tier S as the planner port: a declared busy stretch, a high-carbohydrate occasion, a shift that
 * pushes the end back, a day edit (and an unsafe one), a re-plan, and an exercise swap for one day and every week.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocumentStore, createMemoryBackend, mintWriteToken, bodyOf } from '@/store';
import { getDocumentStore, setDocumentStore } from '@/state/runtime';
import { dispatch, getCommand, settleCommits, type CommandResult } from '@/commands';
import { installLivingPorts } from '@/commands/livingWiring';
import { replan } from '@/engine/planner/domain/replan';
import { baseRequest, makePlan, PERSON, START, type Fixture } from '@/engine/planner/domain/__tests__/replan.fixtures';
import {
  addDays,
  checkReplan,
  DEFAULT_ITEM_WEIGHTS,
  fastEventOn,
  freezePrescription,
  templateOfDay,
  type DayStatusDoc,
  type PlanDoc,
  type PlanVersionDoc,
} from '@/living';
import type { AdaptOutput } from '@/commands/living/adapt';
import type { Schedule } from '@/engine';

const PLAN_ID = '01JABCDEFGHJKMNPQRSTVWXYZ1';
/** Plan day 7 (a Monday): a week lived, three weeks to go. */
const TODAY_IDX = 7;
const TODAY = addDays(START, TODAY_IDX);
const calls: Array<{ kind: string; pinned: number[] }> = [];

let fx: Fixture;
let request: ReturnType<typeof baseRequest>;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
  // fat mass to an absolute 26.1 kg: reached in the last week of the plan (end P50 about 25.9), so goal dates can move
  request = baseRequest({ goals: [{ metric: 'fatMass', direction: 'target', target: 26.1, targetKind: 'absolute' }, { metric: 'leanTissue', direction: 'maximise' }] });
  // a gentle deficit (energy gene 0.6, as the planner's re-plan tests): safe from here, so edits can be judged on safety
  fx = makePlan({ request, pick: (s) => /^B1(\[|$)/.test(s.id), x: (st) => withGene(st, 'seg0.energy', 0.6) });
  installLivingPorts({
    planner: {
      replan: (req, o) => {
        calls.push({ kind: req.kind, pinned: req.pinnedDays ?? [] });
        return replan(req, { tier: o?.tier ?? 'S' });
      },
    },
  });
}, 60_000);
afterAll(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  calls.length = 0;
  setDocumentStore(createDocumentStore({ backend: createMemoryBackend({ device: 'testdevice000002' }), validation: 'off' }));
  const store = getDocumentStore();
  await store.ready;
  const plan: PlanDoc = {
    name: 'Medium plan', rung: 'medium', origin: { kind: 'planner', requestHash: 'h', runAt: `${START}T08:00:00.000Z` }, status: 'active',
    startDate: START, plannedEndDate: addDays(START, request.horizonDays), request, baselineProfile: PERSON, headVersion: 1,
    pauses: [], intentions: {}, policy: { checkInWeekday: 0, autoApplyLoadLowering: true }, createdAt: `${START}T08:00:00.000Z`,
  };
  const version: PlanVersionDoc = {
    planId: PLAN_ID, version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0,
    schedule: fx.plan.schedule, genome: { structureId: fx.plan.structureId, x: [...fx.plan.genome] }, sessions: {},
    sensitivities: { planVersion: 'v1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} },
    forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] }, explanation: [],
    provenance: fx.plan.provenance, createdBy: { kind: 'system' }, createdAt: `${START}T08:00:00.000Z`,
  };
  await store.transact(mintWriteToken('migration', { label: 'test seed' }), async (tx) => {
    await tx.put('plans', { ...plan, _id: PLAN_ID });
    await tx.append('planVersions', { ...version, _id: `${PLAN_ID}:v1` });
    await tx.put('activePlan', { _id: 'me', planId: PLAN_ID, since: START });
  });
});

const out = <T = AdaptOutput,>(r: CommandResult): T => {
  if (!r.ok || !('output' in r)) throw new Error(JSON.stringify(r));
  return r.output as T;
};
const versions = (): PlanVersionDoc[] => getDocumentStore().peekAll<PlanVersionDoc>('planVersions').map((d) => bodyOf<PlanVersionDoc>(d)).sort((a, b) => a.version - b.version);
const versionOf = (n: number): PlanVersionDoc => versions().find((v) => v.version === n)!;
const planDoc = (): PlanDoc => bodyOf<PlanDoc>(getDocumentStore().peek('plans', PLAN_ID)!);
const tpl = (s: Schedule, d: number): string => JSON.stringify(templateOfDay(s, d));
/** Days in [from, to) whose template or fast differs. */
function changedDays(a: Schedule, b: Schedule, from: number, to: number): number[] {
  const out: number[] = [];
  for (let d = from; d < to; d++) if (tpl(a, d) !== tpl(b, d) || JSON.stringify(fastEventOn(a, d) ?? null) !== JSON.stringify(fastEventOn(b, d) ?? null)) out.push(d);
  return out;
}
const head = (): Schedule => versionOf(1).schedule;

describe('adaptation commands (E5b) with the tier-S re-plan', () => {
  it('are implemented and offered to the screens and the Coach', () => {
    for (const id of ['plan.replan', 'plan.declareEvent', 'plan.shift', 'plan.editDay', 'plan.swapExercise']) {
      const def = getCommand(id)!;
      expect(def.notImplemented, id).toBeUndefined();
      expect(def.surfaces, id).toEqual(expect.arrayContaining(['ui', 'ai']));
    }
  });

  it('busy for three days: only future days change, the busy days have no training, the goal date moves, churn limits hold, Undo removes it', async () => {
    const from = addDays(TODAY, 2);
    const to = addDays(TODAY, 4);
    const r = await dispatch('plan.declareEvent', { kind: 'busy', from, to }, { idempotencyKey: 'busy-1' });
    const o = out(r);
    expect(calls).toEqual([{ kind: 'weekly', pinned: [TODAY_IDX + 2, TODAY_IDX + 3, TODAY_IDX + 4] }]);
    expect(o.version).toBe(2);
    expect(['proposed', 'adopted']).toContain(o.status);
    expect(o.cardId).toBe(`version:${PLAN_ID}:2`);
    expect(o.pinned).toEqual([from, addDays(TODAY, 3), to]);
    const v = versionOf(2);
    // past immutable; today and tomorrow locked
    expect(changedDays(head(), v.schedule, 0, TODAY_IDX + 2)).toEqual([]);
    expect(v.effectiveFromDay).toBe(TODAY_IDX);
    // the busy days: habitual energy, no sessions, no fast
    for (let d = TODAY_IDX + 2; d <= TODAY_IDX + 4; d++) {
      const t = templateOfDay(v.schedule, d);
      expect(t.habitualTraining).toBe(false);
      expect(t.exercise ?? []).toEqual([]);
      expect(fastEventOn(v.schedule, d)).toBeUndefined();
    }
    // the rest of the plan around them: within the weekly churn limits against the plan with the busy days in it
    const edited = withBusy(head(), v.schedule, [TODAY_IDX + 2, TODAY_IDX + 3, TODAY_IDX + 4]);
    expect(checkReplan(edited, v.schedule, TODAY_IDX, 'weekly').violations).toEqual([]);
    // three habitual days cost fat loss: the goal date moves later (or the end value is higher)

    const g = o.goalDates[0]!;
    expect(g.before).not.toBeNull();
    if (g.after !== null) expect(g.after >= g.before!).toBe(true);
    expect(g.after).not.toBe(g.before);
    expect(o.impact[0]!.endP50Delta).toBeGreaterThan(0);
    expect(o.diff.length).toBeGreaterThan(0);
    expect(o.diff.every((x) => x.date >= TODAY)).toBe(true);
    expect(o.notes.join(' ')).toMatch(/Busy days/);

    // idempotent: the same key returns the same result without a second version
    const again = out(await dispatch('plan.declareEvent', { kind: 'busy', from, to }, { idempotencyKey: 'busy-1' }));
    expect(again.version).toBe(2);
    expect(versions().map((x) => x.version)).toEqual([2, 1].sort());

    // Undo: the version goes, the plan's head is back
    await settleCommits();
    const cs = r.ok && 'changeSet' in r ? r.changeSet?.id : undefined;
    expect(cs).toBeDefined();
    expect((await dispatch('history.undo', { changeSetId: cs! })).ok).toBe(true);
    await settleCommits();
    expect(versions().map((x) => x.version)).toEqual([1]);
    expect(planDoc().headVersion).toBe(1);
  }, 120_000);

  it('a high-carbohydrate occasion is planned in: that day gets the extra carbohydrate and energy, the rest is re-planned around it', async () => {
    const date = addDays(TODAY, 3);
    const before = freezePrescription({ plan: { ...planDoc(), id: PLAN_ID }, version: versionOf(1), date, tz: 'UTC' });
    const o = out(await dispatch('plan.declareEvent', { kind: 'socialMeal', from: date, to: date, note: 'Wedding', extraCarbG: 120 }));
    expect(o.version).toBe(2);
    const v = versionOf(o.version!);
    const t = templateOfDay(v.schedule, TODAY_IDX + 3);
    expect(t.energy).toEqual({ kind: 'kcal', kcal: Math.round(before.energyKcal + 480) });
    expect(t.macros.carbs).toEqual({ unit: 'g', value: Math.round(before.macros.carbG + 120) });
    expect(o.notes.join(' ')).toMatch(/Wedding: about 480 kcal more, 120 g of it carbohydrate/);
    expect(changedDays(head(), v.schedule, 0, TODAY_IDX + 2)).toEqual([]);
    const edited = withBusy(head(), v.schedule, [TODAY_IDX + 3]);
    expect(checkReplan(edited, v.schedule, TODAY_IDX, 'weekly').violations).toEqual([]);
    // the occasion costs a little fat loss at most; the planner never trades goal progress for it
    expect(o.impact[0]!.endP50Delta).toBeGreaterThanOrEqual(-0.05);
    expect(o.impact[0]!.endP50Delta).toBeLessThan(1);
  }, 120_000);

  it('illness: habitual food, no training and no fasting on those days; the rest is re-planned around them', async () => {
    const o = out(await dispatch('plan.declareEvent', { kind: 'illness', from: addDays(TODAY, 2), to: addDays(TODAY, 3) }));
    const v = versionOf(o.version!);
    for (const d of [TODAY_IDX + 2, TODAY_IDX + 3]) {
      expect(templateOfDay(v.schedule, d).label).toBe('habitual day');
      expect(templateOfDay(v.schedule, d).exercise ?? []).toEqual([]);
      expect(fastEventOn(v.schedule, d)).toBeUndefined();
    }
    expect(changedDays(head(), v.schedule, 0, TODAY_IDX)).toEqual([]);
    expect(o.notes[0]).toMatch(/Rest comes first/);
  }, 120_000);

  it('shift pushBack: two habitual days inserted, later days move back, the end date moves when the proposal is adopted', async () => {
    const from = addDays(TODAY, 2);
    const o = out(await dispatch('plan.shift', { from, days: 2, mode: 'pushBack' }));
    const v = versionOf(o.version!);
    expect(v.schedule.horizonDays).toBe(head().horizonDays + 2);
    expect(v.plannedEndDate).toBe(addDays(START, request.horizonDays + 2));
    expect(templateOfDay(v.schedule, TODAY_IDX + 2).label).toBe('habitual day');
    expect(templateOfDay(v.schedule, TODAY_IDX + 3).label).toBe('habitual day');
    expect(changedDays(head(), v.schedule, 0, TODAY_IDX + 2)).toEqual([]);
    if (o.status === 'proposed') {
      // Q4: an undone adoption leaves a tombstone; adopting again takes the next free version number
      const first = await dispatch('plan.adoptVersion', { planId: PLAN_ID, version: o.version! });
      expect(first.ok).toBe(true);
      if (first.ok && 'changeSet' in first && first.changeSet) expect((await dispatch('history.undo', { changeSetId: first.changeSet.id })).ok).toBe(true);
      await settleCommits();
      expect(out<{ status: string }>(await dispatch('plan.adoptVersion', { planId: PLAN_ID, version: o.version! })).status).toBe('adopted');
      // Q4: the decided proposal is closed: a second Apply is refused instead of adopting a copy again
      const again = await dispatch('plan.adoptVersion', { planId: PLAN_ID, version: o.version! });
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.error.code).toBe('conflict');
    }
    expect(planDoc().plannedEndDate).toBe(addDays(START, request.horizonDays + 2));
  }, 120_000);

  it('editDay: a future day prescribes the edit; an edit that leaves no safe plan is refused and nothing is written', async () => {
    const date = addDays(TODAY, 5);
    const o = out(await dispatch('plan.editDay', { date, patch: { steps: 11000 }, scope: 'day' }));
    expect(templateOfDay(versionOf(o.version!).schedule, TODAY_IDX + 5).steps).toBe(11000);
    expect(changedDays(head(), versionOf(o.version!).schedule, 0, TODAY_IDX + 2)).toEqual([]);
    const n = versions().length;
    const bad = await dispatch('plan.editDay', { date: addDays(TODAY, 2), patch: { energy: { kind: 'zero' }, macros: { protein: { unit: 'g', value: 0 } } }, scope: 'rest' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('invalid_input');
    expect(versions().length).toBe(n);
    // the past cannot be edited
    const past = await dispatch('plan.editDay', { date: addDays(TODAY, -1), patch: { steps: 9000 }, scope: 'day' });
    expect(past.ok).toBe(false);
  }, 180_000);

  it('plan.replan: the rest is re-planned from the confirmed state; days lived and the lock window stay', async () => {
    const o = out(await dispatch('plan.replan', { reason: 'Re-plan the rest (same goals)', tier: 'S' }));
    expect(calls[0]!.kind).toBe('event');
    expect(['proposed', 'adopted', 'unchanged']).toContain(o.status);
    if (o.version !== null) expect(changedDays(head(), versionOf(o.version).schedule, 0, TODAY_IDX + 2)).toEqual([]);
    else expect(versions().length).toBe(1);
  }, 180_000);

  it('swapExercise: one day keeps the swap on the day record; every week is a proposal that keeps the weekly dose within the equivalence tolerance', async () => {
    const { loadCatalogueModules, trainingSetupNow } = await import('@/commands/catalogue/setup');
    const m = await loadCatalogueModules();
    const setup = trainingSetupNow(m);
    const plan = { ...planDoc(), id: PLAN_ID };
    // the first future day with a resistance session that has a dose-equivalent swap
    let pick: { date: string; slotKey: string; from: string; to: string } | null = null;
    for (let d = TODAY_IDX; d < head().horizonDays && !pick; d++) {
      const date = addDays(START, d);
      const rx = freezePrescription({ plan, version: versionOf(1), date, tz: 'UTC' });
      for (const s of rx.sessions) {
        if (s.kind !== 'resistance') continue;
        const weekday = (await import('@/commands/catalogue/setup')).catalogueWeekday(date);
        const session = m.cat.composeSession(m.cat.prescriptionFromEngine(s.kind, s.engine, { weekday, startH: s.startH, durationMin: s.durationMin }), { profile: setup.profile, catalogue: setup.catalogue, ctx: setup.ctx });
        const item = session.items[0];
        if (!item) continue;
        const opt = m.cat.swapOptions([item.perf], { profile: setup.profile, catalogue: setup.catalogue, ctx: setup.ctx, weekday, startH: s.startH }).find((x) => x.equivalence.parity);
        if (opt) pick = { date, slotKey: s.slotKey, from: item.exerciseId, to: opt.exerciseId };
      }
    }
    expect(pick).not.toBeNull();
    const one = out<{ equivalence: { credit: number; parity: boolean }; everyWeek: boolean; version: null }>(await dispatch('plan.swapExercise', pick!));
    expect(one.everyWeek).toBe(false);
    expect(one.equivalence.parity).toBe(true);
    const day = bodyOf<DayStatusDoc>(getDocumentStore().peek('dayStatus', `day:${pick!.date}`)!);
    expect(day.swaps?.[pick!.slotKey]?.[0]).toMatchObject({ from: pick!.from, to: { exerciseId: pick!.to } });
    expect(versions().length).toBe(1);

    const weekly = out<{ version: number; status: string; weekly: { weeks: number; meanCredit: number }; cardId: string }>(await dispatch('plan.swapExercise', { ...pick!, everyWeek: true }));
    expect(weekly.status).toBe('proposed');
    expect(weekly.cardId).toBe(`version:${PLAN_ID}:${weekly.version}`);
    expect(weekly.weekly.weeks).toBeGreaterThanOrEqual(1);
    // equivalence tolerance: a swap at parity credits the whole session (S ≥ 0.90)
    expect(weekly.weekly.meanCredit).toBeGreaterThanOrEqual(0.9);
    const v = versionOf(weekly.version);
    const swapped = Object.values(v.sessions).filter((s) => s.items.some((it) => it.exerciseId === pick!.to));
    expect(swapped.length).toBe(weekly.weekly.weeks);
    for (const s of swapped) expect(s.equivalence.score).toBeGreaterThanOrEqual(0.9);
    // the engine schedule (what the forecast simulates) is unchanged by a dose-equivalent swap
    expect(JSON.stringify(v.schedule)).toBe(JSON.stringify(head()));
  }, 120_000);
});

function withGene(st: { x0: Float64Array; geneIndex: Readonly<Record<string, number>> }, path: string, v: number): Float64Array {
  const x = Float64Array.from(st.x0);
  const i = st.geneIndex[path];
  if (i !== undefined) x[i] = v;
  return x;
}

/** `next`'s templates on `days` written into `base` (the person's edit as the planner received it). */
function withBusy(base: Schedule, next: Schedule, days: number[]): Schedule {
  const programs = [...base.programs];
  const out = base.days.map((d) => ({ ...d }));
  for (const d of days) {
    programs.push(templateOfDay(next, d));
    out[d] = { program: programs.length - 1 };
  }
  const events = (base.events ?? []).filter((e) => !days.some((d) => fastEventOn(base, d) === e));
  return { ...base, programs, days: out, events };
}
