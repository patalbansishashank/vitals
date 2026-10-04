/**
 * `ScheduleOp` (SUITE_SPEC §1.9): the serialisable form of the Simulator's schedule operations, one op per ops function
 * (tier P). Shared by `scenario.edit`, `sim.whatIf` / `sim.compare` and the tool adapters.
 */
import { T } from './types';

const Days = T.Array(T.Integer({ minimum: 0 }), { maxItems: 400 });
const DayTemplatePatch = T.OpenObject({ description: 'JSON merge patch over a day template (energy, macros, meals, exercise, steps, sleep, …).' });
const FastEvent = T.As<{ startDay: number; startH: number; durationH: number; electrolytes?: boolean; refeed?: 'none' | 'auto'; [k: string]: unknown }>(
  T.Object(
    { startDay: T.Integer({ minimum: 0 }), startH: T.Number({ minimum: 0, maximum: 24 }), durationH: T.Number({ minimum: 0 }) },
    { additionalProperties: true, description: 'Fast: last intake on startDay at startH (clock hour), meal-to-meal durationH hours; electrolytes, refeed.' },
  ),
);
const Block = T.Object({ name: T.String({ maxLength: 60 }), startDay: T.Integer({ minimum: 0 }), endDay: T.Integer({ minimum: 0 }), buildingBlockId: T.Optional(T.String()) });
export const ScheduleDoc = T.Object(
  { schemaVersion: T.Literal(1), startDate: T.Date(), horizonDays: T.Integer({ minimum: 1 }), programs: T.Array(T.OpenObject(), { minItems: 1 }), days: T.Array(T.OpenObject()) },
  { additionalProperties: true, description: 'Engine Schedule (programs keyed by letter, dense days, fasts, blocks).' },
);

export const ScheduleOp = T.Union([
  T.Object({ op: T.Literal('paint'), days: Days, program: T.Integer({ minimum: 0 }) }),
  T.Object({ op: T.Literal('clear'), days: Days }),
  T.Object({ op: T.Literal('editDays'), days: Days, patch: DayTemplatePatch }),
  T.Object({ op: T.Literal('resetOverrides'), days: Days }),
  T.Object({ op: T.Literal('shiftDays'), days: Days, delta: T.Integer() }),
  T.Object({ op: T.Literal('applyPattern'), pattern: T.Array(T.Integer({ minimum: 0 }), { minItems: 1, maxItems: 28 }), fromDay: T.Optional(T.Integer({ minimum: 0 })), toDay: T.Optional(T.Integer({ minimum: 0 })) }),
  T.Object({ op: T.Literal('copyWeek'), fromRow: T.Integer({ minimum: 0 }), toRows: T.Array(T.Integer({ minimum: 0 })), cols: T.Optional(T.Array(T.Nullable(T.OpenObject()), { minItems: 7, maxItems: 7 })) }),
  T.Object({ op: T.Literal('repeatWeekToEnd'), row: T.Integer({ minimum: 0 }) }),
  T.Object({ op: T.Literal('insertWeek'), row: T.Integer({ minimum: 0 }) }),
  T.Object({ op: T.Literal('deleteWeek'), row: T.Integer({ minimum: 0 }) }),
  T.Object({ op: T.Literal('deloadWeek'), row: T.Integer({ minimum: 0 }), habitualByWeekday: T.Optional(T.Array(T.Array(T.OpenObject()), { maxItems: 7 })) }),
  T.Object({ op: T.Literal('addProgram'), preset: T.Optional(T.String()), template: T.Optional(T.OpenObject()) }),
  T.Object({ op: T.Literal('updateProgram'), index: T.Integer({ minimum: 0 }), patch: DayTemplatePatch }),
  T.Object({ op: T.Literal('duplicateProgram'), index: T.Integer({ minimum: 0 }) }),
  T.Object({ op: T.Literal('deleteProgram'), index: T.Integer({ minimum: 0 }), replaceWith: T.Integer({ minimum: 0 }) }),
  T.Object({ op: T.Literal('addFast'), fast: FastEvent }),
  T.Object({ op: T.Literal('updateFast'), index: T.Integer({ minimum: 0 }), patch: T.OpenObject() }),
  T.Object({ op: T.Literal('removeFast'), index: T.Integer({ minimum: 0 }) }),
  T.Object({ op: T.Literal('setBlock'), block: Block }),
  T.Object({ op: T.Literal('setBlocks'), blocks: T.Array(Block) }),
  T.Object({ op: T.Literal('renameBlock'), index: T.Integer({ minimum: 0 }), name: T.String({ maxLength: 60 }) }),
  T.Object({ op: T.Literal('removeBlock'), index: T.Integer({ minimum: 0 }) }),
  T.Object({ op: T.Literal('setHorizon'), days: T.Integer({ minimum: 1 }) }),
  T.Object({ op: T.Literal('setStartDate'), date: T.Date() }),
  T.Object({ op: T.Literal('setEnergyReference'), ref: T.Enum(['baseline', 'current', 'blockStart']) }),
  T.Object({
    op: T.Literal('setAdherence'),
    patch: T.Object({
      selfMonitoring: T.Optional(T.Nullable(T.Boolean())),
      mealReplacement: T.Optional(T.Nullable(T.Boolean())),
      preMealWater: T.Optional(T.Nullable(T.Boolean())),
      flexibleRestraint: T.Optional(T.Nullable(T.Boolean())),
    }),
  }),
  T.Object({ op: T.Literal('setSchedule'), schedule: ScheduleDoc }),
]);
