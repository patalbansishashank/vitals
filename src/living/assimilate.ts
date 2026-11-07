/**
 * The living plan's estimation loop (docs/SUITE_SPEC.md §3.5) over its documents: weigh-ins with their standardisation
 * and event noise, the realised schedule (logged days replace forecast days), anchors and δ steps from the synced
 * `ConfirmedStateRecord`s, the daily assimilation (replay + filter, no anchor move), the weekly check-in that produces a
 * new record and PLANNER_V2's `ConfirmedState`, hard re-anchor triggers, the check-in due rule and the forecast band of a
 * day. Pure: engine work goes through `@/engine/assimilation` (deterministic), documents come from the caller.
 *
 * Re-audit 2026-10-19: measurements sit at their own occurrence (`measurementSample`, A1-018); every record carries the
 * derivation lineage of its anchor and the current state replays `currentAnchors` — originals whose lineage still holds,
 * recomputations from the first record whose evidence was retracted/revised or whose estimator changed (A1-017) — while
 * the records, their decisions and the applied correction ledger never change.
 */
import { ENGINE_VERSION } from '@/engine/core/defaults';
import { fnv1a } from '@/engine/core/math';
import type { AnchorSpec, DayTemplate, EngineSnapshot, FastEvent, IntakeOffset, Schedule, SeriesId } from '@/engine';
import {
  CONTRACT_FINGERPRINT,
  CONTRACT_VERSIONS,
  dateOnlyOccurrence,
  derivationLineage,
  lineageInvalidation,
  stampDerived,
  type ConsumedObservationRef,
  type DerivationLineage,
  type LineageInvalidation,
  type OccurrenceTime,
} from '@/lib/bodyContracts';
import { BALANCE_CORRECTION_BOUNDS, boundBalanceCorrection, fatMassObservation, legacyMeasurementContext, type BodyCompositionMethod, type BodyCompositionObservation, type OperatorId } from '@/lib/measurementOperators';
import {
  ASSIMILATION_DEFAULTS,
  boundedTransientSdKg,
  buildRealisedSchedule,
  estimatorIdentity as engineEstimatorIdentity,
  runCheckIn,
  runReplay,
  runTrendFilter,
  estimateDowOffsets,
  type AssimilationParams,
  type CheckInOutput,
  type CompositionReading,
  type CompositionReadings,
  type IntakeDayEvidence,
  type ReplayOutput,
  type TrendPoint,
  type WeighInObs,
} from '@/engine/assimilation';
import { observationSampleTime } from '@/engine/assimilation/realised';
import { sampleAt, type ObservationTiming } from '@/engine/assimilation/replay';
import { addDays, daysBetween, weekdayOf } from './dates';
import { planDay, scheduledCheckInDate } from './calendar';
import { projectEntries } from './logs';
import { templateOfDay } from './prescription';
import { REALISED_HISTORY_REDUCER_VERSION } from './realisedHistory';
import type { LoggedDayResult } from './loggedDay';
import type { ConfirmedState } from './plannerContract';
import type { CompositionEvidence, ConfirmedStateRecord, DerivedAnchorRecord, HardReanchorReason, LocalDate, LogEntry, MeasurementEntry, PlanDoc, PlanVersionDoc } from './types';
import type { PersonProfile } from '@/engine/types/profile';

/** Stable JSON (sorted keys) for hashing. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (ArrayBuffer.isView(v)) return `[${Array.from(v as unknown as ArrayLike<number>).join(',')}]`;
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}

/** Deterministic content hash (fnv-1a over stable JSON, two seeds → 16 hex chars; a cache key, not a security hash). */
export function contentHash(v: unknown): string {
  const s = stableStringify(v);
  return fnv1a(s) + fnv1a(`#${s}`);
}

// ------------------------------------------------------------------------------------------- measurement time (A1-018)
const DAY_MS_LOCAL = 86_400_000;

/** Wall-clock date and hour of an instant as written (its own offset), or shifted by a recorded UTC offset. */
function wallClock(instant: string, offsetMin: number | undefined): { date: string; hour: number } | null {
  const t = Date.parse(instant);
  if (!Number.isFinite(t)) return null;
  if (offsetMin !== undefined && Number.isFinite(offsetMin)) {
    const d = new Date(t + offsetMin * 60_000);
    return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600 };
  }
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(instant);
  return m ? { date: m[1]!, hour: Number(m[2]) + Number(m[3]) / 60 + Number(m[4] ?? 0) / 3600 } : null;
}

function validZone(tz: string | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * (C1/A1-018) Where a measurement sits on the plan's time axis: an exact occurrence is placed on the calendar day and
 * clock hour of its instant in the declared zone (`occurrence.tz`, DST-aware; else its recorded UTC offset, else the
 * offset it was written with), an interval keeps its hour span, and a date-only or untimed reading keeps its occurrence
 * date (else the record date) with no clock. The entry/recorded time is never used. A record date that contradicts the
 * instant's day (beyond the app-day rollover) is kept as submitted and flagged `dateConflict`; the instant places it.
 */
export function measurementSample(plan: Pick<PlanDoc, 'startDate'>, m: Pick<MeasurementEntry, 'date' | 'occurrence'>): { day: number; timing: ObservationTiming; dateConflict?: true } {
  const occ = m.occurrence;
  const dayOf = (date: string): number => planDay(plan, date);
  // the record date and the instant's day disagree beyond the app-day rollover: kept as submitted, flagged, instant wins
  const placed = (day: number, timing: ObservationTiming): { day: number; timing: ObservationTiming; dateConflict?: true } => {
    const recorded = dayOf(m.date);
    const start = timing.hour ?? timing.hourSpan?.[0] ?? 0;
    const rollover = occ?.dateMeaning === 'appDay' && occ.rolloverH !== undefined && recorded === day - 1 && start < occ.rolloverH;
    return recorded === day || rollover ? { day, timing } : { day, timing, dateConflict: true };
  };
  if (occ && (occ.precision === 'exact' || occ.precision === 'interval') && validZone(occ.tz)) {
    const s = observationSampleTime(plan.startDate, m.date, occ, occ.tz);
    if (s.precision === 'instant' || s.precision === 'interval') return placed(s.day, { precision: s.precision, ...(s.hour !== undefined ? { hour: s.hour } : {}), ...(s.hourSpan ? { hourSpan: s.hourSpan } : {}) });
  }
  if (occ?.precision === 'exact' && occ.at) {
    const w = wallClock(occ.at, occ.offsetMin);
    if (w) return placed(dayOf(w.date), { precision: 'instant', hour: w.hour });
  }
  if (occ?.precision === 'interval' && occ.interval) {
    const a = wallClock(occ.interval.start, occ.offsetMin);
    const b = wallClock(occ.interval.end, occ.offsetMin);
    if (a && b) {
      const span = Math.round((Date.parse(`${b.date}T00:00:00Z`) - Date.parse(`${a.date}T00:00:00Z`)) / DAY_MS_LOCAL);
      return placed(dayOf(a.date), { precision: 'interval', hourSpan: [a.hour, b.hour + 24 * span] });
    }
  }
  const date = occ?.date ?? m.date;
  return { day: dayOf(date), timing: { precision: occ?.precision === 'unknown' && !occ.date ? 'unknown' : 'dateOnly' } };
}

// ------------------------------------------------------------------------------------------- weigh-ins
const EVENT_INFLATES: ReadonlySet<string> = new Set(['illness', 'travel', 'creatineStart', 'dietBreak']);

/**
 * Weigh-ins of the plan (the person's logged measurements; same-day values are averaged by the filter): a reading is
 * standardised only when its protocol context says so (`measurementContext`, else the legacy `context` 'morningFasted');
 * an unspecified or unknown context stays unknown and uses the unstandardised noise (C4/D5-04: old code defaulted it to
 * standardised; the stored value is not rewritten). Declared events (illness, travel, creatine start, diet break) and
 * block starts inflate the noise ×4 for 4 days. Assumed entries are never used. Each reading carries its context and
 * observation (revision) id; for a person who menstruates, the unmodelled cycle transient enters as observation variance
 * (D1-06: unknown amplitude is zero numeric contribution, never zero uncertainty). (A1-018) Each reading sits on the plan
 * day of its own occurrence (`measurementSample`) with its timing and occurrence, so the check-in removes the model water
 * of that hour; a date-only reading keeps the daily wake convention and is labelled `dateOnly`.
 */
export function weighInsFor(
  plan: Pick<PlanDoc, 'startDate'> & { baselineProfile?: PersonProfile },
  measurements: readonly MeasurementEntry[],
  events: readonly LogEntry[],
  blockStarts: readonly number[] = [],
  params: AssimilationParams = ASSIMILATION_DEFAULTS,
): WeighInObs[] {
  const inflate = new Map<number, number>();
  const mark = (d0: number): void => {
    for (let k = 0; k < params.eventDays; k++) inflate.set(d0 + k, params.eventRMult);
  };
  for (const e of projectEntries(events)) if (e.kind === 'event' && EVENT_INFLATES.has(e.event) && !e.assumed) mark(planDay(plan, e.date));
  for (const b of blockStarts) if (b > 0) mark(b);
  const out: WeighInObs[] = [];
  const transient = cycleTransientSdKg(plan.baselineProfile);
  for (const m of projectEntries(measurements)) {
    if (m.metric !== 'weightKg' || m.assumed || !Number.isFinite(m.value)) continue;
    const { day, timing } = measurementSample(plan, m);
    if (day < 0) continue;
    const context = m.measurementContext ?? legacyMeasurementContext(m.context);
    out.push({
      day,
      scaleKg: m.value,
      standardised: context === 'standardized',
      context,
      observationId: m.revision !== undefined ? `${m.id}@${m.revision}` : m.id,
      rMult: inflate.get(day) ?? 1,
      ...(transient !== undefined ? { transientSdKg: transient } : {}),
      timing,
      ...(m.occurrence ? { occurrence: m.occurrence } : {}),
    });
  }
  return out.sort((a, b) => a.day - b.day);
}

/**
 * (D1-06) Peak-to-trough range of the declared cycle-water assumption, kg: the legacy prior shape (water `cycleAmpKg`),
 * used only as a bound on an unmodelled transient (SD ≤ range/2), never as an individual amplitude.
 */
export const CYCLE_TRANSIENT_RANGE_KG = 0.2;

/** Transient SD for a person who menstruates (stated, or cycle tracking on); none when stated otherwise or unknown. */
export function cycleTransientSdKg(profile: PersonProfile | undefined): number | undefined {
  const c = profile?.cycle;
  if (!c || c.menstruating === 'no') return undefined;
  if (c.menstruating !== 'yes' && !c.tracking) return undefined;
  return boundedTransientSdKg(CYCLE_TRANSIENT_RANGE_KG) ?? undefined;
}

/**
 * Ids (with revision) of the weigh-ins `weighInsFor` uses on plan days [fromDay, toDay]: the observations a check-in
 * decision consumes (C4/D5-04: an observation revision is evidence once; a later decision over an overlapping window is a
 * recomputation from the documents, never new independent evidence).
 */
export function weighInIds(plan: Pick<PlanDoc, 'startDate'>, measurements: readonly MeasurementEntry[], fromDay: number, toDay: number): string[] {
  const out: string[] = [];
  for (const m of projectEntries(measurements)) {
    if (m.metric !== 'weightKg' || m.assumed || !Number.isFinite(m.value)) continue;
    const day = measurementSample(plan, m).day;
    if (day < Math.max(0, fromDay) || day > toDay) continue;
    out.push(m.revision !== undefined ? `${m.id}@${m.revision}` : m.id);
  }
  return out.sort();
}

/**
 * The trend/balance estimator a decision ran under (C4/C7, D5-04): the assimilation package's own identity — strategy
 * (fixed-prior refit of each eligible decision's window), estimator version and a hash of every assimilation parameter
 * and the correction law. A parameter change invalidates derived filters, records used for new decisions and cached
 * snapshots (the engine registry hash alone cannot).
 */
export function estimatorIdentity(params: AssimilationParams = ASSIMILATION_DEFAULTS): NonNullable<ConfirmedStateRecord['estimator']> {
  return engineEstimatorIdentity(params);
}

// ------------------------------------------------------------------------------------------- body composition (D5-07)
/**
 * Composition readings enter the weekly decision (D5-07): the measurement metadata (method, device, protocol, scan masses,
 * occurrence) and the engine's reading-at-time operator (each revision once, persistent device bias, waist corroborative
 * without a personal operator) ship together, so the check-in passes the readings and the ids earlier decisions consumed.
 * The single switch back to the dormant behaviour (readings kept and shown, never assimilated).
 */
export const COMPOSITION_ASSIMILATION_ENABLED = true;

const COMPOSITION_METHOD: Readonly<Partial<Record<NonNullable<MeasurementEntry['method']>, BodyCompositionMethod>>> = { dxa: 'dxa', bia: 'bia', skinfold: 'skinfold', navy: 'navy' };

/** A body-composition reading as an operator-ready observation at its own time, with its fat-mass operator (C4/D5-07). */
export interface CompositionObservation extends BodyCompositionObservation {
  /** Plan day of the reading's own occurrence (the instant's day in its zone; else its occurrence/record date). */
  day: number;
  /** (A1-018) clock time on that day: instant hour, interval span, or none (date-only / unknown). */
  timing: ObservationTiming;
  /** The occurrence was recorded with the reading (absent = a legacy date, read as date-only). */
  explicitOccurrence: boolean;
  /** The record date contradicts the occurrence instant's day (kept as submitted; the instant places the reading). */
  dateConflict?: true;
  /** FM kg from scan FM or % × the same scan's mass; else the percent operator; null = not usable as a reading. */
  fatMass: ReturnType<typeof fatMassObservation>;
  operator: OperatorId | null;
}

/**
 * Body-composition readings of the plan as observations (D5-07): one per effective reading revision (edits supersede,
 * retractions remove), placed at the reading's own occurrence (`measurementSample`: a date-only reading keeps its date,
 * never a guessed clock), method/device/protocol as logged (legacy readings without a method stay 'unknown'), scan FM kg
 * preferred, % × scan mass only with that scan's own mass (never the nearest scale weight), derivation parents kept.
 * Assumed entries are never used.
 */
export function compositionObservations(plan: Pick<PlanDoc, 'startDate'>, measurements: readonly MeasurementEntry[]): CompositionObservation[] {
  const out: CompositionObservation[] = [];
  for (const m of projectEntries(measurements)) {
    if (m.metric !== 'bodyFatPct' || m.assumed || !Number.isFinite(m.value)) continue;
    const method: BodyCompositionMethod = (m.method ? COMPOSITION_METHOD[m.method] : undefined) ?? 'unknown';
    const occurrence: OccurrenceTime = m.occurrence ?? dateOnlyOccurrence(m.date, 'calendarLocal');
    const obs: BodyCompositionObservation = {
      observationId: m.id,
      ...(m.revision !== undefined ? { revision: m.revision } : {}),
      method,
      ...(m.device ? { device: m.device } : {}),
      occurrence,
      bodyFatPct: m.value,
      ...(m.scanFatMassKg !== undefined ? { scanFatMassKg: m.scanFatMassKg } : {}),
      ...(m.scanMassKg !== undefined ? { scanMassKg: m.scanMassKg } : {}),
      ...(m.protocol ? { protocol: m.protocol } : {}),
      parents: m.parents ?? [],
      provenance: m.source.by === 'device' ? 'measured' : 'reported',
    };
    const fatMass = fatMassObservation(obs);
    const { day, timing, dateConflict } = measurementSample(plan, m);
    out.push({ ...obs, day, timing, explicitOccurrence: m.occurrence !== undefined, ...(dateConflict ? { dateConflict } : {}), fatMass, operator: fatMass ? fatMass.operator : null });
  }
  return out.sort((a, b) => a.day - b.day || (a.observationId < b.observationId ? -1 : 1));
}

/**
 * The check-in's composition input (D5-07): every effective body-fat reading as an operator-ready reading at its own plan
 * day and time (method/device/protocol as logged, legacy readings 'unknown' — the engine skips what it cannot operate on),
 * scan FM and scan mass only as measured with that scan, its derivation parents (one raw scan is one observation), its
 * timing and occurrence (A1-018), and waist girths as observed outcomes (corroborative: no personal waist operator is
 * declared here). Undefined when there is nothing to pass.
 */
export function compositionReadingsFor(plan: Pick<PlanDoc, 'startDate'>, measurements: readonly MeasurementEntry[]): CompositionReadings | undefined {
  const readings: CompositionReading[] = compositionObservations(plan, measurements)
    .filter((o) => o.day >= 0)
    .map((o) => ({
      observationId: o.observationId,
      ...(o.revision !== undefined ? { revision: o.revision } : {}),
      day: o.day,
      method: o.method,
      ...(o.bodyFatPct !== undefined ? { bodyFatPct: o.bodyFatPct } : {}),
      ...(o.scanFatMassKg !== undefined ? { scanFatMassKg: o.scanFatMassKg } : {}),
      ...(o.scanMassKg !== undefined ? { scanMassKg: o.scanMassKg } : {}),
      ...(o.device ? { device: o.device } : {}),
      ...(o.protocol ? { protocol: o.protocol } : {}),
      ...(o.parents && o.parents.length > 0 ? { parents: o.parents } : {}),
      // an explicitly recorded occurrence travels with its timing; a legacy dated reading stays untimed (date-only)
      ...(o.explicitOccurrence ? { timing: o.timing, occurrence: o.occurrence } : {}),
    }));
  const waist: Array<{ day: number; cm: number; observationId: string }> = [];
  for (const m of projectEntries(measurements)) {
    if (m.metric !== 'waistCm' || m.assumed || !Number.isFinite(m.value)) continue;
    const day = measurementSample(plan, m).day;
    if (day >= 0) waist.push({ day, cm: m.value, observationId: m.revision !== undefined ? `${m.id}@${m.revision}` : m.id });
  }
  waist.sort((a, b) => a.day - b.day || (a.observationId < b.observationId ? -1 : 1));
  if (readings.length === 0 && waist.length === 0) return undefined;
  return { ...(readings.length > 0 ? { readings } : {}), ...(waist.length > 0 ? { waist } : {}) };
}

// ------------------------------------------------------------------------------------------- derivation lineage (A1-017)
/** Split a consumed key `id@revision` into its observation id and revision (0 when none). */
function splitKey(key: string): { id: string; revision: number } {
  const at = key.lastIndexOf('@');
  if (at > 0 && /^\d+$/.test(key.slice(at + 1))) return { id: key.slice(0, at), revision: Number(key.slice(at + 1)) };
  return { id: key, revision: 0 };
}

/**
 * (A1-017) The current effective observation graph as lineage references: every weigh-in, body-composition reading and
 * waist girth the check-in reads, by id/revision with a hash of the values used (value, scan masses, method/device,
 * parents, own time, context) and the occurrence it was assimilated at. The value hash is prefixed by kind (`w:` weigh-in,
 * `c:` composition), so equal numbers of different observables never collide.
 */
export function observationRefs(weighIns: readonly WeighInObs[], composition: CompositionReadings | undefined): ConsumedObservationRef[] {
  const out: ConsumedObservationRef[] = [];
  const atOf = (occ: OccurrenceTime | undefined, day: number): string => occ?.at ?? occ?.interval?.start ?? occ?.date ?? `day ${day}`;
  for (const o of weighIns) {
    if (o.observationId === undefined) continue;
    const { id, revision } = splitKey(o.observationId);
    out.push({ id, revision, valueHash: `w:${contentHash({ scaleKg: o.scaleKg, day: o.day, timing: o.timing, context: o.context ?? (o.standardised === undefined ? null : o.standardised) })}`, at: atOf(o.occurrence, o.day) });
  }
  for (const r of composition?.readings ?? []) {
    if (r.observationId === undefined) continue;
    const { method, bodyFatPct, scanFatMassKg, scanMassKg, device, protocol, parents, repeatabilitySdPct, systematicSdPct, day, timing } = r;
    out.push({ id: r.observationId, revision: r.revision ?? 0, valueHash: `c:${contentHash({ method, bodyFatPct, scanFatMassKg, scanMassKg, device, protocol, parents, repeatabilitySdPct, systematicSdPct, day, timing })}`, at: atOf(r.occurrence, r.day) });
  }
  for (const w of composition?.waist ?? []) {
    if (w.observationId === undefined) continue;
    const { id, revision } = splitKey(w.observationId);
    out.push({ id, revision, valueHash: `c:${contentHash({ cm: w.cm, day: w.day })}`, at: `day ${w.day}` });
  }
  return out;
}

/** Day of each lineage reference the decision on `day` could read (weigh-ins, readings and girths on or before it). */
function refsThrough(weighIns: readonly WeighInObs[], composition: CompositionReadings | undefined, day: number): ConsumedObservationRef[] {
  const c: CompositionReadings | undefined = composition
    ? { ...(composition.readings ? { readings: composition.readings.filter((r) => r.day <= day) } : {}), ...(composition.waist ? { waist: composition.waist.filter((w) => w.day <= day) } : {}) }
    : undefined;
  return observationRefs(weighIns.filter((o) => o.day <= day), c);
}

/**
 * (A1-017) Hash of the realised inputs a replay up to the morning of `day` reads: each past day's program content and the
 * fast events clipped to the hours before `day` (a late log or an edited past day changes it; later days never do).
 */
export function realisedPrefixHash(schedule: Schedule, day: number): string {
  const days = schedule.days.slice(0, Math.max(0, day)).map((d) => ({ ...d, program: stableStringify({ ...schedule.programs[d.program], id: undefined, label: undefined }) }));
  const end = day * 24;
  const events = (schedule.events ?? [])
    .filter((e) => e.startDay * 24 + e.startH < end)
    .map((e) => ({ ...e, durationH: Math.min(e.durationH, end - (e.startDay * 24 + e.startH)) }));
  return contentHash({ days, events });
}

/**
 * (D6-06/C1) The elapsed days' intake evidence for the check-in: energy coverage, calibration eligibility, how the amounts
 * were obtained and the shared-error groups, exactly as the day reduction reports them. The engine counts eligible days
 * from it and keeps the rest beside the estimate (never as a weight on the residual).
 */
export function intakeEvidenceOf(days: ReadonlyArray<{ planDay: number; result: Pick<LoggedDayResult, 'coverage' | 'calibrationEligible' | 'amountMethods' | 'uncertaintyGroups'> }>): IntakeDayEvidence[] {
  return days
    .filter((d) => d.planDay >= 0)
    .map((d) => ({
      day: d.planDay,
      coverage: d.result.coverage.energy ?? 'unknown',
      calibrationEligible: d.result.calibrationEligible,
      amountMethods: d.result.amountMethods,
      uncertaintyGroups: d.result.uncertaintyGroups.map((g) => ({ id: g.id, kind: g.kind })),
    }))
    .sort((a, b) => a.day - b.day);
}

// ------------------------------------------------------------------------------------------- realised schedule
/** Options of `realisedSchedule`: the shared realised history's fast events and identity (C2). */
export interface RealisedScheduleOptions {
  /**
   * Fasts of the elapsed history resolved in absolute time (`LivingHistory.fastEvents`). When given they replace the
   * per-day fast results (a fast that crosses midnight ends at its verified intake on whichever day it falls).
   */
  fastEvents?: readonly FastEvent[];
  /** Content hash and horizon of the realised history the past days came from (stamped on `Schedule.realised`). */
  history?: { contentHash: string; asOf: string };
  /**
   * (D8-06) Today's day result ("so far"). Only its observed sleep enters the replay: the night that ended this morning is an
   * observation (wake-date mapping) that initialises today, while everything else today stays the head's prescription.
   */
  current?: LoggedDayResult | null;
  /**
   * (energy SPEC §V3.4) Today's realised template (`todayActual`): linked approved actuals in their slots, approved unplanned
   * actuals added, fused steps so far plus the plan share of the rest of the awake day (a named prior), unperformed slots
   * as prescribed. When given it is today's input (with today's observed night); absent = today stays the head's day.
   */
  todayTemplate?: DayTemplate | null;
}

/**
 * Realised schedule of a plan as of `today`: the head version's schedule with every past day [0, today) replaced by its
 * `LoggedDay.inputs` (unknown days already carry the expected-credit inputs of the prescription frozen for that day) and
 * the past fasts by the realised ones. Assimilation, the check-in and re-planning all build it from the same history.
 */
export function realisedSchedule(plan: Pick<PlanDoc, 'startDate'>, head: PlanVersionDoc, past: readonly LoggedDayResult[], today: LocalDate, horizonDays?: number, opts: RealisedScheduleOptions = {}): Schedule {
  const todayIdx = planDay(plan, today);
  const days = past.map((r) => ({ day: planDay(plan, r.loggedDay.date), template: r.loggedDay.inputs })).filter((d) => d.day >= 0 && d.day < todayIdx);
  const cur = opts.current;
  const curSleep = cur && planDay(plan, cur.loggedDay.date) === todayIdx && cur.sleep?.main ? cur.loggedDay.inputs.sleep : undefined;
  if (opts.todayTemplate && todayIdx >= 0) days.push({ day: todayIdx, template: { ...opts.todayTemplate, ...(curSleep ? { sleep: curSleep } : {}) } });
  else if (curSleep && todayIdx >= 0) days.push({ day: todayIdx, template: { ...templateOfDay(head.schedule, todayIdx), sleep: curSleep } });
  const events = (opts.fastEvents ?? past.map((r) => r.fast).filter((f): f is NonNullable<typeof f> => f !== null)).filter((f) => f.startDay < todayIdx);
  const s = buildRealisedSchedule({ base: head.schedule, days, events, eventsReplacedBefore: Math.max(0, todayIdx), horizonDays: Math.max(horizonDays ?? head.schedule.horizonDays, todayIdx + 1) });
  return opts.history ? { ...s, realised: { historyHash: opts.history.contentHash, asOf: opts.history.asOf, contractVersion: CONTRACT_VERSIONS.realisedHistory, throughDay: Math.max(0, todayIdx) } } : s;
}

/** Anchors and δ steps stored in the records (sorted by day; one per day, latest record wins). */
export function anchorsFromRecords(records: readonly ConfirmedStateRecord[]): { anchors: AnchorSpec[]; offsets: IntakeOffset[] } {
  const byDay = new Map<number, ConfirmedStateRecord>();
  for (const r of records) byDay.set(r.anchorDay, r);
  const sorted = [...byDay.values()].sort((a, b) => a.anchorDay - b.anchorDay);
  const anchors: AnchorSpec[] = sorted.map((r) => ({ day: r.anchorDay, tissueMassKg: r.residualSplit.tissueMassKg, ...(r.residualSplit.fatFrac !== undefined ? { split: { fatFrac: r.residualSplit.fatFrac } } : {}) }));
  const offsets: IntakeOffset[] = [];
  let prev = 0;
  for (const r of sorted) {
    if (r.energyBiasKcal.mean !== prev) offsets.push(offsetOf(r.anchorDay, r.energyBiasKcal.mean, r.correction?.requestedKcal, r.decisionId));
    prev = r.energyBiasKcal.mean;
  }
  return { anchors, offsets };
}

// ------------------------------------------------------------------------------------------- current derived anchors (A1-017)
/** One decision of the current anchor chain: the original record when its lineage still holds, else its recomputation. */
export interface CurrentAnchorLink {
  anchorDay: number;
  record: ConfirmedStateRecord;
  origin: 'original' | 'recomputed';
  /** `historicalOnly` = the decision cannot be reproduced from the current evidence: its anchor is not current state. */
  compatibility: 'current' | 'historicalOnly';
  reason: LineageInvalidation | 'none';
  /** Lineage of the anchor in force (the record's own, or the recomputation's). */
  derivation: DerivationLineage;
  consumedObservationIds: readonly string[];
}

export interface CurrentAnchors {
  /** Anchors of the current state (original where still valid, recomputed otherwise; historical-only ones left out). */
  anchors: AnchorSpec[];
  /** The ACTUAL applied correction history from the records (a recomputation never adds or changes a step). */
  offsets: IntakeOffset[];
  chain: CurrentAnchorLink[];
  /** Recomputed current anchors to keep beside (never instead of) the original records; reused while their lineage holds. */
  derived: DerivedAnchorRecord[];
  /** Ids consumed by the current chain and each decision's own (day, ids), for the next decision. */
  consumed: string[];
  history: Array<{ day: number; consumed: string[] }>;
  /** Fingerprint of the last anchor in force (null = none: the next decision starts from the fixed prior). */
  lastFingerprint: string | null;
  /** First anchor day whose original lineage no longer holds, or null when every original is current. */
  invalidFrom: number | null;
}

export interface CurrentAnchorsInput {
  plan: Pick<PlanDoc, 'startDate' | 'baselineProfile'> & { id: string };
  /** Realised schedule (logged past + head future). */
  schedule: Schedule;
  records: readonly ConfirmedStateRecord[];
  /** Current effective weigh-ins (`weighInsFor`). */
  weighIns: readonly WeighInObs[];
  /**
   * Current effective composition graph (`compositionReadingsFor`); null = supplied and empty. Undefined = not supplied:
   * composition references cannot be checked or refit, so the stored anchors are used as they are (legacy behaviour).
   */
  composition?: CompositionReadings | null;
  /** Recomputed anchors kept from an earlier call (reused while their lineage still matches). */
  derived?: readonly DerivedAnchorRecord[];
  /** Only decisions before this plan day (a new decision passes its own day). */
  beforeDay?: number;
  params?: AssimilationParams;
}

/** The lineage identity of the estimator a decision runs under. */
function lineageEstimator(prm: AssimilationParams): NonNullable<DerivationLineage['estimator']> {
  const e = estimatorIdentity(prm);
  return { strategy: e.strategy, version: e.version, paramsHash: e.paramsHash };
}

/**
 * Current derived anchors (A1-017): the original confirmed records are kept as they are (history, adopted forecasts and
 * the applied correction ledger never change); each record's derivation lineage — the observation revisions and values it
 * read, the realised inputs before its day, the estimator/operator identity and the anchor it propagated from — is
 * checked against the current effective graph. From the first record whose lineage no longer holds (a superseded or
 * retracted observation, an edited past day, an estimator or operator change, a legacy record without lineage) every
 * anchor is recomputed in order from the current evidence at its own time, with the actual correction history fixed: a
 * removed observation then contributes nothing, a corrected one exactly its corrected value. A decision that cannot be
 * reproduced (e.g. its weigh-ins are gone) is historical only and leaves the current state. A recomputation is never a
 * new decision or a correction step; cached recomputations are reused while their own lineage holds.
 */
export function currentAnchors(i: CurrentAnchorsInput): CurrentAnchors {
  const prm = i.params ?? ASSIMILATION_DEFAULTS;
  const byDay = new Map<number, ConfirmedStateRecord>();
  for (const r of i.records) if (i.beforeDay === undefined || r.anchorDay < i.beforeDay) byDay.set(r.anchorDay, r);
  const records = [...byDay.values()].sort((a, b) => a.anchorDay - b.anchorDay);
  const { offsets } = anchorsFromRecords(records);
  const stored = (r: ConfirmedStateRecord): AnchorSpec => ({ day: r.anchorDay, tissueMassKg: r.residualSplit.tissueMassKg, ...(r.residualSplit.fatFrac !== undefined ? { split: { fatFrac: r.residualSplit.fatFrac } } : {}) });
  const out: CurrentAnchors = { anchors: [], offsets, chain: [], derived: [], consumed: [], history: [], lastFingerprint: null, invalidFrom: null };
  const verify = i.composition !== undefined;
  const composition = i.composition ?? undefined;
  const current = observationRefs(i.weighIns, composition);
  const estimator = lineageEstimator(prm);
  const operatorVersion = CONTRACT_VERSIONS.measurementOperator;
  const consumed = new Set<string>();
  const listed = new Set<string>();
  let prev: string | null = null;
  let invalid = false;
  const checkOf = (lin: DerivationLineage | undefined, day: number) => lineageInvalidation(lin, { observations: current, estimator, operatorVersion, historyHash: realisedPrefixHash(i.schedule, day), previous: prev });
  const push = (link: CurrentAnchorLink, anchor: AnchorSpec | null) => {
    out.chain.push(link);
    if (anchor && link.compatibility === 'current') out.anchors.push(anchor);
    for (const c of link.consumedObservationIds) consumed.add(c);
    out.history.push({ day: link.anchorDay, consumed: [...link.consumedObservationIds] });
    for (const o of link.derivation.observations) listed.add(`${o.id}@${o.revision}`);
    prev = link.derivation.fingerprint;
  };
  for (const r of records) {
    const day = r.anchorDay;
    if (!verify) {
      // no composition graph supplied: nothing can be checked or refit, the stored anchors are used as they are
      const lin = r.derivation ?? derivationLineage({ observations: [], ...(r.estimator ? { estimator: { strategy: r.estimator.strategy, version: r.estimator.version, paramsHash: r.estimator.paramsHash } } : {}), previous: prev });
      push({ anchorDay: day, record: r, origin: 'original', compatibility: 'current', reason: 'none', derivation: lin, consumedObservationIds: r.consumedObservationIds ?? [] }, stored(r));
      continue;
    }
    if (!invalid) {
      if (checkOf(r.derivation, day) === null) {
        push({ anchorDay: day, record: r, origin: 'original', compatibility: 'current', reason: 'none', derivation: r.derivation!, consumedObservationIds: r.consumedObservationIds ?? [] }, stored(r));
        continue;
      }
      invalid = true;
      out.invalidFrom = day;
    }
    const reason: LineageInvalidation = checkOf(r.derivation, day)?.reason ?? 'upstreamChanged';
    const cached = (i.derived ?? []).find((d) => d.anchorDay === day && d.sourceInputsHash === r.inputsHash && checkOf(d.derivation, day) === null);
    if (cached) {
      out.derived.push(cached);
      push({ anchorDay: day, record: r, origin: 'recomputed', compatibility: cached.compatibility, reason: cached.reason, derivation: cached.derivation, consumedObservationIds: cached.compatibility === 'current' ? recomputedConsumed(cached) : [] }, cached.compatibility === 'current' ? { day, tissueMassKg: cached.residualSplit.tissueMassKg, ...(cached.residualSplit.fatFrac !== undefined ? { split: { fatFrac: cached.residualSplit.fatFrac } } : {}) } : null);
      continue;
    }
    const o = runCheckIn({
      day,
      profile: i.plan.baselineProfile,
      schedule: i.schedule,
      anchors: out.anchors,
      intakeOffsets: offsets,
      weighIns: i.weighIns,
      startWeekday: weekdayOf(i.plan.startDate),
      intakeDays: [],
      previousBias: biasOn(records, day),
      ...(composition && COMPOSITION_ASSIMILATION_ENABLED ? { composition } : {}),
      ...(consumed.size > 0 ? { consumedObservationIds: [...consumed].sort() } : {}),
      compositionHistory: out.history,
      ...(r.trigger === 'hard' ? { hard: true } : {}),
      params: prm,
      recompute: true,
    });
    const refs = refsThrough(i.weighIns, composition, day).filter((x) => !listed.has(`${x.id}@${x.revision}`));
    const derivation = derivationLineage({ observations: refs, historyHash: realisedPrefixHash(i.schedule, day), estimator, operatorVersion, previous: prev });
    const ok = o.verdict === 'confirmed' && o.anchor !== null && o.trend !== null && o.residualSplit !== null;
    const residualSplit: ConfirmedStateRecord['residualSplit'] = ok
      ? { tissueMassKg: o.anchor!.tissueMassKg, residualKg: o.residualSplit!.residualKg, fatKg: o.residualSplit!.fatKg, leanKg: o.residualSplit!.leanKg, source: o.residualSplit!.source, ...(o.anchor!.split && typeof o.anchor!.split === 'object' ? { fatFrac: o.anchor!.split.fatFrac } : {}) }
      : r.residualSplit;
    const d: DerivedAnchorRecord = {
      kind: 'vitals.derivedAnchor',
      planId: i.plan.id,
      anchorDate: r.anchorDate,
      anchorDay: day,
      ...(r.decisionId ? { sourceDecisionId: r.decisionId } : {}),
      sourceInputsHash: r.inputsHash,
      trendWeight: ok ? { kg: o.trend!.w, sd: o.trend!.wSd } : r.trendWeight,
      energyBiasKcal: r.energyBiasKcal,
      residualSplit,
      derivation,
      compatibility: ok ? 'current' : 'historicalOnly',
      reason,
      stamp: { ...stampDerived({ versions: { measurementOperator: operatorVersion, estimator: CONTRACT_VERSIONS.estimator, observation: CONTRACT_VERSIONS.observation }, origin: 'recomputed' }), origin: 'recomputed' },
    };
    const consumedNow = ok ? o.consumedObservationIds : [];
    out.derived.push(d);
    push({ anchorDay: day, record: r, origin: 'recomputed', compatibility: d.compatibility, reason, derivation, consumedObservationIds: consumedNow }, ok ? o.anchor : null);
  }
  out.consumed = [...consumed].sort();
  out.lastFingerprint = prev;
  return out;
}

/**
 * Ids a cached recomputed decision consumed: the observation revisions it read first (its lineage lists exactly the
 * evidence no earlier anchor of the chain had read; composition readings among them are what it assimilated).
 */
function recomputedConsumed(d: DerivedAnchorRecord): string[] {
  return d.derivation.observations.map((o) => (o.revision ? `${o.id}@${o.revision}` : o.id));
}

/** (D5-03) An intake offset with its law, the request before the controller bounds and the decision that set it. */
function offsetOf(fromDay: number, kcal: number, requestedKcal: number | undefined, decisionId: string | undefined): IntakeOffset {
  return { fromDay, kcal, mechanism: 'absorbedMacroImputation', ...(requestedKcal !== undefined ? { requestedKcal } : {}), ...(decisionId ? { decisionId } : {}) };
}

/** δ in force on a plan day. */
export function biasOn(records: readonly ConfirmedStateRecord[], day: number): { mean: number; sd: number } {
  let b = { mean: 0, sd: ASSIMILATION_DEFAULTS.biasPriorSdKcal };
  for (const r of [...records].sort((x, y) => x.anchorDay - y.anchorDay)) if (r.anchorDay <= day) b = r.energyBiasKcal;
  return b;
}

/** Hash of what the replay up to `day` depends on (baseline, realised days < day, anchors, δ steps, engine/contract/reducer/estimator versions — C7). */
export function replayInputsHash(baseline: PlanDoc['baselineProfile'], schedule: Schedule, day: number, anchors: readonly AnchorSpec[], offsets: readonly IntakeOffset[], params: AssimilationParams = ASSIMILATION_DEFAULTS): string {
  const days = schedule.days.slice(0, Math.max(0, day)).map((d) => ({ ...d, program: stableStringify({ ...schedule.programs[d.program], id: undefined, label: undefined }) }));
  return contentHash({ baseline, days, events: (schedule.events ?? []).filter((e) => e.startDay < day), anchors: anchors.filter((a) => a.day <= day), offsets: offsets.filter((o) => o.fromDay <= day), engine: ENGINE_VERSION, contracts: CONTRACT_FINGERPRINT, reducer: REALISED_HISTORY_REDUCER_VERSION, estimator: estimatorIdentity(params) });
}

// ------------------------------------------------------------------------------------------- daily assimilation
export interface DailyAssimilationInput {
  plan: PlanDoc & { id: string };
  /** Realised schedule (logged past + head future). */
  schedule: Schedule;
  records: readonly ConfirmedStateRecord[];
  weighIns: readonly WeighInObs[];
  today: LocalDate;
  /** Cached confirmed snapshot of the latest record (derived collection), used when its hash still matches. */
  cached?: { anchorDay: number; inputsHash: string; snapshot: EngineSnapshot } | null;
  params?: AssimilationParams;
  /**
   * (A1-017) The current effective composition graph (`compositionReadingsFor(…) ?? null`): with it the stored anchors are
   * checked against the current observations and refit where their lineage no longer holds. Absent = not supplied: the
   * stored anchors are replayed as they are (legacy behaviour).
   */
  composition?: CompositionReadings | null;
  /** (A1-017) Recomputed anchors kept from an earlier run (`DailyAssimilationOutput.current.derived`). */
  derived?: readonly DerivedAnchorRecord[];
}

export interface DailyAssimilationOutput {
  replay: ReplayOutput;
  /** Filter series through today (water removed with the replay's own water terms). */
  points: TrendPoint[];
  trendToday: { kg: number; sd: number; rateKgPerWeek: number; rateSd: number } | null;
  /**
   * (C4/D5-02) The same filter on the raw scale readings (operator 'scaleWake': no model water removed), the observable
   * the scale forecast band is expressed in. `points`/`trendToday` stay the water-adjusted estimate ('waterAdjustedWake').
   */
  scalePoints: TrendPoint[];
  scaleToday: { kg: number; sd: number; rateKgPerWeek: number; rateSd: number } | null;
  /** True when the replay started from the cached anchor snapshot. */
  usedCache: boolean;
  /**
   * (C4/D1-06) What the water-adjusted series is: conditional on the replay's labile-water terms (glycogen, sodium, gut,
   * creatine), a scenario rather than measured water. It removes no beverage-deficit kilograms and fits no cycle curve;
   * an unknown cycle or fluid context is an unmodelled transient that stays in the raw scale series (`scalePoints`).
   */
  waterAdjustment: { status: 'scenario'; reasonCode: 'modelLabileWaterConditional'; operator: 'waterAdjustedWake' };
  /** (A1-017) The anchors in force: originals whose lineage holds, recomputations otherwise (to keep beside the records). */
  current: CurrentAnchors;
}

/** Daily step (§3.5 steps 1-2): replay from the latest anchor snapshot (or day 0) through today, then the trend filter. */
export function dailyAssimilation(i: DailyAssimilationInput): DailyAssimilationOutput {
  const prm = i.params ?? ASSIMILATION_DEFAULTS;
  // (A1-017) the anchors in force: a stored anchor whose evidence was retracted, revised or derived under another
  // estimator is refit (when the composition graph is supplied); the cached snapshot is accepted only for those anchors
  const current = currentAnchors({ plan: i.plan, schedule: i.schedule, records: i.records, weighIns: i.weighIns, ...(i.composition !== undefined ? { composition: i.composition } : {}), ...(i.derived ? { derived: i.derived } : {}), params: prm });
  const { anchors, offsets } = current;
  const todayIdx = planDay(i.plan, i.today);
  let from: EngineSnapshot | undefined;
  if (i.cached && i.cached.anchorDay <= todayIdx) {
    const h = replayInputsHash(i.plan.baselineProfile, i.schedule, i.cached.anchorDay, anchors, offsets, prm);
    if (h === i.cached.inputsHash) from = i.cached.snapshot;
  }
  // (A1-018) readings with their own clock time are residualised with the model water of that hour
  const hourly = i.weighIns.some((o) => o.timing?.precision === 'instant' || o.timing?.precision === 'interval');
  const replay = runReplay({ profile: i.plan.baselineProfile, schedule: i.schedule, anchors, intakeOffsets: offsets, ...(from ? { from } : {}), ...(hourly ? { hourly: true } : {}) });
  // the filter needs the water terms on every weigh-in day: replay from day 0 when the cache starts after the first one
  const needFull = from !== undefined && i.weighIns.some((o) => o.day < replay.startDay);
  const wr = needFull ? runReplay({ profile: i.plan.baselineProfile, schedule: i.schedule, anchors, intakeOffsets: offsets, ...(hourly ? { hourly: true } : {}) }) : replay;
  const obs: WeighInObs[] = [];
  for (const o of i.weighIns) {
    if (o.day > todayIdx) continue;
    const w = sampleAt(wr.waterHourKg, wr.waterWakeKg, o.day, o.timing);
    if (!w) continue;
    const sd = o.waterSdKg !== undefined && Number.isFinite(o.waterSdKg) ? Math.hypot(o.waterSdKg, w.spreadSdKg) : w.spreadSdKg;
    obs.push({ ...o, waterKg: w.kg, ...(sd > 0 ? { waterSdKg: sd } : {}) });
  }
  const dow = estimateDowOffsets(obs, weekdayOf(i.plan.startDate), prm);
  const filt = runTrendFilter(obs, { params: prm, untilDay: todayIdx, ...(dow ? { dow: { offsets: dow, startWeekday: weekdayOf(i.plan.startDate) } } : {}) });
  const last = filt.points[filt.points.length - 1];
  const scaleObs = i.weighIns.filter((o) => o.day <= todayIdx).map((o) => ({ ...o, waterKg: 0 }));
  const sdow = estimateDowOffsets(scaleObs, weekdayOf(i.plan.startDate), prm);
  const sf = runTrendFilter(scaleObs, { params: prm, untilDay: todayIdx, ...(sdow ? { dow: { offsets: sdow, startWeekday: weekdayOf(i.plan.startDate) } } : {}) });
  const sl = sf.points[sf.points.length - 1];
  return {
    replay,
    points: filt.points,
    trendToday: last ? { kg: last.w, sd: last.wSd, rateKgPerWeek: 7 * last.r, rateSd: 7 * last.rSd } : null,
    scalePoints: sf.points,
    scaleToday: sl ? { kg: sl.w, sd: sl.wSd, rateKgPerWeek: 7 * sl.r, rateSd: 7 * sl.rSd } : null,
    usedCache: from !== undefined,
    waterAdjustment: { status: 'scenario', reasonCode: 'modelLabileWaterConditional', operator: 'waterAdjustedWake' },
    current,
  };
}

// ------------------------------------------------------------------------------------------- weekly check-in
export interface WeeklyCheckInInput {
  plan: PlanDoc & { id: string };
  schedule: Schedule;
  records: readonly ConfirmedStateRecord[];
  weighIns: readonly WeighInObs[];
  today: LocalDate;
  /** Plan days whose intake may enter the balance estimate (`LoggedDayResult.calibrationEligible`). */
  intakeDays: readonly number[];
  /**
   * Deprecated (D5-04): ignored. The AI-estimated energy share used to widen the δ prior; a source label alone is not a
   * quantitative error model, so it no longer changes any weight. Kept so older callers still type-check.
   */
  aiEnergyShare?: number;
  /** (C4/D5-04/D5-07) Ids (with revision) of the weigh-ins this decision consumes (`weighInIds`). */
  observationIds?: readonly string[];
  /** (D6-06) Per-day intake evidence (`intakeEvidenceOf`); when given, the engine's δ gate counts its eligible days. */
  intakeEvidence?: readonly IntakeDayEvidence[];
  /** (D5-07) Composition readings at their own time (`compositionReadingsFor`); each revision is assimilated once. */
  composition?: CompositionReadings;
  hard?: HardReanchorReason;
  params?: AssimilationParams;
  /** (D5-02/D5-06) id of the confirmed decision this check-in records (hysteresis advances once per id). */
  decisionId?: string;
  /** (C2) content hash of the realised history the schedule's past came from. */
  historyHash?: string;
  /** (A1-017) Recomputed anchors kept from an earlier run (reused while their lineage holds). */
  derived?: readonly DerivedAnchorRecord[];
}

export interface WeeklyCheckInOutput {
  output: CheckInOutput;
  record: ConfirmedStateRecord | null;
  state: ConfirmedState | null;
  /** (A1-017) The earlier anchors this decision started from (originals still valid, recomputations otherwise). */
  current: CurrentAnchors;
}

/** Weekly check-in (§3.5 steps 4-6): δ, anchor, confirmed snapshot; the record is what syncs. */
export function weeklyCheckIn(i: WeeklyCheckInInput): WeeklyCheckInOutput {
  const day = planDay(i.plan, i.today);
  const prior = i.records.filter((r) => r.anchorDay < day);
  const prm = i.params ?? ASSIMILATION_DEFAULTS;
  const composition = i.composition && COMPOSITION_ASSIMILATION_ENABLED ? i.composition : undefined;
  // (A1-017) start from the CURRENT anchors: earlier anchors whose evidence was retracted/revised or that were derived under
  // another estimator are refit from the current graph (the records, their decisions and the applied corrections stay)
  const current = currentAnchors({ plan: i.plan, schedule: i.schedule, records: prior, weighIns: i.weighIns, composition: composition ?? null, ...(i.derived ? { derived: i.derived } : {}), beforeDay: day, params: prm });
  const { anchors, offsets } = current;
  const output = runCheckIn({
    day,
    profile: i.plan.baselineProfile,
    schedule: i.schedule,
    anchors,
    intakeOffsets: offsets,
    weighIns: i.weighIns,
    startWeekday: weekdayOf(i.plan.startDate),
    intakeDays: i.intakeDays,
    previousBias: biasOn(prior, day),
    ...(i.intakeEvidence ? { intakeEvidence: i.intakeEvidence } : {}),
    // (D5-07) readings at their own time, each revision once: the ids the current chain consumed travel with the request,
    // with each earlier decision's own ids for the device-bias recursion (A1-038)
    ...(composition ? { composition } : {}),
    ...(current.consumed.length > 0 ? { consumedObservationIds: current.consumed } : {}),
    compositionHistory: current.history,
    ...(i.decisionId ? { decisionId: i.decisionId } : {}),
    ...(i.hard ? { hard: true } : {}),
    ...(i.params ? { params: i.params } : {}),
  });
  if (output.verdict !== 'confirmed' || !output.anchor || !output.trend || !output.snapshot || !output.replay) return { output, record: null, state: null, current };
  const split = output.residualSplit!;
  // (D5-03) the correction ledger: what the estimator asked for, what is applied after the controller bounds (±300 kcal/d,
  // at most 100 kcal/d per weekly decision — counted from the δ in force a week ago, so a retried or repeated check-in
  // inside the week earns no extra step), and whether a bound held it
  // the engine's own ledger entry when its check-in reports one (it applies the bounds itself), else this package's
  const reported = output as CheckInOutput & { correction?: NonNullable<ConfirmedStateRecord['correction']> | null; estimator?: NonNullable<ConfirmedStateRecord['estimator']>; consumedObservationIds?: readonly string[] };
  const correction = reported.correction ?? checkInCorrection(prior, day, output.bias, i.params ?? ASSIMILATION_DEFAULTS);
  const applied = correction.appliedKcal;
  const intakeOffset = applied !== biasOn(prior, day).mean ? offsetOf(day, applied, correction.requestedKcal, i.decisionId) : null;
  const allAnchors = [...anchors, output.anchor];
  const allOffsets = intakeOffset ? [...offsets, intakeOffset] : offsets;
  const record: ConfirmedStateRecord = {
    planId: i.plan.id,
    anchorDate: i.today,
    anchorDay: day,
    trendWeight: { kg: output.trend.w, sd: output.trend.wSd },
    energyBiasKcal: { mean: applied, sd: output.bias.sd },
    residualSplit: {
      tissueMassKg: output.anchor.tissueMassKg,
      residualKg: split.residualKg,
      fatKg: split.fatKg,
      leanKg: split.leanKg,
      source: split.source,
      ...(output.anchor.split && typeof output.anchor.split === 'object' ? { fatFrac: output.anchor.split.fatFrac } : {}),
    },
    inputsHash: replayInputsHash(i.plan.baselineProfile, i.schedule, day, allAnchors, allOffsets, i.params ?? ASSIMILATION_DEFAULTS),
    engine: { engineVersion: output.replay.result.meta.engineVersion, registryHash: output.replay.result.meta.registryHash },
    trigger: i.hard ? 'hard' : 'weekly',
    ...(i.hard ? { hardReason: i.hard } : {}),
    // (C4/D5-02) trendWeight is the water-adjusted estimate; the raw scale trend is kept beside it, never relabelled
    trendWeightOperator: 'waterAdjustedWake',
    ...rawScaleOf(i, day),
    ...(i.decisionId ? { decisionId: i.decisionId } : {}),
    ...(i.historyHash ? { historyHash: i.historyHash } : {}),
    estimator: reported.estimator ?? estimatorIdentity(i.params ?? ASSIMILATION_DEFAULTS),
    ...(reported.consumedObservationIds || i.observationIds ? { consumedObservationIds: [...new Set([...(reported.consumedObservationIds ?? []), ...(i.observationIds ?? [])])].sort() } : {}),
    correction,
    // (A1-017) what this anchor was derived from: the evidence it read first, the realised inputs before its day, the
    // estimator/operator identity and the anchor it propagated from (checked before it is ever reused as current state)
    derivation: derivationLineage({
      observations: refsThrough(i.weighIns, composition, day).filter((x) => !listedIn(current).has(`${x.id}@${x.revision}`)),
      historyHash: realisedPrefixHash(i.schedule, day),
      estimator: lineageEstimator(prm),
      operatorVersion: CONTRACT_VERSIONS.measurementOperator,
      previous: current.lastFingerprint,
    }),
    ...(output.composition ? { compositionEvidence: compositionEvidenceOf(output.composition) } : {}),
    stamp: stampDerived({
      versions: { realisedHistory: CONTRACT_VERSIONS.realisedHistory, measurementOperator: CONTRACT_VERSIONS.measurementOperator, observation: CONTRACT_VERSIONS.observation, estimator: CONTRACT_VERSIONS.estimator },
      engineVersion: output.replay.result.meta.engineVersion,
      registryHash: output.replay.result.meta.registryHash,
      ...(i.historyHash ? { inputsHash: i.historyHash } : {}),
      origin: 'original',
    }),
  };
  const state: ConfirmedState = {
    anchorDate: i.today,
    snapshot: output.snapshot,
    energyBiasKcal: record.energyBiasKcal,
    trendWeight: record.trendWeight,
  };
  return { output, record, state, current };
}

/** Observation revisions (`id@revision`) the anchors of a chain already read. */
function listedIn(c: Pick<CurrentAnchors, 'chain'>): Set<string> {
  return new Set(c.chain.flatMap((l) => l.derivation.observations.map((o) => `${o.id}@${o.revision}`)));
}

/** (A1-038) The record's composition evidence: device groups, shared-bias assumption, scenario status of change evidence. */
export function compositionEvidenceOf(c: NonNullable<CheckInOutput['composition']>): CompositionEvidence {
  return {
    status: c.status,
    groups: c.groups.map((g) => ({
      groupId: g.groupId,
      method: g.method,
      ...(g.device ? { device: g.device } : {}),
      observationIds: g.observationIds,
      bias: g.bias,
      longitudinalSensitivity: g.longitudinalSensitivity,
      repeatabilitySdPct: g.repeatabilitySdPct,
      systematicSdPct: g.systematicSdPct,
    })),
    uncertaintyKind: c.longitudinal ? 'scenario' : 'conditionalResidual',
    coverage: 'unvalidated',
  };
}

/**
 * (D5-03) The check-in's correction ledger entry. `requestedKcal` is the estimator's unbounded value (its posterior from the
 * window's measurement and the prior it was given; equal to the applied value when nothing bound it, or the previous
 * value when the estimate was not updated); `appliedKcal` is that request after the controller bounds measured from the
 * δ in force seven days before the decision (one step per weekly decision, however often a check-in runs). The
 * application law stays the versioned absorbed-macro imputation of the engine (no expenditure mechanism is implied).
 */
export function checkInCorrection(prior: readonly ConfirmedStateRecord[], day: number, b: CheckInOutput['bias'], prm: AssimilationParams = ASSIMILATION_DEFAULTS): NonNullable<ConfirmedStateRecord['correction']> {
  const prev = biasOn(prior, day).mean;
  const given = (b as { requestedKcal?: number }).requestedKcal;
  let requested = b.mean;
  if (!b.updated) requested = prev;
  else if (given !== undefined && Number.isFinite(given)) requested = given;
  else if (b.reason && b.measurement) {
    // the bound value is not the request: rebuild the unbounded posterior the estimator computed before its clamps
    const wp = 1 / prm.biasPriorSdKcal ** 2;
    const wm = 1 / Math.max(1e-6, b.measurement.se) ** 2;
    requested = (prev * wp + b.measurement.value * wm) / (wp + wm);
  }
  const weekBase = biasOn(prior, day - 7).mean;
  const bounded = boundBalanceCorrection(requested, weekBase) ?? { appliedKcal: prev, saturated: false, stepLimited: false };
  // never more than one step from the value in force either (the weekly base and the last decision both bound it)
  const step = BALANCE_CORRECTION_BOUNDS.maxStepKcalPerDecision;
  const appliedKcal = Math.min(prev + step, Math.max(prev - step, bounded.appliedKcal));
  return {
    requestedKcal: requested,
    appliedKcal: b.updated ? appliedKcal : prev,
    saturated: b.updated ? bounded.saturated || b.reason === 'clampedValue' : false,
    stepLimited: b.updated ? bounded.stepLimited || appliedKcal !== bounded.appliedKcal || b.reason === 'clampedStep' : false,
    mechanism: 'absorbedMacroImputation',
  };
}

/**
 * (D5-03) Per-day correction ledger of a plan: the δ requested by the records in force each day and the δ actually applied
 * by the absorbed-intake imputation (it acts only on days with intake: a zero-energy or fully fasted day applies 0 and says
 * why). Pure accounting from the realised schedule; the replay applies the same law.
 */
export function appliedCorrectionLedger(records: readonly ConfirmedStateRecord[], schedule: Schedule, fromDay: number, toDay: number): Array<{ day: number; requestedKcal: number; appliedKcal: number; skipped?: 'zeroIntakeDay' }> {
  const out: Array<{ day: number; requestedKcal: number; appliedKcal: number; skipped?: 'zeroIntakeDay' }> = [];
  for (let d = Math.max(0, fromDay); d <= toDay; d++) {
    const requested = biasOn(records, d).mean;
    const t = templateOfDay(schedule, d);
    const zero = t.energy.kind === 'zero' || (t.energy.kind === 'kcal' && !(t.energy.kcal > 0)) || (schedule.events ?? []).some((e) => e.kind === 'fast' && e.startDay * 24 + e.startH <= d * 24 && e.startDay * 24 + e.startH + e.durationH >= (d + 1) * 24);
    out.push(zero ? { day: d, requestedKcal: requested, appliedKcal: 0, skipped: 'zeroIntakeDay' } : { day: d, requestedKcal: requested, appliedKcal: requested });
  }
  return out;
}

/**
 * (D5-03) Linear diagnostic of the balance residual against its ACTUAL application history, valid only for a linear
 * constant-density system: with A_i = Σ applied correction kcal on the days before observation i, δ = ρ·slope(y − E) +
 * slope(A), both slopes on identical observation days and weights with a free intercept. A diagnostic, not the
 * production estimator (the nonlinear whole-window replay is), and ρ is the caller's effective kcal/kg.
 */
export function linearCorrectionDiagnostic(i: { points: ReadonlyArray<{ day: number; y: number; engineKg: number }>; appliedKcalByDay: ReadonlyMap<number, number> | ((day: number) => number); rhoKcalPerKg: number }): { deltaKcal: number; n: number } | null {
  const applied = typeof i.appliedKcalByDay === 'function' ? i.appliedKcalByDay : (d: number) => (i.appliedKcalByDay as ReadonlyMap<number, number>).get(d) ?? 0;
  const pts = i.points.filter((p) => Number.isFinite(p.day) && Number.isFinite(p.y) && Number.isFinite(p.engineKg));
  if (pts.length < 2 || !Number.isFinite(i.rhoKcalPerKg)) return null;
  const d0 = Math.min(...pts.map((p) => p.day));
  const cum = (day: number): number => {
    let a = 0;
    for (let d = d0; d < day; d++) a += applied(d);
    return a;
  };
  const t = pts.map((p) => p.day);
  const mt = t.reduce((a, x) => a + x, 0) / t.length;
  const sxx = t.reduce((a, x) => a + (x - mt) ** 2, 0);
  if (!(sxx > 0)) return null;
  const slope = (v: readonly number[]): number => {
    const mv = v.reduce((a, x) => a + x, 0) / v.length;
    return t.reduce((a, x, k) => a + (x - mt) * (v[k]! - mv), 0) / sxx;
  };
  const resid = pts.map((p) => p.y - p.engineKg);
  const A = pts.map((p) => cum(p.day));
  return { deltaKcal: i.rhoKcalPerKg * slope(resid) + slope(A), n: pts.length };
}

/** The raw scale trend on the check-in day (scale readings through that day, no model water removed), or nothing. */
function rawScaleOf(i: WeeklyCheckInInput, day: number): { rawScale?: { kg: number; sd: number | null } } {
  const prm = i.params ?? ASSIMILATION_DEFAULTS;
  const obs = i.weighIns.filter((o) => o.day <= day).map((o) => ({ ...o, waterKg: 0 }));
  if (obs.length === 0) return {};
  const dow = estimateDowOffsets(obs, weekdayOf(i.plan.startDate), prm);
  const f = runTrendFilter(obs, { params: prm, untilDay: day, ...(dow ? { dow: { offsets: dow, startWeekday: weekdayOf(i.plan.startDate) } } : {}) });
  const last = f.points[f.points.length - 1];
  return last && Number.isFinite(last.w) ? { rawScale: { kg: last.w, sd: Number.isFinite(last.wSd) ? last.wSd : null } } : {};
}

/**
 * Rebuild the confirmed state of a stored record by replaying with its anchors (§3.5 step 6; cached in `derived`). With
 * `current` (A1-017: `currentAnchors`/`dailyAssimilation(…).current`) the anchors in force are used — a refit anchor
 * instead of one whose evidence was retracted or revised — while the record's δ and trend stay as confirmed.
 */
export function confirmedStateFromRecord(plan: PlanDoc, schedule: Schedule, records: readonly ConfirmedStateRecord[], record: ConfirmedStateRecord, current?: Pick<CurrentAnchors, 'anchors' | 'offsets'>): ConfirmedState {
  const { anchors, offsets } = current
    ? { anchors: current.anchors.filter((a) => a.day <= record.anchorDay), offsets: current.offsets.filter((o) => o.fromDay <= record.anchorDay) }
    : anchorsFromRecords(records.filter((r) => r.anchorDay <= record.anchorDay));
  const r = runReplay({ profile: plan.baselineProfile, schedule, anchors, intakeOffsets: offsets, captureAt: [record.anchorDay], record: 'none' });
  const snapshot = r.snapshots[record.anchorDay];
  if (!snapshot) throw new Error('anchor day outside the realised schedule');
  return { anchorDate: record.anchorDate, snapshot, energyBiasKcal: record.energyBiasKcal, trendWeight: record.trendWeight };
}

// ------------------------------------------------------------------------------------------- rules
/**
 * Check-in due (D5-06): the plan's check-in weekday from day 7 on, and — defined late-open catch-up — any later day until a
 * check-in is confirmed on or after that scheduled date. The decision is made for the current date (never backdated), and
 * nothing confirms it but the person's Check in (or their stored opt-in policy).
 */
export function isCheckInDue(plan: Pick<PlanDoc, 'policy' | 'startDate' | 'status'>, today: LocalDate, lastCheckIn: LocalDate | null): boolean {
  if (plan.status !== 'active') return false;
  const scheduled = scheduledCheckInDate(plan, today);
  return scheduled !== null && (lastCheckIn === null || lastCheckIn < scheduled);
}

export interface HardReanchorInputs {
  today: LocalDate;
  plan: Pick<PlanDoc, 'startDate'>;
  entries: readonly LogEntry[];
  measurements: readonly MeasurementEntry[];
  /** Plan days on which a training block starts (from the version schedule). */
  blockStarts: readonly number[];
  /** Engine version/registry the last record was computed with. */
  lastRecordEngine: { engineVersion: string; registryHash: string } | null;
  currentEngine: { engineVersion: string; registryHash: string };
  /** Last weigh-in date before today (null = none). */
  lastWeighInBefore: LocalDate | null;
  /** A fast ≥ 48 h ended yesterday or today. */
  longFastEnded: boolean;
}

/** Hard re-anchor triggers (§3.5 step 7), first match in priority order, or null. */
export function hardReanchorReason(i: HardReanchorInputs): HardReanchorReason | null {
  if (i.lastRecordEngine && (i.lastRecordEngine.engineVersion !== i.currentEngine.engineVersion || i.lastRecordEngine.registryHash !== i.currentEngine.registryHash)) return 'engineVersion';
  const ms = projectEntries(i.measurements);
  if (ms.some((m) => m.method === 'dxa' && m.metric === 'bodyFatPct' && m.date === i.today && !m.assumed)) return 'dxa';
  const weighedToday = ms.some((m) => m.metric === 'weightKg' && m.date === i.today && !m.assumed);
  if (weighedToday && i.lastWeighInBefore && daysBetween(i.lastWeighInBefore, i.today) >= 14) return 'weighInGap';
  const ev = projectEntries(i.entries).filter((e): e is Extract<LogEntry, { kind: 'event' }> => e.kind === 'event' && !e.assumed);
  const illDays = new Set(ev.filter((e) => e.event === 'illness').map((e) => e.date));
  let run = 0;
  for (let k = 1; k <= 3; k++) if (illDays.has(addDays(i.today, -k))) run++;
  if (run >= 3 || ev.some((e) => e.event === 'illness' && e.to && daysBetween(e.date, e.to) > 2 && e.to < i.today && addDays(e.to, 1) >= i.today)) return 'illness';
  if (ev.some((e) => e.event === 'travel' && e.to && daysBetween(e.date, e.to) >= 4 && addDays(e.to, 1) === i.today)) return 'travel';
  if (ev.some((e) => e.event === 'dietBreak' && (e.date === i.today || (e.to !== undefined && addDays(e.to, 1) === i.today)))) return 'dietBreak';
  if (i.longFastEnded) return 'longFastEnd';
  if (i.blockStarts.includes(planDay(i.plan, i.today)) && planDay(i.plan, i.today) > 0) return 'newBlock';
  return null;
}

/**
 * Forecast band (P10/P50/P90) of a series on plan day `day` from a version's digest, or null. The realistic band is read
 * only when the digest holds one (C2/D5-05): an unavailable or legacy-empty realistic forecast is null, never the
 * as-prescribed band relabelled realistic.
 */
export function forecastBandOn(version: PlanVersionDoc, day: number, series: SeriesId = 'scaleWeight', which: 'asPrescribed' | 'realistic' = 'asPrescribed'): { p10: number; p50: number; p90: number } | null {
  if (which === 'realistic' && version.forecast.realisticStatus === 'unavailable') return null;
  const s = version.forecast[which]?.[series];
  if (!s) return null;
  const k = day - version.forecast.fromDay;
  if (k < 0 || k >= s.p50.length) return null;
  return { p10: s.p10[k]!, p50: s.p50[k]!, p90: s.p90[k]! };
}

/** Block start days of a schedule (new-block re-anchor and filter noise). */
export function blockStartsOf(schedule: Schedule): number[] {
  return (schedule.blocks ?? []).map((b) => b.startDay).filter((d) => d > 0).sort((a, b) => a - b);
}
