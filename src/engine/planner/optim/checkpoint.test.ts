// @vitest-environment node
/**
 * Checkpoint contract under the 2026-10-18 safety semantics (C5/C7, D4-03): outputs keep their missing-margin indices
 * across serialization and JSON; a checkpoint written under the previous chance semantics (version 2) or another contract
 * fingerprint is refused (a fresh run), never resumed; a matching checkpoint resumes bitwise, audit included.
 */
import { describe, expect, it } from 'vitest';
import { CHECKPOINT_VERSION, decodeCheckpoint, deserializeOutput, encodeCheckpoint, serializeOutput, type PlannerCheckpointData } from './checkpoint';
import { createLocalEvaluator, runPlanner, type PlannerConfig } from './pipeline';
import { functionToy } from './toys';
import { isSafetyAuditDraw, type EvalOutput } from './types';

function toy() {
  return functionToy(
    [
      { id: 'base', dim: 0, tags: [] },
      { id: 'a', dim: 2, tags: [] },
    ],
    [{ id: 'g', sense: 'max' }],
    { structure: 0, x: [] },
    (_s, i, x, draw) => {
      const v = i === 0 ? 0 : 0.6 * x[0]! + 0.4 * x[1]!;
      return { goals: [v], margins: [isSafetyAuditDraw(draw) ? 0.3 : (0.9 - v) / 0.9], descriptors: [x[0] ?? 0, x[1] ?? 0] };
    },
  );
}

describe('checkpoint serialization (C7)', () => {
  it('keeps missing-margin indices and non-finite numbers across serialization and JSON', () => {
    const o: EvalOutput = { goals: [1, Number.NaN], margins: [0.5, 10, -0.2], regulariser: 0, descriptors: [0.1], missing: Int32Array.of(1) };
    const s = serializeOutput(o);
    expect(s.missing).toEqual([1]);
    const back = deserializeOutput(s);
    expect(Array.from(back.missing!)).toEqual([1]);
    expect(Array.from(back.margins)).toEqual([0.5, 10, -0.2]);
    const cp = { version: CHECKPOINT_VERSION, fingerprint: 'f', label: 'S1', phase: 1, euUsed: 3, state: { records: [{ id: 0, structure: 0, x: [], box: 0, draw: -1, stage: 'S0', out: s }] } } as unknown as PlannerCheckpointData;
    const json = decodeCheckpoint(encodeCheckpoint(cp));
    expect(json.state.records[0]!.out.missing).toEqual([1]);
    expect(Number.isNaN(json.state.records[0]!.out.goals[1]!)).toBe(true);
    // an output without missing margins serializes without the field (older readers unaffected)
    expect('missing' in serializeOutput({ goals: [1], margins: [1], regulariser: 0, descriptors: [] })).toBe(false);
  });

  it('keeps unavailable-goal indices (D4-05) across serialization and JSON', () => {
    const o: EvalOutput = { goals: [1, 0], margins: [0.5], regulariser: 0, descriptors: [], missingGoals: Int32Array.of(1) };
    const s = serializeOutput(o);
    expect(s.missingGoals).toEqual([1]);
    expect(Array.from(deserializeOutput(s).missingGoals!)).toEqual([1]);
    const cp = { version: CHECKPOINT_VERSION, fingerprint: 'f', label: 'S1', phase: 1, euUsed: 3, state: { records: [{ id: 0, structure: 0, x: [], box: 0, draw: -1, stage: 'S0', out: s }] } } as unknown as PlannerCheckpointData;
    expect(decodeCheckpoint(encodeCheckpoint(cp)).state.records[0]!.out.missingGoals).toEqual([1]);
    expect('missingGoals' in serializeOutput({ goals: [1], margins: [1], regulariser: 0, descriptors: [] })).toBe(false);
  });

  it('is version 8: materialized dose and explicit planned step scope change cached prescriptions', () => {
    expect(CHECKPOINT_VERSION).toBe(8);
  });
});

describe('resume under changed safety semantics (C7)', () => {
  const cfg: PlannerConfig = { seed: 'ckpt', tier: 'S', totalEU: 900, ensembleSize: 8, holdoutSize: 8 };

  it('a matching checkpoint resumes bitwise (audit included); an older-version checkpoint is refused', async () => {
    const t = toy();
    const saved: string[] = [];
    const ref = await runPlanner(t.problem, createLocalEvaluator(t.model, t.problem.structures), { ...cfg, checkpoint: { save: (cp) => void saved.push(encodeCheckpoint(cp)) } });
    expect(saved.length).toBeGreaterThan(0);
    const cp = decodeCheckpoint(saved[Math.floor(saved.length / 2)]!);
    expect(cp.version).toBe(CHECKPOINT_VERSION);
    const resumed = await runPlanner(t.problem, createLocalEvaluator(t.model, t.problem.structures), { ...cfg, checkpoint: { save: () => {}, resume: cp } });
    expect(resumed.provenance.resumedFrom).toBe(cp.label);
    expect(resumed.options.map((o) => [o.structureIndex, Array.from(o.x), o.safetyAudit.screen.status, o.safetyAudit.screen.passes])).toEqual(
      ref.options.map((o) => [o.structureIndex, Array.from(o.x), o.safetyAudit.screen.status, o.safetyAudit.screen.passes]),
    );
    const old = await runPlanner(t.problem, createLocalEvaluator(t.model, t.problem.structures), { ...cfg, checkpoint: { save: () => {}, resume: { ...cp, version: 6 } } });
    expect(old.provenance.resumedFrom).toBe('refused');
  });

  it('a checkpoint taken with another safety-audit size has another fingerprint and is refused', async () => {
    const t = toy();
    const saved: PlannerCheckpointData[] = [];
    await runPlanner(t.problem, createLocalEvaluator(t.model, t.problem.structures), { ...cfg, checkpoint: { save: (cp) => void saved.push(cp) } });
    const r = await runPlanner(t.problem, createLocalEvaluator(t.model, t.problem.structures), { ...cfg, safetyAuditSize: 4, checkpoint: { save: () => {}, resume: saved[0]! } });
    expect(r.provenance.resumedFrom).toBe('refused');
  });
});
