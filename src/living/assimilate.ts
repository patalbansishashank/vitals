/**
 * The living plan's estimation loop (docs/SUITE_SPEC.md §3.5) over its documents: weigh-ins with their standardisation
 * and event noise, the realised schedule (logged days replace forecast days), anchors and δ steps from the synced
 * `ConfirmedStateRecord`s, the daily assimilation (replay + filter, no anchor move), the weekly check-in that produces a
 * new record and PLANNER_V2's `ConfirmedState`, hard re-anchor triggers, the check-in due rule and the forecast band of a
 * day. Pure: engine work goes through `@/engine/assimilation` (deterministic), documents come from the caller.
 */
import { ENGINE_VERSION } from '@/engine/core/defaults';
import { fnv1a } from '@/engine/core/math';
import type { AnchorSpec, EngineSnapshot, IntakeOffset, Schedule, SeriesId } from '@/engine';
import {
  ASSIMILATION_DEFAULTS,
  buildRealisedSchedule,
  runCheckIn,
  runReplay,
  runTrendFilter,
  estimateDowOffsets,
  type AssimilationParams,
  type CheckInOutput,
  type CompositionReadings,
  type ReplayOutput,
  type TrendPoint,
  type WeighInObs,
} from '@/engine/assimilation';
import { addDays, daysBetween, weekdayOf } from './dates';
import { planDay } from './calendar';
import { effectiveEntries } from './logs';
import type { LoggedDayResult } from './loggedDay';
import type { DayObservations } from './observations';
import type { ConfirmedState } from './plannerContract';
import type { ConfirmedStateRecord, HardReanchorReason, LocalDate, LogEntry, MeasurementEntry, PlanDoc, PlanVersionDoc } from './types';

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

// ------------------------------------------------------------------------------------------- weigh-ins
const EVENT_INFLATES: ReadonlySet<string> = new Set(['illness', 'travel', 'creatineStart', 'dietBreak']);

/**
 * Weigh-ins of the plan (manual measurements and device weights; same-day values are averaged by the filter): a reading is
 * standardised when it is a morning fasted one (manual context 'morningFasted' or unspecified, device context
 * fasting/morning); declared events (illness, travel, creatine start, diet break) and block starts inflate the noise ×4 for
 * 4 days. Assumed entries are never used.
 */
export function weighInsFor(
  plan: Pick<PlanDoc, 'startDate'>,
  measurements: readonly MeasurementEntry[],
  observations: readonly DayObservations[],
  events: readonly LogEntry[],
  blockStarts: readonly number[] = [],
  params: AssimilationParams = ASSIMILATION_DEFAULTS,
): WeighInObs[] {
  const inflate = new Map<number, number>();
  const mark = (d0: number): void => {
    for (let k = 0; k < params.eventDays; k++) inflate.set(d0 + k, params.eventRMult);
  };
  for (const e of effectiveEntries(events)) if (e.kind === 'event' && EVENT_INFLATES.has(e.event) && !e.assumed) mark(planDay(plan, e.date));
  for (const b of blockStarts) if (b > 0) mark(b);
  const out: WeighInObs[] = [];
  for (const m of effectiveEntries(measurements)) {
    if (m.metric !== 'weightKg' || m.assumed || !Number.isFinite(m.value)) continue;
    const day = planDay(plan, m.date);
    if (day < 0) continue;
    out.push({ day, scaleKg: m.value, standardised: m.context === undefined || m.context === 'morningFasted', rMult: inflate.get(day) ?? 1 });
  }
  for (const o of observations) {
    const day = planDay(plan, o.date);
    if (day < 0) continue;
    for (const w of o.weights ?? []) out.push({ day, scaleKg: w.kg, standardised: w.context === 'fasting' || w.context === 'morning', rMult: inflate.get(day) ?? 1 });
  }
  return out.sort((a, b) => a.day - b.day);
}

// ------------------------------------------------------------------------------------------- realised schedule
/**
 * Realised schedule of a plan as of `today`: the head version's schedule with every past day [0, today) replaced by its
 * `LoggedDay.inputs` (unknown days already carry the expected-credit inputs) and the past fasts by the realised ones.
 */
export function realisedSchedule(plan: Pick<PlanDoc, 'startDate'>, head: PlanVersionDoc, past: readonly LoggedDayResult[], today: LocalDate, horizonDays?: number): Schedule {
  const todayIdx = planDay(plan, today);
  const days = past.map((r) => ({ day: planDay(plan, r.loggedDay.date), template: r.loggedDay.inputs })).filter((d) => d.day >= 0 && d.day < todayIdx);
  const events = past.map((r) => r.fast).filter((f): f is NonNullable<typeof f> => f !== null && f.startDay < todayIdx);
  return buildRealisedSchedule({ base: head.schedule, days, events, eventsReplacedBefore: Math.max(0, todayIdx), horizonDays: Math.max(horizonDays ?? head.schedule.horizonDays, todayIdx + 1) });
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
    if (r.energyBiasKcal.mean !== prev) offsets.push({ fromDay: r.anchorDay, kcal: r.energyBiasKcal.mean });
    prev = r.energyBiasKcal.mean;
  }
  return { anchors, offsets };
}

/** δ in force on a plan day. */
export function biasOn(records: readonly ConfirmedStateRecord[], day: number): { mean: number; sd: number } {
  let b = { mean: 0, sd: ASSIMILATION_DEFAULTS.biasPriorSdKcal };
  for (const r of [...records].sort((x, y) => x.anchorDay - y.anchorDay)) if (r.anchorDay <= day) b = r.energyBiasKcal;
  return b;
}

/** Hash of what the replay up to `day` depends on (baseline, realised days < day, anchors, δ steps). */
export function replayInputsHash(baseline: PlanDoc['baselineProfile'], schedule: Schedule, day: number, anchors: readonly AnchorSpec[], offsets: readonly IntakeOffset[]): string {
  const days = schedule.days.slice(0, Math.max(0, day)).map((d) => ({ ...d, program: stableStringify({ ...schedule.programs[d.program], id: undefined, label: undefined }) }));
  return contentHash({ baseline, days, events: (schedule.events ?? []).filter((e) => e.startDay < day), anchors: anchors.filter((a) => a.day <= day), offsets: offsets.filter((o) => o.fromDay <= day), engine: ENGINE_VERSION });
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
}

export interface DailyAssimilationOutput {
  replay: ReplayOutput;
  /** Filter series through today (water removed with the replay's own water terms). */
  points: TrendPoint[];
  trendToday: { kg: number; sd: number; rateKgPerWeek: number; rateSd: number } | null;
  /** True when the replay started from the cached anchor snapshot. */
  usedCache: boolean;
}

/** Daily step (§3.5 steps 1-2): replay from the latest anchor snapshot (or day 0) through today, then the trend filter. */
export function dailyAssimilation(i: DailyAssimilationInput): DailyAssimilationOutput {
  const prm = i.params ?? ASSIMILATION_DEFAULTS;
  const { anchors, offsets } = anchorsFromRecords(i.records);
  const todayIdx = planDay(i.plan, i.today);
  let from: EngineSnapshot | undefined;
  if (i.cached && i.cached.anchorDay <= todayIdx) {
    const h = replayInputsHash(i.plan.baselineProfile, i.schedule, i.cached.anchorDay, anchors, offsets);
    if (h === i.cached.inputsHash) from = i.cached.snapshot;
  }
  const replay = runReplay({ profile: i.plan.baselineProfile, schedule: i.schedule, anchors, intakeOffsets: offsets, ...(from ? { from } : {}) });
  // the filter needs the water terms on every weigh-in day: replay from day 0 when the cache starts after the first one
  const needFull = from !== undefined && i.weighIns.some((o) => o.day < replay.startDay);
  const water = needFull ? runReplay({ profile: i.plan.baselineProfile, schedule: i.schedule, anchors, intakeOffsets: offsets }).waterWakeKg : replay.waterWakeKg;
  const obs = i.weighIns.filter((o) => o.day <= todayIdx && Number.isFinite(water[o.day] ?? NaN)).map((o) => ({ ...o, waterKg: water[o.day]! }));
  const dow = estimateDowOffsets(obs, weekdayOf(i.plan.startDate), prm);
  const filt = runTrendFilter(obs, { params: prm, untilDay: todayIdx, ...(dow ? { dow: { offsets: dow, startWeekday: weekdayOf(i.plan.startDate) } } : {}) });
  const last = filt.points[filt.points.length - 1];
  return {
    replay,
    points: filt.points,
    trendToday: last ? { kg: last.w, sd: last.wSd, rateKgPerWeek: 7 * last.r, rateSd: 7 * last.rSd } : null,
    usedCache: from !== undefined,
  };
}

// ------------------------------------------------------------------------------------------- weekly check-in
export interface WeeklyCheckInInput {
  plan: PlanDoc & { id: string };
  schedule: Schedule;
  records: readonly ConfirmedStateRecord[];
  weighIns: readonly WeighInObs[];
  today: LocalDate;
  /** Plan days with a logged (non-assumed) intake: `LoggedDayResult.intakeLogged`. */
  intakeDays: readonly number[];
  aiEnergyShare?: number;
  composition?: CompositionReadings;
  hard?: HardReanchorReason;
  params?: AssimilationParams;
}

export interface WeeklyCheckInOutput {
  output: CheckInOutput;
  record: ConfirmedStateRecord | null;
  state: ConfirmedState | null;
}

/** Weekly check-in (§3.5 steps 4-6): δ, anchor, confirmed snapshot; the record is what syncs. */
export function weeklyCheckIn(i: WeeklyCheckInInput): WeeklyCheckInOutput {
  const day = planDay(i.plan, i.today);
  const prior = i.records.filter((r) => r.anchorDay < day);
  const { anchors, offsets } = anchorsFromRecords(prior);
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
    ...(i.aiEnergyShare !== undefined ? { aiEnergyShare: i.aiEnergyShare } : {}),
    ...(i.composition ? { composition: i.composition } : {}),
    ...(i.hard ? { hard: true } : {}),
    ...(i.params ? { params: i.params } : {}),
  });
  if (output.verdict !== 'confirmed' || !output.anchor || !output.trend || !output.snapshot || !output.replay) return { output, record: null, state: null };
  const split = output.residualSplit!;
  const allAnchors = [...anchors, output.anchor];
  const allOffsets = output.intakeOffset ? [...offsets, output.intakeOffset] : offsets;
  const record: ConfirmedStateRecord = {
    planId: i.plan.id,
    anchorDate: i.today,
    anchorDay: day,
    trendWeight: { kg: output.trend.w, sd: output.trend.wSd },
    energyBiasKcal: { mean: output.bias.mean, sd: output.bias.sd },
    residualSplit: {
      tissueMassKg: output.anchor.tissueMassKg,
      residualKg: split.residualKg,
      fatKg: split.fatKg,
      leanKg: split.leanKg,
      source: split.source,
      ...(output.anchor.split && typeof output.anchor.split === 'object' ? { fatFrac: output.anchor.split.fatFrac } : {}),
    },
    inputsHash: replayInputsHash(i.plan.baselineProfile, i.schedule, day, allAnchors, allOffsets),
    engine: { engineVersion: output.replay.result.meta.engineVersion, registryHash: output.replay.result.meta.registryHash },
    trigger: i.hard ? 'hard' : 'weekly',
    ...(i.hard ? { hardReason: i.hard } : {}),
  };
  const state: ConfirmedState = {
    anchorDate: i.today,
    snapshot: output.snapshot,
    energyBiasKcal: record.energyBiasKcal,
    trendWeight: record.trendWeight,
  };
  return { output, record, state };
}

/** Rebuild the confirmed state of a stored record by replaying with the stored anchors (§3.5 step 6; cached in `derived`). */
export function confirmedStateFromRecord(plan: PlanDoc, schedule: Schedule, records: readonly ConfirmedStateRecord[], record: ConfirmedStateRecord): ConfirmedState {
  const { anchors, offsets } = anchorsFromRecords(records.filter((r) => r.anchorDay <= record.anchorDay));
  const r = runReplay({ profile: plan.baselineProfile, schedule, anchors, intakeOffsets: offsets, captureAt: [record.anchorDay], record: 'none' });
  const snapshot = r.snapshots[record.anchorDay];
  if (!snapshot) throw new Error('anchor day outside the realised schedule');
  return { anchorDate: record.anchorDate, snapshot, energyBiasKcal: record.energyBiasKcal, trendWeight: record.trendWeight };
}

// ------------------------------------------------------------------------------------------- rules
/** Check-in due on the plan's check-in weekday (once per day; the command runs it automatically that day). */
export function isCheckInDue(plan: Pick<PlanDoc, 'policy' | 'startDate' | 'status'>, today: LocalDate, lastCheckIn: LocalDate | null): boolean {
  if (plan.status !== 'active') return false;
  if (daysBetween(plan.startDate, today) < 7) return false;
  if (weekdayOf(today) !== plan.policy.checkInWeekday) return false;
  return lastCheckIn !== today;
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
  const ms = effectiveEntries(i.measurements);
  if (ms.some((m) => m.method === 'dxa' && m.metric === 'bodyFatPct' && m.date === i.today && !m.assumed)) return 'dxa';
  const weighedToday = ms.some((m) => m.metric === 'weightKg' && m.date === i.today && !m.assumed);
  if (weighedToday && i.lastWeighInBefore && daysBetween(i.lastWeighInBefore, i.today) >= 14) return 'weighInGap';
  const ev = effectiveEntries(i.entries).filter((e): e is Extract<LogEntry, { kind: 'event' }> => e.kind === 'event' && !e.assumed);
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

/** Forecast band (P10/P50/P90) of a series on plan day `day` from a version's digest, or null. */
export function forecastBandOn(version: PlanVersionDoc, day: number, series: SeriesId = 'scaleWeight', which: 'asPrescribed' | 'realistic' = 'asPrescribed'): { p10: number; p50: number; p90: number } | null {
  const s = version.forecast[which][series] ?? version.forecast.asPrescribed[series];
  if (!s) return null;
  const k = day - version.forecast.fromDay;
  if (k < 0 || k >= s.p50.length) return null;
  return { p10: s.p10[k]!, p50: s.p50[k]!, p90: s.p90[k]! };
}

/** Block start days of a schedule (new-block re-anchor and filter noise). */
export function blockStartsOf(schedule: Schedule): number[] {
  return (schedule.blocks ?? []).map((b) => b.startDay).filter((d) => d > 0).sort((a, b) => a - b);
}
