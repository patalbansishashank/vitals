/**
 * `intake.*` (SUITE_SPEC §1.9, §2.3.1): the `intake/me` document, section by section. `intake.answer` merges a section
 * (JSON merge patch), validates the merged body against its section schema (`../schema/intake.ts`, the intake
 * package's types), stamps it (`answeredAt`, `questionSetVersion`) and, in the same change, derives the profile habit
 * fields the answers imply (`habits.activity`, steps and sessions, diet level, alcohol) with the intake package's own
 * reducers — one undo step for both.
 */
import { defineCommand, fail } from '../registry';
import { T, Value } from '../schema';
import { INTAKE_SECTION_SCHEMAS } from '../schema/intake';
import type { CommandContext } from '../types';
import { ALL, UNDO, stub } from './_shared';
import { ACTIVE_BASES, EXPOSURE_IDS, SUPPLEMENT_SCHEDULE_KINDS } from '@/lib/bodyContracts';
import type { ActivityIntake } from '@/engine/types/profile';

const SECTIONS = ['activity', 'training', 'diet', 'kitchen', 'supplements', 'markers'] as const;
type Section = (typeof SECTIONS)[number];

const IntakeView = T.Object({
  sections: T.OpenObject({ description: 'Answered sections (activity, training, diet, kitchen, supplements, markers).' }),
  answeredAt: T.Record(T.String()),
  skipped: T.Array(T.String()),
  missing: T.Array(T.String()),
});

interface IntakeBody {
  answeredAt?: Record<string, string>;
  questionSetVersion?: Record<string, number>;
  skipped?: Record<string, string>;
  [section: string]: unknown;
}

async function read(ctx: CommandContext): Promise<IntakeBody> {
  const d = await ctx.docs.get<IntakeBody>('intake', 'me');
  if (!d) return { answeredAt: {}, questionSetVersion: {} };
  const out: IntakeBody = {};
  for (const [k, v] of Object.entries(d)) if (!k.startsWith('_')) out[k] = v;
  return out;
}

function view(body: IntakeBody, section?: Section) {
  const sections: Record<string, unknown> = {};
  for (const s of SECTIONS) if (body[s] !== undefined && (!section || s === section)) sections[s] = body[s];
  const answeredAt = body.answeredAt ?? {};
  const skipped = Object.keys(body.skipped ?? {});
  // blood markers is optional: never "missing"
  return { sections, answeredAt, skipped, missing: SECTIONS.filter((s) => s !== 'markers' && !answeredAt[s]) };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/*
 * D7-04 (2026-10-18 contracts, C3): a supplement row may carry the exact product's label serving with normalised actives
 * and a recurrence schedule. The section schema itself is open (owned by the intake package), so these optional shapes are
 * checked here: identities are exposure ids, amounts finite and non-negative, and an unknown potency (null amount) stays a
 * valid row (its safety check is unchecked, never passed).
 */
const SupplementProductSchema = T.Object({
  servingAmount: T.Nullable(T.Number({ exclusiveMinimum: 0 })),
  servingUnit: T.String({ minLength: 1, maxLength: 24 }),
  actives: T.Array(
    T.Object({ ingredient: T.Enum(EXPOSURE_IDS), amount: T.Nullable(T.Number({ minimum: 0 })), unit: T.String({ minLength: 1, maxLength: 16 }), basis: T.Enum(ACTIVE_BASES) }),
    { maxItems: 24 },
  ),
  labelText: T.Optional(T.String({ maxLength: 500 })),
  source: T.Optional(T.String({ maxLength: 64 })),
});
const SupplementScheduleSchema = T.Object({
  kind: T.Enum(SUPPLEMENT_SCHEDULE_KINDS),
  daysOfWeek: T.Optional(T.Array(T.Integer({ minimum: 0, maximum: 6 }), { maxItems: 7 })),
  dates: T.Optional(T.Array(T.Date(), { maxItems: 366 })),
  from: T.Optional(T.Date()),
  to: T.Optional(T.Date()),
  timesOfDay: T.Optional(T.Array(T.String({ maxLength: 16 }), { maxItems: 8 })),
  servingsPerOccasion: T.Optional(T.Number({ exclusiveMinimum: 0, maximum: 100 })),
});

/** D7-04: problems with the optional `product`/`schedule` of each supplements row (paths relative to the section). */
export function supplementRowContractErrors(section: unknown): Array<{ path: string; message: string }> {
  const out: Array<{ path: string; message: string }> = [];
  const rows = isObj(section) && Array.isArray(section.rows) ? section.rows : [];
  rows.forEach((row, i) => {
    if (!isObj(row)) return;
    if (row.product !== undefined) for (const e of Value.Errors(SupplementProductSchema, row.product, 3)) out.push({ path: `/rows/${i}/product${e.path}`, message: e.message });
    if (row.schedule !== undefined) for (const e of Value.Errors(SupplementScheduleSchema, row.schedule, 3)) out.push({ path: `/rows/${i}/schedule${e.path}`, message: e.message });
  });
  return out;
}
function merge(base: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = isObj(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = isObj(v) ? merge(out[k], v) : v;
  }
  return out;
}

export const intakeGet = defineCommand({
  id: 'intake.get',
  version: 1,
  title: 'Read the intake',
  description: 'The intake answers by section (activity, training, diet, kitchen, supplements, markers), when each was answered, which were skipped and which are still missing.',
  input: T.Object({ section: T.Optional(T.Enum(SECTIONS)) }),
  output: IntakeView,
  perm: 'read',
  surfaces: ALL,
  excludedReason: { ui: 'the intake screens arrive with E7' },
  undo: UNDO.none,
  idempotency: 'none',
  sideEffects: [],
  execute: async (ctx, input) => view(await read(ctx), input.section),
});

export const intakeAnswer = defineCommand({
  id: 'intake.answer',
  version: 1,
  title: 'Answer intake questions',
  description:
    'Save answers for one intake section (merge patch: only the fields given change; null removes one). Marks the section answered; activity and diet answers also update the profile habits they imply (activity, steps, diet level), and a resting energy measured with a breath test (metabolic cart) becomes the measured resting metabolism.',
  input: T.Object({ section: T.Enum(SECTIONS), answers: T.OpenObject({ description: 'Section answers (shapes owned by the intake package).' }), questionSetVersion: T.Optional(T.Integer({ minimum: 1 })) }),
  output: IntakeView,
  perm: 'write',
  impact: 'low',
  surfaces: ALL,
  undo: UNDO.IP,
  idempotency: 'natural',
  sideEffects: ['docs'],
  execute: async (ctx, input) => {
    const body = await read(ctx);
    const skipped = { ...(body.skipped ?? {}) };
    delete skipped[input.section];
    const section = merge(body[input.section], input.answers);
    const errors = Value.Errors(INTAKE_SECTION_SCHEMAS[input.section], section, 3);
    if (errors.length) fail('invalid_input', `The ${input.section} answers are not valid: ${errors.map((e) => `${e.path || '/'} ${e.message}`).join('; ')}`, { path: `/answers${errors[0]!.path}` });
    const rowErrors = input.section === 'supplements' ? supplementRowContractErrors(section) : [];
    if (rowErrors.length) fail('invalid_input', `The supplements answers are not valid: ${rowErrors.map((e) => `${e.path} ${e.message}`).join('; ')}`, { path: `/answers${rowErrors[0]!.path}` });
    if (input.section === 'activity') {
      const { bodyValues } = await import('@/state/internal/profile');
      const { HabitualCardioSourceError, projectHabitualCardioActivity } = await import('@/engine/core/resolveProfile');
      try { projectHabitualCardioActivity(section as ActivityIntake, bodyValues().habits.habitualCardio); }
      catch (error) {
        if (error instanceof HabitualCardioSourceError)
          fail('invalid_input', error.message, { path: '/answers/recreation' });
        throw error;
      }
    }
    const next: IntakeBody = {
      ...body,
      [input.section]: section,
      answeredAt: { ...(body.answeredAt ?? {}), [input.section]: ctx.now },
      questionSetVersion: { ...(body.questionSetVersion ?? {}), [input.section]: input.questionSetVersion ?? body.questionSetVersion?.[input.section] ?? 1 },
      skipped,
    };
    await ctx.docs.put('intake', { ...next, _id: 'me' });
    // the profile habit fields these answers set (SUITE_SPEC §2.3.1), in this command's change (the intake reducers
    // load on demand)
    const { applyDerivedHabits, applyDerivedLabs, derivedHabits, derivedLabs } = await import('@/state/internal/intake');
    const habits = derivedHabits(input.section, next as Record<string, unknown>, ctx.now);
    // a measured resting energy from a metabolic cart is the profile's measured RMR (SUITE_SPEC §13.1)
    const labs = input.section === 'activity' ? derivedLabs(body.activity, next.activity) : null;
    if (habits || labs)
      ctx.write(() => {
        if (habits) applyDerivedHabits(habits);
        if (labs) applyDerivedLabs(labs);
      });
    return view(next);
  },
});

export const intakeSkip = defineCommand({
  id: 'intake.skip',
  version: 1,
  title: 'Skip an intake section',
  description: 'Mark an intake section as skipped for now (defaults apply; it can be answered later).',
  input: T.Object({ section: T.Enum(SECTIONS) }),
  output: IntakeView,
  perm: 'write',
  impact: 'low',
  surfaces: ALL,
  undo: UNDO.IP,
  idempotency: 'natural',
  sideEffects: ['docs'],
  execute: async (ctx, input) => {
    const body = await read(ctx);
    const next: IntakeBody = {
      ...body,
      answeredAt: { ...(body.answeredAt ?? {}), [input.section]: ctx.now },
      questionSetVersion: { ...(body.questionSetVersion ?? {}) },
      skipped: { ...(body.skipped ?? {}), [input.section]: ctx.now },
    };
    await ctx.docs.put('intake', { ...next, _id: 'me' });
    return view(next);
  },
});

export const intakeNextQuestions = stub({
  id: 'intake.nextQuestions',
  title: 'Next intake questions',
  description: 'The next questions of conversational onboarding for a section (or the next section with missing answers).',
  input: T.Object({ section: T.Optional(T.Enum(SECTIONS)) }),
  output: T.Array(T.OpenObject()),
  perm: 'read',
  // the screens walk the question sets themselves (src/features/intake/flow.ts); the Coach's conversational version
  // needs those questions as headless data
  owner: 'E7 (question sets as data for the Coach)',
});

declare module '../types' {
  interface CommandMap {
    'intake.get': typeof intakeGet;
    'intake.answer': typeof intakeAnswer;
    'intake.skip': typeof intakeSkip;
  }
}
