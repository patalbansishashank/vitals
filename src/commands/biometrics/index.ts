/**
 * `biometrics.*` (SUITE_SPEC §14.6, E28): one truth per record — a correction, else the device, else nothing.
 *
 * - `biometrics.correct` stores the person's value for one record key in `bioCorrections` (edit class: from the Coach
 *   or an agent the bus stages it as a proposal; from the correction sheet it applies on confirm). Ingest never writes
 *   that collection, so later device records, a re-import or a replayed MQTT message never replace a correction.
 * - `biometrics.clearCorrection` brings the device value back ("Use the device value again").
 * - `biometrics.dropPriorities` is the one-time migration (system actor, idempotent): retired source priorities are
 *   removed and entries by hand on a device-owned stream become corrections when they differ from the device value,
 *   else are dropped as duplicates.
 *
 * The redirect rules installed here make `log.sleep`, `log.steps`, `log.measurement` and `bio.manual` for a stream a
 * device owns either a staged `biometrics.correct` proposal (Coach, agents) or `precondition_failed` with
 * `detail.reason = 'device_owned'` (a direct UI dispatch: the screens show the device value and a Correct action).
 */
import { getDocumentStore } from '@/state/runtime';
import { sharedBioIndex, type BioDocIndex } from '@/biometrics/store/docIndex';
import { isManualSource, resolveDays } from '@/biometrics/core/resolve';
import { ownedFamilies, streamOwner, type OwnedFamily } from '@/biometrics/core/policy';
import type { BioCorrection, BioRecord, DailyRecord, LocalDate, SleepRecord, SpotRecord } from '@/biometrics/core/types';
import { setRedirectReady, setRedirectRule, dispatch, type RedirectDecision } from '../bus';
import { defineCommand, fail } from '../registry';
import { T } from '../schema';
import { ALL, UNDO } from '../defs/_shared';
import { SYSTEM_ACTOR, type Actor, type CommandContext, type CommandId } from '../types';
import { scheduleRescore } from '../bio/runtime';
import { checkCorrection, correctionFromLog, correctionKey, deviceRecordFor, familyOfTarget, type CorrectInput } from './correction';

const LocalDateS = T.Date();
const DAILY_GROUPS = ['steps', 'distance_m', 'active_kcal', 'total_kcal', 'active_min', 'resting_hr_bpm', 'hr', 'hrv', 'spo2', 'resp_rate_brpm', 'skin_temp', 'body_temp_c', 'vo2max'] as const;
const SPOT_METRICS = ['weight_kg', 'body_fat_pct', 'lean_mass_kg', 'waist_cm', 'bp_sys_mmhg', 'bp_dia_mmhg', 'glucose_mg_dl', 'body_temp_c', 'hr_bpm', 'spo2_pct', 'hrv_ms'] as const;

const TargetS = T.Union([
  T.Object({ kind: T.Literal('sleep'), localDate: LocalDateS }, { description: 'The main sleep that ended on this date.' }),
  T.Object({ kind: T.Literal('daily'), localDate: LocalDateS, metric: T.Enum(DAILY_GROUPS) }, { description: 'A daily total (steps, resting_hr_bpm, …).' }),
  T.Object({ kind: T.Literal('spot'), localDate: LocalDateS, metric: T.Enum(SPOT_METRICS), at: T.Optional(T.Instant()) }, { description: 'A reading (weight_kg, body_fat_pct, hrv_ms, …); `at` when the day has several.' }),
]);
const ValueS = T.Union([
  T.Object({ asleepS: T.Integer({ minimum: 1, maximum: 86400, description: 'Seconds asleep.' }), bedAt: T.Optional(T.Instant()), wakeAt: T.Optional(T.Instant()) }),
  T.Object({ fields: T.OpenObject({ description: 'The daily fields of the metric, e.g. { "steps": 9000 } or { "resting_hr_bpm": 52 }.' }) }),
  T.Object({ value: T.Number() }),
]);

/** Stable id of a correction (a score's `sourceIds` carries it). */
const correctionIdOf = (key: string, at: string) => `corr:${key}@${at}`;

const actorLabel = (a: Actor): string => (a.onBehalfOf ? `${a.kind}:${a.id} for ${a.onBehalfOf.kind}:${a.onBehalfOf.id}` : `${a.kind}:${a.id}`);

async function readyIndex(): Promise<BioDocIndex> {
  const ix = sharedBioIndex(getDocumentStore());
  await ix.ready;
  return ix;
}

const sourcedOn = (ix: BioDocIndex, d: LocalDate) => ix.latestRecords(d, d).map((e) => ({ sourceKey: e.sourceKey, record: e.record }));

/* ---------------------------------------------------------------- biometrics.correct */

export async function correct(ctx: CommandContext, input: CorrectInput) {
  const bad = checkCorrection(input, ctx.today);
  if (bad) fail('invalid_input', bad.message, { path: bad.path });
  const ix = await readyIndex();
  const key = correctionKey(input.target);
  const replaced = deviceRecordFor(input.target, sourcedOn(ix, input.target.localDate), ix.sources());
  // A put stamps only the fields whose value changed (`fieldMerge.stamp`), so writing the same `clearedAt: null` the
  // replica already holds would leave an older offline clear from another device in force. Flip between null and
  // absent (both mean active) so this put always owns `clearedAt` and the later correction wins (R20-WRITERS-02).
  const cur = await ctx.docs.get<BioCorrection>('bioCorrections', key);
  const active = cur && cur.clearedAt === null ? {} : { clearedAt: null };
  const doc: BioCorrection = {
    correctionId: correctionIdOf(key, ctx.now),
    key,
    target: input.target,
    value: input.value,
    ...(input.note ? { note: input.note.slice(0, 500) } : {}),
    createdAt: ctx.now,
    actor: actorLabel(ctx.actor),
    replaced,
    ...active,
  };
  await ctx.docs.put('bioCorrections', { ...doc, _id: key });
  scheduleRescore(input.target.localDate);
  return { correctionId: doc.correctionId, key, replaced: replaced ? { sourceKey: replaced.sourceKey, recordId: replaced.recordId } : null };
}

export const biometricsCorrect = defineCommand({
  id: 'biometrics.correct',
  version: 1,
  title: 'Correct a device value',
  description:
    'Put the person’s own value over what a device recorded for one night, daily total or reading (e.g. "slept six hours, the ring was off"). The correction wins over every device record for that key, now and later; the device value stays stored and comes back with biometrics_clear_correction. The person confirms it in Vitals.',
  input: T.Object({ target: TargetS, value: ValueS, note: T.Optional(T.String({ maxLength: 500 })) }),
  output: T.Object({ correctionId: T.String(), key: T.String(), replaced: T.Nullable(T.Object({ sourceKey: T.String(), recordId: T.String() })) }),
  perm: 'write',
  impact: 'consequential',
  surfaces: ALL,
  undo: UNDO.RT,
  idempotency: 'key',
  sideEffects: ['docs'],
  execute: (ctx, input) => correct(ctx, input as CorrectInput),
});

/* ---------------------------------------------------------------- biometrics.clearCorrection */

export async function clearCorrection(ctx: CommandContext, input: { key: string }) {
  const cur = await ctx.docs.get<BioCorrection>('bioCorrections', input.key);
  if (!cur || cur.clearedAt) fail('not_found', 'There is no correction for that value.', { path: '/key' });
  await ctx.docs.patch('bioCorrections', input.key, { clearedAt: ctx.now });
  scheduleRescore(cur.target.localDate);
  return { key: input.key, cleared: true };
}

export const biometricsClearCorrection = defineCommand({
  id: 'biometrics.clearCorrection',
  version: 1,
  title: 'Use the device value again',
  description: 'Remove the person’s correction for one key (as returned by biometrics_correct, e.g. "sleep:2026-10-02"); the device value is used again.',
  input: T.Object({ key: T.String({ minLength: 1, maxLength: 120 }) }),
  output: T.Object({ key: T.String(), cleared: T.Boolean() }),
  perm: 'write',
  impact: 'low',
  surfaces: ALL,
  undo: UNDO.RT,
  idempotency: 'natural',
  sideEffects: ['docs'],
  execute: (ctx, input) => clearCorrection(ctx, input),
});

/* ---------------------------------------------------------------- biometrics.dropPriorities (migration) */

/** The family an entry by hand belongs to, if a device could own it. */
function familyOfRecord(r: BioRecord): OwnedFamily | null {
  if (r.kind === 'sleep') return 'sleep_sessions';
  if (r.kind === 'daily') return r.steps !== undefined ? 'steps' : r.resting_hr_bpm !== undefined ? 'resting_hr' : null;
  if (r.kind === 'spot') return r.metric === 'weight_kg' || r.metric === 'body_fat_pct' ? 'body' : r.metric === 'hrv_ms' ? 'hrv' : null;
  return null;
}

/** The correction an entry by hand would be, and its comparable value. */
function asCorrection(r: BioRecord): { input: CorrectInput; value: number } | null {
  const d = r.time.local_date;
  if (r.kind === 'sleep') return { input: { target: { kind: 'sleep', localDate: d }, value: { asleepS: (r as SleepRecord).asleep_s } }, value: (r as SleepRecord).asleep_s };
  if (r.kind === 'daily') {
    const x = r as DailyRecord;
    if (x.steps !== undefined) return { input: { target: { kind: 'daily', localDate: d, metric: 'steps' }, value: { fields: { steps: x.steps } } }, value: x.steps };
    if (x.resting_hr_bpm !== undefined) return { input: { target: { kind: 'daily', localDate: d, metric: 'resting_hr_bpm' }, value: { fields: { resting_hr_bpm: x.resting_hr_bpm } } }, value: x.resting_hr_bpm };
    return null;
  }
  if (r.kind === 'spot') {
    const s = r as SpotRecord;
    return { input: { target: { kind: 'spot', localDate: d, metric: s.metric }, value: { value: s.value } }, value: s.value };
  }
  return null;
}

/** The device's value for the key of `c`, if any (resolved over device records only, no corrections). */
function deviceValueOf(ix: BioDocIndex, c: CorrectInput): number | null {
  const t = c.target;
  const devices = sourcedOn(ix, t.localDate).filter((r) => !isManualSource(r.sourceKey, r.record));
  const day = resolveDays(devices, ix.sources(), { from: t.localDate, to: t.localDate })[0];
  if (!day) return null;
  if (t.kind === 'sleep') return day.mainSleep?.asleep_s ?? null;
  if (t.kind === 'daily') {
    const v = (day.daily as unknown as Record<string, unknown> | undefined)?.[t.metric];
    return typeof v === 'number' ? v : null;
  }
  const spots = day.spots.filter((s) => s.metric === t.metric);
  return spots.length ? spots[spots.length - 1]!.value : null;
}

const same = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 0.005);

export async function dropPriorities(ctx: CommandContext) {
  const ix = await readyIndex();
  const report: string[] = [];
  let sourcesCleared = 0;
  for (const s of ix.sources()) {
    if (s.priority === undefined && s.priorityByMetric === undefined) continue;
    await ctx.docs.patch('bioSources', s.sourceKey, { priority: null, priorityByMetric: null });
    sourcesCleared++;
  }
  if (sourcesCleared) report.push(`removed the stored priority of ${sourcesCleared} source(s)`);
  const owned = ownedFamilies(ix.sources());
  let corrections = 0;
  let duplicates = 0;
  let earliest: LocalDate | null = null;
  for (const e of ix.latestRecords()) {
    if (!isManualSource(e.sourceKey, e.record)) continue;
    const fam = familyOfRecord(e.record);
    if (!fam || !owned[fam]) continue;
    const c = asCorrection(e.record);
    if (!c) continue;
    const key = correctionKey(c.input.target);
    const device = deviceValueOf(ix, c.input);
    const existing = ix.correction(key);
    if (device !== null && same(c.value, device)) {
      duplicates++;
      report.push(`${key}: the entry by hand matched ${owned[fam]!.label}; dropped as a duplicate`);
    } else if (existing && !existing.clearedAt) {
      duplicates++;
      report.push(`${key}: a correction already exists; the entry by hand was dropped`);
    } else {
      const doc: BioCorrection = {
        correctionId: correctionIdOf(key, e.record.provenance.ingested_at || ctx.now),
        key,
        target: c.input.target,
        value: c.input.value,
        note: 'Moved from an entry by hand',
        createdAt: e.record.provenance.ingested_at || ctx.now,
        actor: actorLabel(ctx.actor),
        replaced: deviceRecordFor(c.input.target, sourcedOn(ix, c.input.target.localDate), ix.sources()),
      };
      await ctx.docs.put('bioCorrections', { ...doc, _id: key });
      corrections++;
      report.push(`${key}: the entry by hand became a correction (device ${device ?? 'none'} → ${c.value})`);
    }
    for (const docId of [...ix.versionsOf(e.record.record_id)]) await ctx.docs.remove('bioRecords', docId);
    if (!earliest || e.record.time.local_date < earliest) earliest = e.record.time.local_date;
  }
  if (earliest) scheduleRescore(earliest);
  return { sourcesCleared, corrections, duplicatesDropped: duplicates, report };
}

export const biometricsDropPriorities = defineCommand({
  id: 'biometrics.dropPriorities',
  version: 1,
  title: 'Drop source priorities',
  description: 'One-time migration the app runs itself: removes the retired source priorities and turns entries by hand on a device-owned stream into corrections (or drops them when they match the device).',
  input: T.Object({}),
  output: T.Object({ sourcesCleared: T.Integer(), corrections: T.Integer(), duplicatesDropped: T.Integer(), report: T.Array(T.String()) }),
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
  sideEffects: ['docs'],
  execute: (ctx) => {
    if (ctx.actor.kind !== 'system') fail('precondition_failed', 'Vitals runs this itself.', { rule: 'system_actor' });
    return dropPriorities(ctx);
  },
});

declare module '../types' {
  interface CommandMap {
    'biometrics.correct': typeof biometricsCorrect;
    'biometrics.clearCorrection': typeof biometricsClearCorrection;
    'biometrics.dropPriorities': typeof biometricsDropPriorities;
  }
}

/* ---------------------------------------------------------------- redirect rules (§14.6 a) */

const AGENT_KINDS = new Set(['ai', 'webmcp', 'mcp', 'companion']);
const FAMILY_WORDS: Record<OwnedFamily, string> = {
  sleep_sessions: 'sleep',
  steps: 'steps',
  body: 'weight and body fat',
  resting_hr: 'resting heart rate',
  hrv: 'heart rate variability',
  workouts: 'workouts',
};

/** The owner of a family now (null while the index is still loading: nothing is redirected then). */
function ownerNow(family: OwnedFamily): { sourceKey: string; label: string } | null {
  const ix = sharedBioIndex(getDocumentStore());
  return ix.isLoaded ? streamOwner(family, ix.sources()) : null;
}

setRedirectReady(() => sharedBioIndex(getDocumentStore()).ready);

const deviceOwned = (c: { family: OwnedFamily }, owner: { sourceKey: string; label: string }): RedirectDecision => ({
  refuse: {
    code: 'precondition_failed' as const,
    message: `${owner.label} records your ${FAMILY_WORDS[c.family]}. Use Correct on the value instead.`,
    detail: { reason: 'device_owned', rule: `device_owned:${c.family}`, sourceKey: owner.sourceKey },
  },
});

/** `log.bulk` can append steps entries and `log.edit` can supersede a steps or sleep entry: both would write a hand
 * entry for a stream a device owns without going through `log.steps` / `log.sleep`. */
setRedirectRule('log.bulk' as CommandId, (input, actor) => {
  if (actor.kind === 'system') return null;
  const days = (input as { days?: Array<{ entries?: Array<Record<string, unknown>> }> }).days ?? [];
  const hasSteps = days.some((d) => (d.entries ?? []).some((e) => e?.kind === 'steps'));
  const owner = hasSteps ? ownerNow('steps') : null;
  return owner ? deviceOwned({ family: 'steps' }, owner) : null;
});
setRedirectRule('log.edit' as CommandId, (input, actor, at): RedirectDecision => {
  if (actor.kind === 'system') return null;
  const { entryId, patch } = input as { entryId: string; patch: Record<string, unknown> };
  const e = getDocumentStore().peek<Record<string, unknown>>('dailyLogs', entryId);
  if (!e || !patch) return null;
  const c =
    e.kind === 'steps' && 'steps' in patch
      ? correctionFromLog('log.steps', { date: e.date, steps: patch.steps }, at)
      : e.kind === 'sleep' && ('bedAt' in patch || 'wakeAt' in patch)
        ? correctionFromLog('log.sleep', { bedAt: patch.bedAt ?? e.bedAt, wakeAt: patch.wakeAt ?? e.wakeAt }, at)
        : null;
  const owner = c ? ownerNow(c.family) : null;
  if (!c || !owner) return null;
  if (AGENT_KINDS.has(actor.kind)) return { stage: { id: 'biometrics.correct' as CommandId, input: c.input } };
  return deviceOwned(c, owner);
});

for (const id of ['log.sleep', 'log.steps', 'log.measurement', 'bio.manual'] as CommandId[]) {
  setRedirectRule(id, (input, actor, at): RedirectDecision => {
    if (actor.kind === 'system') return null;
    const c = correctionFromLog(id, input as Record<string, unknown>, at);
    if (!c) return null;
    const owner = ownerNow(c.family);
    if (!owner || familyOfTarget(c.input.target) !== c.family) return null;
    if (AGENT_KINDS.has(actor.kind)) return { stage: { id: 'biometrics.correct' as CommandId, input: c.input } };
    return deviceOwned(c, owner);
  });
}

/* ---------------------------------------------------------------- running the migration once */

function isTest(): boolean {
  return (import.meta as { env?: { MODE?: string } }).env?.MODE === 'test';
}

/** True when the stored data still has something `biometrics.dropPriorities` would change. */
export function needsPriorityMigration(ix: BioDocIndex): boolean {
  if (ix.sources().some((s) => s.priority !== undefined || s.priorityByMetric !== undefined)) return true;
  const owned = ownedFamilies(ix.sources());
  return ix.latestRecords().some((e) => isManualSource(e.sourceKey, e.record) && (() => {
    const f = familyOfRecord(e.record);
    return !!f && !!owned[f];
  })());
}

let migrationStarted = false;

/** Run the one-time migration as the system actor when the stored data needs it (once per page load). */
export async function runPriorityMigration(): Promise<void> {
  if (migrationStarted) return;
  migrationStarted = true;
  const ix = await readyIndex();
  if (!needsPriorityMigration(ix)) return;
  const r = await dispatch('biometrics.dropPriorities', {}, { actor: SYSTEM_ACTOR });
  if (!r.ok) console.warn('Vitals: moving entries by hand into corrections did not finish', r.error);
  else if ('output' in r) console.info('Vitals: biometrics migration', r.output);
}

if (!isTest() && typeof globalThis.addEventListener === 'function') {
  // after the app has booted its store (this module loads with the command registry, before the store exists)
  setTimeout(() => {
    try {
      void getDocumentStore()
        .ready.then(() => runPriorityMigration())
        .catch(() => undefined);
    } catch {
      /* no store in this context */
    }
  }, 3000);
}
