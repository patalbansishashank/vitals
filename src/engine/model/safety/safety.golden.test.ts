// @vitest-environment node
/**
 * Dossier 17 §7 golden tests GT-01 … GT-13: each input regime → the expected rule classification. They test rule logic,
 * not physiology: the "plant" in testkit.ts supplies plausible body-size trajectories, the schedules are real.
 * Every case also checks the neighbour (the regime one step inside the envelope does NOT fire).
 */
import { computeConstraintMargins, worstMargin } from './constraints';
import type { ConstraintPerson } from './constraints';
import { defaultSafetyConstants } from './params';
import { deficitCapPct, minIntakeForEa, rateCapPct, weeksToReach, weightAtBfFloorKg } from './derived';
import type { Scenario } from './testkit';
import { linear, person, prog, runScenario, sched } from './testkit';
import type { ConstraintMargin } from '../../types/events';

const K = defaultSafetyConstants();

function margins(s: Scenario, p: ConstraintPerson, opts = {}): (id: string) => ConstraintMargin {
  const list = computeConstraintMargins(s.res.safety, p, opts);
  return (id) => list.find((m) => m.id === id)!;
}
const minM = (m: ConstraintMargin): number => worstMargin(m).value;

const F = (heightM: number): ConstraintPerson => ({ sex: 'female', ageYears: 30, heightM });
const M = (heightM: number): ConstraintPerson => ({ sex: 'male', ageYears: 30, heightM });

describe('GT-01  F 30 y 165 cm 68 kg, TDEE 2000, EI 1000 kcal/d × 8 wk', () => {
  const run = (kcal: number) =>
    runScenario({
      person: person({ sex: 'female', ageYears: 30, heightCm: 165, weightKg: 68 }),
      schedule: sched(56, [prog('A', kcal, { proteinG: 80, carbsG: 110 })], () => 0),
      plant: { tdee: 2000, scaleKg: linear(68, -0.06), bfPct: () => 32 },
    });
  it('Simulator: W-E01 + W-E04 (deficit 50 % > 40 %), not W-E02 / W-E03', () => {
    const s = run(1000);
    expect(s.has('W-E01')).toBe(true);
    expect(s.has('W-E04')).toBe(true);
    expect(s.has('W-E02')).toBe(false); // EI7 = 1000 ≥ 800
    expect(s.has('W-E03')).toBe(false); // the caution band ends at 40 %
    expect(s.res.safety.deficitPct7[10]).toBeCloseTo(50, 3);
    expect(s.warn('W-E04')[0]!.severity).toBe('danger');
  });
  it('Planner: HC-E1 and HC-E3 margins are negative (REJECT)', () => {
    const m = margins(run(1000), F(1.65));
    expect(minM(m('HC-E1'))).toBeCloseTo((1000 - 1200) / 100, 5);
    expect(minM(m('HC-E3'))).toBeLessThan(0);
  });
  it('neighbour: 1700 kcal/d (15 % deficit) fires neither rule and satisfies both constraints', () => {
    const s = run(1700);
    expect(s.has('W-E01') || s.has('W-E04') || s.has('W-E03')).toBe(false);
    const m = margins(s, F(1.65));
    expect(minM(m('HC-E1'))).toBeGreaterThanOrEqual(0);
    expect(minM(m('HC-E3'))).toBeGreaterThanOrEqual(0);
  });
});

describe('GT-02  sedentary F, FFM 42 kg, EEE 630 kcal/d, EA arms 45 / 30 / 20 / 10', () => {
  const arm = (ea: number, days: number) =>
    runScenario({
      person: person({ sex: 'female', ageYears: 30, heightCm: 165, weightKg: 62 }),
      schedule: sched(days, [prog('A', 42 * ea + 630, { proteinG: 100, carbsG: 150 })], () => 0),
      // TDEE = sedentary TDEE0 (Mifflin 1 340 kcal × PAL 1.45 ≈ 1 945) + the 630 kcal EEE: the EA arms are the deficits the
      // dossier describes (EA rules need a deficit since the integration pass, `safety.eaNeedsDeficit`)
      plant: { tdee: 2575, scaleKg: () => 62, ffmKg: () => 42, exNet: (_d, h) => (h === 17 ? 630 : 0) },
    });
  it('EA 45: nothing fires; margin +3', () => {
    const s = arm(45, 5);
    for (const id of ['W-E07', 'W-E08', 'W-E09', 'W-E20']) expect(s.has(id)).toBe(false);
    expect(minM(margins(s, F(1.65))('HC-E4'))).toBeCloseTo(3, 4);
  });
  it('EA 30 sits at the bound: margin 0, no W-E08; W-E07 only after more than 14 days', () => {
    const short = arm(30, 5);
    expect(minM(margins(short, F(1.65))('HC-E4'))).toBeCloseTo(0, 5);
    expect(short.has('W-E08')).toBe(false);
    expect(short.has('W-E07')).toBe(false);
    const long = arm(30, 21);
    expect(long.has('W-E07')).toBe(true);
    expect(long.warn('W-E07')[0]!.startDay).toBe(14); // the 15th day: "for > 14 d"
    expect(long.has('W-E08')).toBe(false);
  });
  it('EA 20 and 10: W-E08 danger; Planner CLIP (margin < 0) up to the EI that restores EA 30', () => {
    for (const ea of [20, 10]) {
      const s = arm(ea, 5);
      expect(s.has('W-E08')).toBe(true);
      expect(s.warn('W-E08')[0]!.severity).toBe('danger');
      expect(minM(margins(s, F(1.65))('HC-E4'))).toBeCloseTo((ea - 30) / 5, 4);
    }
    expect(minIntakeForEa(K, 42, 630)).toBe(1890);
  });
  it('EA 35-45 is the info band W-E09 (neighbour of 45)', () => {
    expect(arm(40, 5).has('W-E09')).toBe(true);
    expect(arm(45, 5).has('W-E09')).toBe(false);
  });
});

describe('GT-03  75 kg male athlete: −0.7 %/wk vs −1.4 %/wk; the same athlete at BF 15 % has cap 0.5 %', () => {
  const run = (pctPerWk: number, bf: number) =>
    runScenario({
      person: person({ sex: 'male', ageYears: 28, heightCm: 178, weightKg: 75 }),
      schedule: sched(56, [prog('A', 2100, { proteinG: 170, carbsG: 220 })], () => 0),
      plant: { tdee: 2650, scaleKg: linear(75, (-0.01 * pctPerWk * 75) / 7), bfPct: () => bf },
    });
  it('BF 18 %: 0.7 %/wk is allowed (cap 0.75)', () => {
    const s = run(0.7, 18);
    expect(s.has('W-E05')).toBe(false);
    expect(minM(margins(s, M(1.78))('HC-E5'))).toBeGreaterThanOrEqual(0);
  });
  it('BF 18 %: 1.4 %/wk fires W-E05 (not W-E06: 1.05 kg/wk ≤ 1.5) and the Planner REJECTs', () => {
    const s = run(1.4, 18);
    expect(s.has('W-E05')).toBe(true);
    expect(s.has('W-E06')).toBe(false);
    expect(minM(margins(s, M(1.78))('HC-E5'))).toBeLessThan(0);
  });
  it('BF 15 % (≤ floor + 6): cap 0.5 %, so 0.7 %/wk is clipped and fires W-E05', () => {
    expect(rateCapPct(K, 23.7, 28, 15, 10, false)).toBe(0.5);
    const s = run(0.7, 15);
    expect(s.has('W-E05')).toBe(true);
    expect(minM(margins(s, M(1.78))('HC-E5'))).toBeLessThan(0);
  });
});

describe('GT-04  M 26 y, BF 14.8 % → 4.5 % over 6 months', () => {
  const bf = (d: number): number => 14.8 - (10.3 / 180) * d;
  const s = runScenario({
    person: person({ sex: 'male', ageYears: 26, heightCm: 178, weightKg: 75 }),
    schedule: sched(180, [prog('A', 2000, { proteinG: 170, carbsG: 200 })], () => 0),
    plant: { tdee: 2700, ffmKg: () => 63.9, scaleKg: (d) => 63.9 / (1 - bf(d) / 100) },
  });
  it('W-E15 (caution) starts when BF < 12 %, W-E16 (danger) when BF < 8 %; exclusive bands', () => {
    const e15 = s.warn('W-E15')[0]!;
    const e16 = s.warn('W-E16')[0]!;
    expect(bf(e15.startDay - 1)).toBeGreaterThanOrEqual(12);
    expect(bf(e15.startDay)).toBeLessThan(12);
    expect(bf(e16.startDay - 1)).toBeGreaterThanOrEqual(8);
    expect(bf(e16.startDay)).toBeLessThan(8);
    expect(e15.endDay).toBe(e16.startDay - 1);
    expect(e16.severity).toBe('danger');
    expect(e16.peakValue).toBeLessThan(5);
  });
  it('Planner CLIP at 10 %: HC-P5 margin is ≥ 0 until BF reaches the floor and negative below it', () => {
    const p5 = margins(s, M(1.78))('HC-P5').margin;
    for (let d = 0; d < 180; d++) {
      const v = p5[d]!;
      if (Number.isNaN(v)) continue;
      if (bf(d) > 10.05) expect(v).toBeGreaterThan(0);
      if (bf(d) < 9.95) expect(v).toBeLessThan(0);
    }
  });
});

describe('GT-05  F 27 y BMI 23.5 → 20.6 (−12 % BW) over 4 months', () => {
  const s = runScenario({
    person: person({ sex: 'female', ageYears: 27, heightCm: 165, weightKg: 64 }),
    schedule: sched(120, [prog('A', 1700, { proteinG: 100, carbsG: 170 })], () => 0),
    plant: { tdee: 2000, scaleKg: linear(64, -7.9 / 120), bfPct: (d) => 28 - (11 / 120) * d },
  });
  it('BMI end OK: no W-E13 / W-E14; HC-P4 margin stays positive', () => {
    expect(s.res.safety.bmi[119]).toBeGreaterThan(20.5);
    expect(s.has('W-E13')).toBe(false);
    expect(s.has('W-E14')).toBe(false);
    expect(minM(margins(s, F(1.65))('HC-P4'))).toBeGreaterThan(0);
  });
  it('BF floor 18 % binds (HC-P5 < 0) and the menstrual flag W-E18 fires', () => {
    expect(minM(margins(s, F(1.65))('HC-P5'))).toBeLessThan(0);
    expect(s.has('W-E18')).toBe(true);
  });
});

describe('GT-06  100 kg, BMI 33: −1.6 kg/wk vs ≈ −1.0 kg/wk', () => {
  // The rate is a percentage of the CURRENT tissue mass (window mean), so a constant kg/wk plan drifts up in %/wk as weight
  // falls: 1.0 kg/wk starts at 1.0 %/wk and crosses the 1.0 % cap after a few weeks. Hence 0.9 kg/wk over 4 weeks here.
  const run = (kgPerWk: number, days = 56) =>
    runScenario({
      person: person({ sex: 'male', ageYears: 40, heightCm: 174, weightKg: 100 }),
      schedule: sched(days, [prog('A', 2300, { proteinG: 150, carbsG: 220 })], () => 0),
      plant: { tdee: 3100, scaleKg: linear(100, -kgPerWk / 7), bfPct: () => 33 },
    });
  it('−1.6 kg/wk: W-E06 danger, Planner REJECT', () => {
    const s = run(1.6);
    expect(s.has('W-E06')).toBe(true);
    expect(s.warn('W-E06')[0]!.severity).toBe('danger');
    expect(minM(margins(s, M(1.74))('HC-E5'))).toBeLessThan(0);
  });
  it('≈ −1.0 kg/wk (0.9 kg/wk ≈ 0.9-1.0 %/wk): allowed at BMI ≥ 30 (cap 1.0 %)', () => {
    const s = run(0.9, 28);
    expect(s.has('W-E06')).toBe(false);
    expect(s.has('W-E05')).toBe(false);
    expect(minM(margins(s, M(1.74))('HC-E5'))).toBeGreaterThanOrEqual(0);
  });
});

describe('GT-07 / GT-10  long fasts: T4 and T5, refeeding ramp', () => {
  const fast = (
    person0: Parameters<typeof person>[0],
    hours: number,
    refeed: 'none' | 'auto',
    extra?: { alcohol?: boolean; bf?: number; days?: number },
  ) => {
    const days = extra?.days ?? Math.ceil(hours / 24) + 8;
    const programs = [
      prog('A', 0, { pctMaintenance: 100 }),
      prog('ALC', 0, { pctMaintenance: 100, substances: { alcohol: [{ clockH: 12, drinks: 2 }] } }),
    ];
    const resumeDay = 3 + Math.floor((20 + hours) / 24);
    return runScenario({
      person: person(person0),
      schedule: sched(days, programs, (d) => (extra?.alcohol && d === resumeDay + 1 ? 1 : 0), [
        { kind: 'fast', startDay: 3, startH: 20, durationH: hours, electrolytes: true, refeed },
      ]),
      plant: { scaleKg: linear(person0.weightKg, -0.25), bfPct: () => extra?.bf ?? 30 },
    });
  };
  it('GT-07  F 50 y BMI 28, 10-d water fast: W-F05 danger, once (no T1-T4 staircase); refeed ramp required', () => {
    const p = { sex: 'female' as const, ageYears: 50, heightCm: 165, weightKg: 76.2 };
    const s = fast(p, 240, 'none', { bf: 40 });
    expect(s.has('W-F05')).toBe(true);
    expect(s.warn('W-F05')[0]!.severity).toBe('danger');
    for (const id of ['W-F01', 'W-F02', 'W-F03', 'W-F04']) expect(s.has(id)).toBe(false);
    expect(s.has('W-F11')).toBe(true);
    expect(s.has('W-F10')).toBe(false); // BMI 28 ≥ 25
    expect(s.has('W-F08')).toBe(true); // refeed:'none' → a big first meal after 3+ days
    expect(fast(p, 240, 'auto', { bf: 40 }).has('W-F08')).toBe(false); // ramp present
  });
  it('GT-10  BMI 17.5, 6-d fast, alcohol after it: W-F04, W-F08, W-F10, W-E14, W-M19, W-20-FAST-LEAN', () => {
    const p = { sex: 'female' as const, ageYears: 30, heightCm: 165, weightKg: 47.6 };
    const s = fast(p, 144, 'none', { alcohol: true, bf: 18 });
    for (const id of ['W-F04', 'W-F08', 'W-F10', 'W-E14', 'W-M19', 'W-20-FAST-LEAN'])
      expect(s.has(id)).toBe(true);
    for (const id of ['W-F01', 'W-F02', 'W-F03', 'W-F05']) expect(s.has(id)).toBe(false);
    const clean = fast(p, 144, 'auto', { bf: 18 });
    expect(clean.has('W-F08')).toBe(false);
    expect(clean.has('W-M19')).toBe(false);
  });
});

describe('GT-08  F BMI 30.6, 5:2 (2 × 650 + 5 × 1750 kcal, weekly mean 1436, TDEE 2000 → 28 %)', () => {
  const run = (weightKg: number, threeLowDays = false) =>
    runScenario({
      person: person({ sex: 'female', ageYears: 40, heightCm: 165, weightKg }),
      schedule: sched(
        35,
        [prog('N', 1750, { proteinG: 100, carbsG: 200 }), prog('L', 650, { proteinG: 60, carbsG: 60 })],
        (d) => (d % 7 >= (threeLowDays ? 4 : 5) ? 1 : 0),
      ),
      plant: { tdee: 2000, scaleKg: () => weightKg, bfPct: () => 40 },
    });
  it('BMI 30.6: passes HC-E1 (1436 ≥ 1200) and HC-E3 (28 % ≤ 30 %); no W-E03', () => {
    const s = run(83.3);
    const m = margins(s, F(1.65));
    expect(minM(m('HC-E1'))).toBeGreaterThanOrEqual(0);
    expect(minM(m('HC-E3'))).toBeGreaterThanOrEqual(0);
    expect(s.res.safety.deficitPct7[13]).toBeCloseTo(28.2, 1);
    expect(s.has('W-E03')).toBe(false);
  });
  it('same pattern at BMI 24 (cap 20 %): HC-E3 negative (CLIP) and W-E03 fires', () => {
    const s = run(65.3);
    expect(minM(margins(s, F(1.65))('HC-E3'))).toBeLessThan(0);
    expect(s.has('W-E03')).toBe(true);
  });
  it('W-F12 needs ≥ 3 consecutive < 800-kcal days with protein ≥ 30 %E: not the 2-day 5:2, yes the 3-day variant', () => {
    expect(run(83.3).has('W-F12')).toBe(false);
    expect(run(83.3, true).has('W-F12')).toBe(true);
  });
});

describe('GT-09  healthy F BMI 25, 36-h fasts on alternate days for 4 wk (fastH_7 ≈ 126 h)', () => {
  // meal to meal (ruling 18:10): the 20:00 dinner → 08:00 breakfast two days later = 36 h
  const events = Array.from({ length: 14 }, (_, i) => ({
    kind: 'fast' as const,
    startDay: 2 * i,
    startH: 20,
    durationH: 36,
    electrolytes: true,
    refeed: 'none' as const,
  }));
  const s = runScenario({
    person: person({ sex: 'female', ageYears: 35, heightCm: 165, weightKg: 68 }),
    schedule: sched(28, [prog('A', 0, { pctMaintenance: 100 })], () => 0, events),
    plant: { scaleKg: () => 68, bfPct: () => 32 },
  });
  it('Simulator: W-F13 caution (and the T2 caution W-F02, spacing W-F07), never a T3 warning', () => {
    expect(s.has('W-F13')).toBe(true);
    expect(s.warn('W-F13')[0]!.severity).toBe('caution');
    expect(s.has('W-F02')).toBe(true);
    expect(s.has('W-F07')).toBe(true);
    expect(s.has('W-F03')).toBe(false);
    const f7 = Array.from(s.res.safety.fastH7).filter((v) => !Number.isNaN(v));
    expect(Math.max(...f7)).toBeGreaterThan(108);
    expect(Math.max(...f7)).toBeLessThan(150);
    // fast_h counts whole hours since the last intake hour: a 36-h meal-to-meal fast peaks at 35 before the 08:00 meal
    expect(s.res.safety.fastHMax[10]).toBe(35);
  });
  it('Planner: HC-F2 (fastH_7 ≤ 108 h) margin is negative → REJECT', () => {
    expect(minM(margins(s, F(1.65))('HC-F2'))).toBeLessThan(0);
  });
});

describe('GT-11  SGLT2-inhibitor user, net carbohydrate 30 g/d', () => {
  const run = (flags: Record<string, unknown>) =>
    runScenario({
      person: person({ sex: 'male', ageYears: 45, heightCm: 178, weightKg: 85 }, { mode: 'R2', flags }),
      schedule: sched(14, [prog('A', 2000, { proteinG: 130, carbsG: 30 })], () => 0),
      plant: { tdee: 2000, scaleKg: () => 85, bfPct: () => 25 },
    });
  it('Simulator: W-M10 + W-P04 danger; the ketosis info W-M08 as well', () => {
    const s = run({ diabetesMedication: 'sglt2' });
    expect(s.has('W-M10')).toBe(true);
    expect(s.has('W-P04')).toBe(true);
    expect(s.has('W-M08')).toBe(true);
    expect(s.warn('W-M10')[0]!.severity).toBe('danger');
    expect(s.warn('W-P04')[0]!.severity).toBe('danger');
  });
  it('neighbour: the same diet without the medication flag fires W-M08 only', () => {
    const s = run({});
    expect(s.has('W-M08')).toBe(true);
    expect(s.has('W-M10')).toBe(false);
    expect(s.has('W-P04')).toBe(false);
  });
});

describe('GT-12  M FFM 65 kg, EEE 900 kcal/d, EI 2400 kcal/d → EA 23', () => {
  const s = runScenario({
    person: person({ sex: 'male', ageYears: 35, heightCm: 180, weightKg: 85 }),
    schedule: sched(10, [prog('A', 2400, { proteinG: 160, carbsG: 250 })], () => 0),
    plant: { tdee: 3300, scaleKg: () => 85, ffmKg: () => 65, exNet: (_d, h) => (h === 17 ? 900 : 0) },
  });
  it('W-E08 fires with EA = 23.1 and the Planner CLIPs EI up to 2 850 kcal', () => {
    expect(s.has('W-E08')).toBe(true);
    expect(s.res.safety.ea7[5]).toBeCloseTo(23.08, 1);
    expect(s.warn('W-E08')[0]!.message).toContain('23.1');
    expect(minM(margins(s, M(1.8))('HC-E4'))).toBeCloseTo((23.077 - 30) / 5, 2);
    expect(minIntakeForEa(K, 65, 900)).toBe(2850);
  });
});

describe('GT-13  F 165 cm, 60 kg (BMI 22.0), BF 24 %, wants 55 kg in 8 wk', () => {
  it('BMI 20.2 is fine, but 0.63 kg/wk ≈ 1.05 %/wk exceeds the 0.5 %/wk cap (BF ≤ floor + 6); earliest feasible ≈ 17 wk', () => {
    expect(55 / 1.65 ** 2).toBeGreaterThan(20);
    expect(rateCapPct(K, 22.0, 30, 24, 18, true)).toBe(0.5);
    expect((100 * 0.625) / 60).toBeGreaterThan(1.0);
    expect(weeksToReach(60, 55, 0.5)).toBeGreaterThan(16.5);
    expect(weeksToReach(60, 55, 0.5)).toBeLessThan(18);
    expect(weightAtBfFloorKg(45.6, 18)).toBeCloseTo(55.6, 1);
  });
  it('trajectory 60 → 55 kg in 8 wk: W-E05 fires, HC-E5 is negative, HC-P4 fine, the BF floor binds near 55.6 kg', () => {
    const s = runScenario({
      person: person({ sex: 'female', ageYears: 33, heightCm: 165, weightKg: 60 }),
      schedule: sched(56, [prog('A', 1500, { proteinG: 100, carbsG: 150 })], () => 0),
      plant: { tdee: 2000, scaleKg: linear(60, -5 / 56), ffmKg: () => 45.6 },
    });
    expect(s.has('W-E05')).toBe(true);
    const m = margins(s, F(1.65));
    expect(minM(m('HC-E5'))).toBeLessThan(0);
    expect(minM(m('HC-P4'))).toBeGreaterThan(0);
    const p5 = m('HC-P5').margin;
    const first = Array.from(p5).findIndex((v) => v < 0);
    expect(first).toBeGreaterThan(0);
    expect(60 - (5 / 56) * first).toBeLessThan(55.7); // negative once weight falls to ≈ 55.6 kg
    expect(60 - (5 / 56) * (first - 1)).toBeGreaterThanOrEqual(55.5);
  });
});

describe('caps (17 §2.3)', () => {
  it('deficit cap: 25 / BMI ≥ 30 → 30 / BMI < 25 → 20 / age ≥ 65 → ≤ 15 / lean (BF ≤ floor + 4) → ≤ 10', () => {
    expect(deficitCapPct(K, 27, 40, 25, 10)).toBe(25);
    expect(deficitCapPct(K, 31, 40, 35, 10)).toBe(30);
    expect(deficitCapPct(K, 22, 40, 25, 10)).toBe(20);
    expect(deficitCapPct(K, 31, 66, 35, 10)).toBe(15);
    expect(deficitCapPct(K, 27, 66, 25, 10)).toBe(15);
    expect(deficitCapPct(K, 23, 30, 14, 10)).toBe(10);
    expect(deficitCapPct(K, 23, 30, 14.1, 10)).toBe(20);
  });
  it('rate cap: 0.75 / lean 0.5 / high adiposity 1.0 / age ≥ 65 → ≤ 0.5', () => {
    expect(rateCapPct(K, 26, 40, 25, 10, false)).toBe(0.75);
    expect(rateCapPct(K, 23, 40, 16, 10, false)).toBe(0.5);
    expect(rateCapPct(K, 23, 40, 16.1, 10, false)).toBe(0.75);
    expect(rateCapPct(K, 31, 40, 28, 10, false)).toBe(1.0);
    expect(rateCapPct(K, 26, 40, 30, 10, false)).toBe(1.0);
    expect(rateCapPct(K, 26, 40, 39.9, 18, true)).toBe(0.75);
    expect(rateCapPct(K, 26, 40, 40, 18, true)).toBe(1.0);
    expect(rateCapPct(K, 31, 66, 35, 10, false)).toBe(0.5);
  });
});
