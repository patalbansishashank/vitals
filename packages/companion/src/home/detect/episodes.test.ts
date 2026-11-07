// @vitest-environment node
/**
 * Detection episodes through the real store (r065 autodetect CONTRACT §§1–2): Gauge's uploads queue their ranges in the
 * ingest transaction, the background job detects and reconciles, the episodes keep their identity across late and
 * out-of-order uploads, open becomes final, missing evidence withdraws, and `gauge_detections` pages them by cursor.
 * Also the activity-recognition ingest (validation, current state, the still-open hour) and the Health Connect exercise
 * type normalisation on read.
 */
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOOT_ID, deletion, hcRecord, hr, INSTALL, lumenEvent, phoneSteps, ringSteps, workout } from '../lumenFixtures.ts';
import { LUMEN_SCHEMA_VERSION, openLumenStore, type LumenStore } from '../lumenStore.ts';
import { lumenToolSet } from '../lumenTools.ts';
import { createDetectionJob } from './job.ts';
import { reconcile, type StoredEpisode } from './episodes.ts';
import { detect2, type DetectedEpisode } from './detect.ts';
import { detectionInput } from './features.ts';

const TMP = process.env.TMPDIR ?? '/tmp';
const MIN = 60_000;
const T = Date.parse('2026-10-20T04:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const at = (min: number) => iso(T + min * MIN);

const dirs: string[] = [];
const stores: LumenStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(join(TMP, 'detect-'));
  dirs.push(dir);
  const store = openLumenStore(join(dir, 'lumen.db'));
  stores.push(store);
  // the migration's 30-day backlog (empty here) is not what these tests are about
  store.detections.dequeue(Number.MAX_SAFE_INTEGER);
  const clock = { now: T + 3 * 3_600_000 };
  const job = createDetectionJob({ open: () => store, tzOf: () => 'UTC', now: () => clock.now, debounceMs: 0 });
  const ingest = (events: unknown[], receivedAt = clock.now) => {
    const r = store.ingest(INSTALL, events, receivedAt);
    expect(r.rejected).toEqual([]);
    return r;
  };
  const tools = lumenToolSet(() => store, 'UTC', () => clock.now);
  const detections = async (args: Record<string, unknown> = {}) => {
    const r = await tools.call('gauge_detections', args);
    expect(r.ok).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- read field by field
    return r.data as any;
  };
  return { store, job, ingest, clock, detections, run: () => job.run('p') };
}

/** Phone minutes `[from, to)` at `steps`/min (detector timing). */
const walk = (from: number, to: number, steps = 100) => Array.from({ length: to - from }, (_, k) => phoneSteps(at(from + k), at(from + k + 1), steps));
/** Gauge's phone acquisition interval (observed at its `from`, as Gauge sends it); `open` for the 5-minute checkpoint. */
const acquisition = (from: number, to: number, o: { open?: boolean; receivedAt?: string } = {}) =>
  lumenEvent('phone/acquisition', 'phone_acquisition', 'com.pulseloop.phone.acquisition.v1', at(from), {
    from: at(from), to: at(to), state: 'listening', detector: 'registered', observed_zero: true, ...(o.open ? { open: true } : {}),
  }, { receivedAt: o.receivedAt ?? at(to) });
const transition = (min: number, activity: string, t: 'ENTER' | 'EXIT', o: { boot?: string; epoch?: number } = {}) =>
  lumenEvent('phone/activity_transition', activity, 'com.pulseloop.phone.activity_transition.v1', at(min), {
    activity, transition: t, occurred_at: at(min), boot_id: o.boot ?? BOOT_ID, elapsed_ns: String(BigInt(min + 1000) * 60_000_000_000n), registration_epoch: o.epoch ?? 1,
  });
const arAcquisition = (from: number, to: number, state = 'listening') =>
  lumenEvent('phone/activity_recognition_acquisition', 'activity_recognition', 'com.pulseloop.phone.activity_recognition_acquisition.v1', at(from), {
    from: at(from), to: at(to), state, registration_epoch: 1,
  });

describe('detection episodes', () => {
  it('queues the touched range at ingest (evidence only), and the job leaves the queue empty', async () => {
    const t = setup();
    t.ingest([hr(at(5), 70)]);
    expect(t.store.detections.queue().map((q) => [q.fromMs, q.toMs])).toEqual([[T + 5 * MIN, T + 6 * MIN]]);
    t.store.detections.dequeue(Number.MAX_SAFE_INTEGER);
    t.ingest([lumenEvent('state/battery', 'battery', 'health.device.battery.updated', at(1), { percent: 50 })]);
    expect(t.store.detections.queue()).toEqual([]);
    t.ingest([acquisition(0, 60), ...walk(10, 30)]);
    expect(t.store.detections.queue().map((q) => [q.fromMs, q.toMs])).toEqual([[T, T + 60 * MIN]]);
    const r = await t.run();
    expect(r.cores).toBeGreaterThan(0);
    expect(t.store.detections.queue()).toEqual([]);
    const d = await t.detections();
    expect(d.episodes).toHaveLength(1);
    expect(d.processedThrough).not.toBeNull();
  });

  it('retains a failed window for retry without claiming it was processed', async () => {
    const t = setup();
    t.ingest([acquisition(0, 60), ...walk(10, 30)]);
    const queued = t.store.detections.queue();
    const read = vi.spyOn(t.store.detections, 'overlapping').mockImplementationOnce(() => {
      throw new Error('transient read failure');
    });
    const failed = await t.run();
    expect(failed.skipped).toBe(1);
    expect(t.store.detections.queue()).toEqual(queued);
    expect(t.store.detections.processedMs()).toBeNull();
    read.mockRestore();

    const retried = await t.run();
    expect(retried.skipped).toBe(0);
    expect(t.store.detections.queue()).toEqual([]);
    expect((await t.detections()).episodes).toHaveLength(1);
    const cursor = (await t.detections()).cursor;
    await t.run();
    expect((await t.detections()).cursor).toBe(cursor);
  });

  it.each([20, 100])('waits for delayed recovery after a %i-minute non-stepping window, and replays it once', async (duration) => {
    const t = setup();
    const samples = (a: number, b: number, bpm: number, supported = true) =>
      Array.from({ length: (b - a) * 6 }, (_, k) => lumenEvent(
        'metrics/hr', 'hr', 'health.metric.observed', iso(T + a * MIN + k * 10_000),
        { metric: 'hr', value: bpm, unit: 'bpm', provenance: 'device_history', ...(supported ? { cadence_s: 10 } : {}) },
      ));
    // Real all-day history has no declared cadence: even a plausible rise is not
    // supported exercise evidence. Neither this nor recorded streams identify equipment.
    t.ingest([acquisition(0, 50 + duration), ...samples(0, 30, 70, false), ...samples(30, 30 + duration, 135, false)]);
    await t.run();
    expect((await t.detections()).episodes).toHaveLength(0);
    t.ingest([...samples(0, 30, 70), ...samples(30, 30 + duration, 135)]);
    await t.run();
    expect((await t.detections()).episodes).toHaveLength(0);
    const recovery = samples(30 + duration, 40 + duration, 70);
    t.ingest(recovery);
    await t.run();
    const first = (await t.detections()).episodes;
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ label: 'possible_workout', level: 'low', alternatives: [] });
    expect(first[0].reasons).toEqual(expect.arrayContaining(['hr_only', 'type_unknown']));
    t.ingest(recovery);
    await t.run();
    expect((await t.detections()).episodes).toEqual(first);
  });

  it.each([0, 19, 59])('keeps ring minute burst evidence at +%i seconds, without splitting counts or promoting fallback', async (offsetS) => {
    const t = setup();
    const shift = offsetS >= 30 ? 1 : 0;
    const counts = Array.from({ length: 80 }, (_, i) => i >= 30 && i < 50 ? [80, 80, 0, 0][(i - 30) % 4]! : 0);
    const rings = counts.map((steps, i) => ringSteps(iso(T + i * MIN + offsetS * 1000), steps));
    const hrs = Array.from({ length: 80 * 6 }, (_, k) => lumenEvent(
      'metrics/hr', 'hr', 'health.metric.observed', iso(T + k * 10_000),
      { metric: 'hr', value: k >= (30 + shift) * 6 && k < (50 + shift) * 6 ? 130 : 70, unit: 'bpm', cadence_s: 10 },
    ));
    t.ingest([acquisition(0, 110), ...rings, ...hrs,
      ringSteps(iso(T + 90 * MIN + offsetS * 1000), 800, { durationS: 600 }),
    ]);
    // Exact replays and a second, partly overlapping minute copy must not add counts.
    t.ingest([...rings, ringSteps(iso(T + 30 * MIN + offsetS * 1000 + 30_000), 11)]);
    const { input } = detectionInput(t.store, T, T + 110 * MIN, { tz: 'UTC', nowMs: t.clock.now });
    expect(input.minutes.slice(shift, 80 + shift).map((m) => m.ring)).toEqual(counts);
    expect(input.minutes.slice(shift, 80 + shift).every((m) => m.ringState === 'counted')).toBe(true);
    expect(input.minutes.reduce((sum, m) => sum + (m.ring ?? 0), 0)).toBe(800);
    expect(input.minutes.slice(91, 100).every((m) => m.ringState === 'coarse' && m.ring === null)).toBe(true);
    expect(input.ringCoarse).toHaveLength(1);
    const result = detect2(input);
    expect(result.episodes).toHaveLength(1);
    expect(result.episodes[0]).toMatchObject({
      label: 'possible_workout', alternatives: ['possible_strength'],
      startMs: T + (30 + shift) * MIN, endMs: T + (48 + shift) * MIN,
    });
    expect(result.episodes[0]!.reasons).toContain('ring_bursts');
  });

  it('earlier phone uploads revise the same episode id (identity assigned once)', async () => {
    const t = setup();
    t.ingest([acquisition(0, 60), ...walk(10, 30)]);
    await t.run();
    const first = (await t.detections()).episodes;
    expect(first).toHaveLength(1);
    expect([first[0].start, first[0].end, first[0].revision, first[0].state]).toEqual([at(10), at(30), 1, 'final']);
    t.ingest(walk(0, 10));
    await t.run();
    const all = await t.detections();
    expect(all.episodes.map((e: { id: string }) => e.id)).toEqual([first[0].id]);
    expect([all.episodes[0].start, all.episodes[0].revision]).toEqual([at(0), 2]);
    expect(all.withdrawn).toEqual([]);
    // the same evidence again changes nothing (no new revision)
    t.ingest(walk(0, 30).slice(0, 3), t.clock.now + 1);
    await t.run();
    expect((await t.detections()).episodes[0].revision).toBe(2);
  });

  it('out-of-order uploads give the same episode as in-order ones', async () => {
    const a = setup();
    const b = setup();
    const parts = [[acquisition(0, 90)], walk(40, 60), walk(5, 40), [ringSteps(at(20), 3)]];
    for (const p of parts) {
      a.ingest(p);
      await a.run();
    }
    for (const p of [...parts].reverse()) b.ingest(p);
    await b.run();
    const strip = (e: Record<string, unknown>) => ({ ...e, id: undefined, revision: undefined });
    const ea = (await a.detections()).episodes;
    const eb = (await b.detections()).episodes;
    expect(ea).toHaveLength(1);
    expect(eb.map(strip)).toEqual(ea.map(strip));
    expect(ea[0].label).toBe('walk');
  });

  it('withdraws an episode whose evidence a deletion hid, and lists it after the cursor', async () => {
    const t = setup();
    t.ingest([acquisition(0, 60), ...walk(10, 30)]);
    await t.run();
    const before = await t.detections();
    const id = before.episodes[0].id;
    expect((await t.detections({ since: before.cursor })).episodes).toEqual([]);
    t.ingest([deletion(at(50), { category: 'activity/phone_steps', from: at(0), to: at(60) })], T + 4 * 3_600_000);
    await t.run();
    const after = await t.detections({ since: before.cursor });
    expect([after.episodes, after.withdrawn, after.resync]).toEqual([[], [id], false]);
    // a full read shows the withdrawal too; a cursor of another file resyncs
    expect((await t.detections()).withdrawn).toEqual([id]);
    expect((await t.detections({ since: '000000000000.5' })).resync).toBe(true);
  });

  it('is open while the phone\'s checkpoint is within 5 minutes of the end, final once it moves on (same id)', async () => {
    const t = setup();
    t.clock.now = T + 23 * MIN;
    t.ingest([acquisition(0, 22, { open: true, receivedAt: at(22) }), ...walk(0, 20)], t.clock.now);
    await t.run();
    const open = (await t.detections()).episodes;
    expect(open.map((e: { state: string }) => e.state)).toEqual(['open']);
    // the next checkpoint replaces the first (same subject and from, newer received_at)
    t.clock.now = T + 29 * MIN;
    t.ingest([acquisition(0, 28, { open: true, receivedAt: at(28) })], t.clock.now);
    await t.run();
    const final = (await t.detections()).episodes;
    expect(final.map((e: { id: string; state: string; revision: number }) => [e.id, e.state, e.revision])).toEqual([[open[0].id, 'final', 2]]);
    expect(t.store.all('SELECT id FROM acquisition')).toHaveLength(1);
  });

  it('lists an overlapping Gauge recording, and treats the walk under it as the same activity for review', async () => {
    const t = setup();
    t.ingest([acquisition(0, 60), ...walk(10, 30), workout('w-9', at(31), { start: at(12), end: at(30), type: 'walk', durationS: 1000 })]);
    await t.run();
    const e = (await t.detections()).episodes[0];
    expect(e.recordingRefs).toEqual(['gauge:w-9']);
    expect(e.reasons).toContain('recording_overlap');
  });

  it('has the route\'s shape, availability names detect/2', async () => {
    const t = setup();
    t.ingest([acquisition(0, 60), ...walk(10, 30)]);
    await t.run();
    const d = await t.detections({ from: '2026-10-20', to: '2026-10-20', limit: 10 });
    expect(Object.keys(d).sort()).toEqual(expect.arrayContaining(['detector', 'config', 'episodes', 'withdrawn', 'cursor', 'more', 'resync', 'processedThrough', 'diagnostics']));
    expect(d.detector).toBe('detect/2');
    expect(Object.keys(d.episodes[0]).sort()).toEqual(['alternatives', 'config', 'coverage', 'detector', 'end', 'evidenceHash', 'existence', 'id', 'label', 'level', 'moving', 'reasons', 'recordingRefs', 'revision', 'start', 'state', 'typeScore'].sort());
    expect(d.episodes[0].id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect((await t.detections({ from: '2026-10-21', to: '2026-10-21' })).episodes).toEqual([]);
    const tools = lumenToolSet(() => t.store, 'UTC', () => t.clock.now);
    expect(((await tools.call('gauge_data_availability', {})).data as { detection: string }).detection).toBe('detect/2');
    expect((await tools.call('gauge_detections', { since: 'nope' })).ok).toBe(false);
  });
});

describe('activity recognition ingest', () => {
  it('accepts the contract\'s events, refuses malformed ones, and keeps one current version of each interval', () => {
    const t = setup();
    const ok = t.store.ingest(INSTALL, [transition(1, 'WALKING', 'ENTER'), arAcquisition(0, 60)], T);
    expect(ok.accepted).toBe(2);
    const bad = t.store.ingest(INSTALL, [
      lumenEvent('phone/activity_transition', 'WALKING', 'x.v1', at(2), { activity: 'WALKING', transition: 'ENTER', occurred_at: at(2), boot_id: BOOT_ID, elapsed_ns: 5, registration_epoch: 1 }),
      lumenEvent('phone/activity_transition', 'TILTING', 'x.v1', at(2), { activity: 'TILTING', transition: 'ENTER', occurred_at: at(2), boot_id: BOOT_ID, elapsed_ns: '5', registration_epoch: 1 }),
      lumenEvent('phone/activity_recognition_acquisition', 'ar', 'x.v1', at(2), { from: at(3), to: at(2), state: 'listening', registration_epoch: 1 }),
      lumenEvent('phone/activity_recognition_acquisition', 'ar', 'x.v1', at(2), { from: at(2), to: at(3), state: 'maybe', registration_epoch: 1 }),
    ], T);
    expect(bad.rejected.map((r) => r.reason)).toEqual(['bad_activity_transition', 'bad_activity_transition', 'bad_ar_acquisition', 'bad_ar_acquisition']);
    // replayed transitions are duplicates (stable ids), the views hold them once
    expect(t.store.ingest(INSTALL, [transition(1, 'WALKING', 'ENTER')], T).duplicates).toBe(1);
    expect(t.store.all('SELECT activity, transition, occurred_ms FROM activity_transitions')).toEqual([{ activity: 'WALKING', transition: 'ENTER', occurred_ms: T + MIN }]);
    expect(t.store.all('SELECT state, start_ms, end_ms FROM ar_acquisition')).toEqual([{ state: 'listening', start_ms: T, end_ms: T + 60 * MIN }]);
  });

  it('reads the recognised state into the episode, carrying the newest closed listening hour into the open one', async () => {
    const t = setup();
    t.clock.now = T + 90 * MIN;
    // recognition closed at the hour (T+60); the walk runs in the still-open hour after it
    t.ingest([arAcquisition(0, 60), transition(1, 'STILL', 'ENTER'), transition(62, 'STILL', 'EXIT'), transition(62, 'WALKING', 'ENTER'), acquisition(55, 90, { open: true }), ...walk(62, 84)]);
    await t.run();
    const e = (await t.detections()).episodes;
    expect(e).toHaveLength(1);
    expect(e[0].reasons).toContain('ar_walking');
    expect(e[0].coverage.ar).toBe(1);
  });

  it('masks a vehicle stretch', async () => {
    const t = setup();
    t.ingest([arAcquisition(0, 60), transition(5, 'IN_VEHICLE', 'ENTER'), acquisition(0, 60), ...walk(10, 30)]);
    await t.run();
    expect((await t.detections()).episodes).toEqual([]);
  });
});

describe('schema version 5', () => {
  it('migrates a v4 file: the detection tables, the spans of recognition events an older server stored, the 30-day backlog', () => {
    const dir = mkdtempSync(join(TMP, 'detect-mig-'));
    dirs.push(dir);
    const file = join(dir, 'lumen.db');
    const s = openLumenStore(file);
    s.ingest(INSTALL, [transition(1, 'WALKING', 'ENTER'), arAcquisition(0, 60)], T);
    s.close();
    // what a 0.6.6 server leaves: no detection tables, no spans for categories it did not know, version 4
    const db = new Database(file);
    db.exec(`DROP TABLE detection_episodes; DROP TABLE detection_queue; DELETE FROM event_spans WHERE category LIKE 'phone/activity%'; DROP VIEW activity_transitions; DROP VIEW ar_acquisition`);
    db.pragma('user_version = 4');
    db.close();
    const again = openLumenStore(file);
    stores.push(again);
    expect(again.all('SELECT activity FROM activity_transitions')).toEqual([{ activity: 'WALKING' }]);
    expect(again.all('SELECT state FROM ar_acquisition')).toEqual([{ state: 'listening' }]);
    const q = again.detections.queue();
    expect(q).toHaveLength(1);
    expect(q[0]!.toMs - q[0]!.fromMs).toBe(30 * 24 * 3_600_000);
    expect(new Database(file, { readonly: true }).pragma('user_version', { simple: true })).toBe(LUMEN_SCHEMA_VERSION);
  });
});

describe('reconcile', () => {
  const det = (startMin: number, endMin: number, family: DetectedEpisode['family'] = 'gait'): DetectedEpisode => ({
    startMs: T + startMin * MIN, endMs: T + endMin * MIN, moving: [], state: 'final', family, label: 'walk', alternatives: [], existence: 0.6, typeScore: 0.6, level: 'medium',
    reasons: [], coverage: { phone: 1, ring: 0, hr: 0, ar: 0, gps: 0 }, evidenceHash: `h${startMin}`, recordingRefs: [],
  });
  let n = 0;
  const newId = () => `ID${n++}`;
  const stored = (id: string, d: DetectedEpisode, createdMs: number, state: StoredEpisode['state'] = 'final'): StoredEpisode => {
    const w = reconcile([], [d], { nowMs: createdMs, newId: () => id })[0]!;
    return { ...w, changeSeq: 1, state, doc: { ...w.doc, state } };
  };

  it('a merge keeps the oldest id and withdraws the other; a split keeps the id on the larger part', () => {
    const a = stored('A', det(0, 15), 1);
    const b = stored('B', det(18, 40), 2);
    const merged = reconcile([a, b], [det(0, 40)], { nowMs: 9, newId });
    expect(merged.map((w) => [w.id, w.state, w.revision])).toEqual([['B', 'final', 2], ['A', 'withdrawn', 2]]);
    const split = reconcile([stored('C', det(0, 40), 1)], [det(0, 10), det(14, 40)], { nowMs: 9, newId });
    expect(split.map((w) => [w.id, w.startMs])).toEqual([[split[0]!.id, T], ['C', T + 14 * MIN]]);
    expect(split[0]!.id).not.toBe('C');
  });

  it('brings a withdrawn episode back under its id when the evidence returns', () => {
    const w = stored('W', det(0, 20), 1, 'withdrawn');
    expect(reconcile([w], [det(1, 20)], { nowMs: 9, newId }).map((x) => [x.id, x.state])).toEqual([['W', 'final']]);
  });
});

describe('Health Connect exercise types on read', () => {
  it('imports Gauge\'s name-plus-code payload and answers the name and the code; a legacy integer gets its name', async () => {
    const t = setup();
    t.ingest([
      hcRecord('ExerciseSession', 'ex-1', at(0), at(30), { exercise_type: 'running_treadmill', exercise_type_code: 57, segments: [], laps: [], route_state: 'none' }, { origin: 'com.strava' }),
      hcRecord('ExerciseSession', 'ex-2', at(40), at(60), { exercise_type: 79, segments: [], laps: [], route_state: 'none' }, { origin: 'com.strava' }),
    ]);
    const tools = lumenToolSet(() => t.store, 'UTC', () => t.clock.now);
    const r = await tools.call('gauge_hc', { type: 'ExerciseSession', from: '2026-10-20', to: '2026-10-20' });
    const recs = (r.data as { records: Array<{ id: string; payload: { exercise_type: unknown; exercise_type_code: unknown } }> }).records;
    expect(recs.map((x) => [x.id, x.payload.exercise_type, x.payload.exercise_type_code])).toEqual([['ex-1', 'running_treadmill', 57], ['ex-2', 'walking', 79]]);
    // the stored event is untouched
    expect(t.store.all<{ p: string }>("SELECT json_extract(data, '$.payload.exercise_type') AS p FROM hc_records ORDER BY start_ms").map((x) => x.p)).toEqual(['running_treadmill', 79]);
    const tl = await tools.call('gauge_timeline', { date: '2026-10-20' });
    expect((tl.data as { hcExercise: Array<{ exerciseType: string; exerciseTypeCode: number }> }).hcExercise.map((x) => [x.exerciseType, x.exerciseTypeCode])).toEqual([['running_treadmill', 57], ['walking', 79]]);
  });
});
