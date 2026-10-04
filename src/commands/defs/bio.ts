/**
 * `bio.*` (SUITE_SPEC §1.9, §4): ids, classes, surfaces, inputs and outputs. The executors are in `../bio` (I1-B over
 * E10's `src/biometrics`).
 *
 * Inputs the screens build: `bio.import.fileRef` names a file the screen staged with `stageFile` (`@/biometrics/app/handoff`)
 * right before dispatching; `bio.deviceConnect` / `bio.deviceSync` take a `linkRef` the screen staged with
 * `stageBleLink` after `requestDevice` ran inside the click (Web Bluetooth needs a user gesture). `bio.setPolicy`
 * takes E10's `StreamPolicy` fields (`imported`, `coach`, `engine`, `scores`; any subset) for one stream, for the
 * person (every source) or for one source.
 */
import { T, type TSchema } from '../schema';
import type { CommandDef } from '../types';
import { CONSENT, DEVICE, SCREEN, UI_ONLY, UNDO, stub, type StubSpec } from './_shared';
import { defineCommand, getCommand } from '../registry';

const OWNER = 'E10 (biometrics)';
const LocalDate = T.Date();
const Range = { from: T.Optional(LocalDate), to: T.Optional(LocalDate) };
const job = { kind: 'job' as const, softTimeoutMs: 25_000 };
const Tier = T.Enum(['A', 'B', 'C']);
const Coach = T.Enum(['hidden', 'daily', 'daily+series']);
const RingSharing = T.Enum(['on', 'off', 'some', 'none']);

/** E10's `StreamPolicy` (§4.5). */
export const StreamPolicySchema = T.Object({ stream: T.String({ minLength: 1 }), imported: T.Boolean(), coach: Coach, engine: T.Boolean(), scores: T.Boolean() });

/** Where a value came from: the person's correction, a device, or (only where no device reports it) an entry by hand. */
const Basis = T.Enum(['correction', 'device', 'manual']);
const Value = T.Object({ value: T.Number(), unit: T.String(), source: T.String(), sourceKey: T.String(), tier: Tier, basis: T.Optional(Basis) });
const DailyRow = T.Object({
  date: LocalDate,
  /** Resolved values by metric (`steps`, `resting_hr_bpm`, `hrv_rmssd_ms` …): one source per metric, never averaged. */
  values: T.Record(Value),
  sleep: T.Optional(
    T.Object({
      asleepH: T.Number(),
      inBedH: T.Optional(T.Number()),
      bedAt: T.Optional(T.String()),
      wakeAt: T.Optional(T.String()),
      efficiencyPct: T.Optional(T.Number()),
      deepH: T.Optional(T.Number()),
      remH: T.Optional(T.Number()),
      lightH: T.Optional(T.Number()),
      awakeH: T.Optional(T.Number()),
      source: T.String(),
      tier: Tier,
      basis: T.Optional(Basis),
    }),
  ),
  workouts: T.Array(
    T.Object({ type: T.String(), start: T.Optional(T.String()), durationMin: T.Number(), activeKcal: T.Optional(T.Number()), avgHrBpm: T.Optional(T.Number()), source: T.String() }),
  ),
  /** Vendor numbers: the vendor's opinion, never an input to Vitals' scores or plan. */
  vendor: T.Array(T.Object({ source: T.String(), key: T.String(), value: T.Number(), label: T.Literal('vendor_opinion') })),
});
const Hidden = T.Array(T.String(), { description: 'Streams left out because the person has not shared them with this caller.' });

const SourceView = T.Object({
  sourceKey: T.String(),
  label: T.String(),
  tier: Tier,
  /** ring, watch, band, phone, scale, strap, manual, or unknown. */
  kind: T.String(),
  channel: T.String(),
  policies: T.Array(StreamPolicySchema),
  /** Streams this source has brought in. */
  streams: T.Array(T.String()),
  records: T.Integer(),
  firstDate: T.Nullable(LocalDate),
  lastDate: T.Nullable(LocalDate),
  baselineEpochs: T.Array(LocalDate),
  /** Bluetooth driver id when the source is a ring Vitals syncs directly. */
  driver: T.Nullable(T.String()),
  lastSyncAt: T.Nullable(T.String()),
  battery: T.Nullable(T.Number()),
});

const ScoreView = T.Object({
  scoreId: T.String(),
  title: T.String(),
  version: T.String(),
  scope: T.Object({ kind: T.Enum(['night', 'day', 'week', 'workout']), localDate: LocalDate }),
  status: T.Enum(['ok', 'withheld', 'insufficient_baseline', 'borderline']),
  value: T.Nullable(T.Number()),
  unit: T.String(),
  state: T.Optional(T.String()),
  reason: T.Optional(T.String()),
  band: T.Optional(T.Object({ lo: T.Number(), hi: T.Number(), level: T.NumberEnum([0.8, 0.95]) })),
  confidence: T.Enum(['low', 'medium', 'high']),
  /** measurement, estimate, convenience_index or flag. */
  label: T.String(),
  source: T.Nullable(T.String()),
  tier: T.Nullable(Tier),
  /** The day's value was corrected by the person; the score was computed from the correction (SUITE_SPEC §14.6). */
  corrected: T.Optional(T.Boolean()),
});

const ImportReport = T.Object({
  importer: T.String(),
  records: T.Integer(),
  samples: T.Integer(),
  chunks: T.Integer(),
  duplicates: T.Integer(),
  skipped: T.Integer(),
  rejected: T.Integer(),
  sources: T.Array(T.String()),
  days: T.Nullable(T.Object({ from: LocalDate, to: LocalDate })),
  warnings: T.Array(T.String()),
  /** Score results written for the dates the import touched. */
  scored: T.Integer(),
});
const DeviceReport = T.Object({
  sourceKey: T.String(),
  driver: T.String(),
  firmware: T.String(),
  battery: T.Nullable(T.Number()),
  records: T.Integer(),
  samples: T.Integer(),
  duplicates: T.Integer(),
  days: T.Nullable(T.Object({ from: LocalDate, to: LocalDate })),
  warnings: T.Array(T.String()),
  scored: T.Integer(),
});
const RescoreReport = T.Object({ planned: T.Integer(), computed: T.Integer(), written: T.Integer(), skipped: T.Integer(), aborted: T.Boolean() });

/** `stub` with typed schemas (for `CommandMap`). */
function def<I extends TSchema, O extends TSchema>(s: StubSpec & { input: I; output: O }): CommandDef<I, O> {
  return stub(s) as unknown as CommandDef<I, O>;
}

/** The screens call these (Settings › Devices, the intake's devices chapter): drop the "no screen yet" reason. */
function onScreen(...ids: string[]): void {
  for (const id of ids) {
    const d = getCommand(id);
    if (!d?.excludedReason?.ui) continue;
    const { ui: _ui, ...rest } = d.excludedReason;
    void _ui;
    defineCommand({ ...d, excludedReason: rest });
  }
}

export const bioDaily = def({
  id: 'bio.daily',
  title: 'Daily biometrics',
  description:
    'Resolved daily device values for a date range (default the last 14 days, at most 92): steps, sleep, resting heart rate, HRV, workouts …, one source per metric (never averaged) with its label and tier. Agents get only the streams the person shares with the Coach; vendor numbers are labelled vendor_opinion.',
  input: T.Object({ ...Range, metrics: T.Optional(T.Array(T.String())) }),
  output: T.Object({ days: T.Array(DailyRow), hidden: Hidden }),
  perm: 'read',
  owner: OWNER,
});
export const bioSeries = def({
  id: 'bio.series',
  title: 'Biometric series',
  description:
    'A raw or resampled series of one device stream (hr, hrv, spo2, skin_temp, steps …) over a range: raw samples (at most 5000), hourly or daily mean/min/max. Agents need the person to share that stream with the Coach as daily+series.',
  input: T.Object({ metric: T.String({ minLength: 1 }), ...Range, resolution: T.Optional(T.Enum(['raw', 'hour', 'day'])) }),
  output: T.Object({
    metric: T.String(),
    unit: T.String(),
    resolution: T.Enum(['raw', 'hour', 'day']),
    points: T.Array(T.Object({ t: T.String(), value: T.Number(), min: T.Optional(T.Number()), max: T.Optional(T.Number()), n: T.Integer(), source: T.String() })),
    truncated: T.Boolean(),
    hidden: T.Boolean(),
  }),
  perm: 'read',
  owner: OWNER,
});
export const bioBaselines = def({
  id: 'bio.baselines',
  title: 'Personal baselines',
  description: 'Personal normal ranges (resting heart rate, HRV, sleep, skin temperature) from the current device epoch: mean, likely range (± half a standard deviation) and nights so far; forming until 14 nights.',
  input: T.Object({}),
  output: T.Object({
    baselines: T.Array(
      T.Object({ metric: T.String(), unit: T.String(), mean: T.Number(), lo: T.Number(), hi: T.Number(), nights: T.Integer(), forming: T.Boolean(), since: LocalDate, source: T.String(), tier: Tier }),
    ),
    hidden: Hidden,
  }),
  perm: 'read',
  owner: OWNER,
});
export const bioSources = def({
  id: 'bio.sources',
  title: 'Data sources',
  description: 'Connected sources (devices, imports, entries by hand) with tier, what each brought in and the sharing policy per stream; plus the person’s own stream choices.',
  input: T.Object({}),
  output: T.Object({
    sources: T.Array(SourceView),
    policies: T.Array(StreamPolicySchema),
    /** The ring master switch over every ring source: on (ring defaults), off (not used or shared), some (any other mix), none (no ring). */
    ringSharing: RingSharing,
    /** Show the one-time notice that existing ring data moved to the ring defaults (until dismissed). */
    ringDefaultsNotice: T.Boolean(),
  }),
  perm: 'read',
  owner: OWNER,
});
export const bioScores = def({
  id: 'bio.scores',
  title: 'Scores',
  description:
    'Vitals’ own scores (sleep, HRV status, resting heart rate, readiness …) for a range (default the last 7 days): newest version per day, with status, value or state, likely range, confidence and the device. Agents get only scores built from streams the person shares with the Coach.',
  input: T.Object({ ...Range, scoreIds: T.Optional(T.Array(T.String())) }),
  output: T.Object({ results: T.Array(ScoreView), hidden: Hidden }),
  perm: 'read',
  owner: OWNER,
});
export const bioManual = def({
  id: 'bio.manual',
  title: 'Enter a device value',
  description:
    'Enter a device value by hand (e.g. read from a screenshot) for a date: weight_kg, body_fat_pct, waist_cm, resting_hr_bpm, hrv_ms, spo2_pct, body_temp_c, steps, sleep_h, vo2max (a lab or field test), bp_sys_mmhg, bp_dia_mmhg, glucose_mg_dl. Undo removes it. If a device records this, your entry becomes a correction for the person to confirm.',
  input: T.Object({ date: LocalDate, metric: T.String({ minLength: 1 }), value: T.Number(), at: T.Optional(T.Instant()), note: T.Optional(T.String({ maxLength: 500 })) }),
  output: T.Object({ recordId: T.String() }),
  perm: 'write',
  impact: 'low',
  undo: UNDO.TS,
  idempotency: 'key',
  owner: OWNER,
});
export const bioImport = def({
  id: 'bio.import',
  title: 'Import health data',
  description: 'Import a health export file (Apple Health, Health Connect, Health Auto Export, Gadgetbridge, Lumen events, canonical JSON/JSONL/CSV). Returns a job; its result is the import report.',
  input: T.Object({ fileRef: T.String({ minLength: 1 }), format: T.Optional(T.String()) }),
  output: ImportReport,
  perm: 'write',
  impact: 'low',
  surfaces: UI_ONLY.surfaces,
  excludedReason: UI_ONLY.excludedReason(DEVICE),
  undo: UNDO.TS,
  idempotency: 'key',
  longRunning: job,
  owner: OWNER,
});
export const bioDeviceConnect = def({
  id: 'bio.deviceConnect',
  title: 'Connect a device',
  description: 'Pair a Bluetooth ring the person chose in the browser’s device window (user gesture required) and read its history. Returns a job.',
  input: T.Object({ driver: T.String({ minLength: 1 }), linkRef: T.Optional(T.String({ minLength: 1 })) }),
  output: DeviceReport,
  perm: 'write',
  impact: 'low',
  surfaces: UI_ONLY.surfaces,
  excludedReason: { ...UI_ONLY.excludedReason(DEVICE), ui: 'the ring service (src/biometrics/service) reads rings; kept for a staged browser link' },
  undo: UNDO.TS,
  idempotency: 'key',
  longRunning: job,
  owner: OWNER,
});
export const bioDeviceSync = def({
  id: 'bio.deviceSync',
  title: 'Sync a device',
  description: 'Read new data from a paired Bluetooth ring now (user gesture required). Returns a job.',
  input: T.Object({ sourceKey: T.String({ minLength: 1 }), linkRef: T.Optional(T.String({ minLength: 1 })) }),
  output: DeviceReport,
  perm: 'write',
  impact: 'low',
  surfaces: UI_ONLY.surfaces,
  excludedReason: { ...UI_ONLY.excludedReason(DEVICE), ui: 'the ring service (src/biometrics/service) reads rings; kept for a staged browser link' },
  undo: UNDO.TS,
  idempotency: 'key',
  longRunning: job,
  owner: OWNER,
});
export const bioSetPolicy = def({
  id: 'bio.setPolicy',
  title: 'Sharing policy',
  description:
    'How a biometric stream may be used: brought in at all, in Vitals’ scores, in the plan, and what the Coach sees. For the person (every source) or one source. Bringing a stream in is needed for everything else; vendor scores never feed scores or the plan.',
  input: T.Object({
    stream: T.String({ minLength: 1 }),
    policy: T.Object({ stream: T.Optional(T.String()), imported: T.Optional(T.Boolean()), coach: T.Optional(Coach), engine: T.Optional(T.Boolean()), scores: T.Optional(T.Boolean()) }),
    sourceKey: T.Optional(T.String({ minLength: 1 })),
  }),
  output: T.Array(StreamPolicySchema),
  perm: 'write',
  impact: 'consequential',
  surfaces: UI_ONLY.surfaces,
  excludedReason: UI_ONLY.excludedReason(CONSENT),
  undo: UNDO.IP,
  idempotency: 'natural',
  owner: OWNER,
});
export const bioSetRingSharing = def({
  id: 'bio.setRingSharing',
  title: 'Use my ring data in my plan and Coach',
  description:
    'The ring master switch (plan 04 item 11). On: every stream of every ring source is brought in, used in scores and the plan where it can be, and the Coach sees daily values and detail. Off: still brought in and shown on the Ring pages, but not used in scores or the plan and hidden from the Coach. Returns the switch state over all ring sources.',
  input: T.Object({ on: T.Boolean() }),
  output: T.Object({ state: RingSharing }),
  perm: 'write',
  impact: 'consequential',
  surfaces: UI_ONLY.surfaces,
  excludedReason: UI_ONLY.excludedReason(CONSENT),
  undo: UNDO.IP,
  idempotency: 'natural',
  owner: OWNER,
});
export const bioDismissRingDefaultsNotice = def({
  id: 'bio.dismissRingDefaultsNotice',
  title: 'Hide the ring data notice',
  description: 'Hides the one-time notice on the Ring page that existing ring data now feeds the plan, scores and Coach.',
  input: T.Object({}),
  output: T.Object({ dismissed: T.Boolean() }),
  perm: 'write',
  impact: 'low',
  surfaces: UI_ONLY.surfaces,
  excludedReason: UI_ONLY.excludedReason(SCREEN),
  undo: UNDO.none,
  idempotency: 'natural',
  owner: OWNER,
});
export const biometricsRingFold = def({
  id: 'biometrics.ringFold',
  title: 'One ring, one source',
  description:
    'Migration the app runs itself: a ring source keyed from what the ring advertised, or a Lumen source under an old key, moves into the ring’s one source; with exactly one J-Style 2301 ring, Lumen data folds into it. Nothing is duplicated.',
  input: T.Object({}),
  output: T.Object({
    ran: T.Boolean(),
    moved: T.Array(T.Object({ from: T.String(), to: T.String() })),
    lumen: T.Union([T.String(), T.Null()]),
    ambiguous: T.Boolean(),
  }),
  perm: 'write',
  impact: 'low',
  surfaces: ['ui'],
  excludedReason: {
    ui: 'a migration the app runs itself (system actor)',
    ai: 'a migration the app runs itself',
    webmcp: 'a migration the app runs itself',
    mcp: 'a migration the app runs itself',
  },
  undo: UNDO.none,
  idempotency: 'natural',
  owner: OWNER,
});
export const biometricsRingDefaults = def({
  id: 'biometrics.ringDefaults',
  title: 'Move ring data to the ring defaults',
  description:
    'One-time migration the app runs itself: every ring source whose sharing the person never changed gets the ring defaults (plan, scores, Coach), with a notice on the Ring page.',
  input: T.Object({}),
  output: T.Object({ ran: T.Boolean(), moved: T.Array(T.String()), kept: T.Array(T.String()) }),
  perm: 'write',
  impact: 'low',
  surfaces: ['ui'],
  excludedReason: {
    ui: 'a one-time migration the app runs itself (system actor)',
    ai: 'a one-time migration the app runs itself',
    webmcp: 'a one-time migration the app runs itself',
    mcp: 'a one-time migration the app runs itself',
  },
  undo: UNDO.none,
  idempotency: 'natural',
  owner: OWNER,
});
export const bioDeleteSource = def({
  id: 'bio.deleteSource',
  title: 'Delete a source',
  description: 'Delete a data source and everything recorded from it (records, raw samples, the scores they fed). Logs and plans stay.',
  input: T.Object({ sourceKey: T.String({ minLength: 1 }) }),
  output: T.Object({ deleted: T.Boolean() }),
  perm: 'destructive',
  surfaces: UI_ONLY.surfaces,
  excludedReason: UI_ONLY.excludedReason(CONSENT),
  undo: UNDO.none,
  idempotency: 'natural',
  owner: OWNER,
});
export const bioRescore = def({
  id: 'bio.rescore',
  title: 'Recompute scores',
  description: 'Recompute scores (all or some) from a date, newest 90 days first. Returns a job.',
  input: T.Object({ scoreIds: T.Optional(T.Array(T.String())), from: T.Optional(LocalDate) }),
  output: RescoreReport,
  perm: 'write',
  impact: 'low',
  surfaces: ['ui'],
  excludedReason: {
    ui: 'background maintenance the app schedules itself (after imports and changes)',
    ai: 'background maintenance the app schedules itself',
    webmcp: 'background maintenance the app schedules itself',
    mcp: 'background maintenance the app schedules itself',
  },
  undo: UNDO.none,
  idempotency: 'natural',
  longRunning: job,
  owner: OWNER,
});

// Settings › Devices (src/features/settings/devices/DevicesSection.tsx) calls these; `bio.setPolicy` also the intake's
// devices chapter; the Ring page and Settings › Devices the ring master switch and its notice. `bio.rescore` is
// dispatched by the app itself (SYSTEM actor, `../bio/index.ts`), never from a screen, and so is the migration
// `biometrics.ringDefaults`.
onScreen('bio.sources', 'bio.setPolicy', 'bio.import', 'bio.deleteSource', 'bio.setRingSharing', 'bio.dismissRingDefaultsNotice');

declare module '../types' {
  interface CommandMap {
    'bio.daily': typeof bioDaily;
    'bio.series': typeof bioSeries;
    'bio.baselines': typeof bioBaselines;
    'bio.sources': typeof bioSources;
    'bio.scores': typeof bioScores;
    'bio.manual': typeof bioManual;
    'bio.import': typeof bioImport;
    'bio.deviceConnect': typeof bioDeviceConnect;
    'bio.deviceSync': typeof bioDeviceSync;
    'bio.setPolicy': typeof bioSetPolicy;
    'bio.deleteSource': typeof bioDeleteSource;
    'bio.rescore': typeof bioRescore;
    'bio.setRingSharing': typeof bioSetRingSharing;
    'bio.dismissRingDefaultsNotice': typeof bioDismissRingDefaultsNotice;
    'biometrics.ringDefaults': typeof biometricsRingDefaults;
    'biometrics.ringFold': typeof biometricsRingFold;
  }
}
