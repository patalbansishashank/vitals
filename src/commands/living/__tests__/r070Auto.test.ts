/**
 * r070 (owner 2026-10-30: "Review keeps coming back, even weeks ago", "I don't want to review at all"): activities are
 * counted automatically (`activity.autoAccept`, `planAutoAccept`), duplicates across sources are one activity, the
 * person's own decisions stand, and what they removed never comes back. The cases are the live account's: Google Fit
 * sessions of 10–22 October still pending, a held 100 % pair, a session split at its gap after it was approved.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bodyOf } from '@/store';
import { dispatch, settleCommits, type CommandResult } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { getDocumentStore } from '@/state/runtime';
import { useProfileStore } from '@/state/profileStore';
import { effectiveEntries, localToInstant, type LogEntry } from '@/living';
import { planAutoAccept, reviewSheetModel, type ActivityCandidateDoc } from '@/living/activityCandidates';
import { hcSessionOf } from '@/state/gaugeImport';
import { readCandidates } from '../activity';

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const TODAY = '2026-10-30';
const SYS = { actor: { kind: 'system' as const, id: 'gauge-import' } };
const FIT = 'com.google.android.apps.fitness';
const ms = (date: string, h: number) => Date.parse(localToInstant(date, h, TZ));
const out = <T,>(r: CommandResult): T => {
  if (!r.ok || !('output' in r)) throw new Error(JSON.stringify(r));
  return r.output as T;
};

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(ms(TODAY, 22)));
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(async () => {
  freshState({ cleared: true });
  await getDocumentStore().ready;
  const p = useProfileStore.getState();
  p.setAge(40);
  p.setHeight(169);
  p.setWeight(80);
});

type Hc = { id: string; revision: string; start: number; end: number; exerciseType: number; originPackage: string; recordingMethod?: 'manual' | 'active' | 'auto'; segments?: Array<{ start: number; end: number }> };
const hc = (id: string, date: string, startH: number, endH: number, over: Partial<Hc> = {}): Hc => ({
  id, revision: `${id}-r1`, start: ms(date, startH), end: ms(date, endH), exerciseType: 79, originPackage: FIT, recordingMethod: 'auto', ...over,
});
const gauge = (id: string, date: string, startH: number, endH: number) => ({ id, revision: `${id}-r1`, start: ms(date, startH), end: ms(date, endH), type: 'walk' });
const ep = (id: string, date: string, startH: number, endH: number, level: 'low' | 'medium' | 'high', recordingRefs: string[] = []) => ({
  id, revision: 1, detector: 'detect/2', start: ms(date, startH), end: ms(date, endH), state: 'final' as const, label: 'walk',
  existence: 0.8, typeScore: 0.8, level, reasons: ['phone_cadence'], evidenceHash: `sha:${id}`, ...(recordingRefs.length ? { recordingRefs } : {}),
});

async function pass(input: Record<string, unknown>) {
  out(await dispatch('activity.fromGauge', { gaugeSessions: [], hcSessions: [], serverDetector: 'detect/2', ...input }, SYS));
  await settleCommits();
}
type Auto = { accepted: string[]; merged: string[]; possible: string[]; cleared: number; waiting: string[] };
async function auto(): Promise<Auto> {
  const o = out<Auto>(await dispatch('activity.autoAccept', {}, SYS));
  await settleCommits();
  return o;
}
/** The import as the app runs it: `activity.fromGauge`, then the automatic decisions. */
async function imp(input: Record<string, unknown>): Promise<Auto> {
  await pass(input);
  return auto();
}
async function docs(): Promise<ActivityCandidateDoc[]> {
  return [...(await readCandidates()).byKey.values()].filter((r): r is ActivityCandidateDoc => r.compact !== true);
}
const byRef = async (ref: string) => (await docs()).find((c) => c.refs.includes(ref));
const allLogs = (): LogEntry[] => getDocumentStore().peekAll<LogEntry>('dailyLogs').map((d) => ({ ...bodyOf<LogEntry>(d), id: d._id }) as LogEntry);
const sessions = () => effectiveEntries(allLogs()).filter((e): e is Extract<LogEntry, { kind: 'session' }> => e.kind === 'session');
const review = async () => reviewSheetModel(await docs(), {});

describe('Google Fit sessions come in decided: no review, however old', () => {
  it('weeks-old pending sessions are counted on the next import, once, and a second pass writes nothing', async () => {
    // the live account: Fit walks of 10–22 October, pending since 28 October
    await pass({ hcSessions: [hc('a1', '2026-10-10', 6, 6.65), hc('a2', '2026-10-17', 10.5, 11), hc('a3', '2026-10-21', 14.3, 14.5, { exerciseType: 56 })] });
    expect((await review()).rows).toHaveLength(3);
    expect(sessions()).toHaveLength(0);
    const first = await auto();
    expect(first.accepted).toHaveLength(3);
    const m = await review();
    expect(m.rows).toEqual([]);
    expect(m.strip).toBeNull();
    expect(m.approveAll.items).toEqual([]);
    expect(sessions()).toHaveLength(3);
    expect(m.decided.every((r) => r.status === 'approved' && r.auto?.from.kind === 'healthConnect' && r.auto.from.app === FIT)).toBe(true);
    const before = JSON.stringify((await docs()).map((c) => [c.key, c.updatedAt, c.revision]));
    expect(await auto()).toMatchObject({ accepted: [], merged: [], possible: [], cleared: 0 });
    expect(JSON.stringify((await docs()).map((c) => [c.key, c.updatedAt, c.revision]))).toBe(before);
    // the same sessions imported again change nothing and ask nothing
    await imp({ hcSessions: [hc('a1', '2026-10-10', 6, 6.65), hc('a2', '2026-10-17', 10.5, 11), hc('a3', '2026-10-21', 14.3, 14.5, { exerciseType: 56 })] });
    expect((await review()).rows).toEqual([]);
    expect(sessions()).toHaveLength(3);
  });

  it('a held 100 % pair of sessions is one activity, the other merged into it and never shown as a pair', async () => {
    // 01M53JH100E6… and …QN2Q…: two Fit records of the same walk
    await pass({ hcSessions: [hc('p1', '2026-10-17', 10.5, 11), hc('p2', '2026-10-17', 10.5, 11)] });
    expect((await review()).approveAll.held?.length ?? 0).toBeGreaterThan(0);
    const o = await auto();
    expect(o.accepted).toHaveLength(1);
    expect(o.merged).toHaveLength(1);
    const m = await review();
    expect(m.rows).toEqual([]);
    expect(m.approveAll.held).toBeUndefined();
    expect(sessions()).toHaveLength(1);
    const st = (await docs()).map((c) => c.status).sort();
    expect(st).toEqual(['approved', 'superseded']);
    expect((await docs()).find((c) => c.status === 'superseded')!.mergedInto).toBe((await docs()).find((c) => c.status === 'approved')!.key);
  });

  it('precedence: a hand-typed Health Connect entry, then a Gauge recording, then a Fit session, then a detection', async () => {
    await pass({
      hcSessions: [hc('fit', '2026-10-20', 7, 7.5), hc('typed', '2026-10-20', 7, 7.5, { originPackage: 'com.other.app', recordingMethod: 'manual' })],
      gaugeSessions: [gauge('g1', '2026-10-20', 7.02, 7.48)],
      detections: [ep('d1', '2026-10-20', 7.05, 7.45, 'high')],
    });
    await auto();
    const c = await docs();
    const counted = c.filter((x) => x.status === 'approved');
    expect(counted).toHaveLength(1);
    expect(counted[0]!.refs).toContain('hc:typed');
    expect(c.filter((x) => x.status === 'superseded').every((x) => x.mergedInto === counted[0]!.key)).toBe(true);
    expect(sessions()).toHaveLength(1);
    expect((await review()).rows).toEqual([]);
  });

  it('a Gauge recording beats a Fit session and a detection of the same bout (which the detection\'s recording link also names)', async () => {
    await pass({ hcSessions: [hc('fit', '2026-10-20', 7, 7.5)], gaugeSessions: [gauge('g1', '2026-10-20', 7, 7.5)], detections: [ep('d1', '2026-10-20', 7.05, 7.45, 'high', ['hc:fit', 'gauge:g1'])] });
    await auto();
    const c = await docs();
    expect(c.filter((x) => x.status === 'approved').map((x) => x.sources.map((s) => s.source))).toEqual([['gaugeSession']]);
    expect(sessions()).toHaveLength(1);
  });
});

describe('a session split at its gap after the person approved it (the live 01M5GEGM00BY88… / …NWH8… case)', () => {
  const whole = (rev: string) => hc('s', '2026-10-22', 8.8, 10.07, { revision: rev });
  const seg = (a: number, b: number) => ({ start: ms('2026-10-22', a), end: ms('2026-10-22', b) });
  const split = (rev: string) => ({ ...whole(rev), segments: [seg(8.8, 9.36), seg(9.57, 10.07)] });

  it('the approval stands whatever the source does later: never "updated", the other block merges into it, one session counts', async () => {
    await pass({ hcSessions: [whole('r1')] });
    const c = (await byRef('hc:s'))!;
    out(await dispatch('activity.approve', { id: c.key, revision: c.revision }));
    await settleCommits();
    const before = sessions();
    expect(before).toHaveLength(1);
    await pass({ hcSessions: [split('r2')] });
    const after = await docs();
    expect(after.length).toBeGreaterThan(1);
    const o = await auto();
    expect(o.accepted).toEqual([]);
    const m = await review();
    expect(m.rows).toEqual([]);
    expect(m.decided.map((r) => [r.status, r.updated])).toEqual([['approved', false]]);
    expect(sessions()).toEqual(before);
    const decidedBy = (await docs()).filter((x) => x.status === 'approved');
    expect(decidedBy).toHaveLength(1);
    expect(decidedBy[0]).toMatchObject({ decidedBy: 'user', key: c.key });
    expect((await docs()).filter((x) => x.status === 'superseded').every((x) => x.mergedInto === c.key)).toBe(true);
    // and nothing changes on the next imports
    await imp({ hcSessions: [split('r3')] });
    expect(sessions()).toEqual(before);
    expect((await review()).rows).toEqual([]);
  });

  it('without an earlier approval the two blocks are two counted activities (Fit says they were two walks)', async () => {
    await imp({ hcSessions: [split('r1')] });
    expect(sessions()).toHaveLength(2);
    expect((await review()).rows).toEqual([]);
  });
});

describe('weak detections are never a task', () => {
  it('a low-level detection with no recording is a quiet possible: not counted, not a row; one tap adds it', async () => {
    await imp({ detections: [ep('w1', '2026-10-24', 16, 16.4, 'low')] });
    const m = await review();
    expect(m.rows).toEqual([]);
    expect(m.strip).toBeNull();
    expect(m.possible).toHaveLength(1);
    expect(sessions()).toHaveLength(0);
    const p = m.possible[0]!;
    expect(p.status).toBe('possible');
    // asking again changes nothing
    expect(await auto()).toMatchObject({ accepted: [], possible: [] });
    // the person adds it
    out(await dispatch('activity.approve', { id: p.id, revision: p.revision }));
    await settleCommits();
    expect(sessions()).toHaveLength(1);
    expect((await review()).possible).toEqual([]);
    expect((await docs())[0]).toMatchObject({ status: 'approved', decidedBy: 'user' });
  });

  it('a strong detection with no session is counted; a recording that arrives later takes it over (one activity)', async () => {
    await imp({ detections: [ep('s1', '2026-10-24', 16, 16.5, 'high')] });
    expect(sessions()).toHaveLength(1);
    expect((await review()).rows).toEqual([]);
    await imp({ detections: [ep('s1', '2026-10-24', 16, 16.5, 'high', ['hc:late'])], hcSessions: [hc('late', '2026-10-24', 16, 16.5)] });
    expect(sessions()).toHaveLength(1);
    expect((await docs()).filter((c) => c.status === 'approved' || c.status === 'edited')).toHaveLength(1);
    expect((await review()).rows).toEqual([]);
  });

  it('a possible that a session later covers is merged away', async () => {
    await imp({ detections: [ep('w2', '2026-10-24', 16, 16.4, 'low')] });
    expect((await review()).possible).toHaveLength(1);
    await imp({ hcSessions: [hc('cover', '2026-10-24', 15.95, 16.45)] });
    const m = await review();
    expect(m.possible).toEqual([]);
    expect(sessions()).toHaveLength(1);
  });
});

describe('the person stays in control afterwards, for ever', () => {
  it('a removed activity never comes back: not from the same session, not as Google Fit\'s rewrite under another id', async () => {
    await imp({ hcSessions: [hc('x1', '2026-10-25', 12.65, 13.47)] });
    const c = (await byRef('hc:x1'))!;
    expect(sessions()).toHaveLength(1);
    out(await dispatch('activity.reject', { id: c.key }));
    await settleCommits();
    expect(sessions()).toHaveLength(0);
    // the same session again (a new revision), then Fit's rewrite: a new record id over nearly the same minutes
    await imp({ hcSessions: [hc('x1', '2026-10-25', 12.65, 13.47, { revision: 'x1-r2' })] });
    await imp({ hcSessions: [hc('x2', '2026-10-25', 12.66, 13.46)], deletedRefs: ['hc:x1'] });
    expect(sessions()).toHaveLength(0);
    const m = await review();
    expect(m.rows).toEqual([]);
    expect(m.possible).toEqual([]);
    expect((await docs()).filter((x) => x.status === 'approved' || x.status === 'edited' || x.status === 'pending')).toEqual([]);
  });

  it('an edit sticks: a source that later names another type or other times neither replaces it nor asks again', async () => {
    await imp({ hcSessions: [hc('e1', '2026-10-25', 15.5, 15.77)] });
    const c = (await byRef('hc:e1'))!;
    out(await dispatch('activity.edit', { id: c.key, revision: c.revision, exerciseId: 'hatha_yoga', startAt: new Date(ms('2026-10-25', 15.5)).toISOString(), endAt: new Date(ms('2026-10-25', 15.9)).toISOString() }));
    await settleCommits();
    const before = sessions();
    expect(before[0]!.performed.map((p) => p.exerciseId)).toEqual(['hatha_yoga']);
    await imp({ hcSessions: [hc('e1', '2026-10-25', 15.5, 16.2, { revision: 'e1-r2', exerciseType: 56 })] });
    expect(sessions()).toEqual(before);
    expect((await review()).rows).toEqual([]);
    expect((await byRef('hc:e1'))).toMatchObject({ status: 'edited', decidedBy: 'user' });
  });

  it('a hand log wins over an automatic recording without a question, and a later re-import changes nothing', async () => {
    await imp({ hcSessions: [hc('h1', '2026-10-26', 7, 7.5)] });
    expect(sessions()).toHaveLength(1);
    const r = out<{ replaced?: string[]; resolution?: string }>(await dispatch('activity.logManual', { exerciseId: 'walk', date: '2026-10-26', startH: 7.02, durationMin: 28, intensity: { class: 'moderate' } }));
    await settleCommits();
    expect(r.resolution).toBe('replace');
    expect(r.replaced).toHaveLength(1);
    expect(sessions()).toHaveLength(1);
    await imp({ hcSessions: [hc('h1', '2026-10-26', 7, 7.5, { revision: 'h1-r2' })] });
    expect(sessions()).toHaveLength(1);
    expect((await review()).rows).toEqual([]);
  });

  it('a hand log beats a recording that arrives afterwards', async () => {
    out(await dispatch('activity.logManual', { exerciseId: 'walk', date: '2026-10-26', startH: 7, durationMin: 30, intensity: { class: 'moderate' } }));
    await settleCommits();
    await imp({ hcSessions: [hc('h2', '2026-10-26', 7.02, 7.5)] });
    expect(sessions()).toHaveLength(1);
    expect(sessions()[0]!.source?.by).not.toBe('device');
    expect((await review()).rows).toEqual([]);
  });
});

describe('migration', () => {
  it('a stale "updated since you approved it" marker on the person\'s decision is cleared and nothing else changes', async () => {
    await pass({ hcSessions: [hc('m1', '2026-10-22', 8, 8.5)] });
    const c = (await byRef('hc:m1'))!;
    out(await dispatch('activity.approve', { id: c.key, revision: c.revision }));
    await settleCommits();
    const decided = (await byRef('hc:m1'))!;
    const stale = { ...decided, updatedFrom: { base: decided.decidedRevision!, revision: 'newer', changes: ['times'] as const } } as ActivityCandidateDoc;
    const plan = planAutoAccept([stale]);
    expect(plan).toEqual({ accept: [], merge: [], possible: [], clear: [c.key] });
  });

  it('what the older versions decided stays: approved and edited are neither merged nor re-decided', async () => {
    await pass({ hcSessions: [hc('m2', '2026-10-22', 8, 8.5), hc('m3', '2026-10-22', 8.05, 8.45)] });
    const c = (await byRef('hc:m2'))!;
    out(await dispatch('activity.approve', { id: c.key, revision: c.revision }));
    await settleCommits();
    const plan = planAutoAccept([...(await docs())]);
    expect(plan.accept.map((a) => a.key)).not.toContain(c.key);
    expect(plan.merge.map((m) => m.key)).not.toContain(c.key);
    expect(plan.merge.map((m) => m.into)).toEqual([c.key]);
  });
});

describe('Health Connect sessions are read with their recording method and laps', () => {
  it('hcSessionOf carries the recording method (its name or code) and the lap count', () => {
    const rec = (recordingMethod: unknown, payload: Record<string, unknown> = {}) =>
      hcSessionOf({ id: 'r', originPackage: FIT, start: '2026-10-22T08:00:00Z', end: '2026-10-22T08:30:00Z', recordingMethod, payload: { exercise_type_code: 79, ...payload } });
    expect(rec('manualEntry')?.recordingMethod).toBe('manual');
    expect(rec('activelyRecorded')?.recordingMethod).toBe('active');
    expect(rec('automaticallyRecorded')?.recordingMethod).toBe('auto');
    expect(rec(2)?.recordingMethod).toBe('auto');
    expect(rec('unknown')?.recordingMethod).toBeUndefined();
    expect(rec(null, { laps: [{ start: 'a' }, { start: 'b' }] })?.laps).toBe(2);
  });
});
