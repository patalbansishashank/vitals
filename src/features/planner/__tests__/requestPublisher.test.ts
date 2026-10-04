/** planner.find from the Coach or an agent runs the request the Planner screens published (Q4: it failed with "Open the Planner"). */
import { describe, expect, it } from 'vitest';
import { getPorts } from '@/commands';
import type { PlannerRequest } from '@/engine/planner/domain/types';
import { publishPlannerRequest } from '../run';

describe('planner port: published request', () => {
  it('prepare() returns the published request until it is withdrawn', () => {
    const port = getPorts().planner!;
    expect(port.prepare()).toBeNull();
    const request = { goals: [], horizonDays: 90 } as unknown as PlannerRequest;
    publishPlannerRequest(request, 'h1');
    expect(port.prepare()).toEqual({ request, hash: 'h1' });
    publishPlannerRequest(null, null);
    expect(port.prepare()).toBeNull();
  });
});

describe('goal suggestion port', () => {
  it('is installed with the publisher module (goals.suggest from the Coach no longer needs the Planner opened)', async () => {
    await import('../RequestPublisher');
    expect(getPorts().goalSuggest).toBeDefined();
  });
});
