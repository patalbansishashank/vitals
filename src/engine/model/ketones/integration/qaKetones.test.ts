// @vitest-environment node
/**
 * Final-round QA re-verification of ketones on the current tree (docs/QA_FINDINGS.md "Engine" item 2), full engine.
 *
 * (a) The Simulator's starter scenario (12-week moderate deficit: lifting days 140 g, rest days 60 g, a long-walk day 100 g
 *     net carbohydrate) is not reported as ketosis: the daily ketosis state is the MORNING fasting category (05 §6), and no
 *     morning of the plan reaches 0.5 mM — consistent with dossier 05's §4.7 surface (soft threshold 50-100 g/d; a 25 %
 *     deficit raises BHB ≈ 1.7×; mixed-diet overnight 0.1-0.3 mM). A true ketogenic diet (20 g/d) still is.
 * (b) Exercise during a water fast stays bounded (R-KETEX: the exercise effects wane with ketonaemia, 05 §4.10): the
 *     post-exercise rise stays within dossier 05's "0.3-2.0 mM" range, no body exceeds 8 mM in a ≤ 7-day fast with a
 *     session, the lean man's 72-h fast without exercise stays ≈ 2.4 mM, and fasting/refeed hours are never treated as
 *     "eating" by W-05-KETO-FED.
 */
import { compileSchedule } from '../../../core/compileSchedule';
import { runEngine } from '../../../core/loop';
import { resolveProfile } from '../../../core/resolveProfile';
import type { DayTemplate, ExerciseSession, PersonProfile, Schedule } from '../../../types';
import { PEOPLE } from './targets';

vi.setConfig({ testTimeout: 120_000 });

const START = '2026-10-05'; // Monday
const water: DayTemplate = { id: 'w', label: 'water', energy: { kind: 'zero' }, macros: { protein: { unit: 'g', value: 0 }, carbs: { unit: 'g', value: 0 }, fat: { unit: 'g', value: 0 } } };
const maint: DayTemplate = {
  id: 'm',
  label: 'maintenance',
  energy: { kind: 'pctMaintenance', pct: 100 },
  macros: { protein: { unit: 'pctEnergy', value: 15.6 }, carbs: { unit: 'pctEnergy', value: 45 }, fat: { unit: 'remainder' } },
};
const RT: ExerciseSession = { kind: 'resistance', startH: 17.5, durationMin: 60, volume: 'moderate' };
const RUN: ExerciseSession = { kind: 'cardio', modality: 'run', startH: 17.5, durationMin: 60 };

function run(p: PersonProfile, s: Schedule) {
  const rp = resolveProfile(p);
  return runEngine(rp, compileSchedule(s, rp), { record: 'full' });
}

describe('(a) moderate-carbohydrate deficit starter is not reported as ketosis', () => {
  // copy of features/simulator/presets STARTERS 'deficit12' (read-only there): week A B A B A C B
  const A: DayTemplate = {
    id: 'A', label: 'training day', energy: { kind: 'pctMaintenance', pct: 85 },
    macros: { protein: { unit: 'gPerKgBw', value: 2 }, carbs: { unit: 'g', value: 140 }, fat: { unit: 'remainder' } },
    meals: { count: 3, window: { startH: 8, lengthH: 12 }, split: 'even' },
    exercise: [{ kind: 'resistance', startH: 17.5, durationMin: 60, volume: 'moderate', rir: 2 }], steps: 8000,
  };
  const B: DayTemplate = {
    id: 'B', label: 'rest day', energy: { kind: 'pctMaintenance', pct: 75 },
    macros: { protein: { unit: 'gPerKgBw', value: 2 }, carbs: { unit: 'g', value: 60 }, fat: { unit: 'remainder' } },
    meals: { count: 2, window: { startH: 12, lengthH: 8 }, split: 'biggerLast' }, steps: 7000,
  };
  const C: DayTemplate = {
    id: 'C', label: 'long walk day', energy: { kind: 'pctMaintenance', pct: 80 },
    macros: { protein: { unit: 'gPerKgBw', value: 2 }, carbs: { unit: 'g', value: 100 }, fat: { unit: 'remainder' } },
    meals: { count: 2, window: { startH: 11, lengthH: 8 }, split: 'even' },
    exercise: [{ kind: 'cardio', modality: 'walk', startH: 9, durationMin: 90 }], steps: 14000,
  };
  const week = [0, 1, 0, 1, 0, 2, 1];
  const starter: Schedule = {
    schemaVersion: 1, startDate: START, horizonDays: 84, programs: [A, B, C], days: Array.from({ length: 84 }, (_, d) => ({ program: week[d % 7]! })),
    defaults: { energyReference: 'baseline' },
  };
  const man: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 35, heightCm: 180, weightKg: 85 }, habits: {}, startDate: START };

  it('no ketosis day (daily state = morning fasting category) and no morning ≥ 0.5 mM; overnight values stay in 05\'s light band', () => {
    const r = run(man, starter);
    const days = Array.from(r.daily.ketosisState!);
    expect(days.filter((v) => v >= 2).length).toBe(0);
    const bhb = r.hourly.bhb!;
    let maxMorning = 0;
    for (let d = 0; d < 84; d++) maxMorning = Math.max(maxMorning, bhb[d * 24 + 7]!);
    expect(maxMorning).toBeLessThan(0.5);
    // the hourly curve still shows the pre-lunch rise of the 16-h rest-day fast and the fasted-walk transient
    expect(Math.max(...Array.from(bhb))).toBeGreaterThan(0.5);
  });

  it('a 20 g/d ketogenic diet at maintenance is reported as nutritional ketosis from day 3-4 on', () => {
    const keto: DayTemplate = { ...maint, macros: { protein: { unit: 'g', value: 104 }, carbs: { unit: 'g', value: 20 }, fat: { unit: 'remainder' } } };
    const s: Schedule = { schemaVersion: 1, startDate: START, horizonDays: 28, programs: [keto], days: Array.from({ length: 28 }, () => ({ program: 0 })) };
    const r = run({ ...man, body: { ...man.body, weightKg: 80 } }, s);
    const st = Array.from(r.daily.ketosisState!);
    expect(st.slice(4).every((v) => v >= 2)).toBe(true);
  });
});

describe('(b) exercise during a water fast (R-KETEX)', () => {
  const fastSchedule = (fastDays: number, exDay: number, ex: ExerciseSession | null): Schedule => {
    const exProg: DayTemplate = { ...water, id: 'wx', exercise: ex ? [ex] : [] };
    const n = 1 + fastDays + 3;
    return {
      schemaVersion: 1, startDate: START, horizonDays: n, programs: [maint, water, exProg],
      days: Array.from({ length: n }, (_, d) => ({ program: d >= 1 && d <= fastDays ? (ex && d === exDay ? 2 : 1) : 0 })),
      events: [{ kind: 'fast', startDay: 0, startH: 20, durationH: 24 * fastDays, refeed: 'auto' }],
    };
  };
  const bodies = Object.entries(PEOPLE) as [string, PersonProfile][];

  it('lean man, 72-h fast without exercise: ≈ 2.4 mM at 72 h (20 §4B.3 2.3-2.7)', () => {
    const r = run(PEOPLE.leanMan, fastSchedule(3, 0, null));
    const at72 = r.hourly.bhb![20 + 72 - 1]!;
    expect(at72).toBeGreaterThan(2.1);
    expect(at72).toBeLessThan(2.7);
  });

  for (const [name, p] of bodies) {
    it(`${name}: 72-h fast with a resistance session on day 3 — post-exercise rise ≤ 2.0 mM, peak < 8 mM, no "while eating" flag`, () => {
      const r = run(p, fastSchedule(3, 3, RT));
      const bhb = r.hourly.bhb!;
      const pre = bhb[3 * 24 + 17]!;
      let post = 0;
      for (let h = 3 * 24 + 18; h < 3 * 24 + 22; h++) post = Math.max(post, bhb[h]!);
      expect(post - pre).toBeGreaterThan(0.1); // post-exercise ketosis still occurs
      expect(post - pre).toBeLessThanOrEqual(2.0); // 05 §4.10: generally 0.3-2.0 mM
      expect(Math.max(...Array.from(bhb))).toBeLessThan(8);
      expect(r.warnings.filter((w) => w.id === 'W-05-KETO-FED')).toEqual([]);
    });
    for (const ex of [RT, RUN]) {
      it(`${name}: 7-day fast with a ${ex.kind} session on day 6 stays below 8 mM; fasting hours are not "eating"`, () => {
        const r = run(p, fastSchedule(7, 6, ex));
        expect(Math.max(...Array.from(r.hourly.bhb!))).toBeLessThan(8);
        expect(r.warnings.filter((w) => w.id === 'W-05-KETO-FED')).toEqual([]);
        // while no food was eaten in 24 h the category is never 'warning' below 6 mM (05 §6: fasting ketosis)
        const ks = r.hourly.ketosisState!;
        const bhb = r.hourly.bhb!;
        for (let h = 2 * 24; h < 7 * 24; h++) if (bhb[h]! < 6) expect(ks[h]).not.toBe(4);
      });
    }
  }
});
