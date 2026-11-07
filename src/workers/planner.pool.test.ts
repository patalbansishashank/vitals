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
import { attachEvaluator, plainOutput, plannerBudget, plannerPoolSize, requestExtras, unpackBatch, type PortLike } from './planner.pool';
import { checkpointCurrent, deleteCheckpoint, loadCheckpoint, saveCheckpoint } from './planner.checkpoints';
import { checkpointKeyOf } from '@/engine/planner/domain/ladderPlanner';
import { CONTRACT_FINGERPRINT } from '@/lib/bodyContracts';
import type { EvalOutput, EvalRequest } from '@/engine/planner/optim/types';
import type { PlannerRequestV2 } from '@/engine/planner/domain/types';

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
      // C7: a result leaving the worker carries the contract fingerprint it was computed under
      expect((res.provenance as { contracts?: string }).contracts).toBe(CONTRACT_FINGERPRINT);
      prints.push(fingerprint(res));
    }
    expect(prints[1]).toBe(prints[0]);
    expect(prints[2]).toBe(prints[0]);
  }, 120_000);

  it('D4-03: the reserved safety-audit stream and its certificates are identical for 1 and 3 evaluators', async () => {
    // a budget that leaves room for the one automatic final audit (M = the selection-ensemble size), so the audit draws
    // really cross the ports; the certificate's createdAt is a clock reading and is left out
    const req: PlannerRequest = { ...REQ, budget: { tier: 'S', totalEU: 600, ensembleSize: 2 } };
    const safetyPrint = (r: Awaited<ReturnType<PlannerCoordinator['run']>>) =>
      JSON.stringify(
        r.options.map((o) => {
          const sf = o.safety;
          const c = sf?.certificate;
          return {
            id: o.id,
            status: sf?.status,
            audit: sf?.audit,
            selection: sf?.selection,
            holdout: sf?.outcomeHoldout,
            cert: c && { fingerprint: c.fingerprint, status: c.status, episodeId: c.episodeId, attempt: c.attempt, margins: c.requiredMargins, protocol: c.drawProtocol, audit: c.audit },
          };
        }),
      );
    const prints: string[] = [];
    for (const n of [1, 3]) {
      const p = pool(n);
      const res = await new PlannerCoordinator().run(req, p.ports, { timeToTarget: false });
      p.close();
      expect(res.options.length).toBeGreaterThan(0);
      for (const o of res.options) {
        expect(o.safety?.audit?.M).toBe(2);
        // the outcome holdout never stands in for the audit, and an audit that is not passed never certifies
        if (o.safety?.audit?.status !== 'pass') expect(o.safety?.certificate?.status).not.toBe('verified');
      }
      prints.push(safetyPrint(res));
    }
    expect(prints[1]).toBe(prints[0]);
  }, 180_000);

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
    // D4-03: the re-plan's safety (status, audit, certificate bound to the same history) does not depend on the pool
    expect(pooled.safety?.status).toBe(local.safety?.status);
    expect(pooled.safety?.audit).toEqual(local.safety?.audit);
    expect(pooled.safety?.historyHash).toBe(local.safety?.historyHash);
    expect(pooled.safety?.certificate?.fingerprint).toBe(local.safety?.certificate?.fingerprint);
    expect(pooled.safety?.certificate?.status).toBe(local.safety?.certificate?.status);
  }, 300_000);
});

describe('C6/C7/D4-03 worker boundary: nothing is dropped, nothing is resumed across contract versions', () => {
  it('an evaluation output keeps every field across the port (statuses, availability masks, margin metadata)', () => {
    const o = {
      goals: [1, 2],
      margins: new Float32Array([0.5, -0.25]),
      regulariser: 0.1,
      descriptors: [0.3],
      aborted: { day: 3, constraint: 1, magnitude: 0.2 },
      marginAvailable: new Uint8Array([1, 0]),
      status: { kind: 'unchecked', missing: ['ea7'] },
      cost: 0,
      fn: () => 1,
    } as unknown as EvalOutput;
    const out = plainOutput(o) as unknown as Record<string, unknown>;
    expect(out.goals).toBeInstanceOf(Float64Array);
    expect(Array.from(out.margins as Float64Array)).toEqual([0.5, -0.25]);
    expect(Array.from(out.marginAvailable as Uint8Array)).toEqual([1, 0]);
    expect(out.status).toEqual({ kind: 'unchecked', missing: ['ea7'] });
    expect(out.status).not.toBe((o as unknown as Record<string, unknown>).status);
    expect(out.cost).toBe(0);
    expect(out.aborted).toEqual({ day: 3, constraint: 1, magnitude: 0.2 });
    expect(out).not.toHaveProperty('fn');
    expect(() => structuredClone(out)).not.toThrow();
  });

  it('request fields beyond the packed genome (e.g. a named draw stream) round-trip through the batch message', () => {
    const batch = [
      { structure: 1, draw: 4, x: Float64Array.from([0.1, 0.2]), stream: 'safetyAudit' },
      { structure: 2, draw: -1, x: Float64Array.from([0.3]) },
    ] as unknown as EvalRequest[];
    const extra = requestExtras(batch);
    expect(extra).toEqual([{ stream: 'safetyAudit' }, null]);
    expect(requestExtras([batch[1]!])).toBeUndefined();
    const back = unpackBatch({ structure: Int32Array.from([1, 2]), draw: Int32Array.from([4, -1]), offsets: Int32Array.from([0, 2, 3]), x: Float64Array.from([0.1, 0.2, 0.3]), ...(extra ? { extra } : {}) });
    expect(back[0]).toMatchObject({ structure: 1, draw: 4, stream: 'safetyAudit' });
    expect(Array.from(back[0]!.x)).toEqual([0.1, 0.2]);
    expect(back[1]).toEqual({ structure: 2, draw: -1, x: Float64Array.from([0.3]) });
  });

  it('checkpoints are stamped with the contract fingerprint; one from other contracts is discarded, never resumed', async () => {
    await saveCheckpoint({ key: 'ck-test', createdAt: '2026-10-18T00:00:00Z', euUsed: 10, stage: 'S2', request: {}, data: { x: 1 } });
    const cp = await loadCheckpoint('ck-test');
    expect(cp?.contracts).toBe(CONTRACT_FINGERPRINT);
    expect(checkpointCurrent(cp)).toBe(true);
    (cp as { contracts?: string }).contracts = 'older-contracts';
    expect(await loadCheckpoint('ck-test')).toBeNull();
    expect(await loadCheckpoint('ck-test')).toBeNull(); // deleted, not merged
    expect(checkpointCurrent(null)).toBe(false);
  });

  it('a stored long search for the same request but older contracts is offered as stale', async () => {
    const req = { ...REQ, budget: { tier: 'X', totalEU: 100 } } as unknown as PlannerRequestV2;
    const key = checkpointKeyOf(req);
    await saveCheckpoint({ key, createdAt: '2026-10-18T00:00:00Z', euUsed: 10, stage: 'S2', request: req, data: {} });
    const c = new PlannerCoordinator();
    expect(await c.checkpointFor(req)).toMatchObject({ key, stage: 'S2' });
    const stored = await loadCheckpoint(key);
    (stored as { contracts?: string }).contracts = 'older-contracts';
    expect(await c.checkpointFor(req)).toEqual({ stale: true, key });
    await deleteCheckpoint(key);
  });
});
