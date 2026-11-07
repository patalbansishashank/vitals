/**
 * 0.6.3 FX1 (final review sR01/aR02, aR14): deletions add up across import runs, compacted activities can still be
 * withdrawn, and a retracted weigh-in never sets an activity's mass.
 *  - sR01/aR02 probe: approved activity with sources `gauge:a` and `hc:b`; delete `gauge:a` in one run and `hc:b` in the
 *    next (used to withdraw nothing); supply both deletions for a compacted approved candidate (used to do nothing).
 *  - aR14 probe: profile weight 70 kg, log 100 kg, retract it: `personOn()` used to answer 100 kg.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bodyOf } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import { dispatch, settleCommits, type CommandResult } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { useProfileStore } from '@/state/profileStore';
import { addDays, effectiveEntries, localToInstant, type LogEntry } from '@/living';
import { compactResolved, planCandidateUpsert, type ActivityCandidateDoc, type CandidateRecord, type CandidateTombstone, type ReviewSheetModel } from '@/living/activityCandidates';
import { personOn, readCandidates } from '../activity';
import { readDocs } from '../index';

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const TODAY = '2026-10-21';
const Y = addDays(TODAY, -1);
const SYS = { actor: { kind: 'system' as const, id: 'gauge-import' } };
const ms = (date: string, h: number) => Date.parse(localToInstant(date, h, TZ));
const out = <T,>(r: CommandResult): T => {
  if (!r.ok || !('output' in r)) throw new Error(JSON.stringify(r));
  return r.output as T;
};

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterAll(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------------------------- the planner (pure)

const NOW = '2026-10-21T12:00:00.000Z';
function approved(sources: string[], over: Partial<ActivityCandidateDoc> = {}): ActivityCandidateDoc {
  return {
    key: 'K', date: Y, tz: 'UTC', startAt: '2026-10-20T18:00:00.000Z', endAt: '2026-10-20T18:30:00.000Z', window: { start: 0, end: 1_800_000 },
    refs: [...sources, 'detect:cad:1'].sort(), sources: sources.map((ref) => ({ source: ref.startsWith('gauge:') ? 'gaugeSession' : 'hcSession', ref, revision: 'r1', confidence: 'high' })),
    sourceRevision: 's1', estimateRevision: 'e1', revision: 'rev1', suggested: { exerciseId: 'run', confidence: 'high', needsReview: false, why: [] }, measures: {} as never, estimate: null,
    corroboratedBy: ['detect:cad:1'], mergeSuggestions: [], planMatch: null, status: 'approved', decidedRevision: 'rev1', baseRevision: 'rev1', entryId: 'E1', decidedAt: '2026-10-20T19:00:00.000Z',
    decidedBy: 'user', decision: { kind: 'approve' } as never, decidedEstimate: null, history: [], firstSeenAt: '2026-10-20T18:31:00.000Z', updatedAt: '2026-10-20T19:00:00.000Z', resolvedAt: '2026-10-20T19:00:00.000Z',
    ...over,
  } as ActivityCandidateDoc;
}
const refIndex = new Map([['gauge:a', 'K'], ['hc:b', 'K'], ['detect:cad:1', 'K']]);
const pass = (rec: CandidateRecord, deletedRefs: string[]) => planCandidateUpsert({ drafts: [], deletedRefs, existing: new Map([['K', rec]]), refIndex, tz: 'UTC', now: NOW });

describe('sR01/aR02: deletions accumulate per source across runs', () => {
  it('gauge:a deleted in one run, hc:b in the next: the second run withdraws the activity and retracts its entry', () => {
    const p1 = pass(approved(['gauge:a', 'hc:b']), ['gauge:a']);
    expect(p1.retract).toEqual([]);
    const after1 = p1.puts.find((x) => x.key === 'K')!;
    // the deletion is remembered on the candidate (the reproduction: nothing was written, so run two forgot it)
    expect(after1).toMatchObject({ status: 'approved', deletedSources: ['gauge:a'] });
    const p2 = pass(after1, ['hc:b']);
    expect(p2.retract).toEqual([{ key: 'K', entryId: 'E1' }]);
    expect(p2.puts[0]).toMatchObject({ status: 'superseded', deletedSources: ['gauge:a', 'hc:b'], withdrawn: { reason: 'sourceDeleted', entryId: 'E1', at: NOW, decided: { status: 'approved', revision: 'rev1' } } });
    expect(p2.puts[0]!.history.at(-1)).toMatchObject({ status: 'approved', entryId: 'E1' });
    // the same deletions again write nothing more
    const p3 = pass(p2.puts[0]!, ['gauge:a', 'hc:b']);
    expect(p3).toMatchObject({ puts: [], records: [], retract: [] });
  });

  it('both deletions in one run still withdraw (unchanged behaviour); an unrelated ref changes nothing', () => {
    expect(pass(approved(['gauge:a', 'hc:b']), ['gauge:a', 'hc:b']).retract).toEqual([{ key: 'K', entryId: 'E1' }]);
    expect(pass(approved(['gauge:a', 'hc:b']), ['hc:zzz'])).toMatchObject({ puts: [], records: [], retract: [] });
  });

  it('a compacted approved activity is withdrawn too: its tombstone keeps the sources, the deletions and the audit row', () => {
    const old = approved(['gauge:a', 'hc:b'], { decidedAt: '2026-06-01T00:00:00.000Z', resolvedAt: '2026-06-01T00:00:00.000Z' });
    const [tomb] = compactResolved([old], NOW);
    expect(tomb).toMatchObject({ compact: true, sources: ['gauge:a', 'hc:b'], entryId: 'E1', status: 'approved' });
    // both together (the reproduction: a tombstone was skipped)
    const both = pass(tomb!, ['gauge:a', 'hc:b']);
    expect(both.retract).toEqual([{ key: 'K', entryId: 'E1' }]);
    expect(both.records[0]).toMatchObject({ compact: true, status: 'superseded', withdrawn: { reason: 'sourceDeleted', entryId: 'E1', decided: { status: 'approved', revision: 'rev1' } } });
    // one at a time
    const p1 = pass(tomb!, ['hc:b']);
    expect(p1.retract).toEqual([]);
    expect(p1.records[0]).toMatchObject({ status: 'approved', deletedSources: ['hc:b'] });
    const p2 = pass(p1.records[0]!, ['gauge:a']);
    expect(p2.retract).toEqual([{ key: 'K', entryId: 'E1' }]);
    // once withdrawn, nothing more
    expect(pass(p2.records[0]!, ['gauge:a', 'hc:b'])).toMatchObject({ records: [], retract: [] });
  });

  it('a tombstone written before FX1 (no sources) uses its Gauge and Health Connect refs; detector refs never block it', () => {
    const legacy: CandidateTombstone = { key: 'K', compact: true, refs: ['detect:cad:1', 'gauge:a', 'hc:b'], status: 'edited', decidedRevision: 'd1', entryId: 'E1', resolvedAt: '2026-06-01T00:00:00.000Z' };
    const p1 = pass(legacy, ['gauge:a']);
    expect(p1.retract).toEqual([]);
    expect(pass(p1.records[0]!, ['hc:b']).retract).toEqual([{ key: 'K', entryId: 'E1' }]);
    // a rejected tombstone only keeps the deletions (nothing is booked)
    const rej: CandidateTombstone = { ...legacy, status: 'rejected', entryId: null };
    expect(pass(rej, ['gauge:a', 'hc:b'])).toMatchObject({ retract: [], records: [{ status: 'rejected', deletedSources: ['gauge:a', 'hc:b'] }] });
  });
});

// ---------------------------------------------------------------------------------------------- through the commands

function enterBasics(weight = 80): void {
  const p = useProfileStore.getState();
  p.setAge(40);
  p.setHeight(169);
  p.setWeight(weight);
}
const runY = () => ({ id: 'g-run', revision: 'r1', start: ms(Y, 18), end: ms(Y, 18.5), type: 'run', kcal: 330 });
async function fromGauge(i: { gaugeSessions?: Array<ReturnType<typeof runY>>; deletedRefs?: string[] }) {
  const r = await dispatch('activity.fromGauge', { gaugeSessions: i.gaugeSessions ?? [], hcSessions: [], ...(i.deletedRefs ? { deletedRefs: i.deletedRefs } : {}) }, SYS);
  await settleCommits();
  return out<{ created: string[]; superseded: string[]; compacted: number }>(r);
}
const allLogs = (): LogEntry[] => getDocumentStore().peekAll<LogEntry>('dailyLogs').map((d) => ({ ...bodyOf<LogEntry>(d), id: d._id }) as LogEntry);
const sessions = () => effectiveEntries(allLogs()).filter((e) => e.kind === 'session');

describe('sR01/aR02 through activity.fromGauge: a compacted approved activity leaves replay', () => {
  beforeEach(async () => {
    vi.setSystemTime(new Date(ms(TODAY, 12)));
    freshState({ cleared: true });
    await getDocumentStore().ready;
    enterBasics();
  });

  it('approved, compacted 100 days later, then deleted upstream: its session is retracted and the tombstone audited', async () => {
    await fromGauge({ gaugeSessions: [runY()] });
    const row = out<ReviewSheetModel>(await dispatch('activity.candidates', { from: Y, to: Y })).rows[0]!;
    const ap = out<{ entryId: string }>(await dispatch('activity.approve', { id: row.id, revision: row.revision }));
    await settleCommits();
    vi.setSystemTime(new Date(ms(addDays(TODAY, 100), 12)));
    expect((await fromGauge({})).compacted).toBe(1);
    expect((await readCandidates()).byKey.get(row.id)).toMatchObject({ compact: true, sources: ['gauge:g-run'] });
    expect(sessions()).toHaveLength(1);
    const r = await fromGauge({ deletedRefs: ['gauge:g-run'] });
    expect(r.superseded).toEqual([row.id]);
    expect(sessions()).toHaveLength(0);
    expect(allLogs().filter((e) => e.kind === 'retract' && (e as { target?: string }).target === ap.entryId)).toHaveLength(1);
    expect((await readCandidates()).byKey.get(row.id)).toMatchObject({ compact: true, status: 'superseded', withdrawn: { reason: 'sourceDeleted', entryId: ap.entryId } });
  });
});

describe('aR14: a retracted weigh-in never sets the mass', () => {
  beforeEach(async () => {
    vi.setSystemTime(new Date(ms(TODAY, 12)));
    freshState({ cleared: true });
    await getDocumentStore().ready;
  });

  it('profile 70 kg, log 100 kg, retract it: personOn answers 70 kg (it used to answer 100)', async () => {
    enterBasics(70);
    const logged = out<{ entryId: string }>(await dispatch('log.measurement', { metric: 'weightKg', value: 100, date: Y }));
    await settleCommits();
    expect(personOn(TODAY, await readDocs(TODAY))!.massKg).toBe(100);
    out(await dispatch('log.retract', { entryId: logged.entryId }));
    await settleCommits();
    expect(personOn(TODAY, await readDocs(TODAY))!.massKg).toBe(70);
  });
});

describe('sR03/aR05 through log.fromGauge: the answered days retract an entry whose evidence is gone', () => {
  beforeEach(async () => {
    vi.setSystemTime(new Date(ms(TODAY, 12)));
    freshState({ cleared: true });
    await getDocumentStore().ready;
  });

  it('steps imported, then the server answers the day with none: the steps entry leaves the log (the schema takes answered)', async () => {
    const day = { date: Y, steps: 6000, fusion: { version: 'steps-fuse/1', located: 6000, headlinePolicy: 'atLeast' as const, coverage: { ringMin: 60, phoneMin: 0, eitherMin: 60, unknownMin: 0 } } };
    out(await dispatch('log.fromGauge', { steps: [day], sleep: [] }, SYS));
    await settleCommits();
    const live = () => effectiveEntries(allLogs()).filter((e) => e.kind === 'steps' && e.date === Y);
    expect(live()).toHaveLength(1);
    out(await dispatch('log.fromGauge', { steps: [], sleep: [], answered: { steps: [Y], sleep: { from: Y, to: TODAY } } }, SYS));
    await settleCommits();
    expect(live()).toHaveLength(0);
  });
});
