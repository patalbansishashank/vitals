/**
 * The living-plan projection: everything Today, Progress and the Coach read, computed from the plan's documents in one
 * pure call — prescriptions (frozen ones from `dayStatus`, else frozen now), LoggedDays and scores for every plan day up
 * to today, the adherence trend and revealed adherence, the daily assimilation (replay + trend filter), drift and the
 * `TodayView`. E4's read commands (`today.get`, `day.get`, `plan.adherence`, `plan.drift`, `plan.get`) are thin wrappers
 * around it; the weekly check-in uses its realised schedule and weigh-ins. Deterministic for identical documents.
 */
import type { CompiledSchedule, MetricId } from '@/engine';
import { adherenceTrend, expectedCreditFor, revealedAdherence, type CreditObservation } from './adherence';
import { blockStartsOf, dailyAssimilation, forecastBandOn, isCheckInDue, realisedSchedule, weighInsFor, type DailyAssimilationOutput } from './assimilate';
import { headAdopted, openProposals, pausedDaySet, planDay, versionInForce } from './calendar';
import { addDays, compareDates, minDate } from './dates';
import { driftGoal, rawDriftState } from './drift';
import type { EquivalenceFn } from './equivalence';
import { catalogueEquivalence } from './equivalence';
import { burdenMonitor, lapseState, loggedDays, projectEntries } from './logs';
import { toLoggedDay, type LoggedDayResult, type SessionCompiler } from './loggedDay';
import type { DayObservations } from './observations';
import type { BlockAdherence } from './plannerContract';
import { compileVersion, freezePrescription } from './prescription';
import { buildTodayView } from './today';
import type {
  AdherenceTrend,
  ConfirmedStateRecord,
  DayStatusDoc,
  DriftReport,
  DriftState,
  Instant,
  LocalDate,
  LogEntry,
  MeasurementEntry,
  Notice,
  PlanDoc,
  PlanVersionDoc,
  PrescribedDaySnapshot,
  TodayView,
} from './types';

/** Default energy density for the drift cause split when no replay mix is at hand, kcal/kg (R11: ≈ 7,000 order). */
export const DRIFT_RHO_KCAL_PER_KG = 7000;

export interface LivingDocs {
  plan: (PlanDoc & { id: string }) | null;
  versions: readonly PlanVersionDoc[];
  dayStatus: readonly DayStatusDoc[];
  entries: readonly LogEntry[];
  measurements: readonly MeasurementEntry[];
  records: readonly ConfirmedStateRecord[];
  observations?: readonly DayObservations[];
  settings?: { quietMode?: boolean; dayRolloverH?: number };
}

export interface ProjectionInput {
  docs: LivingDocs;
  today: LocalDate;
  tz: string;
  now: Instant;
  equivalence?: EquivalenceFn;
  sessionCompiler?: SessionCompiler;
  /** Skip the engine replay (fast paths: `day.get`, `plan.adherence`). Default false. */
  skipAssimilation?: boolean;
  /** Cached confirmed snapshot of the latest record (derived collection). */
  cached?: Parameters<typeof dailyAssimilation>[0]['cached'];
}

export interface ProjectedDay {
  date: LocalDate;
  planDay: number;
  prescription: PrescribedDaySnapshot;
  /** True when the prescription came from `dayStatus.prescribed` (frozen at rollover). */
  frozen: boolean;
  result: LoggedDayResult;
}

export interface LivingProjection {
  plan: (PlanDoc & { id: string }) | null;
  head: PlanVersionDoc | null;
  days: ProjectedDay[];
  trend: AdherenceTrend;
  blocks: BlockAdherence[];
  credits: CreditObservation[];
  assimilation: DailyAssimilationOutput | null;
  drift: DriftReport | null;
  checkInDue: boolean;
  lastCheckIn: LocalDate | null;
  today: TodayView;
}

function goalDirection(plan: PlanDoc, metric: MetricId, target: number | undefined): 'down' | 'up' {
  const start = plan.baselineProfile.body.weightKg;
  if (metric === 'scaleWeight' && target !== undefined) return target <= start ? 'down' : 'up';
  return metric === 'fatMass' || metric === 'bodyFatPct' || metric === 'waist' ? 'down' : 'up';
}

export function projectLiving(i: ProjectionInput): LivingProjection {
  const { docs, today, tz, now } = i;
  const eq = i.equivalence ?? catalogueEquivalence;
  const plan = docs.plan;
  const statusByDate = new Map(docs.dayStatus.map((s) => [s.date, s] as const));
  const entries = projectEntries(docs.entries);
  const measurements = projectEntries(docs.measurements);
  const obsByDate = new Map((docs.observations ?? []).map((o) => [o.date, o] as const));
  const records = [...docs.records].filter((r) => !plan || r.planId === plan.id).sort((a, b) => a.anchorDay - b.anchorDay);
  const lastCheckIn = records.length > 0 ? records[records.length - 1]!.anchorDate : null;
  const settings = docs.settings ?? {};
  const head = plan ? headAdopted(docs.versions.filter((v) => v.planId === plan.id)) : null;
  const notices: Notice[] = [];

  if (!plan || !head || plan.status === 'ended' || compareDates(today, plan.startDate) < 0) {
    const trend = adherenceTrend([], today);
    const view = buildTodayView({
      date: today, tz, rolloverH: settings.dayRolloverH ?? 4, quietMode: settings.quietMode ?? false, minimalMode: false, now,
      plan: plan && plan.status !== 'ended' ? plan : null, version: plan && plan.status !== 'ended' ? head : null, prescription: null, entries: entries.filter((e) => e.date === today),
      measurements: measurements.filter((m) => m.date === today), status: statusByDate.get(today) ?? null, logged: null, trend, drift: null, trendWeight: null,
      forecastToday: null, checkIn: { due: false, lastAt: lastCheckIn }, observations: obsByDate.get(today) ?? null, lapse: { welcomeBack: false, gap: [] },
      notices: plan && plan.status === 'scheduled' ? [{ id: 'scheduled', kind: 'info', level: 'info', text: `Your plan starts on ${plan.startDate}.` }] : [],
    });
    return { plan, head, days: [], trend, blocks: [], credits: [], assimilation: null, drift: null, checkInDue: false, lastCheckIn, today: view };
  }

  // ---- every plan day up to today (today "so far")
  const versions = docs.versions.filter((v) => v.planId === plan.id);
  const compiled = new Map<number, CompiledSchedule>();
  const compiledOf = (v: PlanVersionDoc): CompiledSchedule => {
    let c = compiled.get(v.version);
    if (!c) {
      c = compileVersion(plan.baselineProfile, v.schedule);
      compiled.set(v.version, c);
    }
    return c;
  };
  const lastDay = minDate(today, addDays(plan.plannedEndDate, -1));
  const paused = pausedDaySet(plan, addDays(today, 1));
  const days: ProjectedDay[] = [];
  const credits: CreditObservation[] = [];
  for (let date = plan.startDate; compareDates(date, lastDay) <= 0; date = addDays(date, 1)) {
    const d = planDay(plan, date);
    const status = statusByDate.get(date) ?? null;
    const v = versionInForce(versions, d) ?? head;
    const frozen = status?.prescribed !== undefined && status.prescribed.planId === plan.id;
    const prescription = frozen ? status!.prescribed! : freezePrescription({ plan, version: v, date, tz, compiled: compiledOf(v), ...(paused.has(d) ? { paused: true } : {}) });
    const blocks = revealedAdherence(credits, addDays(date, -1));
    const result = toLoggedDay({
      date, planStart: plan.startDate, tz, prescription, entries: entries.filter((e) => e.date === date), status, observations: obsByDate.get(date) ?? null,
      expected: (t, wd) => expectedCreditFor(blocks, t, wd), equivalence: eq, intentByItem: v.sensitivities.intentByItem,
      ...(i.sessionCompiler ? { sessionCompiler: i.sessionCompiler } : {}),
      final: compareDates(date, today) < 0 || status?.confirmedAt !== undefined,
    });
    days.push({ date, planDay: d, prescription, frozen, result });
    if (result.score.final && !result.assumedDay) for (const o of result.loggedDay.items) if (o.credit !== null) credits.push({ date, type: o.type, credit: o.credit });
  }
  const todayDay = days.find((x) => x.date === today) ?? null;
  const past = days.filter((x) => compareDates(x.date, today) < 0);
  const logged = loggedDays(entries, measurements, docs.dayStatus.filter((s) => s.marks !== undefined && !s.assumed).map((s) => s.date));
  const trend = adherenceTrend(past.map((x) => ({ date: x.date, score: x.result.score.score, final: x.result.score.final, logged: logged.has(x.date) })), addDays(today, -1));
  const blocks = revealedAdherence(credits, today);

  // ---- assimilation (replay + filter, no anchor move)
  const todayIdx = planDay(plan, today);
  let assimilation: DailyAssimilationOutput | null = null;
  const weighIns = weighInsFor(plan, measurements, docs.observations ?? [], entries, blockStartsOf(head.schedule));
  if (!i.skipAssimilation && weighIns.length > 0) {
    const schedule = realisedSchedule(plan, head, past.map((x) => x.result), today);
    assimilation = dailyAssimilation({ plan, schedule, records, weighIns, today, ...(i.cached ? { cached: i.cached } : {}) });
  }

  // ---- drift of the weight goal(s) against the in-force version's band
  let drift: DriftReport | null = null;
  const inForceToday = versionInForce(versions, todayIdx) ?? head;
  const bandToday = forecastBandOn(inForceToday, todayIdx);
  if (assimilation?.trendToday && bandToday) {
    const goals = plan.request.goals.map((g, k) => ({ g, k })).filter(({ g }) => g.metric === 'scaleWeight');
    const previousFor = (better: 'down' | 'up'): DriftState[] => {
      const out: DriftState[] = [];
      for (const r of records) {
        const b = forecastBandOn(versionInForce(versions, r.anchorDay) ?? head, r.anchorDay);
        if (b && r.anchorDay < todayIdx) out.push(rawDriftState(r.trendWeight.kg, b, better));
      }
      return out;
    };
    const intakeDays = past.filter((x) => x.result.intakeLogged && (records.length === 0 || x.planDay >= records[records.length - 1]!.anchorDay));
    const excess = intakeDays.length > 0
      ? intakeDays.reduce((s, x) => {
          const e = x.result.loggedDay.inputs.energy;
          return s + (e.kind === 'kcal' ? e.kcal - x.prescription.energyKcal : 0);
        }, 0) / intakeDays.length
      : 0;
    const delta = records.length > 0 ? records[records.length - 1]!.energyBiasKcal.mean : 0;
    const since = Math.max(1, todayIdx - Math.max(0, inForceToday.forecast.fromDay));
    drift = {
      asOf: today,
      goals: goals.map(({ g, k }) => {
        const better = goalDirection(plan, g.metric, g.target);
        return driftGoal({
          goal: k, metric: g.metric, target: g.target ?? null, better,
          trend: { value: assimilation!.trendToday!.kg, sd: assimilation!.trendToday!.sd }, band: bandToday,
          previous: previousFor(better),
          causes: { days: since, intakeExcessKcal: excess, deltaKcal: delta, rhoKcalPerKg: DRIFT_RHO_KCAL_PER_KG },
        });
      }),
    };
  }

  // ---- Today
  const proposals = openProposals(versions);
  for (const v of proposals) notices.push({ id: `proposal:${v.version}`, kind: 'proposal', level: 'info', text: v.explanation[0] ?? 'A change to your plan is ready to review.', command: { id: 'plan.adoptVersion', input: { planId: plan.id, version: v.version } } });
  const lastLogged = [...logged].filter((d) => compareDates(d, today) < 0).sort().pop() ?? null;
  const checkInDue = isCheckInDue(plan, today, lastCheckIn);
  const view = buildTodayView({
    date: today, tz, rolloverH: settings.dayRolloverH ?? 4, quietMode: settings.quietMode ?? false,
    minimalMode: burdenMonitor(entries, measurements, today, plan.startDate).minimalMode, now, plan, version: inForceToday,
    prescription: todayDay?.prescription ?? null, entries: entries.filter((e) => e.date === today), measurements: measurements.filter((m) => m.date === today),
    status: statusByDate.get(today) ?? null, logged: todayDay?.result ?? null, trend, drift,
    trendWeight: assimilation?.trendToday ? { kg: assimilation.trendToday.kg, sd: assimilation.trendToday.sd } : null, forecastToday: bandToday,
    checkIn: { due: checkInDue, lastAt: lastCheckIn }, observations: obsByDate.get(today) ?? null, lapse: lapseState(lastLogged, today, plan.startDate), notices,
  });
  return { plan, head, days, trend, blocks, credits, assimilation, drift, checkInDue, lastCheckIn, today: view };
}
