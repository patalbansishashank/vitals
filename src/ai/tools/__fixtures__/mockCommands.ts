/**
 * Mock command set and in-memory `CommandPort` for tests of the AI tool layer. Stands in for E4's registry and
 * dispatcher until they exist; the behaviour mirrors SUITE_SPEC §1.3–§1.6 where tests depend on it.
 */
import type { JsonSchema } from '../../providers/types';
import { aiCommand, type AiCommandDef, type CommandPort, type PortDispatchOptions, type PortResult } from '../types';

const isoDate: JsonSchema = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Calendar date YYYY-MM-DD' };

export const MOCK_COMMANDS: AiCommandDef[] = [
  aiCommand({
    id: 'today.get',
    title: 'Today',
    description: "Today's targets, what is logged so far and what remains. Use before answering questions about today.",
    input: { type: 'object', properties: { date: isoDate }, additionalProperties: false },
    confirm: 'read',
  }),
  aiCommand({
    id: 'log.get',
    title: 'Log entries',
    description: 'Logged entries in a date range. detail "summary" gives daily totals; "full" gives every entry. Example: {"from":"2026-09-24","to":"2026-09-30"}.',
    input: {
      type: 'object',
      properties: {
        from: isoDate,
        to: isoDate,
        detail: { type: 'string', enum: ['summary', 'full'] },
        cursor: { type: 'string' },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
    confirm: 'read',
  }),
  aiCommand({
    id: 'profile.get',
    title: 'Profile',
    description: 'The person\'s profile summary (body, habits, equipment, food preferences).',
    input: { type: 'object', properties: {}, additionalProperties: false },
    confirm: 'read',
  }),
  aiCommand({
    id: 'catalogue.searchFoods',
    title: 'Food search',
    description: 'Search the food catalogue by name. Returns ids and per-100 g nutrients.',
    input: {
      type: 'object',
      properties: { q: { type: 'string', minLength: 1, maxLength: 80 }, limit: { type: 'integer', minimum: 1, maximum: 50 } },
      required: ['q'],
      additionalProperties: false,
    },
    confirm: 'read',
  }),
  aiCommand({
    id: 'log.meal',
    title: 'Log a meal',
    description: 'Log a meal as components with grams. Nutrients are computed by the app. Example: {"components":[{"name":"rice","grams":150}],"method":"described"}.',
    input: {
      type: 'object',
      properties: {
        date: isoDate,
        slot: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
        components: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', minLength: 1 },
              grams: { type: 'number', minimum: 0, maximum: 5000 },
              foodId: { type: 'string' },
            },
            required: ['name', 'grams'],
            additionalProperties: false,
          },
        },
        method: { type: 'string', enum: ['described', 'photo', 'label'] },
        idempotencyKey: { type: 'string', maxLength: 64 },
      },
      required: ['components', 'method'],
      additionalProperties: false,
    },
    confirm: 'log',
  }),
  aiCommand({
    id: 'log.measurement',
    title: 'Log a measurement',
    description: 'Log a body measurement. Units: kg, cm or percent. Example: {"metric":"weight","value":81.4,"unit":"kg"}.',
    input: {
      type: 'object',
      properties: {
        date: isoDate,
        metric: { type: 'string', enum: ['weight', 'waist', 'bodyFat'] },
        value: { type: 'number', exclusiveMinimum: 0, maximum: 500 },
        unit: { type: 'string', enum: ['kg', 'cm', '%'] },
      },
      required: ['metric', 'value'],
      additionalProperties: false,
    },
    confirm: 'log',
  }),
  aiCommand({
    id: 'plan.shift',
    title: 'Shift the plan',
    description: 'Shift the remaining plan by whole days (positive = later). Staged for the person to approve.',
    input: {
      type: 'object',
      properties: { days: { type: 'integer', minimum: -30, maximum: 30 }, from: isoDate, reason: { type: 'string', maxLength: 200 } },
      required: ['days'],
      additionalProperties: false,
    },
    confirm: 'edit',
  }),
  aiCommand({
    id: 'profile.patch',
    title: 'Update the profile',
    description: 'Change profile fields such as activity level or equipment. Staged for the person to approve.',
    input: {
      type: 'object',
      properties: {
        activity: { type: 'string', enum: ['sedentary', 'light', 'moderate', 'high'] },
        equipment: { type: 'array', items: { type: 'string' }, maxItems: 30 },
      },
      additionalProperties: false,
    },
    confirm: 'edit',
  }),
  aiCommand({
    id: 'log.bulk',
    title: 'Log several days',
    description: 'Log entries for up to 14 days at once. Staged for the person to approve.',
    input: {
      type: 'object',
      properties: { days: { type: 'array', maxItems: 14, items: { type: 'object', properties: { date: isoDate, note: { type: 'string' } }, required: ['date'], additionalProperties: false } } },
      required: ['days'],
      additionalProperties: false,
    },
    confirm: 'edit',
  }),
  aiCommand({
    id: 'plan.end',
    title: 'End the plan',
    description: 'End the active plan. Only when the person explicitly asks; they confirm it in the app.',
    input: {
      type: 'object',
      properties: { reason: { type: 'string', enum: ['done', 'stopped', 'illness', 'other'] }, note: { type: 'string', maxLength: 200 } },
      required: ['reason'],
      additionalProperties: false,
    },
    confirm: 'destructive',
  }),
  aiCommand({
    id: 'sim.whatIf',
    title: 'What-if simulation',
    description: 'Simulate variants of the plan without saving anything. Long-running: returns a job to poll with job status.',
    input: {
      type: 'object',
      properties: { variants: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'object', properties: { shiftDays: { type: 'integer' } }, required: ['shiftDays'], additionalProperties: false } } },
      required: ['variants'],
      additionalProperties: false,
    },
    confirm: 'read',
  }),
  aiCommand({
    id: 'job.status',
    title: 'Job status',
    description: 'Progress of a long-running job by id.',
    input: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'], additionalProperties: false },
    confirm: 'read',
    aiLimit: { perTurn: 3 },
  }),
];

export interface RecordedDispatch {
  id: string;
  input: unknown;
  opts: PortDispatchOptions;
}

export interface MockPort extends CommandPort {
  calls: RecordedDispatch[];
  /** Non-dry-run dispatches that reached a command (replays excluded). */
  executed: RecordedDispatch[];
  undone: string[];
}

const KEYED = new Set(['log.meal', 'log.measurement', 'log.bulk', 'plan.shift', 'plan.end']);

/** In-memory port: idempotent replay per `(commandId, key)`, dry-run previews, a safety block, jobs and undo. */
export function createMockPort(): MockPort {
  const ledger = new Map<string, PortResult>();
  const undoable = new Set<string>();
  let seq = 0;
  const calls: RecordedDispatch[] = [];
  const executed: RecordedDispatch[] = [];
  const undone: string[] = [];

  function execute(id: string, input: Record<string, unknown>, opts: PortDispatchOptions): PortResult {
    const change = (output: unknown, summary: string): PortResult => {
      seq++;
      const undoToken = `undo_${seq}`;
      undoable.add(undoToken);
      return { ok: true, output, changeId: `chg_${seq}`, undoToken, summary };
    };
    switch (id) {
      case 'today.get':
        return { ok: true, output: { date: input.date ?? '2026-10-01', remaining: { kcal: 900, proteinG: 60 } } };
      case 'profile.get':
        return { ok: true, output: { sex: 'male', heightCm: 180, activity: 'light' } };
      case 'catalogue.searchFoods':
        return { ok: true, output: { items: [{ id: 'food_rice', name: 'Rice, cooked', kcalPer100g: 130 }] } };
      case 'log.get': {
        const n = input.detail === 'full' ? 600 : 7;
        return {
          ok: true,
          output: {
            entries: Array.from({ length: n }, (_, i) => ({ id: `e${i}`, label: `Day ${i} · dinner · dal, rice, 2 eggs`, kcal: 650 + i })),
            nextCursor: input.detail === 'full' ? 'cur_2' : undefined,
          },
        };
      }
      case 'sim.whatIf':
        seq++;
        return { ok: true, job: { jobId: `job_${seq}` } };
      case 'job.status':
        return { ok: true, output: { jobId: input.jobId, state: 'running', progress: 0.5 } };
      case 'log.meal':
        return change({ entryId: `entry_${seq + 1}` }, `Logged ${(input.components as unknown[]).length} item(s).`);
      case 'log.measurement':
        return change({ entryId: `entry_${seq + 1}` }, `Logged ${String(input.metric)} ${String(input.value)}.`);
      case 'plan.shift':
        if (opts.dryRun) return { ok: true, output: { shiftDays: input.days, goalDateMoves: input.days }, summary: `shift the plan by ${String(input.days)} days` };
        return change({ version: 2 }, `Plan shifted by ${String(input.days)} days.`);
      case 'profile.patch':
        if (opts.dryRun) return { ok: true, output: { before: { activity: 'light' }, after: input }, summary: 'update the profile' };
        return change({ activity: input.activity }, 'Profile updated.');
      case 'log.bulk':
        if (opts.dryRun) return { ok: true, output: { days: (input.days as unknown[]).length } };
        return change({ logged: (input.days as unknown[]).length }, 'Days logged.');
      case 'plan.end':
        if (!opts.confirmation) return { ok: false, error: { code: 'confirmation_required', message: 'Ending the plan needs confirmation.' } };
        return change({ ended: true }, 'Plan ended.');
      default:
        return { ok: false, error: { code: 'not_found', message: `Unknown command ${id}.` } };
    }
  }

  return {
    calls,
    executed,
    undone,
    async dispatch(id, input, opts) {
      const rec = { id, input, opts };
      calls.push(rec);
      const args = (input ?? {}) as Record<string, unknown>;
      // Safety gate runs in dry runs too (SUITE_SPEC §1.1 item 5).
      if (id === 'plan.shift' && typeof args.days === 'number' && Math.abs(args.days) > 14) {
        return {
          ok: false,
          error: {
            code: 'safety_blocked',
            message: 'Shifting the plan by more than 14 days is not allowed.',
            detail: { gate: 'planShiftWindow', allowedAlternatives: ['Shift by up to 14 days', 'Pause the plan instead'] },
          },
        };
      }
      if (!opts.dryRun && KEYED.has(id)) {
        if (!opts.idempotencyKey && opts.actor.kind === 'ai') {
          return { ok: false, error: { code: 'invalid_input', message: 'An idempotency key is required.' } };
        }
        const stored = opts.idempotencyKey ? ledger.get(`${id}|${opts.idempotencyKey}`) : undefined;
        if (stored) return stored;
      }
      const r = execute(id, args, opts);
      if (!opts.dryRun) {
        executed.push(rec);
        if (KEYED.has(id) && opts.idempotencyKey && r.ok) ledger.set(`${id}|${opts.idempotencyKey}`, r);
      }
      return r;
    },
    async undo(undoToken) {
      if (!undoable.has(undoToken)) return { ok: false, error: { code: 'not_found', message: 'Nothing to undo for that change.' } };
      undoable.delete(undoToken);
      undone.push(undoToken);
      return { ok: true, output: { undone: true } };
    },
  };
}
