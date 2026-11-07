/**
 * I2 integration (E20 × E21): a blood-marker cap binds on every rung the ladder shows (Hard, Medium, Easy, including the
 * dedicated Easy search and carried rungs) and on the Ideal, which relaxes practical limits only, never safety locks.
 * D4-07: a low eGFR sets no protein bound of its own (renal targets wait for the clinician's numbers); its creatine cap
 * is the lab lock that must hold everywhere, even with the person's creatine opt-in.
 */
import { describe, expect, it } from 'vitest';
import { compileRequest } from '@/engine/planner/domain/context';
import { runDomainPlanner } from '@/engine/planner/domain/planner';
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
  it('keeps creatine out of every rung and the Ideal under the eGFR creatine cap, despite the opt-in', async () => {
    const ev = evaluateMarkers(LOW_EGFR, ruleContextFrom(MAN_95, '2026-10-02'));
    expect(ev.safety.plannerLocks.map((l) => l.id)).not.toContain('protein-cap');
    expect(ev.safety.plannerLocks.find((l) => l.id === 'creatine-cap')?.value).toBe(0);
    const optIn = { optIns: { levers: ['creatine'] } };
    // without the lab result the same opt-in allows creatine
    expect(compileRequest(request(MAN_95, FAT_LOSS_KEEP_LEAN, { safety: optIn })).caps.creatineAllowed).toBe(true);
    const req = { ...request(MAN_95, FAT_LOSS_KEEP_LEAN, { safety: { ...mergeSafety(undefined, ev.safety), ...optIn } }), budget: { tier: 'S' as const } };
    const pc = compileRequest(req);
    expect(pc.caps.creatineAllowed).toBe(false);
    const res = await runDomainPlanner(req, { tier: 'S' });
    expect(res.status).toBe('ok');
    const v2 = res.v2!;
    const plans = [...Object.values(v2.rungs), ...(v2.ideal ? [v2.ideal] : [])];
    expect(v2.rungs.hard).toBeDefined();
    for (const p of plans) {
      for (const prog of p.schedule.programs) expect(prog.substances?.creatineG ?? 0).toBe(0);
      for (const d of p.schedule.days) expect(d.override?.substances?.creatineG ?? 0).toBe(0);
    }
  }, 600_000);
});
