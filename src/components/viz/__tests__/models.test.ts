/**
 * The pure model and spoken*() functions of the shared viz modules (SPEC A.3.2, DATAVIZ P1–P11).
 */
import { describe, expect, it } from 'vitest';
import { BANDS } from '@/features/ring/model';
import { arcTicks, bandOf, bezier, spokenArc } from '../ArcRuler';
import { arcDots, arcWeights, litDots, spokenDisc, DISC_DOTS } from '../DayDisc';
import { dotColumns, dotModel, spokenDots } from '../DotFill';
import { clockText, durationText, speak, tidyCeil } from '../geometry';
import { LEVEL_KNOTS, LEVEL_KNOTS_10, levelCell, personalKnot, cellOfUnit, spokenLevel, usualPhrase, type Knot } from '../LevelBar';
import { learningText } from '../marks';
import { addId, monitorCapacity, moveId, movedText, removeId } from '../MonitorSheet';
import { medianStep, spokenTrace, traceModel, traceRuns, traceTicks, trendPhrase, magnitudeText } from '../OvernightTrace';
import { shareText, spokenShare } from '../ShareBar';
import { chipText, spokenStat } from '../Stat';
import { rampStep, spokenStrip, stateSegments, stateTimeline } from '../StateStrip';
import { goalLabel, spokenTick, tickCount, tickDomain, tickModel } from '../TickStrip';

const T = (hhmm: string, day = '2026-10-26') => Date.parse(`${day}T${hhmm}:00Z`);
const TZ = 'UTC';

describe('geometry', () => {
  it('tidies domains, speaks the minus and words durations', () => {
    expect(tidyCeil(525)).toBe(600);
    expect(tidyCeil(1.04)).toBe(1.2);
    expect(tidyCeil(0)).toBe(1);
    expect(speak('−14 ms vs usual')).toBe('minus 14 ms vs usual');
    expect(durationText(68)).toBe('1 h 08');
    expect(durationText(0)).toBe('0 min');
    expect(clockText(T('09:55'), TZ)).toBe('09:55');
  });
});

describe('TickStrip (P2)', () => {
  it('runs the domain past the goal so overshoot shows', () => {
    expect(tickDomain(476, 420)).toEqual([0, 600]);
    expect(tickDomain(2450, 2100)).toEqual([0, 3000]);
    expect(tickDomain(null, null)).toEqual([0, 1]);
    expect(tickDomain(5, 9, [0, 90])).toEqual([0, 90]);
  });

  it('counts floor(width / 5) ticks in 36..72 and lights the ticks under the value', () => {
    expect(tickCount(288)).toBe(57);
    expect(tickCount(100)).toBe(36);
    expect(tickCount(1000)).toBe(72);
    const m = tickModel({ value: 476, goal: 420, width: 288 });
    expect(m.count).toBe(57);
    expect(m.valueIndex).toBe(Math.round((476 / 600) * 56));
    expect(m.goalIndex).toBe(Math.round((420 / 600) * 56));
    expect(m.ticks.filter((t) => t.lit)).toHaveLength(m.valueIndex!);
    expect(m.over).toBe(true);
  });

  it('a value of 0 sits at the start; a future day lights nothing; plan days tick per day with weekly majors', () => {
    expect(tickModel({ value: 0, goal: 960 }).valueIndex).toBe(0);
    const f = tickModel({ value: 300, goal: 420, state: 'future' });
    expect(f.valueIndex).toBeNull();
    expect(f.ticks.some((t) => t.lit)).toBe(false);
    const plan = tickModel({ value: 16, goal: 90, domain: [0, 90], ticks: { count: 90, majorEvery: 7 } });
    expect(plan.count).toBe(90);
    expect(plan.ticks.filter((t) => t.major).map((t) => t.i).slice(0, 3)).toEqual([0, 7, 14]);
  });

  it('speaks "7 h 56 asleep, goal 7 h, met"; quiet speaks words only', () => {
    const p = { label: 'Sleep', value: 476, goal: 420, valueText: '7 h 56', goalText: 'of 7 h', statusText: 'Goal met', spokenValue: '7 h 56 asleep' };
    expect(spokenTick(p)).toBe('7 h 56 asleep, goal 7 h, met');
    expect(spokenTick({ ...p, quiet: true, quietText: 'on target' })).toBe('Sleep, on target');
    expect(spokenTick({ ...p, value: null })).toBe('no value yet, goal 7 h, met');
    expect(spokenTick({ ...p, state: 'loading' })).toBe('Sleep, loading');
    expect(goalLabel('limit', 'of 2 100 kcal')).toBe('Limit 2 100 kcal');
    expect(goalLabel('target', 'target 70', 'Target')).toBe('Target 70');
  });
});

describe('DotFill (P3)', () => {
  it('fills 3 rows column-major, the head after the fill', () => {
    expect(dotColumns(288)).toBe(35);
    expect(dotColumns(100)).toBe(16);
    expect(dotColumns(2000)).toBe(40);
    const m = dotModel({ value: 9664, goal: 10000, columns: 30 });
    expect(m.total).toBe(90);
    expect(m.filled).toBe(87);
    expect(m.head).toBe(29);
    expect(m.over).toBe(false);
  });

  it('over the goal: all filled, the head at the end, the multiple from twice the goal', () => {
    const m = dotModel({ value: 1644, goal: 630, columns: 20 });
    expect(m.filled).toBe(m.total);
    expect(m.head).toBe(20);
    expect(m.over).toBe(true);
    expect(m.multiple).toBe(2.6);
    expect(dotModel({ value: 1100, goal: 1000, columns: 20 }).multiple).toBeNull();
  });

  it('zero is empty with the head at the start; no value never becomes zero in words', () => {
    const z = dotModel({ value: 0, goal: 8, columns: 20 });
    expect([z.filled, z.head, z.zero]).toEqual([0, 0, true]);
    expect(spokenDots({ label: 'Steps', value: null, goal: 10000, valueText: '', goalText: 'of 10 000 steps' })).toBe('Steps, no value yet');
  });

  it('speaks "9 664 steps of a 10 000 goal"', () => {
    expect(spokenDots({ label: 'Steps', value: 9664, goal: 10000, valueText: '9\u00a0664', goalText: 'of 10\u00a0000 steps' })).toBe('9\u00a0664 steps of a 10\u00a0000 goal');
    expect(spokenDots({ label: 'Ring energy', value: 1644, goal: 630, valueText: '1\u00a0644', goalText: 'of 630 kcal', overText: '+1\u00a0014 kcal over' })).toBe(
      '1\u00a0644 kcal of a 630 goal, +1\u00a0014 kcal over, 2.6 times the goal',
    );
    expect(spokenDots({ label: 'Steps', value: 9664, goal: 10000, valueText: '9 664', goalText: 'of 10 000 steps', quiet: true })).toBe('Steps, over half of the goal');
  });
});

describe('Stat (P7)', () => {
  it('reads label, value, unit, chip; the minus is spoken', () => {
    expect(spokenStat({ label: 'HRV', value: '70', unit: 'ms', chip: { kind: 'delta', dir: 'down', text: '−14 ms vs usual', caution: true } })).toBe('HRV: 70 ms, minus 14 ms vs usual');
    expect(spokenStat({ label: 'Skin temperature', value: null, chip: { kind: 'provisional', text: 'Calibrating · night 3 of 7' } })).toBe('Skin temperature: no value, Calibrating · night 3 of 7');
    expect(spokenStat({ label: 'SpO2', value: '95', unit: '%', state: 'stale' })).toBe('SpO2: 95 %, stale');
    expect(chipText({ kind: 'status', severity: 'ok', word: 'Normal' })).toBe('Normal');
  });
});

describe('OvernightTrace (P6)', () => {
  const pts = [
    { t: T('02:25'), v: 69 },
    { t: T('02:30'), v: 64 },
    { t: T('02:35'), v: 60 },
    { t: T('03:20'), v: 55 },
    { t: T('03:25'), v: 49 },
    { t: T('03:30'), v: 59 },
  ];

  it('breaks the line past three usual steps and never bridges a gap', () => {
    expect(medianStep(pts)).toBe(5 * 60_000);
    expect(traceRuns(pts, 15 * 60_000).map((r) => r.length)).toEqual([3, 3]);
    expect(traceModel({ points: pts, from: T('02:25'), to: T('03:30') }).runs).toHaveLength(2);
  });

  it('puts three grid lines on a 1 / 2 / 5 step around the data', () => {
    expect(traceTicks(46, 79)).toEqual([40, 60, 80]);
    expect(traceTicks(52, 59)).toEqual([50, 55, 60]);
    expect(traceTicks(52, 61)).toEqual([50, 60, 70]);
  });

  it('speaks the night in one sentence', () => {
    const s = spokenTrace({ label: 'Heart rate', from: T('02:25'), to: T('11:15'), points: pts, low: { t: T('09:55'), v: 49 }, trend: { word: 'Rising', magnitude: 'Slight' }, tz: TZ });
    expect(s).toBe('Heart rate overnight, 02:25 to 11:15: starts at 69, lowest of 49 at 09:55, ends at 59, rising slightly toward morning; 6 readings');
    expect(spokenTrace({ label: 'Heart rate', from: T('02:25'), to: T('11:15'), points: pts.slice(0, 2), state: 'sparse', tz: TZ })).toBe('Heart rate overnight, 02:25 to 11:15: too few readings overnight; 2 readings');
    expect(spokenTrace({ label: 'Heart rate', from: T('02:25'), to: T('11:15'), points: [], tz: TZ })).toBe('Heart rate overnight, 02:25 to 11:15: no night recorded');
    expect(spokenTrace({ label: 'Heart rate', from: T('02:25'), to: T('11:15'), points: pts, low: { t: T('09:55'), v: 49 }, trend: { word: 'Steady' }, tz: TZ, quiet: true })).not.toMatch(/\d/);
  });

  it('words the trend', () => {
    expect(magnitudeText({ word: 'Rising', magnitude: 'Slight' })).toBe('Slight rise');
    expect(magnitudeText({ word: 'Steady' })).toBeNull();
    expect(trendPhrase({ word: 'Falling', magnitude: 'Strong' })).toBe('falling strongly toward morning');
  });
});

describe('StateStrip (P5)', () => {
  const day = { from: T('00:00'), to: T('00:00', '2026-10-27'), now: T('16:20') };
  const segs = [
    { from: T('02:20'), to: T('10:50'), state: 0 },
    { from: T('11:15'), to: T('12:40'), state: 2 },
    { from: T('13:00'), to: T('14:10'), state: 3 },
  ];
  const labels = ['Calm', 'Normal', 'Elevated', 'High'];

  it('fills uncovered spans up to now with "no reading" and never bridges them', () => {
    const tl = stateTimeline({ ...day, segments: segs });
    expect(tl.map((s) => s.state)).toEqual([null, 0, null, 2, null, 3, null]);
    expect(tl[tl.length - 1]!.to).toBe(day.now);
  });

  it('merges tiny neighbours into "Mixed" and grows a lone tiny span to 3 px', () => {
    const tiny = [
      { from: T('10:00'), to: T('10:04'), state: 1 },
      { from: T('10:04'), to: T('10:08'), state: 2 },
      { from: T('12:00'), to: T('12:04'), state: 3 },
    ];
    const d = stateSegments({ from: day.from, to: day.to, segments: tiny, width: 288 }).filter((s) => s.kind !== 'none');
    expect(d.map((s) => s.kind)).toEqual(['mixed', 'state']);
    expect(d[1]!.w).toBe(3);
  });

  it('speaks "Stress today: calm 02:20 to 10:50, …; no readings after 14:10"', () => {
    expect(spokenStrip({ label: 'Stress today', ...day, segments: segs, stateLabels: labels, tz: TZ })).toBe(
      'Stress today: no readings 00:00 to 02:20, calm 02:20 to 10:50, no readings 10:50 to 11:15, elevated 11:15 to 12:40, no readings 12:40 to 13:00, high 13:00 to 14:10; no readings after 14:10',
    );
    expect(spokenStrip({ label: 'Stress today', ...day, segments: [], stateLabels: labels })).toBe('Stress today: no readings');
    expect(spokenStrip({ label: 'Stress today', ...day, segments: segs, stateLabels: labels, quiet: true })).not.toMatch(/\d/);
  });

  it('category mode keeps the plan after now, marked planned', () => {
    const tl = stateTimeline({ ...day, mode: 'category', segments: [{ from: T('12:00'), to: T('20:00'), state: 2 }] });
    expect(tl.filter((s) => s.planned).map((s) => [s.from, s.to])).toEqual([[day.now, T('20:00')]]);
  });

  it('maps ordinal states onto the four ramp steps', () => {
    expect([0, 1, 2, 3].map((i) => rampStep(i, 4))).toEqual([1, 2, 3, 4]);
    expect([0, 1, 2].map((i) => rampStep(i, 3))).toEqual([1, 3, 4]);
  });
});

describe('ShareBar (P8)', () => {
  it('reads "Deep, 1 h 08, 14 % of the night"', () => {
    const row = { id: 'deep', label: 'Deep', valueText: '1 h 08', share: 0.14, hue: 'var(--lm-hr-zone-1)' };
    expect(spokenShare(row, 'of the night')).toBe('Deep, 1 h 08, 14\u00a0% of the night');
    expect(shareText({ share: 0 })).toBe('0\u00a0%');
    expect(spokenShare({ ...row, share: 0.6 }, 'of the night', true)).toBe('Deep, a large part of the night');
  });
});

describe('LevelBar (P1, D19)', () => {
  const edges = (bands: ReadonlyArray<{ from: number }>) => bands.map((b) => b.from).filter(Number.isFinite);

  it.each([['hr'], ['spo2'], ['stress']] as const)('%s: every band edge of ring/model BANDS is a knot on an integer column edge, for 7 and 10 columns', (kind) => {
    for (const [knots, columns] of [
      [LEVEL_KNOTS[kind], 7],
      [LEVEL_KNOTS_10[kind], 10],
    ] as Array<[Knot[], 7 | 10]>) {
      for (const edge of edges(BANDS[kind]!)) {
        const k = knots.find(([v]) => v === edge);
        expect(k, `${kind} edge ${edge}`).toBeDefined();
        expect(Number.isInteger(k![1])).toBe(true);
        expect(levelCell(edge, knots, columns)).toBe(k![1]);
        expect(levelCell(edge - 0.01, knots, columns)).toBe(k![1] - 1);
      }
    }
  });

  it('lights the SPEC columns for each band (7 columns, counted from 1)', () => {
    const col = (v: number, k: Knot[]) => levelCell(v, k, 7) + 1;
    expect([col(45, LEVEL_KNOTS.hr), col(50, LEVEL_KNOTS.hr), col(89, LEVEL_KNOTS.hr), col(90, LEVEL_KNOTS.hr), col(119, LEVEL_KNOTS.hr), col(120, LEVEL_KNOTS.hr), col(200, LEVEL_KNOTS.hr)]).toEqual([1, 2, 4, 5, 6, 7, 7]);
    expect([col(80, LEVEL_KNOTS.spo2), col(90, LEVEL_KNOTS.spo2), col(94, LEVEL_KNOTS.spo2), col(97, LEVEL_KNOTS.spo2), col(100, LEVEL_KNOTS.spo2)]).toEqual([1, 2, 4, 6, 7]);
    expect([col(10, LEVEL_KNOTS.stress), col(30, LEVEL_KNOTS.stress), col(60, LEVEL_KNOTS.stress), col(89, LEVEL_KNOTS.stress)]).toEqual([1, 2, 4, 7]);
  });

  it('personal metrics: near baseline fills the middle column (7) or the middle two (10)', () => {
    expect([-0.49, 0, 0.49].map((z) => cellOfUnit(personalKnot(z, 7), 7))).toEqual([3, 3, 3]);
    expect(cellOfUnit(personalKnot(-1.2, 7), 7)).toBe(2);
    expect(cellOfUnit(personalKnot(9, 7), 7)).toBe(6);
    expect(new Set([-0.49, -0.1, 0.1, 0.49].map((z) => cellOfUnit(personalKnot(z, 10), 10)))).toEqual(new Set([4, 5]));
  });

  it('speaks where the cell sits in the usual range', () => {
    expect(usualPhrase(3, [1, 3])).toBe('upper half of your usual range');
    expect(spokenLevel({ cell: 3, usual: [1, 3], wordText: 'Normal' })).toBe('Normal, upper half of your usual range');
    expect(spokenLevel({ cell: null, label: 'Heart rate' })).toBe('Heart rate, no reading');
    expect(spokenLevel({ cell: 2, state: 'calibrating', wordText: 'Calibrating · night 3 of 7' })).toBe('Calibrating · night 3 of 7');
  });
});

describe('ArcRuler (P4)', () => {
  const bands = [
    { from: -Infinity, word: 'Calm', severity: 'ok' as const },
    { from: 26, word: 'Normal', severity: 'ok' as const },
    { from: 51, word: 'Elevated', severity: 'caution' as const },
    { from: 76, word: 'High', severity: 'caution' as const },
  ];

  it('shows ±12 units, 5° a unit, majors every 5, band edges with their word, clipped to 0..100', () => {
    const t = arcTicks({ bands, at: 89 });
    expect(t[0]!.u).toBe(77);
    expect(t[t.length - 1]!.u).toBe(100);
    expect(t.find((x) => x.u === 90)!.major).toBe(true);
    expect(t.find((x) => x.u === 94)!.a).toBeCloseTo((5 * Math.PI) / 36);
    expect(arcTicks({ bands, at: 70 }).find((x) => x.u === 76)!.word).toBe('High');
    expect(arcTicks({ bands, at: 70, state: 'calibrating' }).some((x) => x.word)).toBe(false);
  });

  it('personal metrics mark the baseline and ±1 SD', () => {
    const words = arcTicks({ center: 78, spread: 9, window: 18, at: 70 })
      .filter((x) => x.word)
      .map((x) => [x.u, x.word]);
    expect(words).toEqual([
      [69, '−1 SD'],
      [78, 'Usual'],
      [87, '+1 SD'],
    ]);
  });

  it('speaks "Stress 89 of 100, high"', () => {
    expect(bandOf(bands, 89)!.word).toBe('High');
    expect(spokenArc({ label: 'Stress', value: 89, unit: '/ 100', bands })).toBe('Stress 89 of 100, high');
    expect(spokenArc({ label: 'Stress', value: 41, unit: '/ 100', bands, state: 'stale', ageText: '3 h ago' })).toBe('Stress 41 of 100, normal, stale, 3 h ago');
    expect(spokenArc({ label: 'Stress', value: null, bands })).toBe('Stress, no reading');
    expect(spokenArc({ label: 'Stress', value: 89, unit: '/ 100', bands, quiet: true })).toBe('Stress, high');
  });

  it('settles with one damped overshoot', () => {
    const e = bezier(0.34, 1.36, 0.64, 1);
    expect(e(0)).toBeCloseTo(0);
    expect(e(1)).toBeCloseTo(1);
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => e(i / 49)))).toBeGreaterThan(1);
  });
});

describe('DayDisc (P9)', () => {
  const arcs = [
    { id: 'recovery' as const, label: 'Recovery', score: 71 },
    { id: 'activity' as const, label: 'Activity', score: 92 },
    { id: 'sleep' as const, label: 'Sleep', score: 88 },
  ];

  it('lights round(score / 100 × 36) dots; quiet in three steps', () => {
    expect(litDots(71)).toBe(26);
    expect(litDots(null)).toBe(0);
    expect(litDots(150)).toBe(DISC_DOTS);
    expect([10, 50, 90].map((s) => litDots(s, true))).toEqual([12, 24, 36]);
    expect(arcDots('recovery')).toHaveLength(36);
  });

  it('weights equal thirds, renormalised over the scores present', () => {
    expect(arcWeights(arcs).get('sleep')).toBeCloseTo(1 / 3);
    const w = arcWeights([{ ...arcs[0]!, score: null }, arcs[1]!, arcs[2]!]);
    expect([w.get('recovery'), w.get('activity')]).toEqual([0, 0.5]);
  });

  it('speaks "Day score 84 of 100: recovery 71, activity 92, sleep 88; target 70; based on 3 of 3"', () => {
    expect(spokenDisc({ label: 'Day score', score: 84, arcs, target: 70 })).toBe('Day score 84 of 100: recovery 71, activity 92, sleep 88; target 70; based on 3 of 3');
    expect(spokenDisc({ label: 'Day score', score: 84, arcs, band: 'Good', quiet: true })).toBe('Day score, good; based on three of three');
    expect(spokenDisc({ label: 'Day score', score: 84, arcs, band: 'Good', basedOn: 'based on 3 of 3', quiet: true })).not.toMatch(/\d/);
    expect(spokenDisc({ label: 'Day score', score: null, arcs })).toBe('Day score: no score yet; based on 3 of 3');
  });
});

describe('MonitorSheet (P10) model', () => {
  it('moves, removes with memory and re-adds in place, capped at max', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(moveId(ids, 'a', 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveId(ids, 'd', -5)).toEqual(['d', 'a', 'b', 'c']);
    const mem = new Map<string, number>();
    const less = removeId(ids, 'b', mem);
    expect(less).toEqual(['a', 'c', 'd']);
    expect(addId(less, 'b', mem)).toEqual(['a', 'b', 'c', 'd']);
    expect(addId(less, 'e', mem)).toEqual(['a', 'c', 'd', 'e']);
    expect(addId(less, 'e', mem, 3)).toEqual(less);
    expect(monitorCapacity(12, 26)).toBe('12 of 26');
    expect(movedText('Resting HR', 2, 12)).toBe('Resting HR moved to position 3 of 12');
  });
});

describe('marks (P11)', () => {
  it('words the learning line', () => {
    expect(learningText(3, 7)).toBe('Learning your baseline · night 3 of 7');
  });
});
