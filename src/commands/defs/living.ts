/**
 * Living-plan commands (`plan.*`, `today.get`, `day.get`, `log.*`; SUITE_SPEC §1.9, §3): ids, permission classes,
 * surfaces and input schemas are fixed here; E5 implements the executors (they return `precondition_failed` with
 * `owner: 'E5'` until then).
 */
import { T } from '../schema';
import { defineCommand, getCommand } from '../registry';
import { ALL, UNDO, stub } from './_shared';

const OWNER = 'E5 (living plan)';
const UI = 'the Living-mode screens, E13';
const Id = T.String({ minLength: 1, maxLength: 64 });
const LocalDate = T.Date();
const ClockH = T.Number({ minimum: 0, maximum: 24 });
const Weekday = T.Integer({ minimum: 0, maximum: 6 });
const Empty = T.Object({});
const job = { kind: 'job' as const, softTimeoutMs: 25_000 };

const Intentions = T.Object({
  weighInClockH: T.Optional(ClockH),
  trainingWeekdays: T.Optional(T.Array(Weekday)),
  missedSessionPlan: T.Optional(T.Enum(['nextDay', 'skip', 'shorter'])),
});
/** §3.2 */
export const PlanStartInput = T.Object({
  source: T.Union([T.Object({ rung: T.String({ minLength: 1 }) }), T.Object({ scenarioId: Id })]),
  startDate: LocalDate,
  name: T.Optional(T.String({ maxLength: 60 })),
  intentions: T.Optional(Intentions),
  /** Weekly check-in day, 0 = Monday (default: the start date's weekday). */
  checkInWeekday: T.Optional(Weekday),
});
/** §3.6 */
export const PlanShiftInput = T.Object({
  from: LocalDate,
  days: T.Integer({ minimum: 1, maximum: 28 }),
  mode: T.Enum(['noTraining', 'habitual', 'pushBack', 'swap']),
  withDate: T.Optional(LocalDate),
  absorb: T.Optional(T.Object({ date: LocalDate, extraKcal: T.Optional(T.Number()), extraCarbG: T.Optional(T.Number()), note: T.Optional(T.String()) })),
  replanRest: T.Optional(T.Boolean()),
});
const DayTemplatePatch = T.OpenObject({ description: 'JSON merge patch over the day template.' });
const PerformedExercise = T.OpenObject({ description: 'PerformedExercise (catalogue, E8).' });

/* ---------------------------------------------------------------- plan.* */

stub({ id: 'plan.get', title: 'Read the plan', description: 'The running plan: name, rung, day N of M, status, head version and what today prescribes.', input: Empty, perm: 'read', owner: OWNER, uiOwner: UI });
stub({ id: 'plan.versions', title: 'Plan versions', description: 'Versions of the running plan (start, re-plans, events) with reason and status.', input: T.Object({ planId: T.Optional(Id) }), output: T.Array(T.OpenObject()), perm: 'read', owner: OWNER, uiOwner: UI });
stub({ id: 'plan.drift', title: 'Plan drift', description: 'Per goal: trend vs the forecast band, ahead / on track / behind, goal-date shift and the likely causes, with one suggested action.', input: Empty, perm: 'read', owner: OWNER, uiOwner: UI });
stub({ id: 'plan.adherence', title: 'Adherence', description: 'Daily adherence scores (0–100, with coverage), the 7-day and 28-day trend and days logged.', input: T.Object({ from: T.Optional(LocalDate), to: T.Optional(LocalDate) }), perm: 'read', owner: OWNER, uiOwner: UI });
stub({ id: 'plan.start', title: 'Start a plan', description: 'Start living a plan from a Planner rung or a Simulator scenario on a start date (today, tomorrow, next Monday or a date within 28 days).', input: PlanStartInput, perm: 'write', impact: 'consequential', undo: UNDO.CP('plan.discard'), idempotency: 'key', owner: OWNER, uiOwner: UI });
stub({ id: 'plan.discard', title: 'Discard a new plan', description: 'Undo starting a plan within 24 hours, before anything was logged.', input: T.Object({ planId: Id }), perm: 'write', impact: 'consequential', undo: UNDO.CP('plan.start'), idempotency: 'key', owner: OWNER, uiOwner: UI });
stub({ id: 'plan.pause', title: 'Pause the plan', description: 'Pause from a date (until a date or open-ended): paused days prescribe the habitual day; logs still count.', input: T.Object({ from: T.Optional(LocalDate), until: T.Optional(LocalDate), reason: T.Optional(T.String({ maxLength: 200 })) }), perm: 'write', impact: 'consequential', undo: UNDO.CP('plan.resume'), idempotency: 'natural', owner: OWNER, uiOwner: UI });
stub({ id: 'plan.resume', title: 'Resume the plan', description: 'Resume a paused plan: the remaining days shift by the pause and the end date moves.', input: T.Object({ from: T.Optional(LocalDate), until: T.Optional(LocalDate), reason: T.Optional(T.String({ maxLength: 200 })) }), perm: 'write', impact: 'consequential', undo: UNDO.CP('plan.pause'), idempotency: 'natural', owner: OWNER, uiOwner: UI });
stub({ id: 'plan.end', title: 'End the plan', description: 'End the running plan (completed, abandoned or for safety); restorable for 7 days.', input: T.Object({ reason: T.Enum(['completed', 'abandoned', 'replaced', 'safety']), note: T.Optional(T.String({ maxLength: 500 })) }), perm: 'destructive', undo: UNDO.CP('plan.start', 7 * 24 * 3600 * 1000), idempotency: 'key', owner: OWNER, uiOwner: UI });
stub({ id: 'plan.replace', title: 'Replace the plan', description: 'End the running plan and start another in its place.', input: T.Object({ source: T.Union([T.Object({ rung: T.String({ minLength: 1 }) }), T.Object({ scenarioId: Id })]), startDate: LocalDate, name: T.Optional(T.String({ maxLength: 60 })), intentions: T.Optional(Intentions), checkInWeekday: T.Optional(Weekday), reason: T.Literal('replaced') }), perm: 'destructive', undo: UNDO.CP('plan.start', 7 * 24 * 3600 * 1000), idempotency: 'key', owner: OWNER, uiOwner: UI });
stub({ id: 'plan.declareEvent', title: 'Declare an event', description: 'Tell the plan about days without training, illness, travel, a social meal or a busy stretch; returns a re-plan proposal with the goal-date impact.', input: T.Object({ kind: T.Enum(['noTraining', 'illness', 'travel', 'socialMeal', 'busy']), from: LocalDate, to: LocalDate, note: T.Optional(T.String({ maxLength: 500 })), extraKcal: T.Optional(T.Number({ minimum: 0, maximum: 3000, description: 'socialMeal: extra energy that day (default: the extra carbohydrate x 4).' })), extraCarbG: T.Optional(T.Number({ minimum: 0, maximum: 600, description: 'socialMeal: extra carbohydrate that day, g (default 150 when neither amount is given).' })) }), perm: 'write', impact: 'consequential', undo: UNDO.IP, idempotency: 'key', owner: OWNER, uiOwner: UI });
stub({ id: 'plan.checkIn', title: 'Weekly check-in', description: 'Run the weekly check-in: anchor the estimate to the weigh-ins, check drift and propose the weekly re-plan.', input: Empty, perm: 'write', surfaces: ['ui', 'ai'], excludedReason: { webmcp: 'the check-in runs in the app on its day', mcp: 'the check-in runs in the app on its day' }, undo: UNDO.CP('plan.rejectVersion'), idempotency: 'natural', owner: OWNER, uiOwner: UI });
stub({ id: 'plan.shift', title: 'Shift plan days', description: 'Make 1–28 days from a date training-free, habitual, pushed back or swapped with another date, optionally absorbing a known occasion; returns a proposal with the goal-date impact.', input: PlanShiftInput, perm: 'write', impact: 'consequential', undo: UNDO.IP, idempotency: 'key', owner: OWNER, uiOwner: UI });
stub({ id: 'plan.editDay', title: 'Edit a plan day', description: 'Change what a day prescribes (merge patch of the day template) for that day, that weekday or the rest of the plan; returns a proposal.', input: T.Object({ date: LocalDate, patch: DayTemplatePatch, scope: T.Enum(['day', 'weekday', 'rest']) }), perm: 'write', impact: 'consequential', undo: UNDO.IP, idempotency: 'key', owner: OWNER, uiOwner: UI });
stub({ id: 'plan.replan', title: 'Re-plan', description: 'Re-plan the rest of the running plan from today’s confirmed state; returns a proposal.', input: T.Object({ reason: T.Optional(T.String({ maxLength: 200 })), tier: T.Optional(T.Enum(['S', 'M', 'L', 'X'])) }), perm: 'write', impact: 'consequential', undo: UNDO.IP, idempotency: 'key', longRunning: job, owner: OWNER, uiOwner: UI });
stub({ id: 'plan.adoptVersion', title: 'Adopt a proposal', description: 'Adopt a proposed plan version.', input: T.Object({ planId: Id, version: T.Integer({ minimum: 1 }) }), perm: 'write', impact: 'consequential', undo: UNDO.CP('plan.rejectVersion'), idempotency: 'natural', owner: OWNER, uiOwner: UI });
stub({ id: 'plan.rejectVersion', title: 'Reject a proposal', description: 'Reject a proposed plan version (the plan stays as it was).', input: T.Object({ planId: Id, version: T.Integer({ minimum: 1 }) }), perm: 'write', impact: 'low', undo: UNDO.CP('plan.adoptVersion'), idempotency: 'natural', owner: OWNER, uiOwner: UI });
stub({ id: 'plan.swapExercise', title: 'Swap an exercise', description: 'Swap a prescribed exercise for another on a date; returns how equivalent the stimulus is.', input: T.Object({ date: LocalDate, slotKey: T.String({ minLength: 1 }), from: T.String({ minLength: 1 }), to: T.Union([T.String({ minLength: 1 }), PerformedExercise]), everyWeek: T.Optional(T.Boolean({ description: 'Use this swap on this weekday every week from this date on: returns a plan proposal.' })) }), perm: 'write', undo: UNDO.IP, idempotency: 'key', owner: OWNER, uiOwner: UI });

/* ---------------------------------------------------------------- today / day */

stub({ id: 'today.get', title: 'Today', description: 'Today’s prescription, what was logged, what remains (energy kcal, protein, carbohydrate, fat g), the checklist of one-tap actions, adherence, drift and notices.', input: T.Object({ date: T.Optional(LocalDate) }), perm: 'read', owner: OWNER, uiOwner: UI });
stub({ id: 'day.get', title: 'A day', description: 'One day’s record: prescription snapshot, entries, marks and score.', input: T.Object({ date: T.Optional(LocalDate) }), perm: 'read', owner: OWNER, uiOwner: UI });

/* ---------------------------------------------------------------- log.* (append-only; undo = retract) */

const MealComponentInput = T.Object({
  name: T.String({ minLength: 1, maxLength: 120 }),
  localName: T.Optional(T.String()),
  foodId: T.Optional(T.String()),
  recipeId: T.Optional(Id),
  grams: T.Optional(T.Number({ minimum: 0 })),
  gramsLow: T.Optional(T.Number({ minimum: 0 })),
  gramsHigh: T.Optional(T.Number({ minimum: 0 })),
  portion: T.Optional(T.Object({ unit: T.String(), count: T.Number({ minimum: 0 }) })),
  cookingMethod: T.Optional(T.String()),
  visibleFatCue: T.Optional(T.Enum(['none', 'some', 'glossy', 'pooled'])),
  labelPer100g: T.Optional(T.OpenObject({ description: 'Only transcribed labels or numbers the person typed.' })),
});
const Method = T.Enum(['typed', 'asPlanned', 'aiText', 'aiPhoto', 'aiPhotoUserGrams', 'label', 'dbMatch', 'biometrics', 'import', 'backfill']);
export const LogMealInput = T.Object({
  date: T.Optional(LocalDate),
  clockH: T.Optional(ClockH),
  slot: T.Optional(T.String()),
  text: T.Optional(T.String({ maxLength: 2000 })),
  components: T.Array(MealComponentInput, { maxItems: 40 }),
  method: Method,
  confidence: T.Optional(T.Number({ minimum: 0, maximum: 1 })),
  itemId: T.Optional(T.String()),
  attachmentIds: T.Optional(T.Array(Id)),
  complete: T.Optional(T.Boolean()),
});
export const LogSessionInput = T.Object({
  date: T.Optional(LocalDate),
  status: T.Enum(['done', 'partial', 'skipped']),
  slotKey: T.Optional(T.String()),
  startH: T.Optional(ClockH),
  durationMin: T.Optional(T.Number({ minimum: 0 })),
  performed: T.Array(PerformedExercise),
  rpe: T.Optional(T.Number({ minimum: 0, maximum: 10 })),
  bioWorkoutId: T.Optional(T.String()),
});
const logW = { perm: 'write' as const, impact: 'low' as const, undo: UNDO.RT, idempotency: 'key' as const, owner: OWNER, uiOwner: UI };

stub({ id: 'log.meal', title: 'Log a meal', description: 'Log a meal as components with grams (or portions); the app computes energy and nutrients with uncertainty bands. Never pass nutrients except from a label or the person.', input: LogMealInput, ...logW });
stub({ id: 'log.mealFromPhoto', title: 'Log a meal from a photo', description: 'Log a meal from an attached photo (and optional text): components are recognised, grams estimated, nutrients computed by the app.', input: T.Object({ attachmentId: Id, text: T.Optional(T.String({ maxLength: 2000 })), slot: T.Optional(T.String()), clockH: T.Optional(ClockH) }), ...logW });
stub({ id: 'log.bulk', title: 'Log several days', description: 'Log entries for up to 14 days at once (catching up).', input: T.Object({ days: T.Array(T.Object({ date: LocalDate, entries: T.Array(T.OpenObject()) }), { minItems: 1, maxItems: 14 }) }), output: T.Array(T.OpenObject()), ...logW, impact: 'consequential' });
stub({ id: 'log.session', title: 'Log a training session', description: 'Log a session (done, partial, skipped) with the exercises performed; returns how close it came to the prescribed stimulus.', input: LogSessionInput, ...logW });
stub({ id: 'log.fast', title: 'Log a fast', description: 'Start, end, break or record a fast (last intake and first intake instants).', input: T.Object({ action: T.Enum(['start', 'end', 'broken', 'record']), lastIntakeAt: T.Optional(T.Instant()), firstIntakeAt: T.Optional(T.Instant()) }), ...logW });
stub({ id: 'log.steps', title: 'Log steps', description: 'Steps for a day. If a device records this, your entry becomes a correction for the person to confirm.', input: T.Object({ date: T.Optional(LocalDate), steps: T.Integer({ minimum: 0, maximum: 200000 }) }), ...logW });
stub({ id: 'log.sleep', title: 'Log sleep', description: 'A night of sleep (bed and wake instants; the date is the wake date). If a device records this, your entry becomes a correction for the person to confirm.', input: T.Object({ bedAt: T.Instant(), wakeAt: T.Instant(), quality: T.Optional(T.Enum(['poor', 'fair', 'good'])) }), ...logW });
stub({ id: 'log.substance', title: 'Log caffeine or alcohol', description: 'Caffeine (mg), alcohol (drinks), creatine or exogenous ketones (g) at a clock hour.', input: T.Object({ date: T.Optional(LocalDate), substance: T.Enum(['caffeine', 'alcohol', 'creatine', 'exogenousKetones']), clockH: ClockH, amount: T.Number({ minimum: 0 }), unit: T.Enum(['mg', 'drinks', 'g']) }), ...logW });
stub({ id: 'log.supplement', title: 'Log a supplement', description: 'A supplement taken (catalogue id, dose and unit).', input: T.Object({ date: T.Optional(LocalDate), supplementId: T.String({ minLength: 1 }), dose: T.Number({ minimum: 0 }), unit: T.String(), clockH: T.Optional(ClockH) }), ...logW });
stub({ id: 'log.subjective', title: 'How today felt', description: 'How hard today was (1–5), hunger, energy, mood (0–10), stress, illness.', input: T.Object({ date: T.Optional(LocalDate), difficulty: T.Optional(T.Integer({ minimum: 1, maximum: 5 })), hunger: T.Optional(T.Number({ minimum: 0, maximum: 10 })), energy: T.Optional(T.Number({ minimum: 0, maximum: 10 })), mood: T.Optional(T.Number({ minimum: 0, maximum: 10 })), stress: T.Optional(T.Enum(['low', 'moderate', 'high'])), illness: T.Optional(T.Boolean()) }), ...logW });
stub({ id: 'log.note', title: 'Add a note', description: 'A free-text note on a day.', input: T.Object({ date: T.Optional(LocalDate), text: T.String({ minLength: 1, maxLength: 2000 }) }), ...logW });
/** `log.measurement`'s metric ids (the unit is part of the id). Agents guessed `weight`; the schema now lists them. */
export const MEASUREMENT_METRICS = ['weightKg', 'waistCm', 'hipCm', 'neckCm', 'chestCm', 'armCm', 'thighCm', 'bodyFatPct', 'sbpMmHg', 'dbpMmHg', 'ketonesMmolL', 'glucoseMmolL', 'ldlMmolL', 'hdlMmolL', 'tgMmolL', 'apoBgL', 'fastingGlucoseMmolL', 'hba1cPct', 'crpMgL'] as const;
stub({ id: 'log.measurement', title: 'Log a measurement', description: 'A weigh-in or measurement (weight kg, girths cm, body fat %, blood pressure, glucose or ketones mmol/L) with context and method; updates the trend filter. If a device records this, your entry becomes a correction for the person to confirm.', input: T.Object({ date: T.Optional(LocalDate), metric: T.Enum([...MEASUREMENT_METRICS], { description: 'Metric id, unit in the name: weightKg (not "weight"), waistCm, hipCm, neckCm, chestCm, armCm, thighCm, bodyFatPct, sbpMmHg, dbpMmHg, ketonesMmolL, glucoseMmolL, ldlMmolL, hdlMmolL, tgMmolL, apoBgL, fastingGlucoseMmolL, hba1cPct, crpMgL.' }), value: T.Number(), unit: T.Optional(T.String()), context: T.Optional(T.Enum(['morningFasted', 'evening', 'postWorkout', 'unknown'])), method: T.Optional(T.Enum(['scale', 'tape', 'dxa', 'bia', 'skinfold', 'navy', 'lab', 'meter'])) }), ...logW });
stub({ id: 'log.markDay', title: 'Mark a day', description: 'Mark food, training, fast or the whole day as planned, partly or not.', input: T.Object({ date: LocalDate, marks: T.Object({ food: T.Optional(T.Enum(['asPlanned', 'partly', 'not'])), train: T.Optional(T.Enum(['asPlanned', 'partly', 'not'])), fast: T.Optional(T.Enum(['asPlanned', 'partly', 'not'])), all: T.Optional(T.Enum(['asPlanned', 'partly', 'not'])) }) }), perm: 'write', impact: 'low', undo: UNDO.IP, idempotency: 'natural', owner: OWNER, uiOwner: UI });
stub({ id: 'log.confirmDay', title: 'Confirm a day', description: 'Confirm a day as complete (its score becomes final).', input: T.Object({ date: LocalDate }), perm: 'write', impact: 'low', undo: UNDO.IP, idempotency: 'natural', owner: OWNER, uiOwner: UI });
stub({ id: 'log.edit', title: 'Edit an entry', description: 'Edit a logged entry (a new entry supersedes it). The patch may change only the fields its logging command takes (for example steps, or amount and clock hour); for a meal or session: date, clock hour, slot, status, duration or effort.', input: T.Object({ entryId: Id, patch: T.OpenObject() }), ...logW });
stub({ id: 'log.retract', title: 'Remove an entry', description: 'Remove a logged entry (a retract entry; restorable).', input: T.Object({ entryId: Id }), ...logW });
stub({ id: 'log.get', title: 'Read the log', description: 'Logged entries between two dates, optionally by kind.', input: T.Object({ from: LocalDate, to: LocalDate, kinds: T.Optional(T.Array(T.String())) }), output: T.Array(T.OpenObject()), perm: 'read', owner: OWNER, uiOwner: UI });
const DeviceStream = T.Enum(['steps', 'sleep_sessions', 'workouts']);
const FromBiometricsOutput = T.Object({
  date: LocalDate,
  created: T.Array(T.Object({
    entryId: Id,
    kind: T.Enum(['steps', 'sleep', 'session']),
    stream: DeviceStream,
    key: T.String({ description: 'Natural key: date and stream (and the workout record).' }),
    recordId: T.String(),
    source: T.String({ description: 'The device or file the value came from.' }),
    supersedes: T.Optional(Id),
    steps: T.Optional(T.Integer({ minimum: 0 })),
    bedAt: T.Optional(T.Instant()),
    wakeAt: T.Optional(T.Instant()),
    exerciseType: T.Optional(T.String()),
    startH: T.Optional(ClockH),
    durationMin: T.Optional(T.Number({ minimum: 0 })),
    activeKcal: T.Optional(T.Number({ minimum: 0 })),
  }), { description: 'Entries written (source device); each can be removed with log.retract.' }),
  skipped: T.Array(T.Object({
    stream: DeviceStream,
    key: T.String(),
    recordId: T.String(),
    reason: T.Enum(['userEntry', 'unchanged', 'removed'], { description: 'userEntry: the person logged this item themselves (their entry wins); unchanged: already logged from the device; removed: the person removed the device entry.' }),
    entryId: T.Optional(Id),
  })),
  notOptedIn: T.Array(DeviceStream, { description: 'Streams with data that the person does not let their plan use (Settings › Devices).' }),
});
stub({ id: 'log.fromBiometrics', title: 'Log the day from devices', description: 'Log a day’s steps, sleep (the night ending that day) and workouts from the device streams the person lets their plan use. Re-running updates the device entries without duplicating them; anything the person logged for the same item wins and is listed as skipped.', input: T.Object({ date: T.Optional(LocalDate) }), output: FromBiometricsOutput, perm: 'write', impact: 'low', undo: UNDO.RT, idempotency: 'natural', surfaces: ALL, owner: OWNER, uiOwner: UI });

/** The Living screens call these (features/living/data/commands.ts, start/StartPlanSheet.tsx): drop "no screen calls it yet". */
function onScreen(...ids: string[]): void {
  for (const id of ids) {
    const d = getCommand(id);
    if (!d?.excludedReason?.ui) continue;
    const { ui: _ui, ...rest } = d.excludedReason;
    void _ui;
    defineCommand({ ...d, excludedReason: rest });
  }
}
onScreen(
  'plan.start', 'plan.replace', 'plan.discard', 'plan.pause', 'plan.resume', 'plan.end', 'plan.replan', 'plan.checkIn', 'plan.adoptVersion', 'plan.rejectVersion',
  'plan.declareEvent', 'plan.shift', 'plan.swapExercise',
  'log.markDay', 'log.meal', 'log.session', 'log.fast', 'log.steps', 'log.sleep', 'log.supplement', 'log.subjective', 'log.measurement', 'log.retract', 'log.bulk',
);
