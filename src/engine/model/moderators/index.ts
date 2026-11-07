/**
 * MODULE moderators — sleep, stress, menstrual cycle, menopause, age → modifier signals.
 * Spec: docs/MODEL_SPEC.md §1.1 · Dossiers: 16 §4.0-4.13 (owner), 15 §4.11 (caffeine dose/time), 02 §4.3 (luteal RMR).
 * Owned files: src/engine/model/moderators/** only.
 *
 * Daily module: everything is computed in `startDay` (multipliers, cycle, age) and `endOfDay` (sleep-quality index);
 * the only hourly work is capturing the caffeine load at the planned bed hour. No allocation after `prepare/init`.
 *
 * Decisions on points the spec leaves open (all documented in the WP report):
 *  - Sleep date contract (D8-06, `CONTRACT_VERSIONS.sleepDate`): a planned/template night keeps the STARTING-date
 *    convention — day D's `sleepHours` is the night that starts on D's evening and is "last night" for D + 1 (stored at
 *    `endOfDay`). An OBSERVED episode maps to its WAKE date: `day.sleepEndingToday` on day D is the episode that ended on
 *    D's morning and replaces the carried night at D's `startDay`; day 0 without one uses the schedule's
 *    `initialSleep` (the last observed episode before day 0). Observed hours are used exactly as logged: no caffeine or
 *    alcohol heuristic is ever subtracted from them. A1-053: the debt reads the waking day's known TOTAL asleep hours
 *    (naps and split segments counted once) while the main episode keeps the hourly timing; the poor flag is the entered
 *    quality only (an observed unrated night is unknown, never poor and never the planned flag), on day zero as later; a
 *    partial nap-only record keeps its known dose as a named scenario (`MODERATORS_SLEEP_ASSUMPTIONS`). The state starts
 *    at the habitual sleep (steady state), so a burn-in on the habitual day leaves it there.
 *  - dS is capped at 5 (testosterone cap); Si / MPS / partition use min(dS, 4) as written in §1.1 step 3. The per-hour
 *    slopes are proposed structural scenarios (registry distribution metadata), not measured personal laws; the
 *    `sleepDebtEffectStructure` switch (0) gives the zero-effect structural alternative.
 *  - Age and cycle day are functions of `clock.day` (0 = first simulated day, negative in burn-in), so day 0 is exactly the
 *    profile age / cycle day whatever the burn-in length.
 *  - Cycle phase (D8-07) is a calendar ESTIMATE from observed period starts (latest start on or before the day; the cycle
 *    length is the stated one, else the median of the observed history, else the default), with the luteal start anchored
 *    on a manually confirmed ovulation (LH test or clinician) inside an observed cycle. An irregular/unknown cycle, or a
 *    tracked cycle without a period date, asserts no phase: cycleDay −1 and the phase-average luteal weight (zero centred
 *    deviation for energy/appetite, zero cycle water). Hormonal contraception, post-menopause, a stated "not
 *    menstruating", tracking off, men and unspecified sex: no cycle effects (0).
 *  - Stress is informational (no stress-to-fat pathway); the menopause drift rates are inactive informational state.
 *  - Legacy sleep-quality index = 100 − caffeine TST loss / 3 − 100 · alcohol next-night penalty (MODEL_SPEC §1.1 step 6):
 *    a heuristic exposure index kept separately from the logged sleep (the caffeine and alcohol terms are stored apart).
 */
import { defineModule } from '../../core/moduleKit';
import { param } from '../../core/paramsRegistry';
import { relax2 } from '../../core/math';
import { DEFAULTS } from '../../core/defaults';
import { MI, type SeriesId } from '../../types/metrics';
import type { EngineModule, ModuleContext, SignalHookDecl } from '../../types/module';
import type { SeriesStatusMeta } from '../../types/result';
import type { UncertaintyKind } from '@/lib/bodyContracts';
import type { ResolvedProfile } from '../../types/profile';
import type { SignalBus } from '../../types/signals';
import { MODERATORS_PARAMS } from './params';
import {
  alcoholRecoveryPenalty,
  caffeineHalfLifeH,
  caffeineResidualMg,
  cycleDayOn,
  isoDayNumber,
  lutealMeanWeight,
  lutealStartDay,
  lutealWeightFrom,
  medianCycleLength,
  mpsSleepMult,
  nightlyDeficitH,
  partitionSleepShift,
  siSleepMult,
  sleepQualityIndex,
  testoSleepMult,
  tstLossMin,
} from './equations';

export interface ModeratorsState {
  /** Fast sleep-debt state dF, h (16 §4.1.1; τ 1 d rise / 2 d fall, cap 4). */
  sleepDebtFastH: number;
  /** Slow sleep-debt state dS, h (τ 3 d rise / 5 d fall; state cap 5 = testosterone cap, Si/MPS use min(dS, 4)). */
  sleepDebtSlowH: number;
  /** Sleep that ended this morning, h: the observed episode ending today, else the previous day's planned `sleepHours`. */
  lastNightSleepH: number;
  /** 1 when `lastNightSleepH` is an observed episode (wake-date mapping or day-0 initial sleep), 0 planned/habitual. */
  lastNightObserved: number;
  /** Caffeine body load at the planned bedtime, mg (15 §4.11 → 16 §4.2.1 TST loss); captured in stepHour. */
  caffeineAtBedMg: number;
  /** Menstrual cycle day, 1-based (−1 when not tracked or the phase is unknown). */
  cycleDay: number;
  /** Where the cycle phase came from (`CYCLE_PHASE`): none, calendar estimate, ovulation-anchored estimate, phase average. */
  cyclePhaseSource: number;
  /** Age in years, advanced daily (profile age + clock.day/365.25). */
  ageYears: number;
  /**
   * Legacy heuristic exposure index 0-100 for the night that starts tonight (16 §4.2, 19 §4.10): never a measured or
   * subjective sleep quality; NaN never (initialised from the habitual day).
   */
  sleepQualityIdx: number;
  /** Tonight's caffeine total-sleep-time loss HEURISTIC, min (a possible-risk scenario, never subtracted from logged sleep). */
  caffeineTstRiskMin: number;
  /** Tonight's alcohol next-night recovery penalty, fraction (an HRV-recovery association, not subjective quality). */
  alcoholRecoveryPen: number;

  /** 1 when last night was flagged poor quality (a poor night entered or planned), else 0; an unknown quality is not poor. */
  lastNightPoor: number;
  /** 1 when last night belonged to a shift-work day, else 0. */
  lastNightShift: number;
  /** Hour of day (0-23) at which caffeineLoadMg is sampled: the planned bed hour of today's night. */
  bedHourToday: number;
  /** exp(−ln2·frac/t½): decay from the start of the bed hour to the fractional bedtime. */
  bedFracFactor: number;
  /** Ethanol dose of today (g/kg) driving tonight's next-night recovery penalty. */
  alcoholGKgToday: number;
  /** Luteal weight s(d) written to the bus today. */
  lutealWeight: number;
  /**
   * Menopause-transition drift rates, kg/yr (peri women only). INACTIVE informational state (D8-07): no bus signal carries
   * them and no module adds mass from them.
   */
  menopauseFatDriftKgYr: number;
  menopauseLeanDriftKgYr: number;
  /**
   * First plan day whose last-night sleep was a PARTIAL observation (nap-only record, `coverage: 'partial'`), −1 = none
   * (A1-053): its known dose is used as a named scenario (`MODERATORS_SLEEP_ASSUMPTIONS`), never padded to a full night.
   */
  partialSleepFromDay: number;
}

/**
 * Named sleep-observation assumptions (A1-053, C6): a partial (nap-only) record's known asleep hours are the dose of a
 * named scenario, so the outputs that read the sleep debt carry a scenario status from that day (`moderatorsOutputStatuses`;
 * dependants close over the shared graph). Daily whole-day recovery stays a daily/scenario prior; no per-hour endocrine
 * coefficient is added.
 */
export const MODERATORS_SLEEP_ASSUMPTIONS = {
  partialSleepKnownDose: {
    reasonCode: 'partialSleepKnownDoseOnly',
    uncertaintyKind: 'scenario',
    series: ['hunger', 'cortisol', 'testosterone', 'moodTier', 'insulinSensitivity', 'mps', 'leanTissue', 'fatMass'],
  },
} as const satisfies Record<string, { reasonCode: string; uncertaintyKind: UncertaintyKind; series: readonly SeriesId[] }>;

/** One series-status record for the recorder (same shape as composition's). */
export interface ModeratorsStatusRecord extends SeriesStatusMeta {
  series: readonly SeriesId[];
}

/** C6 statuses implied by the moderators state after a run (A1-053 partial sleep observations). Allocation allowed. */
export function moderatorsOutputStatuses(s: Pick<ModeratorsState, 'partialSleepFromDay'>): ModeratorsStatusRecord[] {
  if (!(s.partialSleepFromDay >= 0)) return [];
  const a = MODERATORS_SLEEP_ASSUMPTIONS.partialSleepKnownDose;
  return [{ series: a.series, status: 'scenario', reasonCode: a.reasonCode, uncertaintyKind: a.uncertaintyKind, fromDay: s.partialSleepFromDay }];
}

/**
 * Poor-quality flag of an OBSERVED night (A1-053): 1 only for an entered poor rating (code 0 of 0 poor / 1 fair / 2 good);
 * an observed fair/good rating and an observed UNRATED night are 0 — an absent rating is unknown, never read as poor, and
 * an observed night never inherits the planned night's quality.
 */
export function observedPoorFlag(quality: number | undefined): number {
  return quality === 0 ? 1 : 0;
}

/** Known asleep hours of an observed waking day: the explicit total (naps/segments counted once), else the main episode. */
export function observedAsleepHours(main: number, total: number | undefined): number {
  return total !== undefined && total >= 0 && total < Infinity ? total : main;
}

/** Cycle-phase provenance codes (state `cyclePhaseSource`, D8-07). */
export const CYCLE_PHASE = { none: 0, calendarEstimate: 1, ovulationAnchored: 2, phaseAverage: 3 } as const;

/** Constants copied from the registry in `prepare` (never read in the step loop). */
export interface ModeratorsK {
  hRef: number;
  poorH: number;
  shiftH: number;
  fDfUp: number;
  fDfDown: number;
  fDsUp: number;
  fDsDown: number;
  debtCap: number;
  debtCapT: number;
  siPerH: number;
  mpsPerH: number;
  testoPerH: number;
  partPerH: number;
  partCap: number;
  partDefRef: number;
  tHalf: number;
  rStar: number;
  tstPerMg: number;
  tstCap: number;
  tstPts: number;
  alcLo: number;
  alcHi: number;
  penLo: number;
  penMid: number;
  penHi: number;
  sleepBase: number;
  rampDays: number;
  fatDrift: number;
  leanDrift: number;
  /** Profile-derived (static). */
  isMale: boolean;
  weightKg: number;
  age0: number;
  menoPeri: boolean;
  /** 0 no cycle effects, 1 calendar estimate from observed period starts, 2 phase average (tracked, phase unknown/irregular). */
  cycleMode: number;
  /** Typical cycle length, d (stated, else the median of the observed history, else the default). */
  cycleLen: number;
  /** Observed period starts, sorted day numbers (finite), and manually confirmed ovulation days (sorted). */
  periodStarts: Float64Array;
  ovulationDays: Float64Array;
  /** Phase-average luteal weight s̄ = mean of s(d) over one typical cycle. */
  phaseMean: number;
  startDay: number;
  /** 1 when the schedule supplies the last observed sleep before day 0 (`initialSleep`), and its hours. */
  hasInitSleep: number;
  initSleepH: number;
  /** Day-0 observed night (A1-053): poor flag of its entered quality (unrated = 0) and 1 when only partly known. */
  initSleepPoor: number;
  initSleepPartial: number;
  habSleepH: number;
  habPoor: number;
  habCaffeineMg: number;
  habBedH: number;
  habAlcoholGKg: number;
  habStress: number;
}

const LN2 = Math.LN2;

function habitualSleepHours(bedH: number, wakeH: number): number {
  const h = (((wakeH - bedH) % 24) + 24) % 24;
  return h === 0 ? 24 : h;
}

const isHormonalContraception = (c: string | undefined): boolean => c !== undefined && c !== 'none';

/** Sorted unique finite day numbers of ISO dates. */
function sortedDayNumbers(dates: ReadonlyArray<string | undefined>): Float64Array {
  const set = new Set<number>();
  for (const d of dates) {
    const n = isoDayNumber(d);
    if (Number.isFinite(n)) set.add(n);
  }
  return Float64Array.from([...set].sort((a, b) => a - b));
}

/** Keep the first of starts closer than `minGap` days (duplicate or spotting entries of the same period). */
function distinctStarts(sorted: Float64Array, minGap: number): Float64Array {
  const out: number[] = [];
  for (const d of sorted) if (out.length === 0 || d - out[out.length - 1]! >= minGap) out.push(d);
  return Float64Array.from(out);
}

/** Minimum gap between two distinct observed period starts, d (closer entries are duplicates/spotting of one period). */
const MIN_CYCLE_GAP_D = 15;

/** The resolved cycle timing of a profile (D8-07): what moderators emits, and what every centring consumer must match. */
export interface CycleTiming {
  /** 0 no cycle effects, 1 calendar estimate from observed period starts, 2 phase average (tracked, phase unknown/irregular). */
  mode: 0 | 1 | 2;
  /** Typical cycle length, d (stated, else the median of the observed history, else the default), ≥ 15. */
  cycleLen: number;
  /** Observed period starts (sorted distinct day numbers) and manually confirmed ovulation days (sorted). */
  periodStarts: Float64Array;
  ovulationDays: Float64Array;
}

/**
 * Resolve the cycle timing of a profile (D8-07), pure. Exported so modules that centre a luteal term on its cycle mean
 * (energy RMR, appetite drive) use the same mode and cycle length as the `lutealWeight` moderators writes: a running mean
 * over a different window would leave a residual phase offset. Hormonal contraception, post-menopause, a stated "not
 * menstruating", tracking off, men and unspecified sex give mode 0; a tracked cycle without an observed start or with an
 * irregular/unknown regularity gives the phase average (mode 2).
 */
export function resolveCycleTiming(pr: ResolvedProfile, startDate: string, defaultLenD: number): CycleTiming {
  const cyc = pr.cycle;
  const female = pr.sex === 'female' && !pr.input.sexUnspecified;
  // observed period starts (the legacy last start included); ovulation only when manually confirmed
  const periodStarts = distinctStarts(sortedDayNumbers([...(cyc.periodStarts ?? []), cyc.lastPeriodStart]), MIN_CYCLE_GAP_D);
  const ovulationDays = sortedDayNumbers((cyc.ovulation ?? []).filter((o) => o.method === 'lhTest' || o.method === 'clinician').map((o) => o.date));
  const historyLen = medianCycleLength(periodStarts, MIN_CYCLE_GAP_D);
  const cycleLen = Math.max(MIN_CYCLE_GAP_D, Math.round(cyc.cycleLengthD ?? (Number.isFinite(historyLen) ? historyLen : defaultLenD)));
  const cycling =
    female && cyc.tracking && !isHormonalContraception(cyc.contraception) && pr.menopause !== 'post' && cyc.menstruating !== 'no' && Number.isFinite(isoDayNumber(startDate));
  const phaseKnown = periodStarts.length > 0 && cyc.regularity !== 'irregular' && cyc.regularity !== 'unknown';
  return { mode: !cycling ? 0 : phaseKnown ? 1 : 2, cycleLen, periodStarts, ovulationDays };
}

/**
 * Cycle day, luteal weight and phase provenance on simulation day `dayIndex` (D8-07), allocation-free. The latest observed
 * period start on or before the day anchors the count (before the first start the typical cycle is projected backwards);
 * inside an observed cycle a confirmed ovulation date moves the luteal start to the next day and an observed next start
 * fixes that cycle's actual length.
 */
function cyclePhaseOn(s: ModeratorsState, k: ModeratorsK, dayIndex: number): void {
  if (k.cycleMode === 2) {
    s.cycleDay = -1;
    s.lutealWeight = k.phaseMean;
    s.cyclePhaseSource = CYCLE_PHASE.phaseAverage;
    return;
  }
  if (k.cycleMode !== 1) {
    s.cycleDay = -1;
    s.lutealWeight = 0;
    s.cyclePhaseSource = CYCLE_PHASE.none;
    return;
  }
  const dn = k.startDay + dayIndex;
  const starts = k.periodStarts;
  let li = -1;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i]! <= dn) li = i;
    else break;
  }
  const anchor = li >= 0 ? starts[li]! : starts[0]!;
  const since = dn - anchor;
  const next = li >= 0 && li + 1 < starts.length ? starts[li + 1]! : Number.NaN;
  // an observed next start fixes the length of the cycle that contains the day; otherwise the typical length applies
  const len = since >= 0 && next - anchor >= MIN_CYCLE_GAP_D ? next - anchor : k.cycleLen;
  const cd = cycleDayOn(anchor, k.startDay, dayIndex, len);
  let start = lutealStartDay(len);
  let source: number = CYCLE_PHASE.calendarEstimate;
  if (since >= 0 && since < len) {
    const ov = k.ovulationDays;
    for (let i = 0; i < ov.length; i++) {
      const o = ov[i]!;
      if (o >= anchor && o < anchor + len) {
        start = o - anchor + 2; // the cycle day after the confirmed ovulation
        source = CYCLE_PHASE.ovulationAnchored;
      }
    }
  }
  s.cycleDay = cd;
  s.lutealWeight = lutealWeightFrom(cd, start, k.rampDays);
  s.cyclePhaseSource = source;
}

/**
 * Hook-aware signal declarations (D8-07, C7). Moderators runs first in the module order: every signal is written in init
 * and startDay (partition shift in startDay only after init's 0); `caffeineLoadMg` (intake, later in the hour) is read
 * with lag 1 (the load at the start of the hour), `energyBalanceFrac` (energy, later in the day) with lag 1 (yesterday).
 */
const SIGNAL_HOOKS: readonly SignalHookDecl[] = [
  ...(['sleepDebtFastH', 'sleepDebtSlowH', 'siSleepMult', 'mpsSleepMult', 'testoSleepMult', 'partitionSleepShift', 'lutealWeight', 'cycleDay', 'stressLevel', 'ageYears'] as const).flatMap(
    (signal) => [{ signal, access: 'write', hook: 'init' } as const, { signal, access: 'write', hook: 'startDay' } as const],
  ),
  { signal: 'caffeineLoadMg', access: 'read', hook: 'stepHour', lag: 1 },
  { signal: 'energyBalanceFrac', access: 'read', hook: 'startDay', lag: 1 },
];

const moderatorsCore = defineModule<ModeratorsState, ModeratorsK>({
  id: 'moderators',
  specSection: '§1.1',
  dossiers: '16 §4.0-4.13; 15 §4.11; 02 §4.3',
  params: MODERATORS_PARAMS,
  reads: ['caffeineLoadMg', 'energyBalanceFrac'],
  writes: [
    'sleepDebtFastH',
    'sleepDebtSlowH',
    'siSleepMult',
    'mpsSleepMult',
    'testoSleepMult',
    'partitionSleepShift',
    'lutealWeight',
    'cycleDay',
    'stressLevel',
    'ageYears',
  ],
  records: ['sleepQuality'],

  prepare: (ctx: ModuleContext): ModeratorsK => {
    const p = ctx.params;
    const pr = ctx.profile;
    const g = (n: string): number => param(p, `moderators.${n}`);
    const habits = pr.habits;
    const startDay = isoDayNumber(ctx.schedule.startDate);
    const female = pr.sex === 'female' && !pr.input.sexUnspecified;
    // D8-07: calendar estimate from observed period starts; ovulation only when manually confirmed
    const { mode: cycleMode, cycleLen, periodStarts, ovulationDays } = resolveCycleTiming(pr, ctx.schedule.startDate, g('cycleLengthDefaultD'));
    const init = ctx.schedule.initialSleep;
    // A1-053: day zero carries the same observation as a later waking day — the known total asleep hours (naps counted
    // once; main timing stays `sleepHours`/`bedClockH`) and the entered quality (absent = unrated, never the planned flag)
    const initMain = init !== undefined && init.sleepHours >= 0 && init.sleepHours < Infinity ? init.sleepHours : Number.NaN;
    const initH = Number.isFinite(initMain) ? observedAsleepHours(initMain, init!.totalAsleepHours) : Number.NaN;
    const weightKg = pr.weightKg > 0 ? pr.weightKg : 70;
    const sleepFx = p.index.has('moderators.sleepDebtEffectStructure') && g('sleepDebtEffectStructure') < 0.5 ? 0 : 1;
    const alcPerDayG = (habits.habitualAlcoholDrinksPerWeek * DEFAULTS.gramsPerDrink) / 7;
    return {
      hRef: g('hRef'),
      poorH: g('qualityPoorH'),
      shiftH: g('shiftWorkH'),
      // exact one-day relaxation factors exp(−Δt/τ), Δt = 1 d (16 §4.1.1: a = 1 − exp(−1/τ))
      fDfUp: Math.exp(-1 / g('tauDfUp')),
      fDfDown: Math.exp(-1 / g('tauDfDown')),
      fDsUp: Math.exp(-1 / g('tauDsUp')),
      fDsDown: Math.exp(-1 / g('tauDsDown')),
      debtCap: g('debtCap'),
      debtCapT: g('debtCapTesto'),
      // D8-06: proposed per-hour slopes, or the zero-effect structural alternative (sleepDebtEffectStructure = 0)
      siPerH: sleepFx * g('siPerH'),
      mpsPerH: sleepFx * g('mpsPerH'),
      testoPerH: sleepFx * g('testoPerH'),
      partPerH: sleepFx * g('partitionPerH'),
      partCap: g('partitionCap'),
      partDefRef: g('partitionDeficitRef'),
      // 16 §4.2.1 half-life modifiers: combined oral contraceptive ×1.47, smoker ×0.56 (HabitProfile.smoker, 2026-09-30)
      tHalf: caffeineHalfLifeH(
        g('caffeineTHalfH'),
        female && pr.cycle.contraception === 'combinedOral',
        habits.smoker === true,
        g('caffeineOcMult'),
        g('caffeineSmokerMult'),
      ),
      rStar: g('caffeineRStarMg'),
      tstPerMg: g('tstLossPerMg'),
      tstCap: g('tstLossCapMin'),
      tstPts: g('tstLossPtsPerMin'),
      alcLo: g('alcoholDoseLowGKg'),
      alcHi: g('alcoholDoseHighGKg'),
      penLo: g('alcoholPenaltyLow'),
      penMid: g('alcoholPenaltyMid'),
      penHi: g('alcoholPenaltyHigh'),
      sleepBase: g('sleepIndexBase'),
      rampDays: g('lutealRampDays'),
      fatDrift: g('menopauseFatDriftKgYr'),
      leanDrift: g('menopauseLeanDriftKgYr'),
      isMale: pr.sex === 'male' && !pr.input.sexUnspecified,
      weightKg,
      age0: pr.ageYears,
      menoPeri: female && pr.menopause === 'peri',
      cycleMode,
      cycleLen,
      periodStarts,
      ovulationDays,
      phaseMean: lutealMeanWeight(cycleLen, g('lutealRampDays')),
      startDay,
      hasInitSleep: Number.isFinite(initH) ? 1 : 0,
      initSleepH: Number.isFinite(initH) ? initH : 0,
      initSleepPoor: Number.isFinite(initH) ? observedPoorFlag(init!.quality) : 0,
      initSleepPartial: Number.isFinite(initH) && init!.coverage === 'partial' ? 1 : 0,
      habSleepH: habits.habitualSleepDurationH ?? habitualSleepHours(habits.bedTimeH, habits.wakeTimeH),
      habPoor: habits.sleepQuality === 'poor' ? 1 : 0,
      habCaffeineMg: habits.habitualCaffeineMg,
      habBedH: habits.bedTimeH,
      habAlcoholGKg: alcPerDayG / weightKg,
      habStress: habits.stress === 'high' ? 2 : habits.stress === 'moderate' ? 1 : 0,
    };
  },

  init: (k: ModeratorsK, _ctx: ModuleContext, bus: SignalBus): ModeratorsState => {
    // steady state of the habitual sleep (a burn-in on the habitual day leaves it there): dF, dS = d_hab (capped)
    const dHab = nightlyDeficitH(k.hRef, k.habSleepH, k.habPoor, 0, k.poorH, k.shiftH);
    const dF = dHab < k.debtCap ? dHab : k.debtCap;
    const dS = dHab < k.debtCapT ? dHab : k.debtCapT;
    // habitual caffeine (one dose at 12:00 by default) at habitual bedtime
    let hoursToBed = k.habBedH - DEFAULTS.caffeineClockH;
    if (hoursToBed < 0) hoursToBed += 24;
    const habResidual = caffeineResidualMg(k.habCaffeineMg, hoursToBed, k.tHalf);
    const tst = tstLossMin(habResidual, k.rStar, k.tstPerMg, k.tstCap);
    const pen = alcoholRecoveryPenalty(k.habAlcoholGKg, k.alcLo, k.alcHi, k.penLo, k.penMid, k.penHi);
    const s: ModeratorsState = {
      sleepDebtFastH: dF,
      sleepDebtSlowH: dS,
      lastNightSleepH: k.habSleepH,
      lastNightObserved: 0,
      caffeineAtBedMg: habResidual,
      cycleDay: -1,
      cyclePhaseSource: CYCLE_PHASE.none,
      ageYears: k.age0,
      sleepQualityIdx: sleepQualityIndex(k.sleepBase, tst, k.tstPts, pen),
      caffeineTstRiskMin: tst,
      alcoholRecoveryPen: pen,
      lastNightPoor: k.habPoor,
      lastNightShift: 0,
      bedHourToday: Math.floor(k.habBedH) % 24,
      bedFracFactor: 1,
      alcoholGKgToday: 0,
      lutealWeight: 0,
      menopauseFatDriftKgYr: k.menoPeri ? k.fatDrift : 0,
      menopauseLeanDriftKgYr: k.menoPeri ? k.leanDrift : 0,
      partialSleepFromDay: -1,
    };
    cyclePhaseOn(s, k, 0);
    bus.sleepDebtFastH = s.sleepDebtFastH;
    bus.sleepDebtSlowH = s.sleepDebtSlowH;
    bus.siSleepMult = siSleepMult(dS, k.siPerH, k.debtCap);
    bus.mpsSleepMult = mpsSleepMult(dS, k.mpsPerH, k.debtCap);
    bus.testoSleepMult = testoSleepMult(dS, k.testoPerH, k.debtCapT, k.isMale);
    bus.partitionSleepShift = 0;
    bus.lutealWeight = s.lutealWeight;
    bus.cycleDay = s.cycleDay;
    bus.stressLevel = k.habStress;
    bus.ageYears = k.age0;
    return s;
  },

  startDay: (s, k, bus, day, clock) => {
    // 0. D8-06: an OBSERVED episode ending this morning (wake-date mapping, naps included) is last night's sleep; on day 0
    // without one, the last observed episode before day 0 initialises it. Logged hours are used exactly (no caffeine or
    // alcohol heuristic is subtracted). Planned/habitual days keep the carried starting-date night (their
    // `sleepEndingToday`, when the compiler sets it, is that same night).
    // A1-053: the dose is the KNOWN TOTAL asleep hours of the waking day (main episode + naps/segments, counted once), the
    // main timing stays the compiler's hourly placement; the poor flag is the entered quality only (an observed unrated night
    // clears the carried planned flag and is not read as poor); a partial (nap-only) record keeps its known dose as a named
    // scenario from that day. Day zero's initial sleep follows the same rule.
    const ep = day.sleepEndingToday;
    if (ep !== undefined && day.sleepSource === 'observed' && ep.hours >= 0 && ep.hours < Infinity) {
      s.lastNightSleepH = observedAsleepHours(ep.hours, ep.totalAsleepHours);
      s.lastNightPoor = observedPoorFlag(ep.quality);
      s.lastNightObserved = 1;
      if (ep.coverage === 'partial' && clock.day >= 0 && s.partialSleepFromDay < 0) s.partialSleepFromDay = clock.day;
    } else if (clock.day === 0 && k.hasInitSleep === 1) {
      s.lastNightSleepH = k.initSleepH;
      s.lastNightPoor = k.initSleepPoor;
      s.lastNightObserved = 1;
      if (k.initSleepPartial === 1 && s.partialSleepFromDay < 0) s.partialSleepFromDay = 0;
    }
    // 1-2. nightly deficit of last night → dF, dS relax (asymmetric exact exponentials), clamp to caps
    const d = nightlyDeficitH(k.hRef, s.lastNightSleepH, s.lastNightPoor, s.lastNightShift, k.poorH, k.shiftH);
    const tF = d < k.debtCap ? d : k.debtCap;
    const tS = d < k.debtCapT ? d : k.debtCapT;
    let dF = relax2(s.sleepDebtFastH, tF, k.fDfUp, k.fDfDown);
    let dS = relax2(s.sleepDebtSlowH, tS, k.fDsUp, k.fDsDown);
    dF = dF < 0 ? 0 : dF > k.debtCap ? k.debtCap : dF;
    dS = dS < 0 ? 0 : dS > k.debtCapT ? k.debtCapT : dS;
    s.sleepDebtFastH = dF;
    s.sleepDebtSlowH = dS;
    // 3. multipliers (16 §4.0.1)
    bus.sleepDebtFastH = dF;
    bus.sleepDebtSlowH = dS;
    bus.siSleepMult = siSleepMult(dS, k.siPerH, k.debtCap);
    bus.mpsSleepMult = mpsSleepMult(dS, k.mpsPerH, k.debtCap);
    bus.testoSleepMult = testoSleepMult(dS, k.testoPerH, k.debtCapT, k.isMale);
    bus.partitionSleepShift = partitionSleepShift(dS, bus.energyBalanceFrac, k.partPerH, k.partCap, k.partDefRef);
    // 4. cycle (function of the simulation day: exact whatever the burn-in length; calendar estimate, D8-07)
    cyclePhaseOn(s, k, clock.day);
    bus.cycleDay = s.cycleDay;
    bus.lutealWeight = s.lutealWeight;
    // 5. stress (informational: no reader, no stress-to-fat pathway) and age
    bus.stressLevel = day.stress;
    s.ageYears = k.age0 + clock.day / 365.25;
    bus.ageYears = s.ageYears;
    // 6. set up tonight's caffeine sample (planned bed hour) and alcohol dose
    const bedH = day.sleepBedH;
    if (bedH >= 24) {
      // a bedtime after midnight (clock ≥ 24, e.g. an observed episode mapped to its wake date): sample the load at the
      // start of 23:00 today and decay it to the bedtime (intake after 23:00 is not seen)
      s.bedHourToday = 23;
      s.bedFracFactor = Math.exp((-LN2 * (bedH - 23)) / k.tHalf);
    } else {
      const bedFloor = Math.floor(bedH);
      s.bedHourToday = ((bedFloor % 24) + 24) % 24;
      const frac = bedH - bedFloor;
      s.bedFracFactor = frac > 0 ? Math.exp((-LN2 * frac) / k.tHalf) : 1;
    }
    s.caffeineAtBedMg = 0;
    s.alcoholGKgToday = day.alcoholG / k.weightKg;
  },

  stepHour: (s, _k, bus, _hour, _day, clock) => {
    // caffeineLoadMg (h−1) = load at the start of this hour; sampled at the planned bed hour
    if (clock.hourOfDay === s.bedHourToday) s.caffeineAtBedMg = bus.caffeineLoadMg * s.bedFracFactor;
  },

  endOfDay: (s, k, _bus, day) => {
    // caffeine / alcohol exposure heuristics for the night that starts tonight, kept apart from any logged sleep (D8-06);
    // diet → sleep feedback into sleep hours is OFF (16 §4.2): these never change the hours used for the debt
    const tst = tstLossMin(s.caffeineAtBedMg, k.rStar, k.tstPerMg, k.tstCap);
    const pen = alcoholRecoveryPenalty(s.alcoholGKgToday, k.alcLo, k.alcHi, k.penLo, k.penMid, k.penHi);
    s.caffeineTstRiskMin = tst;
    s.alcoholRecoveryPen = pen;
    s.sleepQualityIdx = sleepQualityIndex(k.sleepBase, tst, k.tstPts, pen);
    // the planned night that starts tonight is "last night" for tomorrow's deficit (starting-date convention), unless
    // tomorrow carries an observed episode ending that morning (applied in tomorrow's startDay)
    s.lastNightSleepH = day.sleepHours;
    s.lastNightPoor = day.sleepQuality === 0 ? 1 : 0;
    s.lastNightShift = day.shiftWork ? 1 : 0;
    s.lastNightObserved = 0;
  },

  recordDay: (s, _k, _bus, out) => {
    out[MI.sleepQuality] = s.sleepQualityIdx;
  },
});

/** The moderators module with its hook-aware signal declarations (`defineModule` does not forward `signalHooks`). */
export const moderatorsModule: EngineModule<ModeratorsState, ModeratorsK> = { ...moderatorsCore, signalHooks: SIGNAL_HOOKS };

export {
  alcoholRecoveryPenalty,
  caffeineHalfLifeH,
  caffeineResidualMg,
  cycleDayOn,
  daysFromCivil,
  isoDayNumber,
  lutealMeanWeight,
  lutealStartDay,
  lutealWeightAt,
  lutealWeightFrom,
  medianCycleLength,
  mpsSleepMult,
  nightlyDeficitH,
  partitionSleepShift,
  siSleepMult,
  sleepQualityIndex,
  testoSleepMult,
  tstLossMin,
} from './equations';
export { MODERATORS_PARAMS } from './params';
export * from './sleepEpisodes';
