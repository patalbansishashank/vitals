// @vitest-environment node
/**
 * Ruling R-FAST-GATE (2026-10-01), item 1: the 7-day energy availability (EA_7, 17 §2.1) behind HC-E4 / W-E07 / W-E08 /
 * W-E20 is taken over NON-fast days when a planned fast-event day lies in the trailing 7 days — the mean of the last seven
 * non-fast days, searched back through the 28-day window — matching ruling 18:10, which already exempts fast days from
 * the 7-day intake and deficit checks. Before, one zero day in a training week dragged the eating days' EA below 30 and
 * raised W-E08 (danger), and the planner's EA floor then removed every fast for people who train.
 * Weeks without a fast keep the old semantics exactly (the bus EA_7), and a fast never hides low EA on the eating days.
 */
import { describe, expect, it } from 'vitest';
import type { DayTemplate } from '../../types/schedule';
import { person, prog, runScenario, sched } from './testkit';

const MAN = person({ sex: 'male', ageYears: 35, heightCm: 178, weightKg: 82 });
const zero: DayTemplate = { ...prog('Z', 0), energy: { kind: 'zero' } };
/** Zero-energy days (planned fast-event days) on these day indices. */
const ZERO_DAYS = new Set([10, 17, 24]);

/**
 * FFM 64 kg, TDEE 2 600 kcal/d, 300 kcal of session exercise at 17:00 on eating days (none on fast days, 17 HC-F4):
 * eating-day EA = (kcal − 300)/64.
 */
function week(kcal: number, days = 30, withFasts = true) {
  return runScenario({
    person: MAN,
    schedule: sched(days, [prog('A', kcal, { proteinG: 140, carbsG: 220 }), zero], (d) => (withFasts && ZERO_DAYS.has(d) ? 1 : 0)),
    plant: {
      tdee: 2600,
      scaleKg: () => 82,
      ffmKg: () => 64,
      exNet: (d, h) => (h === 17 && !(withFasts && ZERO_DAYS.has(d)) ? 300 : 0),
    },
    options: { constraints: true },
  });
}

describe('EA_7 over non-fast days when a planned fast lies in the trailing week (R-FAST-GATE)', () => {
  it('a weekly zero day no longer breaks the EA floor of eating days at EA 32.8 (W-E08 used to fire after each fast)', () => {
    const s = week(2400); // eating days: (2 400 − 300)/64 = 32.8; with the zero day the all-days 7-day mean is 28.1
    const t = s.res.safety;
    const eatingEa = (2400 - 300) / 64;
    expect(s.has('W-E08')).toBe(false);
    expect(s.has('W-E20')).toBe(false);
    for (const d of ZERO_DAYS) {
      expect(Number.isNaN(t.ea7[d]!), `fast day ${d}`).toBe(true); // not evaluated on the fast-event day itself
      for (let j = d + 1; j <= d + 6 && j < t.ea7.length; j++) expect(t.ea7[j]!, `day ${j}`).toBeCloseTo(eatingEa, 3);
    }
    // the planner's EA floor reads the engine's W-E07 margin series (R-EA-PLANNER): (EA_7 − 35)/5 on applicable days
    const e07 = s.res.warningMargins!.find((w) => w.id === 'W-E07')!;
    let worst = Infinity;
    for (let d = 0; d < e07.margin.length; d++) if (Number.isFinite(e07.margin[d]!)) worst = Math.min(worst, e07.margin[d]!);
    expect(worst).toBeCloseTo((eatingEa - 35) / 5, 3);
    expect(worst + (35 - 30) / 5).toBeGreaterThan(0); // the 30 kcal/kg FFM floor holds on every applicable day
  });

  it('a fast never hides low EA on the eating days: EA 25.8 still raises W-E08', () => {
    const s = week(1950);
    expect(s.has('W-E08')).toBe(true);
    const w = s.warn('W-E08')[0]!;
    expect(w.peakValue).toBeCloseTo((1950 - 300) / 64, 1);
  });

  it('weeks without a fast keep the bus EA_7 unchanged (same values, same W-E08 semantics)', () => {
    const lo = week(1964, 12, false); // EA 26.0 → W-E08
    const hi = week(2348, 12, false); // EA 32.0 → none
    expect(lo.has('W-E08')).toBe(true);
    expect(hi.has('W-E08')).toBe(false);
    // the trace is the plant's (wellbeing's) 7-day mean, bit for bit (Math.fround of the bus value)
    const t = hi.res.safety;
    for (let d = 0; d < 12; d++) expect(t.ea7[d]).toBe(Math.fround((2348 - 300) / 64));
  });

  it('the 30-35 band persistence (W-E07, > 14 days) pauses on fast days instead of restarting after each fast', () => {
    const s = week(2400, 40);
    expect(s.has('W-E07')).toBe(true);
    // 14 counted non-fast days of EA 30-35 from day 0, skipping fast day 10: the caution starts on day 15
    expect(s.warn('W-E07')[0]!.startDay).toBe(15);
  });

  it('after a multi-day fast the last seven non-fast days are searched back through the 28-day window', () => {
    const s = runScenario({
      person: MAN,
      // 2 400 kcal eating; a 96-h meal-to-meal fast from day 8's dinner, then the locked graded refeed (fast-event days)
      schedule: sched(30, [prog('A', 2400, { proteinG: 140, carbsG: 220 })], () => 0, [
        { kind: 'fast', startDay: 8, startH: 19, durationH: 96, refeed: 'auto' },
      ]),
      plant: { tdee: 2600, scaleKg: () => 82, ffmKg: () => 64, exNet: (d, h) => (h === 17 && (d < 8 || d > 16) ? 300 : 0) },
      options: { constraints: true },
    });
    const t = s.res.safety;
    expect(s.has('W-E08')).toBe(false);
    let firstAfter = -1;
    for (let d = 13; d < 30 && firstAfter < 0; d++) if (Number.isFinite(t.ea7[d]!)) firstAfter = d;
    expect(firstAfter).toBeGreaterThan(12);
    // seven non-fast days exist although the trailing calendar week holds only one or two of them
    expect(t.ea7[firstAfter]!).toBeGreaterThan(30);
  });
});
