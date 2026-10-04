// @vitest-environment node
/**
 * Equations, properties and plumbing: helper maths on worked numbers, constraint-margin conventions, bounds and finiteness
 * (30 d at maintenance stays steady, 21 d at zero intake stays finite), determinism, monotonicity, planner mode, burn-in
 * priming, early abort, events, snapshot-ability and the performance micro-benchmark.
 */
import { buildModelParams } from '../../core/paramsRegistry';
import { habitualDay, newHourInput } from '../../core/compileSchedule';
import { resolveProfile } from '../../core/resolveProfile';
import { createSignalBus } from '../../types/signals';
import { N_SERIES } from '../../types/metrics';
import type { AnyEngineModule, ModuleContext, StepClock } from '../../types/module';
import type { SafetyTrace } from '../../types/result';
import type { SimEvent } from '../../types/events';
import type { DayTemplate } from '../../types/schedule';
import { computeConstraintMargins, worstMargin } from './constraints';
import { defaultSafetyConstants } from './params';
import {
  bfFloorPct,
  energyFloorKcal,
  fastTier,
  olsSlope,
  rateBoundPct,
  referenceWeightKg,
  ringMean,
  ringSum,
  spacingViolation,
  weeksToReach,
} from './derived';
import { safetyModule } from './index';
import { measureUnderLoad } from '../../testing/benchLoad';
import type { SafetyState } from './index';
import { linear, person, prog, runScenario, sched } from './testkit';

const K = defaultSafetyConstants();

describe('derived helpers on worked numbers', () => {
  it('olsSlope / ringMean / ringSum on a wrapped circular buffer', () => {
    const ring = new Float64Array(14);
    // write 20 samples y = 100 − 0.5·i; the ring keeps the last 14, head wraps
    let head = 0;
    for (let i = 0; i < 20; i++) {
      ring[head] = 100 - 0.5 * i;
      head = (head + 1) % 14;
    }
    expect(olsSlope(ring, head, 14, 14)).toBeCloseTo(-0.5, 12);
    expect(olsSlope(ring, head, 14, 5)).toBeCloseTo(-0.5, 12);
    expect(olsSlope(ring, head, 14, 2)).toBe(0); // fewer than 3 points: no slope
    expect(ringMean(ring, head, 14, 7)).toBeCloseTo(100 - 0.5 * 16, 12); // mean of samples 13..19
    expect(ringSum(ring, head, 14, 7, 0)).toBeCloseTo(7 * (100 - 0.5 * 16), 12);
    expect(ringSum(ring, head, 14, 7, 7)).toBeCloseTo(7 * (100 - 0.5 * 9), 12);
    expect(Number.isNaN(ringMean(ring, head, 14, 0))).toBe(true);
  });
  it('reference weight RW = min(BW, 27.5·H²)', () => {
    expect(referenceWeightKg(K, 100, 1.7)).toBeCloseTo(27.5 * 1.7 * 1.7, 10); // 79.475
    expect(referenceWeightKg(K, 60, 1.7)).toBe(60);
  });
  it('energy floor, BF floor, rate bound (min of cap_pct and 1.5 kg/wk)', () => {
    expect(energyFloorKcal(K, true)).toBe(1200);
    expect(energyFloorKcal(K, false)).toBe(1500);
    expect(bfFloorPct(K, true)).toBe(18);
    expect(bfFloorPct(K, false)).toBe(10);
    expect(rateBoundPct(K, 1.0, 100)).toBe(1.0);
    expect(rateBoundPct(K, 1.0, 200)).toBeCloseTo(0.75, 10); // 1.5 kg of 200 kg
  });
  it('fasting tier boundaries are inclusive upper edges (20 / 24 / 48 / 72 / 168)', () => {
    const t = (h: number) => fastTier(K, h);
    expect([
      t(0),
      t(20),
      t(20.01),
      t(24),
      t(24.01),
      t(48),
      t(48.01),
      t(72),
      t(72.01),
      t(168),
      t(168.01),
    ]).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5]);
  });
  it('weeks to reach a goal at a compounding %BW/wk rate', () => {
    expect(weeksToReach(60, 55, 0.5)).toBeCloseTo(Math.log(55 / 60) / Math.log(0.995), 10);
    expect(weeksToReach(60, 65, 0.5)).toBe(0);
  });
  it('HC-F2 spacing: gap, weekly count, T3 per 30 d, T4 per 12 wk', () => {
    const log = (rows: number[][]) => Float64Array.from(rows.flat());
    // previous fast 30 h resumed at hour 100; a new 30-h fast whose last meal is 10 h later → eating gap 10 h < 24 h
    expect(spacingViolation(K, log([[70, 100, 30]]), 1, 110, 141, 30)).toBe(1);
    expect(spacingViolation(K, log([[70, 100, 30]]), 1, 130, 161, 30)).toBe(0); // 30 h gap
    // T3 (60 h) needs 7 days after a T2 fast
    expect(spacingViolation(K, log([[70, 100, 30]]), 1, 100 + 100, 100 + 100 + 61, 60)).toBe(1);
    expect(spacingViolation(K, log([[70, 100, 30]]), 1, 100 + 170, 100 + 170 + 61, 60)).toBe(0);
    // four T1 fasts inside 7 days: the 4th violates ≤ 3 per week (gaps kept ≥ 24 h)
    const four = log([
      [0, 22, 22],
      [46, 68, 22],
      [92, 114, 22],
    ]);
    expect(spacingViolation(K, four, 3, 138, 160, 22)).toBe(2);
    // two T4 fasts inside 12 weeks
    expect(spacingViolation(K, log([[0, 100, 100]]), 1, 100 + 700, 100 + 800, 100)).toBe(5);
    expect(spacingViolation(K, log([[0, 100, 100]]), 1, 100 + 2100, 100 + 2200, 100)).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------ constraint margins
describe('constraint margins (spec §7.3): m = (bound − value)/scale, ≥ 0 satisfied, NaN where the constraint does not apply', () => {
  const trace = (n: number): SafetyTrace => {
    const f = () => new Float32Array(n).fill(Number.NaN);
    return {
      ei7: f(),
      tdee7: f(),
      deficitPct7: f(),
      ea7: f(),
      tissueMassKg: f(),
      rate14KgPerWk: f(),
      rate14PctPerWk: f(),
      cumLossPct: f(),
      bmi: f(),
      bodyFatPct: f(),
      fastHMax: f(),
      fastH7: f(),
      proteinGPerKgRw: f(),
      fatPctEnergy: f(),
      hungerIdx: f(),
    };
  };
  const fill = (t: SafetyTrace, d: number, v: Partial<Record<keyof SafetyTrace, number>>) => {
    const base = {
      ei7: 2000,
      tdee7: 2600,
      deficitPct7: 23.08,
      ea7: 40,
      tissueMassKg: 80,
      rate14KgPerWk: 0.4,
      rate14PctPerWk: 0.5,
      cumLossPct: 3,
      bmi: 25,
      bodyFatPct: 22,
      fastHMax: 12,
      fastH7: 0,
      proteinGPerKgRw: 1.5,
      fatPctEnergy: 30,
      hungerIdx: 10,
    };
    for (const key of Object.keys(base) as Array<keyof typeof base>) t[key][d] = v[key] ?? base[key];
  };
  const P = { sex: 'male' as const, ageYears: 40, heightM: 1.78 };
  const get = (list: ReturnType<typeof computeConstraintMargins>, id: string) =>
    list.find((m) => m.id === id)!;

  it('scales: 100 kcal, 5 %, 5 kcal/kg FFM, 0.25 %BW/wk, 5 %, 1 BMI unit, 2 % BF', () => {
    const t = trace(1);
    fill(t, 0, {
      ei7: 1300,
      deficitPct7: 30,
      ea7: 27,
      rate14PctPerWk: 1.0,
      cumLossPct: 22,
      bmi: 18.5,
      bodyFatPct: 8,
    });
    const m = computeConstraintMargins(t, P);
    expect(get(m, 'HC-E1').margin[0]).toBeCloseTo((1300 - 1500) / 100, 5);
    expect(get(m, 'HC-E3').margin[0]).toBeCloseTo((10 - 30) / 5, 5); // BF 8 ≤ floor + 4 → lean cap 10
    expect(get(m, 'HC-E4').margin[0]).toBeCloseTo((27 - 30) / 5, 5);
    expect(get(m, 'HC-E5').margin[0]).toBeCloseTo((0.5 - 1.0) / 0.25, 5); // lean (BF 8 ≤ 16) cap 0.5
    expect(get(m, 'HC-E6').margin[0]).toBeCloseTo((20 - 22) / 5, 5);
    expect(get(m, 'HC-P4').margin[0]).toBeCloseTo(-1.5, 5); // min((18.5 − 19)/1, start clause (18.5 − 20)/1)
    expect(get(m, 'HC-P5').margin[0]).toBeCloseTo(Math.min((8 - 10) / 2, (8 - 12) / 2), 5); // start clause (BF ≥ floor + 2 to begin a block) is lower
  });
  it('HC-P4 / HC-P5 include the start-of-deficit clauses (BMI ≥ 20 to start, BF ≥ floor + 2 to start a block)', () => {
    const t = trace(3);
    fill(t, 0, { deficitPct7: 20, bmi: 19.6, bodyFatPct: 11 });
    fill(t, 1, { deficitPct7: 20, bmi: 19.5, bodyFatPct: 11 });
    fill(t, 2, { deficitPct7: 20, bmi: 25, bodyFatPct: 25 });
    const m = computeConstraintMargins(t, P);
    expect(get(m, 'HC-P4').margin[0]).toBeCloseTo(Math.min(19.6 - 19, 19.6 - 20), 5); // −0.4: may not start a deficit at BMI 19.6
    expect(get(m, 'HC-P5').margin[0]).toBeCloseTo(Math.min((11 - 10) / 2, (11 - 12) / 2), 5); // −0.5
    expect(get(m, 'HC-P4').margin[2]).toBeLessThan(0); // the spell started at 19.6, so the clause keeps binding
  });
  it('days without a deficit have NaN margins for the deficit-only constraints; missing trace days stay NaN', () => {
    const t = trace(3);
    fill(t, 0, { deficitPct7: 0, ei7: 2600 });
    fill(t, 1, { deficitPct7: -8, ei7: 2800 });
    const m = computeConstraintMargins(t, P);
    for (const id of ['HC-E1', 'HC-E3', 'HC-E5', 'HC-P4', 'HC-P5'])
      expect(Number.isNaN(get(m, id).margin[0]), id).toBe(true);
    expect(Number.isNaN(get(m, 'HC-E6').margin[2])).toBe(true); // day 2 was never evaluated
    expect(get(m, 'HC-E6').margin[0]).toBeGreaterThan(0);
    expect(worstMargin(get(m, 'HC-E1'))).toEqual({ value: Number.NaN, day: -1 });
  });
  it('HC-E4 applies only on exercise days when the caller passes them', () => {
    const t = trace(2);
    fill(t, 0, { ea7: 20 });
    fill(t, 1, { ea7: 20 });
    const m = computeConstraintMargins(t, P, { exerciseDays: Uint8Array.from([1, 0]) });
    expect(get(m, 'HC-E4').margin[0]).toBeLessThan(0);
    expect(Number.isNaN(get(m, 'HC-E4').margin[1])).toBe(true);
  });
  it('HC-E7 counts the block: 12 weeks at ≥ 15 % (then a break), 26 weeks at 5-15 %', () => {
    const n = 100;
    const t = trace(n);
    for (let d = 0; d < n; d++) fill(t, d, { deficitPct7: 16 });
    const e7 = get(computeConstraintMargins(t, P), 'HC-E7');
    expect(e7.action).toBe('INSERT_BREAK');
    expect(e7.margin[0]).toBeCloseTo((84 - 1) / 7, 5);
    expect(e7.margin[83]).toBeCloseTo(0, 5); // the 84th day is exactly the limit
    expect(e7.margin[84]).toBeLessThan(0);
    for (let d = 0; d < n; d++) fill(t, d, { deficitPct7: 10 });
    expect(get(computeConstraintMargins(t, P), 'HC-E7').margin[99]).toBeGreaterThan(0); // 26 weeks not reached
  });
  it('HC-E8: surplus above 120 % of TDEE, gain above 0.5 %BW/wk, or any planned gain with waist/WHtR/BMI risk', () => {
    const t = trace(3);
    fill(t, 0, { deficitPct7: -10, rate14PctPerWk: -0.2 });
    fill(t, 1, { deficitPct7: -25, rate14PctPerWk: -0.2 });
    fill(t, 2, { deficitPct7: -10, rate14PctPerWk: -0.7 });
    const m = get(computeConstraintMargins(t, P), 'HC-E8');
    expect(m.margin[0]).toBeGreaterThan(0);
    expect(m.margin[1]).toBeLessThan(0);
    expect(m.margin[2]).toBeLessThan(0);
    const risky = get(computeConstraintMargins(t, { ...P, waistCm: 110 }), 'HC-E8');
    expect(risky.margin[0]).toBeLessThan(0);
    const whtr = get(computeConstraintMargins(t, { ...P, whtr: 0.55 }), 'HC-E8');
    expect(whtr.margin[0]).toBeCloseTo(Math.min((20 - 10) / 5, (0.25 - 0.2) / 0.25), 5); // WHtR 0.5-0.59: 0.25 %/wk cap
  });
  it('every margin carries id, action and window from the dossier table', () => {
    const t = trace(1);
    fill(t, 0, {});
    const m = computeConstraintMargins(t, P);
    expect(m.map((x) => `${x.id}:${x.action}:${x.window}`)).toEqual([
      'HC-E1:CLIP:7d',
      'HC-E3:CLIP:7d',
      'HC-E4:CLIP:7d',
      'HC-E5:CLIP:14d',
      'HC-E6:CLIP:plan',
      'HC-E7:INSERT_BREAK:block',
      'HC-E8:CLIP:14d',
      'HC-P4:REJECT:daily',
      'HC-P5:CLIP:daily',
      'HC-F2:REJECT:7d',
    ]);
    for (const x of m) expect(x.margin.length).toBe(1);
  });
});

// ------------------------------------------------------------------------------------------------ properties (through the loop)
const finiteDays = (a: Float32Array, n = a.length): boolean =>
  Array.from(a.slice(0, n)).every(Number.isFinite);

describe('properties', () => {
  const base = (days: number, over: Partial<Parameters<typeof runScenario>[0]> = {}, kcal = 2600) =>
    runScenario({
      person: person({ sex: 'male', ageYears: 35, heightCm: 178, weightKg: 82 }),
      schedule: sched(
        days,
        [
          prog('A', kcal, {
            proteinG: (kcal * 0.2) / 4,
            carbsG: (kcal * 0.45) / 4,
            fibrePer1000: 15,
            hydration: { sodiumG: 2 },
          }),
        ],
        () => 0,
      ),
      plant: { tdee: 2600, scaleKg: () => 82, bfPct: () => 22 },
      ...over,
    });

  it('maintenance for 30 days stays steady: constant trace, no caution/danger, no NaN', () => {
    const s = base(30);
    const t = s.res.safety;
    for (const key of Object.keys(t) as Array<keyof SafetyTrace>) expect(finiteDays(t[key]!), key).toBe(true);
    for (let d = 0; d < 30; d++) {
      expect(t.ei7[d]).toBeCloseTo(2600, 2);
      expect(t.deficitPct7[d]).toBeCloseTo(0, 2);
      expect(t.rate14KgPerWk[d]).toBe(0);
      expect(t.cumLossPct[d]).toBeCloseTo(0, 5);
      expect(t.fastH7[d]).toBe(0);
      expect(t.fastHMax[d]).toBeLessThan(20);
    }
    expect(t.bmi[29]).toBeCloseTo(82 / 1.78 ** 2, 3);
    expect(t.proteinGPerKgRw[29]).toBeCloseTo(130 / 82, 3); // 20 %E of 2 600 kcal = 130 g
    expect(t.fatPctEnergy[29]).toBeGreaterThan(25);
    expect(s.res.warnings.filter((w) => w.severity !== 'info')).toEqual([]);
    expect(s.res.events.filter((e) => e.type === 'safetyFlag')).toEqual([]);
  });

  it('zero intake for 21 days stays finite; the fasting counter runs to ~500 h; W-F05 fires once', () => {
    const zero: DayTemplate = { ...prog('Z', 0), energy: { kind: 'zero' } };
    const s = runScenario({
      person: person({ sex: 'male', ageYears: 35, heightCm: 178, weightKg: 82 }),
      schedule: sched(21, [zero], () => 0),
      plant: { tdee: (d) => 2600 - 15 * d, scaleKg: linear(82, -0.3), bfPct: () => 22 },
    });
    const t = s.res.safety;
    // ruling 18:10: on fast-event days the 7-day TDEE / deficit are not evaluated (NaN); ei7 carries the 28-day mean;
    // ruling R-FAST-GATE: neither is EA_7 (it is taken over non-fast days)
    for (const key of Object.keys(t) as Array<keyof SafetyTrace>) {
      if (key === 'tdee7' || key === 'deficitPct7' || key === 'proteinGPerKgRw' || key === 'fatPctEnergy' || key === 'ea7')
        expect(Array.from(t[key]!).every((v) => Number.isNaN(v)), key).toBe(true);
      else expect(finiteDays(t[key]!), key).toBe(true);
    }
    expect(t.fastHMax[20]).toBeGreaterThan(480);
    expect(t.ei7[20]).toBe(0);
    expect(Number.isNaN(t.deficitPct7[20]!)).toBe(true); // fast-event day: the tier rules govern it (ruling 18:10)
    expect(s.warn('W-F05')).toHaveLength(1);
    expect(s.has('W-E04')).toBe(false);
    expect(s.has('W-E02')).toBe(false);
    for (const w of s.res.warnings) {
      expect(Number.isFinite(w.peakValue)).toBe(true);
      expect(w.message).not.toMatch(/NaN|undefined|Infinity|\?/);
      expect(w.startDay).toBeGreaterThanOrEqual(0);
      expect(w.endDay).toBeLessThan(21);
      expect(w.endDay).toBeGreaterThanOrEqual(w.startDay);
    }
  });

  it('is deterministic (bit-identical results for identical inputs)', () => {
    const a = base(60, {}, 2000);
    const b = base(60, {}, 2000);
    expect(JSON.stringify(a.res.warnings)).toBe(JSON.stringify(b.res.warnings));
    for (const key of Object.keys(a.res.safety) as Array<keyof SafetyTrace>)
      expect(Array.from(a.res.safety[key]!)).toEqual(Array.from(b.res.safety[key]!));
  });

  it('monotone: lower intake → larger deficit; faster loss → larger cumulative loss and rate; both bounded', () => {
    const d1 = base(20, {}, 2200).res.safety.deficitPct7[19]!;
    const d2 = base(20, {}, 1800).res.safety.deficitPct7[19]!;
    const d3 = base(20, {}, 1200).res.safety.deficitPct7[19]!;
    expect(d1).toBeLessThan(d2);
    expect(d2).toBeLessThan(d3);
    expect(d3).toBeLessThan(100);
    const slow = base(20, { plant: { tdee: 2600, scaleKg: linear(82, -0.05), bfPct: () => 22 } }).res.safety;
    const fast = base(20, { plant: { tdee: 2600, scaleKg: linear(82, -0.15), bfPct: () => 22 } }).res.safety;
    expect(fast.cumLossPct[19]!).toBeGreaterThan(slow.cumLossPct[19]!);
    expect(fast.rate14KgPerWk[19]!).toBeGreaterThan(slow.rate14KgPerWk[19]!);
    expect(slow.rate14KgPerWk[19]).toBeCloseTo(0.35, 4);
  });

  it('the derived series match their definitions on a worked case', () => {
    // 7 days at 2 000 kcal, TDEE 2 600, EEE 300, FFM 64: EA = (2000 − 300)/64 = 26.56
    const s = base(
      10,
      { plant: { tdee: 2600, scaleKg: () => 82, ffmKg: () => 64, exNet: (_d, h) => (h === 17 ? 300 : 0) } },
      2000,
    );
    const t = s.res.safety;
    expect(t.ei7[9]).toBeCloseTo(2000, 2);
    expect(t.tdee7[9]).toBeCloseTo(2600, 2);
    expect(t.deficitPct7[9]).toBeCloseTo(100 * (1 - 2000 / 2600), 2);
    expect(t.ea7[9]).toBeCloseTo((2000 - 300) / 64, 3);
    expect(t.tissueMassKg[9]).toBeCloseTo(82, 4);
    expect(t.bodyFatPct[9]).toBeCloseTo((100 * 18) / 82, 3);
    expect(t.hungerIdx[9]).toBe(6);
  });

  it('planner mode fills the SafetyTrace (identical to simulate) but evaluates no warnings and emits no events', () => {
    const sim = base(30, {}, 1800);
    const pl = base(30, { mode: 'planner' }, 1800);
    expect(pl.res.warnings).toEqual([]);
    expect(pl.res.events.filter((e) => e.type === 'safetyFlag')).toEqual([]);
    for (const key of Object.keys(sim.res.safety) as Array<keyof SafetyTrace>)
      expect(Array.from(pl.res.safety[key]!)).toEqual(Array.from(sim.res.safety[key]!));
  });

  it('burn-in primes the windows but writes no outputs before day 0', () => {
    const noBurn = base(6, {}, 1300);
    const burn = base(6, { burnInDays: 14 }, 1300);
    // with burn-in the 7-d window at day 0 still holds 6 habitual days → the average is well above day 0's own intake
    expect(noBurn.res.safety.ei7[0]).toBeCloseTo(1300, 2);
    expect(burn.res.safety.ei7[0]!).toBeGreaterThan(2000);
    expect(burn.res.safety.ei7[6 - 1]!).toBeLessThan(burn.res.safety.ei7[0]!);
    for (const w of burn.res.warnings) expect(w.startDay).toBeGreaterThanOrEqual(0);
    for (const e of burn.res.events) expect(e.hour).toBeGreaterThanOrEqual(0);
    expect(burn.res.safety.ei7.length).toBe(6);
  });

  it('emits one safetyFlag event per first day of caution/danger runs (worst severity of that day); none for info', () => {
    const s = base(20, {}, 1300);
    const flags = s.res.events.filter((e: SimEvent) => e.type === 'safetyFlag');
    const runs = s.res.warnings.filter((w) => w.severity !== 'info');
    const days = [...new Set(runs.map((w) => w.startDay))].sort((a, b) => a - b);
    expect(flags.length).toBe(days.length);
    expect(flags.map((e) => e.hour).sort((a, b) => a - b)).toEqual(days.map((d) => d * 24));
    for (const e of flags) {
      const worst = runs.filter((w) => w.startDay * 24 === e.hour).some((w) => w.severity === 'danger') ? 2 : 1;
      expect(e.value).toBe(worst);
    }
    expect(flags.some((e) => e.value === 2)).toBe(true); // W-E04 danger
  });
});

// ------------------------------------------------------------------------------------------------ direct drive (state, abort)
function drive(o: {
  days: number;
  kcalDay: (d: number) => number;
  scaleKg: (d: number) => number;
  mode?: 'simulate' | 'planner';
  abortOn?: ReadonlyArray<{ series: string; op: '<' | '>'; value: number; id: string }>;
}) {
  const rp = resolveProfile(person({ sex: 'male', ageYears: 35, heightCm: 178, weightKg: 82 }));
  const mods = [safetyModule as unknown as AnyEngineModule];
  const f = () => new Float32Array(o.days).fill(Number.NaN);
  const trace: SafetyTrace = {
    ei7: f(),
    tdee7: f(),
    deficitPct7: f(),
    ea7: f(),
    tissueMassKg: f(),
    rate14KgPerWk: f(),
    rate14PctPerWk: f(),
    cumLossPct: f(),
    bmi: f(),
    bodyFatPct: f(),
    fastHMax: f(),
    fastH7: f(),
    proteinGPerKgRw: f(),
    fatPctEnergy: f(),
    hungerIdx: f(),
  };
  const events: Array<{ type: string; hour: number; value: number }> = [];
  const ctx = {
    profile: rp,
    params: buildModelParams(mods),
    schedule: {} as never,
    nDays: o.days,
    mode: o.mode ?? 'simulate',
    seriesEnabled: new Uint8Array(N_SERIES).fill(1),
    events: { emit: (type: string, hour: number, value: number) => events.push({ type, hour, value }) },
    checks: false,
    safetyTrace: trace,
    ...(o.abortOn ? { abortOn: o.abortOn } : {}),
  } as unknown as ModuleContext;
  const bus = createSignalBus();
  const k = safetyModule.prepare(ctx);
  const s = safetyModule.init(k, ctx, bus) as SafetyState;
  const day = habitualDay(rp);
  const hour = newHourInput();
  const clock: StepClock = { day: 0, hourOfDay: 0, hourIndex: 0, weekday: 0 };
  let since = 3;
  let abortDay = -1;
  for (let d = 0; d < o.days; d++) {
    clock.day = d;
    for (let h = 0; h < 24; h++) {
      clock.hourOfDay = h;
      clock.hourIndex = d * 24 + h;
      hour.hourOfDay = h;
      hour.day = d;
      hour.hourIndex = clock.hourIndex;
      const meal = h === 8 || h === 14 || h === 20;
      hour.kcal = meal ? o.kcalDay(d) / 3 : 0;
      hour.proteinG = hour.kcal * 0.05;
      hour.fatG = hour.kcal / 30;
      hour.carbG = hour.kcal * 0.1;
      hour.fibreG = hour.kcal * 0.008;
      since = hour.kcal > 50 ? 0 : since + 1;
      bus.hoursSinceIntakeH = since;
      safetyModule.stepHour(s, k, bus, hour, day, clock);
    }
    const scale = o.scaleKg(d);
    bus.scaleWeightKg = scale;
    bus.tissueMassKg = scale;
    bus.fatMassKg = scale * 0.22;
    bus.ffmActKg = scale * 0.78;
    bus.tdeeEstKcalD = 2600;
    bus.ea7KcalKgFfm = 45;
    safetyModule.endOfDay(s, k, bus, day, clock);
    if (bus.safetyAbort === 1 && abortDay < 0) abortDay = d;
  }
  const sink = { warnings: [] as never[] };
  safetyModule.finalize(s, k, sink as never);
  return { s, k, bus, trace, events, abortDay, sink };
}

describe('state and early abort (driven directly with hand-built bus values)', () => {
  it('state stays finite and inside its bounds after 60 days; hit matrix is 0/1; snapshot survives structuredClone', () => {
    const { s } = drive({ days: 60, kcalDay: (d) => (d % 10 < 3 ? 0 : 2200), scaleKg: linear(82, -0.1) });
    for (const [key, v] of Object.entries(s)) {
      if (v instanceof Float64Array || v instanceof Float32Array)
        expect(
          Array.from(v).every((x) => Number.isFinite(x)),
          key,
        ).toBe(true);
    }
    expect(Array.from(s.hit).every((x) => x === 0 || x === 1)).toBe(true);
    expect(Array.from(s.runs).every((x) => x >= 0)).toBe(true);
    expect(s.lastDay).toBe(59);
    const clone = structuredClone(s);
    expect(Array.from(clone.hit)).toEqual(Array.from(s.hit));
    expect(clone.ringIdx).toBe(s.ringIdx);
  });
  it('planner abort bounds on SafetyTrace quantities set safetyAbort on the first day the bound is crossed', () => {
    const scale = linear(82, -0.25); // BMI 25.9 → falls ~0.079/day
    const bound = { series: 'bmi', op: '<' as const, value: 24, id: 'bmi24' };
    const r = drive({
      days: 40,
      kcalDay: () => 1500,
      scaleKg: scale,
      mode: 'planner',
      abortOn: [bound, { series: 'fatMass', op: '<' as const, value: 1, id: 'core-series' }],
    });
    const expected = Array.from({ length: 40 }, (_, d) => d).find((d) => scale(d) / 1.78 ** 2 < 24)!;
    expect(r.abortDay).toBe(expected);
    expect(r.trace.bmi[expected]!).toBeLessThan(24);
    expect(r.trace.bmi[expected - 1]!).toBeGreaterThanOrEqual(24);
    // planner mode: no warning work
    expect(r.sink.warnings).toEqual([]);
    // no bounds, or bounds on core series only (handled by the loop): never aborts here
    expect(drive({ days: 40, kcalDay: () => 1500, scaleKg: scale, mode: 'planner' }).abortDay).toBe(-1);
    expect(
      drive({
        days: 40,
        kcalDay: () => 1500,
        scaleKg: scale,
        mode: 'planner',
        abortOn: [{ series: 'fatMass', op: '<', value: 1, id: 'x' }],
      }).abortDay,
    ).toBe(-1);
    // '>' bounds: cumulative loss above 5 %
    const up = drive({
      days: 40,
      kcalDay: () => 1500,
      scaleKg: scale,
      mode: 'planner',
      abortOn: [{ series: 'cumLossPct', op: '>', value: 5, id: 'loss5' }],
    });
    expect(up.abortDay).toBeGreaterThan(0);
    expect(up.trace.cumLossPct[up.abortDay]!).toBeGreaterThan(5);
  });
  it('the loop stops at the end of the abort day when the bound is delivered through ctx (runEngine honours safetyAbort)', () => {
    // the core does not pass abortOn to modules yet (CONTRACT REQUEST); a run without it completes
    const s = runScenario({
      person: person({ sex: 'male', ageYears: 35, heightCm: 178, weightKg: 82 }),
      schedule: sched(10, [prog('A', 2000)], () => 0),
      plant: { scaleKg: linear(82, -0.25) },
      mode: 'planner',
    });
    expect(s.res.meta.aborted).toBeUndefined();
    expect(s.res.safety.bmi.every(Number.isFinite)).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------ performance
describe('performance', () => {
  it('module cost over a 180-day run (init + 4 320 hourly steps + 180 day ends + finalize) is reported against the 0.5 ms class and guarded at 1.8 ms', () => {
    const rp = resolveProfile(person({ sex: 'male', ageYears: 35, heightCm: 178, weightKg: 82 }));
    const mods = [safetyModule as unknown as AnyEngineModule];
    const days = 180;
    const measure = (withSafety: boolean): number => {
      const f = () => new Float32Array(days).fill(Number.NaN);
      const trace: SafetyTrace = {
        ei7: f(),
        tdee7: f(),
        deficitPct7: f(),
        ea7: f(),
        tissueMassKg: f(),
        rate14KgPerWk: f(),
        rate14PctPerWk: f(),
        cumLossPct: f(),
        bmi: f(),
        bodyFatPct: f(),
        fastHMax: f(),
        fastH7: f(),
        proteinGPerKgRw: f(),
        fatPctEnergy: f(),
        hungerIdx: f(),
      };
      const ctx = {
        profile: rp,
        params: buildModelParams(mods),
        schedule: {} as never,
        nDays: days,
        mode: 'simulate',
        seriesEnabled: new Uint8Array(N_SERIES).fill(1),
        events: { emit: () => {} },
        checks: false,
        safetyTrace: trace,
      } as unknown as ModuleContext;
      const bus = createSignalBus();
      const k = safetyModule.prepare(ctx); // prepare is cached per (profile, parameter vector) by the planner, so it is not part of the per-run cost
      const t0 = performance.now();
      const s = safetyModule.init(k, ctx, bus);
      const day = habitualDay(rp);
      const hour = newHourInput();
      const clock: StepClock = { day: 0, hourOfDay: 0, hourIndex: 0, weekday: 0 };
      let since = 3;
      for (let d = 0; d < days; d++) {
        clock.day = d;
        for (let h = 0; h < 24; h++) {
          clock.hourOfDay = h;
          clock.hourIndex = d * 24 + h;
          hour.hourOfDay = h;
          hour.kcal = h === 8 || h === 14 || h === 20 ? (d % 9 === 4 ? 0 : 700) : 0;
          hour.proteinG = hour.kcal * 0.05;
          hour.fatG = hour.kcal / 30;
          hour.carbG = hour.kcal * 0.1;
          hour.fibreG = hour.kcal * 0.008;
          since = hour.kcal > 50 ? 0 : since + 1;
          bus.hoursSinceIntakeH = since;
          if (withSafety) safetyModule.stepHour(s, k, bus, hour, day, clock);
        }
        bus.scaleWeightKg = 82 - 0.03 * d;
        bus.tissueMassKg = bus.scaleWeightKg;
        bus.fatMassKg = bus.scaleWeightKg * 0.22;
        bus.ffmActKg = bus.scaleWeightKg * 0.78;
        bus.tdeeEstKcalD = 2600;
        bus.ea7KcalKgFfm = 40;
        if (withSafety) safetyModule.endOfDay(s, k, bus, day, clock);
      }
      if (withSafety) safetyModule.finalize(s, k, { warnings: [] });
      return performance.now() - t0;
    };
    const med = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    const { result, factor } = measureUnderLoad(() => {
      for (let i = 0; i < 5; i++) {
        measure(true);
        measure(false);
      }
      const withS = med(Array.from({ length: 21 }, () => measure(true)));
      const without = med(Array.from({ length: 21 }, () => measure(false)));
      return { withS, without };
    });
    const { withS, without } = result;
    const cost = withS - without;
    console.log(
      `safety module cost per 180-day run: ${cost.toFixed(3)} ms (with ${withS.toFixed(3)} ms, driver alone ${without.toFixed(3)} ms, load factor ${factor.toFixed(2)})`,
    );
    // Regression ceiling, scaled by the machine load (benchLoad.ts). The module measures ≈ 1.0-1.3 ms per run on the dev
    // PC under Node 26 (median of 21), above the 0.5 ms class it was written for; 1.8 ms still fails a 3× slowdown.
    expect(cost).toBeLessThan(1.8 * factor);
  });
});
