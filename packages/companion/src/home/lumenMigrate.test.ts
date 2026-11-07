// @vitest-environment node
/** The lumen.db migrator (energy SPEC §S1): ordered, idempotent, never rewrites `events`, upgrades today's live file. */
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { activityBucket, ringSteps, shortVideo, workout, writeLegacyDb } from './lumenFixtures.ts';
import { LUMEN_SCHEMA_VERSION, migrateLumen, MIGRATIONS, SPAN_CATEGORIES, spanOf } from './lumenMigrate.ts';
import { openLumenStore, type LumenStore } from './lumenStore.ts';

const TMP = process.env.TMPDIR ?? '/tmp';
let dir: string;
const stores: LumenStore[] = [];
const dbs: Database.Database[] = [];
const tmp = () => (dir = mkdtempSync(join(TMP, 'lumen-migrate-')));
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
});

interface Fixture { installationId: string; groups: Record<'history' | 'revised' | 'deletion' | 'reset' | 'resent', unknown[]> }
/** The e2e fixture (Gauge's own mapper, `HubE2eFixtureTest.kt`) uploaded in the e2e script's order, plus workouts and short-video days. */
function realisticBatches() {
  const fx = JSON.parse(gunzipSync(readFileSync(new URL('../../scripts/lumen-e2e.fixture.json.gz', import.meta.url))).toString('utf8')) as Fixture;
  const install = fx.installationId;
  const o = { install };
  const t0 = Date.parse('2026-10-21T19:00:00Z');
  const extra = [
    workout('w-1', '2026-10-20T01:15:00Z', {}, { ...o, receivedAt: '2026-10-20T01:16:00Z' }),
    workout('w-1', '2026-10-20T01:15:00Z', { kcal: 400 }, { ...o, receivedAt: '2026-10-20T02:00:00Z' }),
    shortVideo('2026-10-20', '2026-10-20T15:00:00Z', { instagram: 4, youtube: 2 }, {}, o),
    shortVideo('2026-10-21', '2026-10-21T15:00:00Z', { instagram: 1, youtube: 0 }, {}, o),
  ];
  return {
    install,
    batches: [
      { installationId: install, events: fx.groups.history, nowMs: t0 },
      { installationId: install, events: fx.groups.history.slice(0, 50), nowMs: t0 + 1000 },
      { installationId: install, events: fx.groups.revised, nowMs: t0 + 2000 },
      { installationId: install, events: extra, nowMs: t0 + 3000 },
      { installationId: install, events: fx.groups.deletion, nowMs: t0 + 4000 },
      { installationId: install, events: fx.groups.reset, nowMs: t0 + 5000 },
      { installationId: install, events: fx.groups.resent, nowMs: t0 + 6000 },
    ],
  };
}

const eventsHash = (db: Database.Database) =>
  createHash('sha256').update(JSON.stringify(db.prepare('SELECT rowid AS r, * FROM events ORDER BY rowid').all())).digest('hex');
const deletionsHash = (db: Database.Database) => createHash('sha256').update(JSON.stringify(db.prepare('SELECT * FROM deletions ORDER BY id').all())).digest('hex');
/** Every view of the file with its columns: what the pre-§S1 readers select. */
const viewColumns = (db: Database.Database) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'view' ORDER BY name").all() as Array<{ name: string }>).map((v) => ({
    name: v.name, cols: (db.prepare(`PRAGMA table_info(${v.name})`).all() as Array<{ name: string }>).map((c) => c.name),
  }));
const readView = (db: Database.Database, v: { name: string; cols: string[] }) => {
  const cols = v.cols.map((c) => `"${c}"`).join(', ');
  return db.prepare(`SELECT ${cols} FROM ${v.name} ORDER BY ${cols}`).all();
};

describe('lumen.db migrations', () => {
  it('upgrades a copy of today\'s file (built from the e2e fixture) without touching events, and every old view reads the same', () => {
    tmp();
    const { batches } = realisticBatches();
    const live = join(dir, 'live.db');
    writeLegacyDb(live, batches);
    const before = raw(live);
    expect(before.pragma('user_version', { simple: true })).toBe(0);
    const legacyViews = viewColumns(before);
    expect(legacyViews.map((v) => v.name)).toEqual(['activity_buckets', 'current_events', 'daily_activity', 'device_state', 'insights', 'metric_series', 'short_video_days', 'sleep_timeline', 'visible_events', 'workout_sessions']);
    const expected = Object.fromEntries(legacyViews.map((v) => [v.name, readView(before, v)]));
    const hash = eventsHash(before);
    const delHash = deletionsHash(before);
    const nEvents = (before.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
    const nSpanEvents = (before.prepare(`SELECT COUNT(*) AS n FROM events WHERE category IN (${SPAN_CATEGORIES.map(() => '?').join(', ')})`).get(...SPAN_CATEGORIES) as { n: number }).n;
    expect(nEvents).toBeGreaterThan(500);
    expect(expected.activity_buckets!.length).toBeGreaterThan(0);
    before.close();

    const copy = join(dir, 'lumen.db');
    copyFileSync(live, copy);
    const s = open(copy);
    s.close();
    const after = raw(copy);
    expect(after.pragma('user_version', { simple: true })).toBe(LUMEN_SCHEMA_VERSION);
    expect(eventsHash(after)).toBe(hash);
    expect(deletionsHash(after)).toBe(delHash);
    // one installation: the source-aware views keep exactly what the old ones showed, column for column
    for (const v of legacyViews) expect([v.name, readView(after, v)]).toEqual([v.name, expected[v.name]]);
    // every span-bearing event got its span; the legacy ring buckets read as lineage ring, duration unknown
    expect((after.prepare('SELECT COUNT(*) AS n FROM event_spans').get() as { n: number }).n).toBe(nSpanEvents);
    const ring = after.prepare('SELECT support, lineage, end_ms, duration_s, steps FROM ring_step_intervals ORDER BY start_ms').all() as Array<{ support: string; lineage: string; end_ms: null; duration_s: null; steps: number }>;
    expect(ring.length).toBe(expected.activity_buckets!.length);
    expect(new Set(ring.map((r) => JSON.stringify([r.support, r.lineage, r.end_ms, r.duration_s])))).toEqual(new Set([JSON.stringify(['legacyUnknown', 'ring', null, null])]));
    expect(ring.reduce((n, r) => n + r.steps, 0)).toBe((expected.activity_buckets as Array<{ steps: number }>).reduce((n, r) => n + r.steps, 0));
    // the live file itself is untouched
    const liveAgain = raw(live);
    expect([liveAgain.pragma('user_version', { simple: true }), eventsHash(liveAgain)]).toEqual([0, hash]);

    // opening again applies nothing and changes nothing
    after.close();
    const again = raw(copy);
    expect(migrateLumen(again)).toEqual({ from: LUMEN_SCHEMA_VERSION, to: LUMEN_SCHEMA_VERSION, applied: [] });
    expect(eventsHash(again)).toBe(hash);
  });

  it('every step is idempotent: re-running steps 2 and 3 over a migrated file changes nothing', () => {
    tmp();
    const file = join(dir, 'lumen.db');
    const s = open(file);
    s.ingest('6f1d2c3b4a594e8f9d0123456789abcd', [ringSteps('2026-10-20T01:00:00Z', 80), activityBucket('2026-10-20T01:00:00Z', 500)]);
    s.close();
    const db = raw(file);
    const snapshot = () => JSON.stringify([db.prepare('SELECT * FROM event_spans ORDER BY id').all(), db.prepare('SELECT * FROM ring_step_intervals ORDER BY id').all()]);
    const first = snapshot();
    db.pragma('user_version = 1');
    expect(migrateLumen(db).applied).toEqual(MIGRATIONS.slice(1).map((m) => m.name));
    expect(snapshot()).toBe(first);
    // every step body run again by hand, outside the version check
    for (const m of MIGRATIONS) db.transaction(() => m.up(db))();
    expect(snapshot()).toBe(first);
    expect(migrateLumen(db).applied).toEqual([]);
  });

  it('a failing step rolls back and leaves the version where it was', () => {
    tmp();
    const db = raw(join(dir, 'lumen.db'));
    migrateLumen(db);
    const broken = [...MIGRATIONS, { version: LUMEN_SCHEMA_VERSION + 1, name: 'broken', up: (d: Database.Database) => { d.exec('CREATE TABLE half (x)'); throw new Error('boom'); } }];
    expect(() => migrateLumen(db, broken)).toThrow('boom');
    expect(db.pragma('user_version', { simple: true })).toBe(LUMEN_SCHEMA_VERSION);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'half'").get()).toBeUndefined();
  });

  it('refuses a file from a newer server instead of writing it', () => {
    tmp();
    const file = join(dir, 'lumen.db');
    const db = raw(file);
    db.pragma(`user_version = ${LUMEN_SCHEMA_VERSION + 1}`);
    db.close();
    expect(() => openLumenStore(file)).toThrow(/newer than this server/);
  });

  it('gives a span to events an older server appended to a migrated file', () => {
    tmp();
    const file = join(dir, 'lumen.db');
    open(file).close();
    // an older binary writes straight into events (it knows nothing of event_spans)
    const install = '6f1d2c3b4a594e8f9d0123456789abcd';
    writeLegacyDb(file, [{ installationId: install, events: [ringSteps('2026-10-20T01:00:00Z', 42)], nowMs: Date.parse('2026-10-20T02:00:00Z') }]);
    const s = open(file);
    expect(s.all('SELECT steps, support, duration_s FROM ring_step_intervals')).toEqual([{ steps: 42, support: 'minute', duration_s: 60 }]);
  });

  it('spanOf: the support of each span category', () => {
    const at = Date.parse('2026-10-20T01:00:00Z');
    expect(spanOf('activity/buckets', 'activity_bucket', { steps: 5 }, at)).toEqual({ lineage: 'ring', support: 'legacyUnknown', startMs: at, endMs: at, revMs: null });
    expect(spanOf('activity/buckets', 'ring_steps', { start: '2026-10-20T01:00:00Z', duration_s: 600, support: 'tenMinuteFallback' }, 0)).toMatchObject({ startMs: at, endMs: at + 600_000, support: 'tenMinuteFallback' });
    expect(spanOf('sleep/timeline', 'sleep_timeline', { stages: ['light', 'deep'], sample_interval_minutes: 1, native_epoch_s: 300 }, at)).toMatchObject({ startMs: at, endMs: at + 120_000 });
    expect(spanOf('sleep/timeline', 'sleep_timeline', { stages: ['light', 'deep'], sample_interval_minutes: 1 }, at)).toMatchObject({ endMs: at + 120_000 });
    expect(spanOf('hc/record', 'Steps:x', { origin_package: 'com.google.android.apps.fitness', origin_is_device_native: false, device: { type: 2 }, start: '2026-10-20T01:00:00Z', end: '2026-10-20T01:10:00Z', last_modified: '2026-10-20T01:11:00Z' }, 0))
      .toEqual({ lineage: 'phone', support: null, startMs: at, endMs: at + 600_000, revMs: at + 660_000 });
    expect(spanOf('hc/record', 'Steps:x', { origin_package: 'com.google.android.apps.fitness', origin_is_device_native: false, device: { type: 1 }, start: '2026-10-20T01:00:00Z', end: '2026-10-20T01:10:00Z' }, 0)?.lineage)
      .toBe('hc-other:com.google.android.apps.fitness');
    expect(spanOf('metrics/hr', 'hr', {}, at)).toBeNull();
    expect(spanOf('activity/session', 's', { start: 'nope', end: '2026-10-20T01:00:00Z' }, at)).toBeNull();
  });
});
