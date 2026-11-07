// @vitest-environment node
/**
 * r068 walk: an evening walk read about a third short. The owner's real shape (2026-10-28, 17:15–18:37 in Kolkata, read
 * only from the server and anonymised here: no device key, boot id or event id of the owner's):
 *
 * - The phone (Gauge 2.8.4): the counter reported about once a second with a delta of 1–4, and the step detector gave
 *   about one event a second (56–61 a minute while the counter read 92–99). Gauge cut each delta at wall-clock minutes and
 *   gave each piece the detector's count whenever it sat within `max(3, 10 %)` of the delta, so a delta of 2 went up as 1
 *   step (`parent_steps: 2`): 2,615 phone steps where the counter's deltas add up to 4,181 (3,837 over the brisk 40
 *   minutes, where the phone's own step app read 3,849). Ten quiet stretches came as counter spans (5–10 steps each).
 * - The ring: minute records 19 s past the minute (five 10-minute records), counting 0 in many walking minutes, and no
 *   record at all for 18:00–18:10 or 17:25–17:47: 1,293 steps in 50 minute records across 83 minutes.
 * - Fusion took the ring first minute by minute, its zeros included, and the phone only in the ring's holes.
 *
 * After: the server reads the detector-timed minutes at the counter's count (`counterScaledPhoneSteps`; Gauge 2.8.5 sends
 * them so), and the 40-minute bout the phone clearly out-counted the ring over is the phone's (`boutCount`).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { counterScaledPhoneSteps } from './gaugeDerive.ts';
import { INSTALL, phoneAcquisition, phoneSteps, ringSteps, type LumenTestEvent } from './lumenFixtures.ts';
import { lumenToolSet, type LumenToolSet } from './lumenTools.ts';
import { openLumenStore, type LumenStore } from './lumenStore.ts';
import { BOUT_MARGIN, fuseSteps, phoneBouts, type StepRecord, type TrackRecord } from './stepFusion.ts';

const MIN = 60_000;
const DATE = '2026-10-28';
const TZ = 'Asia/Kolkata';
const ist = (hms: string) => Date.parse(`${DATE}T${hms}+05:30`);
const iso = (ms: number) => new Date(ms).toISOString();
const sum = (xs: ReadonlyArray<number | null | undefined>) => xs.reduce<number>((a, x) => a + (x ?? 0), 0);
const _ = null;

// Wall-clock minutes from 17:15 to 18:37 (83). `null`: no record of that lineage in the minute.
/** The phone's counter, minute by minute (the deltas, each in the minute it was timed to). */
const PHONE = [1, 20, 62, 16, 15, 8, 3, 12, 0, 0, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, 11, 24, 9, _, _, 23, 45, 0, 0, 0,
  92, 95, 94, 97, 95, 97, 97, 99, 94, 96, 98, 97, 96, 97, 98, 95, 96, 98, 96, 95, 96, 98, 92, 94, 95, 96, 96, 94, 95, 99, 92, 94, 94, 98, 96, 97, 97, 98, 96, 98,
  23, 0, 0, 0, 0];
/** The step detector's events in the same minutes (what Gauge 2.8.4 uploaded as the minute's steps). */
const DETECTOR = [1, 16, 37, 8, 9, 7, 2, 12, 0, 0, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, 11, 17, 6, _, _, 17, 26, 0, 0, 0,
  59, 57, 57, 61, 57, 60, 58, 60, 57, 59, 59, 60, 58, 59, 58, 60, 57, 61, 60, 58, 58, 61, 58, 59, 59, 61, 60, 59, 60, 61, 57, 57, 56, 61, 59, 60, 59, 59, 60, 60,
  15, 0, 0, 0, 0];
/** The ring's minute records, by the wall-clock minute holding most of each (they start 19 s past it). */
const RING = [20, 19, 66, 22, 17, 11, 0, 12, 0, 0, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, 29, 45, 0, 0, 0,
  0, 0, 0, 0, 0, _, _, _, _, _, _, _, _, _, _, 22, 0, 64, 69, 0, 0, 51, 61, 94, 94, 17, 0, 0, 0, 84, 83, 81, 3, 10, 15, 85, 96, 74, 49,
  0, 0, 0, 0, 0, 0];
/** The ring's 10-minute records the minutes came in (their starts, local). */
const RING_PARENTS = ['17:15:19', '17:48:19', '18:08:19', '18:18:19', '18:28:19'];
/** The phone's counter spans (quiet stretches, timed by the counter alone), local. */
const COUNTER_SPANS: Array<[string, string, number]> = [
  ['16:47:30.387', '17:15:58.872', 10], ['17:16:29.721', '17:17:07.575', 10], ['17:20:28.317', '17:21:49.457', 7], ['17:21:51.448', '17:22:02.636', 9],
  ['17:22:39.466', '17:43:30.510', 7], ['17:44:56.522', '17:45:43.102', 5], ['17:45:51.054', '17:48:32.067', 10], ['17:49:53.620', '17:51:52.166', 6],
  ['17:51:52.166', '17:52:59.861', 8], ['18:34:13.603', '18:39:02.163', 10],
];
const W0 = ist('17:15:00');
const BOUT = [ist('17:53:00'), ist('18:33:00')] as const;
const PHONE_COUNTED = sum(PHONE);
const PHONE_DETECTED = sum(DETECTOR);
const RING_TOTAL = sum(RING);
const SPAN_TOTAL = sum(COUNTER_SPANS.map((c) => c[2]));
const minuteOf = (i: number) => W0 + i * MIN;
const between = (xs: ReadonlyArray<number | null>, from: number, to: number) => sum(xs.slice((from - W0) / MIN, (to - W0) / MIN));

/**
 * The phone's detector-timed pieces as Gauge 2.8.4 sent them: each counter delta its own short span (about a second, off
 * the counter spans), `steps` the detector's single event, `parent_steps` the delta. The minute's deltas add up to its
 * counter count.
 */
function detectorPieces(): Array<{ startMs: number; endMs: number; steps: number; parent: number }> {
  const spans = COUNTER_SPANS.map(([a, b]) => [ist(a), ist(b)] as const);
  const out: Array<{ startMs: number; endMs: number; steps: number; parent: number }> = [];
  PHONE.forEach((c, i) => {
    const n = DETECTOR[i];
    if (!c || !n) return;
    const m = minuteOf(i);
    // free 0.9 s slots in the minute (off the counter spans), spread evenly
    const slots: number[] = [];
    for (let t = m + 150; t + 900 < m + MIN; t += 950) if (!spans.some(([a, b]) => a < t + 900 && t < b)) slots.push(t);
    expect(slots.length).toBeGreaterThanOrEqual(n);
    const step = slots.length / n;
    for (let k = 0; k < n; k++) {
      const t = slots[Math.floor(k * step)]!;
      const parent = Math.floor(c / n) + (k < c % n ? 1 : 0);
      out.push({ startMs: t, endMs: t + 900, steps: 1, parent });
    }
  });
  return out;
}

const RING_SOURCE = 'ring:0000000000000000';
function walkRecords(phoneSteps: 'counter' | 'detector'): StepRecord[] {
  const rs: StepRecord[] = [];
  RING.forEach((steps, i) => {
    if (steps === null) return;
    const s = minuteOf(i) + 19_000;
    rs.push({ id: `r${i}`, lineage: 'ring', source: RING_SOURCE, startMs: s, endMs: s + MIN, steps, support: 'minute' });
  });
  detectorPieces().forEach((p, k) => rs.push({ id: `p${k}`, lineage: 'phone', source: 'phone:counter', startMs: p.startMs, endMs: p.endMs, steps: phoneSteps === 'counter' ? p.parent : p.steps, support: 'minute' }));
  COUNTER_SPANS.forEach(([a, b, steps], k) => {
    const s = ist(a);
    const e = ist(b);
    const minute = Math.floor(s / MIN) === Math.floor((e - 1) / MIN);
    rs.push({ id: `c${k}`, lineage: 'phone', source: 'phone:counter', startMs: s, endMs: e, steps, support: minute ? 'minute' : 'counterSpan' });
  });
  return rs;
}
const located = (f: ReturnType<typeof fuseSteps>, from: number, to: number) =>
  sum(f.intervals.filter((u) => u.startMs >= from && u.endMs <= to).map((u) => u.steps));

describe('r068 walk: the shape as it came', () => {
  it('the generator reproduces the day: 2,615 uploaded, 4,181 counted, the ring 1,293 in 50 minute records', () => {
    const pieces = detectorPieces();
    // from 17:15 (the 16:47 counter span's 10 steps started before it)
    const spans = sum(COUNTER_SPANS.filter(([a]) => ist(a) >= W0).map((c) => c[2]));
    expect(sum(pieces.map((p) => p.steps)) + spans).toBe(2615);
    expect(sum(pieces.map((p) => p.parent)) + spans).toBe(4181);
    expect(PHONE_COUNTED).toBe(4109);
    expect(PHONE_DETECTED).toBe(2543);
    expect(RING_TOTAL).toBe(1293);
    expect(RING.filter((x) => x !== null)).toHaveLength(50);
    // the brisk 40 minutes: what the phone's own step app read (3,849), against the ring's 1,052 over 30 of them
    expect(between(PHONE, ...BOUT)).toBe(3837);
    expect(between(RING, ...BOUT)).toBe(1052);
  });
});

describe('r068 walk: steps-fuse/1 bouts (pure)', () => {
  it('the walk is one bout the phone clearly out-counted the ring over: the phone counts all of it', () => {
    const f = fuseSteps(walkRecords('counter'));
    expect(f.bouts).toEqual([{ startMs: BOUT[0], endMs: BOUT[1], phone: 3837, ring: 1052, ringCoverage: 0.75, prefersPhone: true }]);
    const inBout = f.intervals.filter((u) => u.startMs >= BOUT[0] && u.endMs <= BOUT[1]);
    expect(inBout.every((u) => u.lineage === 'phone')).toBe(true);
    expect(new Set(inBout.map((u) => u.selectionReason))).toEqual(new Set(['boutCount', 'soleSustainedGait', 'soleObserved']));
    expect(located(f, ...BOUT)).toBe(3837);
    // before the bout, the ring first as ever (its 17:15–17:24 minutes, where it out-counted the phone)
    const early = f.intervals.filter((u) => u.endMs <= ist('17:25:00') && u.unit === 'minute');
    expect(early.length).toBeGreaterThan(0);
    expect(early.every((u) => u.lineage === 'ring')).toBe(true);
  });

  it('the walk now fuses to the phone\'s count over the bout, the ring\'s first elsewhere; before, the ring\'s zeros took most of it', () => {
    const f = fuseSteps(walkRecords('counter'));
    const all = located(f, ist('16:40:00'), ist('18:40:00'));
    // the bout is the phone's 3,837; around it the ring first and the phone's quiet spans: 4,164 for 16:40–18:40, never
    // more than one lineage per unit
    expect(all).toBe(4164);
    expect(all).toBeLessThanOrEqual(PHONE_COUNTED + SPAN_TOTAL);
    // the ring wherever it has a record (what the preference gave minute by minute before, but for sole sustained gait):
    // its zeros take most of the walk
    const ringFirst = fuseSteps(walkRecords('counter'), { corrections: [{ startMs: BOUT[0], endMs: BOUT[1], use: 'ring' }] });
    expect(located(ringFirst, ...BOUT)).toBe(2021);
  });

  it('the detector\'s own count (an upload read as it came) still out-counts the ring over the bout: the phone counts it', () => {
    const f = fuseSteps(walkRecords('detector'));
    expect(f.bouts.find((b) => b.startMs === BOUT[0])).toMatchObject({ endMs: BOUT[1], ring: 1052, prefersPhone: true });
  });

  const MIN0 = ist('07:00:00');
  const at = (i: number) => MIN0 + i * MIN;
  const ring = (i: number, steps: number): StepRecord => ({ id: `r${i}`, lineage: 'ring', source: RING_SOURCE, startMs: at(i), endMs: at(i + 1), steps, support: 'minute' });
  const phone = (i: number, steps: number): StepRecord => ({ id: `p${i}`, lineage: 'phone', source: 'phone:counter', startMs: at(i), endMs: at(i + 1), steps, support: 'minute' });
  const walk = (n: number, r: (i: number) => number | null, p: (i: number) => number) => [
    ...Array.from({ length: n }, (_v, i) => r(i)).flatMap((s, i) => (s === null ? [] : [ring(i, s)])),
    ...Array.from({ length: n }, (_v, i) => phone(i, p(i))),
  ];

  it('a normal walk the ring covered: the ring, minute by minute, though the phone counted 10 % more', () => {
    const f = fuseSteps(walk(40, () => 100, () => 110));
    expect(f.bouts).toEqual([expect.objectContaining({ phone: 4400, ring: 4000, ringCoverage: 1, prefersPhone: false })]);
    expect(f.intervals.every((u) => u.lineage === 'ring' && u.selectionReason === 'preference')).toBe(true);
    expect(sum(f.intervals.map((u) => u.steps))).toBe(4000);
  });

  it('conservative: a ring that covered the whole bout keeps it even at half the phone\'s count; a small or close gap keeps it too', () => {
    // every minute recorded (coverage 100 %), half the phone's count: the ring missed no minute, so the preference stands
    expect(fuseSteps(walk(40, () => 50, () => 100)).intervals.every((u) => u.lineage === 'ring')).toBe(true);
    // 30 % of minutes missing but the phone only 1.3 times the ring over the bout
    const close = fuseSteps(walk(40, (i) => (i % 10 < 3 ? null : 130), () => 100));
    expect(close.bouts[0]).toMatchObject({ prefersPhone: false });
    expect(close.intervals.filter((u) => u.lineage === 'ring').every((u) => u.selectionReason === 'preference')).toBe(true);
    // twice the ring and half its minutes missing, but under BOUT_MARGIN more steps (a short stroll)
    const short = fuseSteps(walk(6, (i) => (i % 2 ? null : 60), () => 60));
    expect(short.bouts[0]).toMatchObject({ phone: 360, ring: 180, prefersPhone: false });
    expect(360 - 180).toBeLessThan(BOUT_MARGIN);
    expect(short.intervals.filter((u) => u.startMs % (2 * MIN) === MIN0 % (2 * MIN)).every((u) => u.lineage === 'ring')).toBe(true);
  });

  it('a person who puts the phone first, a correction, or a hand-carry bout are never overridden by the bout rule', () => {
    const rs = walkRecords('counter');
    expect(fuseSteps(rs, { preference: ['phone', 'ring', 'hc-other', 'unknown'] }).bouts).toEqual([]);
    const corrected = fuseSteps(rs, { corrections: [{ startMs: BOUT[0], endMs: BOUT[1], use: 'ring' }] });
    expect(corrected.intervals.filter((u) => u.startMs >= BOUT[0] && u.endMs <= BOUT[1] && u.lineage === 'ring').every((u) => u.selectionReason === 'userCorrection')).toBe(true);
    const hand = fuseSteps(rs, { activities: [{ startMs: BOUT[0], endMs: BOUT[1], kind: 'locomotorRing' }] });
    expect(hand.intervals.filter((u) => u.startMs >= BOUT[0] && u.endMs <= BOUT[1] && u.lineage === 'ring').every((u) => u.selectionReason === 'activityContext')).toBe(true);
  });

  it('phoneBouts: active minutes join across two quiet ones, not three; a quiet coarse counter span never makes a bout', () => {
    const tr = (r: StepRecord): TrackRecord => ({ ...r, valid: true });
    const ph = [...[0, 1, 2, 5, 6, 7].map((i) => tr(phone(i, 90))), ...[11, 12, 13, 14, 15].map((i) => tr(phone(i, 90)))];
    expect(phoneBouts(ph, []).map((b) => [b.startMs, b.endMs])).toEqual([[at(0), at(8)], [at(11), at(16)]]);
    const quiet = tr({ id: 'q', lineage: 'phone', source: 'phone:counter', startMs: at(0), endMs: at(60), steps: 600, support: 'counterSpan' });
    expect(phoneBouts([quiet], [])).toEqual([]);
    // a coarse span at walking cadence does make one (the counter batched while the screen was off)
    const batched = tr({ id: 'b', lineage: 'phone', source: 'phone:counter', startMs: at(0), endMs: at(10), steps: 1000, support: 'counterSpan' });
    expect(phoneBouts([batched], [])).toEqual([expect.objectContaining({ startMs: at(0), endMs: at(10), phone: 1000 })]);
  });
});

describe('r068 walk: counterScaledPhoneSteps (uploads before Gauge 2.8.5)', () => {
  const T = ist('18:00:00');
  let n = 0;
  const piece = (s: number, e: number, steps: number, parent: number, o: { a?: string; b?: string; timing?: string; support?: string } = {}) => ({
    id: `e${n++}`, startMs: s, endMs: e, support: o.support ?? 'minute',
    data: { steps, parent_steps: parent, timing: o.timing ?? 'detector', boot_id: 'b1', m_start_ns: o.a ?? String(s * 1e6), m_end_ns: o.b ?? String(e * 1e6) },
  });

  it('a span of 2 that went up as 1 reads 2; one the detector matched is unchanged; a counter record is never touched', () => {
    const rows = [piece(T + 200, T + 1100, 1, 2), piece(T + 1100, T + 2000, 2, 2), piece(T + 2000, T + 3000, 1, 4, { timing: 'counter' })];
    expect([...counterScaledPhoneSteps(rows)]).toEqual([[rows[0]!.id, 2]]);
  });

  it('a span cut at a minute shares the delta by the detector\'s events (largest remainder), and adds up to it', () => {
    const a = piece(T - 20_000, T, 3, 10);
    const b = piece(T, T + 25_000, 1, 10);
    const out = counterScaledPhoneSteps([b, a]);
    expect([out.get(a.id), out.get(b.id)]).toEqual([8, 2]);
  });

  it('a span the detector heard nothing of is shared by time; a span cut by the read stays as sent', () => {
    const a = piece(T - 15_000, T, 0, 4);
    const b = piece(T, T + 45_000, 0, 4);
    const out = counterScaledPhoneSteps([a, b]);
    expect([out.get(a.id), out.get(b.id)]).toEqual([1, 3]);
    // only the piece after the cut was read: it starts on the minute, so the span may be longer than what was read
    expect(counterScaledPhoneSteps([piece(T, T + 45_000, 1, 4)]).size).toBe(0);
    expect(counterScaledPhoneSteps([piece(T - 15_000, T, 1, 4)]).size).toBe(0);
  });

  it('pieces of different spans that touch are not joined (another delta, or a start off the minute)', () => {
    const a = piece(T - 900, T - 100, 1, 2);
    const b = piece(T - 100, T + 0, 1, 3, { a: String((T - 100) * 1e6) });
    const out = counterScaledPhoneSteps([a, b]);
    expect(out.get(a.id)).toBe(2);
    // b ends on the minute: possibly cut, so it stays
    expect(out.has(b.id)).toBe(false);
  });
});

describe('r068 walk: through the store (gauge_steps, gauge_timeline), uploads as Gauge 2.8.4 sent them', () => {
  let dir: string;
  let store: LumenStore;
  let tools: LumenToolSet;
  const NOW = ist('21:00:00');
  type Answer = {
    intervals: Array<{ start: string; end: string; steps: number; lineage: string; selectionReason: string }>;
    days: Array<{ located: number; phoneDailyTotal: number }>;
    steps: { phone: Array<number | null>; ring: Array<number | null>; selected: Array<number | null> };
  };
  const run = async (name: string, args: Record<string, unknown>) => (await tools.call(name, args)) as unknown as { ok: boolean; data: Answer };

  beforeAll(() => {
    dir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'r068-walk-'));
    store = openLumenStore(join(dir, 'lumen.db'));
    store.noteInstallation(INSTALL, { deviceName: 'Phone', appVersion: '2.8.4', pairedAt: '2026-10-01T00:00:00.000Z' });
    const ev: LumenTestEvent[] = [];
    RING.forEach((steps, i) => {
      if (steps === null) return;
      const s = minuteOf(i) + 19_000;
      const parent = [...RING_PARENTS].reverse().find((p) => ist(p) <= s)!;
      ev.push(ringSteps(iso(s), steps, { parentStart: iso(ist(parent)) }));
    });
    for (const p of detectorPieces()) ev.push(phoneSteps(iso(p.startMs), iso(p.endMs), p.steps, { parentSteps: p.parent }));
    for (const [a, b, steps] of COUNTER_SPANS) {
      const minute = Math.floor(ist(a) / MIN) === Math.floor((ist(b) - 1) / MIN);
      ev.push(phoneSteps(iso(ist(a)), iso(ist(b)), steps, { timing: 'counter', support: minute ? 'minute' : 'counterSpan' }));
    }
    ev.push(phoneAcquisition(iso(ist('16:30:00')), iso(ist('19:00:00')), 'listening'));
    const r = store.ingest(INSTALL, ev, NOW);
    expect(r.rejected).toEqual([]);
    tools = lumenToolSet(() => store, TZ, () => NOW);
  });
  afterAll(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('gauge_timeline: the phone lane reads the counter (4,109 in minutes), not the detector (2,543)', async () => {
    const t = (await run('gauge_timeline', { date: DATE })).data;
    expect(sum(t.steps.phone)).toBe(PHONE_COUNTED);
    expect(sum(t.steps.ring)).toBe(RING_TOTAL);
    const i0 = (BOUT[0] - ist('00:00:00')) / MIN;
    expect(sum(t.steps.selected.slice(i0, i0 + 40))).toBe(3837);
  });

  it('gauge_steps: the bout is the phone\'s; the day counts the walk', async () => {
    const d = (await run('gauge_steps', { from: DATE, to: DATE })).data;
    const inBout = d.intervals.filter((u) => Date.parse(u.start) >= BOUT[0] && Date.parse(u.end) <= BOUT[1]);
    expect(inBout.length).toBeGreaterThan(0);
    expect(inBout.every((u) => u.lineage === 'phone')).toBe(true);
    expect(sum(inBout.map((u) => u.steps))).toBe(3837);
    expect(d.days[0]!.phoneDailyTotal).toBe(PHONE_COUNTED + SPAN_TOTAL);
    expect(d.days[0]!.located).toBeGreaterThanOrEqual(3837 + 150);
  });
});
