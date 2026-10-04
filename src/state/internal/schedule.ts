/**
 * Scenario store actions (importable only from `src/commands/**`). `ScheduleOp` is the serialisable form of
 * `@/features/simulator/lib/ops` (SUITE_SPEC §1.9): every op maps 1:1 onto one ops function, so `scenario.edit`
 * produces exactly what the v0.1 store produced. Undo/redo history (50 steps, coalescing until `seal`) is kept per
 * scenario in memory, as in v0.1.
 */
import type { AdherenceLevers, DayTemplate, EnergyReference, ExerciseSession, FastEvent, Schedule, ScheduleBlock, ScheduleDay } from '@/engine';
import { weekdayOf } from '@/features/simulator/lib/calendar';
import * as ops from '@/features/simulator/lib/ops';
import { programFromPreset, starterSchedule, STARTER_BY_ID, type PresetId, type StarterId } from '@/features/simulator/presets';
import { applyMergePatch } from '@/store';
import { useScheduleStore } from '../scheduleStore';
import {
  HISTORY_LIMIT,
  defaultStartDate,
  initialScenarios,
  makeScenario,
  nowIso,
  randomId,
  settleTraining,
  uniqueName,
  type MutateOptions,
  type Scenario,
} from './scheduleModel';

type DayTemplatePatch = Record<string, unknown>;

/** SUITE_SPEC §1.9 `ScheduleOp` (+ `copyWeek.cols`, `deloadWeek.habitualByWeekday`, `setSchedule`: additive, documented in docs/COMMANDS.md). */
export type ScheduleOp =
  | { op: 'paint'; days: number[]; program: number }
  | { op: 'clear'; days: number[] }
  | { op: 'editDays'; days: number[]; patch: DayTemplatePatch }
  | { op: 'resetOverrides'; days: number[] }
  | { op: 'shiftDays'; days: number[]; delta: number }
  | { op: 'applyPattern'; pattern: number[]; fromDay?: number; toDay?: number }
  | { op: 'copyWeek'; fromRow: number; toRows: number[]; cols?: Array<ScheduleDay | null> }
  | { op: 'repeatWeekToEnd'; row: number }
  | { op: 'insertWeek'; row: number }
  | { op: 'deleteWeek'; row: number }
  | { op: 'deloadWeek'; row: number; habitualByWeekday?: ExerciseSession[][] }
  | { op: 'addProgram'; preset?: PresetId; template?: Omit<DayTemplate, 'id'> }
  | { op: 'updateProgram'; index: number; patch: DayTemplatePatch }
  | { op: 'duplicateProgram'; index: number }
  | { op: 'deleteProgram'; index: number; replaceWith: number }
  | { op: 'addFast'; fast: Omit<FastEvent, 'kind'> }
  | { op: 'updateFast'; index: number; patch: Partial<FastEvent> }
  | { op: 'removeFast'; index: number }
  | { op: 'setBlock'; block: ScheduleBlock }
  | { op: 'setBlocks'; blocks: ScheduleBlock[] }
  | { op: 'renameBlock'; index: number; name: string }
  | { op: 'removeBlock'; index: number }
  | { op: 'setHorizon'; days: number }
  | { op: 'setStartDate'; date: string }
  | { op: 'setEnergyReference'; ref: EnergyReference }
  | { op: 'setAdherence'; patch: Partial<Record<keyof AdherenceLevers, boolean | null>> }
  | { op: 'setSchedule'; schedule: Schedule };

const LABELS: Partial<Record<ScheduleOp['op'], string>> = {
  paint: 'paint',
  clear: 'clear',
  resetOverrides: 'reset',
  shiftDays: 'shift',
  applyPattern: 'pattern',
  copyWeek: 'paste',
  repeatWeekToEnd: 'repeat',
  insertWeek: 'insert week',
  deleteWeek: 'delete week',
  deloadWeek: 'deload',
  deleteProgram: 'delete program',
  addFast: 'fast',
  removeFast: 'remove fast',
  setBlock: 'block',
  setBlocks: 'blocks',
  renameBlock: 'rename block',
  removeBlock: 'remove block',
  setHorizon: 'horizon',
  setStartDate: 'start date',
  setEnergyReference: 'energy reference',
  setAdherence: 'adherence',
};

const find = (sid: string): Scenario | undefined => useScheduleStore.getState().scenarios.find((s) => s.id === sid);

export function scenarioById(sid: string): Scenario | undefined {
  return find(sid);
}

function replace(sid: string, patch: Partial<Scenario>): void {
  useScheduleStore.setState((st) => ({ scenarios: st.scenarios.map((s) => (s.id === sid ? { ...s, ...patch, updatedAt: nowIso() } : s)) }));
}

/** Apply a schedule recipe with undo history (edits with the same `coalesce` key merge until `seal`). */
export function mutate(sid: string, recipe: (s: Schedule) => Schedule, opts?: MutateOptions): boolean {
  const sc = find(sid);
  if (!sc) return false;
  const next = recipe(sc.schedule);
  if (next === sc.schedule) return false;
  const st = useScheduleStore.getState();
  const h = st.history[sid] ?? { past: [], future: [] };
  const top = h.past[h.past.length - 1];
  const merge = !!opts?.coalesce && !!top && top.coalesce === opts.coalesce && !top.sealed;
  const past = merge
    ? h.past
    : [...h.past, { schedule: sc.schedule, label: opts?.label, coalesce: opts?.coalesce, sealed: !opts?.coalesce }].slice(-HISTORY_LIMIT);
  useScheduleStore.setState((s) => ({
    scenarios: s.scenarios.map((x) => (x.id === sid ? { ...x, schedule: next, started: true, updatedAt: nowIso() } : x)),
    history: { ...s.history, [sid]: { past, future: [] } },
  }));
  return true;
}

/** One schedule op as a pure recipe. Returns the recipe and the program index it created (addProgram, duplicate). */
function recipeOf(op: ScheduleOp, sc: Scenario): { recipe: (s: Schedule) => Schedule; label?: string; created?: number } {
  switch (op.op) {
    case 'paint':
      return { recipe: (s) => ops.paint(s, op.days, op.program) };
    case 'clear':
      return { recipe: (s) => ops.clear(s, op.days) };
    case 'editDays':
      return { recipe: (s) => ops.editDays(s, op.days, (t) => applyMergePatch(t, op.patch)) };
    case 'resetOverrides':
      return { recipe: (s) => ops.resetOverrides(s, op.days) };
    case 'shiftDays':
      return { recipe: (s) => ops.shiftDays(s, op.days, op.delta) };
    case 'applyPattern':
      return { recipe: (s) => ops.applyPattern(s, op.pattern, op.fromDay, op.toDay) };
    case 'copyWeek':
      return { recipe: (s) => ops.pasteRows(s, op.cols ? { cols: op.cols, fromRow: op.fromRow } : ops.copyRow(s, op.fromRow), op.toRows) };
    case 'repeatWeekToEnd':
      return { recipe: (s) => ops.repeatRowToEnd(s, op.row) };
    case 'insertWeek':
      return { recipe: (s) => ops.insertRow(s, op.row) };
    case 'deleteWeek':
      return { recipe: (s) => ops.deleteRow(s, op.row) };
    case 'deloadWeek':
      return { recipe: (s) => ops.deloadRow(s, op.row, op.habitualByWeekday) };
    case 'addProgram': {
      const letter = ops.nextLetter(sc.schedule.programs);
      if (!letter || (!op.preset && !op.template)) return { recipe: (s) => s };
      const t: DayTemplate = op.preset ? programFromPreset(op.preset, letter) : { ...structuredClone(op.template!), id: letter };
      return { recipe: (s) => ops.addProgram(s, t), label: `add ${letter}`, created: sc.schedule.programs.length };
    }
    case 'updateProgram':
      return { recipe: (s) => ops.updateProgram(s, op.index, (t) => applyMergePatch(t, op.patch)) };
    case 'duplicateProgram': {
      const src = sc.schedule.programs[op.index];
      const letter = ops.nextLetter(sc.schedule.programs);
      if (!src || !letter) return { recipe: (s) => s };
      const t: DayTemplate = { ...structuredClone(src), id: letter, label: `${src.label} copy` };
      return { recipe: (s) => ops.addProgram(s, t), label: `duplicate ${src.id}`, created: sc.schedule.programs.length };
    }
    case 'deleteProgram':
      return { recipe: (s) => ops.deleteProgram(s, op.index, op.replaceWith) };
    case 'addFast':
      return { recipe: (s) => ops.addFast(s, { kind: 'fast', ...op.fast }) };
    case 'updateFast':
      return { recipe: (s) => ops.updateFast(s, op.index, op.patch) };
    case 'removeFast':
      return { recipe: (s) => ops.removeFast(s, op.index) };
    case 'setBlock':
      return { recipe: (s) => ops.setBlock(s, op.block) };
    case 'setBlocks':
      return { recipe: (s) => ops.setBlocks(s, op.blocks) };
    case 'renameBlock':
      return { recipe: (s) => ops.renameBlock(s, op.index, op.name) };
    case 'removeBlock':
      return { recipe: (s) => ops.removeBlock(s, op.index) };
    case 'setHorizon':
      return { recipe: (s) => ops.setHorizon(s, op.days) };
    case 'setStartDate':
      return { recipe: (s) => (s.startDate === op.date ? s : { ...s, startDate: op.date }) };
    case 'setEnergyReference':
      return { recipe: (s) => ((s.defaults?.energyReference ?? 'baseline') === op.ref ? s : { ...s, defaults: { ...s.defaults, energyReference: op.ref } }) };
    case 'setAdherence':
      return {
        recipe: (s) => {
          const next: Record<string, unknown> = { ...s.adherence, ...op.patch };
          for (const k of Object.keys(next)) if (!next[k]) delete next[k];
          return { ...s, adherence: Object.keys(next).length > 0 ? (next as AdherenceLevers) : undefined };
        },
      };
    case 'setSchedule':
      return { recipe: () => structuredClone(op.schedule), label: 'schedule' };
  }
}

/** Apply ops to a copy of a scenario's schedule without touching the store (what-if variants). */
export function applyOpsToSchedule(sc: Scenario, list: readonly ScheduleOp[]): Schedule {
  let schedule = sc.schedule;
  for (const op of list) schedule = recipeOf(op, { ...sc, schedule }).recipe(schedule);
  return schedule;
}

export interface EditOutcome {
  changed: boolean;
  /** Program index created by `addProgram` / `duplicateProgram` (−1 when none could be added). */
  programIndex?: number;
  labels: string[];
}

/** Apply schedule ops as one history step (or one coalesced step). */
export function applyScheduleOps(sid: string, list: readonly ScheduleOp[], opts: MutateOptions = {}): EditOutcome {
  let changed = false;
  let programIndex: number | undefined;
  const labels: string[] = [];
  for (const op of list) {
    const sc = find(sid);
    if (!sc) break;
    const { recipe, label, created } = recipeOf(op, sc);
    const l = opts.label ?? label ?? LABELS[op.op];
    const ok = mutate(sid, recipe, { ...opts, label: l });
    if (created !== undefined) programIndex = ok ? created : -1;
    if (ok) {
      changed = true;
      if (l) labels.push(l);
    }
  }
  if (programIndex === undefined && list.some((o) => o.op === 'addProgram' || o.op === 'duplicateProgram')) programIndex = -1;
  return { changed, ...(programIndex !== undefined ? { programIndex } : {}), labels };
}

export function seal(sid: string): void {
  const h = useScheduleStore.getState().history[sid];
  const top = h?.past[h.past.length - 1];
  if (!h || !top || top.sealed) return;
  useScheduleStore.setState((st) => ({ history: { ...st.history, [sid]: { ...h, past: [...h.past.slice(0, -1), { ...top, sealed: true }] } } }));
}

export function sealAll(): void {
  for (const sid of Object.keys(useScheduleStore.getState().history)) seal(sid);
}

export function undo(sid: string): boolean {
  const sc = find(sid);
  const h = useScheduleStore.getState().history[sid];
  const entry = h?.past[h.past.length - 1];
  if (!sc || !h || !entry) return false;
  useScheduleStore.setState((st) => ({
    scenarios: st.scenarios.map((s) => (s.id === sid ? { ...s, schedule: entry.schedule, updatedAt: nowIso() } : s)),
    history: { ...st.history, [sid]: { past: h.past.slice(0, -1), future: [...h.future, { schedule: sc.schedule, label: entry.label, sealed: true }] } },
  }));
  return true;
}

export function redo(sid: string): boolean {
  const sc = find(sid);
  const h = useScheduleStore.getState().history[sid];
  const entry = h?.future[h.future.length - 1];
  if (!sc || !h || !entry) return false;
  useScheduleStore.setState((st) => ({
    scenarios: st.scenarios.map((s) => (s.id === sid ? { ...s, schedule: entry.schedule, updatedAt: nowIso() } : s)),
    history: { ...st.history, [sid]: { past: [...h.past, { schedule: sc.schedule, label: entry.label, sealed: true }], future: h.future.slice(0, -1) } },
  }));
  return true;
}

export interface CreateOptions {
  name?: string;
  starter?: StarterId;
  schedule?: Schedule;
  provenance?: string;
  startDate?: string;
  started?: boolean;
  activate?: boolean;
  fromScenarioId?: string;
}

export function createScenario(opts: CreateOptions = {}): string {
  if (opts.fromScenarioId) return duplicateScenario(opts.fromScenarioId) ?? '';
  const st = useScheduleStore.getState();
  const id = randomId(new Set(st.scenarios.map((s) => s.id)));
  const startDate = opts.startDate ?? opts.schedule?.startDate ?? defaultStartDate();
  const base = opts.name ?? (opts.starter ? STARTER_BY_ID[opts.starter].name : 'New scenario');
  const sc = makeScenario({
    id,
    name: uniqueName(base, st.scenarios),
    starter: opts.starter,
    startDate,
    // a schedule handed in (a Planner plan, an import) spells out its training: settle untouched programs
    schedule: opts.schedule ? settleTraining(structuredClone(opts.schedule), true) : undefined,
    provenance: opts.provenance,
    started: opts.started ?? Boolean(opts.starter || opts.schedule),
  });
  useScheduleStore.setState((s) => ({ scenarios: [...s.scenarios, sc], activeId: opts.activate === false ? s.activeId : id }));
  return id;
}

export function applyStarter(sid: string, starter: StarterId): void {
  const sc = find(sid);
  if (!sc) return;
  const schedule = starterSchedule(starter, sc.schedule.startDate, weekdayOf(sc.schedule.startDate));
  mutate(sid, () => schedule, { label: 'starter' });
  const name =
    sc.started || sc.name !== 'New scenario'
      ? sc.name
      : uniqueName(
          STARTER_BY_ID[starter].name,
          useScheduleStore.getState().scenarios.filter((s) => s.id !== sid),
        );
  replace(sid, { started: true, name });
}

export function duplicateScenario(sid: string): string | null {
  const sc = find(sid);
  if (!sc) return null;
  const st = useScheduleStore.getState();
  const id = randomId(new Set(st.scenarios.map((s) => s.id)));
  const t = nowIso();
  const copy: Scenario = { ...structuredClone(sc), id, name: uniqueName(`${sc.name} copy`, st.scenarios), createdAt: t, updatedAt: t };
  useScheduleStore.setState((s) => ({ scenarios: [...s.scenarios, copy], activeId: id }));
  return id;
}

export function deleteScenario(sid: string): boolean {
  if (!find(sid)) return false;
  useScheduleStore.setState((st) => {
    const scenarios = st.scenarios.filter((s) => s.id !== sid);
    const history = { ...st.history };
    delete history[sid];
    const activeId = st.activeId === sid ? (scenarios[0]?.id ?? null) : st.activeId;
    return { scenarios, history, activeId };
  });
  return true;
}

export function renameScenario(sid: string, name: string): boolean {
  const n = name.trim();
  if (!n || !find(sid)) return false;
  replace(sid, { name: n.slice(0, 60) });
  return true;
}

export function setActive(sid: string): boolean {
  if (!find(sid)) return false;
  useScheduleStore.setState({ activeId: sid });
  return true;
}

/** The active scenario id, creating an empty (starter-picker) scenario when there is none. */
export function ensureScenario(): string {
  const st = useScheduleStore.getState();
  if (st.activeId && find(st.activeId)) return st.activeId;
  if (st.scenarios[0]) {
    useScheduleStore.setState({ activeId: st.scenarios[0].id });
    return st.scenarios[0].id;
  }
  return createScenario({ started: false });
}

/** Test helper: reset to a fresh initial state (fixed date for determinism). */
export function resetScenarios(today: string): void {
  useScheduleStore.setState({ ...initialScenarios(today), history: {}, clipboard: null });
}

export function scenarios(): readonly Scenario[] {
  return useScheduleStore.getState().scenarios;
}

export function activeId(): string | null {
  return useScheduleStore.getState().activeId;
}
