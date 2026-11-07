/**
 * 0.6.3 FX1 (final review sR02/aR04), server side of the change feed:
 *  - a deletion that hides more than 500 imported records used to answer `resync: true, changes: []` (the client then
 *    acknowledged a cursor without reconciling anything): it is now listed across pages, the cursor stopping inside the
 *    deletion, every page bounded;
 *  - `gauge_changes_state` answers the state now of named imported records (present / deleted / unknown) for a client's
 *    paged resync; unknown is never a deletion;
 *  - the hidden-record page is an index seek (never a scan), and a resumed page starts at its resume point.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FEED_MAX_SUBJECTS, parseCursor, subjectStates } from './changeFeed.ts';
import { deletion, hcDeleted, hcRecord, INSTALL, workout } from './lumenFixtures.ts';
import { openLumenStore } from './lumenStore.ts';
import { lumenToolSet } from './lumenTools.ts';

const TMP = process.env.TMPDIR ?? '/tmp';
const NOW = Date.parse('2026-10-21T04:00:00Z');
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const f of cleanup.splice(0).reverse()) f();
});
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function setup() {
  const dir = mkdtempSync(join(TMP, 'r063-fx1-'));
  const store = openLumenStore(join(dir, 'lumen.db'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }), () => store.close());
  const tools = lumenToolSet(() => store, 'Asia/Kolkata', () => NOW);
  const run = async (name: string, args: Record<string, unknown>) => {
    const env = await tools.call(name, args);
    if (!env.ok) throw new Error(JSON.stringify(env));
    return env.data as Json;
  };
  const ingest = (events: unknown[]) => {
    for (let k = 0; k < events.length; k += 400) expect(store.ingest(INSTALL, events.slice(k, k + 400), NOW).rejected).toEqual([]);
  };
  return { store, tools, run, ingest };
}
const at = (k: number) => new Date(Date.parse('2026-10-01T00:00:00Z') + k * 60_000).toISOString();
const sessions = (n: number) => Array.from({ length: n }, (_, k) => hcRecord('ExerciseSession', `ex-${String(k).padStart(4, '0')}`, at(k), at(k + 1), { exercise_type: 56, segments: [], laps: [], route_state: 'none' }, { origin: 'com.strava' }));

async function walk(run: (n: string, a: Record<string, unknown>) => Promise<Json>, since: string, limit?: number) {
  const seen: string[] = [];
  const cursors: string[] = [];
  let cursor = since;
  for (let k = 0; k < 200; k++) {
    const p = await run('gauge_changes', { since: cursor, ...(limit ? { limit } : {}) });
    expect(p.resync).toBe(false);
    seen.push(...p.changes.map((c: Json) => `${c.ref}:${c.change}`));
    cursor = p.cursor;
    cursors.push(cursor);
    if (!p.more) return { seen, cursors, cursor };
  }
  throw new Error('the feed never ended');
}

describe('sR02/aR04: a bulk deletion is listed across pages, never dropped for resync', () => {
  it('600 Health Connect sessions deleted by one "hc" deletion: pages of 500 + 100 deleted, the cursor inside the deletion', async () => {
    const t = setup();
    t.ingest([...sessions(600), workout('w-keep', '2026-10-20T01:15:00Z')]);
    const head = (await t.run('gauge_changes', {})).cursor as string;
    t.ingest([deletion('2026-10-21T03:00:00Z', { category: 'hc', from: '2026-09-30T00:00:00Z', to: '2026-10-02T00:00:00Z' }, { receivedAt: '2026-10-21T03:00:00Z' })]);
    const p1 = await t.run('gauge_changes', { since: head });
    // the reproduction: { resync: true, changes: [] }
    expect(p1.resync).toBe(false);
    expect(p1.changes).toHaveLength(500);
    expect(p1.more).toBe(true);
    expect(p1.changes.every((c: Json) => c.change === 'deleted' && c.kind === 'hcExercise')).toBe(true);
    expect(parseCursor(p1.cursor)).toMatchObject({ within: { t: 0 } });
    const p2 = await t.run('gauge_changes', { since: p1.cursor });
    expect(p2.changes).toHaveLength(100);
    expect(p2.more).toBe(false);
    const all = new Set([...p1.changes, ...p2.changes].map((c: Json) => c.ref));
    expect(all.size).toBe(600);
    expect(all.has('gauge:w-keep')).toBe(false);
    // nothing more after it
    expect((await t.run('gauge_changes', { since: p2.cursor })).changes).toEqual([]);
  });

  it('a "*" reset over workouts and sessions, walked with a tiny limit: every record exactly once, each page bounded', async () => {
    const t = setup();
    t.ingest([...sessions(23), workout('w-1', '2026-10-01T00:05:00Z'), workout('w-2', '2026-10-01T00:06:00Z'), hcRecord('Weight', 'wt-1', at(3), at(3), { kg: 80 }, { origin: 'com.withings' })]);
    const head = (await t.run('gauge_changes', {})).cursor as string;
    t.ingest([deletion('2026-10-21T03:00:00Z', { category: '*' }, { receivedAt: '2026-10-21T03:00:00Z' })]);
    const { seen, cursors } = await walk(t.run, head, 4);
    expect(seen.every((x) => x.endsWith(':deleted'))).toBe(true);
    expect(new Set(seen).size).toBe(26);
    expect(seen.length).toBe(26);
    expect(new Set(seen)).toEqual(new Set([...Array.from({ length: 23 }, (_, k) => `hc:ex-${String(k).padStart(4, '0')}:deleted`), 'gauge:w-1:deleted', 'gauge:w-2:deleted', 'hc:wt-1:deleted']));
    // the cursor stopped inside the deletion on the way (both targets), and every cursor parses
    expect(cursors.some((c) => parseCursor(c) !== 'invalid' && (parseCursor(c) as Json).within?.t === 1)).toBe(true);
    expect(cursors.every((c) => parseCursor(c) !== 'invalid' && c.length <= 64)).toBe(true);
  });

  it('the old cursor shape still reads; a cursor ahead of the store still answers resync', async () => {
    const t = setup();
    t.ingest(sessions(2));
    expect(parseCursor('c1.5.2')).toEqual({ seq: 5, del: 2 });
    expect(parseCursor('c1.5.2.1.-8640000000000000.0')).toEqual({ seq: 5, del: 2, within: { t: 1, obs: -8640000000000000, rs: 0 } });
    expect(parseCursor('c1.5.2.1')).toBe('invalid');
    expect((await t.run('gauge_changes', { since: 'c1.999999999.0' })).resync).toBe(true);
  });

  it('the hidden-record page is an index seek that starts at its resume point', () => {
    const t = setup();
    t.ingest(sessions(FEED_MAX_SUBJECTS + 5));
    const plan = t.store.all<{ detail: string }>(`EXPLAIN QUERY PLAN SELECT seq, observed_ms AS obs, subject FROM event_state INDEXED BY event_state_category
      WHERE category = ? AND observed_ms >= ? AND observed_ms <= ? AND hidden = 1 AND installation_id = ? AND (observed_ms > ? OR seq > ?)
      ORDER BY observed_ms, seq LIMIT ?`, 'hc/record', 0, 1, INSTALL, 0, 0, 500).map((r) => r.detail).join(' | ');
    expect(plan).toMatch(/SEARCH event_state USING INDEX event_state_category/);
  });
});

describe('sR02/aR04: gauge_changes_state, the authoritative state of named imported records', () => {
  it('present, deleted (tombstone or Gauge deletion) and unknown; refs are validated and bounded', async () => {
    const t = setup();
    t.ingest([
      ...sessions(3), workout('w-1', '2026-10-20T01:15:00Z'), workout('w-gone', '2026-10-20T02:15:00Z'), hcRecord('Weight', 'wt-1', at(3), at(3), { kg: 80 }, { origin: 'com.withings' }),
      hcDeleted('ExerciseSession', 'ex-0001', '2026-10-20T05:00:00Z'),
      deletion('2026-10-21T03:00:00Z', { category: 'activity/session', kind: 'w-gone', from: '2026-10-20T02:14:00Z', to: '2026-10-20T02:16:00Z' }, { receivedAt: '2026-10-21T03:00:00Z' }),
    ]);
    const r = await t.run('gauge_changes_state', { refs: 'workout:w-1,workout:w-gone,hcExercise:ex-0000,hcExercise:ex-0001,hcWeight:wt-1,hcExercise:never-seen,hcWeight:ex-0002' });
    expect(r.states.map((x: Json) => [x.ref, x.state])).toEqual([
      ['gauge:w-1', 'present'], ['gauge:w-gone', 'deleted'], ['hc:ex-0000', 'present'], ['hc:ex-0001', 'deleted'], ['hc:wt-1', 'present'],
      // never held: unknown (a restored store), never a deletion; a record of another type is not this one
      ['hc:never-seen', 'unknown'], ['hc:ex-0002', 'unknown'],
    ]);
    expect(r.states[3].at).toBe('2026-10-20T10:30:00+05:30');
    const bad = await t.tools.call('gauge_changes_state', { refs: 'nope' });
    expect(bad.ok === false && bad.error?.code).toBe('invalid_input');
    const many = await t.tools.call('gauge_changes_state', { refs: Array.from({ length: 101 }, (_, k) => `workout:w${k}`).join(',') });
    expect(many.ok === false && many.error?.code).toBe('invalid_input');
    expect(subjectStates(t.store, [{ kind: 'workout', id: 'w-1' }], [])).toEqual([{ kind: 'workout', id: 'w-1', ref: 'gauge:w-1', state: 'unknown', atMs: null }]);
  });
});
