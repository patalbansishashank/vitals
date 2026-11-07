// @vitest-environment node
/**
 * r063 CORE (audit FIXLIST "CORE"): the timeline's step support (S1) and full empty shape (S5), the person's stored
 * fusion context used by every fused read (S6/A2), detector-registered observed zeros (A9), coalesced command ids as
 * durable aliases (A35), the change feed of imported actuals (S13/A6) and Health Connect HR, speed and power joined into
 * the timeline with their lineage (S16/A19). The fusion probes (A3, A8) are in `stepFusion.test.ts`.
 */
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openCommandStore } from './commandStore.ts';
import { createFusionContextStore } from './fusionContext.ts';
import { deletion, hcDeleted, hcRecord, hr, INSTALL, phoneAcquisition, phoneSteps, ringSteps, workout } from './lumenFixtures.ts';
import { openLumenStore } from './lumenStore.ts';
import { lumenToolSet } from './lumenTools.ts';

const TMP = process.env.TMPDIR ?? '/tmp';
const NOW = Date.parse('2026-10-21T04:00:00Z');
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const f of cleanup.splice(0).reverse()) f();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- answers are read field by field
type Json = Record<string, any>;

function setup() {
  const dir = mkdtempSync(join(TMP, 'r063-core-'));
  const store = openLumenStore(join(dir, 'lumen.db'));
  const fc = createFusionContextStore(() => join(dir, 'fusion-context.json'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }), () => store.close());
  const tools = lumenToolSet(() => store, 'Asia/Kolkata', () => NOW, () => fc.get('p'));
  const run = async (name: string, args: Record<string, unknown>) => {
    const env = await tools.call(name, args);
    expect(env.ok, JSON.stringify(env.error ?? null)).toBe(true);
    return env.data as Json;
  };
  const ingest = (events: unknown[]) => {
    const r = store.ingest(INSTALL, events, NOW);
    expect(r.rejected).toEqual([]);
  };
  return { dir, store, fc, run, ingest };
}

const minutes = (fromIso: string, n: number, steps: number) => Array.from({ length: n }, (_, k) => ringSteps(new Date(Date.parse(fromIso) + k * 60_000).toISOString(), steps));
/** The minute index of an instant in the Kolkata day 2026-10-20 (starts 2026-10-19T18:30Z). */
const idx = (iso: string) => Math.round((Date.parse(iso) - Date.parse('2026-10-19T18:30:00Z')) / 60_000);

describe('S1 / S5: the timeline carries per-minute step support and always its full shape', () => {
  it('S1: minute units are `minute`, a coarse unit\'s minutes `coarse`, nothing selected null', async () => {
    const t = setup();
    t.ingest([...minutes('2026-10-20T04:00:00.000Z', 5, 110), phoneSteps('2026-10-20T06:00:00Z', '2026-10-20T06:20:00Z', 1500, { support: 'counterSpan', timing: 'counter' })]);
    const d = await t.run('gauge_timeline', { date: '2026-10-20' });
    const i = idx('2026-10-20T04:00:00Z');
    expect(d.steps.selected.slice(i, i + 5)).toEqual([110, 110, 110, 110, 110]);
    expect(d.steps.support.slice(i, i + 5)).toEqual(['minute', 'minute', 'minute', 'minute', 'minute']);
    const j = idx('2026-10-20T06:00:00Z');
    expect(d.steps.support.slice(j, j + 20).every((x: unknown) => x === 'coarse')).toBe(true);
    expect(d.steps.selected[j]).toBeNull();
    expect(d.steps.support[0]).toBeNull();
    expect(d.steps.support).toHaveLength(d.minutes);
  });

  it('S5: with no store the timeline answers every per-minute array, null-filled', async () => {
    const tools = lumenToolSet(() => null, 'Asia/Kolkata', () => NOW);
    const env = await tools.call('gauge_timeline', { date: '2026-10-20' });
    expect(env.ok).toBe(true);
    const d = env.data as Json;
    expect(d.minutes).toBe(1440);
    for (const a of [d.steps.selected, d.steps.support, d.steps.source, d.steps.ring, d.steps.phone, d.hr.bpm, d.hr.sampledBpm, d.hr.source, d.sleep.stage, d.acquisition.ring, d.acquisition.phone]) {
      expect(a).toHaveLength(1440);
      expect(a.every((x: unknown) => x === null)).toBe(true);
    }
    // supported seconds are a count (0 where nothing is supported), as on a day with data
    expect(d.hr.supportedS.every((x: unknown) => x === 0)).toBe(true);
    expect(d).toMatchObject({ sessions: [], hcExercise: [], steps: { coarse: [] }, stress: { readings: [] } });
  });
});

describe('S6 / A2: one contextual fusion result for every consumer', () => {
  /** 20 min of ring arm swings at 100/min from 04:00Z while the phone listened (detector timing) and counted nothing. */
  const mudgar = () => [
    ...minutes('2026-10-20T04:00:00.000Z', 20, 100),
    phoneAcquisition('2026-10-20T03:50:00Z', '2026-10-20T04:30:00Z', 'listening'),
    phoneSteps('2026-10-20T03:51:00Z', '2026-10-20T03:52:00Z', 4),
  ];
  const bout = { start: '2026-10-20T09:30:00+05:30', end: '2026-10-20T09:50:00+05:30', kind: 'nonLocomotor' };

  it('the stored context reaches the timeline, steps, activity and the day summary; explicit context still wins; the hash names it', async () => {
    const t = setup();
    t.ingest(mudgar());
    const i = idx('2026-10-20T04:05:00Z');
    const before = { tl: await t.run('gauge_timeline', { date: '2026-10-20' }), steps: await t.run('gauge_steps', { from: '2026-10-20', to: '2026-10-20' }), act: await t.run('gauge_activity', { from: '2026-10-20', to: '2026-10-20' }) };
    expect(before.tl.steps.selected[i]).toBe(100);
    expect(before.steps.days[0].located).toBe(2004);
    t.fc.put('p', { windowStartMs: Date.parse('2026-10-19T18:30:00Z'), windowEndMs: Date.parse('2026-10-20T18:30:00Z'), activities: [{ startMs: Date.parse(bout.start), endMs: Date.parse(bout.end), kind: 'nonLocomotor' }], corrections: [] }, NOW);
    const tl = await t.run('gauge_timeline', { date: '2026-10-20' });
    const steps = await t.run('gauge_steps', { from: '2026-10-20', to: '2026-10-20' });
    const act = await t.run('gauge_activity', { from: '2026-10-20', to: '2026-10-20' });
    const daily = await t.run('gauge_daily_summary', { date: '2026-10-20' });
    expect(tl.steps.selected[i]).toBe(0);
    expect(tl.steps.source[i]).toBe('phone');
    expect(steps.days[0].located).toBe(4);
    expect(act.days[0].fusedLocated).toBe(4);
    expect(daily.activity.fusedLocated).toBe(4);
    // the same as the explicit context the import posts
    const explicit = await t.run('gauge_steps', { from: '2026-10-20', to: '2026-10-20', tz: 'Asia/Kolkata', activities: [bout] });
    expect(explicit.days).toEqual(steps.days);
    expect(explicit.intervals).toEqual(steps.intervals);
    expect(explicit.inputsHash).toBe(steps.inputsHash);
    // every hash (so every ETag) changed with the context
    expect(tl.inputsHash).not.toBe(before.tl.inputsHash);
    expect(steps.inputsHash).not.toBe(before.steps.inputsHash);
    expect(act.inputsHash).not.toBe(before.act.inputsHash);
    // an explicit (empty) context is not overridden by the stored one
    const none = await t.run('gauge_steps', { from: '2026-10-20', to: '2026-10-20', activities: [] });
    expect(none.days[0].located).toBe(2004);
  });

  it('the store: replaces only what starts in the window, keeps the rest, writes 0600 and only on change; revision follows content', () => {
    const dir = mkdtempSync(join(TMP, 'r063-fc-'));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, 'p', 'fusion-context.json');
    const fc = createFusionContextStore(() => file);
    const day = (d: number) => Date.parse('2026-10-01T00:00:00Z') + d * 86_400_000;
    const a = (d: number, kind: 'locomotor' | 'nonLocomotor' = 'nonLocomotor') => ({ startMs: day(d) + 3_600_000, endMs: day(d) + 7_200_000, kind });
    const first = fc.put('p', { windowStartMs: day(0), windowEndMs: day(10), activities: [a(1), a(5), a(9)], corrections: [] }, day(12));
    expect(first.changed).toBe(true);
    expect((statSync(file).mode & 0o777).toString(8)).toBe('600');
    // a later post of days 8–10 only: days 1 and 5 stay, day 9 is replaced by the new list
    const second = fc.put('p', { windowStartMs: day(8), windowEndMs: day(11), activities: [a(10, 'locomotor')], corrections: [], preference: ['phone', 'ring', 'hc-other', 'unknown'] }, day(12));
    expect(second.context.activities.map((x) => x.startMs)).toEqual([a(1).startMs, a(5).startMs, a(10).startMs]);
    expect(second.context.preference).toEqual(['phone', 'ring', 'hc-other', 'unknown']);
    const again = fc.put('p', { windowStartMs: day(8), windowEndMs: day(11), activities: [a(10, 'locomotor')], corrections: [] }, day(12));
    expect(again).toMatchObject({ changed: false, revision: second.revision });
    // a fresh process reads the file back
    expect(createFusionContextStore(() => file).get('p')?.revision).toBe(second.revision);
    // an item outside the window is ignored; old items are pruned
    const pruned = fc.put('p', { windowStartMs: day(20), windowEndMs: day(21), activities: [a(1)], corrections: [] }, day(11) + 401 * 86_400_000);
    expect(pruned.context.activities).toEqual([]);
  });
});

describe('r063: the activity carry (ACT-A) reaches fusion through the context, and its hash', () => {
  it('desk or hand: the ring while walking; pocket: the phone\'s gait; a bad carry is refused', async () => {
    const t = setup();
    // a walk 04:00–04:10Z: the ring 100/min, the phone counted 30/min
    t.ingest([...minutes('2026-10-20T04:00:00.000Z', 10, 100), ...Array.from({ length: 10 }, (_, k) => phoneSteps(new Date(Date.parse('2026-10-20T04:00:00Z') + k * 60_000).toISOString(), new Date(Date.parse('2026-10-20T04:01:00Z') + k * 60_000).toISOString(), 30))]);
    const bout = (carry?: string) => [{ start: '2026-10-20T09:30:00+05:30', end: '2026-10-20T09:40:00+05:30', kind: 'locomotor', ...(carry ? { carry } : {}) }];
    const located = async (carry?: string) => (await t.run('gauge_steps', { from: '2026-10-20', to: '2026-10-20', activities: bout(carry) }));
    const plain = await located();
    const desk = await located('desk');
    // Unknown carry does not make the phone's 30/min authoritative over the ring's sustained 100/min gait.
    expect(plain.days[0].located).toBe(1000);
    expect(desk.days[0].located).toBe(1000);
    expect((await located('hand')).days[0].located).toBe(1000);
    expect((await located('pocket')).days[0].located).toBe(300);
    expect(desk.inputsHash).not.toBe(plain.inputsHash);
    expect((await lumenToolSet(() => t.store, 'UTC').call('gauge_steps', { from: '2026-10-20', to: '2026-10-20', activities: bout('backpack') })).error?.code).toBe('invalid_input');
  });
});

describe('A9: detector-registered acquisition makes observed zeros without a step record', () => {
  const ring = () => minutes('2026-10-20T04:00:00.000Z', 20, 100);
  const acq = (data: Record<string, unknown>) => {
    const e = phoneAcquisition('2026-10-20T04:00:00Z', '2026-10-20T05:00:00Z', 'listening') as unknown as { data: Record<string, unknown> };
    return { ...e, id: `${(e as unknown as { id: string }).id}-${JSON.stringify(data).length}`, data: { ...e.data, ...data } };
  };
  const at = async (t: ReturnType<typeof setup>) => (await t.run('gauge_steps', { from: '2026-10-20', to: '2026-10-20' })).intervals.find((u: Json) => Date.parse(u.start) <= Date.parse('2026-10-20T04:05:00Z') && Date.parse(u.end) > Date.parse('2026-10-20T04:05:00Z'));

  it('Gauge 2.8.1 `observed_zero: true` (detector registered): the stationary phone is observed zero with no step record', async () => {
    for (const data of [{ detector: 'registered', observed_zero: true }]) {
      const t = setup();
      t.ingest([...ring(), acq(data)]);
      expect(await at(t)).toMatchObject({ lineage: 'ring', selectionReason: 'soleSustainedGait' });
      expect((await at(t)).alternatives).toContainEqual(expect.objectContaining({ lineage: 'phone', steps: 0 }));
    }
  });

  it('absent or failed detector, or no declaration: the earlier rule (zeros only where a detector-timed record overlaps)', async () => {
    for (const data of [{ detector: 'absent', observed_zero: false }, { detector: 'failed', observed_zero: false }, {}]) {
      const t = setup();
      t.ingest([...ring(), acq(data)]);
      expect(await at(t), JSON.stringify(data)).toMatchObject({ lineage: 'ring', selectionReason: 'soleObserved' });
      const u = setup();
      u.ingest([...ring(), acq(data), phoneSteps('2026-10-20T04:30:00Z', '2026-10-20T04:31:00Z', 3)]);
      expect(await at(u), JSON.stringify(data)).toMatchObject({ lineage: 'ring', selectionReason: 'soleSustainedGait' });
    }
  });

  it('every phone record removes its minutes from the zeros, a counter span too', async () => {
    const t = setup();
    t.ingest([...ring(), acq({ detector: 'registered', observed_zero: true }), phoneSteps('2026-10-20T04:00:00Z', '2026-10-20T04:10:00Z', 900, { support: 'counterSpan', timing: 'counter' })]);
    // 04:00–04:10 is the counter span's coarse unit, never a zero; 04:10–04:20 the phone observed nothing
    const u = (await t.run('gauge_steps', { from: '2026-10-20', to: '2026-10-20' })).intervals.find((x: Json) => Date.parse(x.start) <= Date.parse('2026-10-20T04:15:00Z') && Date.parse(x.end) > Date.parse('2026-10-20T04:15:00Z'));
    expect(u.alternatives).toContainEqual(expect.objectContaining({ lineage: 'phone', steps: 0 }));
    const tl = await t.run('gauge_timeline', { date: '2026-10-20' });
    expect(tl.steps.phone[idx('2026-10-20T04:05:00Z')]).toBeNull();
  });
});

describe('A35: a coalesced request id is a durable alias of the command it joined', () => {
  it('lookup, retry after completion, cancel and a different body', () => {
    const dir = mkdtempSync(join(TMP, 'r063-cmd-'));
    const s = openCommandStore(join(dir, 'commands.db'));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }), () => s.close());
    const base = { type: 'hr.measure' as const, payload: {}, installationId: 'inst-00000001', deviceId: 'dev', ttlS: 60 };
    const A = 'AAAAAAAAAAAAAAAAAAAA';
    const B = 'BBBBBBBBBBBBBBBBBBBB';
    expect(s.enqueue({ ...base, id: A }, NOW).kind).toBe('created');
    const b = s.enqueue({ ...base, id: B }, NOW + 1000);
    expect(b).toMatchObject({ kind: 'coalesced', command: { id: A } });
    expect(s.get(B)?.id).toBe(A);
    // A finishes; the lost response of B is retried: still A, never a second measurement
    s.takeForPoll('inst-00000001', NOW + 2000);
    expect(s.ack(A, 'inst-00000001', { status: 'done', result: { bpm: 60 } }, NOW + 3000)).toBe('ok');
    expect(s.enqueue({ ...base, id: B }, NOW + 4000)).toMatchObject({ kind: 'coalesced', command: { id: A, state: 'done' } });
    expect(s.list({ limit: 10 })).toHaveLength(1);
    // the alias can never name another command
    expect(s.enqueue({ ...base, id: B, type: 'update.check', ttlS: 3600 }, NOW + 5000).kind).toBe('id_reused');
    // a new id after completion is a new command
    expect(s.enqueue({ ...base, id: 'CCCCCCCCCCCCCCCCCCCC' }, NOW + 6000).kind).toBe('created');
    expect(s.cancel(B, NOW + 7000)).toBe('already_delivered');
    // the alias outlives a reopen and is purged with its command
    s.sweep(NOW + 31 * 86_400_000);
    expect(s.get(B)).toBeNull();
  });
});

describe('S13 / A6: the change feed of imported actuals', () => {
  it('no cursor: the head and resync; then revisions and deletions of workouts, HC sessions and weights, never others', async () => {
    const t = setup();
    t.ingest([workout('w-1', '2026-10-20T01:15:00Z'), hcRecord('ExerciseSession', 'hc-ex-1', '2026-10-20T02:00:00Z', '2026-10-20T02:30:00Z', { exercise_type: 56, segments: [], laps: [], route_state: 'none' }, { origin: 'com.strava' }), hr('2026-10-20T01:00:00Z', 60)]);
    const head = await t.run('gauge_changes', {});
    expect(head).toMatchObject({ resync: true, changes: [], more: false });
    expect(head.cursor).toMatch(/^c1\.\d+\.\d+$/);
    // nothing new
    expect((await t.run('gauge_changes', { since: head.cursor })).changes).toEqual([]);
    // a revision, a tombstone, a weight, a Gauge deletion of the workout, and unrelated HR
    t.ingest([
      hcRecord('ExerciseSession', 'hc-ex-1', '2026-10-20T02:00:00Z', '2026-10-20T02:40:00Z', { exercise_type: 56, segments: [], laps: [], route_state: 'none' }, { origin: 'com.strava', lastModified: '2026-10-20T03:00:00Z' }),
      hcRecord('Weight', 'hc-w-1', '2026-10-20T03:00:00Z', '2026-10-20T03:00:00Z', { kg: 80 }, { origin: 'com.withings' }),
      hr('2026-10-20T03:00:00Z', 70),
    ]);
    const p1 = await t.run('gauge_changes', { since: head.cursor });
    expect(p1.changes.map((c: Json) => [c.kind, c.ref, c.change])).toEqual([['hcExercise', 'hc:hc-ex-1', 'revised'], ['hcWeight', 'hc:hc-w-1', 'revised']]);
    expect(p1.changes[0].end).toBe('2026-10-20T08:10:00+05:30');
    t.ingest([hcDeleted('ExerciseSession', 'hc-ex-1', '2026-10-20T05:00:00Z'), deletion('2026-10-21T03:00:00Z', { category: 'activity/session', kind: 'w-1', from: '2026-10-20T01:14:00Z', to: '2026-10-20T01:16:00Z' }, { receivedAt: '2026-10-21T03:00:00Z' })]);
    const p2 = await t.run('gauge_changes', { since: p1.cursor });
    expect(p2.changes.map((c: Json) => [c.kind, c.ref, c.change])).toEqual([['workout', 'gauge:w-1', 'deleted'], ['hcExercise', 'hc:hc-ex-1', 'deleted']]);
    expect(p2.changes[1].at).toBe('2026-10-20T10:30:00+05:30');
    expect(p2.more).toBe(false);
    // pages: a limit of one touched record per page walks the same changes
    const seen: string[] = [];
    let cursor = head.cursor;
    for (let k = 0; k < 10; k++) {
      const p = await t.run('gauge_changes', { since: cursor, limit: 1 });
      seen.push(...p.changes.map((c: Json) => `${c.ref}:${c.change}`));
      cursor = p.cursor;
      if (!p.more) break;
    }
    expect([...new Set(seen)].sort()).toEqual(['gauge:w-1:deleted', 'hc:hc-ex-1:deleted', 'hc:hc-w-1:revised']);
    // checks
    expect((await lumenToolSet(() => t.store, 'UTC').call('gauge_changes', { since: 'nope' })).error?.code).toBe('invalid_input');
    expect((await t.run('gauge_changes', { since: 'c1.999999999.0' })).resync).toBe(true);
  });
});

describe('S16 / A19: Health Connect HR, speed and power in the timeline with their lineage', () => {
  const samples = (fromIso: string, n: number, gapS: number, f: (k: number) => Record<string, number>) =>
    Array.from({ length: n }, (_, k) => ({ t: new Date(Date.parse(fromIso) + k * gapS * 1000).toISOString(), ...f(k) }));

  it('Gauge\'s HR first; Health Connect fills only minutes without it (one origin, inferred cadence), and every stream names its sources', async () => {
    const t = setup();
    const watch = { origin: 'com.garmin.android.apps.connectmobile', native: false, device: { type: 1, manufacturer: 'Garmin', model: 'Forerunner 265' } };
    const gaugeHr = Array.from({ length: 12 }, (_, k) => hr(new Date(Date.parse('2026-10-20T04:00:00Z') + k * 5000).toISOString(), 100));
    t.ingest([
      ...gaugeHr,
      // a watch's HR every 5 s over 04:00–04:03: the 04:00 minute is Gauge's, 04:01 and 04:02 Health Connect's
      hcRecord('HeartRate', 'hc-hr-1', '2026-10-20T04:00:00Z', '2026-10-20T04:03:00Z', { samples: samples('2026-10-20T04:00:00Z', 36, 5, () => ({ bpm: 120 })) }, watch),
      hcRecord('Speed', 'hc-sp-1', '2026-10-20T04:00:00Z', '2026-10-20T04:02:00Z', { samples: samples('2026-10-20T04:00:00Z', 4, 30, () => ({ mps: 2.5 })) }, watch),
      hcRecord('Power', 'hc-pw-1', '2026-10-20T04:00:00Z', '2026-10-20T04:01:00Z', { samples: samples('2026-10-20T04:00:00Z', 2, 30, () => ({ w: 180 })) }, watch),
    ]);
    const d = await t.run('gauge_timeline', { date: '2026-10-20' });
    const i = idx('2026-10-20T04:00:00Z');
    const g = 'hc:com.garmin.android.apps.connectmobile';
    // the watch's first reading (04:00:00) stands for half its cadence back into 03:59, which Gauge has no reading of
    expect(d.hr.source.slice(i - 1, i + 4)).toEqual([g, 'gauge', g, g, null]);
    expect(d.hr.sampledBpm.slice(i, i + 3)).toEqual([100, 120, 120]);
    // the watch's regular 5 s spacing is its cadence: supported time, so HR estimates can use it
    expect(d.hr.supportedS[i + 1]).toBe(60);
    expect(d.hr.bpm[i + 1]).toBe(120);
    expect(d.hc.speedMps.slice(i, i + 2)).toEqual([2.5, 2.5]);
    expect(d.hc.powerW[i]).toBe(180);
    expect(d.hc.speedSource[i]).toBe(g);
    expect(d.evidence.hr).toEqual([
      { source: 'gauge', minutes: 1, supportedS: 0 },
      expect.objectContaining({ source: g, lineage: 'hc-other:com.garmin.android.apps.connectmobile', minutes: 3, cadence: 'inferred', records: 1 }),
    ]);
    expect(d.evidence.power[0]).toMatchObject({ source: g, minutes: 1, verified: false });
  });

  it('without Health Connect samples nothing changes: hc null, evidence only Gauge', async () => {
    const t = setup();
    t.ingest([hr('2026-10-20T04:00:00Z', 70)]);
    const d = await t.run('gauge_timeline', { date: '2026-10-20' });
    expect(d.hc).toBeNull();
    expect(d.evidence).toEqual({ hr: [{ source: 'gauge', minutes: 1, supportedS: 0 }], speed: [], power: [] });
  });
});
