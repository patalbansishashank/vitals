// @vitest-environment node
/**
 * Worker binding (MODEL_SPEC §10.2; dossier 18 §4.19, §7.3.7): evaluator ports (Node MessageChannel stands in for the
 * browser's) → pooled evaluator → identical planner output for any worker count; progress, anytime cancellation,
 * pause/resume; pool sizing and budget tiers.
 */
import { describe, expect, it } from 'vitest';
import type { PlannerRequest } from '@/engine/planner/domain/types';
import { STOPPED_BEFORE_PLAN } from '@/engine/planner/domain/stoppedLadder';
import { PlannerCoordinator } from './planner.coordinator';
import { replan } from '@/engine/planner/domain/replan';
import { confirmedState, makePlan, replanRequest } from '@/engine/planner/domain/__tests__/replan.fixtures';
import { attachEvaluator, plannerBudget, plannerPoolSize, type PortLike } from './planner.pool';

const REQ: PlannerRequest = {
  profile: { schemaVersion: 1, body: { sex: 'male', ageYears: 35, heightCm: 180, weightKg: 95 }, habits: { sessionsPerWeek: 2, trainingHistory: 'lt1y' }, startDate: '2026-10-05' },
  goals: [
    { metric: 'fatMass', direction: 'minimise' },
    { metric: 'leanTissue', direction: 'maximise' },
  ],
  horizonDays: 28,
  seed: 42,
  budget: { tier: 'S', totalEU: 160, ensembleSize: 2 },
};

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

function fingerprint(r: Awaited<ReturnType<PlannerCoordinator['run']>>): string {
  return JSON.stringify({
    status: r.status,
    eu: r.provenance.euUsed,
    options: r.options.map((o) => ({ name: o.name, schedule: o.schedule, score: o.scorecard.map((s) => s.value) })),
    feasibility: r.feasibility.map((f) => [f.status, f.bestAchievable]),
  });
}

describe('planner worker pool', () => {
  it('sizes the pool from hardwareConcurrency (18 §4.19) and picks tiers from calibration', () => {
    expect(plannerPoolSize(16, false)).toBe(8);
    expect(plannerPoolSize(4, false)).toBe(3);
    expect(plannerPoolSize(8, true)).toBe(3);
    expect(plannerPoolSize(1, false)).toBe(1);
    expect(plannerPoolSize(undefined, false)).toBe(3);
    expect(plannerBudget(5, 7, false).tier).toBe('M'); // 7 × 200 EU/s × 10 s = 14k EU ≥ 12k
    expect(plannerBudget(1, 8, false).tier).toBe('L'); // 80k EU ≥ 40k
    expect(plannerBudget(50, 3, true).tier).toBe('S');
  });

  it('7.3.7 results are identical for 1, 2 and 4 evaluators', async () => {
    const prints: string[] = [];
    for (const n of [1, 2, 4]) {
      const p = pool(n);
      const res = await new PlannerCoordinator().run(REQ, p.ports, { timeToTarget: false });
      p.close();
      expect(res.status).toBe('ok');
      prints.push(fingerprint(res));
    }
    expect(prints[1]).toBe(prints[0]);
    expect(prints[2]).toBe(prints[0]);
  }, 120_000);

  it('reports progress with anytime options and stops cooperatively on cancel', async () => {
    const p = pool(2);
    const c = new PlannerCoordinator();
    const stages: string[] = [];
    let sawProvisional = false;
    const res = await c.run({ ...REQ, budget: { tier: 'S', totalEU: 400, ensembleSize: 2 } }, p.ports, { timeToTarget: false }, (pr) => {
      stages.push(pr.stage);
      if (pr.provisional.length) {
        sawProvisional = true;
        expect(pr.provisional[0]!.schedule.days.length).toBe(REQ.horizonDays);
        c.cancel();
      }
    });
    p.close();
    expect(stages.length).toBeGreaterThan(0);
    expect(sawProvisional).toBe(true);
    expect(res.complete).toBe(false);
    // stopped at the first provisional: either the plans found so far, or (its Hard still below goal 1's g_min) no plan
    // and the message that says so (Q7, 61cb7c5) — never a near-empty Hard
    if (res.options.length === 0) expect((res as { message?: string | null }).message).toBe(STOPPED_BEFORE_PLAN);
  }, 120_000);

  it('pause holds batches until resume', async () => {
    const p = pool(1);
    const c = new PlannerCoordinator();
    c.pause(true);
    let done = false;
    const run = c.run(REQ, p.ports, { timeToTarget: false }).then((r) => {
      done = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(done).toBe(false);
    c.pause(false);
    const res = await run;
    p.close();
    expect(res.status).toBe('ok');
  }, 120_000);
});

describe('planner progress through the worker binding (QA item 8; ladder semantics, PLANNER_V2_SPEC §4.2 anytime)', () => {
  it('delivers the rung events even when the clock never advances (pure ticks throttled)', async () => {
    const p = pool(2);
    const lists: number[] = [];
    const res = await new PlannerCoordinator().run(
      { ...REQ, horizonDays: 42, budget: { tier: 'S', totalEU: 600, ensembleSize: 2 } },
      p.ports,
      { timeToTarget: false, now: () => 0 },
      (pr) => lists.push(pr.provisional.length),
    );
    p.close();
    expect(res.status).toBe('ok');
    expect(lists.length).toBeGreaterThan(0);
    // with a frozen clock only rung-changing events and stage changes pass; every final rung was announced on the way
    expect(Math.max(...lists)).toBeGreaterThanOrEqual(res.options.length);
    // once Hard exists it stays in every later event
    const first = lists.findIndex((n) => n >= 1);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(lists.slice(first).every((n) => n >= 1)).toBe(true);
  }, 180_000);

  it('rungs appear progressively: Hard first, easier rungs before the end (release check)', async () => {
    const p = pool(3);
    const events: Array<{ stage: string; fraction: number; n: number }> = [];
    const res = await new PlannerCoordinator().run(
      { ...REQ, horizonDays: 56, budget: { tier: 'S', totalEU: 1500, ensembleSize: 2 } },
      p.ports,
      { now: () => performance.now() },
      (pr) => events.push({ stage: pr.stage, fraction: pr.fraction, n: pr.provisional.length }),
    );
    p.close();
    expect(res.status).toBe('ok');
    const firstHard = events.find((e) => e.n >= 1);
    expect(firstHard, JSON.stringify(events)).toBeDefined();
    expect(firstHard!.fraction).toBeLessThan(0.8);
    if (res.options.length >= 2) {
      const firstMore = events.find((e) => e.n >= 2);
      expect(firstMore, JSON.stringify(events)).toBeDefined();
      expect(firstMore!.fraction).toBeLessThan(0.99);
    }
    const i = events.indexOf(firstHard!);
    expect(events.slice(i).every((e) => e.n >= 1)).toBe(true);
  }, 180_000);
});

describe('living-plan re-plan through the worker binding (PLANNER_V2_SPEC §7)', () => {
  it('a pooled re-plan equals the in-thread one (evaluators rebuild the re-plan problem from its spec)', async () => {
    const f = makePlan({ pick: (st) => /^B1(\[|$)/.test(st.id) });
    const state = confirmedState(f.plan, 7, { deltaSd: 60 });
    const req = replanRequest(f.plan, state, 10, 'weekly');
    const local = await replan(req, { totalEU: 60 });
    const p = pool(2);
    const pooled = await new PlannerCoordinator().replan(req, p.ports, undefined, { totalEU: 60 });
    p.close();
    expect(pooled.status).toBe(local.status);
    expect(JSON.stringify(pooled.plan.schedule)).toBe(JSON.stringify(local.plan.schedule));
    expect(pooled.explanation).toEqual(local.explanation);
  }, 300_000);
});
