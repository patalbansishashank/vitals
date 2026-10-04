// @vitest-environment node
/**
 * Re-plan on every day index of a 28-day plan (review V1b): before the start, each day, the last day and past the end.
 * Every run returns without throwing, a new record covers at least `todayIdx + 7` days, every past prescription stays
 * and the forecast is finite and starts today.
 */
import { describe, expect, it } from 'vitest';
import { replan } from '../replan';
import type { ReplanKind } from '../replanTypes';
import { dayTemplate } from '../sensitivities';
import { confirmedState, makePlan, replanRequest } from './replan.fixtures';

const EU = 30;

describe('re-plan on every day index', () => {
  const fx = makePlan();
  const state = confirmedState(fx.plan, 1, { deltaSd: 60 });
  const days = [-3, ...Array.from({ length: 28 }, (_, i) => i), 28, 29, 35];
  for (const kind of ['light', 'weekly'] as ReplanKind[]) {
    it(`${kind}: day -3 … 35`, async () => {
      const bad: string[] = [];
      for (const today of days) {
        try {
          const r = await replan(replanRequest(fx.plan, state, today, kind), { totalEU: EU });
          const t = Math.max(0, today);
          const s = r.plan.schedule;
          // a new record covers at least the 7-day re-plan minimum; 'unchanged' and 'noSafePlan' return the current record
          if (r.plan === fx.plan ? r.status !== 'unchanged' && r.status !== 'noSafePlan' : s.days.length < t + 7) bad.push(`${today}: ${r.status}, ${s.days.length} days`);
          if (r.forecast.fromDay !== t) bad.push(`${today}: forecast from ${r.forecast.fromDay}`);
          if (s.horizonDays !== s.days.length) bad.push(`${today}: horizonDays ${s.horizonDays} ≠ ${s.days.length}`);
          for (let k = 0; k < Math.min(t, 28); k++) if (JSON.stringify(dayTemplate(s, k)) !== JSON.stringify(dayTemplate(fx.plan.schedule, k))) { bad.push(`${today}: past day ${k} changed`); break; }
          for (const g of r.forecast.asPrescribed) if (g.endP50 !== null && !Number.isFinite(g.endP50)) bad.push(`${today}: ${g.metric} endP50 ${g.endP50}`);
        } catch (e) {
          bad.push(`${today}: threw ${(e as Error).message}`);
        }
      }
      expect(bad).toEqual([]);
    }, 900_000);
  }
});
