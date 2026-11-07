// @vitest-environment node
/**
 * `steps-fuse/1` (energy SPEC §2.3): every invariant the spec lists, the owner's treadmill case (phone only, sustained
 * walking), ring only, overlaps and gaps, the context rules, observed zeros, and property tests for order and duplicate
 * invariance.
 */
import { describe, expect, it } from 'vitest';
import { fusedDays, fuseSteps, stepsInside, type DayInput, type FusionContext, type StepRecord } from './stepFusion.ts';

const MIN = 60_000;
const T0 = Date.parse('2026-10-20T01:30:00Z'); // 07:00 in Kolkata
const at = (i: number) => T0 + i * MIN;
const ring = (i: number, steps: number, o: Partial<StepRecord> = {}): StepRecord => ({ id: `r${i}`, lineage: 'ring', source: 'ring:0123456789abcdef', startMs: at(i), endMs: at(i + 1), steps, support: 'minute', ...o });
const phone = (i: number, steps: number, o: Partial<StepRecord> = {}): StepRecord => ({ id: `p${i}`, lineage: 'phone', source: 'phone:counter', startMs: at(i), endMs: at(i + 1), steps, support: 'minute', ...o });
const span = (lineage: StepRecord['lineage'], from: number, to: number, steps: number, o: Partial<StepRecord> = {}): StepRecord => ({
  id: `${lineage}-${from}-${to}`, lineage, source: lineage === 'ring' ? 'ring:0123456789abcdef' : lineage === 'phone' ? 'phone:counter' : `hc:${lineage.slice(9)}`,
  startMs: at(from), endMs: at(to), steps, support: lineage === 'phone' ? 'counterSpan' : 'tenMinuteFallback', ...o,
});
const range = (n: number, f: (i: number) => StepRecord, from = 0) => Array.from({ length: n }, (_, k) => f(from + k));
const total = (rs: StepRecord[], ctx?: FusionContext) => fuseSteps(rs, ctx).intervals.reduce((n, u) => n + (u.steps ?? 0), 0);
const DAY_START = Date.parse('2026-10-19T18:30:00Z');
const day = (o: Partial<DayInput> = {}): DayInput => ({ date: '2026-10-20', startMs: DAY_START, endMs: DAY_START + 1440 * MIN, ringDailyTotal: null, ringDetailComplete: false, ...o });

describe('steps-fuse/1: the treadmill case and the phone alone', () => {
  it('treadmill: the ring observed 0–30 while the phone counted 1,000 over 10 min → 1,000 (soleSustainedGait), flagged', () => {
    const ringSteps = [3, 0, 5, 2, 4, 0, 6, 3, 4, 3]; // 30, each ≤ 10 % of the phone's 100
    const rs = [...ringSteps.map((n, i) => ring(i, n)), ...range(10, (i) => phone(i, 100))];
    const f = fuseSteps(rs);
    expect(total(rs)).toBe(1000);
    expect(f.intervals).toHaveLength(1);
    expect(f.intervals[0]).toMatchObject({ startMs: at(0), endMs: at(10), steps: 1000, lineage: 'phone', unit: 'minute', selectionReason: 'soleSustainedGait', disagreement: true });
    expect(f.intervals[0]!.alternatives).toEqual([{ source: 'ring:0123456789abcdef', lineage: 'ring', steps: 30, support: 'minute' }]);
  });

  it('two such minutes are not sustained: the preference picks the ring there', () => {
    const rs = [ring(0, 2), ring(1, 1), phone(0, 100), phone(1, 100)];
    expect(fuseSteps(rs).intervals.map((u) => [u.lineage, u.selectionReason])).toEqual([['ring', 'preference']]);
    expect(total(rs)).toBe(3);
  });

  it('a minute over 10 % of the walker\'s count breaks the run; the rule needs both lineages observed', () => {
    const rs = [ring(0, 2), ring(1, 30), ring(2, 2), ring(3, 2), ring(4, 2), ...range(5, (i) => phone(i, 100))];
    const f = fuseSteps(rs);
    expect(f.intervals.map((u) => [u.startMs, u.lineage, u.selectionReason])).toEqual([
      [at(0), 'ring', 'preference'], [at(2), 'phone', 'soleSustainedGait'],
    ]);
    expect(total(rs)).toBe(2 + 30 + 300);
  });

  it('phone only, sustained walking (the ring never reported): every minute is soleObserved phone, never gait', () => {
    const rs = range(30, (i) => phone(i, 110));
    const f = fuseSteps(rs);
    expect(f.intervals).toEqual([expect.objectContaining({ steps: 3300, lineage: 'phone', selectionReason: 'soleObserved', alternatives: [] })]);
    expect(f.intervals[0]!.disagreement).toBeUndefined();
  });

  it('the phone\'s observed zeros (listening with detector timing) make the ring\'s hand-free walk sole sustained gait', () => {
    const rs = range(5, (i) => ring(i, 100));
    const listening: FusionContext = { zeroWindows: [{ lineage: 'phone', source: 'phone:counter', startMs: at(-2), endMs: at(8) }] };
    expect(fuseSteps(rs).intervals[0]).toMatchObject({ lineage: 'ring', selectionReason: 'soleObserved' });
    const f = fuseSteps(rs, listening);
    expect(f.intervals.map((u) => [u.startMs, u.endMs, u.lineage, u.steps, u.selectionReason])).toEqual([
      [at(-2), at(0), 'phone', 0, 'soleObserved'], [at(0), at(5), 'ring', 500, 'soleSustainedGait'], [at(5), at(8), 'phone', 0, 'soleObserved'],
    ]);
    // observed zeros are located zeros, not unknown minutes; a phone record is never doubled by them
    expect(fuseSteps([...rs, phone(6, 40)], listening).intervals.find((u) => u.startMs <= at(6) && at(6) < u.endMs)).toMatchObject({ steps: 40, lineage: 'phone', unit: 'minute' });
  });
});

describe('steps-fuse/1: ring only, overlap and gaps', () => {
  it('ring only: soleObserved; the native zero minutes are observed zeros (located 0, not unknown)', () => {
    const rs = [...range(5, (i) => ring(i, 0)), ...range(5, (i) => ring(i, 80), 5)];
    const f = fuseSteps(rs);
    // consecutive minutes that chose alike merge (observed zeros apart); each minute's count stays in minuteSelected
    expect(f.intervals.map((u) => [u.startMs, u.endMs, u.steps, u.lineage, u.selectionReason])).toEqual([[at(0), at(5), 0, 'ring', 'soleObserved'], [at(5), at(10), 400, 'ring', 'soleObserved']]);
    expect([...f.minuteSelected.values()].map((v) => v.steps)).toEqual([0, 0, 0, 0, 0, 80, 80, 80, 80, 80]);
    expect(fusedDays(f, [day()])[0]).toMatchObject({ located: 400, coverage: { ringMin: 10, unknownMin: 1430 } });
  });

  it('partial overlap: each lineage alone where it is alone, the preference where both are', () => {
    const rs = [...range(10, (i) => ring(i, 60)), ...range(10, (i) => phone(i, 62), 5)];
    const f = fuseSteps(rs);
    expect(f.intervals.map((u) => [u.startMs, u.endMs, u.lineage, u.steps, u.selectionReason])).toEqual([
      [at(0), at(5), 'ring', 300, 'soleObserved'], [at(5), at(10), 'ring', 300, 'preference'], [at(10), at(15), 'phone', 310, 'soleObserved'],
    ]);
    expect(f.intervals[1]!.disagreement).toBeUndefined();
  });

  it('gaps stay unknown: no interval, counted in coverage.unknownMin, never a 0', () => {
    const rs = [...range(10, (i) => ring(i, 50)), ...range(10, (i) => ring(i, 50), 20)];
    const f = fuseSteps(rs);
    expect(f.intervals.map((u) => [u.startMs, u.endMs])).toEqual([[at(0), at(10)], [at(20), at(30)]]);
    const [d] = fusedDays(f, [day()]);
    expect(d).toMatchObject({ located: 1000, coverage: { ringMin: 20, phoneMin: 0, eitherMin: 20, unknownMin: 1420 } });
    expect(fusedDays(fuseSteps([]), [day()])[0]).toMatchObject({ located: null, headline: null, coverage: { unknownMin: 1440 } });
  });

  it('ring 700 vs phone 1,000 on identical support with no context → ring 700 by preference, flagged; never 1,000 because it is larger', () => {
    const coarse = [span('ring', 0, 10, 700), span('phone', 0, 10, 1000)];
    expect(fuseSteps(coarse).intervals).toEqual([expect.objectContaining({ steps: 700, lineage: 'ring', selectionReason: 'preference', disagreement: true, unit: 'component' })]);
    const minutes = [...range(10, (i) => ring(i, 70)), ...range(10, (i) => phone(i, 100))];
    expect(fuseSteps(minutes).intervals).toEqual([expect.objectContaining({ steps: 700, lineage: 'ring', selectionReason: 'preference', disagreement: true })]);
    // under 20 % apart: no flag; the preference is configurable (D1)
    expect(fuseSteps([span('ring', 0, 10, 900), span('phone', 0, 10, 1000)]).intervals[0]!.disagreement).toBeUndefined();
    expect(total(coarse, { preference: ['phone', 'ring'] })).toBe(1000);
  });

  it('two 1,000-step records on identical support → 1,000 (same or other lineage); disjoint → 2,000', () => {
    expect(total([span('ring', 0, 10, 1000), span('ring', 0, 10, 1000, { id: 'copy' })])).toBe(1000);
    expect(total([span('ring', 0, 10, 1000), span('phone', 0, 10, 1000)])).toBe(1000);
    expect(total([span('ring', 0, 10, 1000), span('ring', 10, 20, 1000)])).toBe(2000);
  });

  it('a coarse record stays coarse: one unit for its whole component, one source chosen for all of it', () => {
    const rs = [...range(13, (i) => ring(i, 40)), span('phone', 3, 13, 900)];
    const f = fuseSteps(rs);
    // ring minutes 0–2 only touch the span (half-open): their own minute units; 3–12 join the span's component
    expect(f.intervals.map((u) => [u.startMs, u.endMs, u.unit, u.lineage, u.steps, u.selectionReason])).toEqual([
      [at(0), at(3), 'minute', 'ring', 120, 'soleObserved'], [at(3), at(13), 'component', 'ring', 400, 'preference'],
    ]);
    expect(f.intervals[1]!.alternatives).toEqual([{ source: 'phone:counter', lineage: 'phone', steps: 900, support: 'counterSpan' }]);
    expect(f.intervals[1]!.disagreement).toBe(true);
    // (r068 B1) the unit chose the ring, whose records are minute records: each is placed in its minute (the span is not split)
    expect(f.intervals[1]!.placed).toBe(true);
    expect([...f.minuteSelected.entries()]).toEqual(range(13, (i) => ring(i, 40)).map((r) => [r.startMs, { steps: 40, lineage: 'ring', source: 'ring:0123456789abcdef' }]));
  });

  it('(r063 A3) a lineage covering only part of a coarse unit never stands for all of it', () => {
    // the ring saw 7 of the span's 10 minutes: it cannot speak for the other 3, the phone's span covers them all
    const rs = [...range(10, (i) => ring(i, 40)), span('phone', 3, 13, 900)];
    const u = fuseSteps(rs).intervals[1]!;
    expect([u.unit, u.lineage, u.steps, u.selectionReason]).toEqual(['component', 'phone', 900, 'coverage']);
    expect(u.alternatives).toEqual([{ source: 'ring:0123456789abcdef', lineage: 'ring', steps: 280, support: 'minute', partial: true }]);
    // the person's correction still stands for the unit
    expect(fuseSteps(rs, { corrections: [{ startMs: at(3), endMs: at(13), use: 'ring' }] }).intervals[1]).toMatchObject({ lineage: 'ring', steps: 280, selectionReason: 'userCorrection' });
  });

  it('ring day 10,000 with 8,000 located plus phone 3,000 in ring-detail gaps → located 11,000, residual 2,000 unlocated; never 13,000', () => {
    const rs = [...range(80, (i) => ring(i, 100)), ...range(30, (i) => phone(i, 100), 100)];
    const [d] = fusedDays(fuseSteps(rs), [day({ ringDailyTotal: 10_000 })]);
    expect(d).toMatchObject({ located: 11_000, ringDailyTotal: 10_000, ringResidual: 2000, phoneDailyTotal: 3000 });
    // the ring's detail is incomplete: the headline is the "at least" scenario max(located, total), never their sum
    expect(d).toMatchObject({ headline: 11_000, headlinePolicy: 'atLeast', resolved: false });
  });

  it('daily total and detail are never summed: headline at least the total while detail is incomplete, located once it is complete', () => {
    const rs = range(30, (i) => ring(i, 100));
    const f = fuseSteps(rs);
    expect(fusedDays(f, [day({ ringDailyTotal: 5000 })])[0]).toMatchObject({ located: 3000, headline: 5000, headlinePolicy: 'atLeast', resolved: false, ringResidual: 2000, headlineLabel: expect.stringMatching(/not placed in time/) });
    expect(fusedDays(f, [day({ ringDailyTotal: 5000, ringDetailComplete: true })])[0]).toMatchObject({ located: 3000, headline: 3000, headlinePolicy: 'located', resolved: true });
  });

  it('a deletion retracts only its own contribution; the latest revision of a record wins', () => {
    const a = span('phone', 0, 10, 500, { upstreamId: 'hc-1', rev: 1, lineage: 'hc-other:com.samsung.health', source: 'hc:com.samsung.health', support: 'span' });
    const b = span('ring', 20, 30, 300);
    expect(total([a, b])).toBe(800);
    expect(total([a, b, { ...a, id: 'tomb', rev: 2, deleted: true }])).toBe(300);
    expect(total([a, b, { ...a, id: 'rev2', rev: 2, steps: 650 }])).toBe(950);
    // a tombstone at the same revision still wins (Health Connect deletes the record it names)
    expect(total([a, b, { ...a, id: 'tomb', deleted: true }])).toBe(300);
  });

  it('a cadence over 300/min is invalid for selection and kept as an alternative; a stale source likewise', () => {
    const f = fuseSteps([ring(0, 50), phone(0, 400)]);
    expect(f.intervals[0]).toMatchObject({ lineage: 'ring', steps: 50, selectionReason: 'soleObserved', alternatives: [{ lineage: 'phone', steps: 400, invalid: 'cadence' }] });
    const g = fuseSteps([phone(0, 400)]);
    expect(g.intervals[0]).toMatchObject({ steps: null, lineage: null, selectionReason: 'noValidSource' });
    expect(fusedDays(g, [day()])[0]).toMatchObject({ located: null, coverage: { eitherMin: 1, unknownMin: 1440 } });
    expect(fuseSteps([ring(0, 50), phone(0, 60, { stale: true })]).intervals[0]!.alternatives[0]).toMatchObject({ invalid: 'stale' });
  });

  it('Health Connect\'s copy of the phone (D4) is a same-lineage alternative, never counted; outside the counter it fills the gap', () => {
    const fit = { lineage: 'phone' as const, source: 'hc:com.google.android.apps.fitness', sourceRank: 1, support: 'span' as const };
    const rs = [...range(10, (i) => phone(i, 100)), span('phone', 0, 10, 1000, { ...fit, id: 'fit-1' }), span('phone', 20, 30, 800, { ...fit, id: 'fit-2' })];
    const f = fuseSteps(rs);
    expect(total(rs)).toBe(1800);
    expect(f.copies.map((r) => r.id)).toEqual(['fit-1']);
    expect(f.intervals[0]!.alternatives).toContainEqual({ source: 'hc:com.google.android.apps.fitness', lineage: 'phone', steps: 1000, support: 'span', sameLineage: true });
    expect(f.intervals[1]).toMatchObject({ startMs: at(20), source: 'hc:com.google.android.apps.fitness', steps: 800, selectionReason: 'soleObserved' });
  });
});

describe('steps-fuse/1: context rules', () => {
  it('(a) a user correction wins over everything else', () => {
    const rs = [...range(5, (i) => ring(i, 2)), ...range(5, (i) => phone(i, 100))];
    expect(fuseSteps(rs, { corrections: [{ startMs: at(0), endMs: at(5), use: 'ring' }] }).intervals[0]).toMatchObject({ lineage: 'ring', steps: 10, selectionReason: 'userCorrection' });
  });

  it('(b) a treadmill keeps credible ring gait over a nearly still phone; a non-locomotor activity takes the phone, else flags the ring', () => {
    const rs = [...range(5, (i) => ring(i, 100)), ...range(5, (i) => phone(i, 3))];
    expect(fuseSteps(rs, { activities: [{ startMs: at(0), endMs: at(5), kind: 'treadmill' }] }).intervals[0]).toMatchObject({ lineage: 'ring', steps: 500, selectionReason: 'soleSustainedGait' });
    expect(fuseSteps(rs, { activities: [{ startMs: at(0), endMs: at(5), kind: 'nonLocomotor' }] }).intervals[0]).toMatchObject({ lineage: 'phone', selectionReason: 'activityContext' });
    const ringOnly = range(5, (i) => ring(i, 100));
    expect(fuseSteps(ringOnly, { activities: [{ startMs: at(0), endMs: at(5), kind: 'nonLocomotor' }] }).intervals[0]).toMatchObject({ lineage: 'ring', selectionReason: 'activityContext', nonLocomotorSuspect: true });
    // outside the activity the same minutes would be the ring's sole sustained gait
    expect(fuseSteps(rs).intervals[0]).toMatchObject({ lineage: 'ring', selectionReason: 'soleSustainedGait' });
  });

  it('sessionIncludedSteps: only selected units wholly inside the bout, by lineage', () => {
    const f = fuseSteps([...range(10, (i) => ring(i, 50)), ...range(10, (i) => phone(i, 100), 20)]);
    expect(stepsInside(f, at(0), at(30))).toEqual({ ring: 500, phone: 1000 });
    expect(stepsInside(f, at(5), at(30))).toEqual({ phone: 1000 });
  });

  it('merged minutes never cross a break (a local midnight); a unit belongs to the day of its last instant', () => {
    const mid = at(5);
    const f = fuseSteps(range(10, (i) => ring(i, 10)), { breaks: [mid] });
    expect(f.intervals.map((u) => [u.startMs, u.endMs])).toEqual([[at(0), mid], [mid, at(10)]]);
    const days = fusedDays(f, [day({ date: 'a', startMs: mid - DAY_MS, endMs: mid }), day({ date: 'b', startMs: mid, endMs: mid + DAY_MS })]);
    expect(days.map((d) => d.located)).toEqual([50, 50]);
  });
});

const DAY_MS = 86_400_000;

describe('r076: interval evidence when the phone and wrist disagree', () => {
  const stalled = () => [
    ...range(16, (i) => ring(i, [0, 12, 60, 0][i % 4]!)),
    ...range(16, (i) => phone(i, 100)),
  ];

  it('a sustained pocket gait beats repeated wrist stalls even when every wrist minute arrived', () => {
    const f = fuseSteps(stalled());
    expect(f.bouts).toEqual([expect.objectContaining({ ringCoverage: 1, wristStall: true, prefersPhone: true })]);
    expect(f.intervals).toEqual([expect.objectContaining({ startMs: at(0), endMs: at(16), lineage: 'phone', steps: 1600, selectionReason: 'wristStall', disagreement: true })]);
    expect([...f.minuteSelected.values()].reduce((sum, m) => sum + m.steps, 0)).toBe(1600);
    expect(fusedDays(f, [day({ ringDailyTotal: 288, ringDetailComplete: true })])[0]).toMatchObject({ located: 1600, headline: 1600, ringResidual: 0 });
  });

  it('a walking ring wins when the phone was left still; missing phone evidence stays missing', () => {
    const walking = range(16, (i) => ring(i, 100));
    expect(fuseSteps(walking).intervals[0]).toMatchObject({ lineage: 'ring', steps: 1600, selectionReason: 'soleObserved', alternatives: [] });
    const observed = fuseSteps(walking, { zeroWindows: [{ lineage: 'phone', source: 'phone:counter', startMs: at(0), endMs: at(16) }] });
    expect(observed.intervals[0]).toMatchObject({ lineage: 'ring', steps: 1600, selectionReason: 'soleSustainedGait', alternatives: [{ lineage: 'phone', steps: 0 }] });
    expect(fuseSteps([], { zeroWindows: [{ lineage: 'phone', source: 'phone:counter', startMs: at(0), endMs: at(2) }] }).intervals[0]).toMatchObject({ lineage: 'phone', steps: 0, selectionReason: 'soleObserved' });
    expect(fusedDays(fuseSteps([]), [day()])[0]).toMatchObject({ located: null, headline: null });
  });

  it('ordinary agreement or disagreement is not mistaken for a wrist stall', () => {
    const agree = fuseSteps([...range(16, (i) => ring(i, 100)), ...range(16, (i) => phone(i, 105))]);
    expect(agree.intervals[0]).toMatchObject({ lineage: 'ring', steps: 1600, selectionReason: 'preference' });
    expect(agree.intervals[0]!.disagreement).toBeUndefined();
    const disagreeing = fuseSteps([...range(16, (i) => ring(i, 50)), ...range(16, (i) => phone(i, 100))]);
    expect(disagreeing.bouts[0]).toMatchObject({ prefersPhone: false });
    expect(disagreeing.bouts[0]!.wristStall).toBeUndefined();
    expect(disagreeing.intervals[0]).toMatchObject({ lineage: 'ring', steps: 800, selectionReason: 'preference', disagreement: true });
  });

  it('coarse or delayed phone totals cannot testify to minute-level wrist stalls', () => {
    const ringMinutes = range(16, (i) => ring(i, [0, 12, 60, 0][i % 4]!));
    const coarse = span('phone', 0, 16, 1600);
    const f = fuseSteps([...ringMinutes, coarse]);
    expect(f.bouts[0]).toMatchObject({ prefersPhone: false });
    expect(f.bouts[0]!.wristStall).toBeUndefined();
    expect(f.intervals[0]).toMatchObject({ unit: 'component', lineage: 'ring', steps: 288, selectionReason: 'preference' });
    expect(f.intervals[0]!.alternatives).toContainEqual(expect.objectContaining({ lineage: 'phone', steps: 1600, support: 'counterSpan' }));
    const copiedMinutes = ringMinutes.concat(range(16, (i) => phone(i, 100, { source: 'hc:phone-origin', sourceRank: 1 })));
    const copied = fuseSteps(copiedMinutes);
    expect(copied.bouts[0]!.wristStall).toBeUndefined();
    expect(copied.intervals.every((u) => u.lineage === 'ring')).toBe(true);
  });

  it('a correction and known carry override the inferred stall; turning gait inference off retains preference', () => {
    const rs = stalled();
    const corrected = fuseSteps(rs, { corrections: [{ startMs: at(0), endMs: at(16), use: 'ring' }] });
    expect(corrected.intervals.every((u) => u.lineage === 'ring' && u.selectionReason === 'userCorrection')).toBe(true);
    expect(corrected.intervals.reduce((sum, u) => sum + (u.steps ?? 0), 0)).toBe(288);
    const hand = fuseSteps(rs, { activities: [{ startMs: at(0), endMs: at(16), kind: 'locomotorRing' }] });
    expect(hand.intervals.every((u) => u.lineage === 'ring' && u.selectionReason === 'activityContext')).toBe(true);
    expect(hand.intervals.reduce((sum, u) => sum + (u.steps ?? 0), 0)).toBe(288);
    expect(fuseSteps(rs, { activities: [{ startMs: at(0), endMs: at(16), kind: 'locomotorPocket' }] }).intervals[0]).toMatchObject({ lineage: 'phone', steps: 1600, selectionReason: 'activityContext' });
    const inferenceOff = fuseSteps(rs, { soleSustainedGait: false });
    expect(inferenceOff.intervals.every((u) => u.lineage === 'ring' && u.selectionReason === 'preference' && u.disagreement)).toBe(true);
    expect(inferenceOff.intervals.reduce((sum, u) => sum + (u.steps ?? 0), 0)).toBe(288);
  });

  it('a non-locomotor window suppresses ring arm artefacts when the phone observed zero', () => {
    const rs = range(16, (i) => ring(i, 100));
    const context: FusionContext = {
      activities: [{ startMs: at(0), endMs: at(16), kind: 'nonLocomotor' }],
      zeroWindows: [{ lineage: 'phone', source: 'phone:counter', startMs: at(0), endMs: at(16) }],
    };
    expect(fuseSteps(rs, context).intervals[0]).toMatchObject({ lineage: 'phone', steps: 0, selectionReason: 'activityContext', alternatives: [{ lineage: 'ring', steps: 1600 }] });
  });

  it('a reset or re-upload changes only its own phone record; Health Connect copies remain alternatives', () => {
    const before = span('phone', 0, 5, 500, { id: 'counter-before', upstreamId: 'boot-A', rev: 1 });
    const after = span('phone', 5, 10, 400, { id: 'counter-after', upstreamId: 'boot-B', rev: 1 });
    const copy = span('phone', 0, 10, 900, { id: 'hc-copy', source: 'hc:phone-origin', sourceRank: 1, support: 'span' });
    expect(total([before, after, copy])).toBe(900);
    expect(fuseSteps([before, after, copy]).copies.map((r) => r.id)).toEqual(['hc-copy']);
    const revised = { ...after, id: 'counter-after-revision', rev: 2, steps: 420 };
    expect(total([before, after, revised, copy])).toBe(920);
    expect(total([before, after, revised, copy, { ...revised, id: 'counter-after-deleted', rev: 3, deleted: true }])).toBe(500);
  });
});

// --- properties: a small deterministic generator (no extra dependency)

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
function randomRecords(seed: number): StepRecord[] {
  const r = rng(seed);
  const out: StepRecord[] = [];
  for (let i = 0; i < 60; i++) {
    if (r() < 0.7) out.push(ring(i, Math.floor(r() * 140)));
    if (r() < 0.5) out.push(phone(i, Math.floor(r() * 140), { id: `p${i}` }));
  }
  for (let k = 0; k < 4; k++) {
    const a = Math.floor(r() * 60);
    out.push(span(r() < 0.5 ? 'phone' : 'hc-other:com.samsung.health', a, a + 1 + Math.floor(r() * 15), Math.floor(r() * 2000), { id: `s${k}` }));
  }
  return out;
}
function shuffle<T>(xs: T[], seed: number): T[] {
  const r = rng(seed);
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
const strip = (rs: StepRecord[]) => JSON.stringify(fuseSteps(rs).intervals);

describe('steps-fuse/1: properties', () => {
  it('order invariance: any order of the same records gives the same intervals', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rs = randomRecords(seed);
      expect(strip(shuffle(rs, seed * 7)), `seed ${seed}`).toBe(strip(rs));
    }
  });

  it('duplicate invariance: a re-sent record, or a same-lineage copy under another id, never changes the total', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rs = randomRecords(seed);
      const pick = rs[Math.floor(rng(seed)() * rs.length)]!;
      expect(total([...rs, pick]), `seed ${seed}`).toBe(total(rs));
      expect(total([...rs, { ...pick, id: `${pick.id}-copy` }]), `seed ${seed}`).toBe(total(rs));
    }
  });

  it('the located total never exceeds the sum of one lineage per unit, and units never overlap', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const f = fuseSteps(randomRecords(seed));
      f.intervals.forEach((u, i) => i && expect(u.startMs).toBeGreaterThanOrEqual(f.intervals[i - 1]!.endMs));
      for (const u of f.intervals) if (u.steps !== null) expect(u.alternatives.filter((a) => !a.sameLineage).every((a) => a.lineage !== u.lineage)).toBe(true);
    }
  });
});

describe('r063 audit probes (astra F03 / A3, F08 / A8)', () => {
  const fit = 'hc-other:com.google.android.apps.fitness' as const;
  const hcHour = (steps: number, o: Partial<StepRecord> = {}) => span(fit, 0, 60, steps, { support: 'span', ...o });

  it('A3 probe: one zero-step ring minute over a 6,000-step Health Connect hour keeps the hour (never only the ring\'s zero)', () => {
    const f = fuseSteps([ring(10, 0), hcHour(6000)]);
    expect(total([ring(10, 0), hcHour(6000)])).toBe(6000);
    expect(f.intervals).toHaveLength(1);
    expect(f.intervals[0]).toMatchObject({ unit: 'component', lineage: fit, steps: 6000, selectionReason: 'coverage', startMs: at(0), endMs: at(60) });
    expect(f.intervals[0]!.alternatives).toEqual([{ source: 'ring:0123456789abcdef', lineage: 'ring', steps: 0, support: 'minute', partial: true }]);
    expect(fusedDays(f, [day()])[0]).toMatchObject({ located: 6000 });
  });

  it('A3: partial overlap (the ring 40 of 60 minutes) and coverage gaps keep the coarse record; 90 % covered eclipses it', () => {
    expect(total([...range(40, (i) => ring(i, 50)), hcHour(6000)])).toBe(6000);
    // the ring's 40 minutes in two runs with a gap: still partial
    expect(total([...range(20, (i) => ring(i, 50)), ...range(20, (i) => ring(i, 50), 35), hcHour(6000)])).toBe(6000);
    // ring 30 minutes + phone 25 minutes cover 55 of 60 (≥ 90 %): the hour is eclipsed, the minutes stay minute units
    const covered = [...range(30, (i) => ring(i, 50)), ...range(25, (i) => phone(i, 60), 30), hcHour(6000)];
    const f = fuseSteps(covered);
    expect(total(covered)).toBe(30 * 50 + 25 * 60);
    expect(f.intervals.every((u) => u.unit === 'minute')).toBe(true);
    expect(f.intervals[0]!.alternatives).toContainEqual(expect.objectContaining({ lineage: fit, steps: 6000 }));
  });

  it('A3: an invalid preferred record never eclipses (only valid coverage counts)', () => {
    const rs = [...range(60, (i) => ring(i, 400)), hcHour(6000)];
    expect(fuseSteps(rs).intervals[0]).toMatchObject({ lineage: fit, steps: 6000 });
  });

  it('A8 probe: an invalid 400/min direct phone record does not hide a valid 100/min Health Connect phone copy', () => {
    const direct = phone(0, 400, { id: 'direct', upstreamId: 'counter-1', sourceRank: 0 });
    const copy = phone(0, 100, { id: 'hccopy', upstreamId: 'hc-1', source: 'hc:android', sourceRank: 1 });
    const f = fuseSteps([direct, copy]);
    expect(f.intervals[0]).toMatchObject({ lineage: 'phone', source: 'hc:android', steps: 100, selectionReason: 'soleObserved' });
    expect(f.intervals[0]!.alternatives).toEqual([{ source: 'phone:counter', lineage: 'phone', steps: 400, support: 'minute', invalid: 'cadence', sameLineage: true }]);
    // both valid: the primary representation still wins (D4)
    expect(fuseSteps([phone(0, 90, { id: 'direct', sourceRank: 0 }), { ...copy }]).intervals[0]).toMatchObject({ source: 'phone:counter', steps: 90 });
  });
});

describe('r063: the phone\'s carry during a gait bout (ACT-A carry → locomotorPocket / locomotorRing)', () => {
  it('pocket: the phone\'s sustained gait wins (the treadmill case), its observed stillness too', () => {
    const treadmill = [...range(10, (i) => ring(i, 2)), ...range(10, (i) => phone(i, 100))];
    expect(fuseSteps(treadmill, { activities: [{ startMs: at(0), endMs: at(10), kind: 'locomotorPocket' }] }).intervals[0]).toMatchObject({ lineage: 'phone', steps: 1000, selectionReason: 'activityContext' });
  });

  it('hand or desk: the ring, even where the phone counted; the phone\'s zeros are never observations there', () => {
    const rs = [...range(10, (i) => ring(i, 100)), ...range(10, (i) => phone(i, 30))];
    const desk = { activities: [{ startMs: at(0), endMs: at(10), kind: 'locomotorRing' as const }] };
    // Without known carry, the phone's 30/min is insufficient to overrule the ring's sustained 100/min.
    expect(fuseSteps(rs, { activities: [{ startMs: at(0), endMs: at(10), kind: 'locomotor' }] }).intervals[0]).toMatchObject({ lineage: 'ring', steps: 1000, selectionReason: 'preference', disagreement: true });
    expect(fuseSteps(rs, desk).intervals[0]).toMatchObject({ lineage: 'ring', steps: 1000, selectionReason: 'activityContext' });
    // the phone listened on the desk and counted nothing: no observed zero inside the bout (no phone alternative there)
    const zw: FusionContext['zeroWindows'] = [{ lineage: 'phone', source: 'phone:counter', startMs: at(0), endMs: at(20) }];
    const walk = range(20, (i) => ring(i, 100));
    const f = fuseSteps(walk, { ...desk, zeroWindows: zw });
    expect(f.intervals[0]).toMatchObject({ startMs: at(0), endMs: at(10), lineage: 'ring', selectionReason: 'activityContext', alternatives: [] });
    expect(f.tracks.get('phone')!.every((r) => r.startMs >= at(10))).toBe(true);
    // outside the bout the phone's zeros stand
    expect(f.intervals.find((u) => u.startMs === at(10))!.alternatives).toContainEqual(expect.objectContaining({ lineage: 'phone', steps: 0 }));
  });
});

describe('energy fix round 1 (claude-core F3, F5, F6; codex-core #8)', () => {
  const shealth = 'hc-other:com.sec.android.app.shealth' as const;

  it('F3: inside a nonLocomotor activity the phone\'s observed stillness wins over the ring\'s arm swings, and gait never applies', () => {
    const rs = range(20, (i) => ring(i, 100));
    const zw: FusionContext['zeroWindows'] = [{ lineage: 'phone', source: 'phone:counter', startMs: at(0), endMs: at(20) }];
    expect(fuseSteps(rs, { zeroWindows: zw }).intervals.map((u) => [u.lineage, u.steps, u.selectionReason])).toEqual([['ring', 2000, 'soleSustainedGait']]);
    const f = fuseSteps(rs, { zeroWindows: zw, activities: [{ startMs: at(0), endMs: at(20), kind: 'nonLocomotor' }] });
    expect(f.intervals.map((u) => [u.lineage, u.steps, u.selectionReason])).toEqual([['phone', 0, 'activityContext']]);
    // no phone observed: the ring, flagged
    const g = fuseSteps(rs, { activities: [{ startMs: at(0), endMs: at(20), kind: 'nonLocomotor' }] });
    expect(g.intervals[0]).toMatchObject({ lineage: 'ring', selectionReason: 'activityContext', nonLocomotorSuspect: true });
  });

  it('F3: a locomotor bout takes the phone only when it counted steps; soleSustainedGait: false turns rule (c) off', () => {
    const treadmill = [...range(10, (i) => ring(i, 2)), ...range(10, (i) => phone(i, 100))];
    const loco = { activities: [{ startMs: at(0), endMs: at(10), kind: 'locomotor' as const }] };
    expect(fuseSteps(treadmill, loco).intervals[0]).toMatchObject({ lineage: 'phone', steps: 1000, selectionReason: 'activityContext' });
    const deskPhone = range(10, (i) => ring(i, 100));
    const zw: FusionContext['zeroWindows'] = [{ lineage: 'phone', source: 'phone:counter', startMs: at(0), endMs: at(10) }];
    expect(fuseSteps(deskPhone, { ...loco, zeroWindows: zw }).intervals[0]).toMatchObject({ lineage: 'ring', steps: 1000 });
    expect(total(treadmill, { soleSustainedGait: false })).toBe(20);
  });

  it('F5: an hc-other span over the treadmill walk never hands it back to the ring\'s zeros', () => {
    const base = [...range(10, (i) => ring(i, 0)), ...range(10, (i) => phone(i, 100))];
    const hc = span(shealth, 0, 10, 1000, { support: 'span' });
    expect(total(base)).toBe(1000);
    const f = fuseSteps([...base, hc]);
    expect(total([...base, hc])).toBe(1000);
    expect(f.intervals[0]).toMatchObject({ lineage: 'phone', selectionReason: 'soleSustainedGait' });
    expect(f.intervals[0]!.alternatives).toContainEqual(expect.objectContaining({ lineage: shealth, steps: 1000, support: 'span' }));
  });

  it('F5: an hc-other span never wipes the phone\'s steps in ring gaps (located = ring + phone in the gap)', () => {
    const rs = [...range(5, (i) => ring(i, 80)), ...range(5, (i) => phone(i, 90), 5), span(shealth, 0, 10, 900, { support: 'span' })];
    expect(total(rs)).toBe(400 + 450);
  });

  it('F5: a third lineage agreeing with the phone minute by minute does not block sole sustained gait', () => {
    const rs = [...range(10, (i) => ring(i, 0)), ...range(10, (i) => phone(i, 100)), ...range(10, (i) => ({ ...phone(i, 98), id: `h${i}`, lineage: shealth, source: 'hc:shealth' }))];
    const f = fuseSteps(rs);
    expect(total(rs)).toBe(1000);
    expect(f.intervals[0]).toMatchObject({ lineage: 'phone', selectionReason: 'soleSustainedGait' });
  });

  it('F6 / codex #8: a component crossing midnight puts each selected record\'s steps on its own day', () => {
    const MID = DAY_START + 1440 * MIN; // midnight of 2026-10-21 in Kolkata
    const r = (k: number, steps: number): StepRecord => ({ id: `m${k}`, lineage: 'ring', source: 'ring:k', startMs: MID + k * MIN, endMs: MID + (k + 1) * MIN, steps, support: 'minute' });
    const before = Array.from({ length: 10 }, (_, k) => r(k - 10, 8)); // 80
    const after = Array.from({ length: 10 }, (_, k) => r(k, 9)); // 90
    const cs: StepRecord = { id: 'cs', lineage: 'phone', source: 'phone:counter', startMs: MID - 10 * MIN, endMs: MID + 10 * MIN, steps: 200, support: 'counterSpan' };
    const d1 = day();
    const d2 = day({ date: '2026-10-21', startMs: MID, endMs: MID + 1440 * MIN });
    const both = fusedDays(fuseSteps([...before, ...after, cs], { breaks: [MID] }), [d1, d2]);
    expect(both.map((d) => d.located)).toEqual([80, 90]);
  });
});
