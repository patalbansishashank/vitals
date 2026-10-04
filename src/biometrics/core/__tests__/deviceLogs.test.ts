/** `planDeviceLogs`: a day's steps, sleep and workouts from opted-in device streams → Living log entries (log.fromBiometrics). */
import { describe, expect, it } from 'vitest';
import { effectiveEntries, type LogEntry } from '@/living';
import { planDeviceLogs, type DeviceLogInput } from '../deviceLogs';
import type { SourcedRecord } from '../resolve';
import type { BioSourceDoc, StreamPolicy, WorkoutRecord } from '../types';
import { daily, prov, sleep } from './factory';

const D = '2026-10-01';
const RING = 'file:canonical:ring';
const WATCH = 'file:canonical:watch';
const on = (stream: StreamPolicy['stream']): StreamPolicy => ({ stream, imported: true, coach: 'hidden', engine: true, scores: true });
const offEngine = (stream: StreamPolicy['stream']): StreamPolicy => ({ stream, imported: true, coach: 'hidden', engine: false, scores: true });
const PERSON = [on('steps'), on('sleep_sessions'), on('workouts')];
const src = (sourceKey: string, priority: number, policies: StreamPolicy[] = []): BioSourceDoc => ({ sourceKey, label: sourceKey === RING ? 'Ring' : 'Watch', tier: 'B', priority, policies, baselineEpochs: [] });

function workout(id: string, start: string, f: Partial<WorkoutRecord> = {}): WorkoutRecord {
  return {
    kind: 'workout', record_id: id, version: 1, time: { start, end: new Date(Date.parse(start) + 45 * 60_000).toISOString(), tz_offset_s: 0, local_date: start.slice(0, 10) },
    provenance: prov(), quality: { validation: 'measured', confidence: null, flags: [] }, exercise_type: 'running', active_duration_s: 45 * 60, ...f,
  };
}
const night = (id: string, bed: string, wake: string, localDate: string, asleepH = 7) => {
  const s = sleep(id, localDate, asleepH * 3600, true, prov(), bed);
  return { ...s, time: { ...s.time, end: wake } };
};

const base = (records: SourcedRecord[], over: Partial<DeviceLogInput> = {}): DeviceLogInput => ({
  date: D, tz: 'UTC', records, sources: [src(RING, 1), src(WATCH, 2)], person: PERSON, entries: [], ...over,
});
const sr = (record: SourcedRecord['record'], sourceKey = RING): SourcedRecord => ({ sourceKey, record });

let n = 0;
const entry = (e: Record<string, unknown>): LogEntry => ({ id: `E${String(++n).padStart(25, '0')}`, date: D, tz: 'UTC', source: { by: 'user', method: 'typed' }, ...e }) as LogEntry;

describe('planDeviceLogs', () => {
  it('supersedes a provisional tail before filtering by the app-day rollover', () => {
    const partial = night('tail', '2026-10-01T22:00:00.000Z', '2026-10-02T02:30:00.000Z', '2026-10-02', 4);
    partial.quality.flags = ['provisional_stages'];
    const full = night('full', '2026-10-01T21:30:00.000Z', '2026-10-02T06:30:00.000Z', '2026-10-02', 8);
    const records = [sr(partial), sr(full)];
    expect(planDeviceLogs(base(records)).create).toEqual([]);
    expect(planDeviceLogs(base(records, { date: '2026-10-02' })).create.map((c) => c.recordId)).toEqual(['full']);
  });

  it('maps steps, the night ending on the day and the day’s workouts (type, duration, kcal, heart rate)', () => {
    const p = planDeviceLogs(base([
      sr(daily('d1', D, { steps: 9123.4 })),
      sr(night('s1', '2026-09-30T23:10:00.000Z', '2026-10-01T06:50:00.000Z', '2026-09-30')),
      sr(workout('w1', '2026-10-01T17:30:00.000Z', { active_kcal: 410, hr_avg_bpm: 142, title: 'Evening run', distance_m: 7200 })),
    ]));
    expect(p.skipped).toEqual([]);
    expect(p.create.map((c) => [c.stream, c.key])).toEqual([['steps', `${D}:steps`], ['sleep_sessions', `${D}:sleep_sessions`], ['workouts', `${D}:workouts:w1`]]);
    const [steps, sl, w] = p.create.map((c) => c.entry as unknown as Record<string, unknown>);
    expect(steps).toMatchObject({ date: D, kind: 'steps', steps: 9123, source: { by: 'device', method: 'biometrics', bioRecordId: 'd1', deviceKey: `${D}:steps` } });
    expect(sl).toMatchObject({ date: D, kind: 'sleep', bedAt: '2026-09-30T23:10:00.000Z', wakeAt: '2026-10-01T06:50:00.000Z' });
    expect(w).toMatchObject({ kind: 'session', status: 'done', startH: 17.5, durationMin: 45, bioWorkoutId: 'w1', hr: { avgBpm: 142 }, workout: { exerciseType: 'running', kind: 'cardio', activeKcal: 410, distanceM: 7200, title: 'Evening run' } });
  });

  it('puts sleep on the app day it ends on (04:00 rollover): a night ending 02:30 belongs to the day before', () => {
    const late = night('s2', '2026-10-01T22:00:00.000Z', '2026-10-02T02:30:00.000Z', '2026-10-01', 4);
    const normal = night('s3', '2026-10-02T22:30:00.000Z', '2026-10-03T06:30:00.000Z', '2026-10-02');
    expect(planDeviceLogs(base([sr(late)])).create.map((c) => c.recordId)).toEqual(['s2']);
    expect(planDeviceLogs(base([sr(late)], { date: '2026-10-02' })).create).toEqual([]);
    expect(planDeviceLogs(base([sr(normal)], { date: '2026-10-02' })).create).toEqual([]);
    expect(planDeviceLogs(base([sr(normal)], { date: '2026-10-03' })).create.map((c) => c.recordId)).toEqual(['s3']);
    // the zone decides the wall clock: 06:30 UTC is 02:30 in New York, still the day before there
    expect(planDeviceLogs(base([sr(normal)], { date: '2026-10-02', tz: 'America/New_York' })).create.map((c) => c.recordId)).toEqual(['s3']);
    // a workout at 01:00 is still the previous app day
    expect(planDeviceLogs(base([sr(workout('w2', '2026-10-02T01:00:00.000Z'))])).create.map((c) => c.recordId)).toEqual(['w2']);
  });

  it('reads only streams the plan may use; an opted-out stream is ignored and reported', () => {
    const records = [sr(daily('d1', D, { steps: 8000 })), sr(workout('w1', '2026-10-01T17:30:00.000Z'))];
    const p = planDeviceLogs(base(records, { person: [on('steps'), offEngine('workouts'), on('sleep_sessions')] }));
    expect(p.create.map((c) => c.stream)).toEqual(['steps']);
    expect(p.notOptedIn).toEqual(['workouts']);
    // per source: the ring's steps are off, the watch's are on → the watch's steps
    const two = [sr(daily('d1', D, { steps: 8000 })), sr(daily('d2', D, { steps: 7000 }), WATCH)];
    const q = planDeviceLogs(base(two, { sources: [src(RING, 1, [offEngine('steps')]), src(WATCH, 2)] }));
    expect(q.create.map((c) => [c.recordId, c.sourceKey])).toEqual([['d2', WATCH]]);
    expect(q.notOptedIn).toEqual([]);
  });

  it('picks one source per metric by priority, never averaging', () => {
    const p = planDeviceLogs(base([sr(daily('d1', D, { steps: 8000 })), sr(daily('d2', D, { steps: 12000 }), WATCH)]));
    expect(p.create).toHaveLength(1);
    expect((p.create[0]!.entry as unknown as { steps: number }).steps).toBe(8000);
  });

  it('is idempotent: same value → unchanged; new value → supersedes the device entry; a removed device entry stays removed', () => {
    const records = [sr(daily('d1', D, { steps: 8000 })), sr(workout('w1', '2026-10-01T17:30:00.000Z'))];
    const first = planDeviceLogs(base(records));
    const stored = first.create.map((c) => entry({ ...c.entry }));
    const again = planDeviceLogs(base(records, { entries: stored }));
    expect(again.create).toEqual([]);
    expect(again.skipped.map((s) => [s.stream, s.reason, s.entryId])).toEqual([['steps', 'unchanged', stored[0]!.id], ['workouts', 'unchanged', stored[1]!.id]]);

    const more = planDeviceLogs(base([sr(daily('d1', D, { steps: 11000 }), RING), records[1]!], { entries: stored }));
    expect(more.create.map((c) => [c.stream, c.supersedes])).toEqual([['steps', stored[0]!.id]]);
    // undoing the update (retracting it) brings the earlier device entry back
    const update = entry({ ...more.create[0]!.entry, supersedes: stored[0]!.id });
    expect(effectiveEntries([...stored, update]).map((e) => e.id)).toEqual([stored[1]!.id, update.id]);
    expect(effectiveEntries([...stored, update, entry({ kind: 'retract', target: update.id })]).map((e) => e.id)).toEqual(stored.map((e) => e.id));

    const retracted = [...stored, entry({ kind: 'retract', target: stored[0]!.id })];
    const after = planDeviceLogs(base(records, { entries: retracted }));
    expect(after.create).toEqual([]);
    expect(after.skipped.find((s) => s.stream === 'steps')?.reason).toBe('removed');
  });

  // L-REV2 R3-01: two devices updated the same device entry; the re-run compares with the one that is counted
  it('with two device versions of one entry, a re-run updates the counted one', () => {
    const records = [sr(daily('d1', D, { steps: 8000 }))];
    const first = entry({ ...planDeviceLogs(base(records)).create[0]!.entry, at: '2026-10-01T20:00:00Z' });
    const { id: firstId, ...body } = first;
    const fresh = entry({ ...body, steps: 8000, at: '2026-10-01T21:00:00Z', supersedes: firstId });
    const stale = entry({ ...body, steps: 7000, at: '2026-10-01T22:00:00Z', supersedes: firstId });
    const rerun = planDeviceLogs(base(records, { entries: [first, fresh, stale] }));
    expect(rerun.create.map((c) => [c.stream, c.supersedes, (c.entry as { steps?: number }).steps])).toEqual([['steps', stale.id, 8000]]);
  });

  it('never overrides what the person logged: their steps, sleep or the same session win and are reported', () => {
    const records = [
      sr(daily('d1', D, { steps: 8000 })),
      sr(night('s1', '2026-09-30T23:00:00.000Z', '2026-10-01T07:00:00.000Z', '2026-09-30')),
      sr(workout('w1', '2026-10-01T17:30:00.000Z')),
      sr(workout('w2', '2026-10-01T07:00:00.000Z', { exercise_type: 'strength_training' })),
    ];
    const mine = [
      entry({ kind: 'steps', steps: 10000 }),
      entry({ kind: 'sleep', bedAt: '2026-09-30T22:00:00.000Z', wakeAt: '2026-10-01T06:00:00.000Z' }),
      entry({ kind: 'session', status: 'done', startH: 18, performed: [], stimulus: {}, catalogueVersion: 'x' }),
    ];
    const p = planDeviceLogs(base(records, { entries: mine }));
    expect(p.skipped.map((s) => [s.stream, s.reason, s.entryId])).toEqual([
      ['steps', 'userEntry', mine[0]!.id],
      ['sleep_sessions', 'userEntry', mine[1]!.id],
      ['workouts', 'userEntry', mine[2]!.id],
    ]);
    // the morning strength workout is not the session the person logged at 18:00
    expect(p.create.map((c) => [c.recordId, (c.entry as unknown as { workout: { kind: string } }).workout.kind])).toEqual([['w2', 'resistance']]);
  });
});
