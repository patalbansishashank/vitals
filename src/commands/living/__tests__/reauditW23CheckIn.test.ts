/** W2/W3: current decision authority, lifecycle reads and once-frozen scenario clinical targets. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocumentStore, createMemoryBackend, mintWriteToken, bodyOf } from '@/store';
import { getDocumentStore, setDocumentStore } from '@/state/runtime';
import { dispatch, type CommandResult } from '@/commands';
import {
  CHECK_IN_OPT_IN_ACTOR,
  pendingCheckInOf,
  bpEpisodes,
  projectLiving,
  startFromScenario,
  freezeGoalTargets,
  restoreScenarioGoalTargets,
} from '@/living';
import * as plannerState from '@/state/internal/planner';
import * as scheduleState from '@/state/internal/schedule';
import * as profileState from '@/state/internal/simulatorProfile';
import { compileRequest } from '@/engine/planner/domain/context';
import { readDocs } from '@/commands/living';
import { withSystemWrite } from '@/state/scope';
import { timeZone } from '@/commands/bus';
import { useSettingsStore } from '@/state/settingsStore';
import { createDocumentLivingSource } from '@/features/living/data/documents';
import { isSettingsState, DEFAULT_SETTINGS } from '@/state/internal/settingsModel';
import {
  checkInPreviewDocId,
  installLivingPorts,
  runCheckInRefresh,
  readLivingDocs,
  runRollover,
  runAssimilation,
} from '@/commands/livingWiring';
import type { PersonProfile, Schedule } from '@/engine';
import type { ReplanRequest, ReplanResult } from '@/engine/planner/domain/replanTypes';
import {
  addDays,
  DEFAULT_ITEM_WEIGHTS,
  type ConfirmedStateRecord,
  type PlanDoc,
  type PlanVersionDoc,
  type StoredCheckInDecision,
  type TodayView,
} from '@/living';

const PLAN_ID = '01JABCDEFGHJKMNPQRSTVWXYZ7';
const START = '2026-09-28'; // a Monday
const TODAY_IDX = 13;
const TODAY = addDays(START, TODAY_IDX); // a Sunday: the check-in weekday below
const NOON = (date: string) => new Date(`${date}T12:00:00`);
const MAN: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'male', ageYears: 40, heightCm: 180, weightKg: 90 },
  startDate: START,
};
const MACROS = {
  protein: { unit: 'g' as const, value: 150 },
  carbs: { unit: 'g' as const, value: 200 },
  fat: { unit: 'remainder' as const },
};
const SCHEDULE: Schedule = {
  schemaVersion: 1,
  startDate: START,
  horizonDays: 28,
  programs: [{ id: 'A', label: 'day', energy: { kind: 'kcal', kcal: 2000 }, macros: MACROS, steps: 8000 }],
  days: Array.from({ length: 28 }, () => ({ program: 0 })),
};
const calls: ReplanRequest[] = [];

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOON(TODAY));
  installLivingPorts({
    // A proposal makes the asynchronous preparation/write boundary observable.
    planner: {
      replan: async (req) => {
        calls.push(req);
        const fastDay = planDayOf(req.today) + 3;
        const s = req.plan.schedule;
        const schedule: Schedule = {
          ...s,
          events: [...(s.events ?? []), { kind: 'fast', startDay: fastDay, startH: 20, durationH: 24 }],
        };
        return {
          status: 'proposal',
          plan: { ...req.plan, version: req.plan.version + 1, schedule },
          diff: [
            { date: addDays(START, fastDay), field: 'fast', before: 'null', after: '24 h', why: 'weekly' },
          ],
          forecast: { asPrescribed: [], realistic: [], bands: {} },
          goalDates: [],
          proposals: [],
          explanation: ['A 24 h fast added.'],
          euUsed: 0,
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
afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  installLivingPorts({ planner: undefined as never, revalidate: async () => null });
  calls.length = 0;
  setOptIn(false);
  vi.setSystemTime(NOON(TODAY));
  setDocumentStore(
    createDocumentStore({ backend: createMemoryBackend({ device: 'testdevice000007' }), validation: 'off' }),
  );
});

const planDayOf = (date: string): number =>
  Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${START}T00:00:00Z`)) / 86_400_000);
const out = <T>(r: CommandResult): T => {
  if (!r.ok || !('output' in r)) throw new Error(JSON.stringify(r));
  return r.output as T;
};
const anchors = () =>
  getDocumentStore()
    .peekAll<Record<string, unknown>>('anchors')
    .map((d) => ({ id: d._id, ...bodyOf<Record<string, unknown>>(d) }));
const versions = (): PlanVersionDoc[] =>
  getDocumentStore()
    .peekAll<PlanVersionDoc>('planVersions')
    .map((d) => bodyOf<PlanVersionDoc>(d))
    .sort((a, b) => a.version - b.version);
const preview = () => {
  const d = getDocumentStore().peek<Record<string, unknown>>('derived', checkInPreviewDocId(PLAN_ID));
  return d
    ? (bodyOf<Record<string, unknown>>(d) as {
        key: string | null;
        preview: StoredCheckInDecision | null;
        due: { due: boolean; decisionPoint: string };
        eligibility: { blocked: boolean } | null;
        estimate: { verdict: string; correctionKcal: number | null; trendKg: number | null } | null;
        review: { status: string; reasons: Array<{ code: string }> };
        status: string;
      })
    : null;
};

async function seed(
  weighIns: number[] = Array.from({ length: TODAY_IDX - 1 }, (_, k) => k + 1),
): Promise<void> {
  const store = getDocumentStore();
  await store.ready;
  const plan: PlanDoc = {
    name: 'Medium plan',
    rung: 'medium',
    origin: { kind: 'planner', requestHash: 'h', runAt: `${START}T08:00:00.000Z` },
    status: 'active',
    startDate: START,
    plannedEndDate: addDays(START, 28),
    request: { profile: MAN, goals: [], horizonDays: 28 },
    baselineProfile: MAN,
    headVersion: 1,
    // check-in on Sundays (weekday 6: 0 = Monday)
    pauses: [],
    intentions: {},
    policy: { checkInWeekday: 6, autoApplyLoadLowering: true },
    createdAt: `${START}T08:00:00.000Z`,
  };
  const version: PlanVersionDoc = {
    planId: PLAN_ID,
    version: 1,
    parent: null,
    status: 'adopted',
    reason: 'start',
    effectiveFromDay: 0,
    schedule: SCHEDULE,
    genome: null,
    sessions: {},
    sensitivities: { planVersion: 'v1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} },
    forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] },
    explanation: [],
    provenance: { engineVersion: 'e', registryHash: 'r', catalogueVersion: 'c' },
    createdBy: { kind: 'system' },
    createdAt: `${START}T08:00:00.000Z`,
  };
  await store.transact(mintWriteToken('migration', { label: 'test seed' }), async (tx) => {
    await tx.put('plans', { ...plan, _id: PLAN_ID });
    await tx.append('planVersions', { ...version, _id: `${PLAN_ID}:v1` });
    await tx.put('activePlan', { _id: 'me', planId: PLAN_ID, since: START });
    for (const d of weighIns) {
      const date = addDays(START, d);
      await tx.append('measurements', {
        _id: `w${String(d).padStart(2, '0')}`,
        date,
        at: `${date}T07:00:00.000Z`,
        metric: 'weightKg',
        value: 90 - 0.08 * d,
        context: 'morningFasted',
        source: { by: 'user', method: 'typed' },
      });
    }
  });
}

const setOptIn = (on: boolean) =>
  withSystemWrite(() => useSettingsStore.setState({ checkInAutoConfirm: on }), 'test policy');
const migration = async (
  f: (tx: Parameters<Parameters<ReturnType<typeof getDocumentStore>['transact']>[1]>[0]) => Promise<void>,
) => getDocumentStore().transact(mintWriteToken('migration', { label: 'W23 evidence' }), f);
const putStatus = async (status: PlanDoc['status']) =>
  migration(async (tx) => {
    const plan = bodyOf<PlanDoc>(getDocumentStore().peek('plans', PLAN_ID)!);
    await tx.put('plans', { ...plan, status, _id: PLAN_ID });
  });
const automatic = () =>
  dispatch('plan.checkIn', {}, { actor: { kind: 'system', id: CHECK_IN_OPT_IN_ACTOR } });
const event = async (kind: string, date = TODAY) =>
  migration(async (tx) => {
    await tx.append('dailyLogs', {
      _id: `event-${kind}`,
      date,
      tz: 'UTC',
      kind: 'event',
      event: kind,
      source: { by: 'user', method: 'typed' },
    });
  });
const correctWeight = async (id: string, value: number) =>
  migration(async (tx) => {
    const prior = bodyOf<Record<string, unknown>>(getDocumentStore().peek('measurements', id)!);
    await tx.append('measurements', { ...prior, value, supersedes: id, revision: 2, _id: `${id}-corrected` });
  });
const assertConflict = async (key: string) => {
  const result = await dispatch('plan.checkIn', { previewId: `ci-${key}` });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe('conflict');
};

describe('effective scheduled lifecycle', () => {
  it('clock-only activation agrees across bus, source, boot/rollover/logging and refresh without rewriting the stored plan', async () => {
    await seed();
    await putStatus('scheduled');
    vi.setSystemTime(NOON(addDays(START, -1)));
    expect(readLivingDocs().plan?.status).toBe('scheduled');
    expect(await runCheckInRefresh()).toBeNull();
    vi.setSystemTime(NOON(TODAY));
    expect((await readDocs(TODAY)).plan?.status).toBe('active');
    expect(readLivingDocs().plan?.status).toBe('active');
    expect(out<TodayView>(await dispatch('today.get', {})).checkIn.due).toBe(true);
    const source = createDocumentLivingSource();
    expect(source.checkIn(TODAY)?.due).toBe(true);
    await runRollover();
    await runAssimilation();
    out(await dispatch('log.subjective', { mood: 7 }));
    expect(await runCheckInRefresh()).toMatchObject({ due: true, autoConfirmed: false });
    expect(getDocumentStore().peek<PlanDoc>('plans', PLAN_ID)?.status).toBe('scheduled');
    expect(anchors()).toEqual([]);
  });
  it.each(['paused', 'ended'] as const)('%s remains excluded', async (status) => {
    await seed();
    await putStatus(status);
    expect(readLivingDocs().plan?.status).toBe(status);
    const refresh = await runCheckInRefresh();
    expect(refresh?.due ?? false).toBe(false);
    expect(out<TodayView>(await dispatch('today.get', {})).checkIn.due).toBe(false);
  });
  it('a scheduled catch-up under stored routine opt-in confirms the current date exactly once', async () => {
    await seed();
    await putStatus('scheduled');
    setOptIn(true);
    vi.setSystemTime(NOON(addDays(TODAY, 1)));
    expect(await runCheckInRefresh()).toMatchObject({ due: true, autoConfirmed: true });
    expect(await runCheckInRefresh()).toMatchObject({ due: false, autoConfirmed: false });
    expect(anchors()).toHaveLength(1);
    expect(anchors()[0]).toMatchObject({ anchorDate: addDays(TODAY, 1) });
  });
});

describe('composite pending dependency identity', () => {
  it('current-day symptoms invalidate an old preview before writes', async () => {
    await seed();
    const first = (await runCheckInRefresh())!;
    out(
      await dispatch('log.subjective', {
        symptom: { category: 'exertionalChestDiscomfort', status: 'new', context: 'exertional' },
      }),
    );
    await assertConflict(first.key!);
    const next = (await runCheckInRefresh())!;
    expect(next.key).not.toBe(first.key);
    expect(preview()?.review.status).toBe('review');
    expect(anchors()).toEqual([]);
  });
  it('a current-night sleep correction changes the preview and keeps manual confirmation available', async () => {
    await seed();
    out(
      await dispatch('log.sleep', { bedAt: `${addDays(TODAY, -1)}T23:00:00Z`, wakeAt: `${TODAY}T07:00:00Z` }),
    );
    const first = (await runCheckInRefresh())!;
    const sleep = getDocumentStore()
      .peekAll<{ kind: string }>('dailyLogs')
      .find((d) => d.kind === 'sleep')!;
    out(await dispatch('log.edit', { entryId: sleep._id, patch: { wakeAt: `${TODAY}T06:00:00Z` } }));
    await assertConflict(first.key!);
    expect((await runCheckInRefresh())!.key).not.toBe(first.key);
  });
  it.each(['revision', 'retraction'] as const)('source %s invalidates the estimate cache', async (change) => {
    await seed();
    const first = (await runCheckInRefresh())!;
    if (change === 'revision') await correctWeight('w12', 88);
    else out(await dispatch('log.retract', { entryId: 'w12' }));
    await assertConflict(first.key!);
    const next = (await runCheckInRefresh())!;
    expect(next.key).not.toBe(first.key);
    expect(anchors()).toEqual([]);
  });
  it('a genuine prior confirmed-state sync changes derived identity while raw realised history stays fixed', async () => {
    await seed();
    vi.setSystemTime(NOON(addDays(START, 7)));
    out(await dispatch('plan.checkIn', {}));
    const prior = anchors()[0] as unknown as ConfirmedStateRecord;
    await migration(async (tx) => {
      await tx.remove('anchors', `${PLAN_ID}:${addDays(START, 7)}`);
    });
    vi.setSystemTime(NOON(TODAY));
    const beforeDocs = readLivingDocs();
    const first = (await runCheckInRefresh())!;
    const rawBefore = projectLiving({
      docs: beforeDocs,
      today: TODAY,
      tz: timeZone(),
      now: NOON(TODAY).toISOString(),
      skipAssimilation: true,
    }).history?.contentHash;
    await migration(async (tx) => {
      await tx.put('anchors', { ...prior, _id: `${PLAN_ID}:${prior.anchorDate}` });
    });
    const afterDocs = readLivingDocs();
    expect(
      projectLiving({
        docs: afterDocs,
        today: TODAY,
        tz: timeZone(),
        now: NOON(TODAY).toISOString(),
        skipAssimilation: true,
      }).history?.contentHash,
    ).toBe(rawBefore);
    await assertConflict(first.key!);
    expect((await runCheckInRefresh())!.key).not.toBe(first.key);
    expect(anchors()).toHaveLength(1);
  });
  it('stage1 refit invalidates dependent previews without creating another decision or correction step', async () => {
    await seed();
    vi.setSystemTime(NOON(addDays(START, 7)));
    out(await dispatch('plan.checkIn', {}));
    vi.setSystemTime(NOON(TODAY));
    const first = (await runCheckInRefresh())!;
    const saved = anchors();
    await correctWeight('w06', 89);
    await runAssimilation();
    expect(
      getDocumentStore()
        .peekAll<{ kind: string }>('derived')
        .some((d) => d.kind === 'vitals.derivedAnchor'),
    ).toBe(true);
    await assertConflict(first.key!);
    expect((await runCheckInRefresh())!.key).not.toBe(first.key);
    expect(anchors()).toEqual(saved);
  });
  it('unchanged permutations and retries keep the same key, and fresh estimate equals confirmation', async () => {
    await seed();
    const docs = readLivingDocs();
    const inputs = (d: typeof docs) =>
      pendingCheckInOf({
        docs: d,
        projection: projectLiving({
          docs: d,
          today: TODAY,
          tz: timeZone(),
          now: NOON(TODAY).toISOString(),
          skipAssimilation: true,
        }),
        today: TODAY,
      })!;
    const first = inputs(docs);
    const permuted = inputs({
      ...docs,
      entries: [...docs.entries].reverse(),
      measurements: [...docs.measurements].reverse(),
      records: [...docs.records].reverse(),
    });
    expect(permuted.evidence.key).toBe(first.evidence.key);
    await runCheckInRefresh();
    const estimate = preview()!.estimate!;
    expect((await runCheckInRefresh())!.wrote).toBe(false);
    const confirmed = out<{
      verdict: string;
      trend: { w: number } | null;
      energyBias: { mean: number };
      decision: { key: string };
    }>(await dispatch('plan.checkIn', { previewId: first.evidence.previewId }));
    expect(confirmed.decision.key).toBe(first.evidence.key);
    expect(confirmed.verdict).toBe(estimate.verdict);
    expect(confirmed.trend?.w ?? null).toBe(estimate.trendKg);
    expect(confirmed.energyBias.mean).toBe(estimate.correctionKcal);
  });
});

describe('routine-only command-side authorization', () => {
  it.each(['illness', 'travel', 'dietBreak', 'creatineStart'])(
    '%s is a visible pending Review; opt-in writes no anchor/proposal and explicit confirmation stays available',
    async (kind) => {
      await seed();
      await event(kind);
      setOptIn(true);
      expect(await runCheckInRefresh()).toMatchObject({ due: true, autoConfirmed: false });
      expect(preview()).toMatchObject({
        status: 'Review',
        review: { status: 'review', reasons: expect.arrayContaining([{ code: kind, date: TODAY }]) },
      });
      expect(createDocumentLivingSource().checkIn(TODAY)?.review).toBe(true);
      expect((await automatic()).ok).toBe(false);
      expect(anchors()).toEqual([]);
      expect(versions()).toHaveLength(1);
      expect((await dispatch('plan.checkIn', { previewId: `ci-${preview()!.key}` })).ok).toBe(true);
      expect(anchors()).toHaveLength(1);
    },
  );
  it('DXA scans and a new block require pending review before confirmation', async () => {
    await seed();
    await migration(async (tx) => {
      await tx.append('measurements', {
        _id: 'scan',
        date: TODAY,
        metric: 'bodyFatPct',
        value: 25,
        method: 'dxa',
        source: { by: 'user', method: 'typed' },
      });
      const head = versions()[0]!;
      await tx.append('planVersions', {
        ...head,
        version: 2,
        schedule: { ...head.schedule, blocks: [{ name: 'new', startDay: 10, endDay: 28 }] },
        _id: `${PLAN_ID}:v2`,
      });
    });
    setOptIn(true);
    expect(await runCheckInRefresh()).toMatchObject({ autoConfirmed: false });
    expect(preview()?.review.reasons.map((r) => r.code)).toEqual(
      expect.arrayContaining(['compositionScan', 'newBlock']),
    );
    expect(anchors()).toEqual([]);
  });
  it('the opt-in actor cannot authorize while policy is currently off', async () => {
    await seed();
    await runCheckInRefresh();
    expect((await automatic()).ok).toBe(false);
    expect(anchors()).toEqual([]);
    expect(versions()).toHaveLength(1);
  });
  it('revocation during an awaited planner preparation creates no anchor, correction or proposal', async () => {
    await seed();
    setOptIn(true);
    installLivingPorts({
      planner: {
        replan: async (req) => {
          await Promise.resolve();
          setOptIn(false);
          return {
            status: 'proposal',
            plan: { ...req.plan, version: 2 },
            diff: [],
            forecast: { asPrescribed: [], realistic: [], bands: {} },
            goalDates: [],
            proposals: [],
            explanation: [],
            euUsed: 0,
          } as unknown as ReplanResult;
        },
      },
      revalidate: async () => null,
    });
    const result = await automatic();
    expect(result.ok).toBe(false);
    expect(anchors()).toEqual([]);
    expect(versions()).toHaveLength(1);
  });
  it('an event arriving during awaited planner preparation rejects the reviewed identity before any proposal write', async () => {
    await seed();
    await runCheckInRefresh();
    const key = preview()!.key!;
    installLivingPorts({
      planner: {
        replan: async (req) => {
          await event('illness');
          return {
            status: 'proposal',
            plan: { ...req.plan, version: 2 },
            diff: [],
            forecast: { asPrescribed: [], realistic: [], bands: {} },
            goalDates: [],
            proposals: [],
            explanation: [],
            euUsed: 0,
          } as unknown as ReplanResult;
        },
      },
      revalidate: async () => null,
    });
    await assertConflict(key);
    expect(anchors()).toEqual([]);
    expect(versions()).toHaveLength(1);
  });
  it('unrelated current logging does not churn the pending decision', async () => {
    await seed();
    const first = (await runCheckInRefresh())!;
    out(await dispatch('log.measurement', { metric: 'waistCm', value: 100 }));
    // Waist is consumed: change expected; an unrelated note is not.
    const second = (await runCheckInRefresh())!;
    expect(second.key).not.toBe(first.key);
    await migration(async (tx) => {
      await tx.append('dailyLogs', {
        _id: 'note',
        date: TODAY,
        tz: 'UTC',
        kind: 'note',
        text: 'A note',
        source: { by: 'user', method: 'typed' },
      });
    });
    expect((await runCheckInRefresh())!.key).toBe(second.key);
  });
  it('default false and strict import validation retain explicit user authority', () => {
    expect(DEFAULT_SETTINGS.checkInAutoConfirm).toBe(false);
    expect(isSettingsState({ checkInAutoConfirm: 'true' })).toBe(false);
    expect(isSettingsState({ checkInAutoConfirm: true })).toBe(true);
  });
});

describe('final anchored scenario target freezing', () => {
  const ctx = {
    planId: 'clinical',
    today: START,
    now: `${START}T12:00:00Z`,
    createdBy: { kind: 'user' as const },
    versions: { engineVersion: 'e', registryHash: 'r', catalogueVersion: 'c' },
  };
  it.each([
    ['sbp', -5, 135],
    ['sbp', 0, 140],
    ['fastingGlucose', -0.3, 5.7],
    ['fastingGlucose', 0, 6],
  ] as const)(
    '%s change %s freezes once at real scenario start, including clinical-only requests',
    (metric, delta, expected) => {
      const profile: PersonProfile = { ...MAN, labs: { sbpMmHg: 140, fastingGlucoseMmolL: 6 } };
      const result = startFromScenario(
        ctx,
        { id: 'scenario', rev: '1', name: 'Scenario', schedule: SCHEDULE },
        profile,
        [{ metric, direction: 'target', target: delta, targetKind: 'change' }],
        { startDate: START },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.plan.request.goals[0]).toMatchObject({
        targetKind: 'absolute',
        target: expected,
        targetOrigin: { kind: 'change', delta, baseline: expected - delta },
      });
      expect(result.subject.request).toEqual(result.plan.request);
      const restored = JSON.parse(JSON.stringify(result.plan));
      expect(freezeGoalTargets(restored.request.goals, new Map([[0, 130]]))[0]?.target).toBe(expected);
    },
  );
  it('absolute goals and a goal-free scenario stay unchanged', () => {
    const goals = [
      { metric: 'sbp' as const, direction: 'target' as const, target: 135, targetKind: 'absolute' as const },
    ];
    const start = (gs: typeof goals) =>
      startFromScenario(ctx, { id: 's', rev: '1', name: 's', schedule: SCHEDULE }, MAN, gs, {
        startDate: START,
      });
    const result = start(goals);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan.request.goals).toEqual(goals);
    const empty = start([]);
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.plan.request.goals).toEqual([]);
  });
  it('a missing clinical baseline preserves unresolved intent without inventing a finite target', () => {
    const goal = {
      metric: 'sbp' as const,
      direction: 'target' as const,
      target: -5,
      targetKind: 'change' as const,
    };
    const result = startFromScenario(ctx, { id: 's', rev: '1', name: 's', schedule: SCHEDULE }, MAN, [goal], {
      startDate: START,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.request.goals).toEqual([goal]);
    expect(JSON.stringify(result.plan)).not.toContain('NaN');
  });
});

describe('scenario adoption and legacy frozen provenance', () => {
  it.each(['change', 'absolute'] as const)('actual scenario adoption uses final baseline for %s and keeps explicit absolute intent', async (targetKind) => {
    await getDocumentStore().ready;
    vi.setSystemTime(NOON(START));
    const previewProfile: PersonProfile = { ...MAN, labs: { sbpMmHg: 140 } };
    const finalProfile: PersonProfile = { ...MAN, labs: { sbpMmHg: 150 } };
    const goal = targetKind === 'change'
      ? { metric: 'sbp' as const, direction: 'target' as const, target: -5, targetKind, targetOrigin: { kind: 'change' as const, delta: -5, baseline: 140 } }
      : { metric: 'sbp' as const, direction: 'target' as const, target: 135, targetKind };
    const originalIntent = JSON.parse(JSON.stringify(goal));
    vi.spyOn(profileState, 'simulatorProfileNow').mockReturnValue(finalProfile);
    vi.spyOn(plannerState, 'runState').mockReturnValue({
      ...plannerState.runState(),
      request: { profile: previewProfile, goals: [goal], horizonDays: 28 },
    });
    vi.spyOn(scheduleState, 'scenarioById').mockReturnValue({
      id: 'scenario', updatedAt: `${START}T00:00:00Z`, name: 'Scenario', schedule: SCHEDULE,
    } as ReturnType<typeof scheduleState.scenarioById>);
    const expected = targetKind === 'change' ? 145 : 135;
    const reviewedTargets: Array<number | undefined> = [];
    installLivingPorts({
      planner: undefined as never,
      revalidate: async (i) => {
        reviewedTargets.push(i.request.goals[0]?.target);
        return { status: 'verified', startable: true, certificateValid: true };
      },
    });
    expect((await dispatch('plan.start', { source: { scenarioId: 'scenario' }, startDate: START })).ok).toBe(true);
    expect(reviewedTargets).toEqual([expected]);
    const saved = bodyOf<PlanDoc>(getDocumentStore().peekAll('plans')[0]!);
    expect(saved.request.goals[0]).toMatchObject({ targetKind: 'absolute', target: expected });
    if (targetKind === 'change') expect(saved.request.goals[0]?.targetOrigin).toEqual({ kind: 'change', delta: -5, baseline: 150 });
    expect(goal).toEqual(originalIntent);
  });
  it('actual scenario plan.start stores the target from its final140 baseline before lifecycle revalidation, and reload keeps135', async () => {
    await getDocumentStore().ready;
    vi.setSystemTime(NOON(START));
    const profile: PersonProfile = { ...MAN, labs: { sbpMmHg: 140 } };
    const goals = [
      { metric: 'sbp' as const, direction: 'target' as const, target: -5, targetKind: 'change' as const },
    ];
    vi.spyOn(profileState, 'simulatorProfileNow').mockReturnValue(profile);
    vi.spyOn(plannerState, 'runState').mockReturnValue({
      ...plannerState.runState(),
      request: { profile, goals, horizonDays: 28 },
    });
    vi.spyOn(scheduleState, 'scenarioById').mockReturnValue({
      id: 'scenario',
      updatedAt: `${START}T00:00:00Z`,
      name: 'Scenario',
      schedule: SCHEDULE,
    } as ReturnType<typeof scheduleState.scenarioById>);
    const subjects: unknown[] = [];
    installLivingPorts({
      planner: undefined as never,
      revalidate: async (i) => {
        subjects.push(i.request.goals);
        return { status: 'verified', startable: true, certificateValid: true };
      },
    });
    expect((await dispatch('plan.start', { source: { scenarioId: 'scenario' }, startDate: START })).ok).toBe(
      true,
    );
    expect(subjects).toEqual([
      [
        expect.objectContaining({
          target: 135,
          targetKind: 'absolute',
          targetOrigin: { kind: 'change', delta: -5, baseline: 140 },
        }),
      ],
    ]);
    const saved = bodyOf<PlanDoc>(getDocumentStore().peekAll('plans')[0]!);
    expect(saved.request.goals[0]?.target).toBe(135);
    vi.setSystemTime(NOON(TODAY));
    expect((await readDocs()).plan?.request.goals[0]?.target).toBe(135);
    expect(readLivingDocs().plan?.request.goals[0]?.target).toBe(135);
  });
  it('legacy relative scenario targets reconstruct only from the original compatible frozen start subject', async () => {
    await seed();
    const docs = readLivingDocs();
    const plan = docs.plan!;
    const legacy = {
      ...plan,
      origin: { kind: 'scenario' as const, scenarioId: 's', scenarioRev: '1' },
      baselineProfile: { ...MAN, labs: { sbpMmHg: 140 } },
      request: {
        ...plan.request,
        profile: { ...MAN, labs: { sbpMmHg: 130 } },
        goals: [
          { metric: 'sbp' as const, direction: 'target' as const, target: -5, targetKind: 'change' as const },
        ],
      },
    };
    const migrated = restoreScenarioGoalTargets(legacy, docs.versions);
    expect(migrated.request.goals[0]?.target).toBe(135);
    expect(restoreScenarioGoalTargets(migrated, docs.versions)).toEqual(migrated);
    expect(
      restoreScenarioGoalTargets({ ...legacy, baselineProfile: MAN }, docs.versions).request.goals,
    ).toEqual(legacy.request.goals);
    expect(restoreScenarioGoalTargets(legacy, [])).toBe(legacy);
  });
  it('unrecoverable clinical intent is pending Review and excluded, while an unrelated supported aim stays usable', () => {
    const ctx = compileRequest({
      profile: MAN,
      goals: [
        { metric: 'sbp', direction: 'target', target: -5, targetKind: 'change' },
        { metric: 'leanTissue', direction: 'maximise' },
      ],
      horizonDays: 28,
    });
    expect(ctx.goals.some((g) => g.metric === 'sbp')).toBe(false);
    expect(ctx.goals.some((g) => g.metric === 'leanTissue')).toBe(true);
    expect(ctx.goalReviews).toEqual(
      expect.arrayContaining([expect.objectContaining({ metric: 'sbp', reasonCode: 'needsAbsoluteTarget' })]),
    );
    expect(JSON.stringify(ctx.goalReviews)).not.toContain('NaN');
  });
  it('model plasma glucose relative targets freeze under their own operator and retain units and intent', () => {
    const profile: PersonProfile = { ...MAN, labs: { fastingGlucoseMmolL: 6 } };
    const result = startFromScenario(
      {
        planId: 'g',
        today: START,
        now: `${START}T12:00:00Z`,
        createdBy: { kind: 'user' },
        versions: { engineVersion: 'e', registryHash: 'r', catalogueVersion: 'c' },
      },
      { id: 's', rev: '1', name: 's', schedule: SCHEDULE },
      profile,
      [
        { metric: 'glucose', direction: 'target', target: -0.3, targetKind: 'change' },
        { metric: 'glucose', direction: 'target', target: 0, targetKind: 'change' },
      ],
      { startDate: START },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [lower, keep] = result.plan.request.goals;
    expect(lower?.targetKind).toBe('absolute');
    expect(keep?.targetKind).toBe('absolute');
    expect(lower!.target! + 0.3).toBeCloseTo(keep!.target!, 8);
    expect(lower?.targetOrigin?.delta).toBe(-0.3);
    expect(keep?.targetOrigin?.delta).toBe(0);
    expect(Number.isFinite(lower?.target)).toBe(true);
  });
});

describe('review resolution and awaited authorization races', () => {
  it('resolved symptoms restore routine eligibility without an extra explicit decision', async () => {
    await seed();
    out(
      await dispatch('log.subjective', {
        symptom: { category: 'exertionalChestDiscomfort', status: 'new', context: 'exertional' },
      }),
    );
    await runCheckInRefresh();
    expect(preview()?.review.status).toBe('review');
    out(
      await dispatch('log.subjective', {
        symptom: { category: 'exertionalChestDiscomfort', status: 'resolved', context: 'exertional' },
      }),
    );
    setOptIn(true);
    expect(await runCheckInRefresh()).toMatchObject({ autoConfirmed: true });
    expect(anchors()).toHaveLength(1);
  });
  it('an out-of-window disturbance does not suppress routine opt-in', async () => {
    await seed();
    await event('travel', addDays(START, -2));
    setOptIn(true);
    expect(await runCheckInRefresh()).toMatchObject({ autoConfirmed: true });
  });
  it('revocation while awaited lifecycle revalidation is pending creates no authoritative writes', async () => {
    await seed();
    setOptIn(true);
    installLivingPorts({
      planner: {
        replan: async (req) =>
          ({
            status: 'proposal',
            plan: { ...req.plan, version: 2 },
            diff: [],
            forecast: { asPrescribed: [], realistic: [], bands: {} },
            goalDates: [],
            proposals: [],
            explanation: [],
            euUsed: 0,
          }) as unknown as ReplanResult,
      },
      revalidate: async () => {
        await Promise.resolve();
        setOptIn(false);
        return null;
      },
    });
    expect((await automatic()).ok).toBe(false);
    expect(anchors()).toEqual([]);
    expect(versions()).toHaveLength(1);
  });
});


describe('BP raw-repeat command transport (A2-031 integration)',()=>{
  it('preserves full raw repeats and mean separately without treating the mean as an extra reading',async()=>{
    await seed();
    const repeats=[160,160,120];
    const {entryId}=out<{entryId:string}>(await dispatch('log.measurement',{metric:'sbpMmHg',value:repeats.reduce((a,b)=>a+b,0)/repeats.length,unit:'mmHg',episodeId:'raw-sitting',repeats,repeatsEncoding:'fullRawList'}));
    const docs=readLivingDocs();
    const record=docs.measurements.find((m)=>m.id===entryId)!;
    expect(record.repeats).toEqual(repeats);expect(record.repeatsEncoding).toBe('fullRawList');
    const episode=bpEpisodes(docs.measurements).find((e)=>e.id==='ep:raw-sitting')!;
    expect(episode.readings.sbp).toEqual([160,160,120]);
    expect(episode.readingIds.sbp).toHaveLength(3);
    expect(episode.sbp).toBeCloseTo(440/3,10);
    expect(record.value).toBeCloseTo(440/3,10);
  });
  it('preserves explicit primary/additional encoding and keeps absent legacy encoding unknown',async()=>{
    await seed();
    for(const encoding of ['primaryPlusAdditional',undefined] as const){
      out(await dispatch('log.measurement',{metric:'sbpMmHg',value:160,episodeId:encoding??'legacy',repeats:[160,120],...(encoding?{repeatsEncoding:encoding}:{})}));
    }
    const episodes=bpEpisodes(readLivingDocs().measurements);
    expect(episodes.find((e)=>e.id==='ep:primaryPlusAdditional')?.readings.sbp).toEqual([160,160,120]);
    const legacy=episodes.find((e)=>e.id==='ep:legacy')!;
    expect(legacy.readings.sbp).toEqual([]);expect(legacy.legacyRepeats[0]?.repeats).toEqual([160,120]);
  });
});
