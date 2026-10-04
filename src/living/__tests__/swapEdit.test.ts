/**
 * Q4-09: "change my training days to Tue/Thu" on a plan with a 24-h fast from Monday 19:30 to Tuesday 19:30. Swapping
 * Monday and Tuesday used to move the fast a day later, over Wednesday's session, so every re-plan was refused.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FastEvent, PersonProfile, Schedule } from '@/engine';
import { shiftEdit } from '../edits';
import { templateOfDay } from '../prescription';

const F = JSON.parse(fs.readFileSync(path.join(__dirname, '../../commands/living/__tests__/fixtures/q4b-rungs.json'), 'utf8'));
const plan = F.hard.plans[0] as { startDate: string; baselineProfile: PersonProfile };
const s = F.hard.planVersions[0].schedule as Schedule;
const end = (e: FastEvent) => e.startDay + Math.floor((e.startH + e.durationH) / 24 - 1e-9);
const MON = 3; // 2026-10-05; the plan starts on Friday 2 Oct

describe('plan.shift swap and fasts', () => {
  it('the fixture has a fast from Monday evening to Tuesday evening and a session on Monday and Wednesday', () => {
    expect(s.events?.some((e) => e.startDay === MON && end(e) === MON + 1)).toBe(true);
    expect(templateOfDay(s, MON).exercise?.length).toBeGreaterThan(0);
    expect(templateOfDay(s, MON + 2).exercise?.length).toBeGreaterThan(0);
  });

  it('a fast that crosses the swapped day is left out, and no fast touches a training day', () => {
    const e = shiftEdit(s, plan.startDate, plan.baselineProfile, { fromDay: MON, days: 1, mode: 'swap', withDay: MON + 1 });
    const out = e.schedule;
    expect(out.events?.some((f) => f.startDay <= MON + 2 && end(f) >= MON)).toBe(false);
    expect(e.notes.join(' ')).toMatch(/fast .* left out/);
    // Tuesday trains with Monday's session; Monday is an ordinary day (not the fast's one-meal, low-energy day)
    expect(templateOfDay(out, MON + 1).exercise).toEqual(templateOfDay(s, MON).exercise);
    expect(templateOfDay(out, MON).exercise ?? []).toEqual([]);
    expect(templateOfDay(out, MON).energy).toEqual(templateOfDay(s, 1).energy);
    expect(e.pinned).toEqual([MON, MON + 1]);
    for (const f of out.events ?? []) for (let d = f.startDay; d <= end(f); d++) expect(templateOfDay(out, d).exercise ?? [], `fast on day ${d}`).toEqual(f.startDay === d ? templateOfDay(out, d).exercise ?? [] : []);
  });

  it('a fast wholly inside a swapped stretch moves with it', () => {
    const e = shiftEdit(s, plan.startDate, plan.baselineProfile, { fromDay: MON, days: 2, mode: 'swap', withDay: MON + 5 });
    const moved = e.schedule.events?.find((f) => f.startDay === MON + 5);
    expect(moved?.durationH).toBe(24);
    expect(e.schedule.events?.some((f) => f.startDay === MON)).toBe(false);
    expect(e.notes).toEqual([]);
  });
});
