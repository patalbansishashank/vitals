// @vitest-environment node
/**
 * Golden tests of the final-round warning fixes (docs/QA_FINDINGS.md "Engine" item 4) and of rulings R-T4CAP and
 * R-PLAN-SAFETY:
 *  - a limit printed next to its driving value is never equal to it ("734 kcal/day is above about 734 kcal/day");
 *  - 7-day-mean deficit warnings attach to deficit days and say "averaged over the last 7 days";
 *  - "Gaining more is not advised" (W-S03) does not fire when eating at maintenance after a fast;
 *  - weekly 36-h fasts are not "fasting most of the week" (W-F13 counts fasts that started inside its 14-day window);
 *  - R-T4CAP: the 108-h / 7-d cap counts T1-T3 fasting; a single T4 fast follows its own tier rule;
 *  - R-PLAN-SAFETY: whenever a warning margin stays ≥ 0 over the run, the warnings it guards do not fire.
 */
import { compileSchedule } from '../../core/compileSchedule';
import { runEngine } from '../../core/loop';
import { resolveProfile } from '../../core/resolveProfile';
import type { DayTemplate, FastEvent, MacroSpec, PersonProfile, Schedule } from '../../types';
import type { WarningRuleId } from '../../types/events';
import { defaultSafetyConstants } from './params';
import { deficitCapPct, bfFloorPct } from './derived';
import { person, prog, runScenario, sched } from './testkit';
import { worstMargin } from './constraints';

vi.setConfig({ testTimeout: 120_000 });

const K = defaultSafetyConstants();
const START = '2026-10-05';

describe('printed limits are visibly different from the value (unit, planted trajectories)', () => {
  const body = { sex: 'male' as const, ageYears: 35, heightCm: 178, weightKg: 82 };
  const bf = 22;
  const fm = (body.weightKg * bf) / 100;
  const alpertCap = K.alpertFraction * K.alpertKcalPerKgFm * fm;
  const runAt = (kcal: number) =>
    runScenario({
      person: person(body),
      schedule: sched(21, [prog('A', kcal, { proteinG: 130, carbsG: 150, fibrePer1000: 15, hydration: { sodiumG: 2 } })], () => 0),
      plant: { tdee: 2600, scaleKg: () => body.weightKg, bfPct: () => bf },
    });
  it('W-13-ALPERT: a deficit within rounding of the cap is not reported; a real excess prints two different numbers', () => {
    const atCap = runAt(2600 - alpertCap - 0.3);
    expect(atCap.warn('W-13-ALPERT')).toEqual([]);
    const over = runAt(2600 - alpertCap - 60);
    const w = over.warn('W-13-ALPERT');
    expect(w.length).toBeGreaterThan(0);
    const nums = w[0]!.message.match(/\d+(?= kcal\/day)/g)!;
    expect(nums.length).toBe(2);
    expect(nums[0]).not.toBe(nums[1]);
    expect(w[0]!.message.startsWith('Averaged over the last 7 days')).toBe(true);
  });
  it('W-E03: a 7-day deficit within 0.5 points of the cap is not reported with equal numbers', () => {
    const cap = deficitCapPct(K, body.weightKg / 1.78 ** 2, body.ageYears, bf, bfFloorPct(K, false));
    const at = runAt(2600 * (1 - (cap + 0.2) / 100));
    for (const w of at.warn('W-E03')) {
      const nums = w.message.match(/\d+(?=%)/g)!;
      expect(nums[0]).not.toBe(nums[1]);
    }
    const over = runAt(2600 * (1 - (cap + 3) / 100));
    expect(over.warn('W-E03').length).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------------------------------------ full engine
const macros: MacroSpec = { protein: { unit: 'gPerKgBw', value: 1.6 }, carbs: { unit: 'pctEnergy', value: 45 }, fat: { unit: 'remainder' } };
const pctDay = (pct: number): DayTemplate => ({ id: `p${pct}`, label: `p${pct}`, energy: { kind: 'pctMaintenance', pct }, macros });
const water: DayTemplate = { id: 'w', label: 'water', energy: { kind: 'zero' }, macros: { protein: { unit: 'g', value: 0 }, carbs: { unit: 'g', value: 0 }, fat: { unit: 'g', value: 0 } } };
const man = (extra: Partial<PersonProfile['body']> = {}): PersonProfile => ({
  schemaVersion: 1,
  body: { sex: 'male', ageYears: 45, heightCm: 178, weightKg: 95, ...extra },
  habits: {},
  startDate: START,
});
function sim(p: PersonProfile, programs: DayTemplate[], use: (d: number) => number, n: number, events?: FastEvent[]) {
  const s: Schedule = { schemaVersion: 1, startDate: START, horizonDays: n, programs, days: Array.from({ length: n }, (_, d) => ({ program: use(d) })), ...(events ? { events } : {}) };
  const rp = resolveProfile(p);
  return runEngine(rp, compileSchedule(s, rp), { record: 'daily', constraints: true });
}
const ids = (r: ReturnType<typeof sim>) => r.warnings.map((w) => w.id);

describe('7-day deficit warnings attach to deficit days (full engine)', () => {
  it('14 days at 55 % then 100 %: W-E03/W-E04 runs end on the last deficit day and say "averaged over the last 7 days"', () => {
    const r = sim(man(), [pctDay(55), pctDay(100)], (d) => (d < 14 ? 0 : 1), 28);
    const def = r.warnings.filter((w) => w.id === 'W-E03' || w.id === 'W-E04' || w.id === 'W-13-ALPERT');
    expect(def.length).toBeGreaterThan(0);
    for (const w of def) {
      expect(w.endDay).toBeLessThanOrEqual(13);
      expect(w.message.startsWith('Averaged over the last 7 days')).toBe(true);
    }
  });
});

describe('W-S03 "Gaining more is not advised" (high waist) and fasts (full engine)', () => {
  const highWaist = man({ weightKg: 105, waistCm: 110 });
  it('eating at maintenance before and after a 72-h fast is not a planned gain', () => {
    const r = sim(highWaist, [pctDay(100), water], (d) => (d >= 8 && d <= 10 ? 1 : 0), 24, [{ kind: 'fast', startDay: 7, startH: 20, durationH: 84, refeed: 'auto' }]);
    expect(ids(r)).not.toContain('W-S03');
  });
  it('a real surplus (120 %) still fires it', () => {
    const r = sim(highWaist, [pctDay(120)], () => 0, 21);
    expect(ids(r)).toContain('W-S03');
  });
});

describe('W-F13 and R-T4CAP (full engine)', () => {
  it('weekly 36-h fasts for 6 weeks are not "fasting most of the week"', () => {
    const ev: FastEvent[] = [0, 1, 2, 3, 4, 5].map((w) => ({ kind: 'fast', startDay: 7 * w + 5, startH: 20, durationH: 36 }));
    const r = sim(man(), [pctDay(100)], () => 0, 42, ev);
    expect(ids(r)).not.toContain('W-F13');
  });
  it('a single 120-h (T4) fast is governed by its tier rule: no W-F13, HC-F2 and W-F13 margins ≥ 0', () => {
    const r = sim(man(), [pctDay(100), water], (d) => (d >= 3 && d <= 6 ? 1 : 0), 21, [{ kind: 'fast', startDay: 2, startH: 20, durationH: 120, refeed: 'auto' }]);
    expect(ids(r)).toContain('W-F04');
    expect(ids(r)).not.toContain('W-F13');
    expect(Math.max(...Array.from(r.safety.fastH7))).toBeGreaterThan(108);
    expect(Math.max(...Array.from(r.safety.fastH7Cap!))).toBeLessThanOrEqual(108);
    const f2 = r.constraints!.find((c) => c.id === 'HC-F2')!;
    expect(worstMargin(f2).value).toBeGreaterThanOrEqual(0);
    const w13 = r.warningMargins!.find((m) => m.id === 'W-F13')!;
    expect(Math.min(...Array.from(w13.margin).filter(Number.isFinite))).toBeGreaterThanOrEqual(0);
  });
  it('T3 fasts adding up to > 108 h in 7 days still hit the cap', () => {
    const r = sim(man(), [pctDay(100), water], (d) => (d === 3 || d === 4 || d === 7 || d === 8 ? 1 : 0), 14, [
      { kind: 'fast', startDay: 2, startH: 20, durationH: 60 },
      { kind: 'fast', startDay: 6, startH: 20, durationH: 60 },
    ]);
    expect(ids(r)).toContain('W-F13');
  });
});

describe('R-PLAN-SAFETY: warning margins are at least as strict as the warnings (full engine)', () => {
  /** Warnings guarded by each margin (the caution rule and the danger rule on the same quantity). */
  const GUARDS: Readonly<Record<string, readonly WarningRuleId[]>> = {
    'W-E01': ['W-E01', 'W-E02'],
    'W-E03': ['W-E03', 'W-E04'],
    'W-E05': ['W-E05', 'W-E06'],
    'W-E07': ['W-E07', 'W-E08', 'W-E20'],
    'W-E10': ['W-E10'],
    'W-E11': ['W-E11', 'W-E12'],
    'W-E13': ['W-E13', 'W-E14'],
    'W-E15': ['W-E15', 'W-E16'],
    'W-E18': ['W-E18'],
    'W-M01': ['W-M01'],
    'W-M06': ['W-M06'],
    'W-S01': ['W-S01'],
    'W-S03': ['W-S03'],
    'W-13-ALPERT': ['W-13-ALPERT'],
    'W-20-FAST-LEAN': ['W-20-FAST-LEAN'],
    'W-F13': ['W-F13'],
  };
  const cardio = { kind: 'cardio' as const, modality: 'run' as const, startH: 17, durationMin: 60 };
  const trainDay = (pct: number): DayTemplate => ({ ...pctDay(pct), id: `t${pct}`, exercise: [cardio] });
  const woman: PersonProfile = { schemaVersion: 1, body: { sex: 'female', ageYears: 30, heightCm: 165, weightKg: 58 }, habits: {}, startDate: START };
  const cases: [string, () => ReturnType<typeof sim>][] = [
    ['man 90 %', () => sim(man(), [pctDay(90)], () => 0, 84)],
    ['man 70 %', () => sim(man(), [pctDay(70)], () => 0, 84)],
    ['man 55 %', () => sim(man(), [pctDay(55)], () => 0, 60)],
    ['woman 75 % with daily runs', () => sim(woman, [trainDay(75)], () => 0, 84)],
    ['woman 90 % with runs 4×/wk', () => sim(woman, [trainDay(90), pctDay(90)], (d) => (d % 7 < 4 ? 0 : 1), 84)],
    ['high waist 115 %', () => sim(man({ weightKg: 110, waistCm: 112 }), [pctDay(115)], () => 0, 60)],
    ['lean man 110 %', () => sim(man({ weightKg: 68, ageYears: 25 }), [pctDay(110)], () => 0, 84)],
  ];
  for (const [label, go] of cases) {
    it(`${label}: every margin that stays ≥ 0 has its warnings quiet`, () => {
      const r = go();
      const fired = new Set(ids(r));
      for (const m of r.warningMargins!) {
        const vals = Array.from(m.margin).filter(Number.isFinite);
        if (vals.length === 0 || Math.min(...vals) < 0) continue;
        for (const g of GUARDS[m.id] ?? [m.id]) expect(fired.has(g), `${m.id} margin ≥ 0 but ${g} fired`).toBe(false);
      }
    });
  }
});
