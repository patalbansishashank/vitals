/**
 * `supplements.*` (SUITE_SPEC §13.2): the person's supplements in the `supplements` section of `intake/me`, one row per
 * item with a state (taking · have it, don't take · not for me · not said), a dose with its unit and the times of day.
 * Reads migrate a v1 section on the fly; writes always store v2 (and drop the v1 `taking` list). Writes are
 * consequential, so an agent's change is staged as a proposal the person applies (propose → apply); the screens apply
 * directly and undo restores the section.
 */
import {
  doseUnits,
  emptySection,
  newRow,
  removeRow,
  sameRow,
  setRowDose,
  setRowState,
  setTimes,
  supplementBriefing,
  supplementPlannerInputs,
  supplementRecord,
  toSectionV2,
  upsertRow,
  validateDose,
  type SupplementRow,
  type SupplementsSectionV2,
} from '@/catalogues/supplements';
import { defineCommand, fail } from '../registry';
import { T } from '../schema';
import type { CommandContext } from '../types';
import { ALL, UNDO } from '../defs/_shared';

const STATE = T.Enum(['taking', 'onHand', 'notForMe', 'unknown'], { description: 'taking = takes it now; onHand = has it at home, does not take it; notForMe = does not want it; unknown = not said.' });
const STANCE = T.Enum(['taking', 'onHand', 'open', 'food_first']);
const TIME = T.Enum(['morning', 'midday', 'evening', 'night']);

const Row = T.Object({
  supplementId: T.Nullable(T.String()),
  text: T.Optional(T.String()),
  state: STATE,
  dose: T.Optional(T.Number()),
  unit: T.Optional(T.String()),
  timesOfDay: T.Array(TIME),
  since: T.Optional(T.Date()),
});

const SupplementsView = T.Object({
  stance: T.Nullable(STANCE),
  rows: T.Array(Row),
  /** Plain lines: what the person takes, has at home and does not want. */
  summary: T.Nullable(T.String()),
  /** What the planner receives (supplement levers consented, refused, already taken, at home). */
  planner: T.Object({ optInLevers: T.Array(T.String()), excludedLevers: T.Array(T.String()), habitual: T.Array(T.String()), onHand: T.Array(T.String()) }),
});

interface IntakeBody {
  [k: string]: unknown;
}

async function readBody(ctx: CommandContext): Promise<IntakeBody> {
  const d = await ctx.docs.get<IntakeBody>('intake', 'me');
  const out: IntakeBody = {};
  if (d) for (const [k, v] of Object.entries(d)) if (!k.startsWith('_')) out[k] = v;
  return out;
}

function view(section: SupplementsSectionV2 | null) {
  return {
    stance: section?.stance ?? null,
    rows: section?.rows ?? [],
    summary: supplementBriefing(section).text,
    planner: supplementPlannerInputs(section),
  };
}

async function write(ctx: CommandContext, body: IntakeBody, section: SupplementsSectionV2): Promise<void> {
  const answeredAt = { ...((body.answeredAt as Record<string, string> | undefined) ?? {}) };
  if (!answeredAt.supplements) answeredAt.supplements = ctx.now;
  // question set 2 = the v3 intake's supplements questions (stance + rows)
  const questionSetVersion = { ...((body.questionSetVersion as Record<string, number> | undefined) ?? {}), supplements: 2 };
  await ctx.docs.put('intake', { ...body, supplements: section, answeredAt, questionSetVersion, _id: 'me' });
}

const Ref = {
  supplementId: T.Optional(T.Nullable(T.String({ minLength: 1, maxLength: 64, description: 'Catalogue id or alias (e.g. creatine_monohydrate, whey). Omit or null for an item typed as text.' }))),
  text: T.Optional(T.String({ minLength: 1, maxLength: 80, description: 'The item as the person wrote it, when it is not in the catalogue.' })),
};

function refOf(input: { supplementId?: string | null; text?: string }): { supplementId: string | null; text?: string } {
  const rec = supplementRecord(input.supplementId ?? null);
  if (input.supplementId && !rec) fail('invalid_input', `No supplement "${input.supplementId}" in the catalogue; pass it as text instead.`, { path: '/supplementId' });
  if (!rec && !input.text?.trim()) fail('invalid_input', 'Name the supplement: a catalogue id or the text the person used.', { path: '/supplementId' });
  return rec ? { supplementId: rec.id } : { supplementId: null, text: input.text!.trim() };
}

export const supplementsGet = defineCommand({
  id: 'supplements.get',
  version: 1,
  title: 'Read your supplements',
  description:
    'The person’s supplements: the stance (taking, onHand = has some at home, open, food_first) and one row per item with its state (taking, onHand, notForMe, unknown), dose each time with its unit, and times of day. Suggest onHand items before anything that must be bought; never suggest notForMe items.',
  input: T.Object({}),
  output: SupplementsView,
  perm: 'read',
  surfaces: ALL,
  excludedReason: { ui: 'the screens read the intake document directly (useIntakeDoc) and write through supplements.set' },
  undo: UNDO.none,
  idempotency: 'none',
  sideEffects: [],
  execute: async (ctx) => view(toSectionV2((await readBody(ctx)).supplements)),
});

export const supplementsSet = defineCommand({
  id: 'supplements.set',
  version: 1,
  title: 'Change a supplement',
  description:
    'Add or change one supplement row: state (taking, onHand, notForMe, unknown), dose each time with a unit the item is sold in (e.g. creatine g or scoop, vitamin D IU or µg), times of day (morning, midday, evening, night). Taking needs a dose and at least one time. Optionally sets the stance. Agent changes are proposals the person applies.',
  input: T.Object({
    ...Ref,
    state: T.Optional(STATE),
    dose: T.Optional(T.Nullable(T.Number({ exclusiveMinimum: 0 }))),
    unit: T.Optional(T.String({ minLength: 1, maxLength: 16 })),
    timesOfDay: T.Optional(T.Array(TIME, { maxItems: 4 })),
    stance: T.Optional(STANCE),
  }),
  output: SupplementsView,
  perm: 'write',
  impact: 'consequential',
  surfaces: ALL,
  undo: UNDO.IP,
  idempotency: 'natural',
  sideEffects: ['docs', 'planner'],
  coalesce: (input) => `supplements.set:${input.supplementId ?? input.text ?? ''}`,
  execute: async (ctx, input) => {
    const body = await readBody(ctx);
    const section = toSectionV2(body.supplements) ?? emptySection(input.stance ?? 'taking');
    const ref = refOf(input);
    const prev = section.rows.find((r) => sameRow(r, ref));
    // a new row starts unsaid, then moves into its state (so taking fills the catalogue dose and `since`)
    let row: SupplementRow = prev ?? newRow(ref, 'unknown');
    row = setRowState(row, input.state ?? prev?.state ?? 'taking', ctx.today);
    if (input.unit !== undefined && !doseUnits(row.supplementId).includes(input.unit))
      fail('invalid_input', `Use one of these units: ${doseUnits(row.supplementId).join(', ')}.`, { path: '/unit' });
    if (input.dose !== undefined || input.unit !== undefined) row = setRowDose(row, input.dose === null ? undefined : input.dose ?? row.dose, input.unit);
    if (input.timesOfDay) row = setTimes(row, input.timesOfDay);
    const check = validateDose(row);
    if (!check.ok) {
      const e = check.issues.find((i) => i.kind === 'error')!;
      fail('invalid_input', e.message, { path: e.code === 'noTime' ? '/timesOfDay' : e.code === 'unit' ? '/unit' : '/dose' });
    }
    const next = { ...upsertRow(section, row), ...(input.stance ? { stance: input.stance } : {}) };
    await write(ctx, body, next);
    return view(next);
  },
});

export const supplementsRemove = defineCommand({
  id: 'supplements.remove',
  version: 1,
  title: 'Remove a supplement',
  description: 'Remove one supplement row (for an item added by mistake; to say the person does not want it, set its state to notForMe instead).',
  input: T.Object({ ...Ref }),
  output: SupplementsView,
  perm: 'write',
  impact: 'consequential',
  surfaces: ALL,
  undo: UNDO.IP,
  idempotency: 'natural',
  sideEffects: ['docs', 'planner'],
  execute: async (ctx, input) => {
    const body = await readBody(ctx);
    const section = toSectionV2(body.supplements);
    const ref = refOf(input);
    if (!section || !section.rows.some((r) => sameRow(r, ref))) fail('not_found', 'That supplement is not on the list.');
    const next = removeRow(section, ref);
    await write(ctx, body, next);
    return view(next);
  },
});

declare module '../types' {
  interface CommandMap {
    'supplements.get': typeof supplementsGet;
    'supplements.set': typeof supplementsSet;
    'supplements.remove': typeof supplementsRemove;
  }
}
