/**
 * The write side of Living mode. Every logging tap and plan change goes through `LivingActions`. The app installs the
 * command-backed actions (`./commands.ts`, literal command ids) together with the document-backed read side
 * (`./documents.ts`); tests and demos mount the in-memory stand-in (`./stub`) for both sides, so reads and writes never
 * disagree.
 */
import { createContext, useContext } from 'react';
import type { DayIntakeAttestation } from '@/lib/bodyContracts';
import type { LocalDate, Mark, MeasurementEntry, TodayChecklistItem } from '@/living';
import type { PerformedExercise } from '@/catalogues';

export interface ActionOutcome {
  ok: boolean;
  /**
   * Plain-language reason when not ok ("This weigh-in is outside 30–300 kg."). Plan changes also say what happened when
   * ok ("A proposal is waiting on Today.").
   */
  message?: string;
  /** Reverses the action (tap-again-within-5-s, toast Undo). */
  undo?: () => Promise<ActionOutcome>;
  /** The change card a plan change left waiting for the person (it shows on Today). */
  proposalId?: string;
  /** Exercise swaps: the share of the prescribed stimulus the swap keeps (0–1). */
  credit?: number;
}

/** "I'm busy or away…": days the plan should know about (busy, travel, illness, no training, a meal out). */
export interface PlanEventInput {
  kind: 'busy' | 'travel' | 'illness' | 'noTraining' | 'socialMeal';
  from: LocalDate;
  to: LocalDate;
  note?: string;
  /** A meal out: the extra energy (kcal) or carbohydrate (g); the plan assumes about 150 g carbohydrate otherwise. */
  extraKcal?: number;
  extraCarbG?: number;
}

/** Shift plan days (§3.6): 1–28 days from a date made training-free, habitual, pushed back or swapped with another date. */
export interface PlanShiftInput {
  from: LocalDate;
  days: number;
  mode: 'noTraining' | 'habitual' | 'pushBack' | 'swap';
  withDate?: LocalDate;
  /** A known occasion the plan should make room for. */
  absorb?: { date: LocalDate; extraKcal?: number; extraCarbG?: number; note?: string };
  /** false: only those days change (default: the rest is re-planned around them). */
  replanRest?: boolean;
}

/** Swap a prescribed exercise on a date; `everyWeek` makes it a proposal for that weekday from then on. */
export interface ExerciseSwapInput {
  slotKey: string;
  /** The prescribed exercise. */
  from: string;
  /** The exercise used instead (catalogue id or what was done). */
  to: string | PerformedExercise;
  everyWeek?: boolean;
}

/** Row-sheet outcome (T1): as planned · partly · skipped. "Something else" opens the item editor instead. */
export type RowMark = 'asPlanned' | 'partly' | 'skipped';

/** One serving of the meal's accepted recipe: what "as planned" logs instead of the slot's own plan (its own numbers). */
export interface MealServing {
  name: string;
  energyKcal: number;
  proteinG: number;
  /** Available carbohydrate, g (catalogue convention: fibre excluded). */
  carbG: number;
  fatG: number;
  /** Fibre, g, when the recipe gives it (absent = unknown, never 0). */
  fibreG?: number;
}

/** How one meal went (`LivingActions.answerMeal`). */
export interface MealAnswerInput {
  slot: string;
  mark: RowMark;
  /** The entries logged for the meal as the person saw them (the sheet's, the row's): the answer replaces them. */
  replaces: readonly string[];
  /** "As planned" is one serving of the accepted recipe, not the slot's own plan. */
  serving?: MealServing;
}

export interface ManualMealInput {
  slot?: string;
  clockH: number;
  /**
   * (C1/D5-05) True only when the person stated `clockH` (a time they chose). Otherwise it is a default — the slot's planned
   * clock, the current hour, noon for another day — and the meal's occurrence stays date-only: a default clock never ends
   * a fast at a guessed time.
   */
  clockStated?: boolean;
  /**
   * (D6-02/C3) Log stored meals again ("same as yesterday", recents): their stored components are relogged by food/recipe id
   * and grams or their frozen per-100 g numbers (unknown fields stay unknown), not as energy only. `date` = the day the
   * entries were logged on (absent = the week before the logging date). `components` stays the fallback when they are gone.
   */
  relog?: { date?: LocalDate; entryIds: readonly string[] };
  /** What was eaten, as typed or picked. */
  components: Array<{ name: string; foodId?: string; grams?: number; energyKcal?: number; proteinG?: number; carbG?: number; fatG?: number }>;
  /** "as planned" logs (I ate this) carry the prescribed slot's numbers with the as-planned band. */
  asPlanned?: boolean;
  text?: string;
}

export interface SessionLogInput {
  slotKey: string;
  status: 'done' | 'partial' | 'skipped';
  performed: PerformedExercise[];
  /** Adherence credit the equivalence computed (catalogue `sessionEquivalence`), when the UI has it. */
  credit?: number;
  startH?: number;
  durationMin?: number;
  rpe?: number;
  note?: string;
}

export interface MeasurementInput {
  metric: MeasurementEntry['metric'];
  value: number;
  repeats?: number[];
  /** New UI lists are exhaustive; explicit primaryPlusAdditional keeps value as the primary reading. */
  repeatsEncoding?: MeasurementEntry['repeatsEncoding'];
  method?: MeasurementEntry['method'];
  /** Absent = unknown context (D5-04): never stamped "morning, fasted". */
  context?: MeasurementEntry['context'];
  /** (C4) optional protocol facts, passed through to `log.measurement`; absent = unknown. */
  landmark?: MeasurementEntry['landmark'];
  /** (D4-05) blood-pressure sitting: pairs systolic with diastolic and repeats. */
  episodeId?: string;
  restMin?: number;
  setting?: MeasurementEntry['setting'];
  timeOfDay?: MeasurementEntry['timeOfDay'];
  /** (D2-08) ketone specimen: urine or breath never become blood BHB. */
  specimen?: MeasurementEntry['specimen'];
  /** (D7-06/D7-09) hours fasted before a lab sample; absent = fasting unknown. */
  fastingHours?: number;
}

/** Store the raw repeat list with its encoding; never fold a primary into an additional-list encoding. */
export function measurementValues(m: MeasurementInput): Pick<MeasurementEntry, 'value' | 'repeats' | 'repeatsEncoding'> {
  if (!m.repeats?.length) return { value: m.value };
  const repeatsEncoding = m.repeatsEncoding ?? 'fullRawList';
  return {
    value: repeatsEncoding === 'fullRawList' ? m.repeats.reduce((sum, value) => sum + value, 0) / m.repeats.length : m.value,
    repeats: [...m.repeats],
    repeatsEncoding,
  };
}

/** The optional protocol facts of a `MeasurementInput`, as given (absent fields stay absent). */
export function measurementFacts(m: MeasurementInput): Partial<Pick<MeasurementEntry, 'context' | 'landmark' | 'episodeId' | 'restMin' | 'setting' | 'timeOfDay' | 'specimen' | 'fastingHours'>> {
  const out: Partial<Pick<MeasurementEntry, 'context' | 'landmark' | 'episodeId' | 'restMin' | 'setting' | 'timeOfDay' | 'specimen' | 'fastingHours'>> = {};
  if (m.context) out.context = m.context;
  if (m.landmark) out.landmark = m.landmark;
  if (m.episodeId) out.episodeId = m.episodeId;
  if (m.restMin !== undefined && Number.isFinite(m.restMin)) out.restMin = m.restMin;
  if (m.setting) out.setting = m.setting;
  if (m.timeOfDay) out.timeOfDay = m.timeOfDay;
  if (m.specimen) out.specimen = m.specimen;
  if (m.fastingHours !== undefined && Number.isFinite(m.fastingHours)) out.fastingHours = m.fastingHours;
  return out;
}

export interface LivingActions {
  /** T0: one tap on a checklist row = "as planned" (dispatches the row's own command). */
  tick(date: LocalDate, item: TodayChecklistItem): Promise<ActionOutcome>;
  /** T1: the row sheet (as planned · partly · skipped) for a checklist row. A meal row answers through `answerMeal`. */
  markRow(date: LocalDate, rowId: string, mark: RowMark): Promise<ActionOutcome>;
  /**
   * How a meal went, for every way in (the meal sheet, Today's tick, Food's row key), as one change that replaces what
   * the slot holds: "as planned" logs the slot's planned meal (or one serving of the accepted recipe) in place of the
   * food logged for it; partly and skipped remove that food and keep the meal's own answer, with no invented amount.
   * Nothing else changes (other meals, the day's marks); a stale `replaces` is refused whole. Undo restores exactly
   * what the slot held. "Add more" stays `logMeal`, which appends.
   */
  answerMeal(date: LocalDate, answer: MealAnswerInput): Promise<ActionOutcome>;
  /** T0: "Mark day as planned" (or partly / not). */
  markDay(date: LocalDate, mark: Mark): Promise<ActionOutcome>;
  /**
   * (C1/D5-01) The day's food report: everything logged with amounts (complete), some of it (partial) or nothing eaten
   * (none, a confirmed zero, never "skipped"). Meal count or a meal's own "complete" never says this. Optional while the
   * in-memory stand-in lacks it.
   */
  confirmDayIntake?(date: LocalDate, intake: DayIntakeAttestation): Promise<ActionOutcome>;
  logWeight(date: LocalDate, kg: number): Promise<ActionOutcome>;
  logMeal(date: LocalDate, meal: ManualMealInput): Promise<ActionOutcome>;
  logSession(date: LocalDate, input: SessionLogInput): Promise<ActionOutcome>;
  logFastBroken(date: LocalDate, atH: number): Promise<ActionOutcome>;
  /** A whole fast typed by hand (`log.fast` record): last intake and first intake instants (ISO). Any day, prescribed fast or not. */
  logFast(lastIntakeAt: string, firstIntakeAt: string): Promise<ActionOutcome>;
  logSteps(date: LocalDate, steps: number): Promise<ActionOutcome>;
  logSleep(date: LocalDate, hours: number): Promise<ActionOutcome>;
  logSupplement(date: LocalDate, supplementId: string, dose: number, unit: string): Promise<ActionOutcome>;
  logDifficulty(date: LocalDate, difficulty: 1 | 2 | 3 | 4 | 5): Promise<ActionOutcome>;
  logMeasurement(date: LocalDate, m: MeasurementInput): Promise<ActionOutcome>;
  /** `keepEntryId` guards a conflict choice against a stale notice. */
  retract(entryId: string, keepEntryId?: string): Promise<ActionOutcome>;
  /** Welcome back: fill missed days "as planned" (assumed, never scored). */
  backfill(dates: readonly LocalDate[]): Promise<ActionOutcome>;
  /** Change cards (Today proposals, applied automatic changes, Coach cards). */
  applyChange(id: string): Promise<ActionOutcome>;
  discardChange(id: string): Promise<ActionOutcome>;
  undoChange(id: string): Promise<ActionOutcome>;
  redoChange(id: string): Promise<ActionOutcome>;
  /** Plan lifecycle. `end` and `replace` need the typed word from the confirmation dialog. */
  pause(from: LocalDate, reason?: string): Promise<ActionOutcome>;
  resume(on: LocalDate): Promise<ActionOutcome>;
  end(typedWord: string): Promise<ActionOutcome>;
  discard(): Promise<ActionOutcome>;
  /** "Re-plan the rest (same goals)": a `plan.replan` job → a proposal card on Today. */
  replanRest(): Promise<ActionOutcome>;
  /** "I'm busy or away…": a `plan.declareEvent` → a proposal card on Today (or applied at once when it only eases). */
  declareEvent(input: PlanEventInput): Promise<ActionOutcome>;
  /** "Push the plan back by these days": a `plan.shift` → a proposal card on Today (or applied when it only eases). */
  shift(input: PlanShiftInput): Promise<ActionOutcome>;
  /** Train: a swap for the day (kept on the day's record) or for that weekday every week (a proposal card). */
  swapExercise(date: LocalDate, input: ExerciseSwapInput): Promise<ActionOutcome>;
  checkIn(previewId: string): Promise<ActionOutcome>;
  setQuietMode(on: boolean): Promise<ActionOutcome>;
  setAutoEase(on: boolean): Promise<ActionOutcome>;
}

const Ctx = createContext<LivingActions | null>(null);
export const LivingActionsProvider = Ctx.Provider;

let fallbackActions: LivingActions | null = null;
export function setDefaultLivingActions(a: LivingActions): void {
  fallbackActions = a;
}

export function useLivingActions(): LivingActions {
  const a = useContext(Ctx) ?? fallbackActions;
  if (!a) throw new Error('No living actions installed');
  return a;
}

/** The installed actions, or null where none are (a face rendered on its own, without the living data layer). */
export function useOptionalLivingActions(): LivingActions | null {
  return useContext(Ctx) ?? fallbackActions;
}
