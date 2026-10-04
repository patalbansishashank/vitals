/**
 * Integration (integrator A2): robustness of the intake → fuel → ketones → fasting coupling in the FULL engine for the
 * body matrix (both sexes; 8 % and 45 % body fat; ages 18 and 80; 50 kg and 150 kg) under four stress schedules:
 * 28 days of zero intake, 14 days at 300 % of maintenance, 3 h/day of hard exercise, alternating fast/feast days.
 * Checks (invariant O-6 extended to the coupling signals): no NaN/Infinity, no negative pools, glycogen within capacity,
 * BHB physiological (< 8 mM at every hour), no hour-to-hour oscillation of BHB during established zero intake.
 */
import { describe, expect, it } from 'vitest';
import { kitPerson, kitSchedule, neutral, program, runKit, waterDay, type KitRun } from './engineKit';
import type { PersonProfile } from '../../../types/profile';
import type { DayTemplate, FastEvent } from '../../../types/schedule';

interface Body { label: string; person: PersonProfile }

function bodies(): Body[] {
  const out: Body[] = [];
  for (const sex of ['male', 'female'] as const)
    for (const bf of [8, 45])
      for (const age of [18, 80])
        for (const w of [50, 150]) {
          const h = w === 50 ? (sex === 'male' ? 165 : 158) : sex === 'male' ? 188 : 178;
          out.push({ label: `${sex[0]}${age}y ${w}kg ${bf}%`, person: kitPerson({ sex, ageYears: age, heightCm: h, weightKg: w, bodyFatPct: bf }) });
        }
  return out;
}

const SIGNAL_KEYS = ['bhb', 'tkb', 'ffa', 'insulinRel', 'liverG', 'muscleG', 'fatOxGH', 'choOxGH', 'protOxGH', 'gngGH', 'glucose', 'aF', 'aS'] as const;

function checkRun(r: KitRun, what: string, fastFromH = -1, fastEndH = -1): string[] {
  const bad: string[] = [];
  const p = r.probe;
  const n = p.bhb.length;
  for (const key of SIGNAL_KEYS) {
    const a = p[key];
    for (let h = 0; h < n; h++) {
      const v = a[h]!;
      if (!Number.isFinite(v)) { bad.push(`${what}: ${key} not finite at h${h}`); break; }
      if (v < 0 && key !== 'fatOxGH') { bad.push(`${what}: ${key} negative (${v}) at h${h}`); break; }
    }
  }
  for (let h = 0; h < n; h++) {
    if (p.bhb[h]! >= 8) { bad.push(`${what}: BHB ${p.bhb[h]!.toFixed(2)} ≥ 8 mM at h${h}`); break; }
    if (p.liverG[h]! > 130) { bad.push(`${what}: liver glycogen ${p.liverG[h]!.toFixed(1)} g above capacity at h${h}`); break; }
  }
  if (fastFromH >= 0) {
    // established zero intake (from 72 h): BHB moves smoothly (no hour-to-hour oscillation)
    for (let h = fastFromH + 72; h < (fastEndH > 0 ? fastEndH - 1 : n - 1); h++) {
      const d1 = p.bhb[h + 1]! - p.bhb[h]!;
      if (Math.abs(d1) > 0.15) { bad.push(`${what}: BHB step ${d1.toFixed(3)} mM/h at h${h} during zero intake`); break; }
    }
  }
  for (const id of ['scaleWeight', 'glycogenTotal', 'bhb', 'glucose', 'insulin']) {
    for (let d = 0; d < r.result.meta.nDays; d++) {
      const v = r.day(id, d);
      if (!Number.isFinite(v)) { bad.push(`${what}: daily ${id} not finite on day ${d}`); break; }
    }
  }
  return bad;
}

const BODIES = bodies();

describe('coupling robustness over the body matrix (full engine; O-6 extended)', () => {
  it('28 days of zero intake', () => {
    const bad: string[] = [];
    for (const b of BODIES) {
      const ev: FastEvent = { kind: 'fast', startDay: 0, startH: 20, durationH: 28 * 24 + 12, refeed: 'none' };
      const r = runKit(b.person, kitSchedule(30, [program('m', 100, neutral(b.person.body.sex)), waterDay()], (d) => (d >= 1 && d <= 28 ? 1 : 0), [ev]));
      bad.push(...checkRun(r, `${b.label} zero-intake`, 20, 20 + 28 * 24 + 12));
    }
    expect(bad).toEqual([]);
  }, 120000);

  it('14 days at 300 % of maintenance', () => {
    const bad: string[] = [];
    for (const b of BODIES) {
      const r = runKit(b.person, kitSchedule(14, [program('surplus', 300, neutral(b.person.body.sex))], () => 0));
      bad.push(...checkRun(r, `${b.label} 300 %`));
    }
    expect(bad).toEqual([]);
  }, 120000);

  it('3 h/day of hard exercise at baseline maintenance intake, 21 days', () => {
    const bad: string[] = [];
    for (const b of BODIES) {
      const hard: DayTemplate = program('hard', 100, neutral(b.person.body.sex), {
        exercise: [
          { kind: 'cardio', modality: 'run', startH: 7, durationMin: 90, pctVo2max: 0.8 },
          { kind: 'cardio', modality: 'cycle', startH: 17, durationMin: 90, pctVo2max: 0.8 },
        ],
      });
      const r = runKit(b.person, kitSchedule(21, [hard], () => 0));
      bad.push(...checkRun(r, `${b.label} hard exercise`));
    }
    expect(bad).toEqual([]);
  }, 120000);

  it('alternating fast (0 kcal) / feast (200 %) days, 28 days', () => {
    const bad: string[] = [];
    for (const b of BODIES) {
      const r = runKit(b.person, kitSchedule(28, [program('feast', 200, neutral(b.person.body.sex)), waterDay()], (d) => (d % 2 === 0 ? 1 : 0)));
      bad.push(...checkRun(r, `${b.label} alternate-day`));
    }
    expect(bad).toEqual([]);
  }, 120000);
});
