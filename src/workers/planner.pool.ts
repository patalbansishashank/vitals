/**
 * Planner worker-pool binding (dossier 18 §4.19; MODEL_SPEC §10.2). Transport-agnostic: works with browser
 * MessagePorts and Node's MessageChannel (tests). The coordinator (engine worker) turns each evaluator's port into a
 * `WorkerCall` for `createPooledEvaluator`, which re-assembles outputs by request index, so results never depend on the
 * worker count or completion order. Genomes travel as one transferred Float64Array per batch.
 *
 * Contract boundary (C6/D4-03, 2026-10-18): every field of an evaluation request and output crosses the port — a request's
 * extra fields (e.g. a named draw stream) ride beside the packed genomes, and outputs keep every field the host returns
 * (statuses, availability masks, margin metadata), so a pooled evaluation is the in-thread evaluation for any worker count.
 * Nothing is dropped, and no status is re-encoded as a number.
 */
import { EvaluatorHost, variantKey, type EvalVariant, type HostInit } from '@/engine/planner/domain/evaluatorHost';
import { ReplanEvaluatorHost, type ReplanEvalInit } from '@/engine/planner/domain/replan';
import type { EvalOutput, EvalRequest } from '@/engine/planner/optim/types';
import type { WorkerCall } from '@/engine/planner/optim/pipeline';
import { TIER_BUDGET_EU, budgetForDevice, type Tier } from '@/engine/planner/optim/pipeline';

/** Minimal port surface shared by DOM MessagePort and node:worker_threads MessagePort. */
export interface PortLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent) => void) | null;
  start?(): void;
  close?(): void;
}

/** Per-request fields beyond structure/genome/draw (null = none), carried as structured-clone data (C6/D4-03). */
export type RequestExtras = ReadonlyArray<Readonly<Record<string, unknown>> | null>;

export type EvalMessage =
  | { type: 'init'; id: number; init: HostInit }
  | { type: 'eval'; id: number; variant: EvalVariant; structure: Int32Array; draw: Int32Array; offsets: Int32Array; x: Float64Array; extra?: RequestExtras }
  | { type: 'calibrate'; id: number; repeats: number }
  /** Living-plan re-plan problem (PLANNER_V2_SPEC §7): the evaluator builds a `ReplanEvaluatorHost` from it. */
  | { type: 'initReplan'; id: number; init: ReplanEvalInit }
  | { type: 'evalReplan'; id: number; structure: Int32Array; draw: Int32Array; offsets: Int32Array; x: Float64Array; extra?: RequestExtras }
  | { type: 'bands'; id: number; variant: EvalVariant; structure: number; x: Float64Array; draws: number; series: string[]; drawBase?: number };

export type EvalReply =
  | { type: 'ready'; id: number }
  | { type: 'result'; id: number; outputs: EvalOutput[] }
  | { type: 'calibrated'; id: number; ms: number }
  | { type: 'bands'; id: number; data: Float32Array[] }
  | { type: 'error'; id: number; message: string };

/**
 * Serve evaluation requests on a port (evaluator side): `init` (re)builds the host from the request, then `calibrate`
 * and `eval` batches are answered in arrival order. Returns a detach function.
 */
export function attachEvaluator(port: PortLike, now: () => number): () => void {
  let host: EvaluatorHost | null = null;
  let replanHost: ReplanEvaluatorHost | null = null;
  port.onmessage = (ev: MessageEvent) => {
    const m = ev.data as EvalMessage;
    try {
      if (m.type === 'initReplan') {
        replanHost = new ReplanEvaluatorHost(m.init);
        port.postMessage({ type: 'ready', id: m.id } satisfies EvalReply);
        return;
      }
      if (m.type === 'evalReplan') {
        if (!replanHost) throw new Error('planner evaluator: re-plan not initialised');
        const outputs = replanHost.evaluate(unpackBatch(m)).map(plainOutput);
        port.postMessage({ type: 'result', id: m.id, outputs } satisfies EvalReply);
        return;
      }
      if (m.type === 'init') {
        host = new EvaluatorHost(m.init);
        port.postMessage({ type: 'ready', id: m.id } satisfies EvalReply);
        return;
      }
      if (!host) throw new Error('planner evaluator: not initialised');
      if (m.type === 'bands') {
        const data = host.bands(m.variant, m.structure, m.x, m.draws, m.series, m.drawBase ?? 0);
        port.postMessage({ type: 'bands', id: m.id, data } satisfies EvalReply, data.map((d) => d.buffer));
        return;
      }
      if (m.type === 'calibrate') {
        port.postMessage({ type: 'calibrated', id: m.id, ms: host.calibrate(now, m.repeats) } satisfies EvalReply);
        return;
      }
      const outputs = host.evaluate(m.variant, unpackBatch(m)).map(plainOutput);
      port.postMessage({ type: 'result', id: m.id, outputs } satisfies EvalReply);
    } catch (e) {
      port.postMessage({ type: 'error', id: m.id, message: e instanceof Error ? e.message : String(e) } satisfies EvalReply);
    }
  };
  port.start?.();
  return () => {
    port.onmessage = null;
  };
}

const PACKED_REQUEST_KEYS = new Set(['structure', 'x', 'draw']);

/** Extra fields of each request (null when a request has none); undefined when no request has any. */
export function requestExtras(batch: readonly EvalRequest[]): RequestExtras | undefined {
  let any = false;
  const out: Array<Record<string, unknown> | null> = new Array(batch.length);
  for (let i = 0; i < batch.length; i++) {
    const r = batch[i] as unknown as Record<string, unknown>;
    let e: Record<string, unknown> | null = null;
    for (const k of Object.keys(r)) {
      if (PACKED_REQUEST_KEYS.has(k) || r[k] === undefined || typeof r[k] === 'function') continue;
      (e ??= {})[k] = r[k];
    }
    out[i] = e;
    if (e) any = true;
  }
  return any ? out : undefined;
}

export function unpackBatch(m: { structure: Int32Array; draw: Int32Array; offsets: Int32Array; x: Float64Array; extra?: RequestExtras }): EvalRequest[] {
  const n = m.structure.length;
  const batch: EvalRequest[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const req: EvalRequest = { structure: m.structure[i]!, draw: m.draw[i]!, x: m.x.slice(m.offsets[i]!, m.offsets[i + 1]!) };
    const e = m.extra?.[i];
    batch[i] = e ? ({ ...e, ...req } as EvalRequest) : req;
  }
  return batch;
}

const NUMERIC_OUTPUT_KEYS = new Set(['goals', 'margins', 'descriptors', 'features']);

/**
 * A transferable copy of one output keeping EVERY field (C6/D4-03): the numeric vectors as compact Float64Arrays, other typed
 * arrays copied, plain data structured-cloned, primitives as they are. Only functions and undefined are left out (they
 * cannot cross a port).
 */
export function plainOutput(o: EvalOutput): EvalOutput {
  const src = o as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (v === undefined || typeof v === 'function') continue;
    if (NUMERIC_OUTPUT_KEYS.has(k) && v !== null && typeof v === 'object') out[k] = Float64Array.from(v as ArrayLike<number>);
    else if (ArrayBuffer.isView(v)) out[k] = (v as unknown as Float64Array).slice();
    else if (v !== null && typeof v === 'object') out[k] = structuredClone(v);
    else out[k] = v;
  }
  return out as unknown as EvalOutput;
}

/** Coordinator side of one evaluator port: request/response by id, optional pause gate. */
export class EvaluatorPort {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: EvalReply) => void; reject: (e: Error) => void }>();
  constructor(
    private readonly port: PortLike,
    private readonly gate: () => Promise<void> = () => Promise.resolve(),
  ) {
    port.onmessage = (ev: MessageEvent) => {
      const r = ev.data as EvalReply;
      const p = this.pending.get(r.id);
      if (!p) return;
      this.pending.delete(r.id);
      if (r.type === 'error') p.reject(new Error(r.message));
      else p.resolve(r);
    };
    port.start?.();
  }

  private send(msg: EvalMessage, transfer: Transferable[] = []): Promise<EvalReply> {
    return new Promise((resolve, reject) => {
      this.pending.set(msg.id, { resolve, reject });
      this.port.postMessage(msg, transfer);
    });
  }

  /** WorkerCall for a problem variant (one per variant; all share this port); `null` = the re-plan problem (`initReplan`). */
  call(variant: EvalVariant | null): WorkerCall {
    return async (batch: readonly EvalRequest[]) => {
      await this.gate();
      const n = batch.length;
      const offsets = new Int32Array(n + 1);
      for (let i = 0; i < n; i++) offsets[i + 1] = offsets[i]! + batch[i]!.x.length;
      const x = new Float64Array(offsets[n]!);
      const structure = new Int32Array(n);
      const draw = new Int32Array(n);
      for (let i = 0; i < n; i++) {
        x.set(batch[i]!.x, offsets[i]!);
        structure[i] = batch[i]!.structure;
        draw[i] = batch[i]!.draw;
      }
      const id = this.nextId++;
      const extra = requestExtras(batch);
      const msg: EvalMessage = variant
        ? { type: 'eval', id, variant, structure, draw, offsets, x, ...(extra ? { extra } : {}) }
        : { type: 'evalReplan', id, structure, draw, offsets, x, ...(extra ? { extra } : {}) };
      const r = await this.send(msg, [x.buffer, structure.buffer, draw.buffer, offsets.buffer]);
      if (r.type !== 'result') throw new Error(`planner pool: unexpected reply ${r.type}`);
      return r.outputs;
    };
  }

  async initReplan(init: ReplanEvalInit): Promise<void> {
    const r = await this.send({ type: 'initReplan', id: this.nextId++, init });
    if (r.type !== 'ready') throw new Error('planner pool: re-plan init failed');
  }

  async init(init: HostInit): Promise<void> {
    const r = await this.send({ type: 'init', id: this.nextId++, init });
    if (r.type !== 'ready') throw new Error('planner pool: init failed');
  }

  async bands(variant: EvalVariant, structure: number, x: Float64Array, draws: number, series: readonly string[], drawBase = 0): Promise<Float32Array[]> {
    await this.gate();
    const r = await this.send({ type: 'bands', id: this.nextId++, variant, structure, x: Float64Array.from(x), draws, series: [...series], drawBase });
    if (r.type !== 'bands') throw new Error('planner pool: bands failed');
    return r.data;
  }

  async calibrate(repeats = 3): Promise<number> {
    const r = await this.send({ type: 'calibrate', id: this.nextId++, repeats });
    if (r.type !== 'calibrated') throw new Error('planner pool: calibration failed');
    return r.ms;
  }

  /** Reject every pending call (hard cancel). */
  fail(reason: string): void {
    for (const p of this.pending.values()) p.reject(new Error(reason));
    this.pending.clear();
  }
}

/** One cached WorkerCall per (port, variant), so pooled evaluators can be built per variant. */
export function workerCallsFor(ports: readonly EvaluatorPort[]): (v: EvalVariant) => WorkerCall[] {
  const cache = new Map<string, WorkerCall[]>();
  return (v) => {
    const k = variantKey(v);
    let calls = cache.get(k);
    if (!calls) cache.set(k, (calls = ports.map((p) => p.call(v))));
    return calls;
  };
}

/** Pool size N = clamp(hardwareConcurrency − 1, 1, 8); phones ≤ 3 (18 §4.19). */
export function plannerPoolSize(hardwareConcurrency: number | undefined, mobile: boolean): number {
  const hc = Number.isFinite(hardwareConcurrency) && (hardwareConcurrency ?? 0) > 0 ? (hardwareConcurrency as number) : 4;
  return Math.max(1, Math.min(mobile ? 3 : 8, hc - 1));
}

/** Device class → target wall time (desktop 10 s, mobile 20 s, 18 §4.11) and tier from calibration. */
export function plannerBudget(msPerEU: number, workers: number, mobile: boolean): { tier: Tier; totalEU: number; targetSeconds: number } {
  const targetSeconds = mobile ? 20 : 10;
  const b = budgetForDevice({ msPerEU, workers, targetSeconds });
  // a slow device that cannot afford tier S in the target time still gets tier S (quality floor); the run just takes longer
  return { tier: b.tier, totalEU: TIER_BUDGET_EU[b.tier], targetSeconds };
}
