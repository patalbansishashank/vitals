/**
 * Scenario model (pure): the persisted scenario list, factories, import validation and merge, and the v1 → v2
 * training migration (ruling R-DETRAIN part 2). Shared by the projection (`../scheduleStore.ts`), the `scenario.*`
 * commands and the document mapping (one `scenarios` document per scenario, the active id in `uiPrefs`).
 */
import type { AdherenceLevers, DayTemplate, EnergyReference, ExerciseSession, FastEvent, Schedule, ScheduleBlock } from '@/engine';
import { addDaysISO, nextMondayISO, todayISO, weekdayOf } from '@/features/simulator/lib/calendar';
import type * as ops from '@/features/simulator/lib/ops';
import { starterSchedule, type PresetId, type StarterId } from '@/features/simulator/presets';
import { trainingUntouched, withTrainingMode } from '@/features/simulator/lib/training';

export const SCENARIOS_KEY = 'vitals.scenarios';
export const SCENARIOS_VERSION = 2;
export const HISTORY_LIMIT = 50;

export interface Scenario {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** False until a starter was picked: the schedule screen shows the starter picker. */
  started: boolean;
  /** Provenance chip, e.g. "from Plan B · 30 Sep" (IA §1). */
  provenance?: string;
  schedule: Schedule;
}

export interface HistoryEntry {
  schedule: Schedule;
  label?: string;
  coalesce?: string;
  sealed: boolean;
}

export interface ScenarioHistory {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export interface MutateOptions {
  /** Consecutive edits with the same key form one undo step until `seal()`. */
  coalesce?: string;
  /** Short description (toasts, debugging). */
  label?: string;
}

export interface ScheduleStoreState {
  scenarios: Scenario[];
  activeId: string | null;
  /** Session-only. */
  history: Record<string, ScenarioHistory>;
  clipboard: ops.WeekClip | null;

  // scenarios
  createScenario: (opts?: {
    name?: string;
    starter?: StarterId;
    schedule?: Schedule;
    provenance?: string;
    startDate?: string;
    started?: boolean;
    activate?: boolean;
  }) => string;
  applyStarter: (sid: string, starter: StarterId) => void;
  duplicateScenario: (sid: string) => string | null;
  deleteScenario: (sid: string) => void;
  renameScenario: (sid: string, name: string) => void;
  setActive: (sid: string) => void;
  /** Returns the active scenario id, creating a scenario when there is none. */
  ensureScenario: () => string;

  // history
  mutate: (sid: string, recipe: (s: Schedule) => Schedule, opts?: MutateOptions) => boolean;
  seal: (sid: string) => void;
  undo: (sid: string) => boolean;
  redo: (sid: string) => boolean;

  // horizon & references
  setHorizon: (sid: string, days: number) => void;
  setStartDate: (sid: string, iso: string) => void;
  setEnergyReference: (sid: string, ref: EnergyReference) => void;
  /** Behavioural adherence levers for the whole scenario (dossier 21 §4G; never change intake). */
  setAdherence: (sid: string, patch: Partial<AdherenceLevers>) => void;

  // programs
  addProgram: (sid: string, source: PresetId | Omit<DayTemplate, 'id'>) => number;
  updateProgram: (
    sid: string,
    index: number,
    recipe: (t: DayTemplate) => DayTemplate,
    opts?: MutateOptions,
  ) => void;
  duplicateProgram: (sid: string, index: number) => number;
  deleteProgram: (sid: string, index: number, replaceWith: number) => void;

  // days
  paintDays: (sid: string, days: readonly number[], program: number, opts?: MutateOptions) => void;
  clearDays: (sid: string, days: readonly number[]) => void;
  editDays: (
    sid: string,
    days: readonly number[],
    recipe: (t: DayTemplate) => DayTemplate,
    opts?: MutateOptions,
  ) => void;
  resetOverrides: (sid: string, days: readonly number[]) => void;
  shiftDays: (sid: string, days: readonly number[], delta: number) => void;
  applyPattern: (sid: string, pattern: readonly number[], fromDay?: number, toDay?: number) => void;

  // weeks
  copyWeek: (sid: string, row: number) => void;
  pasteWeeks: (sid: string, rows: readonly number[]) => void;
  repeatWeekToEnd: (sid: string, row: number) => void;
  insertWeek: (sid: string, row: number) => void;
  deleteWeek: (sid: string, row: number) => void;
  /** `habitualByWeekday`: the user's habitual sessions (index 0 = Monday), for days that train as usual. */
  deloadWeek: (sid: string, row: number, habitualByWeekday?: readonly ExerciseSession[][]) => void;

  // fasts & blocks
  addFast: (sid: string, ev: Omit<FastEvent, 'kind'>) => void;
  updateFast: (sid: string, index: number, patch: Partial<FastEvent>, opts?: MutateOptions) => void;
  removeFast: (sid: string, index: number) => void;
  setBlock: (sid: string, block: ScheduleBlock) => void;
  setBlocks: (sid: string, blocks: ScheduleBlock[]) => void;
  renameBlock: (sid: string, index: number, name: string) => void;
  removeBlock: (sid: string, index: number) => void;
}

// ---------------------------------------------------------------- helpers

export function randomId(taken: ReadonlySet<string>): string {
  for (;;) {
    const id = `s${Math.random().toString(36).slice(2, 8)}`;
    if (!taken.has(id)) return id;
  }
}

export const nowIso = (): string => new Date().toISOString();

/** Default start: the next Monday, so calendar rows are whole weeks. */
export function defaultStartDate(today: string = todayISO()): string {
  return nextMondayISO(addDaysISO(today, 1));
}

export function makeScenario(opts: {
  id: string;
  name: string;
  starter?: StarterId;
  startDate: string;
  started?: boolean;
  schedule?: Schedule;
  provenance?: string;
}): Scenario {
  const schedule =
    opts.schedule ?? starterSchedule(opts.starter ?? 'blank', opts.startDate, weekdayOf(opts.startDate));
  const t = nowIso();
  return {
    id: opts.id,
    name: opts.name,
    createdAt: t,
    updatedAt: t,
    started: opts.started ?? true,
    ...(opts.provenance ? { provenance: opts.provenance } : {}),
    schedule,
  };
}

/** Initial state: one starter scenario (12 weeks, moderate deficit) starting next Monday. */
export function initialScenarios(today: string = todayISO()): { scenarios: Scenario[]; activeId: string } {
  const sc = makeScenario({
    id: 'starter',
    name: 'Moderate deficit',
    starter: 'deficit12',
    startDate: defaultStartDate(today),
  });
  return { scenarios: [sc], activeId: sc.id };
}

export function uniqueName(name: string, scenarios: readonly Scenario[]): string {
  const names = new Set(scenarios.map((s) => s.name));
  if (!names.has(name)) return name;
  for (let i = 2; ; i++) if (!names.has(`${name} ${i}`)) return `${name} ${i}`;
}

// ---------------------------------------------------------------- validation (import) & merge

export function isScheduleShape(x: unknown): x is Schedule {
  if (!x || typeof x !== 'object') return false;
  const s = x as Partial<Schedule>;
  return (
    s.schemaVersion === 1 &&
    typeof s.startDate === 'string' &&
    typeof s.horizonDays === 'number' &&
    Array.isArray(s.programs) &&
    s.programs.length > 0 &&
    Array.isArray(s.days) &&
    s.days.length === s.horizonDays &&
    s.days.every(
      (d) => d && typeof d.program === 'number' && d.program >= 0 && d.program < s.programs!.length,
    )
  );
}

export function isScenarioState(x: unknown): boolean {
  if (!x || typeof x !== 'object') return false;
  const s = x as { scenarios?: unknown };
  return (
    Array.isArray(s.scenarios) &&
    s.scenarios.every((sc: unknown) => {
      const o = sc as Partial<Scenario>;
      return !!o && typeof o.id === 'string' && typeof o.name === 'string' && isScheduleShape(o.schedule);
    })
  );
}

/** Merge-mode import: keep both; clashing ids get new ids and "(imported)" names. */
export function mergeScenarioStates(current: unknown, incoming: unknown): unknown {
  const cur = (current as { scenarios?: Scenario[]; activeId?: string | null }) ?? {};
  const inc = (incoming as { scenarios?: Scenario[] }) ?? {};
  const list = [...(cur.scenarios ?? [])];
  const ids = new Set(list.map((s) => s.id));
  for (const sc of inc.scenarios ?? []) {
    if (ids.has(sc.id)) {
      const id = randomId(ids);
      ids.add(id);
      list.push({ ...sc, id, name: `${sc.name} (imported)` });
    } else {
      ids.add(sc.id);
      list.push(sc);
    }
  }
  return { scenarios: list, activeId: cur.activeId ?? list[0]?.id ?? null };
}

// ---------------------------------------------------------------- training source (v2)

/** Any day of the schedule has sessions of its own (program or override). */
export function schedulesTraining(s: Schedule): boolean {
  if (s.programs.some((p) => (p.exercise?.length ?? 0) > 0 || p.habitualTraining === true))
    return true;
  return s.days.some((d) => (d.override?.exercise?.length ?? 0) > 0 || d.override?.habitualTraining === true);
}

/**
 * Programs whose training was never set get an explicit source: "as usual" when the schedule trains nowhere
 * (`restIsNone` false), "none" when it already schedules sessions (they are its rest days). Idempotent.
 */
export function settleTraining(s: Schedule, restIsNone = schedulesTraining(s)): Schedule {
  if (!s.programs.some((p) => trainingUntouched(p))) return s;
  return {
    ...s,
    programs: s.programs.map((p) =>
      trainingUntouched(p) ? withTrainingMode<DayTemplate>(p, restIsNone ? 'none' : 'habitual') : p,
    ),
  };
}

/** v1 → v2: see the header. The untouched default scenario (never edited) is rebuilt from the new starter. */
export function migrateScenarioTraining(sc: Scenario): Scenario {
  if (sc.id === 'starter' && sc.createdAt === sc.updatedAt && sc.name === 'Moderate deficit') {
    const start = sc.schedule.startDate;
    return { ...sc, schedule: starterSchedule('deficit12', start, weekdayOf(start)) };
  }
  // a plan opened from the Planner spells out its training (days without sessions are its rest days)
  const next = settleTraining(sc.schedule, sc.provenance ? true : undefined);
  return next === sc.schedule ? sc : { ...sc, schedule: next };
}

export function migrateScenarios(persisted: unknown, version: number): unknown {
  const p = persisted as Partial<Persisted> | null | undefined;
  if (!p || !Array.isArray(p.scenarios)) return persisted;
  if (version < 2) return { ...p, scenarios: p.scenarios.map((sc) => (isScheduleShape(sc?.schedule) ? migrateScenarioTraining(sc) : sc)) };
  return p;
}


export type Persisted = Pick<ScheduleStoreState, 'scenarios' | 'activeId'>;
