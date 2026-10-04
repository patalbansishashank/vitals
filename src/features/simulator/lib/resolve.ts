/**
 * Resolve one day template to grams/kcal exactly as the engine will, by compiling a one-day schedule with the real
 * compiler (no parallel arithmetic that could drift from `compileSchedule`). 'current'/'blockStart' references are
 * shown at their provisional baseline resolution, which is what the compiler does before the run re-resolves them.
 */
import { compileSchedule } from '@/engine';
import type { DayInput, DayTemplate, EnergyReference, ResolvedProfile, Schedule } from '@/engine';

export interface ResolvedTemplate {
  energyKcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  fibreG: number;
  alcoholG: number;
  sugarsG: number;
  satFatG: number;
  /** Any compile note for this template (e.g. macros exceed energy). */
  notes: ReadonlyArray<{ code: string; message: string }>;
  day: DayInput;
}

const cache = new WeakMap<DayTemplate, WeakMap<ResolvedProfile, ResolvedTemplate>>();

export function resolveTemplate(
  template: DayTemplate,
  profile: ResolvedProfile,
  reference: EnergyReference = 'baseline',
): ResolvedTemplate {
  const hit = reference === 'baseline' ? cache.get(template)?.get(profile) : undefined;
  if (hit) return hit;
  const s: Schedule = {
    schemaVersion: 1,
    startDate: '2026-01-05',
    horizonDays: 1,
    programs: [template],
    days: [{ program: 0 }],
    defaults: { energyReference: reference },
  };
  const c = compileSchedule(s, profile);
  const d = c.days[0]!;
  const out: ResolvedTemplate = {
    energyKcal: d.energyKcal,
    proteinG: d.proteinG,
    carbG: d.carbG,
    fatG: d.fatG,
    fibreG: d.fibreG,
    alcoholG: d.alcoholG,
    sugarsG: d.sugarsG,
    satFatG: d.satFatG,
    notes: c.notes.map((n) => ({ code: n.code, message: n.message })),
    day: d,
  };
  if (reference === 'baseline') {
    let m = cache.get(template);
    if (!m) cache.set(template, (m = new WeakMap()));
    m.set(profile, out);
  }
  return out;
}
