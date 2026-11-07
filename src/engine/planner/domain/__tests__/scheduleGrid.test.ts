// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileRequest } from '../context';
import { decodePlan, placeTraining, sessionHoursOf } from '../decode';
import { mealClocks, mergeDay } from '../dayMath';
import { repairSchedule } from '../repair';
import { enumerateStructures } from '../skeleton';
import { GOLDEN, GOLDEN_SUPPLEMENT_CONSENT } from './golden.requests';

afterEach(() => vi.useRealTimers());

describe('quarter-hour starts for consecutive exercise sessions', () => {
  // Frozen Golden d decoder case reproduces the hosted golden.d failure without the expensive search/simulation.
  // The clock samples straddle a date boundary; the request's explicit start date governs its schedule.
  it.each(['2026-10-31T21:42:00Z', '2026-11-01T00:01:00Z'])('keeps starts on the grid before and after repair at clock %s', (now) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(now));
    const ctx = compileRequest({ ...GOLDEN_SUPPLEMENT_CONSENT(GOLDEN.d), budget: { tier: 'M' } });
    const structure = enumerateStructures(ctx).find(s => s.id === 'B11[cr]')!;
    expect(structure).toBeDefined();
    const genome = Float64Array.from(structure.x0);
    genome[structure.geneIndex['rt.sets']!] = 0.75;
    genome[structure.geneIndex['cardio.sessions']!] = 1;
    const plan = decodePlan(ctx, structure, genome);
    const mixed = plan.schedule.programs.find(p => p.exercise?.length === 2)!.exercise!;
    // The fix must change placement only, not round either exercise dose up to a quarter-hour.
    expect(mixed.map(x => [x.kind, x.durationMin])).toEqual([['resistance', 85], ['cardio', 40]]);
    expect(mixed[1]!.startH).toBeGreaterThanOrEqual(mixed[0]!.startH + 85 / 60);
    const occupied = sessionHoursOf(3, 11.5, 3, 40);
    expect(mixed[1]!.startH + 40 / 60 - mixed[0]!.startH).toBeCloseTo(occupied, 10);
    for (const schedule of [plan.schedule, repairSchedule(ctx, plan.schedule, plan).schedule]) {
      for (const day of schedule.days) {
        const template = mergeDay(schedule.programs[day.program]!, day.override);
        const meals = template.energy.kind === 'zero' ? [] : mealClocks(template);
        for (const exercise of template.exercise ?? []) {
          expect(Math.abs(exercise.startH * 4 - Math.round(exercise.startH * 4))).toBeLessThan(1e-6);
          const end = exercise.startH + (exercise.durationMin ?? 60) / 60;
          for (const meal of meals) expect(meal > exercise.startH - 1e-9 && meal < end - 1e-9).toBe(false);
        }
      }
    }
  });

  it.each([
    { name: 'next meal', meals: [8, 13, 18.75], preferred: 16.75, latestEnd: 18.75 },
    { name: 'bedtime clearance', meals: [], preferred: 19.5, latestEnd: 21.5 },
  ])('reserves the transition gap when placing a mixed block before $name', ({ meals, preferred, latestEnd }) => {
    const occupied = sessionHoursOf(3, 11.5, 3, 35);
    expect(occupied).toBe(125 / 60); // 85 min resistance, 5 min transition, 35 min cardio
    const start = placeTraining(meals, preferred, occupied, 7, 23);
    expect(Math.abs(start * 4 - Math.round(start * 4))).toBeLessThan(1e-6);
    expect(start + occupied).toBeLessThanOrEqual(latestEnd + 1e-9);
  });

  it('adds no transition time to a day with only one exercise kind', () => {
    expect(sessionHoursOf(3, 11.5, 0, 0)).toBe(85 / 60);
    expect(sessionHoursOf(0, 0, 3, 35)).toBe(35 / 60);
  });
});
