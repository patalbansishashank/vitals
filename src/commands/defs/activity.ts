/**
 * Activity commands (`activity.*`, energy SPEC §V3.2): detected activities and their energy come in automatically as
 * CANDIDATES and (r070, replacing D8's "nothing is approved automatically") are decided automatically too
 * (`activity.autoAccept`): recordings and strong detections are counted, duplicates merge into one activity, weak
 * detections stay a quiet "possible". The person edits or removes an activity afterwards, adds a possible one, and logs by
 * hand when neither the ring nor the phone was worn. Ids, schemas, permission classes, surfaces, undo and idempotency are
 * fixed here; the executors are in `../living/activity.ts`.
 *
 *  - The person's own decisions (an edit, a removal, an approval, a hand log) stand: no import or automatic rule changes
 *    them or asks again. Approve, approve all and edit are `consequential`: an agent's call is staged as a proposal
 *    (`pendingChanges`) the person applies in the app, never applied directly.
 *  - Approve all binds only the revisions the person saw: a candidate that changed since is refused, never approved.
 *  - Every write is one ChangeSet that `history.undo` reverts (the candidate and the session entry together).
 *  - Ids are deterministic (the candidate key, the decided revision and the entry it supersedes), so two devices that
 *    decide the same thing write the same rows (sync merges them into one).
 */
import { T } from '../schema';
import { UNDO, stub } from './_shared';

const OWNER = 'V3 (living plan: activity review)';
const UI = 'Today\'s activities and the activity sheet, V4c';
const IMPORT_ONLY = 'the app brings detected activities in by itself; agents read them with activity.candidates';
const Key = T.String({ minLength: 26, maxLength: 26, description: 'The candidate id (activity.candidates rows[].id).' });
const Revision = T.String({ minLength: 1, maxLength: 64, description: 'The revision the person saw (rows[].revision); a candidate updated since is refused.' });
const LocalDate = T.Date();
const ItemId = T.String({ minLength: 1, maxLength: 80, description: 'The planned session this was (e.g. cardioSession:<slot>, from today.get); leave out for an extra activity.' });
const Exercise = T.String({ minLength: 1, maxLength: 64, description: 'Catalogue exercise id (catalogue.searchExercises).' });
// (0.6.3, after Codex #13) an explicit 0 is the person's "use 0" (a machine that showed 0, e.g. a mis-set treadmill): booked
// as reported G = 0, which the shared ledger reads as no energy above rest (A = 0, grossBelowRest) and replay books the same
// (the realised-dose adapter takes 0); it is never replaced by an estimate. Reject the activity to remove it altogether.
const Separate = T.Boolean({ description: 'The person said this was a separate activity from the one(s) it looks like (activity.candidates approveAll.held): it is then approved alongside them. Without it, an activity that looks like one already counted is refused (reject one of them instead).' });
const Kcal = T.Number({ minimum: 0, maximum: 5000, description: 'Only a number the machine showed or the person typed ("the machine showed N kcal"); booked as reported, never invented. 0 means the machine showed 0: no energy above rest is booked for the activity. To drop an activity altogether, reject it.' });

export const ActivityIntensityInput = T.Object({
  class: T.Optional(T.Enum(['light', 'moderate', 'vigorous', 'unknown'])),
  talkTest: T.Optional(T.Enum(['canSing', 'talkNotSing', 'fewWords', 'fullSentences', 'unknown'])),
  rpe: T.Optional(T.Number({ minimum: 0, maximum: 10 })),
  rpeScale: T.Optional(T.Enum(['rirRpe', 'cr10', 'relativeEffort0To10', 'unknown'])),
  avgHr: T.Optional(T.Number({ minimum: 30, maximum: 240, description: 'Average heart rate the person read off a device, bpm.' })),
  speedKmh: T.Optional(T.Number({ minimum: 0, maximum: 60 })),
  gradePct: T.Optional(T.Number({ minimum: -30, maximum: 40 })),
  powerW: T.Optional(T.Number({ minimum: 0, maximum: 2000 })),
});

const STATUSES = ['pending', 'possible', 'approved', 'edited', 'rejected', 'superseded'];
const DecisionOutput = T.Object({
  id: T.String(),
  status: T.Enum(STATUSES),
  revision: T.Nullable(T.String()),
  entryId: T.Nullable(T.String()),
  supersedes: T.Optional(T.String()),
  retracted: T.Optional(T.String()),
  unchanged: T.Optional(T.Boolean()),
});

stub({
  id: 'activity.candidates',
  title: 'Detected activities',
  description:
    'Activities that came in automatically (ring app recordings, Health Connect sessions of Google Fit and other apps, ring sport windows, the server\'s detections) between two dates: type, time, minutes, kcal range, Heart Points, sources, plan match. They are counted without review (decided rows say auto.from where they came from); duplicates across sources are merged into one; weak detections are listed as possible (not counted). rows (pending) is normally empty. status filters.',
  input: T.Object({ from: LocalDate, to: LocalDate, status: T.Optional(T.Enum(STATUSES)) }),
  output: T.OpenObject({ description: 'rows (pending, normally empty), decided (approved, edited, rejected; auto.from on automatic ones), possible (weak detections, not counted), strip, approveAll.items.' }),
  perm: 'read',
  owner: OWNER,
  uiOwner: UI,
});

stub({
  id: 'activity.approve',
  title: 'Approve an activity',
  description: 'Count one activity at the revision shown: it becomes a done session (estimated energy, its heart-rate summary, steps inside it) that the plan and its projections count. Mostly for adding a possible one (activity.candidates possible) or one still pending: recordings and strong detections are already counted automatically, and approving one of those again changes nothing. asItemId says it was the planned session. One that looks like an activity already counted is refused unless separate says the person confirmed it was a separate activity. Undo removes it again.',
  input: T.Object({ id: Key, revision: Revision, asItemId: T.Optional(ItemId), separate: T.Optional(Separate) }),
  output: DecisionOutput,
  perm: 'write',
  impact: 'consequential',
  undo: UNDO.IP,
  idempotency: 'natural',
  owner: OWNER,
  uiOwner: UI,
});

stub({
  id: 'activity.approveAll',
  title: 'Approve all activities',
  description: 'Approve the listed activities at the revisions shown (activity.candidates approveAll.items, normally empty: activities are counted automatically), as one change that one undo reverts. Any item updated since, or one that looks like another activity (approveAll.held), is refused and nothing is approved.',
  input: T.Object({ items: T.Array(T.Object({ id: Key, revision: Revision }), { minItems: 1, maxItems: 50 }) }),
  output: T.Object({ approved: T.Array(DecisionOutput) }),
  perm: 'write',
  impact: 'consequential',
  undo: UNDO.IP,
  idempotency: 'natural',
  owner: OWNER,
  uiOwner: UI,
});

stub({
  id: 'activity.edit',
  title: 'Edit an activity',
  description: 'Change an activity, counted automatically or not: the type, the start and end, the intensity, how the phone was carried, which planned session it was, or the kcal the machine showed; `clear` removes an earlier choice. The energy is re-estimated and the edited activity counts. The edit stands: no later import or source change replaces it or asks again.',
  input: T.Object({
    id: Key,
    revision: Revision,
    exerciseId: T.Optional(Exercise),
    startAt: T.Optional(T.Instant()),
    endAt: T.Optional(T.Instant()),
    intensity: T.Optional(ActivityIntensityInput),
    carry: T.Optional(T.Enum(['pocket', 'hand', 'desk'])),
    asItemId: T.Optional(ItemId),
    kcalOverride: T.Optional(Kcal),
    clear: T.Optional(T.Array(T.Enum(['intensity', 'carry', 'asItemId', 'kcalOverride']), { maxItems: 4, description: 'Fields to remove from the earlier decision (e.g. it was not the planned session after all, or the machine kcal was wrong): the earlier value is dropped, not kept.' })),
    separate: T.Optional(Separate),
  }),
  output: DecisionOutput,
  perm: 'write',
  impact: 'consequential',
  undo: UNDO.IP,
  idempotency: 'natural',
  owner: OWNER,
  uiOwner: UI,
});

stub({
  id: 'activity.reject',
  title: 'Reject an activity',
  description: 'Remove an activity (counted automatically or not): it never comes back, from the same source or as a near-identical copy from another app. If it was counted, its session (and its energy in the plan) is removed. Undo restores it.',
  input: T.Object({ id: Key }),
  output: DecisionOutput,
  perm: 'write',
  impact: 'consequential',
  undo: UNDO.IP,
  idempotency: 'natural',
  owner: OWNER,
  uiOwner: UI,
});

stub({
  id: 'activity.logManual',
  title: 'Log an activity by hand',
  description:
    'Log an activity when no ring or phone recorded it: type, date, start clock hour (leave out only when the person does not know it), minutes and intensity (class, talk test, effort, average HR, speed, grade or power); kcalOverride only from a machine display. The energy is estimated. If it overlaps an activity the ring or phone recorded, nothing is saved until resolution says what the person chose: replace (the recording is rejected), link (the same activity: the recording takes this type and effort) or separate (both count).',
  input: T.Object({
    exerciseId: Exercise,
    date: LocalDate,
    startH: T.Optional(T.Number({ minimum: 0, maximum: 28, description: 'Clock hour it started (local, on the app day: 24 and more after midnight); leave out only when the person does not know (the time stays unknown).' })),
    durationMin: T.Number({ exclusiveMinimum: 0, maximum: 600 }),
    intensity: ActivityIntensityInput,
    kcalOverride: T.Optional(Kcal),
    resolution: T.Optional(T.Enum(['replace', 'link', 'separate'], { description: 'Only when the log overlaps a recorded activity (a first call without it is refused with reason overlap): what the person chose.' })),
  }),
  output: T.Object({
    id: T.String(),
    entryId: T.String(),
    kcal: T.Nullable(T.Number()),
    conflicts: T.Array(T.Object({ id: T.String(), entryId: T.Nullable(T.String()), overlapPct: T.Number(), status: T.Optional(T.Enum(['pending', 'approved', 'edited'])) })),
    resolution: T.Optional(T.Enum(['replace', 'link', 'separate'])),
    replaced: T.Optional(T.Array(T.String())),
    saved: T.Optional(
      T.Object(
        { exerciseId: T.String(), durationMin: T.Number(), startAt: T.Nullable(T.String()), endAt: T.Nullable(T.String()) },
        { description: 'What was saved: with resolution link, the recording’s own window and minutes (not the ones typed); startAt/endAt null when the time is unknown.' },
      ),
    ),
  }),
  perm: 'write',
  impact: 'low',
  undo: UNDO.IP,
  idempotency: 'key',
  owner: OWNER,
  uiOwner: UI,
});

const Ms = T.Number({ description: 'UTC epoch milliseconds.' });
stub({
  id: 'activity.fromGauge',
  title: 'Bring in detected activities',
  description: 'Turn the sessions the home server sent (ring app workouts, Health Connect exercise sessions, ring sport windows, its detection episodes) and the fused minute timeline into activities (activity.autoAccept then decides them). Re-running with the same evidence writes nothing; a rejected activity never comes back. The app runs this by itself.',
  input: T.Object({
    gaugeSessions: T.Array(T.Object({ id: T.String(), revision: T.String(), start: Ms, end: Ms, type: T.String(), kcal: T.Optional(T.Nullable(T.Number())), distanceM: T.Optional(T.Nullable(T.Number())), pauses: T.Optional(T.Array(T.Object({ start: Ms, end: Ms }))), activityTypeId: T.Optional(T.String({ maxLength: 48, description: 'The catalogue activity the recording was started as (Gauge activity_type_id); suggested when it names a known exercise.' })) }), { maxItems: 500 }),
    hcSessions: T.Array(T.Object({ id: T.String(), revision: T.String(), start: Ms, end: Ms, exerciseType: T.Integer(), originPackage: T.String(), title: T.Optional(T.String()), hasHr: T.Optional(T.Boolean()), hasRoute: T.Optional(T.Boolean()), segments: T.Optional(T.Array(T.Object({ start: Ms, end: Ms }), { maxItems: 200 })),
      recordingMethod: T.Optional(T.Enum(['manual', 'active', 'auto'], { description: 'Health Connect recordingMethod: manual (typed in by the person), active (a recording the person started in that app), auto (detected by the app).' })),
      laps: T.Optional(T.Integer({ minimum: 0, maximum: 10000, description: 'How many laps the session has.' })) }), { maxItems: 500 }),
    telemetry: T.Optional(T.Array(T.Object({ id: T.String(), revision: T.String(), start: Ms, end: Ms, mode: T.Optional(T.String()) }), { maxItems: 500 })),
    minutes: T.Optional(T.Array(T.Object({ first: Ms, steps: T.Array(T.Nullable(T.Number())), hrBpm: T.Optional(T.Array(T.Nullable(T.Number()))), hrSupportedS: T.Optional(T.Array(T.Nullable(T.Number()))), hrExact: T.Optional(T.Array(T.Object({ start: Ms, end: Ms, bpm: T.Number() }), { maxItems: 20000, description: 'The day\'s raw HR readings as their hr-support/1 intervals (the server\'s hr-intervals): present when the server sent all of them, so zone time is exact; absent = minute means.' })), asleep: T.Optional(T.Array(T.Boolean())),
      speedMps: T.Optional(T.Array(T.Nullable(T.Number({ minimum: 0, maximum: 100 })), { description: 'Health Connect speed per minute, m/s (the server timeline\'s hc.speedMps); null where unknown.' })),
      speedAccepted: T.Optional(T.Array(T.Boolean(), { description: 'Per minute: the speed is a measurement in range (not a manual entry). Only accepted minutes reach the speed estimator (walking and running).' })),
      gradePct: T.Optional(T.Array(T.Nullable(T.Number({ minimum: -30, maximum: 40 })), { description: 'Grade per minute, %, when a source gives one; absent = level is assumed.' })),
      powerW: T.Optional(T.Array(T.Nullable(T.Number({ minimum: 0, maximum: 3000 })), { description: 'Health Connect power per minute, W (hc.powerW); null where unknown.' })),
      powerVerified: T.Optional(T.Array(T.Boolean(), { description: 'Per minute: the power is verified external work. Unverified power is shown as evidence only and never changes the energy.' })),
      gpsSpeedMps: T.Optional(T.Array(T.Nullable(T.Number({ minimum: 0, maximum: 100 })), { description: 'The ring app\'s route-derived moving speed per minute, m/s (the server timeline\'s gps.speedMps), inside its GPS workouts; null where unknown.' })),
      gpsSpeedAccepted: T.Optional(T.Array(T.Boolean(), { description: 'Per minute: the GPS speed is a measurement (enough accurate fixes, in range). An activity takes one speed source; walking and running only, never outdoor cycling.' })),
    }), { maxItems: 40 })),
    deletedRefs: T.Optional(T.Array(T.String(), { maxItems: 500 })),
    sleepingLowHr: T.Optional(T.Nullable(T.Number({ minimum: 25, maximum: 140, description: 'The home server\'s sleeping low HR baseline, bpm (an HRrest proxy only when the person opted in).' }))),
    sleepingLowHrSource: T.Optional(T.Enum(['ring', 'healthConnect'], { description: 'Where sleepingLowHr came from: the ring, or Health Connect\'s resting HR while the ring\'s sleeping low is not ready.' })),
    // (0.6.7 AD-VITALS) the server's detect/2 episodes: a final one becomes a pending candidate (never booked until approved)
    detections: T.Optional(T.Array(T.Object({
      id: T.String({ minLength: 1, maxLength: 64 }),
      revision: T.Integer({ minimum: 0 }),
      detector: T.String({ maxLength: 32 }),
      start: Ms,
      end: Ms,
      state: T.Optional(T.Enum(['open', 'final', 'withdrawn'], { description: 'Only final episodes become activities to review; open ones are still going on.' })),
      label: T.String({ minLength: 1, maxLength: 48, description: 'walk, walk_possibly_treadmill, treadmill_walk, run, treadmill_run, cycling, possible_cycling, possible_workout or possible_strength (another label reads as a possible workout).' }),
      alternatives: T.Optional(T.Array(T.String({ maxLength: 48 }), { maxItems: 8 })),
      existence: T.Number({ minimum: 0, maximum: 1 }),
      typeScore: T.Number({ minimum: 0, maximum: 1 }),
      level: T.Enum(['low', 'medium', 'high']),
      reasons: T.Optional(T.Array(T.String({ maxLength: 64 }), { maxItems: 16 })),
      coverage: T.Optional(T.Object({ phone: T.Optional(T.Number({ minimum: 0, maximum: 1 })), ring: T.Optional(T.Number({ minimum: 0, maximum: 1 })), hr: T.Optional(T.Number({ minimum: 0, maximum: 1 })), ar: T.Optional(T.Number({ minimum: 0, maximum: 1 })), gps: T.Optional(T.Number({ minimum: 0, maximum: 1 })) })),
      evidenceHash: T.Optional(T.String({ maxLength: 128 })),
      recordingRefs: T.Optional(T.Array(T.String({ maxLength: 160 }), { maxItems: 16 })),
    }), { maxItems: 500, description: 'The home server\'s detection episodes (detect/2): each final one is an activity to review, labelled detected.' })),
    withdrawnDetections: T.Optional(T.Array(T.String({ minLength: 1, maxLength: 64 }), { maxItems: 500, description: 'Episode ids the server withdrew: a pending activity built only on one is withdrawn too.' })),
    serverDetector: T.Optional(T.String({ maxLength: 32, description: 'The detector the server runs (detect/2): the app\'s own step and heart-rate detectors are then off.' })),
  }),
  output: T.Object({
    created: T.Array(T.String()),
    updated: T.Array(T.String()),
    unchanged: T.Integer(),
    blocked: T.Array(T.String()),
    superseded: T.Array(T.String()),
    compacted: T.Integer(),
  }),
  perm: 'write',
  impact: 'low',
  surfaces: ['ui'],
  excludedReason: { ai: IMPORT_ONLY, webmcp: IMPORT_ONLY, mcp: IMPORT_ONLY },
  undo: UNDO.IP,
  idempotency: 'natural',
  owner: OWNER,
  uiOwner: UI,
});

stub({
  id: 'activity.autoAccept',
  title: 'Decide detected activities automatically',
  description: 'Decide what came in automatically, as Google Fit counts its own sessions: recordings (the ring app, Health Connect, the ring) and strong detections are counted, duplicates across sources are merged into the one of higher precedence, weak detections become possible (not counted), and the person\'s own decisions stay as they are. Re-running writes nothing. The app runs this after each import.',
  input: T.Object({}),
  output: T.Object({
    accepted: T.Array(T.String()),
    merged: T.Array(T.String()),
    possible: T.Array(T.String()),
    cleared: T.Integer(),
    waiting: T.Array(T.String(), { description: 'Activities that could not be estimated yet (no weight on record): they stay pending.' }),
  }),
  perm: 'write',
  impact: 'low',
  surfaces: ['ui'],
  excludedReason: { ai: IMPORT_ONLY, webmcp: IMPORT_ONLY, mcp: IMPORT_ONLY },
  undo: UNDO.IP,
  idempotency: 'natural',
  owner: OWNER,
  uiOwner: UI,
});
