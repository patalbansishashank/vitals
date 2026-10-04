/**
 * Parity vectors for `lumen-sleep-v4` (DailySleepScoreAlgorithm). Synthetic, Android-shaped inputs; expected values
 * derived by hand-executing the Kotlin (no JVM available locally). Zone UTC unless stated.
 */
import type { ScoreInput, SleepRecord, SleepStageName } from '@/biometrics/core/types';
import type { AndroidSleepSession, AndroidStageBlock, AndroidWorld } from '../adapter';
import { roundToInt, plusDays } from '../kotlin';
import { computeSleepIndexV4, sleepIndexDef, sleepIndexDefs, sleepInputsForWakingDay, type SleepScoreContext } from '../sleepIndex';

const D = '2026-09-16';
const H = 3_600_000;
const M = 60_000;
const at = (date: string, hour: number): number => Date.parse(`${date}T00:00:00Z`) + hour * H;

function session(id: string, date: string, startMs: number, total: number, spanMin = total): AndroidSleepSession {
  return { id, date, startAt: startMs, endAt: startMs + spanMin * M, totalMinutes: total };
}
function timeline(s: AndroidSleepSession, runs: Array<[string, number]>): AndroidStageBlock[] {
  let off = 0;
  return runs.map(([stage, dur]) => {
    const b = { startAt: s.startAt + off * M, durationMinutes: dur, stageRaw: stage };
    off += dur;
    return b;
  });
}
function ctx(p: Partial<SleepScoreContext> = {}): SleepScoreContext {
  return { priorPrimarySessions: [], priorBlocksBySession: {}, targetMinutes: 480, nightlyHrvMs: null, sleepingHeartRateDropBpm: null, tz: 'UTC', ...p };
}
/** Seven prior nights D−1..D−7, each starting at `startHourPrev` on the evening/day before, LIGHT for `dur` minutes. */
function priors(startHourPrev: number, dur = 480): { s: AndroidSleepSession[]; b: Record<string, AndroidStageBlock[]> } {
  const s: AndroidSleepSession[] = [];
  const b: Record<string, AndroidStageBlock[]> = {};
  for (let k = 1; k <= 7; k++) {
    const date = plusDays(D, -k);
    const p = session(`p${k}`, date, at(plusDays(date, -1), startHourPrev), dur);
    s.push(p);
    b[p.id] = timeline(p, [['LIGHT', dur]]);
  }
  return { s, b };
}
const c = (r: ReturnType<typeof computeSleepIndexV4>, id: string) => r!.contributors.find((x) => x.id === id)!;

describe('roundToInt (Kotlin Double.roundToInt = Math.round)', () => {
  it('ties go toward +infinity; NaN throws', () => {
    expect([87.5, 12.5, 0.5, -0.5, -2.5, 0.49999999999999994, 2.4999999999999996].map(roundToInt)).toEqual([88, 13, 1, -0, -2, 0, 2]);
    expect(() => roundToInt(NaN)).toThrow();
  });
});

describe('lumen-sleep-v4 parity vectors', () => {
  it('S1 naps add to duration; continuity from the primary only, leading wake excluded', () => {
    // night 02:00, AWAKE 30 LIGHT 150 AWAKE 30 DEEP 150 (total 300); nap 15:00 LIGHT 30.
    // duration = 100·330/480 = 68.75. continuity span = 330 min (from first sleep), asleep 300, awake 30,
    // eff = 30000/330 = 90.909… → c = clamp(100·20.909/15) = 100. timing: no priors → unavailable.
    // Σw = 0.75; 68.75·0.5/0.75 + 100·0.25/0.75 = 45.8333 + 33.3333 = 79.1667 → roundToInt 79.
    const n = session('night', D, at(D, 2), 300, 360);
    const nap = session('nap', D, at(D, 15), 30);
    const r = computeSleepIndexV4([n, nap], {
      night: timeline(n, [['AWAKE', 30], ['LIGHT', 150], ['AWAKE', 30], ['DEEP', 150]]),
      nap: timeline(nap, [['LIGHT', 30]]),
    }, ctx());
    expect(r!.score).toBe(79);
    expect(r!.totalSleepMinutes).toBe(330);
    expect(r!.awakeAfterOnsetMinutes).toBe(30);
    expect(r!.sleepEfficiencyPercent).toBeCloseTo(90.909, 3);
    expect(c(r, 'duration').weight).toBeCloseTo(2 / 3, 12);
    expect(c(r, 'timing_consistency').role).toBe('UNAVAILABLE');
    expect(r!.confidence).toBe('low');
    expect(r!.label).toBe('GOOD');
    expect(c(r, 'deep_sleep').value).toBe(150);
    expect(c(r, 'rem_sleep').value).toBe(0);
  });

  it('S2 a 4 h night cannot look near-perfect (all three contributors)', () => {
    // duration 100·240/480 = 50; continuity eff 100 → 100; timing: priors and current midpoints 04:00 → dev ≈ 0 → ≈ 100.
    // 50·0.5 + 100·0.25 + 100·0.25 = 75 → 75; confidence medium.
    const cur = session('cur', D, at(D, 2), 240);
    const p: { s: AndroidSleepSession[]; b: Record<string, AndroidStageBlock[]> } = { s: [], b: {} };
    for (let k = 1; k <= 7; k++) {
      const s = session(`p${k}`, plusDays(D, -k), at(plusDays(D, -k), 2), 240);
      p.s.push(s);
      p.b[s.id] = timeline(s, [['LIGHT', 240]]);
    }
    const r = computeSleepIndexV4([cur], { cur: timeline(cur, [['LIGHT', 240]]) }, ctx({ priorPrimarySessions: p.s, priorBlocksBySession: p.b }));
    expect(r!.score).toBe(75);
    expect(r!.confidence).toBe('medium');
    expect(r!.timingDeviationMinutes!).toBeLessThan(1e-6);
  });

  it('S3 no stage blocks: duration alone, 87.5 rounds half-up to 88; stage context unavailable', () => {
    const cur = session('cur', D, at(D, 1), 420);
    const r = computeSleepIndexV4([cur], { cur: [] }, ctx());
    expect(r!.score).toBe(88);
    expect(r!.label).toBe('EXCELLENT');
    expect(c(r, 'deep_sleep').role).toBe('UNAVAILABLE');
    expect(c(r, 'rem_sleep').value).toBeNull();
    expect(c(r, 'duration').weight).toBe(1);
  });

  it('S4 conflicting overlapping stages make continuity unavailable; 12.5 → 13', () => {
    const cur = session('cur', D, at(D, 1), 60);
    const blocks = [
      { startAt: cur.startAt, durationMinutes: 60, stageRaw: 'LIGHT' },
      { startAt: cur.startAt + 20 * M, durationMinutes: 10, stageRaw: 'AWAKE' },
    ];
    const r = computeSleepIndexV4([cur], { cur: blocks }, ctx());
    expect(c(r, 'continuity').role).toBe('UNAVAILABLE');
    expect(r!.score).toBe(13);
  });

  it('S5 a sparse named timeline cannot earn continuity (coverage 20/480 < 95 %)', () => {
    // duration 100·20/480 = 4.1667 → 4
    const cur = session('cur', D, at(D, 1), 20, 480);
    const blocks = [
      { startAt: cur.startAt, durationMinutes: 10, stageRaw: 'LIGHT' },
      { startAt: cur.startAt + 470 * M, durationMinutes: 10, stageRaw: 'DEEP' },
    ];
    const r = computeSleepIndexV4([cur], { cur: blocks }, ctx());
    expect(c(r, 'continuity').role).toBe('UNAVAILABLE');
    expect(r!.score).toBe(4);
  });

  it('S6 target clamps to 420–720', () => {
    const cur = session('cur', D, at(D, 0), 420);
    const b = { cur: timeline(cur, [['LIGHT', 420]]) };
    expect(computeSleepIndexV4([cur], b, ctx({ targetMinutes: 300 }))!.score).toBe(100); // target 420 → duration 100
    const cur2 = session('cur', D, at(D, 0), 540);
    // target 720: duration 75; 75·0.5/0.75 + 100·0.25/0.75 = 50 + 33.333 = 83.333 → 83
    expect(computeSleepIndexV4([cur2], { cur: timeline(cur2, [['LIGHT', 540]]) }, ctx({ targetMinutes: 900 }))!.score).toBe(83);
  });

  it('S7 total outside 1–1440 or no minutes → null', () => {
    const a = session('a', D, at(D, 0), 800);
    const b = session('b', D, at(D, 14), 700);
    expect(computeSleepIndexV4([a, b], {}, ctx())).toBeNull();
    expect(computeSleepIndexV4([session('z', D, at(D, 0), 0)], {}, ctx())).toBeNull();
    expect(computeSleepIndexV4([], {}, ctx())).toBeNull();
  });

  it('S8 continuity mid-range: eff 80 % → 66.667', () => {
    // LIGHT 160 AWAKE 80 DEEP 160: total 320 → duration 66.667; eff 32000/400 = 80 → c = 100·10/15 = 66.667.
    // 66.667·0.5/0.75 + 66.667·0.25/0.75 = 66.667 → 67
    const cur = session('cur', D, at(D, 0), 320, 400);
    const r = computeSleepIndexV4([cur], { cur: timeline(cur, [['LIGHT', 160], ['AWAKE', 80], ['DEEP', 160]]) }, ctx());
    expect(c(r, 'continuity').score).toBeCloseTo(200 / 3, 10);
    expect(r!.score).toBe(67);
    expect(r!.label).toBe('FAIR'); // 55 ≤ 67 < 70
  });

  it('S9 timing: 30 min later than a stable 03:00 midpoint → 75', () => {
    // priors 23:00→07:00 (mid 03:00); current 23:30→07:30 (mid 03:30): dev 30 → c = 100·(1 − 30/120) = 75.
    // 100·0.5 + 100·0.25 + 75·0.25 = 93.75 → 94
    const p = priors(23);
    const cur = session('cur', D, at(plusDays(D, -1), 23.5), 480);
    const r = computeSleepIndexV4([cur], { cur: timeline(cur, [['LIGHT', 480]]) }, ctx({ priorPrimarySessions: p.s, priorBlocksBySession: p.b }));
    expect(r!.timingDeviationMinutes!).toBeCloseTo(30, 9);
    expect(c(r, 'timing_consistency').score!).toBeCloseTo(75, 9);
    expect(r!.score).toBe(94);
  });

  it('S10 circular wrap across midnight: 23:50 baseline vs 00:10 → dev 20', () => {
    // 100·0.5 + 100·0.25 + 83.333·0.25 = 95.833 → 96
    const p = priors(19 + 50 / 60);
    const cur = session('cur', D, at(plusDays(D, -1), 20 + 10 / 60), 480);
    const r = computeSleepIndexV4([cur], { cur: timeline(cur, [['LIGHT', 480]]) }, ctx({ priorPrimarySessions: p.s, priorBlocksBySession: p.b }));
    expect(r!.timingDeviationMinutes!).toBeCloseTo(20, 9);
    expect(r!.score).toBe(96);
  });

  it('S11 timing eligibility: > 28 d, ending after current onset, duplicates per date and future nights do not count', () => {
    const p = priors(23);
    const keep = p.s.slice(0, 6); // 6 valid
    const old = session('old', plusDays(D, -29), at(plusDays(D, -30), 23), 480);
    const overlap = session('ov', plusDays(D, -7), at(D, 0), 30); // ends after the current named-sleep start
    const dup = { ...keep[0]!, id: 'dup' };
    const future = session('fut', plusDays(D, 1), at(D, 23), 480);
    const blocks: Record<string, AndroidStageBlock[]> = { ...p.b };
    for (const s of [old, overlap, dup, future]) blocks[s.id] = timeline(s, [['LIGHT', s.totalMinutes]]);
    const cur = session('cur', D, at(plusDays(D, -1), 23.5), 480);
    const r = computeSleepIndexV4([cur], { cur: timeline(cur, [['LIGHT', 480]]) },
      ctx({ priorPrimarySessions: [...keep, old, overlap, dup, future], priorBlocksBySession: blocks }));
    expect(c(r, 'timing_consistency').role).toBe('UNAVAILABLE');
    expect(r!.score).toBe(100);
  });

  it('S12 UNKNOWN minutes count as asleep; 95 % named-coverage boundary', () => {
    // LIGHT 200 UNKNOWN 20 DEEP 200: total 420, named 400/420 = 95.2 % → usable; span coverage 40000 ≥ 39900;
    // eff 100 → 100; duration 87.5 → 87.5·0.5/0.75 + 100·0.25/0.75 = 91.667 → 92
    const cur = session('cur', D, at(D, 0), 420);
    const r = computeSleepIndexV4([cur], { cur: timeline(cur, [['LIGHT', 200], ['UNKNOWN', 20], ['DEEP', 200]]) }, ctx());
    expect(r!.score).toBe(92);
    // UNKNOWN 30: 400/430 = 93 % → continuity unavailable; duration 100·430/480 = 89.583 → 90
    const cur2 = session('cur', D, at(D, 0), 430);
    const r2 = computeSleepIndexV4([cur2], { cur: timeline(cur2, [['LIGHT', 200], ['UNKNOWN', 30], ['DEEP', 200]]) }, ctx());
    expect(c(r2, 'continuity').role).toBe('UNAVAILABLE');
    expect(r2!.score).toBe(90);
  });

  it('S13 primary tie keeps the earliest session (Kotlin maxByOrNull)', () => {
    const a = session('a', D, at(D, 0), 200);
    const b = session('b', D, at(D, 10), 200);
    const r = computeSleepIndexV4([a, b], { a: timeline(a, [['LIGHT', 200]]), b: [] }, ctx());
    expect(r!.primarySessionId).toBe('a');
    expect(c(r, 'continuity').role).toBe('SCORED');
  });
});

describe('forWakingDay context and the ScoreInput adapter', () => {
  it('nightly HRV = upper median, HR drop = profile baseline − index-p10', () => {
    const cur = session('cur', D, at(D, 0), 480);
    const hrv = [70, 40, 60, 50, 0.5, 400].map((v, i) => ({ t: cur.startAt + i * 10 * M, value: v })); // 1–300 kept → [40,50,60,70] → [2] = 60
    const hr = [50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 25].map((v, i) => ({ t: cur.startAt + i * 5 * M, value: v })); // 11 kept → idx round(1.0) = 1 → 51
    const w: AndroidWorld = {
      tz: 'UTC', nowMs: at(D, 12), sessions: [cur], blocksBySession: { cur: timeline(cur, [['LIGHT', 480]]) },
      measurements: { HRV: hrv, HEART_RATE: hr, TEMPERATURE: [], SPO2: [] }, activity: [], sleepGoalMinutes: null, hrRestingBaseline: 58, priorDayNutritionScore: null,
    };
    const i = sleepInputsForWakingDay(w, D)!;
    expect(i.context.nightlyHrvMs).toBe(60);
    expect(i.context.sleepingHeartRateDropBpm).toBe(7);
    expect(i.context.targetMinutes).toBe(480);
  });

  it('ScoreDef.compute on SleepRecords equals the pure port (S1 shape)', () => {
    const iso = (ms: number) => new Date(ms).toISOString();
    const t0 = at(D, 2);
    const runs: Array<[SleepStageName, number]> = [['awake', 30], ['light', 150], ['awake', 30], ['deep', 150]];
    let off = 0;
    const stages = runs.map(([stage, d]) => {
      const s = { start: iso(t0 + off * M), end: iso(t0 + (off + d) * M), stage };
      off += d;
      return s;
    });
    const rec = (id: string, start: number, end: number, st: SleepRecord['stages']): SleepRecord => ({
      kind: 'sleep', record_id: id, version: 1, is_main: id === 'night', asleep_s: 0, stages: st,
      time: { start: iso(start), end: iso(end), tz_offset_s: 0, local_date: D },
      provenance: { channel: 'manual', recording_method: 'automatic', modality: 'sensed', ingested_at: '2026-09-16T12:00:00.000Z' },
      quality: { validation: 'vendor_proprietary', confidence: null, flags: [] },
    });
    const night = rec('night', t0, t0 + 360 * M, stages);
    const nap = rec('nap', at(D, 15), at(D, 15.5), [{ start: iso(at(D, 15)), end: iso(at(D, 15.5)), stage: 'light' }]);
    const input: ScoreInput = {
      localDate: D, tz: 'UTC', profile: {}, series: {}, workouts: [], prior: {}, computedAt: '2026-10-01T00:00:00.000Z', build: 'test',
      days: [{ localDate: D, mainSleep: night, sleeps: [night, nap], workouts: [], spots: [], sourceByMetric: {}, tierByMetric: {}, basisByMetric: {}, corrections: [] }],
    };
    const r = sleepIndexDef.compute(input);
    expect(r.status).toBe('ok');
    expect(r.value).toBe(79);
    expect(r.scope).toEqual({ kind: 'night', localDate: D });
    expect(r.contributors.find((x) => x.id === 'continuity')).toMatchObject({ available: true, component: 100, weightConfigured: 0.25 });
    expect(r.contributors.find((x) => x.id === 'timing_consistency')).toMatchObject({ available: false, weightApplied: 0 });
    expect(sleepIndexDefs[0]!.compute({ ...input, days: [] })).toMatchObject({ status: 'withheld', value: null });
    expect(sleepIndexDef.compute(input).inputsHash).toBe(r.inputsHash);
  });
});
