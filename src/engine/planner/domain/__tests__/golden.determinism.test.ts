// @vitest-environment node
/**
 * Golden requests are deterministic for a fixed seed and any evaluator count (18 §4.19, §7.3.7): request (c) through the
 * worker binding with 1 and 3 evaluators (Node MessageChannels stand in for the browser's ports), budget-reduced.
 */
import { describe, expect, it } from 'vitest';
import { PlannerCoordinator } from '../../../../workers/planner.coordinator';
import { attachEvaluator, type PortLike } from '../../../../workers/planner.pool';
import { GOLDEN } from './golden.requests';

function pool(n: number): { ports: PortLike[]; close: () => void } {
  const ports: PortLike[] = [];
  const all: MessagePort[] = [];
  for (let i = 0; i < n; i++) {
    const ch = new MessageChannel();
    attachEvaluator(ch.port1 as unknown as PortLike, () => performance.now());
    ports.push(ch.port2 as unknown as PortLike);
    all.push(ch.port1, ch.port2);
  }
  return { ports, close: () => all.forEach((p) => p.close()) };
}

describe('golden determinism', () => {
  it('request (c): identical options for 1 and 3 evaluators and for a repeated run', async () => {
    const req = { ...GOLDEN.c, budget: { tier: 'S' as const, totalEU: 900, ensembleSize: 4 } };
    const prints: string[] = [];
    for (const n of [1, 3, 1]) {
      const p = pool(n);
      const res = await new PlannerCoordinator().run(req, p.ports, { timeToTarget: false });
      p.close();
      expect(res.status).toBe('ok');
      prints.push(JSON.stringify(res.options.map((o) => ({ name: o.name, schedule: o.schedule, score: o.scorecard.map((s) => s.value) }))));
    }
    expect(prints[1]).toBe(prints[0]);
    expect(prints[2]).toBe(prints[0]);
  }, 900_000);
});
