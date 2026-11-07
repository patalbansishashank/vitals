/**
 * Evaluation side of the planner (MODEL_SPEC §10.2): everything an evaluator worker holds — the compiled request,
 * the structure list (same order as the coordinator's), the goal bindings and the ensemble — for each problem variant
 * (the main problem and the extended-horizon time-to-target problems, 18 §4.14.3). Pure: the same code runs in the
 * worker (`src/workers/planner.evaluator.worker.ts`) and in Node tests (local evaluator), so results are identical.
 */
import { SAFETY_ALPHA, SAFETY_AUDIT_ENSEMBLE, contentHash, type SafetyCertificate } from '@/lib/bodyContracts';
import type { SimulationResult } from '../../types/result';
import type { Schedule } from '../../types/schedule';
import { confirmedSubjectCertificate, confirmedSubjectSimulation } from './replan';
import type { ReplanRequest } from './replanTypes';
import { evaluatePlan } from '../optim/pipeline';
import { jointScreenOf } from '../optim/robust';
import { SAFETY_AUDIT_DRAW_OFFSET, violation, type EvalOutput, type EvalRequest } from '../optim/types';
import { compileRequest, withHorizon, type PlanningContext } from './context';
import type { GoalBinding } from './goalSpecs';
import { EnginePlanModel, REQUIRED_SAFETY_MARGINS, REQUIRED_SAFETY_MARGIN_IDS } from './model';
import {
  AUDIT_SAMPLER_VERSION,
  auditSubjectHash,
  contextForSchedule,
  evaluatePlanSafety,
  issueCertificate,
  plannerCertificateInputs,
  type AuditProtocol,
  type PlannerSafetyCertificate,
} from './safetyAudit';
import { enumerateStructures, type SkeletonStructure } from './skeleton';
import type { LimitGroupId, PlannerRequest } from './types';
import { idealRequest, relaxGroup } from './limits';

/** Problem variant an evaluation belongs to. */
export type EvalVariant =
  | { kind: 'main' }
  | { kind: 'ttt'; goal: number; horizonDays: number; theta: number; direction: 1 | -1 }
  /** The Ideal (PLANNER_V2_SPEC §2): the request with every practical limit relaxed (`idealRequest`). */
  | { kind: 'ideal' }
  /** One limit group relaxed to its Ideal value (`relaxGroup`): the shadow price of that limit (§2.4). */
  | { kind: 'limit'; group: LimitGroupId };

export interface HostInit {
  request: PlannerRequest;
  /** Selection ensemble, outcome holdout and the reserved safety-audit stream (C5/D4-03; default = `size`). */
  ensemble: { seed: number | string; size: number; holdoutSize?: number; safetyAuditSize?: number };
  /** Calibrated prior chance cushion per margin (model default when absent). */
  cushion?: readonly number[];
}

/**
 * (C5/D4-03, A1-035) The safety-audit protocol a host declares once, at initialization: the evaluator ensemble's seed and
 * the reserved stream's member count M (`safetyAuditSize`, default the selection size), the named stream
 * 'ensemble/safetyAudit', the Latin-hypercube sampler and member order m = 0…M−1. Every variant of the host (main, Ideal,
 * limits) draws its audit members from this one stream, so the Ideal's protocol is the base ensemble's — never the
 * optimizer's search seed (`PlannerConfig.seed`).
 */
export function auditProtocolOf(init: HostInit): AuditProtocol {
  return {
    M: Math.max(0, Math.floor(init.ensemble.safetyAuditSize ?? init.ensemble.size)),
    seed: init.ensemble.seed,
    stream: 'ensemble/safetyAudit',
    sampler: 'lhs',
    samplerVersion: AUDIT_SAMPLER_VERSION,
    order: 'memberAscending',
  };
}

/** The audit of one exact frozen schedule (A1-011): member outputs, the nominal output, the subject and protocol. */
export interface FrozenAudit {
  outputs: EvalOutput[];
  nominal: EvalOutput;
  subjectHash: string;
  protocol: AuditProtocol;
}

/** One evaluation of `schedule` on `model` at `draw` (the same outputs `evaluatePlan` builds, without decode/repair). */
function evaluateSchedule(model: EnginePlanModel, schedule: Schedule, draw: number): EvalOutput {
  const sim = model.simulate(schedule, draw);
  const out: EvalOutput = { goals: Float64Array.from(model.goals(sim)), margins: Float64Array.from(model.constraints(sim, schedule)), regulariser: 0, descriptors: new Float64Array(0) };
  const missing = model.missingMargins(sim);
  if (missing.length) out.missing = Int32Array.from(missing);
  return out;
}

/**
 * Audit EXACTLY this frozen, fully finalized schedule (C5/D4-03, A1-011): the reserved stream's members m < M (draw
 * `SAFETY_AUDIT_DRAW_OFFSET + m`, parameters from the model's declared ensemble) and its nominal run; the hash of the
 * evaluated schedule and of the evaluated parameter-vector sequence travel with the result, so a certificate binds only
 * the subject and protocol that were actually evaluated. One call is the one automatic attempt; nothing reseeds.
 */
export function auditFrozenSchedule(model: EnginePlanModel, schedule: Schedule, protocol: AuditProtocol): FrozenAudit {
  const M = Math.max(0, Math.floor(protocol.M));
  const outputs: EvalOutput[] = [];
  const params: Array<number[] | null> = [];
  for (let m = 0; m < M; m++) {
    const draw = SAFETY_AUDIT_DRAW_OFFSET + m;
    const p = model.paramsFor(draw);
    params.push(p ? Array.from(p) : null);
    outputs.push(evaluateSchedule(model, schedule, draw));
  }
  const nominal = evaluateSchedule(model, schedule, -1);
  return { outputs, nominal, subjectHash: auditSubjectHash(schedule), protocol: { ...protocol, M, paramsHash: contentHash({ stream: 'ensemble/safetyAudit', params }) } };
}

/**
 * (C5, A1-001/A1-004) ONE declared final audit of a changed start subject — the actual final prescription (anchored to the
 * chosen start date, or a custom scenario started as a living prescription) under the current profile/screening — in a new
 * decision episode. The source certificate's protocol (seed, M) is reused, so a repeated request reproduces the same draws
 * (a deterministic recheck, never a new sampling opportunity); without a source the protocol is declared from the subject
 * itself (tier-S size, seed = the subject hash). A failed source audit is final: no audit runs and the result is null with
 * reason 'sourceAuditFailed'. The source certificate is kept in the new certificate's history. The caller revalidates the
 * certificate on the same subject before any write. Start subjects only (the whole schedule from its start date): a later
 * day's prescription is re-audited by a re-plan.
 */
export function finalSubjectCertificate(i: {
  request: PlannerRequest;
  schedule: Schedule;
  source?: SafetyCertificate | null;
  historyHash?: string;
  episodeId: string;
  createdAt: string;
}): { certificate: PlannerSafetyCertificate | null; reason: string | null } {
  const src = (i.source ?? null) as PlannerSafetyCertificate | null;
  if (src && (src.status === 'failed' || src.history?.some((h) => h.status === 'failed'))) return { certificate: null, reason: 'sourceAuditFailed' };
  const ctx = contextForSchedule(i.request, i.schedule);
  if (ctx.caps.blocked) return { certificate: null, reason: 'blocked' };
  const base: AuditProtocol = src?.drawProtocol
    ? { M: src.drawProtocol.M, seed: src.drawProtocol.seed }
    : { M: SAFETY_AUDIT_ENSEMBLE.S, seed: `final/${auditSubjectHash(i.schedule)}` };
  const M = Math.max(0, Math.floor(base.M));
  const protocol: AuditProtocol = { ...base, M, stream: 'ensemble/safetyAudit', sampler: 'lhs', samplerVersion: AUDIT_SAMPLER_VERSION, order: 'memberAscending' };
  const model = new EnginePlanModel(ctx, { bindings: [], ensemble: { seed: protocol.seed, size: Math.max(1, M), safetyAuditSize: Math.max(1, M) } });
  const full = new EnginePlanModel(ctx, { bindings: [], recordAll: true, fullMode: true });
  const evaluation = evaluatePlanSafety(ctx, i.schedule, full.simulate(i.schedule, -1));
  const r = auditFrozenSchedule(model, i.schedule, protocol);
  const nominalBad = REQUIRED_SAFETY_MARGINS.some((c) => !(r.nominal.margins[c]! >= 0)) || violation(Array.from(REQUIRED_SAFETY_MARGINS, (c) => r.nominal.margins[c]!)) > 0;
  const screen = jointScreenOf(r.outputs, REQUIRED_SAFETY_MARGINS, SAFETY_ALPHA, { knownViolation: nominalBad });
  const history = [...(src?.history ?? []), ...(src ? [{ fingerprint: src.fingerprint, episodeId: src.episodeId, status: src.status, at: src.createdAt }] : [])];
  const certificate = issueCertificate(plannerCertificateInputs(ctx, i.schedule, REQUIRED_SAFETY_MARGIN_IDS, r.protocol, i.historyHash), { screen, subjectHash: r.subjectHash, protocol: r.protocol }, evaluation.status, {
    episodeId: i.episodeId,
    createdAt: i.createdAt,
    ...(history.length ? { history } : {}),
  });
  return { certificate, reason: null };
}

/**
 * The nominal full-trace simulation of one start subject (the whole schedule from its start date under the request's
 * profile): exactly the simulation the declared final audit evaluates the typed constraints on (`finalSubjectCertificate`),
 * so a lifecycle revalidation can resolve the constraints that need the engine's trace (the 7-day deficit cap) instead of
 * leaving them Unchecked. Start subjects only: a later day's subject runs from the confirmed state (a re-plan's).
 */
export function startSubjectSimulation(request: PlannerRequest, schedule: Schedule): SimulationResult {
  const ctx = contextForSchedule(request, schedule);
  return new EnginePlanModel(ctx, { bindings: [], recordAll: true, fullMode: true }).simulate(schedule, -1);
}

/**
 * (C5) The nominal simulation of a confirmed-state subject (adopt, resume): the re-plan's own forward run from the confirmed
 * state the request carries over the whole schedule with the realised past (`confirmedSubjectSimulation`), so a lifecycle
 * revalidation of a later day's subject resolves the trace-based constraints (the 7-day deficit cap) as the re-plan that
 * certified it did, instead of leaving them Unchecked. Indexed from plan day 0.
 */
export function confirmedStateSimulation(req: ReplanRequest, schedule: Schedule): SimulationResult {
  return confirmedSubjectSimulation(req, schedule);
}

/**
 * (C5/A1-004) The one declared final audit of a subject bound to the confirmed state (adopt, resume, after days lived or a
 * check-in): the re-plan's own certification of the schedule as it stands, from that state and history
 * (`confirmedSubjectCertificate`). A pass issues a re-plan-style certificate bound to the subject, history and state; a
 * failure issues a failed one (never authorizes).
 */
export function confirmedStateCertificate(i: Parameters<typeof confirmedSubjectCertificate>[0]): { certificate: PlannerSafetyCertificate | null; reason: string | null } {
  return confirmedSubjectCertificate(i);
}

/**
 * Daily band series of one exact schedule for draws [drawBase, drawBase + draws) (series-major, each of length T + 1).
 * Used for a finalized schedule that the (structure, genome) evaluators cannot reproduce (A1-011: bands of the frozen
 * prescription itself).
 */
export function bandsOfSchedule(model: EnginePlanModel, schedule: Schedule, T: number, draws: number, seriesIds: readonly string[], drawBase = 0): Float32Array[] {
  const out: Float32Array[] = [];
  for (let m = drawBase; m < drawBase + draws; m++) {
    const rec = model.bandRecord(model.simulate(schedule, m));
    const buf = new Float32Array(seriesIds.length * T).fill(Number.NaN);
    seriesIds.forEach((id, k) => {
      const y = rec.get(id as never);
      if (y) buf.set(y.subarray(0, T), k * T);
    });
    out.push(buf);
  }
  return out;
}

export function variantKey(v: EvalVariant): string {
  switch (v.kind) {
    case 'main':
    case 'ideal':
      return v.kind;
    case 'limit':
      return `limit:${v.group}`;
    default:
      return `ttt:${v.goal}:${v.horizonDays}:${v.theta}:${v.direction}`;
  }
}

/** The request a variant plans for (the Ideal and limit variants transform the user's request; deterministic). */
export function variantRequest(init: HostInit, v: EvalVariant): PlannerRequest {
  if (v.kind === 'ideal') return idealRequest(init.request).request;
  if (v.kind === 'limit') return relaxGroup(init.request, v.group);
  return init.request;
}

export interface VariantProblem {
  ctx: PlanningContext;
  structures: SkeletonStructure[];
  model: EnginePlanModel;
  bindings: GoalBinding[];
}

/** Build the variant's context, structures and model (deterministic in (request, variant)). */
export function buildVariant(init: HostInit, v: EvalVariant, base?: PlanningContext): VariantProblem {
  const ctx0 = v.kind === 'ideal' || v.kind === 'limit' ? compileRequest(variantRequest(init, v)) : (base ?? compileRequest(init.request));
  const ctx = v.kind === 'ttt' ? withHorizon(ctx0, v.horizonDays) : ctx0;
  const structures = enumerateStructures(ctx);
  const bindings: GoalBinding[] =
    v.kind !== 'ttt'
      ? ctx.goals.map((g) => ({ metric: g.metric, functional: g.functional, useTissueMass: g.useTissueMass }))
      : [{ metric: ctx.goals[v.goal]!.metric, functional: 'ttt', useTissueMass: ctx.goals[v.goal]!.useTissueMass, ttt: { theta: v.theta, direction: v.direction } }];
  const model = new EnginePlanModel(ctx, { bindings, ensemble: init.ensemble, ...(init.cushion ? { cushion: init.cushion } : {}) });
  return { ctx, structures, model, bindings };
}

/** Holds variant problems and answers batches (one per worker, or one local instance). */
export class EvaluatorHost {
  private readonly variants = new Map<string, VariantProblem>();
  private base: PlanningContext | null = null;
  constructor(readonly init: HostInit) {}

  variant(v: EvalVariant): VariantProblem {
    const k = variantKey(v);
    let p = this.variants.get(k);
    if (!p) {
      this.base = this.base ?? compileRequest(this.init.request);
      p = buildVariant(this.init, v, this.base);
      this.variants.set(k, p);
    }
    return p;
  }

  evaluate(v: EvalVariant, batch: readonly EvalRequest[]): EvalOutput[] {
    const p = this.variant(v);
    return batch.map((r) => evaluatePlan(p.model, p.structures, r));
  }

  /**
   * Daily band series of one plan for ensemble draws 0..draws−1 (reuses the S5 ensemble runs this host already made;
   * otherwise simulates). Returns one Float32Array per draw: series-major, each of length T + 1 (t = 0 first), in the
   * order of `seriesIds`.
   */
  bands(v: EvalVariant, structure: number, x: Float64Array, draws: number, seriesIds: readonly string[], drawBase = 0): Float32Array[] {
    const p = this.variant(v);
    const st = p.structures[structure]!;
    const out: Float32Array[] = [];
    const T = p.ctx.horizonDays + 1;
    let sched: ReturnType<VariantProblem['model']['repair']>['schedule'] | null = null;
    for (let m = drawBase; m < drawBase + draws; m++) {
      let rec = p.model.cachedBands(st.id, x, m);
      if (!rec) {
        sched = sched ?? p.model.repair(st, p.model.decode(st, x)).schedule;
        rec = p.model.bandRecord(p.model.simulate(sched, m));
      }
      const buf = new Float32Array(seriesIds.length * T).fill(Number.NaN);
      seriesIds.forEach((id, k) => {
        const y = rec!.get(id as never);
        if (y) buf.set(y.subarray(0, T), k * T);
      });
      out.push(buf);
    }
    return out;
  }

  /** Calibration (18 §4.19): ms per nominal horizon simulation of the default genome of the first real structure. */
  calibrate(now: () => number, repeats = 3): number {
    const p = this.variant({ kind: 'main' });
    const st = p.structures[Math.min(1, p.structures.length - 1)]!;
    const times: number[] = [];
    for (let i = 0; i < repeats; i++) {
      const t0 = now();
      evaluatePlan(p.model, p.structures, { structure: p.structures.indexOf(st), x: Float64Array.from(st.x0), draw: -1 });
      times.push(now() - t0);
    }
    times.sort((a, b) => a - b);
    return times[Math.floor(times.length / 2)]!;
  }
}
