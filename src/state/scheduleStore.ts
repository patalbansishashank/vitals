/**
 * Simulator scenarios (INFORMATION_ARCHITECTURE §1, simulator-schedule.md), as a projection: one `scenarios` document
 * per scenario and the active id in `uiPrefs`; boot cache and export key `vitals.scenarios` (versioned).
 *
 * A scenario is a name plus an engine `Schedule` — programs (day templates keyed by letter), the dense day→program
 * map with per-day overrides, one-off fast events, named blocks, horizon and energy reference — in exactly the shape
 * `compileSchedule` consumes. There is no parallel format: weekly patterns and repeats are expanded into `days` by
 * the operations in `@/features/simulator/lib/ops`.
 *
 * Every schedule edit is a `scenario.edit` command whose `ScheduleOp`s map 1:1 onto those operations; the store keeps
 * a per-scenario undo/redo history (50 steps, in memory): edits with the same `coalesce` key merge into one step until
 * `seal()` (a paint stroke, a slider drag). History and clipboard are session-only.
 *
 * v2 (2026-10-01, ruling R-DETRAIN part 2): programs carry their training source ("as usual" / custom / none,
 * `features/simulator/lib/training.ts`). Migration from v1: in a scenario that schedules no training at all, programs
 * whose training was never set train as usual (so the schedule no longer silently stops the user's lifting); in a
 * scenario that already schedules sessions somewhere, such programs are its rest days and become an explicit "none";
 * programs with sessions stay as they are. The untouched default scenario is rebuilt from the new starter.
 */
import type { DayTemplate } from '@/engine';
import * as ops from '@/features/simulator/lib/ops';
import { diffMergePatch } from '@/store';
import { dispatchSync, outputOf } from '@/commands/bus';
import '@/commands/defs/scenario';
import '@/commands/defs/history'; // registers the commands the actions below dispatch
import { registerStore } from './persistence';
import { createProjection } from './projection';
import { withSystemWrite } from './scope';
import { resetScenarios } from './internal/schedule';
import {
  SCENARIOS_KEY,
  SCENARIOS_VERSION,
  initialScenarios,
  isScenarioState,
  mergeScenarioStates,
  migrateScenarios,
  type MutateOptions,
  type Persisted,
  type Scenario,
  type ScheduleStoreState,
} from './internal/scheduleModel';

export {
  HISTORY_LIMIT,
  SCENARIOS_KEY,
  SCENARIOS_VERSION,
  defaultStartDate,
  initialScenarios,
  isScenarioState,
  isScheduleShape,
  makeScenario,
  mergeScenarioStates,
  migrateScenarioTraining,
  migrateScenarios,
  settleTraining,
  type HistoryEntry,
  type MutateOptions,
  type Scenario,
  type ScenarioHistory,
  type ScheduleStoreState,
} from './internal/scheduleModel';

type Op = Parameters<typeof dispatchSync<'scenario.edit'>>[1]['ops'][number];

/** One `scenario.edit` (one history step; `coalesce` joins a gesture). */
function edit(sid: string, list: Op[], opts?: MutateOptions): { changed: boolean; programIndex?: number } {
  const r = dispatchSync('scenario.edit', { id: sid, ops: list, ...(opts?.label ? { label: opts.label } : {}) }, opts?.coalesce ? { coalesceKey: opts.coalesce } : undefined);
  const out = outputOf(r);
  return { changed: out?.changed ?? false, ...(out?.programIndex !== undefined ? { programIndex: out.programIndex } : {}) };
}

const scenarioOf = (sid: string): Scenario | undefined => useScheduleStore.getState().scenarios.find((s) => s.id === sid);

/** A template recipe as a merge patch (what the recipe changes on the template the editor shows). */
function patchOf(t: DayTemplate, recipe: (t: DayTemplate) => DayTemplate): Record<string, unknown> | null {
  const p = diffMergePatch(t, recipe(t));
  return p && typeof p === 'object' ? (p as Record<string, unknown>) : null;
}

export const useScheduleStore = createProjection<ScheduleStoreState, Persisted>({
  name: 'scenarios',
  key: SCENARIOS_KEY,
  version: SCENARIOS_VERSION,
  persistedFields: ['scenarios', 'activeId'],
  creator: (set, get) => ({
    ...initialScenarios(),
    history: {},
    clipboard: null,

    createScenario: (opts = {}) => outputOf(dispatchSync('scenario.create', opts as never))?.scenarioId ?? '',
    applyStarter: (sid, starter) => void dispatchSync('scenario.applyStarter', { id: sid, starter }),
    duplicateScenario: (sid) => outputOf(dispatchSync('scenario.duplicate', { id: sid }))?.scenarioId ?? null,
    deleteScenario: (sid) => void dispatchSync('scenario.delete', { id: sid }),
    renameScenario: (sid, name) => void dispatchSync('scenario.rename', { id: sid, name }),
    setActive: (sid) => void dispatchSync('scenario.setActive', { id: sid }),
    ensureScenario: () => outputOf(dispatchSync('scenario.ensureActive', {}))?.scenarioId ?? '',

    mutate: (sid, recipe, opts) => {
      const sc = scenarioOf(sid);
      if (!sc) return false;
      const next = recipe(sc.schedule);
      if (next === sc.schedule) return false;
      return edit(sid, [{ op: 'setSchedule', schedule: next as never }], opts).changed;
    },
    seal: (sid) => void dispatchSync('history.seal', { scenarioId: sid }),
    undo: (sid) => outputOf(dispatchSync('scenario.undo', { id: sid }))?.changed ?? false,
    redo: (sid) => outputOf(dispatchSync('scenario.redo', { id: sid }))?.changed ?? false,

    setHorizon: (sid, days) => void edit(sid, [{ op: 'setHorizon', days }]),
    setStartDate: (sid, date) => void edit(sid, [{ op: 'setStartDate', date }]),
    setEnergyReference: (sid, ref) => void edit(sid, [{ op: 'setEnergyReference', ref }]),
    setAdherence: (sid, patch) => void edit(sid, [{ op: 'setAdherence', patch }]),

    addProgram: (sid, source) => edit(sid, [typeof source === 'string' ? { op: 'addProgram', preset: source } : { op: 'addProgram', template: source as never }]).programIndex ?? -1,
    updateProgram: (sid, index, recipe, opts) => {
      const t = scenarioOf(sid)?.schedule.programs[index];
      const patch = t ? patchOf(t, recipe) : null;
      if (patch) edit(sid, [{ op: 'updateProgram', index, patch }], opts);
    },
    duplicateProgram: (sid, index) => edit(sid, [{ op: 'duplicateProgram', index }]).programIndex ?? -1,
    deleteProgram: (sid, index, replaceWith) => void edit(sid, [{ op: 'deleteProgram', index, replaceWith }]),

    paintDays: (sid, days, program, opts) => void edit(sid, [{ op: 'paint', days: [...days], program }], opts),
    clearDays: (sid, days) => void edit(sid, [{ op: 'clear', days: [...days] }]),
    editDays: (sid, days, recipe, opts) => {
      const sc = scenarioOf(sid);
      if (!sc || days.length === 0) return;
      const patch = patchOf(ops.dayTemplate(sc.schedule, days[0]!), recipe);
      if (patch) edit(sid, [{ op: 'editDays', days: [...days], patch }], opts);
    },
    resetOverrides: (sid, days) => void edit(sid, [{ op: 'resetOverrides', days: [...days] }]),
    shiftDays: (sid, days, delta) => void edit(sid, [{ op: 'shiftDays', days: [...days], delta }]),
    applyPattern: (sid, pattern, fromDay, toDay) =>
      void edit(sid, [{ op: 'applyPattern', pattern: [...pattern], ...(fromDay !== undefined ? { fromDay } : {}), ...(toDay !== undefined ? { toDay } : {}) }]),

    // The clipboard is a UI convenience (session-only); pasting dispatches `copyWeek` with the copied days.
    copyWeek: (sid, row) => {
      const sc = scenarioOf(sid);
      if (sc) set({ clipboard: ops.copyRow(sc.schedule, row) });
    },
    pasteWeeks: (sid, rows) => {
      const clip = get().clipboard;
      if (clip) edit(sid, [{ op: 'copyWeek', fromRow: clip.fromRow, toRows: [...rows], cols: clip.cols as never }]);
    },
    repeatWeekToEnd: (sid, row) => void edit(sid, [{ op: 'repeatWeekToEnd', row }]),
    insertWeek: (sid, row) => void edit(sid, [{ op: 'insertWeek', row }]),
    deleteWeek: (sid, row) => void edit(sid, [{ op: 'deleteWeek', row }]),
    deloadWeek: (sid, row, habitualByWeekday) => void edit(sid, [{ op: 'deloadWeek', row, ...(habitualByWeekday ? { habitualByWeekday: habitualByWeekday as never } : {}) }]),

    addFast: (sid, fast) => void edit(sid, [{ op: 'addFast', fast: fast as never }]),
    updateFast: (sid, index, patch, opts) => void edit(sid, [{ op: 'updateFast', index, patch: patch as never }], opts),
    removeFast: (sid, index) => void edit(sid, [{ op: 'removeFast', index }]),
    setBlock: (sid, block) => void edit(sid, [{ op: 'setBlock', block }]),
    setBlocks: (sid, blocks) => void edit(sid, [{ op: 'setBlocks', blocks }]),
    renameBlock: (sid, index, name) => void edit(sid, [{ op: 'renameBlock', index, name }]),
    removeBlock: (sid, index) => void edit(sid, [{ op: 'removeBlock', index }]),
  }),
  partialize: (s): Persisted => ({ scenarios: s.scenarios, activeId: s.activeId }),
  migrate: (persisted, version) => migrateScenarios(persisted, version) as Persisted,
  merge: (persisted, current) => {
    const p = persisted as Partial<Persisted> | undefined;
    if (!p || !isScenarioState(p)) return current;
    const scenarios = p.scenarios ?? [];
    const activeId = p.activeId && scenarios.some((s) => s.id === p.activeId) ? p.activeId : (scenarios[0]?.id ?? null);
    return { ...current, scenarios, activeId, history: {} };
  },
  // Remote changes and undo keep the on-screen order and the session's undo history.
  mergeDocs: (p, current) => {
    const byId = new Map(p.scenarios.map((s) => [s.id, s]));
    const kept = current.scenarios.filter((s) => byId.has(s.id)).map((s) => byId.get(s.id)!);
    const added = p.scenarios.filter((s) => !current.scenarios.some((c) => c.id === s.id));
    const scenarios = [...kept, ...added];
    const activeId = p.activeId && byId.has(p.activeId) ? p.activeId : current.activeId && byId.has(current.activeId) ? current.activeId : (scenarios[0]?.id ?? null);
    const history = Object.fromEntries(Object.entries(current.history).filter(([sid]) => byId.has(sid)));
    return { ...current, scenarios, activeId, history };
  },
  binding: {
    owns: ['scenarios'],
    shares: [{ col: 'uiPrefs', id: 'me', fields: ['activeScenarioId'] }],
    toDocs: (p) => [
      ...p.scenarios.map((sc) => ({ col: 'scenarios' as const, id: sc.id, body: sc as unknown as Record<string, unknown>, src: sc })),
      { col: 'uiPrefs' as const, id: 'me', body: { activeScenarioId: p.activeId }, fields: ['activeScenarioId'] },
    ],
    fromDocs: (read) => {
      const list = read.list('scenarios').map(({ id, body }) => ({ ...body, id }) as unknown as Scenario);
      const active = read.get('uiPrefs', 'me')?.activeScenarioId;
      if (list.length === 0 && typeof active !== 'string') return null;
      list.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
      return { scenarios: list, activeId: typeof active === 'string' && list.some((s) => s.id === active) ? active : (list[0]?.id ?? null) };
    },
  },
});

registerStore(SCENARIOS_KEY, SCENARIOS_VERSION, {
  label: 'scenarios',
  describe: (s) => {
    const n = (s as { scenarios?: unknown[] })?.scenarios?.length ?? 0;
    return `${n} scenario${n === 1 ? '' : 's'}`;
  },
  validate: isScenarioState,
  merge: mergeScenarioStates,
  rehydrate: () => useScheduleStore.persist.rehydrate(),
});

// ---------------------------------------------------------------- selectors

export const selectScenario =
  (sid: string | undefined) =>
  (s: ScheduleStoreState): Scenario | undefined =>
    sid ? s.scenarios.find((x) => x.id === sid) : undefined;

export function useScenario(sid: string | undefined): Scenario | undefined {
  return useScheduleStore(selectScenario(sid));
}

export function useCanUndo(sid: string | undefined): { undo: boolean; redo: boolean } {
  const h = useScheduleStore((s) => (sid ? s.history[sid] : undefined));
  return { undo: (h?.past.length ?? 0) > 0, redo: (h?.future.length ?? 0) > 0 };
}

/** Test helper: reset to a fresh initial state (fixed date for determinism). */
export function resetScheduleStore(today = '2026-09-30'): void {
  withSystemWrite(() => resetScenarios(today), 'resetScheduleStore');
}

