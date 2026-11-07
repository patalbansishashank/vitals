/**
 * `supplements.*` (SUITE_SPEC §13.2): the person's supplements in the `supplements` section of `intake/me`, one row per
 * item with a state (taking · have it, don't take · not for me · not said), a dose with its unit and the times of day.
 * Reads migrate a v1 section on the fly; writes always store v2 (and drop the v1 `taking` list). Writes are
 * consequential, so an agent's change is staged as a proposal the person applies (propose → apply); the screens apply
 * directly and undo restores the section.
 *
 * Shared suggestion policy (D7-03): the view carries the same decisions Food uses — built from the current screening
 * (tri-state: unanswered is unchecked, never a negative screen), the blood-marker evaluation (flags and noSuggest with
 * their rule and sample date) and the food allergies. `notSuggested` lists catalogue items the Coach must not suggest
 * (not suggested, clinician review, unchecked) with short reasons; `rowStatus` marks the person's own rows with a
 * caution/review/unchecked status. Logging a product already taken is never refused.
 *
 * Active exposure (D7-04): `rowExposure` gives each taking row's active ingredients (from the exact product's label, or the
 * catalogue unit when the row is in it), whether the dose is known, and its upper-limit status — `unchecked` for unknown
 * potency, form or food intake, never a pass; weekly and alternate-day regimens keep their dose-day amount. A row may carry
 * the product's label serving (`product`) and its recurrence (`schedule`); a count without a label stays valid with an
 * unknown active dose. Potency is asked for only when a dose-sensitive limit depends on it.
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
import { supplementSuggestionPolicy } from '@/catalogues/supplements/planner';
import { rowExposureStatuses } from '@/catalogues/supplements/exposure';
import { ACTIVE_BASES, EXPOSURE_IDS, SUPPLEMENT_SCHEDULE_KINDS, type SupplementProduct, type SupplementSchedule } from '@/lib/bodyContracts';
import { simulatorProfileNow } from '@/state/internal/simulatorProfile';
import { SEED_SUPPLEMENTS } from '@/content/catalogues';
import { POLICY_LABEL, reasonWords, type SuggestionSafetyInput } from '@/lib/safetyPolicy';
import { currentSuggestionSafety } from '../food/suggestionSafety';
import { defineCommand, fail } from '../registry';
import { T } from '../schema';
import type { CommandContext } from '../types';
import { ALL, UNDO } from '../defs/_shared';

const STATE = T.Enum(['taking', 'onHand', 'notForMe', 'unknown'], { description: 'taking = takes it now; onHand = has it at home, does not take it; notForMe = does not want it; unknown = not said.' });
const STANCE = T.Enum(['taking', 'onHand', 'open', 'food_first']);
const TIME = T.Enum(['morning', 'midday', 'evening', 'night']);

/** (D7-04) A product's label serving: what one serving contains, as printed (amount null = potency not on the label). */
const Product = T.Object({
  servingAmount: T.Nullable(T.Number({ exclusiveMinimum: 0 })),
  servingUnit: T.String({ minLength: 1, maxLength: 16 }),
  actives: T.Array(
    T.Object({
      ingredient: T.Enum(EXPOSURE_IDS as readonly string[], { description: 'Active identity (magnesium = elemental Mg, epaDha = EPA+DHA, sodium = elemental Na, nitrate = mmol nitrate ion…).' }),
      amount: T.Nullable(T.Number({ minimum: 0 })),
      unit: T.String({ minLength: 1, maxLength: 16 }),
      basis: T.Enum(ACTIVE_BASES as readonly string[], { description: 'elemental, sodiumChloride, compound, epaDha, oilMass, protein, powderMass, nitrate, asLabelled.' }),
    }),
    { maxItems: 24 },
  ),
  labelText: T.Optional(T.String({ maxLength: 400 })),
  source: T.Optional(T.String({ maxLength: 64 })),
});

/** (D7-04) Recurrence: weekly/alternate-day use keeps its dose-day amount. */
const Schedule = T.Object({
  kind: T.Enum(SUPPLEMENT_SCHEDULE_KINDS as readonly string[]),
  daysOfWeek: T.Optional(T.Array(T.Integer({ minimum: 0, maximum: 6 }), { maxItems: 7, description: '0 = Monday.' })),
  dates: T.Optional(T.Array(T.Date(), { maxItems: 62 })),
  from: T.Optional(T.Date()),
  to: T.Optional(T.Date()),
  servingsPerOccasion: T.Optional(T.Number({ exclusiveMinimum: 0 })),
});

const Row = T.Object({
  supplementId: T.Nullable(T.String()),
  text: T.Optional(T.String()),
  state: STATE,
  dose: T.Optional(T.Number()),
  unit: T.Optional(T.String()),
  timesOfDay: T.Array(TIME),
  since: T.Optional(T.Date()),
  // contract fields of a stored row (C7: read back as stored)
  product: T.Optional(T.OpenObject()),
  schedule: T.Optional(T.OpenObject()),
  safetyCheck: T.Optional(T.String()),
  clinicianStop: T.Optional(T.OpenObject()),
});

const SupplementsView = T.Object({
  stance: T.Nullable(STANCE),
  rows: T.Array(Row),
  /** Plain lines: what the person takes, has at home and does not want. */
  summary: T.Nullable(T.String()),
  /** What the planner receives (supplement levers consented, refused, already taken, at home, observed active exposure). */
  planner: T.Object({
    optInLevers: T.Array(T.String()),
    excludedLevers: T.Array(T.String()),
    habitual: T.Array(T.String()),
    onHand: T.Array(T.String()),
    habitualActives: T.Array(T.OpenObject()),
  }),
  /**
   * (D7-04) Each taking row's active exposure: doseKnown (false = potency unknown, still a valid record), safetyCheck
   * (passed / violation / unchecked / notApplicable — unchecked is never "no issues"), and the actives with their dose-day
   * amount and daily average (null = unknown).
   */
  rowExposure: T.Array(
    T.Object({
      supplementId: T.Nullable(T.String()),
      text: T.Optional(T.String()),
      doseKnown: T.Boolean(),
      safetyCheck: T.Enum(['passed', 'violation', 'unchecked', 'notApplicable']),
      actives: T.Array(T.Object({ ingredient: T.String(), unit: T.String(), doseDay: T.Nullable(T.Number()), dailyAverage: T.Nullable(T.Number()), recurrence: T.String() })),
      reasons: T.Array(T.String()),
    }),
  ),
  /** (D7-03) Catalogue items not to suggest now, with the status word and short reasons. */
  notSuggested: T.Array(T.Object({ supplementId: T.String(), status: T.String(), reasons: T.Array(T.String()) })),
  /** (D7-03) Status of the person's own taking / on-hand rows (still logged; never a stop or start instruction). */
  rowStatus: T.Array(T.Object({ supplementId: T.String(), status: T.Enum(['caution', 'review', 'unchecked']), reasons: T.Array(T.String()) })),
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

/**
 * The shared suggestion-policy input now (D7-03): stored screening, the current marker evaluation (when the markers
 * and profile can be read) and the food allergies. A part that cannot be read stays unknown (unchecked), never negative.
 */
async function safetyInput(ctx: CommandContext, body: IntakeBody): Promise<SuggestionSafetyInput> {
  // one builder for every command surface (food line, supplements view): `currentSuggestionSafety`
  const diet = body.diet as { rulesComplete?: boolean; allergies?: string[] } | undefined;
  return currentSuggestionSafety(ctx, diet ? { diet } : null);
}

/** The person's age for the adult upper-limit references (unknown → the limit check stays unchecked). */
function ageNow(ctx: Pick<CommandContext, 'now'>): number | undefined {
  try {
    const a = simulatorProfileNow(ctx.now).body?.ageYears;
    return typeof a === 'number' && Number.isFinite(a) ? a : undefined;
  } catch {
    return undefined;
  }
}

function view(section: SupplementsSectionV2 | null, safety: SuggestionSafetyInput, ageYears?: number) {
  const policy = supplementSuggestionPolicy(section, SEED_SUPPLEMENTS, safety);
  const exposure = rowExposureStatuses(section?.rows ?? [], ageYears !== undefined ? { ageYears } : {});
  const planner = supplementPlannerInputs(section, safety);
  return {
    stance: section?.stance ?? null,
    // contract objects as plain records (C7: a stored row reads back as stored)
    rows: (section?.rows ?? []).map(({ product, schedule, ...r }) => ({ ...r, ...(product ? { product: { ...product } } : {}), ...(schedule ? { schedule: { ...schedule } } : {}) })),
    summary: supplementBriefing(section).text,
    planner: { ...planner, habitualActives: planner.habitualActives.map((h) => ({ ...h })) },
    notSuggested: policy.withheld.map((d) => ({ supplementId: d.subject, status: POLICY_LABEL[d.state], reasons: reasonWords(d) })),
    rowStatus: policy.rowStatus.map((r) => ({ supplementId: r.supplementId, status: r.status, reasons: reasonWords(r.decision) })),
    rowExposure: exposure.map((x) => ({
      supplementId: x.supplementId,
      ...(x.text ? { text: x.text } : {}),
      doseKnown: x.doseKnown,
      safetyCheck: x.safetyCheck,
      actives: x.actives.map((a) => ({ ingredient: a.ingredient, unit: a.unit, doseDay: a.peakDay, dailyAverage: a.dailyAverage, recurrence: a.recurrence })),
      reasons: x.reasons,
    })),
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
    'The person’s supplements: the stance (taking, onHand = has some at home, open, food_first) and one row per item with its state, dose each time with its unit, and times of day. Suggest onHand items before anything that must be bought; never suggest notForMe items or anything in notSuggested (with reasons). rowStatus marks taken items that need caution or review: mention it plainly, never tell them to stop or start. rowExposure gives each taken item’s active dose (null = unknown potency) and its limit check: Unchecked means not checked, never "no issues".',
  input: T.Object({}),
  output: SupplementsView,
  perm: 'read',
  surfaces: ALL,
  excludedReason: { ui: 'the screens read the intake document directly (useIntakeDoc) and write through supplements.set' },
  undo: UNDO.none,
  idempotency: 'none',
  sideEffects: [],
  execute: async (ctx) => {
    const body = await readBody(ctx);
    return view(toSectionV2(body.supplements), await safetyInput(ctx, body), ageNow(ctx));
  },
});

export const supplementsSet = defineCommand({
  id: 'supplements.set',
  version: 1,
  title: 'Change a supplement',
  description:
    'Add or change one supplement row: state (taking, onHand, notForMe, unknown), dose each time in a unit the item is sold in (e.g. creatine g or scoop, vitamin D IU or µg), times of day (morning, midday, evening, night). Taking needs a dose and a time. Optional: the stance, the product label (product: serving and actives with basis, e.g. 1 capsule = 500 mg EPA+DHA) and the recurrence (schedule: weekly, alternateDay…). A capsule count without a label stays valid with an unknown active dose: ask for the label only when a limit depends on it. Agent changes are proposals the person applies.',
  input: T.Object({
    ...Ref,
    state: T.Optional(STATE),
    dose: T.Optional(T.Nullable(T.Number({ exclusiveMinimum: 0 }))),
    unit: T.Optional(T.String({ minLength: 1, maxLength: 16 })),
    timesOfDay: T.Optional(T.Array(TIME, { maxItems: 4 })),
    stance: T.Optional(STANCE),
    product: T.Optional(T.Nullable(Product, { description: 'The exact product label serving (only when given; never a universal capsule/scoop potency). null removes it.' })),
    schedule: T.Optional(T.Nullable(Schedule, { description: 'Recurrence (daily, weekly, alternateDay, dates, asNeeded). null removes it.' })),
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
    if (input.product !== undefined) {
      const { product: _p, ...rest } = row;
      void _p;
      row = input.product === null ? rest : { ...rest, product: input.product as SupplementProduct };
    }
    if (input.schedule !== undefined) {
      const { schedule: _s, ...rest } = row;
      void _s;
      row = input.schedule === null ? rest : { ...rest, schedule: input.schedule as SupplementSchedule };
    }
    const check = validateDose(row);
    if (!check.ok) {
      const e = check.issues.find((i) => i.kind === 'error')!;
      fail('invalid_input', e.message, { path: e.code === 'noTime' ? '/timesOfDay' : e.code === 'unit' ? '/unit' : '/dose' });
    }
    const next = { ...upsertRow(section, row), ...(input.stance ? { stance: input.stance } : {}) };
    await write(ctx, body, next);
    return view(next, await safetyInput(ctx, body), ageNow(ctx));
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
    return view(next, await safetyInput(ctx, body), ageNow(ctx));
  },
});

declare module '../types' {
  interface CommandMap {
    'supplements.get': typeof supplementsGet;
    'supplements.set': typeof supplementsSet;
    'supplements.remove': typeof supplementsRemove;
  }
}
