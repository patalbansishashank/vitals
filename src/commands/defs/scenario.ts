/**
 * `scenario.*` (SUITE_SPEC §1.9). Schedule edits are `ScheduleOp`s — the serialisable form of the Simulator's
 * schedule operations, one op per ops function — applied as one undo step (or one coalesced gesture).
 *
 * Additions to the catalogue for what v0.1 can do (documented in docs/COMMANDS.md): `scenario.applyStarter`,
 * `scenario.ensureActive`, ScheduleOp `setSchedule`, `copyWeek.cols` (the UI clipboard's copied days) and
 * `deloadWeek.habitualByWeekday` (habitual sessions for days that train as usual).
 */
import { isScheduleShape, type Scenario } from '@/state/internal/scheduleModel';
import * as sched from '@/state/internal/schedule';
import * as sim from '@/state/internal/simulation';
import { registerPrecondition } from '../gates';
import { defineCommand, fail } from '../registry';
import { T, type Static } from '../schema';
import { ScheduleDoc, ScheduleOp } from '../schema/scheduleOp';
import { ALL, UNDO } from './_shared';

export { ScheduleOp, ScheduleDoc };
export type ScheduleOpInput = Static<typeof ScheduleOp>;

export const ScenarioView = T.Object({
  id: T.String(),
  name: T.String(),
  active: T.Boolean(),
  started: T.Boolean(),
  provenance: T.Optional(T.String()),
  createdAt: T.String(),
  updatedAt: T.String(),
  startDate: T.String(),
  horizonDays: T.Integer(),
  programs: T.Array(T.Object({ index: T.Integer(), id: T.String(), label: T.String() })),
  blocks: T.Array(T.OpenObject()),
  fasts: T.Integer(),
  days: T.Optional(T.Array(T.Object({ day: T.Integer(), program: T.String(), override: T.Boolean() }))),
});

function view(sc: Scenario, days?: readonly [number, number]) {
  const s = sc.schedule;
  const out: Static<typeof ScenarioView> = {
    id: sc.id,
    name: sc.name,
    active: sched.activeId() === sc.id,
    started: sc.started,
    ...(sc.provenance ? { provenance: sc.provenance } : {}),
    createdAt: sc.createdAt,
    updatedAt: sc.updatedAt,
    startDate: s.startDate,
    horizonDays: s.horizonDays,
    programs: s.programs.map((p, index) => ({ index, id: p.id, label: p.label })),
    blocks: (s.blocks ?? []).map((b) => ({ ...b })),
    fasts: (s.events ?? []).filter((e) => e.kind === 'fast').length,
  };
  if (days) {
    const [from, to] = days;
    out.days = s.days.slice(Math.max(0, from), Math.min(s.days.length, to + 1)).map((d, i) => ({
      day: Math.max(0, from) + i,
      program: s.programs[d.program]?.id ?? '?',
      override: Boolean(d.override),
    }));
  }
  return out;
}

registerPrecondition('scenarioExists', (input) => {
  const r = input as { id?: unknown; scenarioId?: unknown } | null;
  const id = r?.id ?? r?.scenarioId;
  return typeof id === 'string' && sched.scenarioById(id) ? null : 'That scenario does not exist.';
});

const need = (id: string): Scenario => sched.scenarioById(id) ?? fail('not_found', 'That scenario does not exist.', { path: '/id' });
const IdIn = T.Object({ id: T.String({ minLength: 1 }) });

export const scenarioList = defineCommand({
  id: 'scenario.list',
  version: 1,
  title: 'List scenarios',
  description: 'Every Simulator scenario with its name, start date, horizon in days, programs and whether it is the active one.',
  input: T.Object({}),
  output: T.Array(ScenarioView),
  perm: 'read',
  surfaces: ALL,
  excludedReason: { ui: 'the screens read the projection hooks directly' },
  undo: UNDO.none,
  idempotency: 'none',
  sideEffects: [],
  execute: () => sched.scenarios().map((sc) => view(sc)),
});

export const scenarioGet = defineCommand({
  id: 'scenario.get',
  version: 1,
  title: 'Read a scenario',
  description: 'One scenario: programs (day templates by letter), blocks, fasts; with `days: [from, to]` (day indexes from the start date) also the program and override of each day in that range.',
  input: T.Object({ id: T.String({ minLength: 1 }), days: T.Optional(T.Tuple([T.Integer({ minimum: 0 }), T.Integer({ minimum: 0 })])) }),
  output: ScenarioView,
  perm: 'read',
  surfaces: ALL,
  excludedReason: { ui: 'the screens read the projection hooks directly' },
  undo: UNDO.none,
  idempotency: 'none',
  sideEffects: [],
  execute: (_ctx, input) => view(need(input.id), input.days),
});

export const scenarioCreate = defineCommand({
  id: 'scenario.create',
  version: 1,
  title: 'New scenario',
  description:
    'Create a scenario from a starter (deficit12, maintenance8, weeklyFast6, blank), a full schedule, or a copy of another scenario (fromScenarioId). It becomes the active scenario unless activate is false.',
  input: T.Object({
    name: T.Optional(T.String({ minLength: 1, maxLength: 60 })),
    starter: T.Optional(T.Enum(['deficit12', 'maintenance8', 'weeklyFast6', 'blank'])),
    fromScenarioId: T.Optional(T.String({ minLength: 1 })),
    schedule: T.Optional(ScheduleDoc),
    provenance: T.Optional(T.String({ maxLength: 120 })),
    startDate: T.Optional(T.Date()),
    started: T.Optional(T.Boolean()),
    activate: T.Optional(T.Boolean()),
  }),
  output: T.Object({ scenarioId: T.String() }),
  perm: 'write',
  impact: 'low',
  surfaces: ALL,
  undo: UNDO.TS,
  idempotency: 'key',
  sideEffects: ['docs'],
  execute: (_ctx, input) => {
    if (input.schedule && !isScheduleShape(input.schedule)) fail('invalid_input', 'That schedule is not complete.', { path: '/schedule' });
    if (input.fromScenarioId) need(input.fromScenarioId);
    return { scenarioId: sched.createScenario(input as never) };
  },
});

export const scenarioDuplicate = defineCommand({
  id: 'scenario.duplicate',
  version: 1,
  title: 'Duplicate scenario',
  description: 'Copy a scenario (named "<name> copy") and make the copy active.',
  input: IdIn,
  output: T.Object({ scenarioId: T.String() }),
  perm: 'write',
  impact: 'low',
  surfaces: ALL,
  undo: UNDO.TS,
  idempotency: 'key',
  sideEffects: ['docs'],
  execute: (_ctx, input) => {
    need(input.id);
    return { scenarioId: sched.duplicateScenario(input.id)! };
  },
});

export const scenarioRename = defineCommand({
  id: 'scenario.rename',
  version: 1,
  title: 'Rename scenario',
  description: 'Rename a scenario (trimmed, at most 60 characters).',
  input: T.Object({ id: T.String({ minLength: 1 }), name: T.String({ minLength: 1, maxLength: 200 }) }),
  output: ScenarioView,
  perm: 'write',
  impact: 'low',
  surfaces: ALL,
  undo: UNDO.IP,
  idempotency: 'natural',
  sideEffects: ['docs'],
  execute: (_ctx, input) => {
    need(input.id);
    sched.renameScenario(input.id, input.name);
    return view(need(input.id));
  },
});

export const scenarioSetActive = defineCommand({
  id: 'scenario.setActive',
  version: 1,
  title: 'Switch scenario',
  description: 'Make a scenario the active one in the Simulator.',
  input: IdIn,
  output: ScenarioView,
  perm: 'write',
  impact: 'low',
  surfaces: ALL,
  undo: UNDO.IP,
  idempotency: 'natural',
  sideEffects: ['docs', 'ui'],
  execute: (_ctx, input) => {
    need(input.id);
    sched.setActive(input.id);
    return view(need(input.id));
  },
});

export const scenarioDelete = defineCommand({
  id: 'scenario.delete',
  version: 1,
  title: 'Delete scenario',
  description: 'Delete a scenario and the inputs of its last run (restorable with undo). Another scenario becomes active.',
  input: IdIn,
  output: T.Object({ deleted: T.Boolean() }),
  perm: 'write',
  impact: 'low',
  surfaces: ALL,
  undo: UNDO.TS,
  idempotency: 'natural',
  sideEffects: ['docs'],
  execute: (_ctx, input) => {
    if (!sched.scenarioById(input.id)) return { deleted: false };
    if (sim.lastRunOf(input.id) || sim.runOf(input.id)) sim.forget(input.id);
    return { deleted: sched.deleteScenario(input.id) };
  },
});

export const scenarioEdit = defineCommand({
  id: 'scenario.edit',
  version: 1,
  title: 'Edit schedule',
  description:
    'Apply schedule ops to a scenario as one undo step: paint/clear days with a program (by index), editDays/updateProgram with a merge patch of the day template (energy as % of maintenance or kcal, macros, meals, exercise, steps, sleep), shift days, patterns, week copy/insert/delete/deload, programs, fasts (hours), blocks, horizon (days), start date, energy reference, adherence levers.',
  input: T.Object({ id: T.String({ minLength: 1 }), ops: T.Array(ScheduleOp, { minItems: 1, maxItems: 50 }), label: T.Optional(T.String({ maxLength: 60 })) }),
  output: T.Object({ scenarioId: T.String(), rev: T.String(), summary: T.String(), changed: T.Boolean(), programIndex: T.Optional(T.Integer()) }),
  perm: 'write',
  impact: 'low',
  surfaces: ALL,
  undo: UNDO.IP,
  idempotency: 'key',
  sideEffects: ['docs'],
  execute: (ctx, input) => {
    need(input.id);
    for (const op of input.ops) if (op.op === 'setSchedule' && !isScheduleShape(op.schedule)) fail('invalid_input', 'That schedule is not complete.', { path: '/ops' });
    const r = sched.applyScheduleOps(input.id, input.ops as never, { ...(ctx.coalesceKey ? { coalesce: ctx.coalesceKey } : {}), ...(input.label ? { label: input.label } : {}) });
    const sc = need(input.id);
    return {
      scenarioId: sc.id,
      rev: sc.updatedAt,
      summary: r.changed ? r.labels.join(', ') || 'edited' : 'no change',
      changed: r.changed,
      ...(r.programIndex !== undefined ? { programIndex: r.programIndex } : {}),
    };
  },
});

export const scenarioUndo = defineCommand({
  id: 'scenario.undo',
  version: 1,
  title: 'Undo schedule edit',
  description: 'Step back one schedule edit of a scenario (50 steps per scenario, this session).',
  input: IdIn,
  output: T.Object({ rev: T.String(), changed: T.Boolean() }),
  perm: 'write',
  impact: 'low',
  surfaces: ['ui', 'ai'],
  excludedReason: { webmcp: 'step history belongs to the open Simulator session', mcp: 'step history belongs to the open Simulator session' },
  undo: UNDO.none,
  idempotency: 'none',
  sideEffects: ['docs'],
  execute: (_ctx, input) => {
    need(input.id);
    const changed = sched.undo(input.id);
    return { rev: need(input.id).updatedAt, changed };
  },
});

export const scenarioRedo = defineCommand({
  id: 'scenario.redo',
  version: 1,
  title: 'Redo schedule edit',
  description: 'Re-apply the schedule edit undone last.',
  input: IdIn,
  output: T.Object({ rev: T.String(), changed: T.Boolean() }),
  perm: 'write',
  impact: 'low',
  surfaces: ['ui', 'ai'],
  excludedReason: { webmcp: 'step history belongs to the open Simulator session', mcp: 'step history belongs to the open Simulator session' },
  undo: UNDO.none,
  idempotency: 'none',
  sideEffects: ['docs'],
  execute: (_ctx, input) => {
    need(input.id);
    const changed = sched.redo(input.id);
    return { rev: need(input.id).updatedAt, changed };
  },
});

export const scenarioApplyStarter = defineCommand({
  id: 'scenario.applyStarter',
  version: 1,
  title: 'Start from a starter',
  description: 'Replace a scenario’s schedule with a starter (deficit12 = 12 weeks moderate deficit, maintenance8, weeklyFast6, blank) at its start date; a still-unnamed scenario takes the starter’s name.',
  input: T.Object({ id: T.String({ minLength: 1 }), starter: T.Enum(['deficit12', 'maintenance8', 'weeklyFast6', 'blank']) }),
  output: ScenarioView,
  perm: 'write',
  impact: 'low',
  surfaces: ALL,
  undo: UNDO.IP,
  idempotency: 'natural',
  sideEffects: ['docs'],
  execute: (_ctx, input) => {
    need(input.id);
    sched.applyStarter(input.id, input.starter);
    return view(need(input.id));
  },
});

export const scenarioEnsureActive = defineCommand({
  id: 'scenario.ensureActive',
  version: 1,
  title: 'Open the working scenario',
  description: 'The active scenario id; picks the first scenario, or creates an empty one (starter picker), when none is active.',
  input: T.Object({}),
  output: T.Object({ scenarioId: T.String() }),
  perm: 'write',
  impact: 'low',
  surfaces: ALL,
  undo: UNDO.TS,
  idempotency: 'natural',
  sideEffects: ['docs'],
  execute: () => ({ scenarioId: sched.ensureScenario() }),
});

declare module '../types' {
  interface CommandMap {
    'scenario.list': typeof scenarioList;
    'scenario.get': typeof scenarioGet;
    'scenario.create': typeof scenarioCreate;
    'scenario.duplicate': typeof scenarioDuplicate;
    'scenario.rename': typeof scenarioRename;
    'scenario.setActive': typeof scenarioSetActive;
    'scenario.delete': typeof scenarioDelete;
    'scenario.edit': typeof scenarioEdit;
    'scenario.undo': typeof scenarioUndo;
    'scenario.redo': typeof scenarioRedo;
    'scenario.applyStarter': typeof scenarioApplyStarter;
    'scenario.ensureActive': typeof scenarioEnsureActive;
  }
}
