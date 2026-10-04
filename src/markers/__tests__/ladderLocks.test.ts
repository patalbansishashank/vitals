/**
 * I2 integration (E20 × E21): a blood-marker cap binds on every rung the ladder shows (Hard, Medium, Easy, including the
 * dedicated Easy search and carried rungs) and on the Ideal, which relaxes practical limits only, never safety locks.
 */
import { describe, expect, it } from 'vitest';
import { compileRequest } from '@/engine/planner/domain/context';
import { runDomainPlanner } from '@/engine/planner/domain/planner';
import type { PlanOption } from '@/engine/planner/domain/types';
import { phaseStats } from '@/engine/planner/domain/__tests__/golden';
import { FAT_LOSS_KEEP_LEAN, MAN_95, request } from '@/engine/planner/domain/__tests__/personas';
import { readingFromInput } from '../doc';
import { evaluateMarkers, mergeSafety, ruleContextFrom } from '../rules';
import type { MarkersDoc } from '../types';

const DATE = '2026-09-12';
const LOW_EGFR: MarkersDoc = {
  _schema: 1,
  readings: [
    readingFromInput({ id: 'creatinine', value: 1.6, unit: 'mg/dL', date: DATE }, 'manual', `${DATE}T09:00:00Z`),
    readingFromInput({ id: 'egfr', value: 52, unit: 'mL/min/1.73 m²', date: DATE }, 'manual', `${DATE}T09:00:00Z`),
  ],
  displayOnly: [],
  context: {},
  chapter: 'manual',
};

describe('lab locks across the ladder and the Ideal', () => {
  it('keeps protein at or under the eGFR cap on every rung and on the Ideal', async () => {
    const ev = evaluateMarkers(LOW_EGFR, ruleContextFrom(MAN_95, '2026-10-02'));
    const req = { ...request(MAN_95, FAT_LOSS_KEEP_LEAN, { safety: mergeSafety(undefined, ev.safety) }), budget: { tier: 'S' as const } };
    const pc = compileRequest(req);
    expect(pc.caps.proteinCapRw).toBe(1.3);
    const res = await runDomainPlanner(req, { tier: 'S' });
    expect(res.status).toBe('ok');
    const v2 = res.v2!;
    const plans = [...Object.values(v2.rungs), ...(v2.ideal ? [v2.ideal] : [])];
    expect(v2.rungs.hard).toBeDefined();
    for (const p of plans) for (const s of phaseStats(pc, p as unknown as PlanOption)) expect(s.proteinGPerKg).toBeLessThanOrEqual(1.3 + 0.06);
  }, 600_000);
});
