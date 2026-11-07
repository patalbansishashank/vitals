/**
 * D5-06 — the living loop through the command bus on an in-memory store with a fake clock and a fake planner port:
 *  - the automatic refresh prepares one preview per key, writes only derived data, emits no bus event and never confirms;
 *  - an explicit Check in confirms once (record + decision + weekly proposal in one change); a retry, a replay or a stored
 *    decision from another device writes nothing more; a stale preview is refused;
 *  - a re-plan that adds a fast is never adopted automatically (the change card owns adoption);
 *  - a late open decides the missed check-in today (never backdated);
 *  - too few weigh-ins still records the check-in once, without an anchor or a proposal;
 *  - a disturbance asks for review without forcing a tissue anchor;
 *  - a new concerning symptom re-checks today's prescription at once, without a weigh-in.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocumentStore, createMemoryBackend, mintWriteToken, bodyOf } from '@/store';
import { getDocumentStore, setDocumentStore } from '@/state/runtime';
import { dispatch, type CommandResult } from '@/commands';
import { on } from '@/commands/bus';
import { checkInPreviewDocId, installLivingPorts, runCheckInRefresh } from '@/commands/livingWiring';
import type { PersonProfile, Schedule } from '@/engine';
import type { ReplanRequest, ReplanResult } from '@/engine/planner/domain/replanTypes';
import { addDays, DEFAULT_ITEM_WEIGHTS, type ConfirmedStateRecord, type PlanDoc, type PlanVersionDoc, type StoredCheckInDecision, type TodayView } from '@/living';

const PLAN_ID = '01JABCDEFGHJKMNPQRSTVWXYZ7';
const START = '2026-09-28'; // a Monday
const TODAY_IDX = 13;
const TODAY = addDays(START, TODAY_IDX); // a Sunday: the check-in weekday below
const NOON = (date: string) => new Date(`${date}T12:00:00`);
const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 90 }, startDate: START };
const MACROS = { protein: { unit: 'g' as const, value: 150 }, carbs: { unit: 'g' as const, value: 200 }, fat: { unit: 'remainder' as const } };
const SCHEDULE: Schedule = { schemaVersion: 1, startDate: START, horizonDays: 28, programs: [{ id: 'A', label: 'day', energy: { kind: 'kcal', kcal: 2000 }, macros: MACROS, steps: 8000 }], days: Array.from({ length: 28 }, () => ({ program: 0 })) };
const calls: ReplanRequest[] = [];

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOON(TODAY));
  installLivingPorts({
    // the planner's re-plan, faked: it adds a 24 h fast three days ahead (a load increase that needs consent)
    planner: {
      replan: async (req) => {
        calls.push(req);
        const fastDay = planDayOf(req.today) + 3;
        const s = req.plan.schedule;
        const schedule: Schedule = { ...s, events: [...(s.events ?? []), { kind: 'fast', startDay: fastDay, startH: 20, durationH: 24 }] };
        return {
          status: 'proposal', plan: { ...req.plan, version: req.plan.version + 1, schedule }, diff: [{ date: addDays(START, fastDay), field: 'fast', before: 'null', after: '24 h', why: 'weekly' }],
          forecast: { asPrescribed: [], realistic: [], bands: {} }, goalDates: [], proposals: [], explanation: ['A 24 h fast added.'], euUsed: 0,
        } as unknown as ReplanResult;
      },
    },
    revalidate: async () => null,
  });
});
afterAll(() => {
  vi.useRealTimers();
  installLivingPorts();
});
beforeEach(() => {
  calls.length = 0;
  vi.setSystemTime(NOON(TODAY));
  setDocumentStore(createDocumentStore({ backend: createMemoryBackend({ device: 'testdevice000007' }), validation: 'off' }));
});

const planDayOf = (date: string): number => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${START}T00:00:00Z`)) / 86_400_000);
const out = <T,>(r: CommandResult): T => {
  if (!r.ok || !('output' in r)) throw new Error(JSON.stringify(r));
  return r.output as T;
};
const anchors = () => getDocumentStore().peekAll<Record<string, unknown>>('anchors').map((d) => ({ id: d._id, ...bodyOf<Record<string, unknown>>(d) }));
const versions = (): PlanVersionDoc[] => getDocumentStore().peekAll<PlanVersionDoc>('planVersions').map((d) => bodyOf<PlanVersionDoc>(d)).sort((a, b) => a.version - b.version);
const preview = () => {
  const d = getDocumentStore().peek<Record<string, unknown>>('derived', checkInPreviewDocId(PLAN_ID));
  return d ? (bodyOf<Record<string, unknown>>(d) as { key: string | null; preview: StoredCheckInDecision | null; due: { due: boolean; decisionPoint: string }; eligibility: { blocked: boolean } | null; estimate: unknown }) : null;
};

async function seed(weighIns: number[] = Array.from({ length: TODAY_IDX - 1 }, (_, k) => k + 1)): Promise<void> {
  const store = getDocumentStore();
  await store.ready;
  const plan: PlanDoc = {
    name: 'Medium plan', rung: 'medium', origin: { kind: 'planner', requestHash: 'h', runAt: `${START}T08:00:00.000Z` }, status: 'active',
    startDate: START, plannedEndDate: addDays(START, 28), request: { profile: MAN, goals: [], horizonDays: 28 }, baselineProfile: MAN, headVersion: 1,
    // check-in on Sundays (weekday 6: 0 = Monday)
    pauses: [], intentions: {}, policy: { checkInWeekday: 6, autoApplyLoadLowering: true }, createdAt: `${START}T08:00:00.000Z`,
  };
  const version: PlanVersionDoc = {
    planId: PLAN_ID, version: 1, parent: null, status: 'adopted', reason: 'start', effectiveFromDay: 0, schedule: SCHEDULE, genome: null, sessions: {},
    sensitivities: { planVersion: 'v1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} }, forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] }, explanation: [],
    provenance: { engineVersion: 'e', registryHash: 'r', catalogueVersion: 'c' }, createdBy: { kind: 'system' }, createdAt: `${START}T08:00:00.000Z`,
  };
  await store.transact(mintWriteToken('migration', { label: 'test seed' }), async (tx) => {
    await tx.put('plans', { ...plan, _id: PLAN_ID });
    await tx.append('planVersions', { ...version, _id: `${PLAN_ID}:v1` });
    await tx.put('activePlan', { _id: 'me', planId: PLAN_ID, since: START });
    for (const d of weighIns) {
      const date = addDays(START, d);
      await tx.append('measurements', { _id: `w${String(d).padStart(2, '0')}`, date, at: `${date}T07:00:00.000Z`, metric: 'weightKg', value: 90 - 0.08 * d, context: 'morningFasted', source: { by: 'user', method: 'typed' } });
    }
  });
}

type CheckInOut = { verdict: string; decision: { id: string; key: string; anchored: boolean; review: { status: string; reasons: Array<{ code: string }> } | null; proposalVersion: number | null; alreadyConfirmed: boolean }; change: { status: string; version: number | null } | null };

describe('automatic refresh: a preview, never a confirmation (D5-06)', () => {
  it('prepares one current-date preview per key, writes only derived data and emits no bus event', async () => {
    await seed();
    const events: string[] = [];
    const off = on((e) => events.push(e.type));
    const r1 = await runCheckInRefresh();
    const r2 = await runCheckInRefresh();
    off();
    expect(r1).toMatchObject({ due: true, wrote: true, autoConfirmed: false });
    expect(r2).toMatchObject({ due: true, wrote: false, key: r1!.key });
    expect(preview()).toMatchObject({ key: r1!.key, due: { due: true, decisionPoint: TODAY }, preview: { status: 'preview', decisionPoint: TODAY }, estimate: { verdict: 'confirmed', anchored: true } });
    expect(anchors()).toEqual([]);
    expect(versions()).toHaveLength(1);
    expect(events.filter((t) => t === 'committed')).toEqual([]);
    expect(calls).toHaveLength(0);
  }, 60_000);

  it('a new weigh-in is a new key (processed once more); the preview never becomes evidence', async () => {
    await seed();
    const a = await runCheckInRefresh();
    out(await dispatch('log.measurement', { metric: 'weightKg', value: 88.9, context: 'morningFasted' }));
    const b = await runCheckInRefresh();
    expect(b!.key).not.toBe(a!.key);
    expect(b!.wrote).toBe(true);
    expect(anchors()).toEqual([]);
  }, 60_000);
});

describe('explicit check-in: confirmed once (D5-06)', () => {
  it('confirms the preview it names with its record and weekly proposal in one change; a retry writes nothing more', async () => {
    await seed();
    await runCheckInRefresh();
    const stale = await dispatch('plan.checkIn', { previewId: 'ci-0000000000000000' });
    expect(!stale.ok && stale.error.code).toBe('conflict');
    expect(anchors()).toEqual([]);
    const key = preview()!.key!;
    const first = out<CheckInOut>(await dispatch('plan.checkIn', { previewId: `ci-${key}` }));
    expect(first.verdict).toBe('confirmed');
    expect(first.decision).toMatchObject({ id: `${PLAN_ID}:${TODAY}`, key, anchored: true, alreadyConfirmed: false });
    // the weekly re-plan ran from the new confirmed state; it adds a fast, so it stays a proposal (never adopted at once)
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ kind: 'weekly', trigger: 'checkin', state: { anchorDate: TODAY } });
    expect(first.change).toMatchObject({ status: 'proposed' });
    expect(versions().map((v) => [v.version, v.status])).toEqual([[1, 'adopted'], [2, 'proposed']]);
    const stored = anchors();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: `${PLAN_ID}:${TODAY}`, decisionId: `${PLAN_ID}:${TODAY}`, trigger: 'weekly', decision: { status: 'confirmed', key, proposalVersion: 2, mode: 'explicit', anchored: true } });
    // a retry (double tap, command replay, another device) answers from the stored decision
    const retry = out<CheckInOut>(await dispatch('plan.checkIn', {}));
    expect(retry.decision).toMatchObject({ alreadyConfirmed: true, key, proposalVersion: 2 });
    expect(anchors()).toHaveLength(1);
    expect(versions()).toHaveLength(2);
    expect(calls).toHaveLength(1);
    // nothing is due any more today, and the refresh says so
    expect((await runCheckInRefresh())!.due).toBe(false);
    expect(out<TodayView>(await dispatch('today.get', {})).checkIn.due).toBe(false);
  }, 120_000);

  it('a decision stored by another device for today is never repeated', async () => {
    await seed();
    const other = { kind: 'checkInDecision', planId: PLAN_ID, anchorDate: TODAY, decision: { id: `${PLAN_ID}:${TODAY}`, planId: PLAN_ID, decisionPoint: TODAY, evidenceIds: [], historyHash: 'x', stamp: { contracts: 'c' }, status: 'confirmed', key: 'k', coordinatorVersion: 1, evidenceVersion: 1, adoptedVersion: 1, anchored: false } };
    await getDocumentStore().transact(mintWriteToken('migration', { label: 'synced decision' }), async (tx) => {
      await tx.append('anchors', { ...other, _id: `${PLAN_ID}:${TODAY}` });
    });
    const r = out<CheckInOut>(await dispatch('plan.checkIn', {}));
    expect(r.decision.alreadyConfirmed).toBe(true);
    expect(anchors()).toHaveLength(1);
    expect(calls).toHaveLength(0);
  }, 60_000);
});

describe('catch-up and partial evidence (D5-06)', () => {
  it('a late open decides the missed check-in today, never backdated', async () => {
    await seed();
    const tomorrow = addDays(TODAY, 1);
    vi.setSystemTime(NOON(tomorrow));
    const view = out<TodayView>(await dispatch('today.get', {}));
    expect(view.checkIn.due).toBe(true);
    expect(view.notices.find((n) => n.kind === 'checkIn')?.text).toBe('Check-in ready');
    const r = out<CheckInOut>(await dispatch('plan.checkIn', {}));
    expect(r.decision.id).toBe(`${PLAN_ID}:${tomorrow}`);
    expect(anchors().map((a) => a.id)).toEqual([`${PLAN_ID}:${tomorrow}`]);
    expect(anchors().some((a) => a.id === `${PLAN_ID}:${TODAY}`)).toBe(false);
  }, 120_000);

  it('too few weigh-ins: the check-in is recorded once, without an anchor or a proposal', async () => {
    await seed([2]);
    const r = out<CheckInOut>(await dispatch('plan.checkIn', {}));
    expect(r.verdict).not.toBe('confirmed');
    expect(r.decision).toMatchObject({ anchored: false, proposalVersion: null });
    expect(r.change).toBeNull();
    expect(calls).toHaveLength(0);
    expect(anchors()).toEqual([expect.objectContaining({ kind: 'checkInDecision', anchorDate: TODAY, decision: expect.objectContaining({ status: 'confirmed', anchored: false }) })]);
    expect(out<TodayView>(await dispatch('today.get', {})).checkIn).toEqual({ due: false, lastAt: TODAY });
  }, 60_000);

  it('a disturbance asks for review; the record stays a weekly decision without a forced tissue anchor', async () => {
    await seed();
    await getDocumentStore().transact(mintWriteToken('migration', { label: 'illness' }), async (tx) => {
      const date = addDays(TODAY, -4);
      await tx.append('dailyLogs', { _id: 'ill', date, tz: 'UTC', kind: 'event', event: 'illness', to: addDays(TODAY, -2), source: { by: 'user', method: 'typed' } });
    });
    const r = out<CheckInOut>(await dispatch('plan.checkIn', {}));
    expect(r.decision.review).toMatchObject({ status: 'review', reasons: [expect.objectContaining({ code: 'illness' })] });
    const rec = anchors()[0] as unknown as ConfirmedStateRecord;
    expect(rec.trigger).toBe('weekly');
    expect(rec.hardReason).toBeUndefined();
  }, 120_000);
});

describe('eligibility on a new safety event (C5/D5-06)', () => {
  it('a concerning symptom re-checks today’s prescription at once, without a weigh-in or a lock window', async () => {
    await seed([]);
    expect(out<TodayView>(await dispatch('today.get', {})).notices.some((n) => n.kind === 'safety')).toBe(false);
    await runCheckInRefresh();
    expect(preview()!.eligibility).toMatchObject({ blocked: false });
    out(await dispatch('log.subjective', { symptom: { category: 'exertionalChestDiscomfort', status: 'new', context: 'exertional' } }));
    const view = out<TodayView>(await dispatch('today.get', {}));
    // A1-005: the current exercise-eligibility overlay names the hold (a steps-only prescription reads stepsHold)
    expect(view.notices.some((n) => n.kind === 'safety' && (n.id === 'safetyReview' || n.id === 'symptomHold' || n.id === 'stepsHold'))).toBe(true);
    expect(view.exerciseEligibility).toMatchObject({ status: 'suspended', steps: { status: 'noNumericTarget', target: null } });
    await runCheckInRefresh();
    expect(preview()!.eligibility).toMatchObject({ blocked: true });
  }, 60_000);
});
