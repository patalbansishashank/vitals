/**
 * Regression tests of the energy-core audit fixes (impl-audit claude-core F1, F2, F8, F11, F14; codex-core #7, #9, #13,
 * #14), through the command bus as the app runs them. The scenarios are the auditor's (`/tmp/claude-1000/eaudit`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mintWriteToken, bodyOf } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import { useSettingsStore } from '@/state/settingsStore';
import { withSystemWrite } from '@/state/scope';
import { dispatch, settleCommits, type CommandResult } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { useProfileStore } from '@/state/profileStore';
import {
  addDays,
  DEFAULT_ITEM_WEIGHTS,
  effectiveEntries,
  localToInstant,
  type LogEntry,
  type PlanDoc,
  type PlanVersionDoc,
} from '@/living';
import {
  candidateKeyOf,
  type ActivityCandidateDoc,
  type ReviewSheetModel,
} from '@/living/activityCandidates';
import type { DayTemplate } from '@/engine';

const PLAN_ID = '01JABCDEFGHJKMNPQRSTVWXY55';
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const START = '2026-10-14';
const TODAY = '2026-10-21';
const Y = addDays(TODAY, -1);
const SYS = { actor: { kind: 'system' as const, id: 'gauge-import' } };
const REST: DayTemplate = {
  id: 'R',
  label: 'rest day',
  energy: { kind: 'kcal', kcal: 2100 },
  macros: {
    protein: { unit: 'g', value: 150 },
    carbs: { unit: 'g', value: 200 },
    fat: { unit: 'remainder' },
  },
  steps: 8000,
  sleep: { bedH: 23, wakeH: 7 },
};

const ms = (date: string, h: number) => Date.parse(localToInstant(date, h, TZ));
const out = <T>(r: CommandResult): T => {
  if (!r.ok || !('output' in r)) throw new Error(JSON.stringify(r));
  return r.output as T;
};

/** (0.6.3 S2) The person's own basics: the estimators never fall back to the typical ones (these are the values they showed). */
function enterBasics(): void {
  const p = useProfileStore.getState();
  p.setAge(40);
  p.setHeight(169);
  p.setWeight(80);
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(ms(TODAY, 12)));
});
afterAll(() => {
  vi.useRealTimers();
});

async function seed(): Promise<void> {
  freshState({ cleared: true });
  enterBasics();
  const store = getDocumentStore();
  await store.ready;
  const profile = {
    schemaVersion: 1 as const,
    body: { sex: 'male' as const, ageYears: 40, heightCm: 180, weightKg: 80 },
    startDate: START,
  };
  const plan: PlanDoc = {
    name: 'Plan',
    rung: 'medium',
    origin: { kind: 'planner', requestHash: 'h', runAt: `${START}T06:00:00.000Z` },
    status: 'active',
    startDate: START,
    plannedEndDate: addDays(START, 28),
    request: { profile, goals: [], horizonDays: 28 },
    baselineProfile: profile,
    headVersion: 1,
    pauses: [],
    intentions: {},
    policy: { checkInWeekday: 0, autoApplyLoadLowering: true },
    createdAt: `${START}T06:00:00.000Z`,
  };
  const version: PlanVersionDoc = {
    planId: PLAN_ID,
    version: 1,
    parent: null,
    status: 'adopted',
    reason: 'start',
    effectiveFromDay: 0,
    schedule: {
      schemaVersion: 1,
      startDate: START,
      horizonDays: 28,
      programs: [REST],
      days: Array.from({ length: 28 }, () => ({ program: 0 })),
    },
    genome: null,
    sessions: {},
    sensitivities: { planVersion: 'v1', itemWeights: { ...DEFAULT_ITEM_WEIGHTS }, intentByItem: {} },
    forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] },
    explanation: [],
    provenance: { engineVersion: 'e', registryHash: 'r', catalogueVersion: 'c' },
    createdBy: { kind: 'system' },
    createdAt: `${START}T06:00:00.000Z`,
  };
  await store.transact(mintWriteToken('migration', { label: 'test seed' }), async (tx) => {
    await tx.put('plans', { ...plan, _id: PLAN_ID });
    await tx.append('planVersions', { ...version, _id: `${PLAN_ID}:v1` });
    await tx.put('activePlan', { _id: 'me', planId: PLAN_ID, since: START });
  });
}

type Gs = {
  id: string;
  revision: string;
  start: number;
  end: number;
  type: string;
  kcal?: number;
  pauses?: Array<{ start: number; end: number }>;
};
const runY = (rev = 'r1'): Gs => ({
  id: 'g-run',
  revision: rev,
  start: ms(Y, 18),
  end: ms(Y, 18.5),
  type: 'run',
  kcal: 330,
});

async function fromGauge(input: Record<string, unknown>) {
  const r = await dispatch('activity.fromGauge', { gaugeSessions: [], hcSessions: [], ...input }, SYS);
  await settleCommits();
  return out<{ created: string[]; updated: string[]; superseded: string[] }>(r);
}
async function review(): Promise<ReviewSheetModel> {
  return out<ReviewSheetModel>(await dispatch('activity.candidates', { from: Y, to: Y }));
}
function sessions(): Array<Extract<LogEntry, { kind: 'session' }>> {
  const all = getDocumentStore()
    .peekAll<LogEntry>('dailyLogs')
    .map((d) => ({ ...bodyOf<LogEntry>(d), id: d._id }) as LogEntry);
  return effectiveEntries(all).filter(
    (e): e is Extract<LogEntry, { kind: 'session' }> => e.kind === 'session',
  );
}
const candidate = (key: string) =>
  bodyOf<ActivityCandidateDoc>(getDocumentStore().peek('activityCandidates', `cand:${key}`)!);

/** A minute grid over day Y: `fill(minuteOfDay)` gives the steps (and optional HR). */
function grid(fill: (m: number) => { steps: number | null; bpm?: number | null }) {
  const steps: Array<number | null> = [];
  const hrBpm: Array<number | null> = [];
  const hrSupportedS: Array<number | null> = [];
  for (let m = 0; m < 1440; m++) {
    const v = fill(m);
    steps.push(v.steps);
    hrBpm.push(v.bpm ?? null);
    hrSupportedS.push(v.bpm ? 60 : null);
  }
  return [{ first: ms(Y, 0), steps, hrBpm, hrSupportedS }];
}

beforeEach(seed);

describe('F1: an edit is not "updated", and Approve all keeps it', () => {
  it('the edited run leaves the review list; new evidence asks again and approving keeps the 40 min / 480 kcal edit', async () => {
    await fromGauge({ gaugeSessions: [runY()] });
    const row = (await review()).rows[0]!;
    await dispatch('activity.approve', { id: row.id, revision: row.revision });
    await settleCommits();
    const ed = await dispatch('activity.edit', {
      id: row.id,
      revision: row.revision,
      endAt: new Date(ms(Y, 18 + 40 / 60)).toISOString(),
      kcalOverride: 480,
    });
    await settleCommits();
    expect(ed.ok).toBe(true);
    expect((await review()).rows).toEqual([]);
    // (r069) the Gauge session is re-sent upstream (a new revision, the same recording): the edit books the same 40 min /
    // 480 kcal over it, so it stays decided (the owner approved the same activities again and again)
    await fromGauge({ gaugeSessions: [runY('r2')] });
    expect((await review()).rows).toEqual([]);
    expect(candidate(row.id).status).toBe('edited');
    const s = sessions();
    expect(s).toHaveLength(1);
    expect(s[0]!.durationMin).toBeCloseTo(40, 6);
    expect(s[0]!.cost?.grossKcal).toBeCloseTo(480, 6);
  });

  it('(r070) an approval whose recording changes its times stands: it never asks again and books what the person approved', async () => {
    await fromGauge({ gaugeSessions: [runY()] });
    const row = (await review()).rows[0]!;
    await dispatch('activity.approve', { id: row.id, revision: row.revision });
    await settleCommits();
    expect((await review()).rows).toEqual([]);
    const before = sessions();
    // Gauge corrects the recording: it ended 20 minutes later
    await fromGauge({ gaugeSessions: [{ ...runY('r2'), end: ms(Y, 18 + 50 / 60) }] });
    const m = await review();
    expect(m.rows).toEqual([]);
    expect(m.decided.map((r) => ({ status: r.status, updated: r.updated }))).toEqual([{ status: 'approved', updated: false }]);
    expect(candidate(row.id).updatedFrom).toBeUndefined();
    expect(sessions()).toEqual(before);
    expect(sessions()).toHaveLength(1);
    // and the automatic rules leave it alone
    await dispatch('activity.autoAccept', {});
    await settleCommits();
    expect(sessions()).toEqual(before);
    expect(candidate(row.id).decidedBy).toBe('user');
  });

  it('(r070) an automatic decision follows its recording: the corrected times are booked again, silently', async () => {
    await fromGauge({ gaugeSessions: [runY()] });
    const auto = await dispatch('activity.autoAccept', {});
    await settleCommits();
    expect(auto.ok).toBe(true);
    const row = (await review()).decided[0]!;
    expect(row.auto?.from.kind).toBe('gauge');
    expect(candidate(row.id).decidedBy).toBe('auto');
    expect(sessions()[0]!.durationMin).toBeCloseTo(30, 6);
    await fromGauge({ gaugeSessions: [{ ...runY('r2'), end: ms(Y, 18 + 50 / 60) }] });
    await dispatch('activity.autoAccept', {});
    await settleCommits();
    const m = await review();
    expect(m.rows).toEqual([]);
    expect(candidate(row.id).updatedFrom).toBeUndefined();
    expect(sessions()).toHaveLength(1);
    expect(sessions()[0]!.durationMin).toBeCloseTo(50, 6);
  });
});

describe('F2: a detector candidate and the later Gauge session of the same walk', () => {
  const walkMinutes = () => grid((m) => ({ steps: m >= 18 * 60 && m < 18 * 60 + 30 ? 110 : 0 }));
  const gw2 = { id: 'g-w2', revision: 'r1', start: ms(Y, 18), end: ms(Y, 18.5), type: 'walk', kcal: 150 };

  it('pending: the detector candidate is superseded by the session; one row, Approve all books one session', async () => {
    const minutes = walkMinutes();
    const p1 = await fromGauge({ minutes });
    expect(p1.created).toHaveLength(1);
    const k1 = p1.created[0]!;
    const p2 = await fromGauge({ gaugeSessions: [gw2], minutes });
    expect(p2.superseded).toEqual([k1]);
    const m = await review();
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0]!.sources.map((s) => s.source)).toEqual(['gaugeSession']);
    expect(candidate(k1)).toMatchObject({ status: 'superseded', supersededBy: m.rows[0]!.id });
    await dispatch('activity.approveAll', m.approveAll);
    await settleCommits();
    expect(sessions()).toHaveLength(1);
    // a third pass keeps it one candidate
    await fromGauge({ gaugeSessions: [gw2], minutes });
    expect((await review()).rows).toEqual([]);
  });

  it('approved: the session becomes evidence of the approved detector candidate (one activity, still approved)', async () => {
    const minutes = walkMinutes();
    await fromGauge({ minutes });
    const r1 = (await review()).rows[0]!;
    await dispatch('activity.approve', { id: r1.id, revision: r1.revision });
    await settleCommits();
    await fromGauge({ gaugeSessions: [gw2], minutes });
    // (r069) the recording books the same walk the person approved: no second review (the owner's bike ride came back
    // to review when Google Fit's session of it arrived)
    expect((await review()).rows).toEqual([]);
    expect(candidate(r1.id)).toMatchObject({ status: 'approved' });
    expect(candidate(r1.id).refs).toContain('gauge:g-w2');
    expect(sessions()).toHaveLength(1);
  });

  it('two open rows that suggest merging are held out of Approve all', async () => {
    await fromGauge({
      gaugeSessions: [gw2],
      // (0.6.7) a partial overlap: a near-identical copy would attach to the recording instead of being held
      hcSessions: [
        {
          id: 'hc-w',
          revision: 'h1',
          start: ms(Y, 18 + 10 / 60),
          end: ms(Y, 18 + 50 / 60),
          exerciseType: 79,
          originPackage: 'com.google.android.apps.fitness',
        },
      ],
    });
    const m = await review();
    expect(m.rows).toHaveLength(2);
    expect(m.approveAll.items).toEqual([]);
    expect(m.approveAll.held?.map((h) => h.id).sort()).toEqual(m.rows.map((r) => r.id).sort());
  });
});

describe('F8: pauses are not exercise', () => {
  it('a 60-min walk with 20 min paused books 40 min and less energy', async () => {
    const plain: Gs = { id: 'g-a', revision: 'r1', start: ms(Y, 9), end: ms(Y, 10), type: 'walk' };
    const paused: Gs = {
      id: 'g-b',
      revision: 'r1',
      start: ms(Y, 14),
      end: ms(Y, 15),
      type: 'walk',
      pauses: [{ start: ms(Y, 14 + 20 / 60), end: ms(Y, 14 + 40 / 60) }],
    };
    await fromGauge({ gaugeSessions: [plain, paused] });
    const m = await review();
    await dispatch('activity.approveAll', m.approveAll);
    await settleCommits();
    const [a, b] = sessions().sort((x, y) => (x.startH ?? 0) - (y.startH ?? 0));
    expect(a!.durationMin).toBeCloseTo(60, 6);
    expect(b!.durationMin).toBeCloseTo(40, 6);
    expect(b!.cost!.grossKcal).toBeCloseTo((a!.cost!.grossKcal * 40) / 60, 3);
    // (r063 S10/A15) the replay keeps the pause in place: two moving parts of 20 min, one bout, one recovery booking
    expect(b!.engine!.map((x) => [x.startH, x.durationMin, x.boutDurationMin])).toEqual([
      [expect.closeTo(14, 6), expect.closeTo(20, 6), expect.closeTo(40, 6)],
      [expect.closeTo(14 + 40 / 60, 6), expect.closeTo(20, 6), expect.closeTo(40, 6)],
    ]);
    expect(new Set(b!.engine!.map((x) => x.boutId)).size).toBe(1);
    expect(b!.moving).toHaveLength(2);
  });
});

describe('F11: the sleeping low HR reaches the profile; zones are frozen at approval', () => {
  it('with the D6 opt-in the frozen boundaries use HRR on the sleeping low; a later profile change leaves them', async () => {
    withSystemWrite(
      () =>
        useSettingsStore.setState({
          hrProfile: { hrMaxOverride: null, hrRestOverride: null, useSleepLowAsRest: true },
        }),
      'test',
    );
    await fromGauge({ gaugeSessions: [runY()], sleepingLowHr: 50 });
    const row = (await review()).rows[0]!;
    await dispatch('activity.approve', { id: row.id, revision: row.revision });
    await settleCommits();
    const z = sessions()[0]!.zones!;
    expect(z).toMatchObject({ basis: 'hrr', hrRest: 50, hrMax: 180 });
    withSystemWrite(
      () =>
        useSettingsStore.setState({
          hrProfile: { hrMaxOverride: 200, hrRestOverride: null, useSleepLowAsRest: false },
        }),
      'test',
    );
    expect(sessions()[0]!.zones).toEqual(z);
  });
});

describe('Codex #7: corrected HR evidence', () => {
  const walk: Gs = { id: 'g-hr', revision: 'r1', start: ms(Y, 18), end: ms(Y, 18 + 20 / 60), type: 'walk' };
  const inWalk = (m: number) => m >= 18 * 60 && m < 18 * 60 + 20;
  const withBpm = (bpm: number) => ({ gaugeSessions: [walk], minutes: grid((m) => ({ steps: inWalk(m) ? 100 : 0, bpm: inWalk(m) ? bpm : null })) });

  it('(r070) does not reopen the person\'s approval: it stays decided and booked as approved', async () => {
    await fromGauge(withBpm(110));
    const row = (await review()).rows[0]!;
    await dispatch('activity.approve', { id: row.id, revision: row.revision });
    await settleCommits();
    const before = sessions();
    // re-importing the same evidence changes nothing
    await fromGauge(withBpm(110));
    expect((await review()).rows).toEqual([]);
    await fromGauge(withBpm(160));
    const m = await review();
    expect(m.rows).toEqual([]);
    expect(m.decided.map((r) => r.updated)).toEqual([false]);
    expect(sessions()).toEqual(before);
  });

  it('(r070) an automatic decision is booked again over the corrected HR', async () => {
    await fromGauge(withBpm(110));
    await dispatch('activity.autoAccept', {});
    await settleCommits();
    const before = sessions();
    await fromGauge(withBpm(110));
    await dispatch('activity.autoAccept', {});
    await settleCommits();
    expect(sessions()).toEqual(before);
    await fromGauge(withBpm(160));
    await dispatch('activity.autoAccept', {});
    await settleCommits();
    const m = await review();
    expect(m.rows).toEqual([]);
    expect(m.decided.map((r) => r.updated)).toEqual([false]);
    expect(sessions()).toHaveLength(1);
    expect(sessions()[0]).not.toEqual(before[0]);
  });
});

describe('Codex #9: moving an activity never invents step overlap', () => {
  it('moved hours away: unknown overlap; shortened inside the evidence: the fused steps of the new window', async () => {
    const walk: Gs = { id: 'g-st', revision: 'r1', start: ms(Y, 18), end: ms(Y, 18.5), type: 'walk' };
    const minutes = grid((m) => ({ steps: m >= 18 * 60 && m < 18 * 60 + 30 ? 100 : 0 }));
    await fromGauge({ gaugeSessions: [walk], minutes });
    const row = (await review()).rows[0]!;
    await dispatch('activity.approve', { id: row.id, revision: row.revision });
    await settleCommits();
    expect(sessions()[0]!.stepsIncluded).toBe(3000);
    await dispatch('activity.edit', {
      id: row.id,
      revision: row.revision,
      endAt: new Date(ms(Y, 18.25)).toISOString(),
    });
    await settleCommits();
    expect(sessions()[0]!.stepsIncluded).toBe(1500);
    await dispatch('activity.edit', {
      id: row.id,
      revision: row.revision,
      startAt: new Date(ms(Y, 22)).toISOString(),
      endAt: new Date(ms(Y, 22.5)).toISOString(),
    });
    await settleCommits();
    const s = sessions()[0]!;
    expect(s.startH).toBeCloseTo(22, 6);
    expect(s.stepsIncluded).toBeUndefined();
    expect((s.engine![0] as { stepsIncluded?: number }).stepsIncluded).toBeUndefined();
  });
});

describe('Codex #14: approval keeps the stated intensity and the RPE scale', () => {
  it('a vigorous CR10-7 manual log keeps its class and scale in performed and the engine session', async () => {
    const r = await dispatch('activity.logManual', {
      exerciseId: 'walk',
      date: Y,
      startH: 9,
      durationMin: 30,
      intensity: { class: 'vigorous', rpe: 7, rpeScale: 'cr10' },
    });
    await settleCommits();
    expect(r.ok).toBe(true);
    const s = sessions()[0]!;
    expect(s.performed[0]).toMatchObject({ rpe: 7, rpeScale: 'cr10', healthIntensityClass: 'vigorous' });
    expect(s.engine![0]).toMatchObject({
      healthIntensityClass: 'vigorous',
      healthClassSource: 'stated',
      rpe: 7,
      rpeScale: 'cr10',
    });
  });
});

describe('0.6.3 (after Codex #13): an explicit 0 kcal from the machine is booked as 0, never estimated', () => {
  it('logManual books the reported 0 and the session replays it (realised gross 0, MET 0)', async () => {
    const r = await dispatch('activity.logManual', {
      exerciseId: 'walk',
      date: Y,
      startH: 9,
      durationMin: 30,
      intensity: { class: 'moderate' },
      kcalOverride: 0,
    });
    expect(r.ok).toBe(true);
    await settleCommits();
    const [s] = sessions();
    expect(s!.cost).toMatchObject({ grossKcal: 0, netAboveRestKcal: 0 });
    expect(s!.engine).toEqual([expect.objectContaining({ kind: 'cardio', realisedGrossKcal: 0, met: 0 })]);
  });

  it('a negative override is still refused', async () => {
    const r = await dispatch('activity.logManual', {
      exerciseId: 'walk',
      date: Y,
      startH: 9,
      durationMin: 30,
      intensity: { class: 'moderate' },
      kcalOverride: -1,
    });
    expect(!r.ok && r.error.code).toBe('invalid_input');
  });
});

describe('F14: candidate keys do not depend on the device zone', () => {
  it('the same first evidence mints the same key in UTC and Asia/Kolkata (and with another rollover)', () => {
    const start = Date.parse('2026-10-20T23:00:00Z');
    expect(candidateKeyOf('gauge:w1', start, 'UTC', 4)).toBe(
      candidateKeyOf('gauge:w1', start, 'Asia/Kolkata', 4),
    );
    expect(candidateKeyOf('gauge:w1', start, 'Asia/Kolkata', 0)).toBe(
      candidateKeyOf('gauge:w1', start, 'America/Los_Angeles', 6),
    );
  });
});
