// @vitest-environment node
/**
 * One night = one session (the ring parity night). A J-Style 2301 hands its night over in packets; the packets of one
 * night can be a few minutes apart, and Lumen Health relayed them one packet per message, overlapping. The shape here is
 * that night's shape on synthetic times and stages: a nap in the evening; a night of four touching or overlapping
 * packets, a 7-minute gap and one more packet; two hours later a second sleep in five pieces (gaps of 1, 20, 8 and 7
 * minutes, one piece all awake); Lumen never sent the last packet. Lumen splits sessions at a gap of an hour or more.
 */
import { describe, expect, it } from 'vitest';
import { jstyle2301 } from '../../../../packages/rings/src/jstyle2301/family';
import { ringRecords, type RingRecordContext } from '../../../../packages/rings/src/records';
import { ringIdentity, ringSourceKey, type RingEvent, type SleepStage } from '../../../../packages/rings/src/types';
import { mapLumenEvents } from '../../importers/lumenCloudEvents';
import { ingestLumenBatches } from '../../importers/lumenIngest';
import { foldBatch } from '../../ingest/pipeline';
import { InMemoryBioStore } from '../../store/memory';
import { NIGHT_GAP_MS, reconcileSleep } from '../reconcileSleep';
import { resolveDays, type SourcedRecord } from '../resolve';
import { lumenFold, sourceKeyOf } from '../source';
import type { BioRecord, SleepRecord } from '../types';

const MIN = 60_000;
const IDENTITY = ringIdentity({ family: 'jstyle2301', model: '2301', serial: 'SYNTHETIC042' });
const RING = ringSourceKey(IDENTITY);
const at = (s: string): number => Date.parse(`2026-03-${s}:00Z`);
const T0 = at('09T22:00');
const DAY = 24 * 60 * MIN;

/** The ring's final night, one stage per minute: awake at the start of the night, in the 02:07 packet's first minutes
 * and through the 05:42 piece; elsewhere 10-minute runs of light, deep, light, REM. */
function ringStage(t: number): SleepStage {
  if ((t >= at('09T22:00') && t < at('09T22:20')) || (t >= at('10T02:07') && t < at('10T02:15')) || (t >= at('10T05:42') && t < at('10T06:08'))) return 'awake';
  return (['light', 'deep', 'light', 'rem'] as const)[Math.floor((t - T0 + DAY) / (10 * MIN)) % 4]!;
}
const slice = (start: number, minutes: number): SleepStage[] => Array.from({ length: minutes }, (_, i) => ringStage(start + i * MIN));

/** [start, minutes] of the packets as the ring holds them after the night (what a Bluetooth read gets). */
const RING_PACKETS: Array<[number, number]> = [
  [at('09T17:00'), 30], // the evening nap
  [at('09T22:00'), 80], [at('09T23:20'), 40], [at('10T00:00'), 85], [at('10T01:25'), 35], // touching, to 02:00
  [at('10T02:07'), 30], // after a 7-minute gap, to 02:37
  [at('10T04:37'), 30], [at('10T05:07'), 34], [at('10T05:42'), 26], [at('10T06:28'), 14], [at('10T06:50'), 22], [at('10T07:19'), 115], // to 09:14
];
/** What Lumen sent, one message per packet as it read them: two overlap their neighbour by 15 minutes; the last never left. */
const LUMEN_PACKETS: Array<[number, number]> = [
  [at('09T17:00'), 30],
  [at('09T22:00'), 80], [at('09T23:20'), 40], [at('09T23:45'), 100], [at('10T01:10'), 50],
  [at('10T02:07'), 30],
  [at('10T04:37'), 30], [at('10T05:07'), 34], [at('10T05:42'), 26], [at('10T06:28'), 14], [at('10T06:50'), 22],
];

const READ_AT = '2026-03-10T09:30:00.000Z';
const ringCtx: RingRecordContext = {
  identity: IDENTITY, family: jstyle2301, firmware: 'V0525', tz: 'UTC', tzOffsetS: 0,
  receivedS: Date.parse(READ_AT) / 1000, ingestedAt: READ_AT, producer: { name: 'test', version: '1' },
};
const sleepEvent = ([start, minutes]: [number, number]): RingEvent => ({ type: 'sleepEpochs', start, epochS: 60, stages: slice(start, minutes), rawCodes: [], firmware: 'V0525', complete: false });
const lumenEvent = ([start, minutes]: [number, number], stages = slice(start, minutes)) => {
  const received = new Date(start + (minutes + 5) * MIN).toISOString();
  const observed = new Date(start).toISOString();
  return {
    specversion: '1.0', id: `pl-sleep-${observed}`, type: 'health.sleep.timeline.updated', source: 'urn:pulseloop:installation:synthetic', subject: 'sleep', time: observed,
    data: { schema_version: 1, observed_at: observed, received_at: received, sample_interval_minutes: 1, complete_session: false, stages },
  };
};

const sourced = (records: readonly BioRecord[]): SourcedRecord[] => records.filter((r) => r.kind === 'sleep').map((record) => ({ sourceKey: sourceKeyOf(record.provenance), record }));
/** One Bluetooth read of the whole history (all packets in one sync). */
const bleRead = (): SourcedRecord[] => sourced(ringRecords(RING_PACKETS.map(sleepEvent), ringCtx).records);
/** Lumen's messages, one batch each as the broker ingests them, filed under the ring once the fold has run. */
function lumenMessages(fold = true): SourcedRecord[] {
  const f = lumenFold({ lumen: RING })!;
  return LUMEN_PACKETS.flatMap((p) => {
    const batch = mapLumenEvents([lumenEvent(p)], { tz: 'UTC', now: '2026-03-10T09:00:00.000Z', channel: 'mqtt:lumen' }).batch;
    return sourced((fold ? foldBatch(batch, f) : batch).records);
  });
}

const clock = (iso: string | undefined) => (iso ?? '').slice(11, 16);
const shape = (s: SleepRecord) => ({ bed: clock(s.time.start), wake: clock(s.time.end), date: s.time.local_date, asleepMin: s.asleep_s / 60, main: s.is_main });
const day = (entries: SourcedRecord[], date: string) => resolveDays(entries, [], { from: date, to: date })[0];

const NIGHT = { bed: '22:00', wake: '02:37', date: '2026-03-10', asleepMin: 270 - 28, main: true };
const SECOND = { bed: '04:37', wake: '09:14', date: '2026-03-10', asleepMin: 30 + 34 + 14 + 22 + 115, main: false };

describe('one night from the pieces of one source', () => {
  it('a Bluetooth read: the packet after the 7-minute gap stays in the night, and the second sleep is one session', () => {
    const pieces = bleRead();
    // what the read stores: touching packets joined, every gap a new piece (the night cut at 02:00, the second sleep in five)
    expect(pieces.filter((e) => (e.record as SleepRecord).time.local_date === '2026-03-10')).toHaveLength(7);
    const d = day(pieces, '2026-03-10')!;
    expect(shape(d.mainSleep!)).toEqual(NIGHT);
    expect(d.sleeps.map(shape)).toEqual([NIGHT, SECOND]);
    expect(d.mainSleep!.stages![0]).toMatchObject({ stage: 'awake', start: new Date(at('09T22:00')).toISOString() });
    // the gap is not counted as sleep or as time in bed
    expect(d.mainSleep!.in_bed_s).toBe(270 * 60);
    expect(day(pieces, '2026-03-09')!.sleeps.map(shape)).toEqual([{ bed: '17:00', wake: '17:30', date: '2026-03-09', asleepMin: 30, main: true }]);
  });

  it('Lumen\'s messages, one packet each: the overlapping fragments are one night, the first one (woken before midnight) included', () => {
    const msgs = lumenMessages(false);
    // the first fragment ends before midnight, so on its own it is a night of the evening before
    expect(msgs.some((e) => (e.record as SleepRecord).time.local_date === '2026-03-09' && clock((e.record as SleepRecord).time.start) === '22:00')).toBe(true);
    const d = day(msgs, '2026-03-10')!;
    expect(shape(d.mainSleep!)).toEqual(NIGHT);
    // Lumen never sent the last packet: its second sleep ends at 07:12
    expect(d.sleeps.map(shape)).toEqual([NIGHT, { ...SECOND, wake: '07:12', asleepMin: 30 + 34 + 14 + 22 }]);
    expect(day(msgs, '2026-03-09')!.sleeps.map(shape)).toEqual([{ bed: '17:00', wake: '17:30', date: '2026-03-09', asleepMin: 30, main: true }]);
  });

  it('the ring read and Lumen\'s copy of the same night under one source (after the fold) are one night, in any order', () => {
    const all = [...bleRead(), ...lumenMessages()];
    expect(new Set(all.map((e) => e.sourceKey))).toEqual(new Set([RING]));
    for (const order of [all, all.toReversed(), [...all.filter((_, i) => i % 2), ...all.filter((_, i) => !(i % 2))]]) {
      const d = day(order, '2026-03-10')!;
      expect(d.sleeps.map(shape)).toEqual([NIGHT, SECOND]);
      expect(d.sourceByMetric.sleep).toBe(RING);
      expect(day(order, '2026-03-09')!.sleeps.map(shape)).toEqual([{ bed: '17:00', wake: '17:30', date: '2026-03-09', asleepMin: 30, main: true }]);
    }
    // the stitched night is the same record whichever read arrived first
    expect(day(all, '2026-03-10')!.mainSleep).toEqual(day(all.toReversed(), '2026-03-10')!.mainSleep);
  });

  it('where two reads of the same minutes disagree, the later read wins', () => {
    const early = lumenEvent([at('09T23:00'), 60], Array(60).fill('deep'));
    const late = lumenEvent([at('09T23:45'), 60], [...Array(15).fill('awake'), ...Array(45).fill('light')]);
    const recs = sourced(mapLumenEvents([early, late], { tz: 'UTC', now: READ_AT, channel: 'mqtt:lumen' }).batch.records);
    const [night] = reconcileSleep(recs).map((e) => e.record as SleepRecord);
    expect(night!.time).toMatchObject({ start: new Date(at('09T23:00')).toISOString(), end: new Date(at('10T00:45')).toISOString(), local_date: '2026-03-10' });
    expect({ deep: night!.deep_s! / 60, awake: night!.awake_s! / 60, light: night!.light_s! / 60, asleep: night!.asleep_s / 60 }).toEqual({ deep: 45, awake: 15, light: 45, asleep: 90 });
  });
});

describe('the stitching rule', () => {
  const piece = (id: string, start: number, minutes: number, sourceKey: string = RING, version = 1): SourcedRecord => {
    const rec = ringRecords([sleepEvent([start, minutes])], ringCtx).records.find((r): r is SleepRecord => r.kind === 'sleep')!;
    return { sourceKey, record: { ...rec, record_id: id, version } };
  };

  it('joins pieces less than an hour apart and splits at an hour', () => {
    const end = at('10T01:00');
    const joined = reconcileSleep([piece('a', at('10T00:00'), 60), piece('b', end + NIGHT_GAP_MS - MIN, 30)]);
    expect(joined.map((e) => e.record.record_id)).toEqual(['a']);
    expect((joined[0]!.record as SleepRecord).time.end).toBe(new Date(end + NIGHT_GAP_MS + 29 * MIN).toISOString());
    expect(reconcileSleep([piece('a', at('10T00:00'), 60), piece('b', end + NIGHT_GAP_MS, 30)]).map((e) => e.record.record_id)).toEqual(['a', 'b']);
  });

  it('never joins two sources, and leaves a lone piece exactly as stored', () => {
    const a = piece('a', at('10T00:00'), 60);
    const b = piece('b', at('10T01:05'), 30, 'synthetic-watch');
    const out = reconcileSleep([a, b]);
    expect(out).toEqual([a, b]);
    expect(out[0]).toBe(a);
  });

  it('keeps the id of the earliest piece and the newest version of the pieces', () => {
    const out = reconcileSleep([piece('later', at('10T01:05'), 30, RING, 900), piece('earliest', at('10T00:00'), 60, RING, 5)]);
    expect(out).toHaveLength(1);
    expect(out[0]!.record).toMatchObject({ record_id: 'earliest', version: 900 });
  });

  it('recomputes the main night where pieces were stitched: stored flags were set piece by piece', () => {
    const night = [piece('n1', at('09T22:00'), 50), piece('n2', at('09T22:55'), 50), piece('n3', at('09T23:50'), 50)];
    const second = piece('s1', at('10T03:00'), 70);
    for (const p of night) (p.record as SleepRecord).is_main = false;
    (second.record as SleepRecord).is_main = true;
    const d = day([...night, second], '2026-03-10')!;
    expect(d.mainSleep!.record_id).toBe('n1');
    expect(d.sleeps.map((s) => [s.record_id, s.is_main])).toEqual([['n1', true], ['s1', false]]);
  });

  it('leaves sessions without stages and entries by hand alone', () => {
    const bare = (id: string, start: number): SourcedRecord => {
      const p = piece(id, start, 30);
      const { stages: _drop, ...rec } = p.record as SleepRecord;
      return { ...p, record: rec as SleepRecord };
    };
    expect(reconcileSleep([bare('x', at('10T00:00')), bare('y', at('10T00:40'))]).map((e) => e.record.record_id)).toEqual(['x', 'y']);
    const manual = (id: string, start: number): SourcedRecord => {
      const p = piece(id, start, 30, 'manual');
      return { ...p, record: { ...p.record, provenance: { ...p.record.provenance, channel: 'manual' } } };
    };
    expect(reconcileSleep([manual('m1', at('10T00:00')), manual('m2', at('10T00:40'))]).map((e) => e.record.record_id)).toEqual(['m1', 'm2']);
  });
});

describe('only the latest version of a record shapes a night', () => {
  const complete = (id: string, start: number, minutes: number, version: number): SourcedRecord => {
    const ev: RingEvent = { type: 'sleepEpochs', start, epochS: 60, stages: Array(minutes).fill('light'), rawCodes: [], firmware: 'V0525', complete: true };
    const rec = ringRecords([ev], ringCtx).records.find((r): r is SleepRecord => r.kind === 'sleep')!;
    return { sourceKey: RING, record: { ...rec, record_id: id, version } };
  };

  it('an older, longer version does not join pieces its latest version is far from', () => {
    const old = complete('x', at('10T00:00'), 180, 1);
    const latest = complete('x', at('10T00:00'), 60, 2);
    const y = complete('y', at('10T03:30'), 30, 1);
    const out = reconcileSleep([old, latest, y]);
    expect(out).toEqual([old, latest, y]);
    expect(day([latest, y], '2026-03-10')!.sleeps.map((s) => s.record_id)).toEqual(['x', 'y']);
  });

  it('an older version never takes the main night from a stitched one', () => {
    const p = complete('p', at('10T00:00'), 60, 1);
    const q = complete('q', at('10T01:10'), 50, 1);
    const old = complete('x', at('10T10:00'), 480, 1);
    const latest = complete('x', at('10T10:00'), 30, 2);
    const out = reconcileSleep([p, q, old, latest]).map((e) => e.record as SleepRecord);
    expect(out.map((r) => [r.record_id, r.version, r.is_main])).toEqual([['p', 1, true], ['x', 1, (old.record as SleepRecord).is_main], ['x', 2, false]]);
  });
});

describe('writers read the stored pieces, never the stitched view', () => {
  it('the Lumen main-night recompute re-writes a piece as it was stored (A, B stitched to S, then a longer C)', async () => {
    const store = new InMemoryBioStore();
    const message = async (start: number, minutes: number) => {
      const r = mapLumenEvents([lumenEvent([start, minutes], Array(minutes).fill('light'))], { tz: 'UTC', now: READ_AT, channel: 'mqtt:lumen' });
      await ingestLumenBatches([r.batch], store, { now: READ_AT });
    };
    await message(at('09T22:00'), 60); // A: wakes 23:00, a night of the 9th on its own
    await message(at('09T23:10'), 60); // B: 10 minutes later, wakes 00:10; with A the night S of the 10th
    await message(at('10T03:00'), 300); // C: longer than S on the 10th, so S is no longer the main night
    const raw = (await store.records({ kind: 'sleep', raw: true })).map((e) => e.record as SleepRecord);
    // every stored piece keeps its own shape; only is_main and the version move
    expect(raw.map((r) => [clock(r.time.start), clock(r.time.end), r.time.local_date, r.asleep_s / 60, r.stages!.length])).toEqual([
      ['22:00', '23:00', '2026-03-09', 60, 1], ['23:10', '00:10', '2026-03-10', 60, 1], ['03:00', '08:00', '2026-03-10', 300, 1],
    ]);
    // the view still shows S and C, C the main night of the 10th
    const d = day((await store.records({ kind: 'sleep' })).map((e) => ({ sourceKey: e.sourceKey, record: e.record })), '2026-03-10')!;
    expect(d.sleeps.map(shape)).toEqual([
      { bed: '22:00', wake: '00:10', date: '2026-03-10', asleepMin: 120, main: false },
      { bed: '03:00', wake: '08:00', date: '2026-03-10', asleepMin: 300, main: true },
    ]);
  });
});
