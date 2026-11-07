/**
 * Living-plan commands (`plan.*`, `today.get`, `day.get`, `log.*`; SUITE_SPEC §1.9, §3): ids, permission classes,
 * surfaces and input schemas are fixed here; E5 implements the executors (they return `precondition_failed` with
 * `owner: 'E5'` until then).
 */
import { T } from '../schema';
import { defineCommand, getCommand } from '../registry';
import { UNDO, stub } from './_shared';
import { ACTIVE_BASES, DAY_INTAKE_ATTESTATIONS, EXPOSURE_IDS, SUBSTANCE_UNITS } from '@/lib/bodyContracts';

/*
 * 2026-10-18 body-model contracts (C1–C7): every addition below is an optional input field, so existing callers and
 * fixtures stay valid. Occurrence time (`occurredAt`) is separate from the command's recording time; unknown stays
 * unknown (no noon default, no zero); explicit item identity (`itemId`/`extra`) replaces nearest-time matching; the
 * substance unit must be one `SUBSTANCE_UNITS` allows (executors call `normalizeSubstanceDose`, which rejects other pairs).
 */

const OWNER = 'E5 (living plan)';
const GAUGE_ONLY = 'the app imports the ring data by itself; agents read it with the gauge_* tools';
const UI = 'the Living-mode screens, E13';
const Id = T.String({ minLength: 1, maxLength: 64 });
const LocalDate = T.Date();
const ClockH = T.Number({ minimum: 0, maximum: 24 });
const Weekday = T.Integer({ minimum: 0, maximum: 6 });
const Empty = T.Object({});
const job = { kind: 'job' as const, softTimeoutMs: 25_000 };
/** (C1) When it happened, if known (an instant with offset); omitted = the time is not known (it is never guessed). */
const OccurredAt = T.Optional(T.Instant({ description: 'When it happened, if known (ISO instant with offset). Leave out when not known: the time is then kept unknown, never guessed.' }));
const Rating10 = T.Number({ minimum: 0, maximum: 10 });

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
  enforceDefaultDeficitCap: T.Optional(T.Boolean({ description: 'Default true. False disables only the general adult 25% deficit preset; medical restrictions and other plan checks remain enforced.' })),
  experimentalTracking: T.Optional(T.Boolean({ description: 'Explicitly track a user-selected Simulator scenario with preset-policy warnings retained. This is experimental, not a verified prescription; current medical restrictions still block.' })),
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
stub({ id: 'plan.drift', title: 'Plan drift', description: 'Per goal: trend vs the forecast on the same measure (kg range), ahead / on track / behind / unclear, goal-date shift, the logged intake difference and the unexplained balance residual, with one suggested action. Causes are not inferred.', input: Empty, perm: 'read', owner: OWNER, uiOwner: UI });
stub({ id: 'plan.adherence', title: 'Adherence', description: 'Daily adherence scores (0–100, with coverage), the 7-day and 28-day trend and days logged.', input: T.Object({ from: T.Optional(LocalDate), to: T.Optional(LocalDate) }), perm: 'read', owner: OWNER, uiOwner: UI });
stub({ id: 'plan.start', title: 'Start a plan', description: 'Start living a plan from a Planner rung or a Simulator scenario on a start date (today, tomorrow, next Monday or a date within 28 days).', input: PlanStartInput, perm: 'write', impact: 'consequential', undo: UNDO.CP('plan.discard'), idempotency: 'key', owner: OWNER, uiOwner: UI });
stub({ id: 'plan.discard', title: 'Discard a new plan', description: 'Undo starting a plan within 24 hours, before anything was logged.', input: T.Object({ planId: Id }), perm: 'write', impact: 'consequential', undo: UNDO.CP('plan.start'), idempotency: 'key', owner: OWNER, uiOwner: UI });
stub({ id: 'plan.pause', title: 'Pause the plan', description: 'Pause from a date (until a date or open-ended): paused days prescribe the habitual day; logs still count.', input: T.Object({ from: T.Optional(LocalDate), until: T.Optional(LocalDate), reason: T.Optional(T.String({ maxLength: 200 })) }), perm: 'write', impact: 'consequential', undo: UNDO.CP('plan.resume'), idempotency: 'natural', owner: OWNER, uiOwner: UI });
stub({ id: 'plan.resume', title: 'Resume the plan', description: 'Resume a paused plan: the remaining days shift by the pause and the end date moves.', input: T.Object({ from: T.Optional(LocalDate), until: T.Optional(LocalDate), reason: T.Optional(T.String({ maxLength: 200 })) }), perm: 'write', impact: 'consequential', undo: UNDO.CP('plan.pause'), idempotency: 'natural', owner: OWNER, uiOwner: UI });
stub({ id: 'plan.end', title: 'End the plan', description: 'End the running plan (completed, abandoned or for safety); restorable for 7 days.', input: T.Object({ reason: T.Enum(['completed', 'abandoned', 'replaced', 'safety']), note: T.Optional(T.String({ maxLength: 500 })) }), perm: 'destructive', undo: UNDO.CP('plan.start', 7 * 24 * 3600 * 1000), idempotency: 'key', owner: OWNER, uiOwner: UI });
stub({ id: 'plan.replace', title: 'Replace the plan', description: 'End the running plan and start another in its place.', input: T.Object({ source: T.Union([T.Object({ rung: T.String({ minLength: 1 }) }), T.Object({ scenarioId: Id })]), startDate: LocalDate, name: T.Optional(T.String({ maxLength: 60 })), enforceDefaultDeficitCap: T.Optional(T.Boolean()), experimentalTracking: T.Optional(T.Boolean()), intentions: T.Optional(Intentions), checkInWeekday: T.Optional(Weekday), reason: T.Literal('replaced') }), perm: 'destructive', undo: UNDO.CP('plan.start', 7 * 24 * 3600 * 1000), idempotency: 'key', owner: OWNER, uiOwner: UI });
stub({ id: 'plan.declareEvent', title: 'Declare an event', description: 'Tell the plan about days without training, illness, travel, a social meal or a busy stretch; returns a re-plan proposal with the goal-date impact.', input: T.Object({ kind: T.Enum(['noTraining', 'illness', 'travel', 'socialMeal', 'busy']), from: LocalDate, to: LocalDate, note: T.Optional(T.String({ maxLength: 500 })), extraKcal: T.Optional(T.Number({ minimum: 0, maximum: 3000, description: 'socialMeal: extra energy that day (default: the extra carbohydrate x 4).' })), extraCarbG: T.Optional(T.Number({ minimum: 0, maximum: 600, description: 'socialMeal: extra carbohydrate that day, g (default 150 when neither amount is given).' })) }), perm: 'write', impact: 'consequential', undo: UNDO.IP, idempotency: 'key', owner: OWNER, uiOwner: UI });
stub({ id: 'plan.checkIn', title: 'Weekly check-in', description: 'Run the weekly check-in: anchor the estimate to the weigh-ins, check drift and propose the weekly re-plan. Confirms the check-in once; previewId names the prepared preview being confirmed.', input: T.Object({ previewId: T.Optional(Id) }), perm: 'write', surfaces: ['ui', 'ai'], excludedReason: { webmcp: 'the check-in runs in the app on its day', mcp: 'the check-in runs in the app on its day' }, undo: UNDO.CP('plan.rejectVersion'), idempotency: 'natural', owner: OWNER, uiOwner: UI });
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
  labelPer100g: T.Optional(T.OpenObject({ description: 'Only transcribed labels or numbers the person typed. Leave out values the label does not give (unknown is not zero).' })),
  /** (D6-06) how the amount was obtained; numeric grams alone never mean weighed. */
  amountMethod: T.Optional(T.Enum(['weighed', 'labelServing', 'household', 'userEstimated', 'photoEstimated', 'unknown'])),
  /** (D6-01) carbohydrate basis of labelPer100g.carbG. */
  carbBasis: T.Optional(T.Enum(['totalByDifference', 'available', 'monosaccharideEquivalent', 'unknown'], { description: 'What the label carbohydrate means: total (includes fibre), available (fibre already excluded), or unknown.' })),
  /** (D6-04) share of a recipe's batch eaten, when its cooked yield is unknown. */
  batchFraction: T.Optional(T.Number({ exclusiveMinimum: 0, maximum: 1 })),
  /** (D6-05) relog only: the stored serving's frozen composition, cloned ("same as yesterday"). */
  fromSnapshot: T.Optional(T.OpenObject({ description: 'App relog only: frozen per-100 g composition { source, id, version?, per100g, recipeServing?, imputed? } of a stored serving. Never invent one.' })),
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
  /** This meal is fully logged (meal-level only; it never means the whole day is logged). */
  complete: T.Optional(T.Boolean()),
  occurredAt: OccurredAt,
  /** (C2) an explicit extra occurrence beside the planned meals (not a replacement of a planned slot). */
  extra: T.Optional(T.Boolean()),
  /** (D6-07) eating duration, h, and physical form when known. */
  intakeDurationH: T.Optional(T.Number({ minimum: 0, maximum: 12 })),
  form: T.Optional(T.Enum(['solid', 'liquid', 'mixed', 'unknown'])),
  /** (D6-07) carbohydrate mixture of the meal, g, when known. */
  carbComposition: T.Optional(T.Object({ glucoseEqG: T.Optional(T.Number({ minimum: 0 })), fructoseG: T.Optional(T.Number({ minimum: 0 })), galactoseG: T.Optional(T.Number({ minimum: 0 })), unknownG: T.Optional(T.Number({ minimum: 0 })) })),
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
  occurredAt: OccurredAt,
  /** (D3-07) locomotor steps of this session that are inside the day's total step count. */
  stepsIncluded: T.Optional(T.Integer({ minimum: 0, maximum: 100000 })),
});
const logW = { perm: 'write' as const, impact: 'low' as const, undo: UNDO.RT, idempotency: 'key' as const, owner: OWNER, uiOwner: UI };

stub({ id: 'log.meal', title: 'Log a meal', description: 'Log a meal as components with grams (or portions); the app computes energy and nutrients with uncertainty bands. Never pass nutrients except from a label or the person.', input: LogMealInput, ...logW });
stub({ id: 'log.mealFromPhoto', title: 'Log a meal from a photo', description: 'Log a meal from an attached photo (and optional text): components are recognised, grams estimated, nutrients computed by the app.', input: T.Object({ attachmentId: Id, text: T.Optional(T.String({ maxLength: 2000 })), slot: T.Optional(T.String()), clockH: T.Optional(ClockH) }), ...logW });
stub({ id: 'log.bulk', title: 'Log several days', description: 'Log entries for up to 14 days at once (catching up).', input: T.Object({ days: T.Array(T.Object({ date: LocalDate, entries: T.Array(T.OpenObject()) }), { minItems: 1, maxItems: 14 }) }), output: T.Array(T.OpenObject()), ...logW, impact: 'consequential' });
stub({ id: 'log.session', title: 'Log a training session', description: 'Log a session (done, partial, skipped) with the exercises performed; returns how close it came to the prescribed stimulus.', input: LogSessionInput, ...logW });
stub({ id: 'log.fast', title: 'Log a fast', description: 'Start, end, break or record a fast (last intake and first intake instants).', input: T.Object({ action: T.Enum(['start', 'end', 'broken', 'record']), lastIntakeAt: T.Optional(T.Instant()), firstIntakeAt: T.Optional(T.Instant()), protocol: T.Optional(T.Enum(['zeroCalorie', 'modified'], { description: 'Water-only (no calories) or a modified fast with some permitted intake.' })) }), ...logW });
stub({ id: 'log.steps', title: 'Log steps', description: 'Steps for a day. If a device records this, your entry becomes a correction for the person to confirm.', input: T.Object({ date: T.Optional(LocalDate), steps: T.Integer({ minimum: 0, maximum: 200000 }), scope: T.Optional(T.Enum(['totalDay', 'excludesTraining', 'unknown'], { description: 'Whether the count includes the steps of training sessions.' })) }), ...logW });
stub({
  id: 'log.sleep',
  title: 'Log sleep',
  description: 'A night of sleep (bed and wake instants; the date is the wake date). Optional: when the lights went out and when the person got out of bed (they unlock real sleep latency and efficiency). If a device records this, your entry becomes a correction for the person to confirm.',
  input: T.Object({
    bedAt: T.Instant(),
    wakeAt: T.Instant(),
    quality: T.Optional(T.Enum(['poor', 'fair', 'good'])),
    restfulness: T.Optional(Rating10),
    episodeKind: T.Optional(T.Enum(['main', 'nap'])),
    // (energy SPEC §V3.6, D11) the person's own diary times; the ring never supplies them
    lightsOutAt: T.Optional(T.Instant({ description: 'When the lights went out (the person’s own time).' })),
    outOfBedAt: T.Optional(T.Instant({ description: 'When the person got out of bed (the person’s own time).' })),
  }),
  ...logW,
});
// (energy SPEC §V3.6, D11, D21) the diary times on their own: Today's "Going to sleep" / "I'm up" and the sleep page's
// "Add lights-out time". A ring-imported night keeps its source and its bed and wake times (it never becomes the
// person's correction); before the night has arrived the times wait on the waking date and join it when it does.
stub({
  id: 'log.sleepTimes',
  title: 'Log lights-out or getting up',
  description:
    'When the lights went out and when the person got out of bed, for the night ending on date (the wake date). Leave a field out to keep it; null clears it. The night itself (bed and wake times, a ring night’s source) does not change; if the night is not in yet, the times wait for it.',
  input: T.Object({
    date: LocalDate,
    lightsOutAt: T.Optional(T.Nullable(T.Instant({ description: 'When the lights went out (the person’s own time); null clears it.' }))),
    outOfBedAt: T.Optional(T.Nullable(T.Instant({ description: 'When the person got out of bed (the person’s own time); null clears it.' }))),
  }),
  output: T.Object({ entryId: T.Nullable(Id), waiting: T.Boolean({ description: 'true when no night is logged for that date yet: the times wait on the date.' }), lightsOutAt: T.Nullable(T.String()), outOfBedAt: T.Nullable(T.String()) }),
  ...logW,
});
const GaugeKey =T.String({ description: 'Natural key: gauge:steps:<date> or gauge:sleep:<wake date>.' });
const GaugeStream = T.Enum(['steps', 'sleep']);
stub({
  id: 'log.fromGauge',
  title: 'Bring in ring steps and sleep',
  description:
    'Log steps (the fused ring and phone count of each day, else the ring total) and main sleep (one per wake date) that the ring app sent to the home server, as device entries the plan uses like logged ones. Re-running with the same readings writes nothing; a changed reading replaces its own entry; an entry the person logged for the same day wins, and one they removed is not brought back. The app runs this by itself.',
  input: T.Object({
    steps: T.Array(
      T.Object({
        date: LocalDate,
        steps: T.Integer({ minimum: 0, maximum: 200000 }),
        // (energy SPEC §V3.6) the fused day of /steps (`steps-fuse/1`) and the lineages it used; absent = a ring-only total
        fusion: T.Optional(T.Object({ version: T.String(), located: T.Number({ minimum: 0 }), headlinePolicy: T.Enum(['located', 'atLeast']), ringDailyTotal: T.Optional(T.Nullable(T.Number())), ringResidual: T.Optional(T.Nullable(T.Number())), coverage: T.Optional(T.Object({ ringMin: T.Number(), phoneMin: T.Number(), eitherMin: T.Number(), unknownMin: T.Number() })), spans: T.Optional(T.Array(T.Object({ start: T.String(), end: T.String() }), { maxItems: 1500 })) })),
        sources: T.Optional(T.Array(T.String(), { maxItems: 8 })),
      }),
      { maxItems: 400 },
    ),
    sleep: T.Array(T.Object({ wakingDate: LocalDate, start: T.Instant(), end: T.Instant(), asleepMinutes: T.Number({ minimum: 0, maximum: 1440 }), origin: T.Optional(T.String({ maxLength: 160, description: 'The Health Connect app a night came from when the ring recorded none (the entry keeps it as its lineage).' })) }), { maxItems: 800 }),
    // (energy SPEC §V3.6, D13) Health Connect weight records, imported as device measurements when the setting is on
    weights: T.Optional(T.Array(T.Object({ id: T.String({ minLength: 1, maxLength: 120 }), at: T.Instant(), kg: T.Number({ minimum: 20, maximum: 400 }), origin: T.Optional(T.String({ maxLength: 120 })) }), { maxItems: 400 })),
    // (0.6.3 FX1) what the server answered in full: an imported entry it no longer supports was deleted upstream
    answered: T.Optional(T.Object({
      steps: T.Optional(T.Array(LocalDate, { maxItems: 400, description: 'App days the fused steps read covered in full: an imported steps entry of one of them without a reading now is retracted.' })),
      sleep: T.Optional(T.Object({ from: LocalDate, to: LocalDate }, { description: 'Wake dates the sleep read covered in full: an imported night of one of them that no night overlaps now is retracted.' })),
    }, { description: 'Only for a read that answered; a failed or offline read never sends it (nothing is inferred from silence).' })),
  }),
  output: T.Object({
    created: T.Array(T.Object({ entryId: Id, key: GaugeKey, stream: GaugeStream, supersedes: T.Optional(Id) })),
    skipped: T.Array(T.Object({ key: GaugeKey, stream: GaugeStream, reason: T.Enum(['userEntry', 'unchanged', 'removed', 'throttled', 'changedUpstream'], { description: 'userEntry: the person logged this item (their entry wins); unchanged: already in; removed: the person removed the ring entry; throttled: today’s climbing step count was updated recently; changedUpstream: a correction older than 30 days (listed, not rewritten).' }), entryId: T.Optional(Id) })),
    weights: T.Optional(T.Object({ created: T.Array(Id), skipped: T.Array(T.Object({ id: T.String(), reason: T.Enum(['userEntry', 'unchanged']) })) })),
  }),
  perm: 'write',
  impact: 'low',
  surfaces: ['ui'],
  excludedReason: { ai: GAUGE_ONLY, webmcp: GAUGE_ONLY, mcp: GAUGE_ONLY },
  undo: UNDO.RT,
  idempotency: 'natural',
  owner: OWNER,
  uiOwner: UI,
});
stub({
  id: 'log.substance',
  title: 'Log caffeine or alcohol',
  description: `Caffeine (${SUBSTANCE_UNITS.caffeine.join(' or ')}), alcohol (drinks of 14 g ethanol, or g), creatine or exogenous ketones (g or mg) at a clock hour. Other unit pairings are refused.`,
  input: T.Object({
    date: T.Optional(LocalDate),
    substance: T.Enum(['caffeine', 'alcohol', 'creatine', 'exogenousKetones']),
    clockH: ClockH,
    amount: T.Number({ minimum: 0 }),
    unit: T.Enum(['mg', 'drinks', 'g']),
    occurredAt: OccurredAt,
    /** (C2) the planned dose this replaces, or an explicit extra dose; neither = an unlinked log (never time-matched). */
    itemId: T.Optional(T.String()),
    extra: T.Optional(T.Boolean()),
  }),
  ...logW,
});
/** (D7-04) A label serving: what one serving contains (unknown potency = null amount: a valid log with an unchecked safety status). */
const ProductInput = T.Object({
  servingAmount: T.Nullable(T.Number({ exclusiveMinimum: 0 })),
  servingUnit: T.String({ minLength: 1, maxLength: 24 }),
  actives: T.Array(
    T.Object({
      ingredient: T.Enum(EXPOSURE_IDS),
      amount: T.Nullable(T.Number({ minimum: 0 })),
      unit: T.String({ minLength: 1, maxLength: 16 }),
      basis: T.Enum(ACTIVE_BASES),
    }),
    { maxItems: 24 },
  ),
  labelText: T.Optional(T.String({ maxLength: 500 })),
});
stub({
  id: 'log.supplement',
  title: 'Log a supplement',
  description: 'A supplement taken (catalogue id, dose and unit). Optional: servings and the label serving with its actives; an unknown potency is still a valid log.',
  input: T.Object({
    date: T.Optional(LocalDate),
    supplementId: T.String({ minLength: 1 }),
    dose: T.Number({ minimum: 0 }),
    unit: T.String(),
    clockH: T.Optional(ClockH),
    occurredAt: OccurredAt,
    servings: T.Optional(T.Number({ exclusiveMinimum: 0, maximum: 100 })),
    product: T.Optional(ProductInput),
    itemId: T.Optional(T.String()),
    extra: T.Optional(T.Boolean()),
  }),
  ...logW,
});
stub({
  id: 'log.subjective',
  title: 'How today felt',
  description: 'How hard today was (1–5), hunger, energy, mood (0–10), stress, illness. Optional: fullness, craving, restfulness and fatigue (0–10), the clock hour of the rating, concerns (persistent fatigue, performance decline, injury, menstrual change, poor recovery, dizziness), and a symptom with its status.',
  input: T.Object({
    date: T.Optional(LocalDate),
    difficulty: T.Optional(T.Integer({ minimum: 1, maximum: 5 })),
    hunger: T.Optional(Rating10),
    energy: T.Optional(Rating10),
    mood: T.Optional(Rating10),
    stress: T.Optional(T.Enum(['low', 'moderate', 'high'])),
    illness: T.Optional(T.Boolean()),
    // (D2-06) fixed-time ratings: felt hunger ≠ fullness ≠ craving ≠ item completion
    fullness: T.Optional(Rating10),
    craving: T.Optional(Rating10),
    ratedAtClockH: T.Optional(ClockH),
    // (D8-09) observed wellbeing; (D4-04/D8-04) concern flags, never a diagnosis
    restfulness: T.Optional(Rating10),
    fatigue: T.Optional(Rating10),
    concerns: T.Optional(T.Array(T.Enum(['persistentFatigue', 'performanceDecline', 'injury', 'menstrualChange', 'poorRecovery', 'dizziness', 'other']), { maxItems: 7 })),
    // (D4-02) a symptom: unresolved concerning exertional symptoms pause exercise progression at once (no lock window)
    symptom: T.Optional(
      T.Object({
        category: T.Enum(['exertionalChestDiscomfort', 'syncopeOrPresyncope', 'disproportionateBreathlessness', 'palpitations', 'dizziness', 'musculoskeletal', 'other']),
        status: T.Enum(['new', 'unexplained', 'reviewNeeded', 'resolved', 'unknown']),
        context: T.Optional(T.Enum(['exertional', 'rest', 'unknown'])),
        occurredOn: T.Optional(LocalDate),
      }),
    ),
  }),
  ...logW,
});
// (energy SPEC §2.3 4(a)) the person's step corrections, sent to the server's step fusion (`POST /v1/gauge/steps/fuse`)
export const STEPS_CORRECTION_USE = '^(ring|phone|hc-other:[\\w.:-]{1,128})$';
stub({
  id: 'log.stepsCorrection',
  title: 'Correct steps',
  description:
    'Say which source counts the steps of a time span (an hour, a walk or a whole day): "phone" or "ring" (or "hc-other:<app>" for another Health Connect app). The fused step count of that span is then taken from it. Remove the correction with log.retract.',
  input: T.Object({
    start: T.Instant({ description: 'Start of the span (ISO instant with offset).' }),
    end: T.Instant({ description: 'End of the span, after the start; at most 48 hours later.' }),
    use: T.String({ pattern: STEPS_CORRECTION_USE, maxLength: 140, description: 'ring, phone or hc-other:<origin>.' }),
  }),
  ...logW,
  surfaces: ['ui'],
  excludedReason: {
    ai: 'the person corrects steps on the steps-by-source panel; agents read the fused steps with gauge_steps',
    webmcp: 'the person corrects steps on the steps-by-source panel',
    mcp: 'the person corrects steps on the steps-by-source panel; agents read the fused steps with gauge_steps',
  },
});
stub({ id: 'log.note', title: 'Add a note', description: 'A free-text note on a day.', input: T.Object({ date: T.Optional(LocalDate), text: T.String({ minLength: 1, maxLength: 2000 }) }), ...logW });
/** `log.measurement`'s metric ids (the unit is part of the id). Agents guessed `weight`; the schema now lists them. */
export const MEASUREMENT_METRICS = ['weightKg', 'waistCm', 'hipCm', 'neckCm', 'chestCm', 'armCm', 'thighCm', 'bodyFatPct', 'sbpMmHg', 'dbpMmHg', 'ketonesMmolL', 'glucoseMmolL', 'ldlMmolL', 'hdlMmolL', 'tgMmolL', 'apoBgL', 'fastingGlucoseMmolL', 'hba1cPct', 'crpMgL'] as const;
stub({
  id: 'log.measurement',
  title: 'Log a measurement',
  description:
    'A weigh-in or measurement (weight kg, girths cm, body fat %, blood pressure, glucose or ketones mmol/L) with context and method; updates the trend filter. If a device records this, your entry becomes a correction for the person to confirm.',
  input: T.Object({
    date: T.Optional(LocalDate),
    metric: T.Enum([...MEASUREMENT_METRICS], { description: 'Metric id, unit in the name: weightKg (not "weight"), waistCm, hipCm, neckCm, chestCm, armCm, thighCm, bodyFatPct, sbpMmHg, dbpMmHg, ketonesMmolL, glucoseMmolL, ldlMmolL, hdlMmolL, tgMmolL, apoBgL, fastingGlucoseMmolL, hba1cPct, crpMgL.' }),
    value: T.Number(),
    repeats: T.Optional(T.Array(T.Number(), { maxItems: 64, description: 'Original raw repeat readings; retain equal-valued genuine repeats.' })),
    repeatsEncoding: T.Optional(T.Enum(['fullRawList', 'primaryPlusAdditional'], { description: 'fullRawList: repeats is exhaustive and value its mean. primaryPlusAdditional: value is first reading, repeats are additional. Absent encoding remains unknown.' })),
    unit: T.Optional(T.String()),
    context: T.Optional(T.Enum(['morningFasted', 'evening', 'postWorkout', 'unknown'])),
    method: T.Optional(T.Enum(['scale', 'tape', 'dxa', 'bia', 'skinfold', 'navy', 'lab', 'meter'])),
    // (C1/C4) measurement occurrence and protocol; (D5-07) scan facts; (D4-05) blood-pressure pairing; (D2-08) specimen
    occurredAt: OccurredAt,
    device: T.Optional(T.String({ maxLength: 64 })),
    protocol: T.Optional(T.String({ maxLength: 64 })),
    scanMassKg: T.Optional(T.Number({ minimum: 20, maximum: 400 })),
    scanFatMassKg: T.Optional(T.Number({ minimum: 0, maximum: 300 })),
    landmark: T.Optional(T.Enum(['iliacCrest', 'umbilicus', 'narrowest', 'midpoint', 'unknown'])),
    episodeId: T.Optional(T.String({ minLength: 1, maxLength: 64, description: 'Pairs readings of one sitting (systolic with diastolic; repeats).' })),
    restMin: T.Optional(T.Number({ minimum: 0, maximum: 120 })),
    setting: T.Optional(T.Enum(['home', 'clinic', 'pharmacy', 'other', 'unknown'])),
    timeOfDay: T.Optional(T.Enum(['morning', 'evening', 'other'])),
    specimen: T.Optional(T.Enum(['capillaryBlood', 'venousBlood', 'urine', 'breath'])),
    sampleId: T.Optional(T.String({ maxLength: 64 })),
    fastingHours: T.Optional(T.Number({ minimum: 0, maximum: 240 })),
  }),
  ...logW,
});
const MarkValue = T.Enum(['asPlanned', 'partly', 'not']);
/** One meal's answer (the meal sheet's as planned · partly · skipped): it replaces what the slot holds, in one change. */
export const MealMarkInput = T.Object({
  slot: T.String({ minLength: 1, maxLength: 40, description: 'The planned meal slot (today.get prescription.meals).' }),
  mark: MarkValue,
  replaces: T.Optional(T.Array(Id, { maxItems: 40, description: 'Ids of the meal entries logged for this slot (all of them); they are removed in the same change. Needed when the slot has food logged.' })),
  components: T.Optional(T.Array(MealComponentInput, { maxItems: 40, description: 'asPlanned only: the planned meal when it is not the slot’s own plan (one serving of the chosen recipe), as for log.meal.' })),
});
stub({
  id: 'log.markDay',
  title: 'Mark a day',
  description: 'Mark food, training, fast or the whole day as planned, partly or not; or one meal (meal): as planned logs its planned meal, partly or not records that meal only, with no amounts. A meal’s answer replaces the entries logged for its slot (pass their ids in replaces); undo restores them.',
  input: T.Object({
    date: LocalDate,
    marks: T.Optional(T.Object({ food: T.Optional(MarkValue), train: T.Optional(MarkValue), fast: T.Optional(MarkValue), all: T.Optional(MarkValue) })),
    meal: T.Optional(MealMarkInput),
  }),
  perm: 'write',
  impact: 'low',
  undo: UNDO.IP,
  idempotency: 'natural',
  owner: OWNER,
  uiOwner: UI,
});
stub({
  id: 'log.confirmDay',
  title: 'Confirm a day',
  description: 'Confirm a day (its score becomes final). Optional intake: complete (all food logged with amounts), partial, or none (nothing eaten). Without it nothing is said about food completeness.',
  input: T.Object({ date: LocalDate, intake: T.Optional(T.Enum([...DAY_INTAKE_ATTESTATIONS])) }),
  perm: 'write',
  impact: 'low',
  undo: UNDO.IP,
  idempotency: 'natural',
  owner: OWNER,
  uiOwner: UI,
});
stub({ id: 'log.edit', title: 'Edit an entry', description: 'Edit a logged entry (a new entry supersedes it). The patch may change only the fields its logging command takes (for example steps, or amount and clock hour); for a meal or session: date, clock hour, slot, status, duration or effort.', input: T.Object({ entryId: Id, patch: T.OpenObject() }), ...logW });
stub({ id: 'log.retract', title: 'Remove an entry', description: 'Remove a logged entry (a retract entry; restorable).', input: T.Object({ entryId: Id, keepEntryId: T.Optional(Id) }), ...logW });
stub({ id: 'log.get', title: 'Read the log', description: 'Logged entries between two dates, optionally by kind.', input: T.Object({ from: LocalDate, to: LocalDate, kinds: T.Optional(T.Array(T.String())) }), output: T.Array(T.OpenObject()), perm: 'read', owner: OWNER, uiOwner: UI });

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
  'log.stepsCorrection',
);
