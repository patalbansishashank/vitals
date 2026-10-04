/**
 * Module list the planner runs the engine with. Identical physics to `MODULES`; the only difference is an adapter for
 * modules that keep per-run caches in their constants object (intake's meal-trajectory caches, docs/CONTRACT_REQUESTS.md
 * 2026-09-30 18:45): their constants are built inside `init` and carried in the state, so `RunOptions.initialSnapshot`
 * restores them completely and a restored run is bit-identical to one that ran the burn-in (verified in the core's
 * loop tests with the same adapter, and in `snapshot.test.ts` here). Harmless once the module is fixed.
 */
import { MODULES } from '../../core/moduleRegistry';
import type { AnyEngineModule } from '../../types/module';

/** Modules whose K is not immutable after prepare (contract violation tracked in CONTRACT_REQUESTS). */
const K_IN_STATE: ReadonlySet<string> = new Set(['intake']);

function kInState(m: AnyEngineModule): AnyEngineModule {
  type W = { k: object; s: object };
  const w: AnyEngineModule = {
    ...m,
    prepare: () => ({}),
    init: (_k, ctx, bus) => {
      const k = m.prepare(ctx);
      return { k, s: m.init(k, ctx, bus) } as W;
    },
    startDay: (x, _k, bus, d, c) => m.startDay((x as W).s, (x as W).k, bus, d, c),
    stepHour: (x, _k, bus, h, d, c) => m.stepHour((x as W).s, (x as W).k, bus, h, d, c),
    endOfDay: (x, _k, bus, d, c) => m.endOfDay((x as W).s, (x as W).k, bus, d, c),
    recordHour: (x, _k, bus, o) => m.recordHour((x as W).s, (x as W).k, bus, o),
    recordDay: (x, _k, bus, o) => m.recordDay((x as W).s, (x as W).k, bus, o),
    finalize: (x, _k, sink) => m.finalize((x as W).s, (x as W).k, sink),
  };
  if (m.endBurnIn) {
    const eb = m.endBurnIn.bind(m);
    w.endBurnIn = (x, _k, bus, ctx) => eb((x as W).s, (x as W).k, bus, ctx);
  }
  return w;
}

/** The planner's module list (same ids, params and order as the registry). */
export const PLANNER_MODULES: readonly AnyEngineModule[] = MODULES.map((m) => (K_IN_STATE.has(m.id) ? kInState(m) : m));
