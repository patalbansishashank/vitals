// @vitest-environment node
/**
 * r068 B1: "Steps by source" read Ring "No reading" on a day the ring counted 10,621 steps. The owner's real shape
 * (2026-10-28, read-only from the server): the ring's minute detail runs on the ring's own clock, 19 s past every
 * wall-clock minute (`start` 12:58:19, `duration_s` 60, `support: minute`), and a phone counter span (8 steps,
 * 12:57:58–13:54:54) lay across a 46-minute walk of ~4,100 ring steps with a 6-minute hole in the ring's detail.
 *
 * Before: every straddling ring minute counted as coarse, so the timeline's ring lane was empty, nothing of the ring
 * reached `selected`, and the counter span's component went to the phone by coverage (the ring "partial"): located 6,643
 * of the ring's 10,705, the walk lost. After: the ring's minutes sit on the wall-clock minute, the walk is the ring's, and
 * the day's figures agree: ring lane = the ring's track, residual = daily total − track, located = the selected minutes.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INSTALL, activityDaily, phoneAcquisition, phoneSteps, ringSteps, type LumenTestEvent } from './lumenFixtures.ts';
import { lumenToolSet, type LumenToolSet } from './lumenTools.ts';
import { openLumenStore, type LumenStore } from './lumenStore.ts';
import { alignMinuteDetail, fusedDays, fuseSteps, type DayInput, type StepRecord } from './stepFusion.ts';

const MIN = 60_000;
const DATE = '2026-10-28';
const TZ = 'Asia/Kolkata';
const ist = (hms: string) => Date.parse(`${DATE}T${hms}+05:30`);
const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
const sum = (xs: ReadonlyArray<number | null>) => xs.reduce<number>((a, x) => a + (x ?? 0), 0);

/** The walk as the ring gave it: 12:58:19 + k·60 s, the 6-minute hole 13:48:19–13:54:19, zeros after it. */
const WALK = [84, 98, 101, 67, 103, 102, 100, 95, 78, 98, 61, 101, 82, 87, 69, 53, 57, 84, 95, 89, 62, 57, 93, 39, 97, 106, 94, 41, 97, 114, 106, 93, 104, 111, 100, 104, 110, 106, 104, 94, 82, 93, 71, 63, 110, 56, 0, 0, 0, 0];
const walkMinutes = () => [
  ...WALK.map((steps, k) => ({ start: ist('12:58:19') + k * MIN, steps })),
  ...[14, 79, 0, 0, 0, 0].map((steps, k) => ({ start: ist('13:54:19') + k * MIN, steps })),
];
const RING_WALK = sum(walkMinutes().map((m) => m.steps));

describe('r068 B1: steps-fuse/1 on the ring\'s own clock (pure)', () => {
  const ring = (start: number, steps: number, id = `r${start}`): StepRecord => ({ id, lineage: 'ring', source: 'ring:d5ca29676b093986', startMs: start, endMs: start + MIN, steps, support: 'minute' });
  const counterSpan: StepRecord = { id: 'p-span', lineage: 'phone', source: 'phone:counter', startMs: ist('12:57:58'), endMs: ist('13:54:54'), steps: 8, support: 'counterSpan' };
  const records = () => [...walkMinutes().map((m) => ring(m.start, m.steps)), counterSpan];

  it('alignMinuteDetail: a 60 s minute at :19 sits on the wall-clock minute holding most of it; nothing else moves', () => {
    const out = alignMinuteDetail([ring(ist('12:58:19'), 84), ring(ist('12:59:19'), 98), { ...counterSpan }]);
    expect(out.map((r) => [r.startMs, r.endMs])).toEqual([[counterSpan.startMs, counterSpan.endMs], [ist('12:58:00'), ist('12:59:00')], [ist('12:59:00'), ist('13:00:00')]]);
    // :45 past: most of it is in the next minute
    expect(alignMinuteDetail([ring(ist('12:58:45'), 5)])[0]).toMatchObject({ startMs: ist('12:59:00'), endMs: ist('13:00:00') });
    // a short record keeps its length; one that would meet a neighbour it did not meet stays as it came
    const a: StepRecord = { ...ring(0, 3), startMs: ist('12:58:50'), endMs: ist('12:59:20') };
    const b: StepRecord = { ...ring(0, 4, 'b'), startMs: ist('12:59:21'), endMs: ist('12:59:40') };
    expect(alignMinuteDetail([a, b]).map((r) => [r.startMs, r.endMs])).toEqual([[a.startMs, a.endMs], [b.startMs, b.endMs]]);
    const c: StepRecord = { ...ring(0, 3), startMs: ist('12:58:50'), endMs: ist('12:59:20') };
    expect(alignMinuteDetail([c])[0]).toMatchObject({ startMs: ist('12:59:00'), endMs: ist('12:59:30') });
  });

  it('the walk is the ring\'s, minute by minute: every minute placed, located = the ring\'s steps', () => {
    const f = fuseSteps(records());
    const ringTrack = f.tracks.get('ring')!;
    expect(ringTrack.every((r) => r.startMs % MIN === 0 && r.endMs - r.startMs === MIN)).toBe(true);
    const unit = f.intervals.find((u) => u.unit === 'component')!;
    // the span's component reaches 13:54:54: the ring's 13:55 minute (79) is its own minute unit after it
    expect(unit).toMatchObject({ lineage: 'ring', steps: RING_WALK - 79, selectionReason: 'preference', placed: true, disagreement: true });
    expect(sum(f.intervals.map((u) => u.steps))).toBe(RING_WALK);
    expect(unit.alternatives).toEqual([{ source: 'phone:counter', lineage: 'phone', steps: 8, support: 'counterSpan' }]);
    expect(sum([...f.minuteSelected.values()].map((v) => v.steps))).toBe(RING_WALK);
    expect(f.minuteSelected.get(ist('13:00:00'))).toEqual({ steps: 101, lineage: 'ring', source: 'ring:d5ca29676b093986' });
  });

  it('without the ring\'s clock fix the partial-witness rule alone still keeps a 4,000-step walk from an 8-step counter span', () => {
    // the ring's detail aligned, but covering only part of the span (the hole): partial, yet it counted more than the span
    const f = fuseSteps([...walkMinutes().slice(0, 30).map((m) => ring(Math.floor(m.start / MIN) * MIN, m.steps)), counterSpan]);
    expect(f.intervals.find((u) => u.unit === 'component')).toMatchObject({ lineage: 'ring', selectionReason: 'preference' });
    // a partial witness that counted less than the whole one still never stands for the unit (r063 A3)
    const g = fuseSteps([ring(ist('13:00:00'), 20), { ...counterSpan, steps: 900 }]);
    expect(g.intervals[0]).toMatchObject({ lineage: 'phone', steps: 900, selectionReason: 'coverage' });
  });

  it('the day: located = ring + phone-only steps, residual = daily total − the ring\'s track, never added', () => {
    const f = fuseSteps(records());
    const dayStart = ist('00:00:00');
    const day: DayInput = { date: DATE, startMs: dayStart, endMs: dayStart + 1440 * MIN, ringDailyTotal: RING_WALK + 84, ringDetailComplete: false };
    expect(fusedDays(f, [day])[0]).toMatchObject({ located: RING_WALK, ringResidual: 84, headline: RING_WALK + 84, headlinePolicy: 'atLeast' });
  });

  it('two overlapping series from the ring (:19 and a re-anchored :59 of zeros) keep the same records as before', () => {
    const s19 = Array.from({ length: 10 }, (_, k) => ring(ist('12:02:19') + k * MIN, 90 + k, `a${k}`));
    const s59 = Array.from({ length: 10 }, (_, k) => ring(ist('12:02:59') + k * MIN, 0, `b${k}`));
    const f = fuseSteps([...s59, ...s19]);
    const track = f.tracks.get('ring')!;
    expect(track.map((r) => r.id)).toEqual(s19.map((r) => r.id));
    expect(sum(track.map((r) => r.steps))).toBe(sum(s19.map((r) => r.steps)));
    expect(track.every((r) => r.startMs % MIN === 0)).toBe(true);
  });
});

describe('r068 B1: through the store (gauge_steps, gauge_timeline)', () => {
  let dir: string;
  let store: LumenStore;
  let tools: LumenToolSet;
  const NOW = ist('16:30:00');
  /** The parts of the answers these tests read. */
  type Answer = {
    steps: { ring: Array<number | null>; selected: Array<number | null>; support: Array<string | null>; coarse: Array<{ parts: Array<{ steps: number }> }>; phoneCoarse: unknown[]; ringCoarse: unknown[] };
    days: Array<{ located: number; ringResidual: number; headline: number; headlinePolicy: string }>;
  };
  const run = async (name: string, args: Record<string, unknown>) => (await tools.call(name, args)) as unknown as { ok: boolean; data: Answer };

  beforeAll(() => {
    dir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'r068-b1-'));
    store = openLumenStore(join(dir, 'lumen.db'));
    store.noteInstallation(INSTALL, { deviceName: 'Pixel', appVersion: '2.8.1', pairedAt: '2026-10-01T00:00:00.000Z' });
    const ev: LumenTestEvent[] = [];
    // the morning: ring minutes at :19 (a few steps), the walk, the phone's counter span and a few phone seconds
    for (let k = 0; k < 15; k++) ev.push(ringSteps(iso(ist('09:10:19') + k * MIN), k % 3 === 0 ? 12 : 0, { parentStart: iso(ist('09:10:19')) }));
    for (const m of walkMinutes()) ev.push(ringSteps(iso(m.start), m.steps, { parentStart: iso(ist('12:58:19')) }));
    ev.push(phoneSteps(iso(ist('12:57:58')), iso(ist('13:54:54')), 8));
    for (let k = 0; k < 20; k++) ev.push(phoneSteps(iso(ist('13:54:54') + k * 1000), iso(ist('13:54:55') + k * 1000), 1));
    ev.push(phoneAcquisition(iso(ist('12:30:00')), iso(ist('13:30:00')), 'listening'), phoneAcquisition(iso(ist('13:30:00')), iso(ist('14:30:00')), 'listening'));
    ev.push(activityDaily(iso(ist('16:00:00')), 10_705));
    const r = store.ingest(INSTALL, ev, NOW);
    expect(r.rejected).toEqual([]);
    tools = lumenToolSet(() => store, TZ, () => NOW);
  });
  afterAll(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('gauge_timeline: the ring lane holds every ring step, minute by minute; the selected minutes are the ring\'s', async () => {
    const t = (await run('gauge_timeline', { date: DATE })).data;
    const ringSteps = 5 * 12 + RING_WALK;
    expect(sum(t.steps.ring)).toBe(ringSteps);
    expect(t.steps.ring.filter((v: number | null) => v !== null)).toHaveLength(15 + walkMinutes().length);
    // 13:00 local is minute 780 of the day: the ring's 13:00:19–13:01:19 record (101 steps) sits there
    expect(t.steps.ring[780]).toBe(101);
    expect(t.steps.selected[780]).toBe(101);
    expect(t.steps.support[780]).toBe('minute');
    // the counter span is the phone's own coarse record, whole
    expect(t.steps.phoneCoarse).toEqual([expect.objectContaining({ steps: 8, support: 'counterSpan' })]);
    expect(t.steps.ringCoarse).toEqual([]);
    const placedOrMinute = sum(t.steps.selected) + sum(t.steps.coarse.flatMap((c) => c.parts.map((p) => p.steps)));
    const steps = (await run('gauge_steps', { from: DATE, to: DATE })).data;
    expect(placedOrMinute).toBe(steps.days[0]!.located);
  });

  it('gauge_steps: located holds the walk; the residual is the daily total less the ring\'s track; the headline is explained', async () => {
    const d = (await run('gauge_steps', { from: DATE, to: DATE })).data.days[0]!;
    const ringTrack = 5 * 12 + RING_WALK;
    expect(d.located).toBeGreaterThanOrEqual(ringTrack);
    expect(d.ringResidual).toBe(10_705 - ringTrack);
    expect(d.headline).toBe(10_705);
    expect(d.headlinePolicy).toBe('atLeast');
  });
});
