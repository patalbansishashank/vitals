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
import type { LocalDate, Mark, TodayChecklistItem } from '@/living';
import { getActivePlanSource } from '../mode';
import type { ActionOutcome, LivingActions, RowMark } from './actions';
import { parseProposalCardId } from './documents';
import type { LivingDataSource } from './source';
import { ownsStream, type OwnedKind } from './useDeviceOwnership';

const NOT_YET: ActionOutcome = { ok: false, message: 'Not available yet.' };
/** A device feeds this stream: a hand entry would be refused, so it never gets dispatched (Correct is the way). */
const DEVICE_OWNED: ActionOutcome = { ok: false, message: 'This comes from your device. Use Correct to change it.' };
const owned = (k: OwnedKind) => ownsStream(k);
const MARK_OF: Record<RowMark, Mark> = { asPlanned: 'asPlanned', partly: 'partly', skipped: 'not' };
const STATUS_OF: Record<RowMark, 'done' | 'partial' | 'skipped'> = { asPlanned: 'done', partly: 'partial', skipped: 'skipped' };

/** A local wall time on a date as an instant (`h` may run past 24 or below 0). */
function instantAt(date: LocalDate, h: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setTime(d.getTime() + h * 3600_000);
  return d.toISOString();
}

/** The command's result as an outcome; undo retracts the entry it logged, else undoes its ChangeSet. */
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
  const logSteps = (date: LocalDate, steps: number) => (owned('steps') ? Promise.resolve(DEVICE_OWNED) : run(dispatch('log.steps', { date, steps: Math.max(0, Math.round(steps)) })));
  const logSleep = (date: LocalDate, hours: number) => {
    if (owned('sleep')) return Promise.resolve(DEVICE_OWNED);
    const wakeH = rx(date)?.sleep?.wakeH ?? 7;
    return run(dispatch('log.sleep', { bedAt: instantAt(date, wakeH - hours), wakeAt: instantAt(date, wakeH) }));
  };

  const markRow = async (date: LocalDate, rowId: string, mark: RowMark): Promise<ActionOutcome> => {
    const day = rx(date);
    if (rowId.startsWith('meal:')) {
      const slot = rowId.slice(5);
      const m = day?.meals.find((x) => x.slot === slot);
      if (mark === 'asPlanned') return run(dispatch('log.meal', { date, slot, ...(m ? { clockH: m.clockH } : {}), components: [], method: 'asPlanned' }));
      return run(dispatch('log.markDay', { date, marks: { food: MARK_OF[mark] } }));
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
      const target = sl ? (sl.wakeH - sl.bedH + 24) % 24 : 7.5;
      if (mark === 'skipped') return { ok: false, message: 'Type the hours you slept to log a short night.' };
      return logSleep(date, mark === 'asPlanned' ? target : target / 2);
    }
    if (rowId.startsWith('supplement:')) {
      if (mark !== 'asPlanned') return { ok: true };
      const id = rowId.slice(11);
      const s = day?.supplements.find((x) => x.supplementId === id);
      if (!s) return { ok: false, message: 'That supplement is not in today’s plan.' };
      return run(dispatch('log.supplement', { date, supplementId: s.supplementId, dose: s.dose, unit: s.unit, ...(s.clockH !== undefined ? { clockH: s.clockH } : {}) }));
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
    markDay,
    logWeight: (date, kg) => (owned('weight') ? Promise.resolve(DEVICE_OWNED) : run(dispatch('log.measurement', { date, metric: 'weightKg', value: kg, method: 'scale', context: 'morningFasted' }))),
    logMeasurement: (date, m) => {
      const value = m.repeats && m.repeats.length > 0 ? m.repeats.reduce((a, b) => a + b, 0) / m.repeats.length : m.value;
      return run(dispatch('log.measurement', { date, metric: m.metric, value, ...(m.method ? { method: m.method } : {}), ...(m.context ? { context: m.context } : {}) }));
    },
    logMeal: (date, meal) =>
      run(
        dispatch('log.meal', {
          date,
          clockH: meal.clockH,
          ...(meal.slot ? { slot: meal.slot } : {}),
          ...(meal.text ? { text: meal.text } : {}),
          components: meal.components.map((c) => {
            if (c.foodId !== undefined || c.grams !== undefined || c.energyKcal === undefined) {
              return { name: c.name, ...(c.foodId !== undefined ? { foodId: c.foodId } : {}), ...(c.grams !== undefined ? { grams: c.grams } : {}) };
            }
            // numbers the person typed ("about 600 kcal, 30 g protein"): one portion carrying them; unknown macros stay 0
            return { name: c.name, grams: 100, labelPer100g: { energyKcal: c.energyKcal, proteinG: c.proteinG ?? 0, carbG: c.carbG ?? 0, fatG: c.fatG ?? 0 } };
          }),
          method: meal.asPlanned ? 'asPlanned' : 'typed',
        }),
      ),
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
    retract: (entryId) => run(dispatch('log.retract', { entryId })),
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
    checkIn: () => run(dispatch('plan.checkIn', {})),
    setQuietMode: (on) => run(dispatch('settings.update', { patch: { quietMode: on } })),
    setAutoEase: () => Promise.resolve(NOT_YET),
  };
}
