/**
 * The write side of Living mode over the command bus (docs/SUITE_SPEC.md §1.9, living-mode.md §12): every logging tap
 * and plan change dispatches its command with a literal id, and the screens read the result back through the
 * document-backed source (`./documents.ts`) — never one without the other. Undo is the command's own: a log entry or
 * measurement is retracted (`log.retract`), anything else (marks, plan changes) goes back through `history.undo`. `plan.end` and `plan.replace` carry the
 * confirmation the typed-word dialog stands for (`mintConfirmation`). Plan changes (`plan.replan`, `plan.declareEvent`,
 * `plan.shift`, `plan.swapExercise` every week) say what happened: a proposal waiting on Today, applied, nothing to change, or no safe
 * plan.
 *
 * Quiet mode is the synced setting (`settings.update`, read back through the living view).
 * Not on the bus yet (they answer "not available yet"): the automatic-ease policy (no command), change
 * undo/redo after the fact (the ChangeSet undo of the toast covers the 5-s window).
 */
import { dispatch, mintConfirmation, type CommandResult } from '@/commands';
import type { DayIntakeAttestation } from '@/lib/bodyContracts';
import { addDays, type LocalDate, type LogEntry, type Mark, type TodayChecklistItem } from '@/living';
import { slotEntries } from '../food/slots';
import { getActivePlanSource } from '../mode';
import { measurementFacts, measurementValues, type ActionOutcome, type LivingActions, type ManualMealInput, type MealAnswerInput, type RowMark } from './actions';
import { parseProposalCardId } from './documents';
import type { LivingDataSource } from './source';

const NOT_YET: ActionOutcome = { ok: false, message: 'Not available yet.' };
/** A device feeds this stream: a hand entry would be refused, so it never gets dispatched (Correct is the way). */
const MARK_OF: Record<RowMark, Mark> = { asPlanned: 'asPlanned', partly: 'partly', skipped: 'not' };
const STATUS_OF: Record<RowMark, 'done' | 'partial' | 'skipped'> = { asPlanned: 'done', partly: 'partial', skipped: 'skipped' };

/** A local wall time on a date as an instant (`h` may run past 24 or below 0). */
function instantAt(date: LocalDate, h: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setTime(d.getTime() + h * 3600_000);
  return d.toISOString();
}

/** The command's result as an outcome; undo retracts the entry it logged, else undoes its ChangeSet. */
/**
 * (D6-05/C3) The `log.meal` components that log stored meals again ("same as yesterday", recents): each table or recipe
 * component through its frozen serving snapshot (`relogSnapshotComponents`: per-100 g composition, source id/version,
 * recipe serving fraction, imputed and unknown fields kept), so a recipe or food edited or deleted since never changes the
 * repeated serving; typed or label numbers through the entry's frozen per-100 g values. A legacy entry without a snapshot
 * falls back to the stored values (ids and grams for table items). The repeat is a new event (new id, occurrence and
 * portion group); the stored entry is never rewritten. Null when any entry can no longer be read (the caller's components
 * then stand).
 */
async function storedRelog(date: LocalDate, relog: NonNullable<ManualMealInput['relog']>): Promise<unknown[] | null> {
  if (relog.entryIds.length === 0) return null;
  const got = await dispatch('log.get', { from: relog.date ?? addDays(date, -7), to: relog.date ?? date, kinds: ['meal'] });
  if (!got.ok || !('output' in got) || !Array.isArray(got.output)) return null;
  const byId = new Map((got.output as LogEntry[]).filter((e): e is Extract<LogEntry, { kind: 'meal' }> => e.kind === 'meal').map((e) => [e.id, e] as const));
  const stored = relog.entryIds.map((id) => byId.get(id));
  if (stored.some((e) => !e)) return null;
  const { relogSnapshotComponents } = await import('@/commands/food');
  return stored.flatMap((e) => relogSnapshotComponents(e!));
}

function outcome(r: CommandResult): ActionOutcome {
  if (!r.ok) return { ok: false, message: r.error.message };
  if (!('output' in r)) return { ok: true };
  // a meal the app couldn't identify confidently is not logged: say what it needs instead of "logged"
  const asked = r.output as { status?: unknown; question?: unknown } | null;
  if (asked?.status === 'ask') return { ok: false, message: typeof asked.question === 'string' ? `Not logged yet. ${asked.question}` : 'Not logged yet. Say what it was and roughly how much.' };
  const entryId = (r.output as { entryId?: unknown } | null)?.entryId;
  // log entries and measurements are append-only (a retract entry removes one); anything else reverts its ChangeSet
  if (typeof entryId === 'string') return { ok: true, undo: async () => outcome(await dispatch('log.retract', { entryId })) };
  const cs = r.changeSet?.id;
  return cs ? { ok: true, undo: async () => outcome(await dispatch('history.undo', { changeSetId: cs })) } : { ok: true };
}

/** What a plan change says, in plain words (the screens toast it). */
const ADAPT_COPY = {
  proposed: 'A proposal is waiting on Today.',
  adopted: 'The plan is updated.',
  unchanged: 'The plan already fits, so nothing changed.',
  noSafePlan: 'There is no safe plan from here, so nothing changed.',
  running: 'Re-planning… the proposal will show on Today.',
} as const;

const sentence = (...parts: Array<string | undefined>) => parts.filter((p): p is string => !!p && !!p.trim()).join(' ');

/** `plan.replan` / `plan.declareEvent` / `plan.shift` / `plan.editDay` output (AdaptOutput) as an outcome. */
export function adaptOutcome(r: CommandResult): ActionOutcome {
  const base = outcome(r);
  if (!r.ok) return base;
  if (!('output' in r)) return { ...base, message: ADAPT_COPY.running };
  const o = (r.output ?? {}) as { status?: unknown; notes?: unknown; cardId?: unknown };
  const lead = Array.isArray(o.notes) && typeof o.notes[0] === 'string' ? o.notes[0] : undefined;
  const proposalId = typeof o.cardId === 'string' ? o.cardId : undefined;
  switch (o.status) {
    case 'proposed':
      return { ...base, message: sentence(lead, ADAPT_COPY.proposed), ...(proposalId ? { proposalId } : {}) };
    case 'adopted':
      return { ...base, message: sentence(lead, ADAPT_COPY.adopted) };
    case 'unchanged':
      return { ok: true, message: ADAPT_COPY.unchanged };
    case 'noSafePlan':
      return { ok: false, message: sentence(ADAPT_COPY.noSafePlan, lead) };
    default:
      return base;
  }
}

/** `plan.swapExercise` output as an outcome: the stimulus it keeps and, every week, the proposal it left on Today. */
export function swapOutcome(r: CommandResult): ActionOutcome {
  const base = outcome(r);
  if (!r.ok || !('output' in r)) return base;
  const o = (r.output ?? {}) as { everyWeek?: unknown; weekly?: { meanCredit?: unknown }; equivalence?: { credit?: unknown }; cardId?: unknown };
  const weekly = typeof o.weekly?.meanCredit === 'number' ? o.weekly.meanCredit : undefined;
  const day = typeof o.equivalence?.credit === 'number' ? o.equivalence.credit : undefined;
  const credit = o.everyWeek === true ? (weekly ?? day) : day;
  const proposalId = typeof o.cardId === 'string' ? o.cardId : undefined;
  return {
    ...base,
    ...(credit !== undefined ? { credit } : {}),
    ...(proposalId ? { proposalId, message: ADAPT_COPY.proposed } : {}),
  };
}

/** Living actions over the bus; `source` supplies the day's prescription for "as planned" marks. */
export function createCommandLivingActions(source: LivingDataSource): LivingActions {
  const rx = (date: LocalDate) => source.today(date)?.prescription ?? null;
  const planId = () => getActivePlanSource().get().plan?.id ?? null;
  const run = async (p: Promise<CommandResult>): Promise<ActionOutcome> => outcome(await p);

  const markDay = (date: LocalDate, mark: Mark) => run(dispatch('log.markDay', { date, marks: { all: mark } }));
  const logSteps = (date: LocalDate, steps: number) => run(dispatch('log.steps', { date, steps: Math.max(0, Math.round(steps)) }));
  const logSleep = (date: LocalDate, hours: number) => {
    const wakeH = rx(date)?.sleep?.wakeH ?? 7;
    return run(dispatch('log.sleep', { bedAt: instantAt(date, wakeH - hours), wakeAt: instantAt(date, wakeH) }));
  };

  // one meal's answer is one `log.markDay` change (its `meal`): the slot's food is replaced and its own answer kept in the
  // same transaction, so a refused answer leaves the meal as it was and Undo (`history.undo`) restores it whole
  const answerMeal = (date: LocalDate, a: MealAnswerInput): Promise<ActionOutcome> => {
    const s = a.mark === 'asPlanned' ? a.serving : undefined;
    // the recipe's own numbers for one serving: one portion carrying them, as typed numbers are logged
    // (catalogue carbohydrate is available carbohydrate: the frozen serving closes its convention energy, D6-02)
    const components = s
      ? [{ name: s.name, grams: 100, labelPer100g: { energyKcal: s.energyKcal, proteinG: s.proteinG, carbG: s.carbG, fatG: s.fatG, ...(s.fibreG !== undefined ? { fibreG: s.fibreG } : {}) }, carbBasis: 'available' as const }]
      : undefined;
    return run(dispatch('log.markDay', { date, meal: { slot: a.slot, mark: MARK_OF[a.mark], replaces: [...a.replaces], ...(components ? { components } : {}) } }));
  };

  const markRow = async (date: LocalDate, rowId: string, mark: RowMark): Promise<ActionOutcome> => {
    const day = rx(date);
    if (rowId.startsWith('meal:')) {
      const slot = rowId.slice(5);
      return answerMeal(date, { slot, mark, replaces: slotEntries(source.today(date), slot).map((e) => e.id) });
    }
    if (rowId.startsWith('session:')) {
      const slotKey = rowId.slice(8);
      const s = day?.sessions.find((x) => x.slotKey === slotKey);
      return run(dispatch('log.session', { date, slotKey, status: STATUS_OF[mark], performed: [], ...(s ? { startH: s.startH } : {}) }));
    }
    if (rowId === 'fast') return run(dispatch('log.markDay', { date, marks: { fast: MARK_OF[mark] } }));
    if (rowId === 'steps') {
      const target = day?.steps ?? 0;
      return logSteps(date, mark === 'asPlanned' ? target : mark === 'partly' ? target / 2 : 0);
    }
    if (rowId === 'sleep') {
      const sl = day?.sleep;
      // no night in the plan: there is no "as planned" to log, so nothing is invented
      if (!sl) return { ok: false, message: 'Type the hours you slept.' };
      const target = (sl.wakeH - sl.bedH + 24) % 24;
      if (mark === 'skipped') return { ok: false, message: 'Type the hours you slept to log a short night.' };
      return logSleep(date, mark === 'asPlanned' ? target : target / 2);
    }
    if (rowId.startsWith('supplement:')) {
      if (mark !== 'asPlanned') return { ok: true };
      const id = rowId.slice(11);
      const s = day?.supplements.find((x) => x.supplementId === id);
      if (!s) return { ok: false, message: 'That supplement is not in today’s plan.' };
      // the planned dose by its identity: the log replaces that dose instead of being added to it (C2/D5-01)
      return run(dispatch('log.supplement', { date, supplementId: s.supplementId, dose: s.dose, unit: s.unit, itemId: s.itemId ?? `supplement:${s.supplementId}`, ...(s.clockH !== undefined ? { clockH: s.clockH } : {}) }));
    }
    return { ok: false, message: 'That row can’t be marked.' };
  };

  return {
    tick: (date, item: TodayChecklistItem) => {
      if (item.kind === 'weigh' || item.kind === 'measure') return Promise.resolve({ ok: false, message: 'Type your weight to log it.' });
      if (item.kind === 'mark') return markDay(date, 'asPlanned');
      return markRow(date, item.id, 'asPlanned');
    },
    markRow,
    answerMeal,
    markDay,
    confirmDayIntake: (date: LocalDate, intake: DayIntakeAttestation) => run(dispatch('log.confirmDay', { date, intake })),
    // D5-04: an unanswered weighing context stays unknown (never stamped "morning, fasted")
    logWeight: (date, kg) => run(dispatch('log.measurement', { date, metric: 'weightKg', value: kg, method: 'scale' })),
    logMeasurement: (date, m) => {
      return run(dispatch('log.measurement', { date, metric: m.metric, ...measurementValues(m), ...(m.method ? { method: m.method } : {}), ...measurementFacts(m) }));
    },
    logMeal: async (date, meal) => {
      const relogged = meal.relog ? await storedRelog(date, meal.relog) : null;
      return run(
        dispatch('log.meal', {
          date,
          // only a stated clock is an occurrence (the command fills a default clock itself and keeps the time date-only)
          ...(meal.clockStated ? { clockH: meal.clockH } : {}),
          ...(meal.slot ? { slot: meal.slot } : {}),
          ...(meal.text ? { text: meal.text } : {}),
          components: relogged ?? meal.components.map((c) => {
            if (c.foodId !== undefined || c.grams !== undefined || c.energyKcal === undefined) {
              return { name: c.name, ...(c.foodId !== undefined ? { foodId: c.foodId } : {}), ...(c.grams !== undefined ? { grams: c.grams } : {}) };
            }
            // numbers the person typed ("about 600 kcal, 30 g protein"): one portion carrying them; a macro not typed is
            // left out (unknown, never 0 g), so the energy stays exactly as typed (D6-02)
            return {
              name: c.name,
              grams: 100,
              labelPer100g: {
                energyKcal: c.energyKcal,
                ...(c.proteinG !== undefined ? { proteinG: c.proteinG } : {}),
                ...(c.carbG !== undefined ? { carbG: c.carbG } : {}),
                ...(c.fatG !== undefined ? { fatG: c.fatG } : {}),
              },
            };
          }),
          method: meal.asPlanned ? 'asPlanned' : 'typed',
        }),
      );
    },
    logSession: (date, s) =>
      run(
        dispatch('log.session', {
          date,
          slotKey: s.slotKey,
          status: s.status,
          performed: s.performed as never,
          ...(s.startH !== undefined ? { startH: s.startH } : {}),
          ...(s.durationMin !== undefined ? { durationMin: s.durationMin } : {}),
          ...(s.rpe !== undefined ? { rpe: s.rpe } : {}),
        }),
      ),
    logFastBroken: (date, atH) => run(dispatch('log.fast', { action: 'broken', firstIntakeAt: instantAt(date, atH) })),
    logFast: (lastIntakeAt, firstIntakeAt) => run(dispatch('log.fast', { action: 'record', lastIntakeAt, firstIntakeAt })),
    logSteps,
    logSleep,
    logSupplement: (date, supplementId, dose, unit) => run(dispatch('log.supplement', { date, supplementId, dose, unit })),
    logDifficulty: (date, difficulty) => run(dispatch('log.subjective', { date, difficulty })),
    retract: (entryId, keepEntryId) => run(dispatch('log.retract', { entryId, ...(keepEntryId ? { keepEntryId } : {}) })),
    backfill: (dates) => run(dispatch('log.bulk', { days: dates.map((date) => ({ date, entries: [] })) as never })),
    applyChange: (id) => {
      const v = parseProposalCardId(id);
      return v ? run(dispatch('plan.adoptVersion', v)) : Promise.resolve(NOT_YET);
    },
    discardChange: (id) => {
      const v = parseProposalCardId(id);
      return v ? run(dispatch('plan.rejectVersion', v)) : Promise.resolve(NOT_YET);
    },
    undoChange: () => Promise.resolve(NOT_YET),
    redoChange: () => Promise.resolve(NOT_YET),
    pause: (from, reason) => run(dispatch('plan.pause', { from, ...(reason ? { reason } : {}) })),
    resume: (on) => run(dispatch('plan.resume', { from: on })),
    end: async (typedWord) => {
      if (typedWord.trim().toLowerCase() !== 'end') return { ok: false, message: 'Type end to confirm.' };
      const input = { reason: 'abandoned' as const };
      return run(dispatch('plan.end', input, { confirmation: mintConfirmation('plan.end', input) }));
    },
    discard: async () => {
      const id = planId();
      if (!id) return { ok: false, message: 'There is no plan running.' };
      return run(dispatch('plan.discard', { planId: id }));
    },
    replanRest: async () => adaptOutcome(await dispatch('plan.replan', { reason: 'Re-plan the rest (same goals)' })),
    declareEvent: async (e) =>
      adaptOutcome(
        await dispatch('plan.declareEvent', {
          kind: e.kind,
          from: e.from,
          to: e.to,
          ...(e.note ? { note: e.note } : {}),
          ...(e.extraKcal !== undefined ? { extraKcal: e.extraKcal } : {}),
          ...(e.extraCarbG !== undefined ? { extraCarbG: e.extraCarbG } : {}),
        }),
      ),
    shift: async (x) =>
      adaptOutcome(
        await dispatch('plan.shift', {
          from: x.from,
          days: x.days,
          mode: x.mode,
          ...(x.withDate ? { withDate: x.withDate } : {}),
          ...(x.absorb ? { absorb: x.absorb } : {}),
          ...(x.replanRest !== undefined ? { replanRest: x.replanRest } : {}),
        }),
      ),
    swapExercise: async (date, s) => swapOutcome(await dispatch('plan.swapExercise', { date, slotKey: s.slotKey, from: s.from, to: s.to as never, everyWeek: !!s.everyWeek })),
    checkIn: (previewId) => previewId ? run(dispatch('plan.checkIn', { previewId })) : Promise.resolve({ ok: false, message: 'Review the check-in first.' }),
    setQuietMode: (on) => run(dispatch('settings.update', { patch: { quietMode: on } })),
    setAutoEase: () => Promise.resolve(NOT_YET),
  };
}
