/**
 * r069 (owner's D5/D6, 2026-10-28/29): an approval sticks and an approved activity never leaves Today.
 *  - D6: Google Fit replaced the first walk's session (`hc:3ab1`) with one session over both walks (`hc:06ba`, 13:01–14:53).
 *    The approved first walk was withdrawn as "deleted upstream" while its episode still stood, and the new session was
 *    hung whole on the second walk's candidate: one candidate for two walks, the first one gone from Today;
 *  - D5: the decided bike ride and walks came back to review on every revision that booked nothing new (Google Fit's
 *    `last_modified`, a pass that did or did not read the detections, the session of a detected ride arriving);
 *  - a rejected hand log stayed on Today: the rejection retracted only its newest version, and the first came back;
 *  - a decision another device made is never undone by an import over an older copy.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bodyOf, mintWriteToken } from '@/store';
import { dispatch, settleCommits, type CommandResult } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { getDocumentStore } from '@/state/runtime';
import { useProfileStore } from '@/state/profileStore';
import { effectiveEntries, localToInstant, type LogEntry } from '@/living';
import { effectiveEntries as reduce } from '@/living/logs';
import { gaugeEntryId } from '@/living/gaugeImport';
import {
  isUpdated,
  planCandidateUpsert,
  reviewSheetModel,
  type ActivityCandidateDoc,
} from '@/living/activityCandidates';
import { detectActivities, hcBlocks, hcRevisionOf } from '@/living/sensors/activityDetect';
import { hcSessionBlocks } from '../../../../packages/companion/src/home/detect/features';
import { readCandidates } from '../activity';

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const TODAY = '2026-10-29';
const D = TODAY;
const SYS = { actor: { kind: 'system' as const, id: 'gauge-import' } };
const ms = (date: string, h: number) => Date.parse(localToInstant(date, h, TZ));
const iso = (h: number) => new Date(ms(D, h)).toISOString();
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

// ---------------------------------------------------------------------------------------------- the owner's day
// (UTC 05:04 → local 10.567 h of the test zone and so on: the owner's IST clock, kept as local hours)
const FIT = 'com.google.android.apps.fitness';
const hcBike = (lastModified: string) => ({ id: '254f74fe', revision: lastModified, start: ms(D, 10 + 32.67 / 60), end: ms(D, 10 + 58.3 / 60), exerciseType: 8, originPackage: FIT });
const hcWalk1 = { id: '3ab1d11e', revision: '13:54:12', start: ms(D, 13 + 1 / 60), end: ms(D, 13 + 54.2 / 60), exerciseType: 79, originPackage: FIT };
/** A local clock time of D (the owner's IST clock). */
const at = (h: number, m: number, sec = 0) => ms(D, h + m / 60 + sec / 3600);
/** Google Fit's record `06ba71dd` exactly as Health Connect has it: 13:01:01–14:53:11 IST and its eight segments. */
const SEGMENTS_06BA = [
  [at(13, 1, 1.485), at(13, 1, 6.533)], [at(13, 1, 6.533), at(13, 2, 7.468)], [at(13, 8, 57.384), at(13, 10, 12.465)],
  [at(13, 10, 12.465), at(13, 55, 23.806)], [at(14, 9, 16.263), at(14, 10, 30.377)], [at(14, 10, 30.377), at(14, 44, 11.136)],
  [at(14, 44, 11.136), at(14, 44, 38.46)], [at(14, 44, 38.46), at(14, 53, 11.283)],
].map(([start, end]) => ({ start: start!, end: end! }));
/** The session over both walks, its outer window only (no segments). */
const hcOuter = (lastModified: string) => ({ id: '06ba71dd', revision: lastModified, start: at(13, 1, 1.485), end: at(14, 53, 11.283), exerciseType: 79, originPackage: FIT });
const hcBoth = (lastModified: string) => ({ ...hcOuter(lastModified), segments: SEGMENTS_06BA });
const BLOCK1 = { start: at(13, 1, 1.485), end: at(13, 55, 23.806) };
const BLOCK2 = { start: at(14, 9, 16.263), end: at(14, 53, 11.283) };
type Ep = { id: string; revision: number; detector: string; start: number; end: number; state: 'final'; label: string; existence: number; typeScore: number; level: 'low' | 'medium' | 'high'; reasons: string[]; evidenceHash: string; recordingRefs?: string[] };
const ep = (id: string, startH: number, endH: number, recordingRefs: string[] = []): Ep => ({
  id, revision: 1, detector: 'detect/2', start: ms(D, startH), end: ms(D, endH), state: 'final', label: 'walk',
  existence: 0.8, typeScore: 0.8, level: 'high', reasons: ['phone_cadence', 'steady_cadence'], evidenceHash: `sha:${id}`,
  ...(recordingRefs.length ? { recordingRefs } : {}),
});
const bikeEp = (refs: string[] = []) => ep('01M630P9', 10 + 34 / 60, 10 + 50 / 60, refs);
const walk1Ep = (refs: string[] = []) => ep('01M639J3', 13 + 9 / 60, 13 + 54 / 60, refs);
const walk2Ep = (refs: string[] = []) => ep('01M63CZZ', 14 + 9 / 60, 14 + 49 / 60, refs);

async function pass(input: Record<string, unknown>) {
  const o = out<{ created: string[]; updated: string[]; superseded: string[]; blocked: string[] }>(
    await dispatch('activity.fromGauge', { gaugeSessions: [], hcSessions: [], serverDetector: 'detect/2', ...input }, SYS),
  );
  await settleCommits();
  return o;
}
async function docs(): Promise<ActivityCandidateDoc[]> {
  return [...(await readCandidates()).byKey.values()].filter((r): r is ActivityCandidateDoc => r.compact !== true);
}
const byRef = async (ref: string) => (await docs()).find((c) => c.refs.includes(ref));
const allLogs = (): LogEntry[] =>
  getDocumentStore().peekAll<LogEntry>('dailyLogs').map((d) => ({ ...bodyOf<LogEntry>(d), id: d._id }) as LogEntry);
const sessions = () =>
  effectiveEntries(allLogs()).filter((e): e is Extract<LogEntry, { kind: 'session' }> => e.kind === 'session');
const review = async () => reviewSheetModel(await docs(), {});

/** The owner's morning up to the second walk's edit (passes at 08:16, 09:06 and 10:13 UTC). */
async function morning() {
  // 08:16 the bike ride's episode (labelled a walk); the owner says it was the stationary bike
  await pass({ detections: [bikeEp()] });
  const bike = (await byRef('detect:bout:01M630P9'))!;
  out(await dispatch('activity.edit', { id: bike.key, revision: bike.revision, exerciseId: 'stationary_bike', startAt: iso(10 + 34 / 60), endAt: iso(10 + 50 / 60) }));
  await settleCommits();
  // 09:06 Google Fit's bike session and its first walk session arrive; the owner approves the first walk
  await pass({ hcSessions: [hcBike('13:54:12'), hcWalk1], detections: [bikeEp(['hc:254f74fe']), walk1Ep(['hc:3ab1d11e'])] });
  const w1 = (await byRef('detect:bout:01M639J3'))!;
  expect(w1.status).toBe('pending');
  out(await dispatch('activity.approve', { id: w1.key, revision: w1.revision }));
  await settleCommits();
  // 10:13 the second walk's episode; the owner edits it to a treadmill walk 14:08–14:53
  await pass({ hcSessions: [hcBike('15:01:07'), hcWalk1], detections: [bikeEp(['hc:254f74fe']), walk1Ep(['hc:3ab1d11e']), walk2Ep()] });
  const w2 = (await byRef('detect:bout:01M63CZZ'))!;
  out(await dispatch('activity.edit', { id: w2.key, revision: w2.revision, exerciseId: 'treadmill_walk', startAt: iso(14 + 8 / 60), endAt: iso(14 + 53 / 60) }));
  await settleCommits();
  return { bike: bike.key, walk1: w1.key, walk2: w2.key };
}
/** 10:16 UTC: Google Fit deletes the first walk's session and writes one session over both walks. */
const merged = (lastModified = '15:44:48', detections = true) => ({
  hcSessions: [hcBike(lastModified), hcBoth(lastModified)],
  deletedRefs: ['hc:3ab1d11e'],
  ...(detections ? { detections: [bikeEp(['hc:254f74fe']), walk1Ep(['hc:06ba71dd']), walk2Ep(['hc:06ba71dd'])] } : {}),
});

async function expectThreeCounted(keys: { bike: string; walk1: string; walk2: string }) {
  const m = await review();
  expect(m.rows).toEqual([]);
  const c = new Map((await docs()).map((x) => [x.key, x] as const));
  expect(c.get(keys.bike)).toMatchObject({ status: 'edited', decision: expect.objectContaining({ exerciseId: 'stationary_bike' }) });
  expect(c.get(keys.walk1)).toMatchObject({ status: 'approved' });
  expect(c.get(keys.walk2)).toMatchObject({ status: 'edited', decision: expect.objectContaining({ exerciseId: 'treadmill_walk' }) });
  const s = sessions();
  expect(s.map((e) => e.physicalBoutId).sort()).toEqual([keys.bike, keys.walk1, keys.walk2].sort());
}

describe('D6: two walks inside one Google Fit session stay two activities, both counted', () => {
  it('the session written over both walks withdraws nothing and hosts neither walk', async () => {
    const keys = await morning();
    expect(sessions()).toHaveLength(3);
    await pass(merged());
    await expectThreeCounted(keys);
    // the second walk keeps its own episode's window; the merged session is no candidate's evidence
    // each walk takes its own block of the session (its segments): never the outer window, never the other walk
    const all = await docs();
    const w1 = all.find((c) => c.key === keys.walk1)!;
    const w2 = all.find((c) => c.key === keys.walk2)!;
    expect(w1.refs).toContain(`hc:06ba71dd@${BLOCK1.start}`);
    expect(w2.refs).toContain(`hc:06ba71dd@${BLOCK2.start}`);
    // (a block near-identical to the counted walk is that walk seen by Google Fit: it attaches, the decision stands)
    expect(w2.window.start).toBeGreaterThanOrEqual(BLOCK2.start - 60_000);
    expect(w2.window.end).toBeLessThanOrEqual(BLOCK2.end);
    expect(all.some((c) => c.refs.includes('hc:06ba71dd'))).toBe(false);
    expect(all.filter((c) => c.status === 'pending')).toEqual([]);
    // the first walk still has its approved time
    expect(sessions().find((e) => e.physicalBoutId === keys.walk1)!.durationMin).toBeCloseTo(53, 0);
  });

  it.each([true, false])('an approved walk withdrawn before r069 comes back approved, with its session (detections read: %s)', async (detections) => {
    const keys = await morning();
    const w1 = (await docs()).find((c) => c.key === keys.walk1)!;
    const entry = allLogs().find((e) => e.id === w1.entryId)!;
    // what r068 wrote at 10:16 UTC: the candidate withdrawn, its session retracted
    const marker = gaugeEntryId(entry.date, `retract|${entry.id}|sourceDeleted`);
    await getDocumentStore().transact(mintWriteToken('migration', { label: 'r068 withdrawal' }), async (tx) => {
      await tx.put('activityCandidates', {
        ...w1, status: 'superseded', deletedSources: ['hc:3ab1d11e'], resolvedAt: '2026-10-29T10:16:09.285Z',
        withdrawn: { reason: 'sourceDeleted', entryId: w1.entryId, at: '2026-10-29T10:16:09.285Z', decided: { status: 'approved', revision: w1.decidedRevision } },
        _id: `cand:${w1.key}`,
      });
      await tx.append('dailyLogs', { date: entry.date, tz: entry.tz, at: '2026-10-29T10:16:09.285Z', recordedAt: '2026-10-29T10:16:09.285Z', kind: 'retract', target: entry.id, source: { by: 'user', method: 'typed', actorId: 'gauge-import' }, _id: marker });
    });
    expect(sessions()).toHaveLength(2);
    await pass(merged('15:44:48', detections));
    await expectThreeCounted(keys);
    const back = (await docs()).find((c) => c.key === keys.walk1)!;
    expect(back.withdrawn).toBeUndefined();
    expect(back.entryId).toBe(gaugeEntryId(entry.date, `restore|${marker}`));
    expect(back.history.at(-1)).toMatchObject({ status: 'superseded' });
    // idempotent: another pass writes no second copy
    await pass(merged('15:44:48', detections));
    expect(sessions()).toHaveLength(3);
  });
});

describe('D5: an approval sticks across revisions that book nothing new', () => {
  it('Google Fit last_modified, a pass without the detections and the ride\'s session never send anything back', async () => {
    const keys = await morning();
    // the bike ride's own session arrived at 09:06 over the edited detected ride: still edited, not "updated"
    expect((await review()).rows).toEqual([]);
    await pass(merged('15:44:48'));
    await expectThreeCounted(keys);
    // a pass whose detections read failed, then one that read them again, then Google Fit touches its sessions again
    await pass(merged('15:44:48', false));
    await expectThreeCounted(keys);
    await pass(merged('15:44:48'));
    await expectThreeCounted(keys);
    await pass(merged('16:20:00'));
    await expectThreeCounted(keys);
    // each decision was made once
    for (const c of await docs()) if (c.status !== 'pending') expect(c.history).toHaveLength(0);
  });

  it('2026-10-28: a walk hosted by its Health Connect session keeps one revision whether or not the pass read its episode', async () => {
    const day = '2026-10-28';
    const hc = { id: 'df1b81af', revision: '02:33:40', start: ms(day, 17 + 53.1 / 60), end: ms(day, 18 + 34.2 / 60), exerciseType: 79, originPackage: FIT };
    const e = { ...ep('01M617DD', 17.9, 18.55, ['hc:df1b81af']), start: ms(day, 17.9), end: ms(day, 18.55) };
    await pass({ hcSessions: [hc], detections: [e] });
    const c = (await byRef('hc:df1b81af'))!;
    out(await dispatch('activity.approve', { id: c.key, revision: c.revision }));
    await settleCommits();
    await pass({ hcSessions: [hc] });
    const a = (await byRef('hc:df1b81af'))!;
    await pass({ hcSessions: [hc], detections: [e] });
    const b = (await byRef('hc:df1b81af'))!;
    expect(a.revision).toBe(c.revision);
    expect(b.revision).toBe(c.revision);
    expect((await review()).rows).toEqual([]);
  });
});

describe('a rejected activity counts nothing', () => {
  const manual = { exerciseId: 'treadmill_desk_slow', date: D, startH: 15 + 3 / 60, durationMin: 30, intensity: { class: 'moderate' } };

  it('rejecting an edited hand log retracts every version (the first one used to come back)', async () => {
    const m = out<{ id: string }>(await dispatch('activity.logManual', manual));
    await settleCommits();
    const c = (await docs()).find((x) => x.key === m.id)!;
    out(await dispatch('activity.edit', { id: c.key, revision: c.revision, endAt: iso(15 + 43 / 60) }));
    await settleCommits();
    expect(sessions()).toHaveLength(1);
    const rej = await dispatch('activity.reject', { id: c.key });
    out(rej);
    await settleCommits();
    expect(sessions()).toEqual([]);
    expect((await docs()).find((x) => x.key === c.key)!.status).toBe('rejected');
    // one undo brings back the edited activity as it was (one session, the edited 40 minutes)
    const cs = 'changeSet' in rej ? rej.changeSet : null;
    expect(out<{ undone: boolean }>(await dispatch('history.undo', { changeSetId: cs!.id }))).toMatchObject({ undone: true });
    await settleCommits();
    expect(sessions().map((e) => e.durationMin)).toEqual([40]);
    expect((await docs()).find((x) => x.key === c.key)!.status).toBe('edited');
  });

  it('an edited recording deleted upstream leaves Today whole (no earlier version comes back)', async () => {
    const g = { id: 'g-run', revision: 'r1', start: ms(D, 18), end: ms(D, 18.5), type: 'run', kcal: 330 };
    await pass({ gaugeSessions: [g] });
    const c = (await byRef('gauge:g-run'))!;
    out(await dispatch('activity.approve', { id: c.key, revision: c.revision }));
    await settleCommits();
    out(await dispatch('activity.edit', { id: c.key, revision: c.revision, endAt: iso(18 + 40 / 60) }));
    await settleCommits();
    expect(sessions()).toHaveLength(1);
    await pass({ deletedRefs: ['gauge:g-run'] });
    expect((await byRef('gauge:g-run'))!.status).toBe('superseded');
    expect(sessions()).toEqual([]);
  });

  it('a version an earlier rejection left on Today is retracted by the next import', async () => {
    const m = out<{ id: string }>(await dispatch('activity.logManual', manual));
    await settleCommits();
    const c = (await docs()).find((x) => x.key === m.id)!;
    out(await dispatch('activity.edit', { id: c.key, revision: c.revision, endAt: iso(15 + 43 / 60) }));
    await settleCommits();
    const edited = (await docs()).find((x) => x.key === c.key)!;
    const head = allLogs().find((e) => e.id === edited.entryId)!;
    // what r068's reject wrote: the newest version retracted, the candidate rejected
    await getDocumentStore().transact(mintWriteToken('migration', { label: 'r068 reject' }), async (tx) => {
      await tx.put('activityCandidates', { ...edited, status: 'rejected', entryId: null, decision: null, _id: `cand:${edited.key}` });
      await tx.append('dailyLogs', { date: head.date, tz: head.tz, at: head.at, recordedAt: head.at, kind: 'retract', target: head.id, source: { by: 'user', method: 'typed', actorId: 'local-user' }, _id: gaugeEntryId(head.date, `retract|${head.id}|rejected`) });
    });
    // the bug: the first version (09:33–10:03 UTC in the owner's log) is in force again
    expect(sessions().map((e) => e.durationMin)).toEqual([30]);
    await pass({});
    expect(sessions()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------- the planner (pure)

describe('a decision another device made stands', () => {
  const NOW = '2026-10-29T11:00:00.000Z';
  const base = (over: Partial<ActivityCandidateDoc>): ActivityCandidateDoc =>
    ({
      key: 'K', date: D, tz: 'UTC', startAt: '2026-10-29T07:31:01.000Z', endAt: '2026-10-29T08:24:12.000Z', window: { start: 0, end: 1 },
      refs: ['hc:a'], sources: [{ source: 'hcSession', ref: 'hc:a', revision: 'r', confidence: 'medium' }], sourceRevision: 's', estimateRevision: 'e',
      revision: 'rev2', suggested: { exerciseId: 'walk', confidence: 'medium', needsReview: false, why: [] }, measures: {} as never, estimate: null,
      corroboratedBy: [], mergeSuggestions: [], planMatch: null, status: 'approved', decidedRevision: 'rev1', baseRevision: 'rev1', entryId: 'E1',
      decidedAt: '2026-10-29T10:00:20.211Z', decidedBy: 'user', decision: { exerciseId: 'walk', startAt: '2026-10-29T07:31:01.000Z', endAt: '2026-10-29T08:24:12.000Z' },
      decidedEstimate: null, history: [], firstSeenAt: NOW, updatedAt: NOW, resolvedAt: NOW, ...over,
    }) as ActivityCandidateDoc;

  it('a revision another device wrote over an older copy is not "updated" without its material change', () => {
    // the phone imported over its cached copy (still pending there): its revision won field by field, nothing more
    expect(isUpdated(base({}))).toBe(false);
    // (r070) the person's own decision is never "updated" whatever marker an earlier version left on it
    expect(isUpdated(base({ updatedFrom: { base: 'rev1', revision: 'rev2', changes: ['times'] } }))).toBe(false);
    // an automatic one is, and is booked again silently
    expect(isUpdated(base({ decidedBy: 'auto', updatedFrom: { base: 'rev1', revision: 'rev2', changes: ['times'] } }))).toBe(true);
    // a marker of an earlier decision or another revision does not count
    expect(isUpdated(base({ decidedBy: 'auto', updatedFrom: { base: 'rev0', revision: 'rev2', changes: ['times'] } }))).toBe(false);
    expect(isUpdated(base({ decidedBy: 'auto', updatedFrom: { base: 'rev1', revision: 'rev3', changes: ['times'] } }))).toBe(false);
  });

  it('a decided activity an older copy superseded (its status won) goes back to its decision', () => {
    const stale = base({ status: 'superseded', revision: 'rev1', withdrawn: { reason: 'detectorWithdrawn', entryId: null, at: NOW, decided: { status: 'pending', revision: null } } });
    const p = planCandidateUpsert({ drafts: [], existing: new Map([['K', stale]]), refIndex: new Map([['hc:a', 'K']]), tz: 'UTC', now: NOW });
    expect(p.puts).toHaveLength(1);
    expect(p.puts[0]).toMatchObject({ status: 'approved', entryId: 'E1' });
    expect(p.puts[0]!.withdrawn).toBeUndefined();
    // a withdrawal of the decision itself (its source deleted upstream) is not touched
    const real = base({ status: 'superseded', withdrawn: { reason: 'sourceDeleted', entryId: 'E1', at: NOW, decided: { status: 'approved', revision: 'rev1' } } });
    expect(planCandidateUpsert({ drafts: [], existing: new Map([['K', real]]), refIndex: new Map(), tz: 'UTC', now: NOW }).puts).toEqual([]);
  });
});

describe('detection and revisions (pure)', () => {
  const eps = [walk1Ep(['hc:06ba71dd']), walk2Ep(['hc:06ba71dd'])];

  it('a Health Connect session two episodes link is split: two drafts, the session hosts neither', () => {
    const r = detectActivities({ hcSessions: [hcOuter('15:44:48')], episodes: eps, localDetectors: false, mintKey: () => '' });
    expect(r.drafts.map((d) => d.refs)).toEqual([['detect:bout:01M639J3'], ['detect:bout:01M63CZZ']]);
    expect(r.skipped).toEqual([{ ref: 'hc:06ba71dd', reason: 'splitByDetection' }]);
    expect(r.absorbed).toEqual([]);
    // one episode in it: the session hosts it as before
    const one = detectActivities({ hcSessions: [hcOuter('15:44:48')], episodes: [walk2Ep(['hc:06ba71dd'])], localDetectors: false, mintKey: () => '' });
    expect(one.drafts.map((d) => d.refs[0])).toEqual(['hc:06ba71dd']);
    expect(one.drafts[0]!.corroboratedBy).toEqual(['detect:bout:01M63CZZ']);
  });

  it('a Gauge recording two episodes link stays the one activity the person recorded', () => {
    const g = { id: 'g1', revision: 'u1', start: ms(D, 13), end: ms(D, 15), type: 'walk' };
    const r = detectActivities({ gaugeSessions: [g], episodes: [walk1Ep(['gauge:g1']), walk2Ep(['gauge:g1'])], localDetectors: false, mintKey: () => '' });
    expect(r.drafts.map((d) => d.refs[0])).toEqual(['gauge:g1']);
    expect(r.drafts[0]!.corroboratedBy.sort()).toEqual(['detect:bout:01M639J3', 'detect:bout:01M63CZZ']);
  });

  it("a session's revision is its content, never Google Fit's last_modified; a detector read or not changes no source revision", () => {
    expect(hcRevisionOf(hcBike('13:54:12'))).toBe(hcRevisionOf(hcBike('15:44:48')));
    expect(hcRevisionOf({ ...hcBike('x'), end: hcBike('x').end + 60_000 })).not.toBe(hcRevisionOf(hcBike('x')));
    const withEp = detectActivities({ hcSessions: [hcBike('a')], episodes: [bikeEp(['hc:254f74fe'])], localDetectors: false, mintKey: () => '' });
    const without = detectActivities({ hcSessions: [hcBike('b')], localDetectors: false, mintKey: () => '' });
    expect(withEp.drafts[0]!.corroboratedBy).toEqual(['detect:bout:01M630P9']);
    expect(withEp.drafts[0]!.sourceRevision).toBe(without.drafts[0]!.sourceRevision);
  });
});

describe('a lineage retraction (pure)', () => {
  type Row = { id: string; kind: string; supersedes?: string; target?: string; lineage?: boolean };
  const A: Row = { id: 'A', kind: 'session' };
  const B: Row = { id: 'B', kind: 'session', supersedes: 'A' };
  const ids = (xs: Row[]) => reduce(xs).map((e) => e.id);

  it('retracting the newest version alone brings the one before it back; a lineage marker retracts both', () => {
    expect(ids([A, B, { id: 'R', kind: 'retract', target: 'B' }])).toEqual(['A']);
    expect(ids([A, B, { id: 'R', kind: 'retract', target: 'B', lineage: true }])).toEqual([]);
  });

  it('one undo copy of a lineage marker restores the newest version only, through earlier undone markers too', () => {
    const R = { id: 'R', kind: 'retract', target: 'B', lineage: true };
    expect(ids([A, B, R, { id: 'U', kind: 'session', supersedes: 'R' }])).toEqual(['U']);
    // B was removed and restored before (U1), then the restored copy rejected with its lineage
    const R1 = { id: 'R1', kind: 'retract', target: 'B' };
    const U1 = { id: 'U1', kind: 'session', supersedes: 'R1' };
    expect(ids([A, B, R1, U1, { id: 'R2', kind: 'retract', target: 'U1', lineage: true }])).toEqual([]);
  });
});

describe('a Health Connect session is split at its segment gaps (no detections needed)', () => {
  /** Steps per minute over D: `walking` inside the two walks, `between` in the break. */
  const minutesOf = (between: number) => {
    const first = ms(D, 0);
    const steps = Array.from({ length: 1440 }, (_, k) => {
      const t = first + k * 60_000;
      if (t >= BLOCK1.start && t < BLOCK1.end) return 105;
      if (t >= BLOCK2.start && t < BLOCK2.end) return 98;
      if (t >= BLOCK1.end && t < BLOCK2.start) return between;
      return 0;
    });
    return { first, steps };
  };

  it("the owner's record: two blocks, 13:01:01–13:55:23 and 14:09:16–14:53:11, with or without the break's steps", () => {
    expect(hcBlocks(hcBoth('x'))).toEqual([BLOCK1, BLOCK2]);
    // 2–13 steps a minute between them (the fused steps that afternoon): still two
    expect(hcBlocks(hcBoth('x'), minutesOf(13))).toEqual([BLOCK1, BLOCK2]);
    // walking all through the gap: one activity
    expect(hcBlocks(hcBoth('x'), minutesOf(90))).toEqual([]);
    // the server reads the session the same way (its recordings for detect/2's overlap)
    const data = { payload: { exercise_type_code: 79, segments: SEGMENTS_06BA.map((g) => ({ start: new Date(g.start).toISOString(), end: new Date(g.end).toISOString() })) } };
    const steps = minutesOf(13);
    const stepAt = (t: number) => steps.steps[Math.floor((t - steps.first) / 60_000)] ?? null;
    expect(hcSessionBlocks(hcBoth('x').start, hcBoth('x').end, data, stepAt)).toEqual([BLOCK1, BLOCK2]);
    expect(hcSessionBlocks(hcBoth('x').start, hcBoth('x').end, data, () => 90)).toEqual([]);
  });

  it('without segments, a gait session splits at a run of near-zero steps; a cycling session never does', () => {
    expect(hcBlocks(hcOuter('x'), minutesOf(5))).toEqual([
      { start: hcOuter('x').start, end: ms(D, 13 + 56 / 60) },
      { start: ms(D, 14 + 10 / 60), end: hcOuter('x').end },
    ]);
    expect(hcBlocks({ ...hcOuter('x'), exerciseType: 8 }, minutesOf(5))).toEqual([]);
    expect(hcBlocks(hcOuter('x'))).toEqual([]);
  });

  it('two drafts with their own windows and stable revisions; minutes and estimates cover each block only', () => {
    const a = detectActivities({ hcSessions: [hcBoth('15:44:48')], localDetectors: false, mintKey: () => '' });
    const b = detectActivities({ hcSessions: [hcBoth('16:20:00')], localDetectors: false, mintKey: () => '' });
    expect(a.drafts.map((d) => [d.refs[0], d.window])).toEqual([
      [`hc:06ba71dd@${BLOCK1.start}`, BLOCK1],
      [`hc:06ba71dd@${BLOCK2.start}`, BLOCK2],
    ]);
    expect(a.drafts.map((d) => d.sourceRevision)).toEqual(b.drafts.map((d) => d.sourceRevision));
    expect(a.drafts.map((d) => Math.round(d.measures.durationMin))).toEqual([54, 44]);
  });

  it('through the import, with no detections at all: two walks to review, each its own minutes and energy', async () => {
    await pass({ hcSessions: [hcBoth('15:44:48')], serverDetector: undefined, minutes: [minutesOf(13)] });
    const rows = (await review()).rows;
    expect(rows.map((r) => [r.startAt, r.endAt])).toEqual([
      [new Date(BLOCK1.start).toISOString(), new Date(BLOCK1.end).toISOString()],
      [new Date(BLOCK2.start).toISOString(), new Date(BLOCK2.end).toISOString()],
    ]);
    expect(rows.map((r) => r.minutes)).toEqual([54, 44]);
    expect(rows.every((r) => r.kcal !== null && r.kcal.value > 0)).toBe(true);
    // the session deleted upstream: both walks go with it
    await pass({ deletedRefs: ['hc:06ba71dd'] });
    expect((await docs()).map((c) => c.status)).toEqual(['superseded', 'superseded']);
  });

  it('a session first imported whole (one candidate) is split later: the candidate goes on as the block it overlaps', async () => {
    await pass({ hcSessions: [hcOuter('15:01:07')] });
    const whole = (await byRef('hc:06ba71dd'))!;
    out(await dispatch('activity.edit', { id: whole.key, revision: whole.revision, startAt: iso(14 + 9 / 60), endAt: iso(14 + 53 / 60) }));
    await settleCommits();
    await pass({ hcSessions: [hcBoth('15:44:48')] });
    const all = await docs();
    expect(all).toHaveLength(2);
    expect(all.find((c) => c.key === whole.key)).toMatchObject({ status: 'edited', window: BLOCK2 });
    expect(all.find((c) => c.key !== whole.key)).toMatchObject({ status: 'pending', window: BLOCK1 });
    expect(sessions()).toHaveLength(1);
  });
});
