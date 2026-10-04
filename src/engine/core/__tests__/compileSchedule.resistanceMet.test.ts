// @vitest-environment node
/**
 * Additive `ResistanceSession.met?` (2026-10-01, PLANNER_V2_SPEC §8.3: catalogue items such as mudgar or kettlebell swings
 * carry their own MET). Absent → the style's Compendium MET exactly as before (bit-identical runs); present → it sets
 * the session's energy cost and nothing else.
 */
import { describe, expect, it } from 'vitest';
import { compileSchedule } from '../compileSchedule';
import { RT_STYLE_MET } from '../defaults';
import { simulate } from '../loop';
import { resolveProfile } from '../resolveProfile';
import type { DayTemplate, ResistanceSession, Schedule } from '../../types/schedule';
import { MAN, PROGRAM_B, repeatSchedule } from './fixtures';

const p = resolveProfile(MAN);
const SETS = { chest: 3, upperBack: 3, shoulders: 2, quads: 3, glutes: 3, hamstrings: 2 };

function rtDay(session: Partial<ResistanceSession>): DayTemplate {
  return {
    id: 'R',
    label: 'training day',
    energy: { kind: 'pctMaintenance', pct: 95 },
    macros: { protein: { unit: 'gPerKgBw', value: 1.8 }, carbs: { unit: 'remainder' }, fat: { unit: 'gPerKgBw', value: 0.9 } },
    meals: { count: 3, window: { startH: 8, lengthH: 11 } },
    exercise: [{ kind: 'resistance', startH: 17, durationMin: 50, setsByRegion: SETS, rir: 2, loadPct1RM: 70, ...session }],
    steps: 8000,
  };
}

const week = (session: Partial<ResistanceSession>): Schedule => repeatSchedule(21, [0, 1, 0, 1, 0, 1, 1], [rtDay(session), PROGRAM_B]);

describe('ResistanceSession.met (additive)', () => {
  it('absent: the compiled session MET is the style MET, for every style', () => {
    for (const style of Object.keys(RT_STYLE_MET) as Array<keyof typeof RT_STYLE_MET>) {
      const s = compileSchedule(week({ style }), p).days[0]!.sessions[0]!;
      expect(s.met).toBe(RT_STYLE_MET[style]);
    }
    expect(compileSchedule(week({}), p).days[0]!.sessions[0]!.met).toBe(RT_STYLE_MET.general);
  });

  it('present: the compiled session carries it; invalid values fall back to the style MET', () => {
    expect(compileSchedule(week({ style: 'general', met: 7.5 }), p).days[0]!.sessions[0]!.met).toBe(7.5);
    for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(compileSchedule(week({ style: 'bodyweight', met: bad }), p).days[0]!.sessions[0]!.met).toBe(RT_STYLE_MET.bodyweight);
    }
  });

  it('a schedule without met simulates bit-identically to one whose met equals its style MET', () => {
    const a = simulate(p, week({ style: 'bodybuilding' }));
    const b = simulate(p, week({ style: 'bodybuilding', met: RT_STYLE_MET.bodybuilding }));
    for (const id of ['tdee', 'exerciseEE', 'fatMass', 'leanTissue', 'skeletalMuscle', 'vo2max'] as const) {
      const x = a.daily[id];
      const y = b.daily[id];
      expect(x, id).toBeDefined();
      expect(Array.from(y!), id).toEqual(Array.from(x!));
    }
    expect(b.final).toEqual(a.final);
  });

  it('a higher met raises the session energy by about ΔMET × body mass × hours and leaves the muscle stimulus alone', () => {
    const base = simulate(p, week({ style: 'general' }));
    const hi = simulate(p, week({ style: 'general', met: 7.5 }));
    const ee0 = base.daily.exerciseEE!;
    const ee1 = hi.daily.exerciseEE!;
    // training days (pattern 0, 2, 4 of each week): energy rises; rest days unchanged
    const expected = (7.5 - RT_STYLE_MET.general) * p.weightKg * (50 / 60);
    for (const d of [0, 2, 4, 7, 9, 11]) {
      const delta = ee1[d]! - ee0[d]!;
      expect(delta, `day ${d}`).toBeGreaterThan(0.6 * expected);
      expect(delta, `day ${d}`).toBeLessThan(1.4 * expected);
    }
    // the sets per region are the same, so the hypertrophy stimulus is the same session for session
    const s0 = compileSchedule(week({ style: 'general' }), p).days[0]!.sessions[0]!;
    const s1 = compileSchedule(week({ style: 'general', met: 7.5 }), p).days[0]!.sessions[0]!;
    expect(Array.from(s1.setsByRegion)).toEqual(Array.from(s0.setsByRegion));
    expect(hi.daily.tdee![0]!).toBeGreaterThan(base.daily.tdee![0]!);
  });
});
