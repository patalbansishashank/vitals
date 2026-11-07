// @vitest-environment node
/** The Lumen store and the time helpers of the `gauge_*` tools (docs/SERVER.md "Gauge"). */
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkEvent, LumenReadError, openLumenStore, type IntervalRow, type LumenStore, type SpanCategory } from './lumenStore.ts';
import { dayBounds, isoIn, localDate, lumenToolSet, parseWhen } from './lumenTools.ts';
import {
  activityBucket, bloodPressure, deletion, gpsChunk, hcDeleted, hcRecord, hr, INSTALL, lumenEvent, metric, OTHER_INSTALL, phoneAcquisition, phoneSteps, ringSteps, shortVideo, sleepPacket,
  sportTelemetry, workout,
} from './lumenFixtures.ts';

const TMP = process.env.TMPDIR ?? '/tmp';
let dir: string;
let store: LumenStore;
const open = () => {
  dir = mkdtempSync(join(TMP, 'lumen-store-'));
  store = openLumenStore(join(dir, 'lumen.db'));
  return store;
};
afterEach(() => {
  store?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const T = (iso: string) => Date.parse(iso);

describe('lumen.db', () => {
  it('stores each id once, keeps every version raw and shows the newest per (category, subject, observed_at)', () => {
    const s = open();
    expect((statSync(join(dir, 'lumen.db')).mode & 0o777).toString(8)).toBe('600');
    const a = hr('2026-10-20T01:00:00Z', 60);
    expect(s.ingest(INSTALL, [a, a, hr('2026-10-20T01:05:00Z', 62)])).toEqual({ accepted: 2, duplicates: 1, rejected: [] });
    // the same reading with a corrected value: a new id, received later
    const fixed = hr('2026-10-20T01:00:00Z', 64, { receivedAt: '2026-10-20T02:00:00Z' });
    expect(fixed.id).not.toBe(a.id);
    expect(s.ingest(INSTALL, [fixed]).accepted).toBe(1);
    expect(s.get<{ n: number }>('SELECT COUNT(*) AS n FROM events')!.n).toBe(3);
    const series = s.all<{ value: number }>("SELECT value FROM metric_series WHERE kind = 'hr' ORDER BY observed_ms");
    expect(series.map((r) => r.value)).toEqual([64, 62]);
  });

  it('orders versions by data.received_at, then ingest order, never by time (which equals observed_at)', () => {
    const s = open();
    const at = '2026-10-20T01:00:00Z';
    // the later-received version arrives first; the earlier one, uploaded afterwards, does not win
    s.ingest(INSTALL, [hr(at, 70, { receivedAt: '2026-10-20T03:00:00Z' })]);
    s.ingest(INSTALL, [hr(at, 65, { receivedAt: '2026-10-20T02:00:00Z' })]);
    const now = () => s.all<{ value: number }>("SELECT value FROM metric_series WHERE kind = 'hr'").map((r) => r.value);
    expect(now()).toEqual([70]);
    // same received_at: the one ingested last wins
    s.ingest(INSTALL, [hr(at, 72, { receivedAt: '2026-10-20T03:00:00Z' })]);
    expect(now()).toEqual([72]);
    expect(s.get<{ n: number }>('SELECT COUNT(*) AS n FROM events')!.n).toBe(3);
  });

  it('takes Lumen\'s 32-hex installation id and a dashed UUID', () => {
    const s = open();
    expect(INSTALL).toMatch(/^[0-9a-f]{32}$/);
    expect(s.ingest(INSTALL, [hr('2026-10-20T01:00:00Z', 60)]).accepted).toBe(1);
    expect(s.ingest(OTHER_INSTALL, [hr('2026-10-20T01:00:00Z', 61, { install: OTHER_INSTALL })]).accepted).toBe(1);
  });

  it('rejects malformed events one by one with a reason', () => {
    const s = open();
    const good = hr('2026-10-20T01:00:00Z', 60);
    const out = s.ingest(INSTALL, [
      good,
      { ...good, id: 'pl-a', specversion: '0.3' },
      { ...good, id: 'pl-b', source: `urn:pulseloop:installation:${OTHER_INSTALL}` },
      { ...good, id: 'pl-c', category: 'Metrics/HR!' },
      { ...good, id: 'pl-d', data: { ...good.data, observed_at: 'yesterday' } },
      { ...good, id: 'pl-e', data: { ...good.data, schema_version: 2 } },
      { ...good, id: 'pl-f', time: '2026-10-20 01:00' },
      'not an event',
      deletion('2026-10-21T00:00:00Z', { category: 'metrics/hr' }),
      { ...deletion('2026-10-21T00:00:00Z', { category: 'metrics/hr', from: '2026-10-20T02:00:00Z', to: '2026-10-20T01:00:00Z' }), id: 'pl-g' },
      { ...good, id: 'pl-h', type: 'com.pulseloop.deletion.v1' },
    ]);
    expect(out.accepted).toBe(1);
    expect(out.rejected.map((r) => [r.id, r.reason])).toEqual([
      ['pl-a', 'bad_specversion'], ['pl-b', 'source_mismatch'], ['pl-c', 'bad_category'], ['pl-d', 'bad_data_times'], ['pl-e', 'bad_data'], ['pl-f', 'bad_time'],
      [null, 'not_an_object'], [expect.stringMatching(/^pl-/), 'bad_target_range'], ['pl-g', 'bad_target_range'], ['pl-h', 'deletion_category'],
    ]);
    expect(out.rejected[6]!.index).toBe(7);
  });

  it('a deletion hides what its installation had received in the range, by category or kind, and nothing else', () => {
    const s = open();
    s.ingest(INSTALL, [hr('2026-10-20T01:00:00Z', 60), hr('2026-10-20T01:05:00Z', 61), hr('2026-10-20T01:10:00Z', 62)]);
    s.ingest(OTHER_INSTALL, [hr('2026-10-20T01:05:00Z', 90, { install: OTHER_INSTALL })]);
    // Lumen's spot tombstone: ±90 s around one reading, kind given under the metrics category
    const del = deletion('2026-10-21T00:00:00Z', { category: 'metrics', kind: 'hr', from: '2026-10-20T01:03:30Z', to: '2026-10-20T01:06:30Z' });
    expect(s.ingest(INSTALL, [del]).accepted).toBe(1);
    expect(s.all<{ value: number }>("SELECT value FROM metric_series WHERE kind = 'hr' ORDER BY observed_ms, value").map((r) => r.value)).toEqual([60, 90, 62]);
    // the raw table keeps everything, the deletion included
    expect(s.get<{ n: number }>('SELECT COUNT(*) AS n FROM events')!.n).toBe(5);
    expect(s.status().deletions).toBe(1);
    expect(s.status().counts).toEqual({ 'metrics/hr': 3 });
  });

  it('a blood-pressure deletion names metrics/blood_pressure, bp_sys and bp_dia; kind narrows a deletion only when given', () => {
    const s = open();
    const at = '2026-10-20T04:00:00Z';
    s.ingest(INSTALL, [bloodPressure(at, 118, 76), metric('bp_sys', 'mmHg', at, 118), metric('bp_dia', 'mmHg', at, 76), metric('spo2', '%', at, 97)]);
    const range = { from: '2026-10-20T03:58:30Z', to: '2026-10-20T04:01:30Z' };
    // a kind that does not match hides nothing
    s.ingest(INSTALL, [deletion('2026-10-21T00:00:00Z', { category: 'metrics/bp_sys', kind: 'bp_dia', ...range })]);
    expect(s.status().counts).toMatchObject({ 'metrics/bp_sys': 1 });
    s.ingest(INSTALL, [
      deletion('2026-10-21T00:01:00Z', { category: 'metrics/blood_pressure', ...range }),
      deletion('2026-10-21T00:01:00Z', { category: 'metrics/bp_sys', kind: 'bp_sys', ...range }),
      deletion('2026-10-21T00:01:00Z', { category: 'metrics/bp_dia', ...range }),
    ]);
    expect(s.status().counts).toEqual({ 'metrics/spo2': 1 });
  });

  it('a deletion hides only what Lumen received before it: a late upload of an older reading stays hidden', () => {
    const s = open();
    s.ingest(INSTALL, [deletion('2026-10-21T00:00:00Z', { category: '*' })]);
    // queued in Lumen's outbox before the reset, uploaded after it
    s.ingest(INSTALL, [hr('2026-10-20T01:00:00Z', 60, { receivedAt: '2026-10-20T23:59:00Z' })]);
    // recorded after the reset
    s.ingest(INSTALL, [hr('2026-10-21T01:00:00Z', 61, { receivedAt: '2026-10-21T01:00:00Z' })]);
    expect(s.all<{ value: number }>("SELECT value FROM metric_series WHERE kind = 'hr'").map((r) => r.value)).toEqual([61]);
  });

  it('"Reset App Data" (category *) hides everything received before it; later uploads show again', () => {
    const s = open();
    s.ingest(INSTALL, [hr('2026-10-20T01:00:00Z', 60), sleepPacket('2026-10-19T17:00:00Z', ['light', 'deep'])]);
    s.ingest(INSTALL, [deletion('2026-10-21T00:00:00Z', { category: '*' })]);
    expect(s.status().counts).toEqual({});
    // the ring hands the same night back after the reset: received later, so it shows
    s.ingest(INSTALL, [hr('2026-10-20T01:00:00Z', 60, { receivedAt: '2026-10-21T00:10:00Z' })]);
    expect(s.status().counts).toEqual({ 'metrics/hr': 1 });
  });

  it('reads through the materialised current rows\' category, subject and time indexes, never scanning (the views keep their filters)', () => {
    const s = open();
    const plan = (sql: string) => s.all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`).map((r) => r.detail).join('\n');
    expect(plan("SELECT * FROM metric_series WHERE kind = 'hr' AND observed_ms >= 1 AND observed_ms <= 2")).toMatch(/SEARCH st USING INDEX event_state_current_subject \(subject=\? AND observed_ms>\? AND observed_ms<\?\)/);
    expect(plan('SELECT * FROM sleep_timeline WHERE observed_ms >= 1 AND observed_ms < 2')).toMatch(/SEARCH st USING INDEX event_state_current_category \(category=\? AND observed_ms>\? AND observed_ms<\?\)/);
    expect(plan('SELECT kind, COUNT(*) FROM metric_series WHERE observed_ms >= 1 AND observed_ms < 2 GROUP BY kind')).toMatch(/SEARCH st USING (COVERING )?INDEX event_state_current_(observed|category)/);
    expect(plan("SELECT id FROM visible_events WHERE category = 'metrics/hr' AND observed_ms >= 1 AND observed_ms < 2")).toMatch(/SEARCH st USING (COVERING )?INDEX event_state_category \(category=\? AND observed_ms>\? AND observed_ms<\?\)/);
    for (const v of ['metric_series', 'sleep_timeline', 'daily_activity', 'insights', 'current_events']) expect(plan(`SELECT * FROM ${v} WHERE observed_ms >= 1 AND observed_ms < 2`)).not.toMatch(/SCAN (e|st)\b/);
  });

  it('checkEvent takes Lumen\'s own envelope with nanosecond instants and offsets', () => {
    const e = lumenEvent('metrics/temp', 'temp', 'health.metric.observed', '2026-10-20T01:00:00.123456789Z', { metric: 'temp', value: 36.4, unit: '°C' });
    const c = checkEvent(e, INSTALL);
    expect(c.ok && c.row.observed_ms).toBe(T('2026-10-20T01:00:00.123Z'));
    expect(checkEvent({ ...e, time: '2026-10-20T06:30:00+05:30' }, INSTALL).ok).toBe(true);
  });
});

describe('short-video days (habits/short_video)', () => {
  const days = (s: LumenStore) => s.all<{ date: string; counts: string; daily_limit: number; limit_hits: number; cancels: number }>('SELECT date, counts, daily_limit, limit_hits, cancels FROM short_video_days ORDER BY date')
    .map((r) => [r.date, JSON.parse(r.counts), r.daily_limit, r.limit_hits, r.cancels]);

  it('keeps every upload raw and one row per date: the newest by received_at, then ingest order, whatever its observed_at', () => {
    const s = open();
    const morning = shortVideo('2026-10-20', '2026-10-20T04:00:00Z', { instagram: 3, youtube: 1 }, {}, { receivedAt: '2026-10-20T04:00:05Z' });
    const evening = shortVideo('2026-10-20', '2026-10-20T15:00:00Z', { instagram: 14, youtube: 9 }, { limitHits: 1, cancels: 2 }, { receivedAt: '2026-10-20T15:00:05Z' });
    expect(s.ingest(INSTALL, [evening, morning, morning, shortVideo('2026-10-21', '2026-10-21T03:00:00Z', { instagram: 2, youtube: 0 })])).toEqual({ accepted: 3, duplicates: 1, rejected: [] });
    expect(days(s)).toEqual([['2026-10-20', { instagram: 14, youtube: 9 }, 20, 1, 2], ['2026-10-21', { instagram: 2, youtube: 0 }, 20, 0, 0]]);
    // same received_at: the one ingested last wins
    s.ingest(INSTALL, [shortVideo('2026-10-20', '2026-10-20T15:00:00Z', { instagram: 15, youtube: 9 }, { limitHits: 1, cancels: 2 }, { receivedAt: '2026-10-20T15:00:05Z' })]);
    expect(days(s)[0]![1]).toEqual({ instagram: 15, youtube: 9 });
    expect(s.status().counts).toEqual({ 'habits/short_video': 4 });
  });

  it('rejects a short-video event whose subject is not a real date, whose date disagrees or whose counts are not counts', () => {
    const s = open();
    const good = shortVideo('2026-10-20', '2026-10-20T04:00:00Z', { instagram: 3, youtube: 1 });
    const out = s.ingest(INSTALL, [
      good,
      { ...good, id: 'pl-sv-a', subject: '2026-02-30', data: { ...good.data, date: '2026-02-30' } },
      { ...good, id: 'pl-sv-b', data: { ...good.data, date: '2026-10-21' } },
      { ...good, id: 'pl-sv-c', data: { ...good.data, counts: { instagram: -1 } } },
      { ...good, id: 'pl-sv-d', data: { ...good.data, counts: [3, 1] } },
      { ...good, id: 'pl-sv-e', data: { ...good.data, limit_hits: 1.5 } },
      { ...good, id: 'pl-sv-f', subject: 'short_video' },
    ]);
    expect(out.accepted).toBe(1);
    expect(out.rejected.map((r) => [r.id, r.reason])).toEqual(['a', 'b', 'c', 'd', 'e', 'f'].map((x) => [`pl-sv-${x}`, 'bad_short_video']));
  });

  it('a deletion of habits/short_video, of the habits group or of everything hides the days it covers', () => {
    const s = open();
    s.ingest(INSTALL, [
      shortVideo('2026-10-19', '2026-10-19T15:00:00Z', { instagram: 5, youtube: 5 }),
      shortVideo('2026-10-20', '2026-10-20T15:00:00Z', { instagram: 6, youtube: 2 }),
      shortVideo('2026-10-21', '2026-10-21T03:00:00Z', { instagram: 1, youtube: 1 }),
    ]);
    s.ingest(INSTALL, [deletion('2026-10-22T00:00:00Z', { category: 'habits/short_video', from: '2026-10-19T00:00:00Z', to: '2026-10-19T23:59:59Z' })]);
    expect(days(s).map((d) => d[0])).toEqual(['2026-10-20', '2026-10-21']);
    s.ingest(INSTALL, [deletion('2026-10-22T00:01:00Z', { category: 'habits', from: '2026-10-20T00:00:00Z', to: '2026-10-20T23:59:59Z' })]);
    expect(days(s).map((d) => d[0])).toEqual(['2026-10-21']);
    s.ingest(INSTALL, [deletion('2026-10-22T00:02:00Z', { category: '*' })]);
    expect(days(s)).toEqual([]);
    // a newer count for a hidden day, received after the reset, shows again
    s.ingest(INSTALL, [shortVideo('2026-10-21', '2026-10-21T05:00:00Z', { instagram: 2, youtube: 1 }, {}, { receivedAt: '2026-10-22T00:10:00Z' })]);
    expect(days(s)).toEqual([['2026-10-21', { instagram: 2, youtube: 1 }, 20, 0, 0]]);
  });

  it('gauge_short_video answers per-day counts, total, limit, hits and cancels, with 7- and 30-day averages ending at `to`', async () => {
    const s = open();
    const tools = lumenToolSet(() => s, 'Asia/Kolkata', () => T('2026-10-21T04:00:00Z'));
    const none = await tools.call('gauge_short_video', { from: '2026-10-20', to: '2026-10-21' });
    expect(none.data).toMatchObject({ days: [], averages: { last7Days: { from: '2026-10-15', to: '2026-10-21', daysWithData: 0, total: null } } });
    // 30 days before the range count toward the averages only
    s.ingest(INSTALL, [
      shortVideo('2026-09-21', '2026-09-21T15:00:00Z', { instagram: 30, youtube: 0 }),
      shortVideo('2026-10-01', '2026-10-01T15:00:00Z', { instagram: 10, youtube: 10 }),
      shortVideo('2026-10-19', '2026-10-19T15:00:00Z', { instagram: 8, youtube: 4 }, { limitHits: 1 }),
      shortVideo('2026-10-20', '2026-10-20T04:00:00Z', { instagram: 2, youtube: 0 }, {}, { receivedAt: '2026-10-20T04:00:00Z' }),
      shortVideo('2026-10-20', '2026-10-20T16:00:00Z', { instagram: 12, youtube: 9 }, { limit: 15, limitHits: 2, cancels: 3 }, { receivedAt: '2026-10-20T16:00:00Z' }),
    ]);
    const r = await tools.call('gauge_short_video', { from: '2026-10-20', to: '2026-10-21' });
    expect(r.ok).toBe(true);
    const data = r.data as Record<string, unknown> & { freshness: Record<string, unknown> };
    expect(data.days).toEqual([{ date: '2026-10-20', counts: { instagram: 12, youtube: 9 }, total: 21, limit: 15, limitHits: 2, cancels: 3 }]);
    expect(data.averages).toEqual({
      last7Days: { from: '2026-10-15', to: '2026-10-21', daysWithData: 2, total: 16.5, counts: { instagram: 10, youtube: 6.5 }, limitHits: 1.5, cancels: 1.5 },
      last30Days: { from: '2026-09-22', to: '2026-10-21', daysWithData: 3, total: 17.7, counts: { instagram: 10, youtube: 7.7 }, limitHits: 1, cancels: 1 },
    });
    expect(data.units).toMatchObject({ counts: 'videos per day' });
    expect(data.freshness).toMatchObject({ lastReadingAt: '2026-10-20T21:30:00+05:30' });
    expect(r.summary).toMatch(/1 day from 2026-10-20 to 2026-10-21/);
    expect((await tools.call('gauge_short_video', { from: '2026-10-22', to: '2026-10-21' })).error?.code).toBe('invalid_input');
    const avail = await tools.call('gauge_data_availability', {});
    expect((avail.data as { categories: unknown[] }).categories).toEqual([{ category: 'habits/short_video', count: 5, firstReadingAt: '2026-09-21T20:30:00+05:30', lastReadingAt: '2026-10-20T21:30:00+05:30', readWith: 'gauge_short_video' }]);
    expect((avail.data as { shortVideoDays: number }).shortVideoDays).toBe(4);
  });
});

describe('time in the person\'s zone', () => {
  it('formats, bounds and parses days in the zone, across a DST change', () => {
    expect(isoIn(T('2026-10-20T01:00:00Z'), 'Asia/Kolkata')).toBe('2026-10-20T06:30:00+05:30');
    expect(isoIn(T('2026-07-01T12:00:00Z'), 'America/New_York')).toBe('2026-07-01T08:00:00-04:00');
    expect(isoIn(T('2026-12-01T12:00:00Z'), 'America/New_York')).toBe('2026-12-01T07:00:00-05:00');
    expect(isoIn(T('2026-12-01T12:00:00Z'), 'UTC')).toBe('2026-12-01T12:00:00+00:00');
    expect(localDate(T('2026-10-19T19:00:00Z'), 'Asia/Kolkata')).toBe('2026-10-20');
    const [a, b] = dayBounds('2026-10-20', 'Asia/Kolkata')!;
    expect([new Date(a).toISOString(), new Date(b).toISOString()]).toEqual(['2026-10-19T18:30:00.000Z', '2026-10-20T18:30:00.000Z']);
    // 1 November 2026: New York falls back, the day has 25 hours
    const [c, d] = dayBounds('2026-11-01', 'America/New_York')!;
    expect((d - c) / 3_600_000).toBe(25);
    expect(dayBounds('2026-02-30', 'UTC')).toBeNull();
    expect(parseWhen('2026-10-20', 'Asia/Kolkata', 'end')).toBe(b - 1);
    expect(parseWhen('2026-10-20T06:30', 'Asia/Kolkata', 'start')).toBe(T('2026-10-20T01:00:00Z'));
    expect(parseWhen('2026-10-20T01:00:00Z', 'Asia/Kolkata', 'start')).toBe(T('2026-10-20T01:00:00Z'));
    expect(parseWhen('last tuesday', 'UTC', 'start')).toBeNull();
  });
});

describe('derived sleep', () => {
  it('groups packets by the day of waking, lets a later packet replace its minutes and splits a nap after a gap', async () => {
    const s = open();
    // IST: night 2026-10-19 23:30 → 2026-10-20 ~06:30, then a nap at 14:00 the same day
    const night = Array.from({ length: 420 }, (_, i) => (i < 60 ? 'light' : i < 120 ? 'deep' : i < 400 ? 'light' : 'awake'));
    s.ingest(INSTALL, [sleepPacket('2026-10-19T18:00:00Z', night), sleepPacket('2026-10-20T08:30:00Z', Array(30).fill('light'))]);
    // the ring re-classifies 30 minutes as REM: a later packet over the same minutes
    s.ingest(INSTALL, [sleepPacket('2026-10-19T21:00:00Z', Array(30).fill('rem'), { receivedAt: '2026-10-20T09:00:00Z' })]);
    const tools = lumenToolSet(() => s, 'Asia/Kolkata', () => T('2026-10-20T10:00:00Z'));
    const r = await tools.call('gauge_sleep', { from: '2026-10-20', to: '2026-10-20' });
    expect(r.ok).toBe(true);
    const data = r.data as { sessions: Array<{ wakingDate: string; start: string; end: string; inBedMinutes: number; asleepMinutes: number; minutes: Record<string, number>; blocks: unknown[] }> };
    expect(data.sessions.map((x) => [x.wakingDate, x.start, x.end, x.inBedMinutes])).toEqual([
      ['2026-10-20', '2026-10-19T23:30:00+05:30', '2026-10-20T06:30:00+05:30', 420],
      ['2026-10-20', '2026-10-20T14:00:00+05:30', '2026-10-20T14:30:00+05:30', 30],
    ]);
    expect(data.sessions[0]!.minutes).toEqual({ deep: 60, light: 310, rem: 30, awake: 20, unknown: 0 });
    expect(data.sessions[0]!.asleepMinutes).toBe(400);
  });
});

// --- energy SPEC §S1: source-aware identity, §2.1 evidence, read helpers for S2

const iso = (ms: number) => new Date(ms).toISOString();
const minute = (startIso: string, i: number) => iso(T(startIso) + i * 60_000);
/** Every page of a read helper, checking each page's size and that pages never repeat a row. */
function allPages<R extends { id: string }>(read: (cursor: string | null) => { rows: R[]; next: string | null }, limit: number): R[] {
  const out: R[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 1000; i++) {
    const p = read(cursor);
    expect(p.rows.length).toBeLessThanOrEqual(limit);
    if (p.next) expect(p.rows.length).toBe(limit);
    out.push(...p.rows);
    if (!p.next) break;
    cursor = p.next;
  }
  expect(new Set(out.map((r) => r.id)).size).toBe(out.length);
  return out;
}
const spans = (rows: IntervalRow[]) => rows.map((r) => [r.subject, iso(r.startMs), r.endMs === null ? null : iso(r.endMs), r.support, r.lineage]);

describe('source-aware current view (§S1.2)', () => {
  it('co-temporal ring, legacy ring and phone rows survive; two installations\' readings of one ring are one, the rest stay apart', () => {
    const s = open();
    const at = '2026-10-20T01:00:00Z';
    s.ingest(INSTALL, [ringSteps(at, 90), activityBucket(at, 500), phoneSteps(at, '2026-10-20T01:01:00Z', 104), hr(at, 70)]);
    s.ingest(OTHER_INSTALL, [hr(at, 71, { install: OTHER_INSTALL }), ringSteps(at, 88, {}, { install: OTHER_INSTALL })]);
    // (r070) readings without a device_key belong to their installation: both survive
    expect(s.all<{ installation_id: string; value: number }>("SELECT installation_id, value FROM metric_series WHERE kind = 'hr' ORDER BY value").map((r) => r.value)).toEqual([70, 71]);
    const ring = s.readIntervals('activity/buckets', T(at), T(at) + 60_000).rows;
    // one ring (the same device_key) is one source: the other installation's reading of the same minute, received after (same
    // received_at, ingested later), is the current one; the legacy row has no ring and stays
    expect(ring.map((r) => [r.installationId === INSTALL, r.subject, r.support, r.data.steps]).sort()).toEqual([
      [false, 'ring_steps', 'minute', 88], [true, 'activity_bucket', 'legacyUnknown', 500],
    ]);
    expect(ring.every((r) => r.lineage === 'ring')).toBe(true);
    expect(s.readIntervals('activity/phone_steps', T(at), T(at) + 60_000).rows.map((r) => [r.lineage, r.support, r.data.steps])).toEqual([['phone', 'minute', 104]]);
    // the pre-§S1 bucket view keeps the legacy rows only, so a native minute is never summed into it
    expect(s.all('SELECT steps FROM activity_buckets')).toEqual([{ steps: 500 }]);
    expect(s.all('SELECT subject, duration_s, end_ms, device_key FROM ring_step_intervals WHERE installation_id = ? ORDER BY subject', INSTALL)).toEqual([
      { subject: 'activity_bucket', duration_s: null, end_ms: null, device_key: null },
    ]);
  });

  it('a newer version replaces an older one of the same ring, whichever installation sent it, and current_spans keeps current_events\' rule', () => {
    const s = open();
    const at = '2026-10-20T01:00:00Z';
    s.ingest(INSTALL, [ringSteps(at, 10, {}, { receivedAt: '2026-10-20T02:00:00Z' }), ringSteps(minute(at, 1), 5)]);
    s.ingest(OTHER_INSTALL, [ringSteps(at, 20, {}, { install: OTHER_INSTALL, receivedAt: '2026-10-20T03:00:00Z' })]);
    // a revision received later wins; one received earlier but uploaded later does not
    s.ingest(INSTALL, [ringSteps(at, 12, {}, { receivedAt: '2026-10-20T04:00:00Z' }), ringSteps(minute(at, 1), 3, {}, { receivedAt: '2026-10-19T00:00:00Z' })]);
    s.ingest(INSTALL, [deletion('2026-10-21T00:00:00Z', { category: 'activity/buckets', from: minute(at, 1), to: minute(at, 1) })]);
    // (r070) the other installation's 20 (received 03:00) replaced this one's 10 (02:00); this one's 12 (04:00) replaced it in turn
    let view = s.all<{ installation_id: string; steps: number }>('SELECT installation_id, steps FROM ring_step_intervals ORDER BY steps');
    expect(view.map((r) => [r.installation_id, r.steps])).toEqual([[INSTALL, 12]]);
    // and one received earlier than the current one never replaces it, from either installation
    s.ingest(OTHER_INSTALL, [ringSteps(at, 33, {}, { install: OTHER_INSTALL, receivedAt: '2026-10-20T03:30:00Z' })]);
    view = s.all<{ installation_id: string; steps: number }>('SELECT installation_id, steps FROM ring_step_intervals ORDER BY steps');
    expect(view.map((r) => r.steps)).toEqual([12]);
    // the other installation's newer one does, and when it is deleted this installation's shows again
    s.ingest(OTHER_INSTALL, [ringSteps(at, 44, {}, { install: OTHER_INSTALL, receivedAt: '2026-10-20T05:00:00Z' })]);
    expect(s.all<{ steps: number }>('SELECT steps FROM ring_step_intervals').map((r) => r.steps)).toEqual([44]);
    s.ingest(OTHER_INSTALL, [deletion('2026-10-22T00:00:00Z', { category: 'activity/buckets', from: at, to: at }, { install: OTHER_INSTALL })]);
    expect(s.all<{ steps: number }>('SELECT steps FROM ring_step_intervals').map((r) => r.steps)).toEqual([12]);
    const ids = (sql: string) => s.all<{ id: string }>(sql).map((r) => r.id).sort();
    for (const c of ['activity/buckets', 'activity/phone_steps']) expect(ids(`SELECT id FROM current_spans WHERE category = '${c}'`)).toEqual(ids(`SELECT id FROM current_events WHERE category = '${c}'`));
  });

  it('overlap reads go through event_spans (category, start_ms)', () => {
    const s = open();
    const plan = (sql: string) => s.all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`).map((r) => r.detail).join('\n');
    expect(plan('SELECT * FROM ring_step_intervals WHERE start_ms >= 1 AND start_ms < 2')).toMatch(/SEARCH s USING INDEX event_spans_category_start \(category=\? AND start_ms>\? AND start_ms<\?\)/);
    expect(plan('SELECT * FROM hc_records WHERE start_ms >= 1 AND start_ms < 2')).toMatch(/SEARCH s USING INDEX event_spans_category_start \(category=\? AND start_ms>\? AND start_ms<\?\)/);
    expect(plan("SELECT * FROM current_spans WHERE category = 'activity/buckets' AND start_ms >= 1 AND start_ms < 2")).toMatch(/SEARCH s USING INDEX event_spans_category_start \(category=\? AND start_ms>\? AND start_ms<\?\)/);
  });
});

describe('Health Connect revisions and tombstones (§S1.3)', () => {
  const rec = (id: string, steps: number, lastModified: string, o: { receivedAt?: string; origin?: string; native?: boolean; device?: Record<string, unknown> | null } = {}) =>
    hcRecord('Steps', id, '2026-10-20T01:00:00Z', '2026-10-20T01:10:00Z', { count: steps }, { lastModified, origin: o.origin, native: o.native, device: o.device }, { receivedAt: o.receivedAt });
  const current = (s: LumenStore) => s.all<{ subject: string; steps: number }>("SELECT subject, json_extract(payload, '$.count') AS steps FROM hc_records ORDER BY subject");

  it('the latest revision is the latest last_modified, whatever the upload order; then received_at', () => {
    const s = open();
    s.ingest(INSTALL, [rec('a', 300, '2026-10-20T02:00:00Z', { receivedAt: '2026-10-20T02:01:00Z' })]);
    s.ingest(INSTALL, [rec('a', 200, '2026-10-20T01:30:00Z', { receivedAt: '2026-10-20T05:00:00Z' })]);
    expect(current(s)).toEqual([{ subject: 'Steps:a', steps: 300 }]);
    s.ingest(INSTALL, [rec('a', 310, '2026-10-20T02:00:00Z', { receivedAt: '2026-10-20T02:02:00Z' })]);
    expect(current(s)).toEqual([{ subject: 'Steps:a', steps: 310 }]);
    expect(s.readIntervals('hc/record', T('2026-10-20T00:00:00Z'), T('2026-10-21T00:00:00Z')).rows.map((r) => [r.subject, r.revMs, r.data.payload])).toEqual([
      ['Steps:a', T('2026-10-20T02:00:00Z'), { count: 310 }],
    ]);
  });

  it('a tombstone at or after the latest revision hides the record; a revision after it shows again; a Gauge deletion hides it too', () => {
    const s = open();
    s.ingest(INSTALL, [rec('a', 300, '2026-10-20T02:00:00Z'), rec('b', 50, '2026-10-20T02:00:00Z'), rec('c', 70, '2026-10-20T02:00:00Z')]);
    s.ingest(INSTALL, [hcDeleted('Steps', 'a', '2026-10-20T03:00:00Z'), hcDeleted('Steps', 'b', '2026-10-20T01:00:00Z')]);
    expect(current(s).map((r) => r.subject)).toEqual(['Steps:b', 'Steps:c']);
    s.ingest(INSTALL, [rec('a', 320, '2026-10-20T04:00:00Z')]);
    expect(current(s)).toEqual([{ subject: 'Steps:a', steps: 320 }, { subject: 'Steps:b', steps: 50 }, { subject: 'Steps:c', steps: 70 }]);
    // (r070) a record id is Health Connect's, not the installation's: another installation's tombstone retracts it too
    s.ingest(OTHER_INSTALL, [hcDeleted('Steps', 'c', '2026-10-20T05:00:00Z', { install: OTHER_INSTALL })]);
    expect(current(s).map((r) => r.subject)).toEqual(['Steps:a', 'Steps:b']);
    s.ingest(INSTALL, [deletion('2026-10-21T00:00:00Z', { category: 'hc', from: '2026-10-20T00:00:00Z', to: '2026-10-20T23:59:59Z' })]);
    expect(current(s)).toEqual([]);
  });

  it('lineage: the phone\'s own recorder and Fit-from-the-phone are phone; anything else is hc-other:<origin>', () => {
    const s = open();
    s.ingest(INSTALL, [
      rec('native', 1, '2026-10-20T02:00:00Z'),
      rec('fit-phone', 1, '2026-10-20T02:00:00Z', { origin: 'com.google.android.apps.fitness', native: false, device: { type: 2 } }),
      rec('fit-watch', 1, '2026-10-20T02:00:00Z', { origin: 'com.google.android.apps.fitness', native: false, device: { type: 1 } }),
      rec('samsung', 1, '2026-10-20T02:00:00Z', { origin: 'com.sec.android.app.shealth', native: false, device: null }),
    ]);
    expect(s.all('SELECT subject, lineage FROM hc_records ORDER BY subject')).toEqual([
      { subject: 'Steps:fit-phone', lineage: 'phone' }, { subject: 'Steps:fit-watch', lineage: 'hc-other:com.google.android.apps.fitness' },
      { subject: 'Steps:native', lineage: 'phone' }, { subject: 'Steps:samsung', lineage: 'hc-other:com.sec.android.app.shealth' },
    ]);
  });
});

describe('ingest validators (§S1.4)', () => {
  it('accepts every §2.1 evidence event', () => {
    const s = open();
    const out = s.ingest(INSTALL, [
      ringSteps('2026-10-20T01:00:00Z', 0), ringSteps('2026-10-20T01:10:00Z', 400, { durationS: 600 }), ringSteps('2026-10-20T01:30:00Z', 900, { durationS: 900 }),
      phoneSteps('2026-10-20T01:00:00Z', '2026-10-20T01:01:00Z', 98), phoneSteps('2026-10-20T01:01:00Z', '2026-10-20T03:00:00Z', 1200, { parentSteps: 1250 }),
      phoneAcquisition('2026-10-20T00:00:00Z', '2026-10-20T06:00:00Z', 'listening'),
      hcRecord('HeartRate', 'h1', '2026-10-20T01:00:00Z', '2026-10-20T01:05:00Z', { samples: [{ t: '2026-10-20T01:00:00Z', bpm: 80 }] }),
      hcRecord('ExerciseSession', 'x1', '2026-10-20T01:00:00Z', '2026-10-20T01:30:00Z', { exercise_type: 79, segments: [], laps: [], route_state: 'consentRequired' }),
      hcRecord('Weight', 'w1', '2026-10-20T01:00:00Z', '2026-10-20T01:00:00Z', { kg: 80.2 }),
      hcDeleted('Weight', 'w0', '2026-10-20T01:00:00Z'),
      gpsChunk('run-1', 0, [{ t: '2026-10-20T01:00:00Z', lat: 12.97, lon: 77.59 }, { t: '2026-10-20T01:00:05Z', lat: 12.9701, lon: 77.5901, accepted: false }]),
      sportTelemetry('2026-10-20T01:00:00Z', 1200, 55.5, 131),
      workout('w-1', '2026-10-20T01:15:00Z', { pauses: [{ start: '2026-10-20T00:40:00Z', end: '2026-10-20T00:42:00Z' }], moving_s: 2580 }),
    ]);
    expect(out).toEqual({ accepted: 13, duplicates: 0, rejected: [] });
  });

  it('rejects malformed evidence with its reason', () => {
    const s = open();
    const rb = ringSteps('2026-10-20T01:00:00Z', 10);
    const ps = phoneSteps('2026-10-20T01:00:00Z', '2026-10-20T01:01:00Z', 10);
    const hc = hcRecord('Steps', 's1', '2026-10-20T01:00:00Z', '2026-10-20T01:10:00Z', { count: 10 });
    const gps = gpsChunk('run-1', 0, [{ t: '2026-10-20T01:00:00Z', lat: 1, lon: 2 }]);
    const w = workout('w-1', '2026-10-20T01:15:00Z');
    const with_ = <E extends { data: Record<string, unknown> }>(e: E, id: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ ...e, ...extra, id, data: { ...e.data, ...data } });
    const out = s.ingest(INSTALL, [
      with_(rb, 'pl-b1', { duration_s: 120 }),
      with_(rb, 'pl-b2', { support: 'tenMinuteFallback' }),
      with_(rb, 'pl-b3', {}, { subject: 'other_steps' }),
      with_(activityBucket('2026-10-20T01:00:00Z', 5), 'pl-b4', { duration_s: 30 }),
      with_(rb, 'pl-b5', { start: 'soon' }),
      with_(ps, 'pl-p1', { end: '2026-10-20T01:01:30Z' }),
      with_(ps, 'pl-p2', { support: 'counterSpan', timing: 'detector' }),
      with_(ps, 'pl-p3', {}, { subject: 'phone_steps:another-boot:1' }),
      with_(ps, 'pl-p4', { end: '2026-10-20T01:00:00Z' }),
      with_(ps, 'pl-p5', { m_end_ns: '1' }),
      with_(ps, 'pl-p6', { support: 'counterSpan', timing: 'counter', end: '2026-10-28T01:00:00Z' }),
      with_(hc, 'pl-h1', { origin_package: 'com.pulseloop' }),
      with_(hc, 'pl-h2', { client_record_id: 'pl-steps-1' }),
      with_(hc, 'pl-h3', { record_type: 'Nutrition' }, { subject: 'Nutrition:s1' }),
      with_(hc, 'pl-h4', {}, { subject: 'Distance:s1' }),
      with_(hc, 'pl-h5', { payload: { count: -3 } }),
      with_(hc, 'pl-h6', { last_modified: null }),
      with_(hcDeleted('Steps', 's1', '2026-10-20T02:00:00Z'), 'pl-h7', { record_type: 'Nutrition' }),
      with_(gps, 'pl-g1', { points: Array.from({ length: 501 }, () => ({ t: '2026-10-20T01:00:00Z', lat: 1, lon: 2, acc: 5, accepted: true })) }),
      with_(gps, 'pl-g2', { points: [{ t: '2026-10-20T01:00:00Z', lat: 91, lon: 2, acc: 5, accepted: true }] }),
      with_(gps, 'pl-g3', {}, { subject: 'run-1' }),
      with_(w, 'pl-w1', { pauses: [{ start: '2026-10-20T03:00:00Z', end: '2026-10-20T03:01:00Z' }] }),
    ]);
    expect(out.accepted).toBe(0);
    expect(out.rejected.map((r) => [r.id, r.reason])).toEqual([
      ['pl-b1', 'bad_bucket'], ['pl-b2', 'bad_bucket'], ['pl-b3', 'bad_bucket'], ['pl-b4', 'bad_bucket'], ['pl-b5', 'bad_bucket'],
      ['pl-p1', 'bad_phone_steps'], ['pl-p2', 'bad_phone_steps'], ['pl-p3', 'bad_phone_steps'], ['pl-p4', 'bad_phone_steps'], ['pl-p5', 'bad_phone_steps'], ['pl-p6', 'bad_phone_steps'],
      ['pl-h1', 'own_origin'], ['pl-h2', 'own_origin'], ['pl-h3', 'bad_hc_record'], ['pl-h4', 'bad_hc_record'], ['pl-h5', 'bad_hc_record'], ['pl-h6', 'bad_hc_record'], ['pl-h7', 'bad_hc_record'],
      ['pl-g1', 'bad_gps'], ['pl-g2', 'bad_gps'], ['pl-g3', 'bad_gps'],
      ['pl-w1', 'bad_workout'],
    ]);
  });
});

describe('read helpers for S2 (§S1.5)', () => {
  // Asia/Kolkata: local midnight 2026-10-21 is 2026-10-20T18:30Z
  const MID = '2026-10-20T18:30:00Z';

  it('readIntervals: half-open overlap across local midnight; points and legacy rows count where they start', () => {
    const s = open();
    s.ingest(INSTALL, [
      ...Array.from({ length: 5 }, (_, i) => ringSteps(minute(MID, i - 2), 10 + i)), // 23:58 … 00:02
      phoneSteps(minute(MID, -10), minute(MID, 10), 600), // a counter span across midnight
      phoneSteps(minute(MID, -1), MID, 50), // ends exactly at midnight
      activityBucket(MID, 7), // a legacy bucket at midnight
      sportTelemetry(MID, 100, 5, 120),
      workout('w-night', MID, { start: minute(MID, -30), end: minute(MID, 15), durationS: 2700 }),
    ]);
    const [d1a, d1b] = dayBounds('2026-10-20', 'Asia/Kolkata')!;
    const [d2a, d2b] = dayBounds('2026-10-21', 'Asia/Kolkata')!;
    expect(d1b).toBe(T(MID));
    const read = (c: SpanCategory, a: number, b: number) => spans(s.readIntervals(c, a, b).rows);
    expect(read('activity/buckets', d1a, d1b)).toEqual([
      ['ring_steps', '2026-10-20T18:28:00.000Z', '2026-10-20T18:29:00.000Z', 'minute', 'ring'], ['ring_steps', '2026-10-20T18:29:00.000Z', '2026-10-20T18:30:00.000Z', 'minute', 'ring'],
    ]);
    // the legacy bucket and the first native minute tie on start: their order is by id
    const day2 = read('activity/buckets', d2a, d2b);
    expect(day2.slice(2)).toEqual([
      ['ring_steps', '2026-10-20T18:31:00.000Z', '2026-10-20T18:32:00.000Z', 'minute', 'ring'], ['ring_steps', '2026-10-20T18:32:00.000Z', '2026-10-20T18:33:00.000Z', 'minute', 'ring'],
    ]);
    expect(day2.slice(0, 2).sort()).toEqual([
      ['activity_bucket', '2026-10-20T18:30:00.000Z', null, 'legacyUnknown', 'ring'], ['ring_steps', '2026-10-20T18:30:00.000Z', '2026-10-20T18:31:00.000Z', 'minute', 'ring'],
    ]);
    const phone = (a: number, b: number) => s.readIntervals('activity/phone_steps', a, b).rows.map((r) => r.data.steps);
    expect(phone(d1a, d1b)).toEqual([600, 50]);
    expect(phone(d2a, d2b)).toEqual([600]);
    expect(s.readIntervals('activity/sport_telemetry', d1a, d1b).rows).toEqual([]);
    expect(s.readIntervals('activity/sport_telemetry', d2a, d2b).rows.map((r) => [r.startMs, r.endMs])).toEqual([[T(MID), T(MID)]]);
    expect(s.readIntervals('activity/session', d1a, d1b).rows.map((r) => r.subject)).toEqual(['w-night']);
    expect(s.readIntervals('activity/session', d2a, d2b).rows.map((r) => r.subject)).toEqual(['w-night']);
    expect(s.readIntervals('activity/session', T(minute(MID, 15)), d2b).rows).toEqual([]);
  });

  it('readIntervals pages in a stable (start, id) order, with ties, filters and typed errors', () => {
    const s = open();
    const at = '2026-10-20T01:00:00Z';
    s.ingest(INSTALL, Array.from({ length: 25 }, (_, i) => ringSteps(minute(at, i), i)));
    // (the other installation's rows are legacy buckets, no ring: they share minutes with this one's and tie on start)
    s.ingest(OTHER_INSTALL, Array.from({ length: 5 }, (_, i) => activityBucket(minute(at, i), 100 + i, { install: OTHER_INSTALL })));
    const from = T(at);
    const to = T(minute(at, 30));
    const whole = s.readIntervals('activity/buckets', from, to).rows;
    expect(whole).toHaveLength(30);
    const paged = allPages((cursor) => s.readIntervals('activity/buckets', from, to, { cursor, limit: 7 }), 7);
    expect(paged.map((r) => r.id)).toEqual(whole.map((r) => r.id));
    const sorted = [...whole].sort((a, b) => a.startMs - b.startMs || (a.id < b.id ? -1 : 1));
    expect(whole.map((r) => r.id)).toEqual(sorted.map((r) => r.id));
    expect(s.readIntervals('activity/buckets', from, to, { installationId: OTHER_INSTALL }).rows.map((r) => r.data.steps)).toEqual([100, 101, 102, 103, 104]);
    const exact = s.readIntervals('activity/buckets', from, to, { limit: 30 });
    expect([exact.rows.length, exact.next]).toEqual([30, null]);

    const err = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return e instanceof LumenReadError ? e.code : String(e);
      }
      return 'no error';
    };
    const next = s.readIntervals('activity/buckets', from, to, { limit: 1 }).next!;
    expect(err(() => s.readIntervals('activity/buckets', from, to, { cursor: 'garbage' }))).toBe('invalid_cursor');
    expect(err(() => s.readMetricSamples('hr', from, to, { cursor: next }))).toBe('invalid_cursor');
    expect(err(() => s.readIntervals('activity/buckets', from, to, { limit: 0 }))).toBe('invalid_limit');
    expect(err(() => s.readIntervals('activity/buckets', from, to, { limit: 10_001 }))).toBe('invalid_limit');
    expect(err(() => s.readIntervals('activity/buckets', to, from))).toBe('invalid_range');
    expect(err(() => s.readIntervals('metrics/hr' as SpanCategory, from, to))).toBe('unknown_category');
    expect(err(() => s.readIntervals('activity/buckets', from, to, { recordType: 'Steps' }))).toBe('invalid_kind');
  });

  it('readIntervals over Health Connect filters by record type', () => {
    const s = open();
    s.ingest(INSTALL, [
      hcRecord('Steps', 's1', '2026-10-20T01:00:00Z', '2026-10-20T01:10:00Z', { count: 10 }),
      hcRecord('HeartRate', 'h1', '2026-10-20T01:00:00Z', '2026-10-20T01:10:00Z', { samples: [{ t: '2026-10-20T01:00:00Z', bpm: 90 }] }),
    ]);
    const r = s.readIntervals('hc/record', T('2026-10-20T00:00:00Z'), T('2026-10-21T00:00:00Z'), { recordType: 'HeartRate' }).rows;
    expect(r.map((x) => [x.subject, x.lineage])).toEqual([['HeartRate:h1', 'phone']]);
  });

  it('readMetricSamples: current readings in [from, to) with id, quality and source, paged; deleted ones gone', () => {
    const s = open();
    const at = '2026-10-20T01:00:00Z';
    s.ingest(INSTALL, Array.from({ length: 12 }, (_, i) => hr(iso(T(at) + i * 300_000), 60 + i)));
    s.ingest(INSTALL, [lumenEvent('metrics/hr', 'hr', 'health.metric.observed', at, { metric: 'hr', value: 99, unit: 'bpm', quality: 'good', device_key: 'fedcba9876543210' }, { receivedAt: '2026-10-21T00:00:00Z' })]);
    s.ingest(INSTALL, [deletion('2026-10-22T00:00:00Z', { category: 'metrics', kind: 'hr', from: iso(T(at) + 300_000), to: iso(T(at) + 300_000) })]);
    const from = T(at);
    const to = T(at) + 11 * 300_000; // excludes the last reading
    const rows = allPages((cursor) => s.readMetricSamples('hr', from, to, { cursor, limit: 4 }), 4);
    expect(rows.map((r) => r.value)).toEqual([99, 62, 63, 64, 65, 66, 67, 68, 69, 70]);
    expect(rows[0]).toMatchObject({ kind: 'hr', tMs: from, quality: 'good', deviceKey: 'fedcba9876543210', source: 'ring:fedcba9876543210', installationId: INSTALL, unit: 'bpm' });
    expect(rows[1]).toMatchObject({ quality: 'unverified', provenance: 'device_history', source: `ring:installation:${INSTALL}` });
    expect(rows[0]!.id).toMatch(/^pl-/);
    expect(() => s.readMetricSamples('h r', from, to)).toThrow(LumenReadError);
  });

  it('views: GPS points, sport telemetry and phone acquisition', () => {
    const s = open();
    s.ingest(INSTALL, [
      gpsChunk('run-1', 0, [{ t: '2026-10-20T01:00:00Z', lat: 12.97, lon: 77.59 }, { t: '2026-10-20T01:00:05.250Z', lat: 12.9701, lon: 77.5901, accepted: false }]),
      gpsChunk('run-1', 1, [{ t: '2026-10-20T01:00:10Z', lat: 12.9702, lon: 77.5902 }]),
      sportTelemetry('2026-10-20T01:00:00Z', 1200, 55.5, 131),
      phoneAcquisition('2026-10-20T00:00:00Z', '2026-10-20T06:00:00Z', 'noPermission'),
    ]);
    expect(s.all('SELECT session_id, chunk, idx, t_ms, lat, accepted FROM gps_points ORDER BY t_ms')).toEqual([
      { session_id: 'run-1', chunk: 0, idx: 0, t_ms: T('2026-10-20T01:00:00Z'), lat: 12.97, accepted: 1 },
      { session_id: 'run-1', chunk: 0, idx: 1, t_ms: T('2026-10-20T01:00:05.250Z'), lat: 12.9701, accepted: 0 },
      { session_id: 'run-1', chunk: 1, idx: 0, t_ms: T('2026-10-20T01:00:10Z'), lat: 12.9702, accepted: 1 },
    ]);
    expect(s.readIntervals('activity/gps', T('2026-10-20T01:00:06Z'), T('2026-10-20T01:00:07Z')).rows).toEqual([]);
    expect(s.readIntervals('activity/gps', T('2026-10-20T01:00:04Z'), T('2026-10-20T01:00:05Z')).rows.map((r) => r.subject)).toEqual(['run-1:0']);
    expect(s.all('SELECT t_ms, steps_cum, kcal_cum_vendor, bpm, device_key FROM sport_telemetry')).toEqual([{ t_ms: T('2026-10-20T01:00:00Z'), steps_cum: 1200, kcal_cum_vendor: 55.5, bpm: 131, device_key: '0123456789abcdef' }]);
    expect(s.all('SELECT start_ms, end_ms, state, lineage FROM acquisition')).toEqual([{ start_ms: T('2026-10-20T00:00:00Z'), end_ms: T('2026-10-20T06:00:00Z'), state: 'noPermission', lineage: 'phone' }]);
  });
});
