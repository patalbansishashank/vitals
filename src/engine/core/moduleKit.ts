/**
 * Helper for declaring engine modules: fills unimplemented hooks with no-ops so every stub compiles and runs
 * (docs/MODEL_SPEC.md §11 build plan). Module authors replace hooks one by one inside their own folder.
 */
import type { EngineModule, ModuleContext } from '../types/module';
import type { SignalBus } from '../types/signals';

type Hooks<S extends object, K extends object> = Partial<
  Pick<EngineModule<S, K>, 'startDay' | 'stepHour' | 'endOfDay' | 'recordHour' | 'recordDay' | 'finalize' | 'endBurnIn'>
>;

export interface ModuleSpec<S extends object, K extends object>
  extends Omit<EngineModule<S, K>, 'startDay' | 'stepHour' | 'endOfDay' | 'recordHour' | 'recordDay' | 'finalize' | 'endBurnIn' | 'prepare' | 'init'>,
    Hooks<S, K> {
  prepare?: (ctx: ModuleContext) => K;
  init: (k: K, ctx: ModuleContext, bus: SignalBus) => S;
}

const noop = (): void => {};

export function defineModule<S extends object, K extends object = Record<string, never>>(spec: ModuleSpec<S, K>): EngineModule<S, K> {
  return {
    id: spec.id,
    specSection: spec.specSection,
    dossiers: spec.dossiers,
    params: spec.params,
    reads: spec.reads,
    writes: spec.writes,
    records: spec.records,
    prepare: spec.prepare ?? ((() => ({})) as unknown as (ctx: ModuleContext) => K),
    init: spec.init,
    startDay: spec.startDay ?? noop,
    stepHour: spec.stepHour ?? noop,
    endOfDay: spec.endOfDay ?? noop,
    recordHour: spec.recordHour ?? noop,
    recordDay: spec.recordDay ?? noop,
    finalize: spec.finalize ?? noop,
    ...(spec.endBurnIn ? { endBurnIn: spec.endBurnIn } : {}),
  };
}
