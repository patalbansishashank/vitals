/**
 * 0.6.3 ACT-A, the activity lifecycle through the command bus, with no plan (tracking works without one, S24/A7):
 *  - S2: "Needs weight" checks the raw basics, never the simulator profile's typical 80 kg / 40 years;
 *  - S3/A4: approving one of two duplicates never releases the other into Approve all (command layer included);
 *  - A5: a manual log that overlaps a recording asks first: replace, link, or separate;
 *  - S30: one Undo takes the whole manual-log change back (candidate, entry, alias, a replaced recording);
 *  - S13: an approved activity whose every source was deleted upstream leaves replay with an audit row;
 *  - S7/A10: the carry choice reaches the step-fusion context.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bodyOf } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import { dispatch, settleCommits, type CommandResult } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { useProfileStore } from '@/state/profileStore';
import { simulatorProfileNow } from '@/state/internal/simulatorProfile';
import { effectiveBasics } from '@/features/body/model';
import { pickBodyValues } from '@/state/internal/profileModel';
import { addDays, effectiveEntries, localToInstant, type LogEntry } from '@/living';
import { isUpdated, type ActivityCandidateDoc, type ReviewSheetModel } from '@/living/activityCandidates';
import { fuseActivitiesOf } from '@/state/gaugeImport';
import { logManualActivity } from '@/features/living/train/v3Adapter';
import { manualCheck, personOn, readCandidates } from '../activity';

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const TODAY = '2026-10-21';
const Y = addDays(TODAY, -1);
const SYS = { actor: { kind: 'system' as const, id: 'gauge-import' } };
const ms = (date: string, h: number) => Date.parse(localToInstant(date, h, TZ));
const out = <T>(r: CommandResult): T => {
  if (!r.ok || !('output' in r)) throw new Error(JSON.stringify(r));
  return r.output as T;
};

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(ms(TODAY, 12)));
});
afterAll(() => {
  vi.useRealTimers();
});

function enterBasics(
  b: { age?: number; height?: number; weight?: number } = { age: 40, height: 169, weight: 80 },
): void {
  const p = useProfileStore.getState();
  if (b.age !== undefined) p.setAge(b.age);
  if (b.height !== undefined) p.setHeight(b.height);
  if (b.weight !== undefined) p.setWeight(b.weight);
}

type Gs = { id: string; revision: string; start: number; end: number; type: string; kcal?: number; activityTypeId?: string };
const runY = (): Gs => ({
  id: 'g-run',
  revision: 'r1',
  start: ms(Y, 18),
  end: ms(Y, 18.5),
  type: 'run',
  kcal: 330,
});
// (0.6.7) a partial overlap (18:10–18:50 over the 18:00–18:30 run): held as a possible duplicate; a near-identical copy
// would now attach to the recording on its own
const hcRunY = {
  id: 'hc-run',
  revision: 'h1',
  start: ms(Y, 18 + 10 / 60),
  end: ms(Y, 18 + 50 / 60),
  exerciseType: 56,
  originPackage: 'com.google.android.apps.fitness',
};

async function fromGauge(i: {
  gaugeSessions?: Gs[];
  hcSessions?: Array<typeof hcRunY>;
  deletedRefs?: string[];
}) {
  const r = await dispatch(
    'activity.fromGauge',
    {
      gaugeSessions: i.gaugeSessions ?? [],
      hcSessions: i.hcSessions ?? [],
      ...(i.deletedRefs ? { deletedRefs: i.deletedRefs } : {}),
    },
    SYS,
  );
  await settleCommits();
  return out<{ created: string[]; superseded: string[] }>(r);
}
const review = async (from = Y, to = Y) =>
  out<ReviewSheetModel>(await dispatch('activity.candidates', { from, to }));
const allLogs = (): LogEntry[] =>
  getDocumentStore()
    .peekAll<LogEntry>('dailyLogs')
    .map((d) => ({ ...bodyOf<LogEntry>(d), id: d._id }) as LogEntry);
const sessions = () =>
  effectiveEntries(allLogs()).filter(
    (e): e is Extract<LogEntry, { kind: 'session' }> => e.kind === 'session',
  );
const candidate = async (key: string) => (await readCandidates()).byKey.get(key) as ActivityCandidateDoc;

beforeEach(async () => {
  freshState({ cleared: true });
  await getDocumentStore().ready;
});

describe('S2: "Needs weight" reads what the person entered', () => {
  it('the typical basics of the real profile builder never stand in for a weight or an age', async () => {
    // the simulator profile shows typical values, and says they are missing
    expect(simulatorProfileNow().body.weightKg).toBeGreaterThan(0);
    expect(effectiveBasics(pickBodyValues(useProfileStore.getState())).missing).toEqual(
      expect.arrayContaining(['weight', 'age', 'height']),
    );
    expect(personOn(Y)).toBeNull();
    const r = await dispatch('activity.logManual', {
      exerciseId: 'walk',
      date: Y,
      startH: 9,
      durationMin: 30,
      intensity: { class: 'moderate' },
    });
    expect(!r.ok && r.error).toMatchObject({
      code: 'precondition_failed',
      message: expect.stringMatching(/body weight/),
    });
    // an imported activity has no estimate, and approving it asks for the weight
    await fromGauge({ gaugeSessions: [runY()] });
    const row = (await review()).rows[0]!;
    expect(row.kcal).toBeNull();
    const a = await dispatch('activity.approve', { id: row.id, revision: row.revision });
    expect(!a.ok && a.error.message).toMatch(/body weight/);
    expect(sessions()).toHaveLength(0);
  });

  it('a dated weigh-in on or before the day counts; a later one does not', () => {
    const measurements = [{ date: TODAY, metric: 'weightKg', value: 70 }];
    expect(personOn(Y, { measurements })).toBeNull();
    expect(personOn(TODAY, { measurements })).toMatchObject({ massKg: 70, ageY: null, rmrKcalPerDay: null });
    expect(
      personOn(TODAY, { measurements: [{ date: Y, metric: 'weightKg', value: 70, assumed: true }] }),
    ).toBeNull();
  });

  it('an entered weight is enough to estimate; without an entered age the HR estimates have no age (no zones frozen)', async () => {
    enterBasics({ weight: 72 });
    expect(personOn(Y)).toMatchObject({ massKg: 72, ageY: null, sex: null, rmrKcalPerDay: null });
    const r = out<{ entryId: string }>(
      await dispatch('activity.logManual', {
        exerciseId: 'walk',
        date: Y,
        startH: 9,
        durationMin: 30,
        intensity: { class: 'moderate' },
      }),
    );
    await settleCommits();
    const e = sessions().find((x) => x.id === r.entryId)!;
    expect(e.zones).toBeUndefined();
    enterBasics({ age: 35, height: 170 });
    expect(personOn(Y)).toMatchObject({ massKg: 72, ageY: 35 });
    expect(personOn(Y)!.rmrKcalPerDay).toBeGreaterThan(1000);
  });
});

describe('S3/A4: duplicates wait for the person, in the command layer too', () => {
  beforeEach(() => enterBasics());

  it('approving one of two duplicates keeps the other held; Approve all and Approve refuse it until it is separate', async () => {
    await fromGauge({ gaugeSessions: [runY()], hcSessions: [hcRunY] });
    const m0 = await review();
    expect(m0.rows).toHaveLength(2);
    expect(m0.approveAll.items).toEqual([]);
    const [a, b] = m0.rows;
    out(await dispatch('activity.approve', { id: a!.id, revision: a!.revision }));
    await settleCommits();
    const m1 = await review();
    // the reproduction: B used to appear in approveAll.items here
    expect(m1.approveAll.items).toEqual([]);
    expect(m1.approveAll.held).toEqual([{ id: b!.id, withIds: [a!.id] }]);
    const all = await dispatch('activity.approveAll', { items: [{ id: b!.id, revision: b!.revision }] });
    expect(!all.ok && all.error).toMatchObject({ code: 'conflict', detail: { reason: 'duplicate' } });
    const one = await dispatch('activity.approve', { id: b!.id, revision: b!.revision });
    expect(!one.ok && one.error).toMatchObject({ code: 'conflict', detail: { reason: 'duplicate' } });
    const edit = await dispatch('activity.edit', {
      id: b!.id,
      revision: b!.revision,
      intensity: { class: 'vigorous' },
    });
    expect(!edit.ok && edit.error).toMatchObject({ code: 'conflict', detail: { reason: 'duplicate' } });
    await settleCommits();
    expect(sessions()).toHaveLength(1);
    // the person says they were two activities: both count, and nothing is held any more
    out(await dispatch('activity.approve', { id: b!.id, revision: b!.revision, separate: true }));
    await settleCommits();
    expect(sessions()).toHaveLength(2);
    expect((await candidate(b!.id)).separateFrom).toEqual([a!.id]);
    expect((await review()).approveAll.held).toBeUndefined();
  });

  it('rejecting the duplicate resolves it', async () => {
    await fromGauge({ gaugeSessions: [runY()], hcSessions: [hcRunY] });
    const [a, b] = (await review()).rows;
    out(await dispatch('activity.approve', { id: a!.id, revision: a!.revision }));
    out(await dispatch('activity.reject', { id: b!.id }));
    await settleCommits();
    const m = await review();
    expect(m.rows).toEqual([]);
    expect(sessions()).toHaveLength(1);
  });

  it('a recording arriving after a hand log of the same time is held as its duplicate', async () => {
    const man = out<{ id: string }>(
      await dispatch('activity.logManual', {
        exerciseId: 'jog_outdoor',
        date: Y,
        startH: 18,
        durationMin: 30,
        intensity: {},
      }),
    );
    await fromGauge({ gaugeSessions: [runY()] });
    const m = await review();
    expect(m.approveAll.items).toEqual([]);
    expect(m.approveAll.held).toEqual([{ id: m.rows[0]!.id, withIds: [man.id] }]);
    // a hand log without a known time never looks like a duplicate (its window is a placeholder)
    freshState({ cleared: true });
    enterBasics();
    await dispatch('activity.logManual', {
      exerciseId: 'jog_outdoor',
      date: Y,
      durationMin: 30,
      intensity: {},
    });
    await fromGauge({ gaugeSessions: [{ ...runY(), start: ms(Y, 12), end: ms(Y, 12.5) }] });
    expect((await review()).approveAll.items).toHaveLength(1);
  });
});

describe('A5: a manual overlap is resolved before anything is saved', () => {
  beforeEach(() => enterBasics());
  const input = {
    exerciseId: 'badminton',
    date: Y,
    startH: 18,
    durationMin: 30,
    intensity: { class: 'vigorous' as const },
  };

  async function approvedRun(): Promise<string> {
    await fromGauge({ gaugeSessions: [runY()] });
    const row = (await review()).rows[0]!;
    out(await dispatch('activity.approve', { id: row.id, revision: row.revision }));
    await settleCommits();
    return row.id;
  }

  it('without a choice nothing is saved; the check the sheet shows names the recording', async () => {
    const run = await approvedRun();
    const chk = manualCheck(input, {
      ent: { measurements: [] },
      records: (await readCandidates()).records,
      tz: TZ,
    });
    expect(chk.conflicts).toEqual([
      expect.objectContaining({ key: run, status: 'approved', overlapPct: 100, exerciseId: 'jog_outdoor' }),
    ]);
    const r = await dispatch('activity.logManual', input);
    expect(!r.ok && r.error).toMatchObject({ code: 'conflict', detail: { reason: 'overlap' } });
    await settleCommits();
    expect(sessions()).toHaveLength(1);
    expect((await readCandidates()).records).toHaveLength(1);
  });

  it('(0.6.5) a second timed hand log over the first asks too; a log with no clock time never does', async () => {
    out(await dispatch('activity.logManual', input));
    await settleCommits();
    const again = await dispatch('activity.logManual', { ...input, startH: 18.25 });
    expect(!again.ok && again.error).toMatchObject({ code: 'conflict', detail: { reason: 'overlap' } });
    await settleCommits();
    expect(sessions()).toHaveLength(1);
    // "I don't know the time" has no window to overlap
    const { startH: _s, ...untimed } = input;
    void _s;
    out(await dispatch('activity.logManual', untimed));
  });

  it('replace: the recording is rejected and its session leaves the day; one Undo brings it back (S30)', async () => {
    const run = await approvedRun();
    const r = await dispatch('activity.logManual', { ...input, resolution: 'replace' });
    const o = out<{ id: string; replaced: string[] }>(r);
    expect(o.replaced).toEqual([run]);
    await settleCommits();
    expect(sessions().map((e) => e.performed[0]!.exerciseId)).toEqual(['badminton']);
    expect((await candidate(run)).status).toBe('rejected');
    expect((await candidate(run)).resolvedBy).toEqual({ key: o.id, resolution: 'replace' });
    const cs = r.ok && 'output' in r ? r.changeSet?.id : undefined;
    out(await dispatch('history.undo', { changeSetId: cs! }));
    await settleCommits();
    expect(sessions().map((e) => e.performed[0]!.exerciseId)).toEqual(['jog_outdoor']);
    expect((await candidate(run)).status).toBe('approved');
    expect((await readCandidates()).byKey.has(o.id)).toBe(false);
  });

  it('link: the same activity, the recording keeps its time and takes the stated type and effort', async () => {
    const run = await approvedRun();
    const o = out<{ id: string; resolution: string }>(
      await dispatch('activity.logManual', { ...input, resolution: 'link' }),
    );
    expect(o).toMatchObject({ id: run, resolution: 'link' });
    await settleCommits();
    const s = sessions();
    expect(s).toHaveLength(1);
    expect(s[0]!.performed[0]).toMatchObject({ exerciseId: 'badminton', healthIntensityClass: 'vigorous' });
    expect(s[0]!.physicalBoutId).toBe(run);
    expect((await readCandidates()).records).toHaveLength(1);
  });

  it('separate: both count and a pending recording is not held against the log', async () => {
    await fromGauge({ gaugeSessions: [runY()] });
    const pending = (await review()).rows[0]!;
    const o = out<{ id: string; conflicts: Array<{ status: string }> }>(
      await dispatch('activity.logManual', { ...input, resolution: 'separate' }),
    );
    expect(o.conflicts).toEqual([expect.objectContaining({ status: 'pending' })]);
    expect((await candidate(o.id)).separateFrom).toEqual([pending.id]);
    const m = await review();
    expect(m.approveAll.items.map((i) => i.id)).toEqual([pending.id]);
  });
});

describe('S30: Undo of a manual log undoes the whole activity change', () => {
  beforeEach(() => enterBasics());

  it('the Train adapter’s Undo removes the entry, the approved candidate and its alias together', async () => {
    const o = await logManualActivity({
      exerciseId: 'walk',
      date: Y,
      startH: 9,
      durationMin: 30,
      intensity: { class: 'moderate' },
    });
    expect(o.ok).toBe(true);
    await settleCommits();
    expect(sessions()).toHaveLength(1);
    expect((await readCandidates()).records.filter((r) => r.status === 'approved')).toHaveLength(1);
    expect((await readCandidates()).refIndex.size).toBe(1);
    await o.undo!();
    await settleCommits();
    expect(sessions()).toHaveLength(0);
    expect((await readCandidates()).records.filter((r) => r.status === 'approved')).toHaveLength(0);
    expect((await readCandidates()).refIndex.size).toBe(0);
  });
});

describe('S13: an approved activity deleted at its source leaves replay', () => {
  beforeEach(() => enterBasics());

  it('is withdrawn with an audit row and a retraction; a second pass writes nothing more', async () => {
    await fromGauge({ gaugeSessions: [runY()] });
    const row = (await review()).rows[0]!;
    const ap = out<{ entryId: string }>(
      await dispatch('activity.approve', { id: row.id, revision: row.revision }),
    );
    await settleCommits();
    expect(sessions()).toHaveLength(1);
    const r = await fromGauge({ deletedRefs: ['gauge:g-run'] });
    expect(r.superseded).toEqual([row.id]);
    expect(sessions()).toHaveLength(0);
    const c = await candidate(row.id);
    expect(c.status).toBe('superseded');
    expect(c.withdrawn).toMatchObject({ reason: 'sourceDeleted', entryId: ap.entryId });
    expect(c.history.at(-1)).toMatchObject({ status: 'approved', entryId: ap.entryId });
    const retracts = () =>
      allLogs().filter((e) => e.kind === 'retract' && (e as { target?: string }).target === ap.entryId);
    expect(retracts()).toHaveLength(1);
    await fromGauge({ deletedRefs: ['gauge:g-run'] });
    expect(retracts()).toHaveLength(1);
    // the same session coming back never resurrects it
    await fromGauge({ gaugeSessions: [runY()] });
    expect((await review()).rows).toEqual([]);
  });
});

describe('S7/A10: the carry choice reaches step fusion', () => {
  beforeEach(() => enterBasics());

  it('an edit with "in hand" writes it on the session, and the fusion context carries it', async () => {
    await fromGauge({
      gaugeSessions: [{ id: 'g-walk', revision: 'r1', start: ms(Y, 7), end: ms(Y, 7.5), type: 'walk' }],
    });
    const row = (await review()).rows[0]!;
    out(await dispatch('activity.edit', { id: row.id, revision: row.revision, carry: 'hand' }));
    await settleCommits();
    expect(sessions()[0]!.carry).toBe('hand');
    expect(fuseActivitiesOf(allLogs(), Y, Y)).toEqual([
      expect.objectContaining({ kind: 'locomotor', carry: 'hand' }),
    ]);
  });
});

describe('S12/A26: the manual preview is the booking', () => {
  beforeEach(() => enterBasics());

  it('30 min of table tennis stated vigorous previews the points and kcal it books (MET-based points, not the stated class)', async () => {
    const input = {
      exerciseId: 'table_tennis',
      date: Y,
      startH: 10,
      durationMin: 30,
      intensity: { class: 'vigorous' as const },
    };
    const chk = manualCheck(input, { ent: { measurements: [] }, records: [], tz: TZ });
    const o = out<{ id: string }>(await dispatch('activity.logManual', input));
    const booked = (await candidate(o.id)).decidedEstimate!;
    expect(chk.estimate!.heartPoints).toBe(booked.heartPoints);
    expect(chk.estimate!.booked.grossKcal).toBeCloseTo(booked.booked.grossKcal, 6);
    // the reproduction: the stated class alone would have previewed 60 points
    expect(booked.heartPoints).not.toBe(60);
    // the stated WHO class is kept as the person's statement on the session
    await settleCommits();
    expect(sessions()[0]!.performed[0]!.healthIntensityClass).toBe('vigorous');
  });

  it('the preview uses the dated weigh-in of the log’s day, as the booking does', async () => {
    const input = { exerciseId: 'walk', date: Y, startH: 10, durationMin: 30, intensity: {} };
    const light = manualCheck(input, {
      ent: { measurements: [{ date: Y, metric: 'weightKg', value: 60 }] },
      records: [],
      tz: TZ,
    });
    const later = manualCheck(input, {
      ent: { measurements: [{ date: TODAY, metric: 'weightKg', value: 60 }] },
      records: [],
      tz: TZ,
    });
    expect(light.estimate!.massKg).toBe(60);
    expect(later.estimate!.massKg).toBe(80);
  });
});

describe('(0.6.7) a Health Connect copy of a counted workout attaches without asking again', () => {
  beforeEach(() => enterBasics());
  it('the approved run stays approved (not "updated"), the copy never reaches review, Approve all is empty', async () => {
    await fromGauge({ gaugeSessions: [runY()] });
    const row = (await review()).rows[0]!;
    out(await dispatch('activity.approve', { id: row.id, revision: row.revision }));
    await settleCommits();
    // another app wrote the same run to Health Connect, a minute off at each end
    await fromGauge({
      gaugeSessions: [runY()],
      hcSessions: [{ ...hcRunY, id: 'hc-copy', start: ms(Y, 18 + 1 / 60), end: ms(Y, 18 + 31 / 60) }],
    });
    await settleCommits();
    const m = await review();
    expect(m.rows).toEqual([]);
    const run = await candidate(row.id);
    expect(run.status).toBe('approved');
    expect(run.refs).toContain('hc:hc-copy');
    expect(isUpdated(run)).toBe(false);
  });
});

describe('(0.6.7) a re-sent recording never changes an approved type', () => {
  beforeEach(() => enterBasics());
  it('Gauge re-sends the approved run with another type and a minute more: still approved as decided, booked as decided', async () => {
    await fromGauge({ gaugeSessions: [runY()] });
    const row = (await review()).rows[0]!;
    out(await dispatch('activity.approve', { id: row.id, revision: row.revision }));
    await settleCommits();
    const decided = (await candidate(row.id)).decidedEstimate!;
    await fromGauge({
      gaugeSessions: [
        { ...runY(), revision: 'r2', end: ms(Y, 18 + 31 / 60), activityTypeId: 'treadmill_run' },
      ],
    });
    await settleCommits();
    expect((await review()).rows).toEqual([]);
    const run = await candidate(row.id);
    expect(run.status).toBe('approved');
    expect(isUpdated(run)).toBe(false);
    expect(run.suggested.exerciseId).toBe(row.exerciseId);
    expect(run.estimate!.exerciseId).toBe(row.exerciseId);
    expect(run.decidedEstimate).toEqual(decided);
  });
});
