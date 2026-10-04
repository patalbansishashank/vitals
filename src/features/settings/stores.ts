/**
 * Every module that registers a persisted store (src/state/persistence.ts `registerStore`). Settings can be the first
 * screen a visitor opens, before Your body, the Simulator or the Planner have loaded their stores; without their
 * registrations the data section would omit them from "what is stored" and import would skip their validation,
 * merge rules and rehydration. Loading them is cheap (they are shared chunks) and happens once.
 */
let loading: Promise<void> | null = null;

export function loadAllStores(): Promise<void> {
  loading ??= Promise.all([
    import('@/state/profileStore'),
    import('@/state/scheduleStore'),
    import('@/state/simulationStore'),
    import('@/state/plannerStore'),
    import('@/state/safetyStore'),
    import('@/state/settingsStore'),
    import('@/features/simulator/results/store'),
    import('@/app/lastRoute'),
  ]).then(
    () => undefined,
    () => undefined, // a chunk that fails to load must not block export/import of everything else
  );
  return loading;
}
