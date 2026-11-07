/**
 * The read side of Living mode over the plan and log documents (E4's store, E5's pure functions): every screen reads the
 * same `projectLiving` the commands use (`today.get`, `plan.drift`, `plan.adherence`), so what a command writes is what
 * the next render shows. Installed by `../boot.ts` together with the command-backed actions (`./commands.ts`) whenever
 * the app's mode comes from the plan documents (`installDocumentPlanSource`).
 *
 * Cost: one full projection (with the engine replay) per revision for the current day — Today, the trend lane, drift
 * and the check-in read it; other dates use the fast path (no replay). The revision bumps on changes to the plan and
 * log collections only (not `derived`, which the daily assimilation rewrites), on the store finishing its load and on a
 * storage-engine switch.
 */
import { readLivingDocs } from '@/commands';
import { sessionCompiler } from '@/commands/livingWiring';
import {
  addDays,
  compareDates,
  daysBetween,
  headAdopted,
  openProposals,
  isLive,
  planDay,
  projectLiving,
  projectEntries,
  summarise,
  weekdayOf,
  type DriftReport,
  type LivingDocs,
  type LivingProjection,
  type LogEntry,
  type MeasurementEntry,
  type LocalDate,
  type PlanItemType,
  type PlanVersionDoc,
  type TodayView,
  type VersionReason,
} from '@/living';
import { pendingCheckInOf } from '@/living/checkInLoop';
import { weeklyModelReview } from '@/living/weeklyModel';
import { ASSIMILATION_DEFAULTS } from '@/engine/assimilation/params';
import { bpEpisodes } from '@/living/monitoring';
import type { TrendLaneData } from '@/features/charts/living/types';
import type { SeriesId, SimulationResult } from '@/engine';
import { INTERPRETABLE_STATUSES } from '@/lib/bodyContracts';
import type { DocumentStore } from '@/store';
import { getDocumentStore, onDocumentStoreSwitch } from '@/state/runtime';
import { useSafetyStore } from '@/state/safetyStore';
import { useSettingsStore } from '@/state/settingsStore';
import { currentDay, systemClock, type LivingClock } from '../clock';
import { fmtClock, fmtDateRange, fmtWeekday, kcal } from '../format';
import type { ChangeCardModel } from '../model/changeCard';
import type { LivingDataSource } from './source';
import { MONITORED_LABEL } from './types';
import type { AdherenceSummary, BodyComposition, CheckInModel, DayGlance, DriftCard, HistoryConflict, HistoryDay, MonitoredGoalRow, PlanVersionRow } from './types';

/** Collections whose changes move what Living screens show. */
export const LIVING_COLLECTIONS: ReadonlySet<string> = new Set(['activePlan', 'plans', 'planVersions', 'dailyLogs', 'measurements', 'dayStatus', 'anchors', 'settings']);

const REASON_TEXT: Record<VersionReason, string> = {
  start: 'started',
  light: 'small adjustment',
  weekly: 'weekly check-in',
  event: 'event',
  user: 'your change',
  coach: 'Coach change',
  pause: 'paused',
  resume: 'resumed',
  safety: 'safety',
};

const BLOCKS: Array<{ label: string; types: PlanItemType[] }> = [
  { label: 'Training', types: ['rtSession', 'cardioSession'] },
  { label: 'Protein', types: ['protein'] },
  { label: 'Energy', types: ['energy'] },
  { label: 'Fasting', types: ['fast', 'window'] },
  { label: 'Steps', types: ['steps'] },
];

const EMPTY_ADHERENCE: AdherenceSummary = { a7: null, a28: null, arrow: null, scored28: 0, daysLogged7: 0, blocks: [], costliest: null, learned: [] };

/** Proposal cards carry the plan version they adopt or reject. */
export function proposalCardId(planId: string, version: number): string {
  return `version:${planId}:${version}`;
}
export function parseProposalCardId(id: string): { planId: string; version: number } | null {
  const m = /^version:(.+):(\d+)$/.exec(id);
  return m ? { planId: m[1]!, version: Number(m[2]) } : null;
}

/** Include logged dates outside the active plan so a moved conflict stays reviewable. */
export function historyDates(planDates: readonly LocalDate[], entries: readonly { date: LocalDate }[], measurements: readonly { date: LocalDate }[], from: LocalDate, to: LocalDate): LocalDate[] {
  return [...new Set([...planDates, ...entries.map((e) => e.date), ...measurements.map((m) => m.date)])]
    .filter((date) => compareDates(date, from) >= 0 && compareDates(date, to) <= 0)
    .sort((a, b) => compareDates(b, a));
}

/** The week's biggest gap as a fact: "Thursday, 1 610 of 2 664 kcal" (the item's own line, numbers grouped). */
export function gapText(date: LocalDate, why: string): string {
  return `${fmtWeekday(date)}, ${why.replace(/^ate /, '').replace(/\d{4,}/g, (n) => kcal(Number(n)))}`;
}

/** What the check-in lacks to read the trend: "Not enough weigh-ins for the trend · 2 of 4 this week". */
export function missingWeighIns(n: number): string {
  return `Not enough weigh-ins for the trend · ${n} of 4 this week`;
}

/** Whether the run's status lets a series be read on a plan day (C6): none, an interpretable one, or one from a later day. */
function readableOn(result: Pick<SimulationResult, 'meta'>, id: SeriesId, day: number): boolean {
  const st = result.meta.outputStatus?.[id];
  return !st || INTERPRETABLE_STATUSES.has(st.status) || (st.fromDay !== undefined && day < st.fromDay);
}

/**
 * (A1-050, D4-05/C6) The tissue fat fraction 100·FM/TM at one end-of-day replay sample, both in kg: FM is the replay's
 * end-of-day fat mass and TM the engine's own same-time tissue mass FM + FFM_act (`result.safety.tissueMassKg`, written
 * from the composition bus after the day's bookkeeping), so a resumed replay (a later initial frame) and the reference
 * glycogen and water inside FFM_act need no reconstruction. Null — no derived percentage — when either sample is missing,
 * the denominator is not finite and positive, or the run's status forbids reading the fat mass or lean tissue that day;
 * never FM + lean tissue, wake or scale mass, or a fixed water coefficient.
 */
export function tissueFatPctAt(replay: { fatKg: ArrayLike<number>; result: Pick<SimulationResult, 'meta' | 'safety'> }, day: number): number | null {
  if (!Number.isInteger(day) || day < 0 || day >= replay.fatKg.length) return null;
  const fat = replay.fatKg[day]!;
  const tm = replay.result.safety?.tissueMassKg?.[day];
  if (!Number.isFinite(fat) || fat < 0 || tm === undefined || !Number.isFinite(tm) || tm <= 0) return null;
  if (!readableOn(replay.result, 'fatMass', day) || !readableOn(replay.result, 'leanTissue', day)) return null;
  const pct = (100 * fat) / tm;
  return Number.isFinite(pct) && pct <= 100 ? pct : null;
}

export interface DocumentLivingOptions {
  clock?: LivingClock;
  getStore?: () => DocumentStore;
  onSwitch?: (fn: (s: DocumentStore) => void) => () => void;
  /** The documents (tests); default `readLivingDocs` over the app's store. */
  read?: (range: { from: LocalDate; to: LocalDate }) => LivingDocs;
}

export function createDocumentLivingSource(opts: DocumentLivingOptions = {}): LivingDataSource {
  const clock = opts.clock ?? systemClock;
  const getStore = opts.getStore ?? getDocumentStore;
  const read = opts.read ?? (() => readLivingDocs());
  const listeners = new Set<() => void>();
  let rev = 0;
  let attached: DocumentStore | null = null;
  let off: (() => void) | null = null;
  // per revision: the documents and the projections by date
  let cacheRev = -1;
  let docsCache: LivingDocs | null = null;
  const projections = new Map<string, LivingProjection>();

  const bump = () => {
    rev++;
    listeners.forEach((l) => l());
  };
  const attach = (store: DocumentStore) => {
    off?.();
    attached = store;
    off = store.subscribe((c) => {
      if (LIVING_COLLECTIONS.has(c.col)) bump();
    });
    const loaded = () => attached === store && bump();
    store.ready.then(loaded, loaded);
  };
  const current = () => {
    const s = getStore();
    if (s !== attached) attach(s);
  };
  current();
  (opts.onSwitch ?? onDocumentStoreSwitch)((s) => {
    attach(s);
    bump();
  });
  // the projection reads quiet mode from the settings store, which loads after the documents (and changes from
  // Settings): a change there is a new revision too (Q4-17)
  useSettingsStore.subscribe((s, p) => {
    if (s.quietMode !== p.quietMode || s.quietModeSet !== p.quietModeSet) bump();
  });
  // quiet mode is on by default in safety mode R1, so new safety answers can change it too
  useSafetyStore.subscribe((s, p) => {
    if (s.answers !== p.answers) bump();
  });

  const today = () => currentDay(clock);
  const fresh = () => {
    current();
    if (cacheRev !== rev) {
      cacheRev = rev;
      docsCache = null;
      projections.clear();
    }
  };
  const docs = (): LivingDocs => {
    fresh();
    const t = today();
    docsCache ??= read({ from: addDays(t, -60), to: t });
    return docsCache;
  };
  const livePlan = () => {
    const p = docs().plan;
    return p && isLive(p) ? p : null;
  };
  /** The projection "as of" a date; the full one (replay, drift) only for the current day. */
  const project = (date: LocalDate = today()): LivingProjection => {
    fresh();
    const full = date === today();
    const key = `${date}|${full}`;
    let p = projections.get(key);
    if (!p) {
      p = projectLiving({ docs: docs(), today: date, tz: clock.tz, now: clock.now().toISOString(), sessionCompiler, ...(full ? {} : { skipAssimilation: true }) });
      projections.set(key, p);
    }
    return p;
  };

  const isPaused = (date: LocalDate) => {
    const plan = livePlan();
    return !!plan && plan.pauses.some((p) => compareDates(date, p.from) >= 0 && (p.to === null || compareDates(date, p.to) < 0));
  };
  const loggedOn = (date: LocalDate) => {
    const d = docs();
    return d.entries.some((e) => e.date === date && e.kind !== 'retract') || d.measurements.some((m) => m.date === date) || d.dayStatus.some((s) => s.date === date && s.marks !== undefined && !s.assumed);
  };
  const weighIns = (from: LocalDate, to: LocalDate) =>
    projectEntries(docs().measurements)
      .filter((m) => m.metric === 'weightKg' && compareDates(m.date, from) >= 0 && compareDates(m.date, to) <= 0)
      .sort((a, b) => ((a.at ?? '') < (b.at ?? '') ? -1 : 1));

  function driftReport(): DriftReport | null {
    return livePlan() ? project().drift : null;
  }

  function trend(from: LocalDate, to: LocalDate): TrendLaneData | null {
    const plan = livePlan();
    const t = today();
    // r068 L29: without a plan the weigh-ins still draw (no filtered trend, forecast or goal: those come from a plan)
    if (!plan) {
      const n = daysBetween(from, to) + 1;
      const ws = weighIns(from, compareDates(to, t) < 0 ? to : t);
      if (!ws.length) return null;
      return {
        startDate: from,
        days: n,
        todayIndex: compareDates(t, from) >= 0 && compareDates(t, to) <= 0 ? daysBetween(from, t) : null,
        unit: 'kg',
        decimals: 1,
        weighIns: ws.map((w) => ({ day: daysBetween(from, w.date), value: w.value })),
        trend: Array.from({ length: n }, () => Number.NaN),
      };
    }
    const p = project();
    const head = p.head;
    const n = daysBetween(from, to) + 1;
    // the scale trend against the scale forecast (C4/D5-02: one operator); the water-adjusted estimate is not this lane
    const byDay = new Map((p.assimilation?.scalePoints ?? p.assimilation?.points ?? []).map((x) => [x.day, x] as const));
    const series = (which: 'asPrescribed' | 'realistic', k: number) => {
      const f = head?.forecast;
      // a realistic band only when the version holds one (never the as-prescribed band relabelled realistic, C2/D5-05)
      const s = f ? (which === 'realistic' ? (f.realisticStatus === 'unavailable' ? undefined : f.realistic?.scaleWeight) : f.asPrescribed.scaleWeight) : undefined;
      const i = k - (f?.fromDay ?? 0);
      return s && i >= 0 && i < s.p50.length ? { p10: s.p10[i]!, p50: s.p50[i]!, p90: s.p90[i]! } : null;
    };
    const data: TrendLaneData = {
      startDate: from,
      days: n,
      todayIndex: compareDates(t, from) >= 0 && compareDates(t, to) <= 0 ? daysBetween(from, t) : null,
      unit: 'kg',
      decimals: 1,
      weighIns: weighIns(from, compareDates(to, t) < 0 ? to : t).map((w) => ({ day: daysBetween(from, w.date), value: w.value })),
      trend: [],
      trendSd: [],
      realistic: { p10: [], p50: [], p90: [] },
      asPrescribed: { p10: [], p90: [] },
    };
    // (D8-02) a nominal-only forecast (no stochastic members) has a line and no range: its P10/P90 are not drawn
    const nominalOnly = head?.forecast.bandMeta?.method === 'none';
    for (let i = 0; i < n; i++) {
      const k = planDay(plan, addDays(from, i));
      const pt = byDay.get(k);
      data.trend.push(pt ? pt.w : NaN);
      data.trendSd!.push(pt ? pt.wSd : NaN);
      const r = k >= 0 ? series('realistic', k) : null;
      const a = k >= 0 ? series('asPrescribed', k) : null;
      data.realistic!.p10.push(nominalOnly ? NaN : (r?.p10 ?? NaN));
      data.realistic!.p50!.push(r?.p50 ?? NaN);
      data.realistic!.p90.push(nominalOnly ? NaN : (r?.p90 ?? NaN));
      data.asPrescribed!.p10.push(nominalOnly ? NaN : (a?.p10 ?? NaN));
      data.asPrescribed!.p90.push(nominalOnly ? NaN : (a?.p90 ?? NaN));
    }
    const goal = plan.request.goals.find((g) => g.metric === 'scaleWeight' && g.target !== undefined);
    if (goal?.target !== undefined) data.goal = { value: goal.target, label: `goal ${goal.target} kg` };
    const range = head?.forecast.goals.find((g) => g.dateRange)?.dateRange;
    // (D8-02) the goal-date range is a parameter-sensitivity range of unvalidated coverage: no "likely"
    if (range) data.goalDateRange = { from: range[0], to: range[1], label: fmtDateRange(range[0], range[1]) };
    const events: NonNullable<TrendLaneData['events']> = [];
    for (const v of versionRows()) if (v.version > 1 && v.status !== 'proposed' && v.status !== 'rejected') events.push({ day: daysBetween(from, v.date), kind: 'version', label: `v${v.version}` });
    for (const pz of plan.pauses) events.push({ day: daysBetween(from, pz.from), kind: 'pause', label: 'paused', endDay: daysBetween(from, pz.to ?? t) });
    data.events = events.filter((e) => e.day >= 0 && e.day < n);
    return data;
  }

  function adherence(asOf: LocalDate): AdherenceSummary {
    if (!livePlan()) return EMPTY_ADHERENCE;
    const p = project(compareDates(asOf, today()) > 0 ? today() : asOf);
    const week = p.days.filter((d) => daysBetween(d.date, asOf) >= 0 && daysBetween(d.date, asOf) < 7);
    let worst: { label: string; cost: number; date: LocalDate; weight: number } | null = null;
    const sums = BLOCKS.map(() => ({ s: 0, n: 0 }));
    for (const d of week) {
      for (const it of d.result.score.items) {
        if (it.credit === null) continue;
        const b = BLOCKS.findIndex((x) => x.types.includes(it.type));
        if (b >= 0) {
          sums[b]!.s += it.credit;
          sums[b]!.n += 1;
        }
        const cost = it.weight * (1 - it.credit);
        if (!worst || cost > worst.cost) worst = { label: it.why || it.type, cost, date: d.date, weight: it.weight };
      }
    }
    const w = worst as { label: string; cost: number; date: LocalDate; weight: number } | null;
    return {
      a7: p.trend.a7,
      a28: p.trend.a28,
      arrow: p.trend.arrow,
      scored28: p.trend.scored28,
      daysLogged7: p.trend.daysLogged7,
      blocks: BLOCKS.map((b, i) => ({ type: b.types[0]!, label: b.label, mean: sums[i]!.n > 0 ? Math.round((100 * sums[i]!.s) / sums[i]!.n) : null, n: sums[i]!.n })),
      costliest: w && w.cost > 0 ? gapText(w.date, w.label) : null,
      learned: [],
    };
  }

  function checkIn(asOf: LocalDate): CheckInModel | null {
    const plan = livePlan();
    if (!plan) return null;
    const p = project();
    const w7 = weighIns(addDays(asOf, -6), asOf).length;
    const enough = w7 >= 4;
    const g = p.drift?.goals[0];
    const pts = p.assimilation?.scalePoints ?? p.assimilation?.points ?? [];
    const at = (date: LocalDate) => pts.find((x) => x.day === planDay(plan, date))?.w;
    const now = at(asOf);
    const before = at(addDays(asOf, -7));
    const wk = now !== undefined && before !== undefined ? now - before : null;
    const sign = (v: number) => (v < 0 ? '−' : '+');
    const from = addDays(asOf, -13);
    const proposal = changes('all').find((c) => c.state === 'pending');
    // (D5-06) a version that took effect after the last confirmed check-in (the first version is the plan itself)
    const head = p.head;
    const effective = head ? addDays(plan.startDate, head.effectiveFromDay) : null;
    const planChanged = !!head && head.version > 1 && effective !== null && compareDates(effective, asOf) <= 0 && (p.lastCheckIn === null || compareDates(effective, p.lastCheckIn) > 0);
    const pending = pendingCheckInOf({ docs: docs(), projection: p, today: asOf });
    const review = pending?.review.status === 'review';
    const ea7 = p.energyExposure?.calendar7 ?? null;
    return {
      previewId: pending?.evidence.previewId ?? '',
      weeklyModel: head && asOf === today() ? weeklyModelReview({
        request: plan.request,
        forecast: head.forecast,
        startDate: plan.startDate,
        endDate: head.plannedEndDate ?? plan.plannedEndDate,
        asOf,
        weighIns: new Set(weighIns(addDays(asOf, -(ASSIMILATION_DEFAULTS.biasWindowDays - 1)), asOf).filter((m) => !m.assumed && m.date >= plan.startDate).map((m) => m.date)).size,
        foodDays7: p.days.filter((d) => daysBetween(d.date, asOf) >= 1 && daysBetween(d.date, asOf) <= 7 && d.result.calibrationEligible).length,
        foodDaysPrevious7: p.days.filter((d) => daysBetween(d.date, asOf) >= 8 && daysBetween(d.date, asOf) <= 14 && d.result.calibrationEligible).length,
        reviewRequired: review,
        proposalPending: !!proposal,
        prescribedKcal: Array.from({ length: 7 }, (_, n) => project(addDays(asOf, n)).today.prescription?.energyKcal ?? null),
      }) : null,
      decisionPointDate: pending?.evidence.decisionPoint ?? asOf,
      due: p.checkInDue,
      weekday: fmtWeekday(addDays(plan.startDate, (plan.policy.checkInWeekday - weekdayOf(plan.startDate) + 7) % 7)),
      weighIns7: w7,
      verdict:
        enough && g
          ? {
              state: g.state,
              goalDate: g.goalDate.range,
              // (D8-02) no ± from a sensitivity range (a stored legacy SD is still shown as stored)
              shiftText: g.goalDate.shiftDays !== null && Math.abs(g.goalDate.shiftDays) >= 3 ? `moved by ${sign(g.goalDate.shiftDays)}${Math.abs(g.goalDate.shiftDays)} days${g.goalDate.shiftSd !== null ? ` (±${g.goalDate.shiftSd})` : ''}` : null,
              // D5-02: no cause is inferred (always empty); certainty travels with the verdict
              cause: g.causes[0]?.text ?? '',
              ...(g.certainty ? { certainty: g.certainty } : {}),
            }
          : null,
      trendText: wk !== null ? `${sign(wk)}${Math.abs(wk).toFixed(1)} kg this week` : 'No weekly trend yet',
      missingText: enough ? null : missingWeighIns(w7),
      adherence: adherence(asOf),
      proposalId: proposal?.id ?? null,
      nextDate: addDays(asOf, 7),
      trend: trend(compareDates(from, plan.startDate) < 0 ? plan.startDate : from, asOf),
      review,
      reviewReasons: pending?.review.reasons.map((r) => r.code) ?? [],
      reviewDetails: p.energyExposure ? [
        { label: 'Calendar coverage', value: `${p.energyExposure.calendar7.covered}/${p.energyExposure.calendar7.days} days` },
        { label: 'Reference', value: '30 kcal/kg FFM/day · provisional policy · more than 14 consecutive complete windows' },
        { label: 'Basis', value: 'Calendar days · logged intake · net exercise from covered sessions · model FFM scenario' },
        { label: 'Exercise coverage', value: `${p.energyExposure.calendar7.exerciseCoveredDays}/${p.energyExposure.calendar7.days} days · ${p.energyExposure.calendar7.exerciseScopes.map((scope) => scope === 'coveredSessions' ? 'Covered sessions' : scope === 'actualDay' ? 'Actual day' : scope === 'prescribedScenario' ? 'Prescribed scenario' : 'Unknown').join(', ')}` },
        ...p.energyExposure.calendar7.assumptions.map((assumption) => ({ label: 'Scenario', value: assumption === 'coveredSessions:noAdditionalExerciseAssumption' ? 'Assumes no exercise beyond the covered sessions' : assumption === 'prescribedExerciseScenario' ? 'Assumes the prescribed exercise scenario' : assumption })),
      ] : [],
      planChanged,
      energyAvailability: ea7
        ? {
            status: ea7.ea.status,
            ...(ea7.ea.value !== undefined ? { value: ea7.ea.value } : {}),
            ...(ea7.ea.range ? { range: ea7.ea.range } : {}),
            ...(ea7.lowerBound !== undefined ? { lowerBound: ea7.lowerBound } : {}),
            covered: ea7.covered,
            days: ea7.days,
            reasonCode: ea7.ea.reasonCode,
            version: ea7.version,
            intakeCoveredDays: ea7.intakeCoveredDays,
            exerciseCoveredDays: ea7.exerciseCoveredDays,
            exerciseScopes: ea7.exerciseScopes,
            assumptions: ea7.assumptions,
          }
        : null,
      wellbeing: { status: p.wellbeing.status, hunger: p.wellbeing.latest.hunger?.value ?? null, mood: p.wellbeing.latest.mood?.value ?? null },
    };
  }

  function history(from: LocalDate, to: LocalDate): HistoryDay[] {
    const t = today();
    const d = docs();
    const entries = projectEntries(d.entries).filter((e) => e.kind !== 'retract');
    const measurements = projectEntries(d.measurements);
    const assumed = new Set(d.dayStatus.filter((s) => s.assumed).map((s) => s.date));
    const versionLabel = (e: LogEntry): string => {
      const parts = [e.date, summarise(e).label];
      if ('clockH' in e && typeof e.clockH === 'number') parts.push(fmtClock(e.clockH));
      if (e.kind === 'meal') {
        if (e.slot) parts.push(e.slot.replace(/([a-z])(\d)/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()));
        if (e.complete !== undefined) parts.push(e.complete ? 'meal complete' : 'meal unfinished');
      }
      if (e.kind === 'session') {
        if (e.startH !== undefined) parts.push(fmtClock(e.startH));
        if (e.durationMin !== undefined) parts.push(`${e.durationMin} min`);
        if (e.rpe !== undefined) parts.push(`effort ${e.rpe}`);
        if (e.performed.length) parts.push(e.performed.map((p) => [p.freeText ?? p.exerciseId, p.setCount ? `${p.setCount} sets` : undefined, p.loadKg !== undefined ? `${p.loadKg} kg` : undefined].filter(Boolean).join(' ')).join(', '));
      }
      if (e.kind === 'sleep') {
        parts.push(`${e.bedAt}–${e.wakeAt}${e.quality ? ` · ${e.quality}` : ''}`);
        // (D8-06) as entered: restfulness only when rated, a nap named as one
        if (e.restfulness !== undefined) parts.push(`restfulness ${e.restfulness}`);
        if (e.episodeKind === 'nap') parts.push('nap');
      }
      if (e.kind === 'fast') {
        parts.push(`${e.lastIntakeAt}–${e.firstIntakeAt ?? 'ongoing'}`);
        if (e.electrolytes !== undefined) parts.push(e.electrolytes ? 'with electrolytes' : 'without electrolytes');
      }
      if (e.kind === 'substance') parts.push(`${e.amount} ${e.unit}`);
      if (e.kind === 'supplement') parts.push(`${e.dose} ${e.unit}`);
      if (e.kind === 'subjective') {
        // (D2-06/D8-09) each rating as entered (unrated scales are absent, never zero); concern flags by name
        for (const field of ['difficulty', 'hunger', 'fullness', 'craving', 'energy', 'mood', 'fatigue', 'restfulness', 'stress'] as const) {
          if (e[field] !== undefined) parts.push(`${field} ${e[field]}`);
        }
        if (e.concerns?.length) parts.push(`concern: ${e.concerns.map((c) => c.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()).join(', ')}`);
        if (e.illness !== undefined) parts.push(e.illness ? 'feeling ill' : 'not feeling ill');
      }
      if (e.kind === 'event' && e.to) parts.push(`through ${e.to}`);
      if (e.text) parts.push(e.text);
      return parts.join(' · ');
    };
    const measurementLabel = (m: MeasurementEntry): string => {
      const units: Record<string, string> = { Kg: 'kg', Cm: 'cm', Pct: '%', MmHg: 'mmHg', MmolL: 'mmol/L', MgL: 'mg/L', gL: 'g/L' };
      const suffix = Object.keys(units).find((u) => m.metric.endsWith(u));
      const metric = (suffix ? m.metric.slice(0, -suffix.length) : m.metric).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
      return [
        m.date,
        `${metric} ${m.value}${suffix ? ` ${units[suffix]}` : ''}`,
        m.method,
        m.context?.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(),
        m.repeats?.length ? `${m.repeats.length} readings` : undefined,
      ].filter(Boolean).join(' · ');
    };
    const conflictsOn = (date: LocalDate): HistoryConflict[] => [
      ...entries.filter((e) => e.date === date && e.conflict).map((e): HistoryConflict => ({
        parentId: e.conflict!.parentId,
        kind: e.kind === 'meal' ? 'meal' : e.kind === 'session' ? 'workout' : 'entry',
        versions: e.conflict!.versions.map((v) => {
          const summary = summarise(v);
          return { id: v.id, label: versionLabel(v), ...(v.at ? { at: v.at } : {}), source: summary.source, ...(v.kind === 'meal' ? { energyKcal: v.totals.energyKcal.value } : {}) };
        }),
      })),
      ...measurements.filter((m) => m.date === date && m.conflict).map((m): HistoryConflict => ({
        parentId: m.conflict!.parentId,
        kind: 'measurement',
        versions: m.conflict!.versions.map((v) => ({
          id: v.id,
          label: measurementLabel(v),
          ...(v.at ? { at: v.at } : {}),
          source: v.source.by,
        })),
      })),
    ];
    const entriesOn = (date: LocalDate) => entries.filter((e) => e.date === date).map((e) => ({
      ...summarise(e),
      ...(e.conflict ? { conflict: { parentId: e.conflict.parentId, versions: e.conflict.versions.map(summarise) } } : {}),
    }));
    const planDays = livePlan() ? project().days : [];
    const byDate = new Map(planDays.map((x) => [x.date, x] as const));
    return historyDates(planDays.map((x) => x.date), entries, measurements, from, to).map((date) => {
      const x = byDate.get(date);
      return {
        date,
        score: x?.result.score ?? null,
        final: compareDates(date, t) < 0 || !!x?.result.score.final,
        assumed: assumed.has(date),
        paused: !!x?.prescription.paused,
        entries: entriesOn(date),
        conflicts: conflictsOn(date),
      };
    });
  }

  /**
   * Composition from the latest anchored state (Progress › Body). (D5-07/C6) The model's fat mass and lean tissue at the
   * anchor day come from the replay — a record's `residualSplit` holds only how that check-in's residual was split, never
   * the masses — and the fat share is the tissue fat fraction 100·FM/TM at the same end-of-day sample, TM = FM + FFM_act
   * read from the replay's own tissue-mass trace (`tissueFatPctAt`; D4-05: FFM_act keeps the reference glycogen and its
   * water, which lean tissue alone omits), not a scale or scan reading; withheld when that denominator is unavailable.
   * These are model estimates without a supported interval: the row carries its value as both ends (no invented range;
   * the reader shows no range when the ends are equal). Raw readings stay in the measurements as entered.
   */
  function composition(): BodyComposition | null {
    const plan = livePlan();
    if (!plan) return null;
    const d = docs();
    const label: Record<string, string> = { waistCm: 'waist', hipCm: 'hip', neckCm: 'neck', chestCm: 'chest', armCm: 'arm', thighCm: 'thigh' };
    const girths = projectEntries(d.measurements)
      .filter((m) => label[m.metric])
      .map((m) => ({ label: label[m.metric]!, value: m.value, method: m.method ?? 'tape', date: m.date, repeats: m.repeats?.length ?? 1 }));
    const records = [...d.records].sort((a, b) => a.anchorDay - b.anchorDay);
    const last = records[records.length - 1];
    if (!last && girths.length === 0) return null;
    const rows: BodyComposition['rows'] = [];
    const replay = last ? project().assimilation?.replay : undefined;
    const at = (xs: ArrayLike<number> | undefined, day: number): number | null => (xs && day >= 0 && day < xs.length && Number.isFinite(xs[day]!) ? xs[day]! : null);
    if (last && replay) {
      const fat = at(replay.fatKg, last.anchorDay);
      const lean = at(replay.leanKg, last.anchorDay);
      const first = records[0];
      const fat0 = first && first !== last ? at(replay.fatKg, first.anchorDay) : null;
      const lean0 = first && first !== last ? at(replay.leanKg, first.anchorDay) : null;
      const point = (value: number) => ({ value, lo: value, hi: value });
      if (fat !== null) rows.push({ label: 'fat mass', ...point(fat), unit: 'kg', decimals: 1, sinceStart: fat0 !== null ? fat - fat0 : null });
      if (lean !== null) rows.push({ label: 'lean tissue', ...point(lean), unit: 'kg', decimals: 1, sinceStart: lean0 !== null ? lean - lean0 : null });
      const pct = fat !== null ? tissueFatPctAt(replay, last.anchorDay) : null;
      if (pct !== null) rows.push({ label: 'tissue fat', ...point(pct), unit: '%', decimals: 1, sinceStart: null });
    }
    if (rows.length === 0 && girths.length === 0) return null;
    return { asOf: last?.anchorDate ?? today(), rows, girths };
  }

  function versionDocs(): PlanVersionDoc[] {
    return [...docs().versions].sort((a, b) => a.version - b.version);
  }

  function versionRows(): PlanVersionRow[] {
    const plan = livePlan();
    if (!plan) return [];
    const head = headAdopted(docs().versions);
    return versionDocs()
      .map((v): PlanVersionRow => ({
        version: v.version,
        reason: v.reason,
        reasonText: REASON_TEXT[v.reason] ?? v.reason,
        date: v.effectiveFromDay > 0 ? addDays(plan.startDate, v.effectiveFromDay) : (v.createdAt.slice(0, 10) < plan.startDate ? plan.startDate : v.createdAt.slice(0, 10)),
        status: v.status === 'adopted' && head && v.version !== head.version ? 'superseded' : v.status,
        summary: v.explanation[0] ?? (v.reason === 'start' ? 'The plan as chosen.' : ''),
        diff: (v.diff ?? []).map((r) => ({ date: r.date, field: r.field, before: r.before, after: r.after, why: r.why })),
        goalDates: v.forecast.goals.map((g) => ({ label: g.metric === 'scaleWeight' ? 'body weight' : g.metric, range: g.dateRange })),
      }))
      .reverse();
  }

  function changes(scope: 'today' | 'all'): ChangeCardModel[] {
    const plan = livePlan();
    if (!plan) return [];
    void scope; // proposals show on Today and in the Coach alike
    const head = headAdopted(docs().versions);
    const before = head?.forecast.goals.find((g) => g.dateRange)?.dateRange ?? null;
    return openProposals(versionDocs())
      .reverse()
      .map((v): ChangeCardModel => {
        const after = v.forecast.goals.find((g) => g.dateRange)?.dateRange ?? null;
        return {
          id: proposalCardId(plan.id, v.version),
          class: 'edit',
          title: `Proposal · ${v.explanation[0] ?? REASON_TEXT[v.reason]}`,
          createdAt: v.createdAt,
          items: (v.diff ?? []).map((r) => ({ label: `${r.date} ${r.field}`, before: r.before, after: r.after })),
          ...(before || after ? { impact: { goalDates: [{ label: 'goal date', before, after }], metrics: [] } } : {}),
          ...(v.explanation.length > 1 ? { note: v.explanation.slice(1).join(' ') } : {}),
          state: 'pending',
        };
      });
  }

  return {
    today: (date): TodayView | null => {
      if (!livePlan()) return null;
      const view = project(date).today;
      // the projection reads the viewed date as "today": the check-in and the welcome-back offer belong to the real today
      // only (a past Saturday is not check-in day; a future day has no missed days to fill)
      return date === today() ? view : { ...view, notices: view.notices.filter((n) => n.kind !== 'checkIn' && n.kind !== 'welcomeBack') };
    },
    days: (dates) => {
      const plan = livePlan();
      const byDate = plan ? new Map(project().days.map((x) => [x.date, x] as const)) : new Map();
      const assumed = new Set(docs().dayStatus.filter((s) => s.assumed).map((s) => s.date));
      return dates.map((date): DayGlance => {
        const inPlan = !!plan && compareDates(date, plan.startDate) >= 0 && compareDates(date, plan.plannedEndDate) < 0;
        return {
          date,
          inPlan,
          isStart: !!plan && date === plan.startDate,
          isEnd: !!plan && date === addDays(plan.plannedEndDate, -1),
          paused: isPaused(date),
          assumed: assumed.has(date),
          logged: inPlan && loggedOn(date),
          score: inPlan ? (byDate.get(date)?.result.score ?? null) : null,
        };
      });
    },
    trend,
    drift: driftReport,
    driftCards: (): DriftCard[] =>
      (driftReport()?.goals ?? []).map((g) => ({
        goal: g.goal, metric: g.metric, state: g.state, goalDate: g.goalDate, causes: g.causes, action: g.action, text: g.text, label: g.metric === 'scaleWeight' ? 'Body weight' : g.metric,
        // (D5-02) certainty, the labelled residual and the observed intake difference travel with the card
        ...(g.certainty ? { certainty: g.certainty } : {}),
        ...(g.residual ? { residual: g.residual } : {}),
        ...(g.loggedIntakeDiff !== undefined ? { loggedIntakeDiff: g.loggedIntakeDiff } : {}),
      })),
    monitoredGoals: (): MonitoredGoalRow[] => {
      if (!livePlan()) return [];
      const p = project();
      return p.monitoring.map((row) => ({
        ...row, label: MONITORED_LABEL[row.metric] ?? row.metric,
        ...(row.bp ? { bpEpisodes: bpEpisodes(docs().measurements).filter((e) => compareDates(e.date, p.plan!.startDate) >= 0 && compareDates(e.date, today()) <= 0) } : {}),
      }));
    },
    adherence,
    checkIn,
    history,
    composition,
    versions: versionRows,
    changes,
    subscribe: (l) => {
      current();
      listeners.add(l);
      return () => listeners.delete(l);
    },
    revision: () => {
      current();
      return rev;
    },
  };
}
