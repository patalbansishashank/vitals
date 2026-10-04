/**
 * Planner evaluator worker (MODEL_SPEC §10.2): receives one MessagePort from the main thread and serves `init` /
 * `calibrate` / `eval` requests from the coordinator (engine worker) on it. Holds an `EnginePlanModel` per problem
 * variant (via `EvaluatorHost`); no randomness and no clocks except the calibration timer.
 */
import { attachEvaluator, type PortLike } from './planner.pool';

self.onmessage = (ev: MessageEvent) => {
  const data = ev.data as { type?: string; port?: MessagePort };
  if (data?.type === 'port' && data.port) attachEvaluator(data.port as unknown as PortLike, () => performance.now());
};
