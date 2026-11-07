// @vitest-environment node
/**
 * lumen.db schema version 4 (r063 SRV): the materialised `event_state` equals what the version-3 views computed per
 * read, on fixtures with versions, redeliveries, exact / range / group / `*` deletions, kinds by subject and by
 * `data.metric`, Health Connect revisions and tombstones, and sessions whose newest version is deleted; the v3 → v4
 * migration (including the emergency hotfix's cleanup); and a performance bound on a synthetic ~50k-event file.
 */
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  activityDaily, battery, deletion, hcDeleted, hcRecord, hr, INSTALL, metric, OTHER_INSTALL, ringSteps, shortVideo, sleepPacket, workout, type LumenTestEvent,
} from './lumenFixtures.ts';
import { LUMEN_SCHEMA_VERSION, migrateLumen, VIEW_NAMES, VIEWS_V3 } from './lumenMigrate.ts';
import { categoryGroups, rebuildState } from './lumenState.ts';
import { openLumenStore, type LumenStore } from './lumenStore.ts';
import { lumenToolSet } from './lumenTools.ts';

const TMP = process.env.TMPDIR ?? '/tmp';
let dir = '';
const stores: LumenStore[] = [];
const dbs: Database.Database[] = [];
const tmp = () => (dir = mkdtempSync(join(TMP, 'lumen-state-')));
const open = (file: string) => {
  const s = openLumenStore(file);
  stores.push(s);
  return s;
};
const raw = (file: string) => {
  const db = new Database(file);
  dbs.push(db);
  return db;
};
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const d of dbs.splice(0)) if (d.open) d.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

// the views added after version 3 (hc_deleted_records in 4; the activity-recognition views in 5) have no v3 twin
const V3_VIEWS = VIEW_NAMES.filter((v) => v !== 'hc_deleted_records' && v !== 'activity_transitions' && v !== 'ar_acquisition');

/** Every row of a view, all columns, in a total order. */
function readView(db: Database.Database, name: string): unknown[] {
  const cols = (db.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>).map((c) => `"${c.name}"`);
  return db.prepare(`SELECT ${cols.join(', ')} FROM ${name} ORDER BY ${cols.join(', ')}`).all();
}

/** What the version-3 views show for this file: recreated in a transaction that is rolled back. */
function v3Views(db: Database.Database): Record<string, unknown[]> {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const v of VIEW_NAMES) db.exec(`DROP VIEW IF EXISTS ${v}`);
    db.exec(VIEWS_V3);
    return Object.fromEntries(V3_VIEWS.map((v) => [v, readView(db, v)]));
  } finally {
    db.exec('ROLLBACK');
  }
}
const v4Views = (db: Database.Database) => Object.fromEntries(V3_VIEWS.map((v) => [v, readView(db, v)]));
const stateRows = (db: Database.Database) => db.prepare('SELECT seq, hidden, current, latest, retracted FROM event_state ORDER BY seq').all();
/** The incrementally kept state equals a set-based rebuild (in a rolled-back transaction). */
function rebuilt(db: Database.Database) {
  db.exec('BEGIN IMMEDIATE');
  try {
    rebuildState(db);
    return stateRows(db);
  } finally {
    db.exec('ROLLBACK');
  }
}

// --- a seeded random history: versions, redeliveries, deletions of every shape, HC revisions and tombstones, sessions

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const T0 = Date.parse('2026-10-20T00:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');

/**
 * `shareHc`: both installations name the same Health Connect records and read the same ring (the Vitals app's Gauge engine
 * and the standalone app on one phone). The version-3 views, which keep an installation's records apart, cannot be the
 * oracle for that.
 */
function history(seed: number, n: number, shareHc = false): Array<{ install: string; events: LumenTestEvent[]; nowMs: number }> {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const minute = () => T0 + Math.floor(r() * 40) * 60_000;
  const recv = (at: number) => iso(at + Math.floor(r() * 30) * 3_600_000);
  const sent: Array<{ install: string; e: LumenTestEvent }> = [];
  const batches: Array<{ install: string; events: LumenTestEvent[]; nowMs: number }> = [];
  let now = T0 + 40 * 3_600_000;
  for (let b = 0; b < n; b++) {
    const install = r() < 0.75 ? INSTALL : OTHER_INSTALL;
    const o = (at: number) => ({ install, receivedAt: recv(at) });
    const hcId = (id: string) => (shareHc || install === INSTALL ? id : `${id}-2`);
    const events: LumenTestEvent[] = [];
    for (let k = 0; k < 12; k++) {
      const at = minute();
      const x = r();
      if (x < 0.2) events.push(hr(iso(at), 50 + Math.floor(r() * 4), o(at)));
      else if (x < 0.28) events.push(metric('spo2', '%', iso(at), 95 + Math.floor(r() * 3), o(at)));
      else if (x < 0.4) events.push(ringSteps(iso(at), Math.floor(r() * 3) * 10, {}, o(at)));
      else if (x < 0.45) events.push(sleepPacket(iso(at), r() < 0.5 ? ['light', 'deep'] : ['rem'], o(at)));
      else if (x < 0.5) events.push(activityDaily(iso(T0 + 3_600_000 * Math.floor(r() * 3)), 1000 * Math.floor(r() * 4), o(at)));
      else if (x < 0.62) {
        const id = pick(['a', 'b', 'c']);
        const lm = at + Math.floor(r() * 3) * 600_000;
        events.push(hcRecord('Steps', hcId(id), iso(T0), iso(T0 + 600_000), { count: Math.floor(r() * 3) * 100 }, { lastModified: iso(lm), origin: 'com.google.android.apps.fitness', native: false }, o(at)));
      } else if (x < 0.67) events.push(hcDeleted('Steps', hcId(pick(['a', 'b', 'c'])), iso(at + Math.floor(r() * 3) * 600_000), o(at)));
      else if (x < 0.72) events.push(workout(pick(['w-1', 'w-2']), iso(T0 + 1_800_000), { kcal: 100 * Math.floor(r() * 3) }, o(at)));
      else if (x < 0.76) events.push(shortVideo(pick(['2026-10-20', '2026-10-21']), iso(at), { instagram: Math.floor(r() * 3) }, {}, o(at)));
      else if (x < 0.8) events.push(battery(iso(at), 50 + Math.floor(r() * 3), o(at)));
      else if (x < 0.9 && sent.length) {
        // a redelivery: the same id, received again later
        const mine = sent.filter((x) => x.install === install);
        if (!mine.length) continue;
        const prev = pick(mine).e;
        events.push({ ...prev, data: { ...prev.data, received_at: iso(Date.parse(prev.data.received_at) + Math.floor(r() * 40) * 3_600_000) } });
      } else {
        const dAt = T0 + Math.floor(r() * 50) * 3_600_000;
        const y = r();
        const target =
          y < 0.3 ? { category: 'metrics/hr', kind: 'hr', from: iso(at), to: iso(at) }
          : y < 0.45 ? { category: 'metrics', kind: pick(['hr', 'spo2', 'nope']), from: iso(at - 90_000), to: iso(at + 90_000) }
          : y < 0.55 ? { category: 'activity/buckets', from: iso(at - 300_000), to: iso(at + 300_000) }
          : y < 0.62 ? { category: 'activity', kind: pick(['ring_steps', 'daily_activity']), from: iso(T0), to: iso(T0 + 3 * 3_600_000) }
          : y < 0.7 ? { category: 'hc', from: iso(T0 - 60_000), to: iso(T0 + 60 * 60_000) }
          : y < 0.76 ? { category: 'activity/session', from: iso(T0), to: iso(T0 + 3_600_000) }
          : y < 0.82 ? { category: 'habits', from: iso(T0), to: iso(T0 + 3 * 86_400_000) }
          : y < 0.86 ? { category: 'state/battery', from: iso(T0), to: iso(T0 + 86_400_000) }
          : y < 0.93 ? { category: '*', from: iso(at - 600_000), to: iso(at + 600_000) }
          : { category: '*' };
        events.push(deletion(iso(dAt), target, { install, receivedAt: iso(dAt + Math.floor(r() * 2) * 60_000) }));
      }
    }
    // (r070) the oracle keeps one ring per installation (the version-3 views keep each installation's readings apart); a ring
    // shared by both installations is the `shareHc` history's, checked against a rebuild only
    if (!shareHc && install !== INSTALL) for (const e of events) if (typeof e.data.device_key === 'string') e.data.device_key = 'fedcba9876543210';
    for (const e of events) sent.push({ install, e });
    now += 60_000;
    batches.push({ install, events, nowMs: r() < 0.2 ? now - 60_000 : now });
  }
  return batches;
}

describe('event_state (lumen.db v4)', () => {
  it('categoryGroups: the deletion targets a category belongs to besides itself and *', () => {
    expect(categoryGroups('metrics/hr')).toEqual(['metrics']);
    expect(categoryGroups('deletion')).toEqual([]);
    expect(categoryGroups('a/b/c')).toEqual(['a', 'a/b']);
  });

  for (const seed of [1, 2, 3, 7, 42]) {
    it(`kept incrementally, it equals the version-3 views and a set-based rebuild after every batch (seed ${seed})`, () => {
      tmp();
      const file = join(dir, 'lumen.db');
      const s = open(file);
      const db = raw(file);
      let deletions = 0;
      for (const b of history(seed, 30)) {
        const res = s.ingest(b.install, b.events, b.nowMs);
        expect(res.rejected).toEqual([]);
        deletions += b.events.filter((e) => e.category === 'deletion').length;
        expect(stateRows(db)).toEqual(rebuilt(db));
        expect(v4Views(db)).toEqual(v3Views(db));
      }
      // the fixture exercised what it is for
      const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
      expect(deletions).toBeGreaterThan(10);
      expect(n('SELECT COUNT(*) AS n FROM event_state WHERE hidden = 1')).toBeGreaterThan(5);
      expect(n("SELECT COUNT(*) AS n FROM event_state WHERE category = 'hc/record'")).toBeGreaterThan(3);
    });
  }

  // (r070) two installations on one phone: the records they share are one, kept incrementally exactly as a rebuild computes them
  for (const seed of [1, 2, 3, 42]) {
    it(`two installations sharing Health Connect records: incremental state equals a rebuild after every batch (seed ${seed})`, () => {
      tmp();
      const file = join(dir, 'lumen.db');
      const s = open(file);
      const db = raw(file);
      for (const b of history(seed, 30, true)) {
        expect(s.ingest(b.install, b.events, b.nowMs).rejected).toEqual([]);
        expect(stateRows(db)).toEqual(rebuilt(db));
      }
      // one latest revision per shared record, whichever installation sent it
      expect((db.prepare("SELECT COUNT(*) AS n FROM (SELECT subject FROM event_state WHERE category = 'hc/record' AND latest = 1 GROUP BY subject HAVING COUNT(*) > 1)").get() as { n: number }).n).toBe(0);
    });
  }

  it('a deleted newest session version hides the session; an older one never comes back', () => {
    tmp();
    const s = open(join(dir, 'lumen.db'));
    s.ingest(INSTALL, [workout('w-1', '2026-10-20T01:15:00Z', {}, { receivedAt: '2026-10-20T01:16:00Z' })]);
    s.ingest(INSTALL, [workout('w-1', '2026-10-20T01:15:00Z', { kcal: 400 }, { receivedAt: '2026-10-21T02:00:00Z' })]);
    s.ingest(INSTALL, [deletion('2026-10-21T01:00:00Z', { category: 'activity/session', from: '2026-10-20T00:00:00Z', to: '2026-10-20T23:00:00Z' })]);
    // the deletion was received before the newest version: only the older one is covered, the newest still shows
    expect(s.all<{ kcal: number }>("SELECT json_extract(data, '$.kcal') AS kcal FROM workout_sessions")).toEqual([{ kcal: 400 }]);
    s.ingest(INSTALL, [deletion('2026-10-22T00:00:00Z', { category: 'activity/session', from: '2026-10-20T00:00:00Z', to: '2026-10-20T23:00:00Z' })]);
    expect(s.all('SELECT * FROM workout_sessions')).toEqual([]);
  });

  it('a redelivery after a reset shows the event again, and only its own version group changes', () => {
    tmp();
    const s = open(join(dir, 'lumen.db'));
    const a = hr('2026-10-20T01:00:00Z', 60, { receivedAt: '2026-10-20T01:00:00Z' });
    s.ingest(INSTALL, [a, hr('2026-10-20T01:01:00Z', 61)]);
    s.ingest(INSTALL, [deletion('2026-10-21T00:00:00Z', { category: '*' })]);
    expect(s.status().counts).toEqual({});
    s.ingest(INSTALL, [{ ...a, data: { ...a.data, received_at: '2026-10-21T00:10:00Z' } }]);
    expect(s.all<{ value: number }>("SELECT value FROM metric_series WHERE kind = 'hr'")).toEqual([{ value: 60 }]);
    expect(s.status()).toMatchObject({ counts: { 'metrics/hr': 1 }, lastObservedAt: '2026-10-20T01:00:00.000Z' });
  });

  it('a deletion covering more rows than the bulk limit rebuilds in one pass, with the same result', () => {
    tmp();
    const file = join(dir, 'lumen.db');
    const s = open(file);
    const events = Array.from({ length: 2500 }, (_, i) => hr(iso(T0 + i * 1000), 60 + (i % 5)));
    for (let i = 0; i < events.length; i += 500) s.ingest(INSTALL, events.slice(i, i + 500), T0 + 86_400_000);
    s.ingest(INSTALL, [hr(iso(T0 + 5_000_000), 70, { receivedAt: iso(T0 + 3 * 86_400_000) })], T0 + 3 * 86_400_000);
    s.ingest(INSTALL, [deletion(iso(T0 + 2 * 86_400_000), { category: 'metrics', from: iso(T0), to: iso(T0 + 10_000_000) })], T0 + 2 * 86_400_000);
    const db = raw(file);
    expect(s.status().counts).toEqual({ 'metrics/hr': 1 });
    expect(stateRows(db)).toEqual(rebuilt(db));
    expect(v4Views(db)).toEqual(v3Views(db));
  });

  it('dedupe and its undo keep the state (one set-based pass each)', () => {
    tmp();
    const file = join(dir, 'lumen.db');
    const s = open(file);
    // the same night stored twice, 383 s apart (2.7.3's clock correction), the later copy received later
    s.ingest(INSTALL, [sleepPacket('2026-10-19T17:00:00Z', ['light', 'deep', 'rem'], { receivedAt: '2026-10-19T23:00:00Z' })]);
    s.ingest(INSTALL, [sleepPacket('2026-10-19T16:53:37Z', ['light', 'deep', 'rem'], { receivedAt: '2026-10-20T23:00:00Z' })]);
    const db = raw(file);
    const r = s.dedupe({ categories: ['sleep/timeline'], offsetMs: 383_000 });
    expect(stateRows(db)).toEqual(rebuilt(db));
    expect(v4Views(db)).toEqual(v3Views(db));
    expect(s.undoDedupe()).toBe(r.written);
    expect(stateRows(db)).toEqual(rebuilt(db));
    expect(v4Views(db)).toEqual(v3Views(db));
  });

  it('a file another writer changed since (events or deletions) is rebuilt on open', () => {
    tmp();
    const file = join(dir, 'lumen.db');
    const s = open(file);
    s.ingest(INSTALL, [hr('2026-10-20T01:00:00Z', 60), hr('2026-10-20T01:05:00Z', 61)]);
    s.close();
    const db = raw(file);
    db.prepare(`INSERT INTO deletions (id, installation_id, category, kind, from_ms, to_ms, at_ms, observed_at, received_at, data, ingested_at)
      VALUES ('x', ?, 'metrics/hr', 'hr', ?, ?, ?, 'a', 'a', '{}', 'a')`).run(INSTALL, Date.parse('2026-10-20T01:00:00Z'), Date.parse('2026-10-20T01:00:00Z'), Date.parse('2026-10-22T00:00:00Z'));
    db.close();
    const again = open(file);
    expect(again.all<{ value: number }>("SELECT value FROM metric_series WHERE kind = 'hr'")).toEqual([{ value: 61 }]);
  });
});

/** Turns a v4 file back into what the live v3 server left: no event_state, version-3 views, user_version 3. */
function downgrade(file: string, hotfix = false) {
  const db = new Database(file);
  db.exec('BEGIN');
  for (const v of VIEW_NAMES) db.exec(`DROP VIEW IF EXISTS ${v}`);
  db.exec('DROP TABLE event_state; DROP INDEX IF EXISTS deletions_from; DROP INDEX IF EXISTS deletions_wide');
  db.exec(`DELETE FROM lumen_meta WHERE key LIKE 'span_max:%' OR key LIKE 'state_%'`);
  db.exec(VIEWS_V3);
  if (hotfix) {
    // the shape of the 2026-10-28 emergency hotfix: a hidden-id table, triggers and a replaced visible_events
    db.exec(`CREATE TABLE hotfix_hidden (id TEXT PRIMARY KEY);
      CREATE TRIGGER hotfix_deletions AFTER INSERT ON deletions BEGIN INSERT OR IGNORE INTO hotfix_hidden (id) SELECT id FROM events WHERE category = NEW.category AND observed_ms BETWEEN NEW.from_ms AND NEW.to_ms; END;
      CREATE TRIGGER hotfix_events AFTER INSERT ON events BEGIN SELECT 1; END;
      CREATE INDEX hotfix_idx ON events (installation_id);
      DROP VIEW visible_events;
      CREATE VIEW visible_events AS SELECT e.rowid AS seq, e.* FROM events e WHERE e.category <> 'deletion' AND e.id NOT IN (SELECT id FROM hotfix_hidden);`);
  }
  db.pragma('user_version = 3');
  db.exec('COMMIT');
  db.close();
}

describe('Health Connect deletions (gauge_hc deleted)', () => {
  const rec = (id: string, count: number, lastModified: string, type = 'ExerciseSession', o: { install?: string } = {}) =>
    type === 'Steps'
      ? hcRecord('Steps', id, '2026-10-20T01:00:00Z', '2026-10-20T01:10:00Z', { count }, { lastModified, origin: 'com.google.android.apps.fitness', native: false }, o)
      : hcRecord('ExerciseSession', id, '2026-10-20T07:00:00Z', '2026-10-20T07:40:00Z', { exercise_type: 79, segments: [], laps: [], route_state: 'none' }, { lastModified, origin: 'com.strava', native: false }, o);
  const call = async (s: LumenStore, args: Record<string, unknown>) => {
    const env = await lumenToolSet(() => s, 'UTC').call('gauge_hc', { from: '2026-10-20', to: '2026-10-20', ...args });
    expect(env.ok).toBe(true);
    return env.data as { records: Array<{ id: string }>; deleted: Array<{ id: string; recordType: string; deletedAt: string | null; lastModified: string | null; start: string }> };
  };

  it('a tombstone Gauge read from the changes token hides the record and lists it as deleted; a later revision brings it back', async () => {
    tmp();
    const s = open(join(dir, 'lumen.db'));
    s.ingest(INSTALL, [rec('run-1', 0, '2026-10-20T08:00:00Z'), rec('run-2', 0, '2026-10-20T08:00:00Z'), rec('st-1', 500, '2026-10-20T02:00:00Z', 'Steps')]);
    s.ingest(INSTALL, [hcDeleted('ExerciseSession', 'run-1', '2026-10-20T09:00:00Z')]);
    let d = await call(s, { type: 'ExerciseSession' });
    expect(d.records.map((r) => r.id)).toEqual(['run-2']);
    expect(d.deleted).toEqual([{ id: 'run-1', recordType: 'ExerciseSession', start: '2026-10-20T07:00:00+00:00', end: '2026-10-20T07:40:00+00:00', originPackage: 'com.strava', lastModified: '2026-10-20T08:00:00+00:00', deletedAt: '2026-10-20T09:00:00+00:00' }]);
    // another type's list is its own; a range that misses the record does not list it
    expect((await call(s, { type: 'Steps' })).deleted).toEqual([]);
    expect((await call(s, { type: 'ExerciseSession', from: '2026-10-21', to: '2026-10-21' })).deleted).toEqual([]);
    // the record revised after the deletion (Health Connect restored it): current again, no longer deleted
    s.ingest(INSTALL, [rec('run-1', 0, '2026-10-20T10:00:00Z')]);
    d = await call(s, { type: 'ExerciseSession' });
    expect(d.records.map((r) => r.id).sort()).toEqual(['run-1', 'run-2']);
    expect(d.deleted).toEqual([]);
  });

  it('a tombstone before the latest revision deletes nothing; one from another installation retracts the shared record; a soft deletion of the tombstone undeletes', async () => {
    tmp();
    const file = join(dir, 'lumen.db');
    const s = open(file);
    s.ingest(INSTALL, [rec('run-1', 0, '2026-10-20T08:00:00Z')]);
    s.ingest(INSTALL, [hcDeleted('ExerciseSession', 'run-1', '2026-10-20T07:59:00Z')]);
    expect((await call(s, { type: 'ExerciseSession' })).deleted).toEqual([]);
    // (r070) a record id is Health Connect's, not the installation's: a tombstone another installation read retracts it
    s.ingest(OTHER_INSTALL, [hcDeleted('ExerciseSession', 'run-1', '2026-10-20T09:00:00Z', { install: OTHER_INSTALL })]);
    expect((await call(s, { type: 'ExerciseSession' })).records).toEqual([]);
    expect((await call(s, { type: 'ExerciseSession' })).deleted.map((x) => x.id)).toEqual(['run-1']);
    // that installation withdraws its hc/deleted events (a deletion of the hc group received later): the record shows again
    s.ingest(OTHER_INSTALL, [deletion('2026-10-21T00:00:00Z', { category: 'hc/deleted', from: '2026-10-20T00:00:00Z', to: '2026-10-20T23:59:59Z' }, { install: OTHER_INSTALL })]);
    const d = await call(s, { type: 'ExerciseSession' });
    expect([d.records.map((r) => r.id), d.deleted]).toEqual([['run-1'], []]);
    const db = raw(file);
    expect(stateRows(db)).toEqual(rebuilt(db));
    expect(v4Views(db)).toEqual(v3Views(db));
  });
});

describe('migration v3 → v4', () => {
  it('migrates a v3 file in one step: every view reads as version 3 did, the hotfix is gone, and nothing in events or deletions changes', () => {
    tmp();
    const file = join(dir, 'lumen.db');
    const s = open(file);
    for (const b of history(11, 30)) s.ingest(b.install, b.events, b.nowMs);
    s.close();
    downgrade(file, true);
    const before = raw(file);
    const expected = v3Views(before);
    const hash = JSON.stringify([before.prepare('SELECT rowid, * FROM events ORDER BY rowid').all(), before.prepare('SELECT * FROM deletions ORDER BY id').all()]);
    before.close();
    const db = raw(file);
    const res = migrateLumen(db);
    expect(res).toEqual({ from: 3, to: LUMEN_SCHEMA_VERSION, applied: ['materialised visibility and currentness', 'detection episodes and activity recognition', 'sources shared across installations, installation roles'] });
    expect(LUMEN_SCHEMA_VERSION).toBe(6);
    expect(db.prepare("SELECT type, name FROM sqlite_master WHERE name LIKE 'hotfix%'").all()).toEqual([]);
    expect(v4Views(db)).toEqual(expected);
    expect(JSON.stringify([db.prepare('SELECT rowid, * FROM events ORDER BY rowid').all(), db.prepare('SELECT * FROM deletions ORDER BY id').all()])).toBe(hash);
    // the spans' longest lengths were back-filled
    expect(db.prepare("SELECT COUNT(*) AS n FROM lumen_meta WHERE key LIKE 'span_max:%'").get()).toMatchObject({ n: expect.any(Number) });
    expect((db.prepare("SELECT COUNT(*) AS n FROM lumen_meta WHERE key LIKE 'span_max:%'").get() as { n: number }).n).toBeGreaterThan(0);
    // and the store keeps it from there
    db.close();
    const s2 = open(file);
    s2.ingest(INSTALL, [deletion('2026-10-25T00:00:00Z', { category: '*' })], Date.parse('2026-10-25T00:00:00Z'));
    expect(Object.keys(s2.status().counts).length).toBeGreaterThan(0);
    const db2 = raw(file);
    expect(stateRows(db2)).toEqual(rebuilt(db2));
    expect(v4Views(db2)).toEqual(v3Views(db2));
  });
});

// --- performance: a synthetic file of ~50k events with ~5k point deletions (the incident's shape, smaller)

describe('performance on ~50k events', () => {
  it('migrates v3 → v4 quickly and answers every route-sized read well under the old per-row cost', { timeout: 120_000 }, async () => {
    tmp();
    const file = join(dir, 'lumen.db');
    const s = open(file);
    const day0 = Date.parse('2026-09-01T00:00:00Z');
    const days = 28;
    const batch: LumenTestEvent[] = [];
    let nowMs = day0 + days * 86_400_000;
    const flush = () => {
      if (batch.length) s.ingest(INSTALL, batch.splice(0), (nowMs += 1000));
    };
    const push = (e: LumenTestEvent) => {
      batch.push(e);
      if (batch.length >= 500) flush();
    };
    for (let d = 0; d < days; d++) {
      const base = day0 + d * 86_400_000;
      for (let m = 0; m < 1440; m += 1) push(hr(iso(base + m * 60_000), 55 + (m % 30)));
      for (let m = 0; m < 1440; m += 3) push(ringSteps(iso(base + m * 60_000), m % 50));
      for (let m = 0; m < 1440; m += 30) push(metric('spo2', '%', iso(base + m * 60_000), 97));
      push(activityDaily(iso(base + 23 * 3_600_000), 9000));
      push(sleepPacket(iso(base - 3 * 3_600_000), Array.from({ length: 300 }, (_, i) => (i % 3 ? 'light' : 'deep'))));
      for (let k = 0; k < 20; k++) push(hcRecord('Steps', `d${d}k${k}`, iso(base + k * 3_600_000), iso(base + k * 3_600_000 + 600_000), { count: 100 + k }));
    }
    flush();
    // Gauge 2.8.0's clock-duplicate cleanup: one exact-instant deletion per removed sample
    const dels: LumenTestEvent[] = [];
    for (let d = 0; d < days; d++) for (let m = 7; m < 1440; m += 8) dels.push(deletion(iso(day0 + d * 86_400_000 + 60 * 60_000 * 30), { category: 'metrics/hr', kind: 'hr', from: iso(day0 + d * 86_400_000 + m * 60_000), to: iso(day0 + d * 86_400_000 + m * 60_000) }, { receivedAt: iso(nowMs + 1) }));
    let t = performance.now();
    for (let i = 0; i < dels.length; i += 500) s.ingest(INSTALL, dels.slice(i, i + 500), (nowMs += 1000));
    const deletionIngestMs = performance.now() - t;
    const n = s.get<{ n: number }>('SELECT COUNT(*) AS n FROM events')!.n;
    expect(n).toBeGreaterThan(45_000);
    expect(dels.length).toBeGreaterThan(4_000);
    // 500-event batches of point deletions stay cheap (incremental, index lookups)
    expect(deletionIngestMs / (dels.length / 500)).toBeLessThan(1500);
    s.close();

    // migration from v3 (the live file's state) in one set-based pass
    downgrade(file);
    t = performance.now();
    const s2 = open(file);
    const migrateMs = performance.now() - t;
    expect(migrateMs).toBeLessThan(15_000);

    const tools = lumenToolSet(() => s2, 'UTC');
    const day = '2026-09-20';
    const calls: Array<[string, Record<string, unknown>]> = [
      ['gauge_data_availability', {}], ['gauge_metric_series', { kind: 'hr', from: day, to: day }], ['gauge_metric_series', { kind: 'hr', from: '2026-09-01', to: '2026-09-28', bucket: 'hour' }],
      ['gauge_daily_summary', { date: day }], ['gauge_sleep', { from: '2026-09-01', to: '2026-09-28' }], ['gauge_activity', { from: day, to: day }],
      ['gauge_steps', { from: day, to: day }], ['gauge_steps', { from: '2026-09-01', to: '2026-09-28' }], ['gauge_timeline', { date: day }], ['gauge_baselines', { date: day }],
      ['gauge_hc', { type: 'Steps', from: '2026-09-01', to: '2026-09-28' }], ['gauge_device_state', {}], ['gauge_workouts', { from: '2026-09-01', to: '2026-09-28' }],
    ];
    const slow: string[] = [];
    for (const [name, args] of calls) {
      await tools.call(name, args);
      t = performance.now();
      const env = await tools.call(name, args);
      const ms = performance.now() - t;
      expect(env.ok, name).toBe(true);
      // generous: the version-3 views took seconds to minutes per call on this shape; a slow CI box still passes
      if (ms > 1500) slow.push(`${name} ${JSON.stringify(args)}: ${Math.round(ms)} ms`);
    }
    expect(slow).toEqual([]);
    const hrDay = (await tools.call('gauge_metric_series', { kind: 'hr', from: day, to: day })).data as { points: unknown[] };
    expect(hrDay.points.length).toBe(1440 - 180);
  });
});
