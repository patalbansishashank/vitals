// @vitest-environment node
/**
 * Review V1b-04: in the last 7 days of a plan the re-plan horizon grows to `todayIdx + 7` (§7.2 minimum). A re-plan whose
 * search keeps the schedule must return the record grown to the same end date a changed re-plan gets (status `ok`, so the
 * living layer writes it), never the old record with a 1-day plan under a 7-day forecast.
 */
import { describe, expect, it } from 'vitest';
import { replan } from '../replan';
import type { ReplanKind } from '../replanTypes';
import { dateAt, dayTemplate } from '../sensitivities';
import { confirmedState, makePlan, replanRequest } from './replan.fixtures';

describe('re-plan in the last week extends the record whatever the search does', () => {
  const fx = makePlan();
  const state = confirmedState(fx.plan, 1, { deltaSd: 60 });
  for (const kind of ['weekly', 'light'] as ReplanKind[]) {
    it(`${kind}: day 27 of 28`, async () => {
      const today = 27;
      const r = await replan(replanRequest(fx.plan, state, today, kind), { totalEU: 30 });
      if (r.status === 'noSafePlan') return;
      expect(r.status).not.toBe('unchanged');
      expect(r.plan.endDate).toBe(dateAt(fx.plan.startDate, today + 7));
      expect(r.plan.schedule.horizonDays).toBe(today + 7);
      expect(r.plan.schedule.days.length).toBe(today + 7);
      expect(r.plan.version).toBe(fx.plan.version + 1);
      expect(r.forecast.fromDay).toBe(today);
      for (let d = 0; d < 28; d++) expect(dayTemplate(r.plan.schedule, d)).toEqual(dayTemplate(fx.plan.schedule, d));
    }, 900_000);
  }
});
