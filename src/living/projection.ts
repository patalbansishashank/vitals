/**
 * The living-plan projection: everything Today, Progress and the Coach read, computed from the plan's documents in one
 * pure call — prescriptions (frozen ones from `dayStatus`, else frozen now), LoggedDays and scores for every plan day up
 * to today, the adherence trend and revealed adherence, the daily assimilation (replay + trend filter), drift and the
 * `TodayView`. E4's read commands (`today.get`, `day.get`, `plan.adherence`, `plan.drift`, `plan.get`) are thin wrappers
 * around it; the weekly check-in uses its realised schedule and weigh-ins. Deterministic for identical documents.
 */
import type { CompiledSchedule, FastEvent, MetricId, PersonProfile } from '@/engine';
import { ketoneSamples } from '@/engine/assimilation/realised';
import { leanTissue0Kg, resolveProfile } from '@/engine/core/resolveProfile';
import { statusValue, type RealisedHistory, type StatusValue } from '@/lib/bodyContracts';
import { adherenceTrend, behaviorForecastMeta, completionEvidence, revealedAdherence, type CompletionEvidence, type CreditObservation } from './adherence';
import { outcomesOfDays } from './behaviorPaths';
import { blockStartsOf, compositionReadingsFor, dailyAssimilation, forecastBandOn, isCheckInDue, realisedSchedule, weighInsFor, type DailyAssimilationOutput } from './assimilate';
import { headAdopted, openProposals, planDay, versionInForce } from './calendar';
import { addDays, compareDates } from './dates';
import { bandIsReadable, classifyDrift, driftGoal, type DriftDecision } from './drift';
import type { EquivalenceFn } from './equivalence';
import { burdenMonitor, lapseState, loggedDays, projectEntries } from './logs';
import type { SessionCompiler } from './loggedDay';
import type { BlockAdherence } from './plannerContract';
import { compileVersion } from './prescription';
import { currentProfileSafety } from './lifecycleSafety';
import { realiseLivingHistory, type ProjectedDay } from './realisedHistory';
import { todayActual, type TodayActual } from './todayReplay';
import { dayClose, dayCloseNotice, type DayClose } from './dayClose';
import { buildTodayView, currentExerciseEligibility, eligibilityNotices } from './today';
import { checkInDueAt, lastConfirmedCheckIn, prescriptionEligibility, type CheckInDue, type PrescriptionEligibility } from './checkInLoop';
import { calendarEnergyAvailability, eatingDayEa, repeatedCalendarEaReview, EA_POLICY_REFERENCE, type CalendarEa, type EaLedgerDay } from './energyAvailability';
import { monitorGoals, type MonitoredGoal } from './monitoring';
import { calibrateHunger, rawEnergyAvailability, wellbeingSummary, type EnergyAvailabilityRead, type HungerCalibration, type WellbeingSummary } from './wellbeing';
import type {
  AdherenceTrend,
  BehaviorForecastMeta,
  CheckInDecisionRecord,
  CurrentExerciseEligibility,
  ConfirmedStateRecord,
  DayStatusDoc,
  DerivedAnchorRecord,
  DriftReport,
  Instant,
  LocalDate,
  LogEntry,
  MeasurementEntry,
  Notice,
  PlanDoc,
  PlanVersionDoc,
  TodayView,
} from './types';

/**
 * Legacy energy density (kcal/kg) of the removed drift cause split (D5-02 removed causal shares). Kept only so existing
 * imports resolve; no drift statement uses it.
 */
export const DRIFT_RHO_KCAL_PER_KG = 7000;

export interface LivingDocs {
  plan: (PlanDoc & { id: string }) | null;
  versions: readonly PlanVersionDoc[];
  dayStatus: readonly DayStatusDoc[];
  entries: readonly LogEntry[];
  measurements: readonly MeasurementEntry[];
  records: readonly ConfirmedStateRecord[];
  settings?: { quietMode?: boolean; dayRolloverH?: number };
  /**
   * (D5-06) Stored check-in decisions (confirmed once each; previews are derived and never stored here). Absent = none
   * known (legacy readers): the last check-in then comes from the records alone.
   */
  decisions?: readonly CheckInDecisionRecord[];
  /** (C5/D5-06) The person's CURRENT profile safety (the screening now); absent = not known here (the plan's stands). */
  currentSafety?: PersonProfile['safety'];
  /**
   * (D5-07/A1-017) Recomputed CURRENT-state anchors kept beside the original confirmed records (derived, never a decision):
   * reused while their own derivation lineage still matches the current observation graph. Absent = none kept.
   */
  derivedAnchors?: readonly DerivedAnchorRecord[];
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
  /** (C2) The realised history of the elapsed days (null without a running plan); every replay reads it. */
  history: RealisedHistory | null;
  /** (C2) Engine fast events of the elapsed history (resolved in absolute time). */
  fastEvents: readonly FastEvent[];
  /** (D8-04/D8-09) The person's entered ratings and concern flags over the last two weeks (never a model tier). */
  wellbeing: WellbeingSummary;
  /** (D2-06) Personal calibration of the hunger index against entered ratings (null without a replay or ratings). */
  hunger: HungerCalibration | null;
  /** (D8-04) Raw energy availability of the latest elapsed day, with the status its inputs allow (null without a replay). */
  energyAvailability: { date: LocalDate; read: EnergyAvailabilityRead; exerciseScope?: 'coveredSessions'; assumptions?: string[] } | null;
  /**
   * (D2-08) Logged ketone readings on the plan's time axis with their observation semantics: blood D-BHB with a time
   * compares with the model's endpoint at that instant, an untimed one only with its day; urine/breath are never blood BHB.
   */
  ketones: ReturnType<typeof ketoneSamples>;
  /** (D5-06) The check-in due state: scheduled date, late-open catch-up, decision point (always today). */
  checkInSchedule: CheckInDue;
  /**
   * (C5/D5-06) Eligibility of the current prescription from today, re-checked on every new event with the lifecycle gate
   * (null without a running plan).
   */
  eligibility: PrescriptionEligibility | null;
  /** (D4-05) Observation summaries of the non-weight goals (observed-only; works without a weight goal or weigh-ins). */
  monitoring: MonitoredGoal[];
  /**
   * (D4-04) Energy-availability exposure: the calendar 7/28-day values over every elapsed day (fast days included), the
   * legacy eating-day statistic under its own name, the per-day ledger and the precautionary policy reference.
   */
  energyExposure: { calendar7: CalendarEa; calendar28: CalendarEa; eatingDay7: StatusValue; ledger: EaLedgerDay[]; reference: typeof EA_POLICY_REFERENCE; review: ReturnType<typeof repeatedCalendarEaReview> } | null;
  /**
   * (D5-08) Observed completion outcomes per item type (day clusters; unknown items excluded) and the semantics of any
   * behavioural forecast made from them: heuristic until prospectively calibrated. Utility credit stays in `blocks`.
   */
  behavior: { evidence: CompletionEvidence[]; meta: BehaviorForecastMeta };
  /**
   * (energy SPEC §V3.4) Today's actual so far plus the plan's remainder: the template today's replay uses (linked approved
   * actuals, unplanned actuals, fused steps so far + the plan-share prior for the rest of the awake day), with its named
   * assumptions. Null without a plan day today; its `template` is used only when today has an actual (a session or steps).
   */
  todayActual: TodayActual | null;
  /**
   * (r063 A34, energy SPEC §V3.7) Yesterday's close through the re-plan triggers (`pickReplan`): its decision, with
   * `forecastOnly` when only the training went beyond the plan (the forecast carries it; food stays as planned). Null
   * without a closed plan day. Never applies a change: a departure is offered as a re-plan the person approves.
   */
  dayClose: DayClose | null;
}

const CONCERN_WORD: Record<string, string> = {
  persistentFatigue: 'fatigue',
  performanceDecline: 'performance drop',
  injury: 'injury',
  menstrualChange: 'cycle change',
  poorRecovery: 'poor recovery',
  dizziness: 'dizziness',
  other: 'a concern',
};

function goalDirection(plan: PlanDoc, metric: MetricId, target: number | undefined): 'down' | 'up' {
  const start = plan.baselineProfile.body.weightKg;
  if (metric === 'scaleWeight' && target !== undefined) return target <= start ? 'down' : 'up';
  return metric === 'fatMass' || metric === 'bodyFatPct' || metric === 'waist' ? 'down' : 'up';
}

/**
 * The realised schedule every replay of a projection uses: the logged past of the shared history (with its fasts and hash)
 * and the head version's future. `plan.checkIn`, re-planning and the daily assimilation call this one function.
 */
export function projectionSchedule(p: Pick<LivingProjection, 'plan' | 'head' | 'days' | 'history' | 'fastEvents'> & Partial<Pick<LivingProjection, 'todayActual'>>, today: LocalDate, horizonDays?: number): ReturnType<typeof realisedSchedule> | null {
  if (!p.plan || !p.head) return null;
  const past = p.days.filter((d) => compareDates(d.date, today) < 0).map((d) => d.result);
  // (D8-06) today's observed night (wake date today) initialises today; (§V3.4) today's approved actuals and fused steps
  // so far replace the plan's day with actual-through-now plus the plan remainder (named priors)
  const current = p.days.find((d) => d.date === today)?.result ?? null;
  const todayTemplate = p.todayActual && p.todayActual.date === today && hasActual(p.todayActual) ? p.todayActual.template : null;
  return realisedSchedule(p.plan, p.head, past, today, horizonDays, { ...(p.fastEvents ? { fastEvents: p.fastEvents } : {}), ...(p.history ? { history: { contentHash: p.history.contentHash, asOf: p.history.asOf } } : {}), current, ...(todayTemplate ? { todayTemplate } : {}) });
}

/** Today has something actual (a logged or approved session, a skip, or a step count): only then does it leave the plan. */
function hasActual(t: TodayActual): boolean {
  return t.sessions.linked.length > 0 || t.sessions.unplanned.length > 0 || t.sessions.skipped.length > 0 || t.steps.fusedSoFar !== null;
}

export function projectLiving(i: ProjectionInput): LivingProjection {
  const { docs, today, tz, now } = i;
  const plan = docs.plan;
  const statusByDate = new Map(docs.dayStatus.map((s) => [s.date, s] as const));
  const entries = projectEntries(docs.entries);
  const measurements = projectEntries(docs.measurements);
  const records = [...docs.records].filter((r) => !plan || r.planId === plan.id).sort((a, b) => a.anchorDay - b.anchorDay);
  // (D5-06) the last confirmed check-in: a record's anchor or a confirmed decision that anchored nothing
  const lastCheckIn = lastConfirmedCheckIn(records, (docs.decisions ?? []).filter((d) => !plan || d.planId === plan.id));
  const settings = docs.settings ?? {};
  const rolloverH = settings.dayRolloverH ?? 4;
  const head = plan ? headAdopted(docs.versions.filter((v) => v.planId === plan.id)) : null;
  const notices: Notice[] = [];

  if (!plan || !head || plan.status === 'ended' || compareDates(today, plan.startDate) < 0) {
    const trend = adherenceTrend([], today);
    const view = buildTodayView({
      date: today, tz, rolloverH, quietMode: settings.quietMode ?? false, minimalMode: false, now,
      plan: plan && plan.status !== 'ended' ? plan : null, version: plan && plan.status !== 'ended' ? head : null, prescription: null, entries: entries.filter((e) => e.date === today),
      measurements: measurements.filter((m) => m.date === today), status: statusByDate.get(today) ?? null, logged: null, trend, drift: null, trendWeight: null,
      forecastToday: null, checkIn: { due: false, lastAt: lastCheckIn }, lapse: { welcomeBack: false, gap: [] },
      notices: plan && plan.status === 'scheduled' ? [{ id: 'scheduled', kind: 'info', level: 'info', text: `Your plan starts on ${plan.startDate}.` }] : [],
    });
    return { plan, head, days: [], trend, blocks: [], credits: [], assimilation: null, drift: null, checkInDue: false, lastCheckIn, today: view, history: null, fastEvents: [], wellbeing: wellbeingSummary([], today), hunger: null, energyAvailability: null, ketones: [], checkInSchedule: { due: false, scheduled: null, late: false, decisionPoint: today }, eligibility: null, monitoring: [], energyExposure: null, behavior: { evidence: [], meta: behaviorForecastMeta('asPrescribed') }, todayActual: null, dayClose: null };
  }

  // ---- every plan day up to today (today "so far") and the elapsed realised history (C2)
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
  const lived = realiseLivingHistory({
    plan, versions, dayStatus: docs.dayStatus, entries, rawEntries: docs.entries, measurements, today, tz, now, rolloverH, compiledOf,
    ...(i.equivalence ? { equivalence: i.equivalence } : {}),
    ...(i.sessionCompiler ? { sessionCompiler: i.sessionCompiler } : {}),
  });
  const { days, credits, history, fastEvents } = lived;
  const todayDay = days.find((x) => x.date === today) ?? null;
  const nowMs = Date.parse(now);
  const actualToday = todayDay && Number.isFinite(nowMs)
    ? todayActual({ date: today, prescription: todayDay.prescription, headTemplate: todayDay.prescription.template, entries: entries.filter((e) => e.date === today), nowMs, tz, rolloverH })
    : null;
  const past = days.filter((x) => compareDates(x.date, today) < 0);
  const logged = loggedDays(entries, measurements, docs.dayStatus.filter((s) => (s.marks !== undefined || s.intake !== undefined) && !s.assumed).map((s) => s.date));
  const trend = adherenceTrend(past.map((x) => ({ date: x.date, score: x.result.score.score, final: x.result.score.final, logged: logged.has(x.date) })), addDays(today, -1));
  const blocks = revealedAdherence(credits, today);

  // ---- assimilation (replay + filter, no anchor move) on the shared realised schedule
  const todayIdx = planDay(plan, today);
  let assimilation: DailyAssimilationOutput | null = null;
  const weighIns = weighInsFor(plan, measurements, entries, blockStartsOf(head.schedule));
  if (!i.skipAssimilation && weighIns.length > 0) {
    const schedule = projectionSchedule({ plan, head, days, history, fastEvents, todayActual: actualToday }, today)!;
    // (A1-017) the stored anchors are checked against the CURRENT effective composition graph: an anchor whose reading was
    // retracted or corrected, or that was derived under another estimator, is refit (kept recomputations reused)
    assimilation = dailyAssimilation({
      plan, schedule, records, weighIns, today, composition: compositionReadingsFor(plan, measurements) ?? null,
      ...(docs.derivedAnchors?.length ? { derived: docs.derivedAnchors } : {}), ...(i.cached ? { cached: i.cached } : {}),
    });
  }

  // ---- drift (D5-02): the scale trend against the scale forecast band, decided only at confirmed check-ins
  let drift: DriftReport | null = null;
  const inForceToday = versionInForce(versions, todayIdx) ?? head;
  const bandToday = forecastBandOn(inForceToday, todayIdx);
  const bandMetaToday = inForceToday.forecast.bandMeta;
  const scaleToday = assimilation?.scaleToday ?? null;
  if (scaleToday && bandToday) {
    const goals = plan.request.goals.map((g, k) => ({ g, k })).filter(({ g }) => g.metric === 'scaleWeight');
    const decisionsFor = (better: 'down' | 'up'): DriftDecision[] => {
      const out: DriftDecision[] = [];
      for (const r of records) {
        // a legacy record's trendWeight is water-adjusted: never compared with the scale band (no rawScale, no decision)
        if (!r.rawScale || r.anchorDay > todayIdx) continue;
        const v = versionInForce(versions, r.anchorDay) ?? head;
        const b = forecastBandOn(v, r.anchorDay);
        if (!b) continue;
        // (D8-02) a decision read against a nominal-only forecast (no range) is unclear, never ahead/behind
        const read = bandIsReadable(b, v.forecast.bandMeta) ? classifyDrift({ value: r.rawScale.kg, sd: r.rawScale.sd ?? Number.NaN }, b, better).read : 'unclear';
        out.push({ id: r.decisionId ?? `${r.planId}:${r.anchorDate}`, read });
      }
      return out;
    };
    // observed logged intake vs prescription on quantitative days since the last anchor (an observation, not a cause)
    const since = records.length > 0 ? records[records.length - 1]!.anchorDay : 0;
    const window = past.filter((x) => x.planDay >= since);
    const quant = window.filter((x) => x.result.calibrationEligible && x.result.observed.energyKcal !== null);
    const loggedIntakeDiff = quant.length > 0 ? { kcalPerDay: quant.reduce((s, x) => s + (x.result.observed.energyKcal! - x.prescription.energyKcal), 0) / quant.length, quantDays: quant.length, daysInWindow: window.length } : null;
    const last = records[records.length - 1];
    // (D5-03) the applied forecast correction (an inferred ledger value, not measured expenditure); a controller bound that
    // held it says so ("Correction at limit"), and its range is a conditional residual of unvalidated coverage
    const corr = last?.correction;
    const residual = last
      ? statusValue({
          status: 'estimated',
          value: last.energyBiasKcal.mean,
          range: [last.energyBiasKcal.mean - 1.2816 * last.energyBiasKcal.sd, last.energyBiasKcal.mean + 1.2816 * last.energyBiasKcal.sd],
          unit: 'kcal/day',
          uncertaintyKind: 'conditionalResidual',
          reasonCode: corr?.saturated ? 'correctionAtLimit' : corr?.stepLimited ? 'correctionStepLimited' : 'balanceModelResidual',
          detailsRef: '24-energy-balance-bias',
        })
      : statusValue({ status: 'unknown', unit: 'kcal/day', reasonCode: 'noConfirmedCheckIn', detailsRef: '24-energy-balance-bias' });
    drift = {
      asOf: today,
      goals: goals.map(({ g, k }) => {
        const better = goalDirection(plan, g.metric, g.target);
        return driftGoal({
          goal: k, metric: g.metric, target: g.target ?? null, better,
          trend: { value: scaleToday.kg, sd: scaleToday.sd }, band: bandToday,
          decisions: decisionsFor(better),
          operator: 'scaleWake',
          loggedIntakeDiff,
          residual,
          ...(bandMetaToday ? { bandMeta: bandMetaToday } : {}),
        });
      }),
    };
  }

  // ---- Today
  // (D4-02/A1-005) the CURRENT exercise eligibility overlays today's unperformed recommendations at once (a logged symptom,
  // a resolution, a changed screening or envelope, a new day): held sessions and a capped or withheld step target read as
  // Review, on steps-only days too; the adopted snapshot stays as provenance and logged activity is untouched
  const exerciseEligibility = todayDay ? currentExerciseEligibilityOf(plan, entries, docs.currentSafety, today, todayDay.prescription.steps ?? null) : null;
  notices.push(...eligibilityNotices(todayDay?.prescription ?? null, exerciseEligibility));
  // (C5/D5-06) a new safety event re-checks today's prescription at once (no weigh-in, no lock window needed): a block the
  // eligibility notices do not already say reads Review, with the details in the safety sheet
  const eligibility = prescriptionEligibility({ plan, head: inForceToday, today, entries, ...(docs.currentSafety ? { currentSafety: docs.currentSafety } : {}) });
  // a read cannot run the planner's revalidation, so "not startable without it" is not a safety event: only a changed
  // screening or a gate reason (symptom, open screen) reads as Review here
  const safetyEvent = eligibility.safetyChanged || eligibility.reasons.some((r) => r.code === 'symptomExercise' || r.code === 'exerciseScreenReview');
  if (eligibility.blocked && safetyEvent && !notices.some((n) => n.id === 'symptomHold' || n.id === 'stepsHold')) {
    notices.push({ id: 'safetyReview', kind: 'safety', level: 'caution', text: 'Review: safety check needed.', command: { id: 'plan.replan', input: { reason: 'safety' } } });
  }
  // (D8-04/D8-09) a concern the person flagged stays visible whatever a model tier says: one short line, no diagnosis
  const wellbeing = wellbeingSummary(days.map((d) => ({ date: d.date, observed: d.result.observedWellbeing })), today);
  const topConcern = [...wellbeing.concerns].sort((a, b) => b.days - a.days || (a.concern < b.concern ? -1 : 1))[0];
  if (topConcern) notices.push({ id: 'wellbeingReview', kind: 'info', level: 'caution', text: `Review: ${CONCERN_WORD[topConcern.concern] ?? 'a concern'} noted on ${topConcern.days} ${topConcern.days === 1 ? 'day' : 'days'}` });
  // (r063 A34) yesterday closed: the re-plan triggers read it (the exercise departure is forecast-only, D10)
  const closed = past.find((x) => x.date === addDays(today, -1)) ?? null;
  const closedDay = closed && !closed.result.assumedDay ? dayClose({ date: closed.date, today, prescription: closed.prescription, result: closed.result, entries, massKg: plan.baselineProfile.body.weightKg ?? 0, vo2max: plan.baselineProfile.labs?.vo2maxMlKgMin ?? null }) : null;
  const closeNotice = closedDay ? dayCloseNotice(closedDay) : null;
  if (closeNotice) notices.push(closeNotice);
  const proposals = openProposals(versions);
  for (const v of proposals) notices.push({ id: `proposal:${v.version}`, kind: 'proposal', level: 'info', text: v.explanation[0] ?? 'A change to your plan is ready to review.', command: { id: 'plan.adoptVersion', input: { planId: plan.id, version: v.version } } });
  const lastLogged = [...logged].filter((d) => compareDates(d, today) < 0).sort().pop() ?? null;
  const checkInSchedule = checkInDueAt(plan, today, lastCheckIn);
  const checkInDue = isCheckInDue(plan, today, lastCheckIn);
  const ffmAct = ffmActOf(plan, assimilation);
  const energyExposure = energyExposureOf(past, ffmAct, addDays(today, -1));
  // Explicit experimental tracking keeps this policy statistic in the review data/Plan Details rather than a recurring
  // dashboard notice. Observed wellbeing concerns, symptoms and medical exercise holds remain independently visible.
  if (energyExposure?.review.needed && plan.request.constraints?.experimentalTracking !== true) notices.push({ id: 'repeatedCalendarEaBelowReference', kind: 'safety', level: 'caution', text: 'Review: repeated low energy availability.' });
  const view = buildTodayView({
    date: today, tz, rolloverH, quietMode: settings.quietMode ?? false,
    minimalMode: burdenMonitor(entries, measurements, today, plan.startDate).minimalMode, now, plan, version: inForceToday,
    prescription: todayDay?.prescription ?? null, entries: entries.filter((e) => e.date === today), measurements: measurements.filter((m) => m.date === today),
    status: statusByDate.get(today) ?? null, logged: todayDay?.result ?? null, trend, drift,
    // the scale trend against the scale band (C4: same operator); the water-adjusted estimate stays in `assimilation`
    trendWeight: scaleToday ? { kg: scaleToday.kg, sd: scaleToday.sd } : null, forecastToday: bandToday,
    checkIn: { due: checkInDue, lastAt: lastCheckIn }, lapse: lapseState(lastLogged, today, plan.startDate), notices,
    ...(exerciseEligibility ? { exerciseEligibility } : {}),
  });
  return {
    plan, head, days, trend, blocks, credits, assimilation, drift, checkInDue, lastCheckIn, today: view, history, fastEvents, wellbeing,
    hunger: hungerOf(days, assimilation),
    energyAvailability: energyAvailabilityOf(past, ffmAct),
    ketones: ketoneSamples(plan.startDate, measurements.filter((m) => m.metric === 'ketonesMmolL' && !m.assumed), tz),
    checkInSchedule,
    eligibility,
    monitoring: monitorGoals(plan, measurements, today),
    energyExposure,
    behavior: { evidence: completionEvidence(outcomesOfDays(past), today), meta: behaviorForecastMeta('plausibleExecution') },
    todayActual: actualToday,
    dayClose: closedDay,
  };
}

/**
 * (D4-02/A1-005) The current exercise eligibility of a plan day's unperformed recommendations: the plan's stored safety
 * with the CURRENT screening and logged symptoms (`currentProfileSafety`, the lifecycle rule) and the documented baseline.
 */
export function currentExerciseEligibilityOf(plan: PlanDoc, entries: readonly LogEntry[], currentSafety: PersonProfile['safety'] | undefined, asOf: LocalDate, prescribedSteps: number | null): CurrentExerciseEligibility {
  const safety = currentProfileSafety(plan.request.profile.safety ?? plan.baselineProfile.safety, currentSafety, entries);
  const profile: PersonProfile = { ...plan.baselineProfile, ...(safety ? { safety } : {}) };
  return currentExerciseEligibility({ profile, entries, asOf, prescribedSteps });
}

/** A replay daily series by id (empty when the run did not record it). */
function dailySeries(a: DailyAssimilationOutput | null, id: string): ArrayLike<number> | null {
  const d = a?.replay.result.daily as Readonly<Record<string, ArrayLike<number> | undefined>> | undefined;
  return d?.[id] ?? null;
}

/**
 * (D2-06) Every entered hunger rating as its own observation (value with the clock its own entry stated, on its occurrence
 * day) paired with the replay's hunger index of that plan day, through the shared provider. A later fullness or craving
 * entry never lends its clock to an earlier hunger rating; an untimed rating stays untimed.
 */
function hungerOf(days: readonly ProjectedDay[], a: DailyAssimilationOutput | null): HungerCalibration | null {
  const idx = dailySeries(a, 'hunger');
  if (!idx) return null;
  const pairs: Array<{ day: number; rating: number; index: number; ratedAtClockH?: number }> = [];
  for (const d of days) {
    const x = d.planDay >= 0 && d.planDay < idx.length ? idx[d.planDay]! : Number.NaN;
    if (!Number.isFinite(x)) continue;
    const w = d.result.observedWellbeing;
    // legacy reductions without per-scale observations: the latest hunger with its own (hunger-bound) clock
    const obs = w?.observations ?? (w?.hunger !== undefined ? [{ scale: 'hunger' as const, value: w.hunger, ...(w.ratedAtClockH !== undefined ? { clockH: w.ratedAtClockH } : {}), entryId: '' }] : []);
    for (const o of obs) if (o.scale === 'hunger') pairs.push({ day: d.planDay, rating: o.value, index: x, ...(o.clockH !== undefined ? { ratedAtClockH: o.clockH } : {}) });
  }
  return pairs.length > 0 ? calibrateHunger(pairs) : null;
}

/**
 * (D4-04/C7) The engine's metabolically active FFM at plan day d, kg: FFM0 + (LT_d − LT0) from the replay's end-of-day lean
 * tissue (FFM_act includes the reference glycogen and its water; lean tissue alone does not). Without a replay, the
 * baseline FFM0 (a model value). Null when not computable.
 */
function ffmActOf(plan: PlanDoc, a: DailyAssimilationOutput | null): (day: number) => number | null {
  let rp: ReturnType<typeof resolveProfile> | null;
  try {
    rp = resolveProfile({ ...plan.baselineProfile, startDate: plan.startDate });
  } catch {
    rp = null;
  }
  if (!rp || !(rp.ffm0Kg > 0)) return () => null;
  const ffm0 = rp.ffm0Kg;
  const lt0 = leanTissue0Kg(rp);
  return (day) => {
    if (!a) return ffm0;
    const lt = day >= 0 && day < a.replay.leanKg.length ? a.replay.leanKg[day]! : Number.NaN;
    const v = Number.isFinite(lt) ? ffm0 + (lt - lt0) : Number.NaN;
    return Number.isFinite(v) && v > 0 ? v : null;
  };
}

/**
 * (D8-04/A1-057) Exercise energy above rest of a day: the day's complete session expenditure (complete or confirmed-zero
 * exercise coverage with every logged cost stated), else null. Neither an absent prescription nor an empty log set proves
 * a zero-exercise day.
 */
function eeeNetOf(day: ProjectedDay): number | null {
  return day.result.exercise.netAboveRestKcal;
}

/**
 * (D8-04/D4-04) Raw EA of the latest elapsed day: its observed intake under its coverage, the logged sessions' net-above-rest
 * energy, and the engine's FFM_act as a model FFM (so the value is a scenario, never a measured exposure).
 */
function energyAvailabilityOf(past: readonly ProjectedDay[], ffmAct: (day: number) => number | null): LivingProjection['energyAvailability'] {
  const day = past[past.length - 1];
  if (!day) return null;
  const r = day.result;
  const ffm = ffmAct(day.planDay);
  const read = rawEnergyAvailability({
    intakeKcal: r.observed.energyKcal,
    intakeCoverage: r.coverage.energy ?? 'unknown',
    netSessionKcal: eeeNetOf(day),
    exerciseCoverage: r.exercise.coverage ?? r.coverage.exercise ?? 'unknown',
    knownSessionKcal: r.exercise.knownNetKcal ?? 0,
    ffmKg: ffm,
    ffmBasis: ffm !== null ? 'model' : 'unknown',
  });
  const conditionalRead = read.ea.value !== undefined ? { ...read, ea: { ...read.ea, status: 'scenario' as const, reasonCode: 'coveredExerciseScenario' } } : read;
  return { date: day.date, read: conditionalRead, exerciseScope: 'coveredSessions', assumptions: ['coveredSessions:noAdditionalExerciseAssumption'] };
}

/** (D4-04) The calendar exposure ledger of the elapsed days and its 7/28-day windows (every day counts, fasts included). */
function energyExposureOf(past: readonly ProjectedDay[], ffmAct: (day: number) => number | null, asOf: LocalDate): LivingProjection['energyExposure'] {
  if (past.length === 0) return null;
  const ledger: EaLedgerDay[] = past.map((d) => {
    const ffm = ffmAct(d.planDay);
    return {
      date: d.date,
      eiKcal: d.result.observed.energyKcal,
      eiCoverage: d.result.coverage.energy ?? 'unknown',
      eeeNetKcal: eeeNetOf(d),
      exerciseCoverage: d.result.exercise.coverage ?? d.result.coverage.exercise ?? 'unknown',
      exerciseScope: 'coveredSessions',
      exerciseProvenance: d.result.exercise.logged > 0 || d.result.exercise.coverage === 'complete' ? 'loggedSessions' : 'unknown',
      knownEeeNetKcal: d.result.exercise.knownNetKcal ?? 0,
      ffmKg: ffm,
      ffmBasis: ffm !== null ? 'model' : 'unknown',
      fastDay: d.prescription.fast !== undefined || d.result.fast !== null,
    };
  });
  return {
    calendar7: calendarEnergyAvailability(ledger, asOf, 7),
    calendar28: calendarEnergyAvailability(ledger, asOf, 28),
    eatingDay7: eatingDayEa(ledger, asOf, 7),
    ledger,
    reference: EA_POLICY_REFERENCE,
    review: repeatedCalendarEaReview(ledger, asOf),
  };
}
