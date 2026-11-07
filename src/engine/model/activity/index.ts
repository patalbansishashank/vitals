/**
 * MODULE activity — exercise & step energy, EPOC, exercise intensity descriptors, VO2max, mitochondrial capacity.
 * Spec: docs/MODEL_SPEC.md §1.2 · Dossiers: 10 §4.1-4.2, §4.8-4.9, §4.13-4.14, §4.17 (owner); 09 §4.13 (RT session cost).
 * Owned files: src/engine/model/activity/** only.
 *
 * Hourly: session energy (gross = VO2·5 kcal/L, net of the person's own RMR, displaced baseline removed), EPOC queue
 * (two-component release), post-RT REE, step energy above the habitual baseline, intensity/minute/muscle/hard
 * descriptors. Daily: rolling 7-day MEM / high-intensity minutes, VO2max fast+slow pools with detraining, mitochondrial
 * capacity. Sessions are read from `DayInput.sessions` (speed, power and RPE exist only there); `HourInput.exMin` gates
 * the hour and is the fallback when no session overlaps it.
 *
 * Decisions on points the spec leaves open (all reported in the WP report):
 *  - Burn-in (clock.day < 0), data-driven so that it works with the current habitual day (no explicit sessions) and with
 *    the habitual week of review B3(a): while no burn-in day has carried a session the module emits the habitual exercise
 *    energy EAT0/24 per hour (same formula as core/resolveProfile: sessions/wk·(MET − 1)·BW/7) and holds the VO2max /
 *    MEM / mitochondria state at its habitual equilibrium; once burn-in days carry sessions they are simulated like real
 *    days, the rings follow them, the pools stay held, and at the end of burn-in (clock.day = −1) the pools, vSed and the
 *    mitochondrial state are re-anchored so that the observed habitual dose is the equilibrium of the t = 0 state.
 *  - Initial VO2max pools are the equilibrium of the habitual MEM (vSed = VO2max0/(1 + g*(MEM_hab))), so maintenance is
 *    a steady state; mitoRel = (M_c·M_r)/(M_c·M_r at t = 0), i.e. relative to the person's own baseline (bus meaning).
 *  - H_wb of 09 §4.13 is read as `trainingStatus` (the only whole-body training variable on the bus).
 *
 * 2026-10-18 (D3-03, D3-07, D3-08):
 *  - Interval sessions with phases (`SessionResolved.phases`) are integrated phase by phase — energy, EPOC, relative
 *    intensity, MEM and high-intensity minutes at each phase's own intensity — never at the work intensity for the whole
 *    session. Public-health guideline minutes (`dayHealthMinutes`) are a separate count from the fitness MEM index.
 *  - One bout ledger (core/exerciseCost): net above the person's own rest, minus the displaced lifestyle prior = the
 *    incremental energy booked (signed); recovery booked once on top. Step energy uses the step ledger: a total-day count
 *    loses the locomotor steps of sessions inside it (`DayInput.stepsScope`/`sessionIncludedSteps`, session
 *    `stepsIncluded`), the habitual reference by the same rule.
 *  - Resistance recovery: production books no prolonged post-RT REE and no residual RT recovery budget (both 0 in every
 *    draw); a research budget (epocRt) and the Heden rectangle (postRtRee) are alternatives, never booked together.
 *
 * 2026-10-19 (re-audit A1-021, A1-040, A1-062):
 *  - A cardio part may be an ordered time line of several doses (`steady` segments, interval phases, an unknown-class
 *    `remainder`): every segment is integrated at its own intensity; the interval EPOC ceiling applies only to a true
 *    work/recovery structure (or the HIIT modality), never because records were concatenated.
 *  - Guideline minutes come from a stated class / talk test or a rating DECLARED on the generic relative-effort 0-10 scale
 *    (a phase's own scale, else only the session's explicit one); a Borg CR10, RIR-RPE or unscaled rating alone leaves them
 *    unknown. The interim CR-10 → %VO2max energy scenario never takes a generic-scale or RIR-RPE rating.
 *  - The habitual step reference is reconciled by the same ledger rule as a day, with the habitual sessions' included steps
 *    when known (`HabitProfile.habitualStepsOverlap`); an unknown habitual overlap is the named no-subtraction reference
 *    scenario (`habitualStepsOverlapUnknown`), reported by `stepsOverlapAssumptions` for both operands.
 */
import { defineModule } from '../../core/moduleKit';
import { param } from '../../core/paramsRegistry';
import { selectorIndexFor } from '../../core/resolveProfile';
import { DOCUMENTED_CYCLE_MET } from '../../core/resolveProfile';
import { DEFAULTS } from '../../core/defaults';
import { stepLedgerSteps, stepsOverlapStatus, STEPS_OVERLAP_UNKNOWN } from '../../core/exerciseCost';
import { CARDIO_MODALITY_CODE, MAX_SESSIONS, N_REGIONS } from '../../types/inputs';
import type { DayInput, SessionResolved } from '../../types/inputs';
import type { HealthIntensityClass, IntervalPhase, StepsScope } from '../../types/schedule';
import { MI, type SeriesId } from '../../types/metrics';
import type { SeriesStatusMeta } from '../../types/result';
import type { EngineModule, ModuleContext, SignalHookDecl } from '../../types/module';
import type { ModelParams } from '../../types/params';
import type { ResolvedProfile } from '../../types/profile';
import type { SignalBus } from '../../types/signals';
import { ACTIVITY_PARAMS } from './params';
import {
  epocPhi,
  healthClassFromRating,
  jacksonVo2max,
  memWeight,
  mitoContentTarget,
  mitoRespTarget,
  overlapH,
  responsiveness,
  retentionRho,
  sessionGrossKcalPerMin,
  trainedTauFactor,
  updateGainPool,
  vo2FromKcalPerMin,
  vo2GainTarget,
  type ActivityK,
  type HealthClassK,
} from './equations';

/**
 * Named assumptions this module brings into every run (for `SimulationMeta.assumptions`, C6): the fitness MEM index is a
 * heuristic training dose (not guideline minutes); a generic CR-10 rating maps to %VO2max only as a broad scenario; the
 * residual resistance recovery energy is booked at 0 pending the deposition-overlap audit.
 */
export const ACTIVITY_MODEL_ASSUMPTIONS = ['fitnessMemHeuristic', 'cardioRpeScenario', 'rtRecoveryZeroCentral'] as const;

/**
 * C6 status of the activity module's fitness output (D3-03), for the run's recorder: the VO2max trajectory is an
 * uncalibrated fitness-response scenario (a broad estimate in mL/kg/min; a manual field test calibrates its start, never its
 * response), not a measured-like value. Allocation allowed (finalize).
 */
export function activityOutputStatus(): Partial<Record<SeriesId, SeriesStatusMeta>> {
  return { vo2max: { status: 'scenario', reasonCode: 'fitnessResponseScenario', uncertaintyKind: 'scenario' } };
}
export { STEPS_OVERLAP_UNKNOWN };

/** Which resistance recovery mechanism a run books (D3-08): none (production), the finite budget, or the Heden rectangle. */
export type RtRecoveryMode = 'none' | 'budget' | 'legacyRectangle';

export interface ActivityState {
  /** Current VO2max, mL/kg/min; fast/slow training pools (10 §4.8: τF 15 d 55 %, τS 60 d 45 %), fractions of vSed. */
  vo2max: number;
  vo2FastPool: number;
  vo2SlowPool: number;
  /** Rolling 7-day moderate-equivalent minutes MEM (10 §4.8 weights). */
  mem7d: number;
  /** Oxidative capacity relative to the person's own t = 0 value, (M_c·M_r)/(M_c·M_r)₀ (bus `mitoRel`). */
  mitoRel: number;
  /** EPOC still to be released, kcal (fast + slow components), and its kcal-weighted release time constant, h (10 §4.2). */
  epocRemainingKcal: number;
  epocTauH: number;
  /** Hours left of the post-RT REE elevation (09 §4.13: 5 % REE for 72 h, not additive). */
  postRtReeHoursLeft: number;
  /** Ring of the last 7 days' net exercise EE, kcal/d (for EA and compensation), and its write index. */
  eeNetRing: Float64Array;
  ringIdx: number;
  /** Net session kcal accumulated today. */
  dayNetKcal: number;

  // ---- extensions
  /** Detrained ("floor") VO2max, mL/kg/min, chosen so the habitual dose holds the initial VO2max steady. */
  vSed: number;
  /** Peak total gain fraction (retention floor reference, 10 §4.8C). */
  gPeak: number;
  /** Rolling 7-day minutes at x ≥ 0.85 (detraining maintenance m = min(1, hi7d/30)). */
  hi7d: number;
  memRing: Float64Array;
  hiRing: Float64Array;
  cardioNetRing: Float64Array;
  /** Today's accumulators: MEM, high-intensity minutes, net cardio kcal. */
  dayMem: number;
  dayHiMin: number;
  dayCardioNet: number;
  /** Mitochondrial content M_c, respiratory capacity M_r, their peak content and the t = 0 index (10 §4.9). */
  mC: number;
  mR: number;
  mPeak: number;
  mitoIdx0: number;
  /** EPOC recovery-speed factor 1 − 0.25·clamp((M_c·M_r − 1)/0.4). */
  trainedTau: number;
  /** EPOC components: fast (τ1 / light) and slow (τ2) remaining kcal and their time constants, h. */
  epocFastKcal: number;
  epocFastTauH: number;
  epocSlowKcal: number;
  epocSlowTauH: number;
  /** Cached per-hour decay factors exp(−1/τ) of the two components (refreshed when a component's τ changes). */
  epocFastF: number;
  epocSlowF: number;
  /** Today's step baseline: habitual/day steps (0 when the day has none), and waking hours for the zero-step case. */
  stepsRatio: number;
  stepsDayZero: number;
  wakeHoursToday: number;
  /** kcal per step above the baseline (1 − habitual/day steps) and, for a zero-step day, the baseline removal per waking hour. */
  stepsCoef: number;
  stepsZeroCoef: number;
  /** Hourly scratch (overwritten every hour): minutes, Σ x·minutes, net, increment, kcal, flags, cardio sums, dose. */
  hMins: number;
  hXw: number;
  hNet: number;
  hInc: number;
  hHard: number;
  hRt: number;
  hCardioMins: number;
  hCardioNet: number;
  hMem: number;
  hHiMin: number;
  /** 1 when the exercise signals on the bus already hold their idle zeros (skips six writes per idle hour). */
  idleWritten: number;
  /** 1 once a burn-in day has carried explicit sessions (habitual week): burn-in then behaves like real days. */
  burnInReal: number;
  /** Pseudo session used when `hour.exMin > 0` but no DayInput session overlaps the hour. */
  fallback: SessionResolved;
  /** Scratch for one interval phase of a session (D3-03), overwritten per phase; never read across hours. */
  phaseScratch: SessionResolved;
  /**
   * A1-021: the previous day's sessions that run past its midnight, on today's clock (start − 24 h; MAX_SESSIONS slots,
   * `nCarry` used), so their minutes after midnight are integrated with their own descriptors and phase time line rather than
   * the hour table's merged fallback. Written in `endOfDay`, read in the next day's `stepHour`.
   */
  carry: SessionResolved[];
  nCarry: number;
}

/** Run constants of the activity module (registry values + person), exported for the R-MAINT planned-activity estimator. */
export interface ActivityModK extends ActivityK {
  bw0: number;
  heightM: number;
  invH2: number;
  rmr0H: number;
  habSteps: number;
  smmActiveKg: number;
  rho: number;
  isFemaleAdj: number;
  /** Habitual exercise: net kcal/d (EAT0, resolveProfile convention), cardio share, MEM/wk. */
  eatHabKcalD: number;
  cardioNetHabKcalD: number;
  memHabWk: number;
  // init-time
  v0: number;
  /** Habitual steps in the step-energy ledger (D3-07: the habitual count reconciled by the same scope rule as a day). */
  habStepsLedger: number;
  /** D3-03 guideline-accounting constants (WHO 2020 classes, vigorous weight). */
  health: HealthClassK;
  /** D3-08 resistance recovery mechanism in force (derived from epocRt / postRtRee). */
  rtRecoveryMode: RtRecoveryMode;
}

const HABIT_RT_MET = 4.0;

function newSession(): SessionResolved {
  return {
    kind: 'cardio',
    startH: 0,
    durationMin: 0,
    modality: 0,
    intensityFrac: Number.NaN,
    met: Number.NaN,
    speedKmh: Number.NaN,
    powerW: Number.NaN,
    rpe: Number.NaN,
    setsByRegion: new Float64Array(N_REGIONS),
    rir: 0,
    loadPct1RM: 0,
    restSec: 0,
    toFailure: false,
    carbDuringGPerH: 0,
    coldWaterImmersion: false,
    phases: undefined,
    healthIntensityClass: undefined,
    rpeScale: undefined,
    realisedGrossKcal: undefined,
  };
}

/**
 * Copy the part of `src` after its day's midnight into carry slot `dst` on the next day's clock (A1-021): the same
 * descriptors and phase time line (shared reference, never mutated), start − 24 h. No allocation.
 */
function carryInto(dst: SessionResolved, src: SessionResolved): void {
  dst.kind = src.kind;
  dst.startH = src.startH - 24;
  dst.durationMin = src.durationMin;
  dst.modality = src.modality;
  dst.intensityFrac = src.intensityFrac;
  dst.met = src.met;
  dst.speedKmh = src.speedKmh;
  dst.powerW = src.powerW;
  dst.rpe = src.rpe;
  dst.rpeScale = src.rpeScale;
  dst.rir = src.rir;
  dst.loadPct1RM = src.loadPct1RM;
  dst.restSec = src.restSec;
  dst.toFailure = src.toFailure;
  dst.carbDuringGPerH = src.carbDuringGPerH;
  dst.coldWaterImmersion = src.coldWaterImmersion;
  dst.phases = src.phases;
  dst.healthIntensityClass = src.healthIntensityClass;
  dst.realisedGrossKcal = src.realisedGrossKcal;
  dst.boutDurationMin = src.boutDurationMin;
}

/** True when a phase states an intensity of its own (else it inherits the session's descriptors). */
function phaseHasIntensity(ph: IntervalPhase): boolean {
  return ph.realisedGrossKcal !== undefined || ph.pctVo2max !== undefined || ph.met !== undefined || ph.rpe !== undefined || ph.speedKmh !== undefined || ph.powerW !== undefined;
}

/**
 * Load phase `ph` of cardio session `sess` into `out` (D3-03): the phase's own intensity descriptors; a phase without any
 * inherits the session's (an explicit assumption, reported by the compiler). The phase's rating keeps its scale (A1-062: its
 * own, else only the session's explicitly declared one), so the CR-10 energy scenario never takes another scale. No allocation.
 */
function loadPhase(out: SessionResolved, sess: SessionResolved, ph: IntervalPhase): SessionResolved {
  out.kind = 'cardio';
  out.modality = sess.modality;
  out.durationMin = ph.durationMin;
  out.toFailure = false;
  if (phaseHasIntensity(ph)) {
    out.intensityFrac = ph.pctVo2max !== undefined ? ph.pctVo2max : Number.NaN;
    out.met = ph.met !== undefined ? ph.met : Number.NaN;
    out.rpe = ph.rpe !== undefined ? ph.rpe : Number.NaN;
    out.rpeScale = ph.rpeScale ?? sess.rpeScale;
    out.speedKmh = ph.speedKmh !== undefined ? ph.speedKmh : Number.NaN;
    out.powerW = ph.powerW !== undefined ? ph.powerW : Number.NaN;
    out.realisedGrossKcal = ph.realisedGrossKcal;
  } else {
    out.intensityFrac = sess.intensityFrac;
    out.met = sess.met;
    out.rpe = sess.rpe;
    out.rpeScale = sess.rpeScale;
    out.speedKmh = sess.speedKmh;
    out.powerW = sess.powerW;
    // SPEC V1.5: a phase without its own intensity takes its time share of the bout's realised gross (uniform rate)
    out.realisedGrossKcal = ph.realisedGrossKcal ?? (sess.realisedGrossKcal !== undefined && sess.durationMin > 0 ? (sess.realisedGrossKcal * ph.durationMin) / sess.durationMin : undefined);
  }
  return out;
}

const hasPhases = (sess: SessionResolved): boolean => sess.kind === 'cardio' && sess.phases !== undefined && sess.phases.length > 0;

/**
 * Whether a session takes the interval EPOC ceiling (D3-03, A1-021): the HIIT modality, or a time line with a true
 * work/recovery structure. Steady segments, warm-up/cool-down and remainders of concatenated doses are not intervals.
 */
function isIntervalSession(sess: SessionResolved): boolean {
  if (sess.modality === CARDIO_MODALITY_CODE.hiit) return true;
  const ph = sess.phases;
  if (ph === undefined) return false;
  for (let i = 0; i < ph.length; i++) {
    const kind = ph[i]!.kind;
    if (kind === 'work' || kind === 'recovery') return true;
  }
  return false;
}

/**
 * Accumulate `mins` minutes of one bout part (a whole session, or one interval phase) into the hour scratch and the EPOC
 * queue (no allocation). `epocDurMin` is the whole session's duration (EPOC's duration factor) and `isInterval` selects the
 * interval EPOC ceiling (HIIT modality, or a session with phases).
 * `burn` = a burn-in (habitual-week) day: the habitual cardio sessions of `habitualWeek` carry no intensity and are
 * entered at the Compendium 5.0 MET that TDEE0's EAT0 assumes, which is < 40 % VO2max (MEM weight 0) for fit people; for
 * the training dose (MEM, high-intensity minutes) such sessions count at the modality's default moderate intensity
 * (MODEL_SPEC §5.3 table, 10 §4.8 band midpoints) — the same assumption as the habitual MEM of `prepare` — so a habitual
 * exerciser's VO2max equilibrium carries a real training gain that detraining can lose (10 V16: −11 % at 21 d, −19 % at
 * 56 d instead of 0; integration 2026-09-30). Sessions with an explicit intensity always use it.
 */
function accumulatePart(
  s: ActivityState,
  k: ActivityModK,
  sess: SessionResolved,
  mins: number,
  epocDurMin: number,
  isInterval: boolean,
  bw: number,
  rmrMin: number,
  bmi: number,
  burn: boolean,
): void {
  const gross = sessionGrossKcalPerMin(k, sess, s.vo2max, bw, k.heightM, rmrMin, bmi);
  // relative intensity: the stated work intensity when given, else the one implied by the gross cost
  let x = sess.kind !== 'resistance' && sess.intensityFrac > 0 ? sess.intensityFrac : vo2FromKcalPerMin(gross, bw, k.kcalPerL) / s.vo2max;
  if (x > 1.2) x = 1.2;
  // D3-07 shared ledger: net above the person's own rest; incremental = net − displaced lifestyle (signed)
  let netMin = gross - rmrMin;
  if (netMin < 0) netMin = 0;
  const net = netMin * mins;
  s.hMins += mins;
  s.hXw += x * mins;
  s.hNet += net;
  s.hInc += net - k.displaced * rmrMin * mins;
  const isRt = sess.kind === 'resistance';
  if (isRt) {
    s.hRt = 1;
    if (sess.toFailure) s.hHard = 1;
  } else {
    s.hCardioMins += mins;
    s.hCardioNet += net;
    const dx = burn && !(sess.intensityFrac > 0) ? (k.defaultX[sess.modality] ?? Number.NaN) : Number.NaN;
    const xDose = dx > 0 ? dx : x;
    s.hMem += mins * memWeight(xDose, k);
    if (x >= k.hardX) s.hHard = 1;
    if (xDose >= k.hardX) s.hHiMin += mins;
  }
  // EPOC (10 §4.2) / RT recovery budget (D3-08): φ of the part's net cost, queued into the fast / slow components of the
  // normalised kernel (released from the next hour, once)
  const add = epocPhi(x, epocDurMin, isRt, isInterval, k) * net;
  if (add > 0) {
    const tt = s.trainedTau;
    if (!isRt && x < k.epocLightX) {
      const tau = k.epocTauLight * tt;
      const tot = s.epocFastKcal + add;
      s.epocFastTauH = (s.epocFastKcal * s.epocFastTauH + add * tau) / tot;
      s.epocFastKcal = tot;
      s.epocFastF = Math.exp(-1 / s.epocFastTauH);
    } else {
      const addF = add * k.epocFastShare;
      const addS = add - addF;
      const tau1 = k.epocTau1 * tt;
      const tau2 = k.epocTau2 * tt;
      const totF = s.epocFastKcal + addF;
      s.epocFastTauH = (s.epocFastKcal * s.epocFastTauH + addF * tau1) / totF;
      s.epocFastKcal = totF;
      s.epocFastF = Math.exp(-1 / s.epocFastTauH);
      const totS = s.epocSlowKcal + addS;
      s.epocSlowTauH = (s.epocSlowKcal * s.epocSlowTauH + addS * tau2) / totS;
      s.epocSlowKcal = totS;
      s.epocSlowF = Math.exp(-1 / s.epocSlowTauH);
    }
  }
}

/** (r063) EPOC's duration: the whole physical bout's moving minutes for one moving part of a paused bout, else the session's. */
const epocDurationOf = (sess: SessionResolved): number => (sess.boutDurationMin !== undefined && sess.boutDurationMin > 0 ? sess.boutDurationMin : sess.durationMin);

/**
 * Accumulate the part of session `sess` that falls in clock hour [h, h + 1) (D3-03: an interval session phase by phase;
 * time past the last phase, if the phases do not fill the session, at the session's own descriptors). No allocation.
 */
function accumulateSession(s: ActivityState, k: ActivityModK, sess: SessionResolved, h: number, bw: number, rmrMin: number, bmi: number, burn: boolean): void {
  const end = sess.startH + sess.durationMin / 60;
  const epocDur = epocDurationOf(sess);
  if (!hasPhases(sess)) {
    const mins = overlapH(sess.startH, end, h, h + 1) * 60;
    if (mins > 1e-9) accumulatePart(s, k, sess, mins, epocDur, sess.modality === CARDIO_MODALITY_CODE.hiit, bw, rmrMin, bmi, burn);
    return;
  }
  const phases = sess.phases!;
  const interval = isIntervalSession(sess);
  let t = sess.startH;
  for (let i = 0; i < phases.length && t < end; i++) {
    const ph = phases[i]!;
    const d = ph.durationMin > 0 ? ph.durationMin : 0;
    const t1 = t + d / 60 < end ? t + d / 60 : end;
    const m = overlapH(t, t1, h, h + 1) * 60;
    if (m > 1e-9) accumulatePart(s, k, loadPhase(s.phaseScratch, sess, ph), m, epocDur, interval, bw, rmrMin, bmi, burn);
    t = t1;
  }
  if (t < end) {
    const m = overlapH(t, end, h, h + 1) * 60;
    if (m > 1e-9) accumulatePart(s, k, sess, m, epocDur, interval, bw, rmrMin, bmi, burn);
  }
}

/** Push today's accumulators into the 7-day rings and refresh the rolling sums (no allocation). */
function pushDayToRings(s: ActivityState): void {
  const i = s.ringIdx;
  s.eeNetRing[i] = s.dayNetKcal;
  s.cardioNetRing[i] = s.dayCardioNet;
  s.memRing[i] = s.dayMem;
  s.hiRing[i] = s.dayHiMin;
  s.ringIdx = i === 6 ? 0 : i + 1;
  let mem = 0;
  let hi = 0;
  for (let j = 0; j < 7; j++) {
    mem += s.memRing[j]!;
    hi += s.hiRing[j]!;
  }
  s.mem7d = mem;
  s.hi7d = hi;
}

/**
 * End of burn-in with real habitual sessions: make the observed weekly dose the equilibrium of the t = 0 state
 * (VO2max = its initial value v0, pools = shares of g*(MEM), vSed = v0/(1 + g*), mitochondria at their targets).
 */
function anchorToHabitualDose(s: ActivityState, k: ActivityModK, bus: SignalBus): void {
  const gStar = vo2GainTarget(s.mem7d, k);
  s.vSed = k.v0 / (1 + gStar);
  s.vo2FastPool = k.fastShare * gStar;
  s.vo2SlowPool = (1 - k.fastShare) * gStar;
  s.gPeak = gStar;
  s.vo2max = k.v0;
  s.mC = mitoContentTarget(s.mem7d, k);
  s.mR = mitoRespTarget(s.hi7d, k);
  s.mPeak = s.mC;
  s.mitoIdx0 = s.mC * s.mR;
  s.trainedTau = trainedTauFactor(s.mitoIdx0, k);
  s.mitoRel = 1;
  bus.vo2maxMlKgMin = s.vo2max;
  bus.mitoRel = 1;
}

/** Scratch phase session of the stateless day estimators (sessionsBookedKcal, dayAerobicDose); never read across calls. */
const DAY_PHASE = newSession();

/** Booked kcal of `dur` minutes of one bout part: net − displaced + EPOC/recovery budget (the shared ledger, D3-07). */
function partBookedKcal(k: ActivityModK, part: SessionResolved, dur: number, epocDurMin: number, isInterval: boolean, vo2max: number, bw: number, bmi: number, rmrMin: number): number {
  const gross = sessionGrossKcalPerMin(k, part, vo2max, bw, k.heightM, rmrMin, bmi);
  let x = part.kind !== 'resistance' && part.intensityFrac > 0 ? part.intensityFrac : vo2FromKcalPerMin(gross, bw, k.kcalPerL) / vo2max;
  if (x > 1.2) x = 1.2;
  let netMin = gross - rmrMin;
  if (netMin < 0) netMin = 0;
  const net = netMin * dur;
  return net - k.displaced * rmrMin * dur + epocPhi(x, epocDurMin, part.kind === 'resistance', isInterval, k) * net;
}

/**
 * Booked energy of a day's sessions before the post-RT REE (MODEL_SPEC §1.2 step 6, the `exPlannedKcalD` estimate):
 * Σ over sessions (interval sessions phase by phase, D3-03) of (net of the person's own RMR − displaced lifestyle baseline
 * + EPOC/recovery budget) at the given VO2max (mL/kg/min), body mass (kg), BMI and RMR (kcal/h). The single definition used
 * by `startDay` and by the R-MAINT planned-activity estimator (`core/activityReference.ts`). No allocation.
 */
export function sessionsBookedKcal(k: ActivityModK, day: DayInput, vo2max: number, bw: number, bmi: number, rmrH: number): number {
  const rmrMin = rmrH / 60;
  let est = 0;
  for (let i = 0; i < day.nSessions; i++) {
    const sess = day.sessions[i]!;
    const dur = sess.durationMin;
    if (!(dur > 0)) continue;
    const epocDur = epocDurationOf(sess);
    if (!hasPhases(sess)) {
      est += partBookedKcal(k, sess, dur, epocDur, sess.modality === CARDIO_MODALITY_CODE.hiit, vo2max, bw, bmi, rmrMin);
      continue;
    }
    const interval = isIntervalSession(sess);
    let left = dur;
    for (const ph of sess.phases!) {
      if (!(left > 0)) break;
      const d = ph.durationMin > 0 ? (ph.durationMin < left ? ph.durationMin : left) : 0;
      if (d > 0) est += partBookedKcal(k, loadPhase(DAY_PHASE, sess, ph), d, epocDur, interval, vo2max, bw, bmi, rmrMin);
      left -= d;
    }
    if (left > 1e-9) est += partBookedKcal(k, sess, left, epocDur, interval, vo2max, bw, bmi, rmrMin);
  }
  return est;
}

/** MEM and high-intensity minutes of `dur` minutes of one cardio part at its relative intensity (into OUT2). */
function partAerobicDose(k: ActivityModK, part: SessionResolved, dur: number, vo2max: number, bw: number, bmi: number, rmrMin: number, out: Float64Array): void {
  let x = part.intensityFrac;
  if (!(x > 0)) x = vo2FromKcalPerMin(sessionGrossKcalPerMin(k, part, vo2max, bw, k.heightM, rmrMin, bmi), bw, k.kcalPerL) / vo2max;
  if (x > 1.2) x = 1.2;
  out[0] = out[0]! + dur * memWeight(x, k);
  if (x >= k.hardX) out[1] = out[1]! + dur;
}

/**
 * Aerobic training dose of a day's cardio sessions (10 §4.8, as `accumulateSession` books it on a real day; interval
 * sessions phase by phase): writes the moderate-equivalent minutes (MEM, the heuristic fitness index) into `out[0]` and the
 * minutes at x ≥ hardX into `out[1]`. For the R-MAINT planned-activity estimator (VO2max trajectory). No allocation.
 */
export function dayAerobicDose(k: ActivityModK, day: DayInput, vo2max: number, bw: number, bmi: number, rmrH: number, out: Float64Array): void {
  const rmrMin = rmrH / 60;
  out[0] = 0;
  out[1] = 0;
  for (let i = 0; i < day.nSessions; i++) {
    const sess = day.sessions[i]!;
    const dur = sess.durationMin;
    if (!(dur > 0) || sess.kind === 'resistance') continue;
    if (!hasPhases(sess)) {
      partAerobicDose(k, sess, dur, vo2max, bw, bmi, rmrMin, out);
      continue;
    }
    let left = dur;
    for (const ph of sess.phases!) {
      if (!(left > 0)) break;
      const d = ph.durationMin > 0 ? (ph.durationMin < left ? ph.durationMin : left) : 0;
      if (d > 0) partAerobicDose(k, loadPhase(DAY_PHASE, sess, ph), d, vo2max, bw, bmi, rmrMin, out);
      left -= d;
    }
    if (left > 1e-9) partAerobicDose(k, sess, left, vo2max, bw, bmi, rmrMin, out);
  }
}

/**
 * Guideline class of one minute of session `sess` in phase `ph` (A1-021/A1-062): the phase's own class, else its rating on
 * the declared generic relative-effort scale (its own scale, else only the session's explicit one), else the session's class
 * (set only when every minute has it), else the session's own rating on the declared generic scale; otherwise unknown. A
 * Borg CR10, RIR-RPE or unscaled rating never classifies. No allocation.
 */
function minuteClass(k: ActivityModK, sess: SessionResolved, ph: IntervalPhase | null): HealthIntensityClass {
  if (ph !== null) {
    const pc = ph.healthIntensityClass;
    if (pc !== undefined && pc !== 'unknown') return pc;
    const r = healthClassFromRating(ph.rpe, ph.rpeScale ?? sess.rpeScale, k.health);
    if (r !== 'unknown') return r;
  }
  const sc = sess.healthIntensityClass;
  if (sc !== undefined && sc !== 'unknown') return sc;
  return healthClassFromRating(Number.isFinite(sess.rpe) ? sess.rpe : undefined, sess.rpeScale, k.health);
}

/**
 * Public-health guideline minutes of a day's cardio sessions (D3-03), separate from the fitness MEM index: `out[0]`
 * moderate, `out[1]` vigorous, `out[2]` minutes whose class is unknown (not zero activity), `out[3]` light. Each minute is
 * classified by `minuteClass` (A1-021/A1-062): a stated or talk-test class, or a rating declared on the generic relative-effort
 * 0-10 scale; an interval time line phase by phase (recovery is not vigorous work); nothing is classified from %VO2max,
 * VO2max, a CR10 or an unscaled rating. No bout minimum. No allocation.
 */
export function dayHealthMinutes(k: ActivityModK, day: DayInput, out: Float64Array): void {
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  for (let i = 0; i < day.nSessions; i++) {
    const sess = day.sessions[i]!;
    const dur = sess.durationMin;
    if (!(dur > 0) || sess.kind === 'resistance') continue;
    const phases = sess.phases;
    let left = dur;
    if (phases && phases.length > 0) {
      for (const ph of phases) {
        if (!(left > 0)) break;
        const d = ph.durationMin > 0 ? (ph.durationMin < left ? ph.durationMin : left) : 0;
        addHealth(out, minuteClass(k, sess, ph), d);
        left -= d;
      }
    }
    if (left > 1e-9) addHealth(out, minuteClass(k, sess, null), left);
  }
}

function addHealth(out: Float64Array, cls: HealthIntensityClass, m: number): void {
  const i = cls === 'moderate' ? 0 : cls === 'vigorous' ? 1 : cls === 'light' ? 3 : 2;
  out[i] = out[i]! + m;
}

/** Locomotor steps of a day's sessions inside its step count (D3-07): the day's own number, else the sessions' sum. */
export function daySessionIncludedSteps(day: DayInput): number | undefined {
  if (day.sessionIncludedSteps !== undefined && Number.isFinite(day.sessionIncludedSteps)) return day.sessionIncludedSteps;
  let any = false;
  let sum = 0;
  for (let i = 0; i < day.nSessions; i++) {
    const v = day.sessions[i]!.stepsIncluded;
    if (v !== undefined && Number.isFinite(v)) {
      any = true;
      sum += v;
    }
  }
  return any ? sum : undefined;
}

/** Steps of a day in the step-energy ledger (D3-07; the reported count is never changed). */
export function dayLedgerSteps(day: DayInput): number {
  return stepLedgerSteps(day.steps, day.stepsScope, daySessionIncludedSteps(day));
}

/** True when a day has a locomotor session (walking or running, or one with logged steps) whose steps a count may contain. */
function hasLocomotorSession(day: DayInput): boolean {
  for (let i = 0; i < day.nSessions; i++) {
    const s = day.sessions[i]!;
    if (!(s.durationMin > 0)) continue;
    if (s.stepsIncluded !== undefined) return true;
    if (s.kind === 'cardio' && (s.modality === CARDIO_MODALITY_CODE.walk || s.modality === CARDIO_MODALITY_CODE.run)) return true;
  }
  return false;
}

/**
 * D3-07: the single named assumption of a run whose step/session overlap is unresolved on some day — a step count of
 * unknown scope (legacy) or a total-day count without the sessions' included steps, on a day with a walking/running
 * session. Nothing is subtracted on such a day (an explicit scenario, never a guessed fraction); the reported steps are
 * unchanged. Null when every day's overlap is resolved or absent. Allocation allowed (finalize).
 */
export function stepsOverlapAssumption(days: readonly DayInput[]): typeof STEPS_OVERLAP_UNKNOWN | null {
  for (const day of days) {
    if (!(day.steps > 0)) continue;
    if (stepsOverlapStatus(day.stepsScope, daySessionIncludedSteps(day), hasLocomotorSession(day)) === 'unknown') return STEPS_OVERLAP_UNKNOWN;
  }
  return null;
}

/**
 * A1-040: named assumption of a run whose HABITUAL step reference has an unresolved step/session overlap — a total-day or
 * legacy habitual count with habitual sessions that may be locomotor and no stated habitual included steps. Nothing is
 * subtracted from the reference (the explicit no-subtraction reference scenario, never a guessed cadence, a generic cardio
 * mix or a copy of current steps); the current-minus-habitual step energy is conditional on it.
 */
export const HABITUAL_STEPS_OVERLAP_UNKNOWN = 'habitualStepsOverlapUnknown' as const;

/** Cardio sessions per week of the habitual week (the rule of core/compileSchedule.habitualWeek: N = round(sessions/wk)). */
function habitualCardioSessions(sessionsPerWeek: number, mix: number): number {
  const n = Math.max(0, Math.min(7, Math.round(Number.isFinite(sessionsPerWeek) ? sessionsPerWeek : 0)));
  const m = Math.max(0, Math.min(1, Number.isFinite(mix) ? mix : 0));
  let c = 0;
  for (let i = 0; i < n; i++) if (Math.floor((i + 1) * m + 1e-9) > Math.floor(i * m + 1e-9)) c++;
  return c;
}

/**
 * Habitual reference overlap of `pr` (A1-040): the habitual steps' scope and the habitual sessions' locomotor steps inside
 * them when KNOWN (`habitualStepsOverlap.status === 'known'`: its weekly-mean steps/d, else Σ of its identified bouts / 7),
 * else undefined. A known included amount means the count contains those sessions' steps (it is reconciled like a
 * total-day count); `excludesTraining` subtracts nothing.
 */
export function habitualStepsReference(pr: ResolvedProfile): { steps: number; scope: StepsScope | undefined; includedSteps: number | undefined } {
  const scope = pr.habits.stepsScope ?? pr.input.habits?.stepsScope;
  const o = pr.habits.habitualStepsOverlap ?? pr.input.habits?.habitualStepsOverlap;
  let inc: number | undefined;
  if (o !== undefined && o.status === 'known') {
    if (o.includedStepsPerDay !== undefined && Number.isFinite(o.includedStepsPerDay) && o.includedStepsPerDay >= 0) inc = o.includedStepsPerDay;
    else if (o.bouts !== undefined && o.bouts.length > 0) {
      let sum = 0;
      let ok = true;
      for (const b of o.bouts) {
        if (Number.isFinite(b.stepsIncluded) && b.stepsIncluded >= 0) sum += b.stepsIncluded;
        else ok = false;
      }
      if (ok) inc = sum / 7;
    }
  }
  const eff: StepsScope | undefined = inc !== undefined && scope !== 'excludesTraining' ? 'totalDay' : scope;
  return { steps: pr.habits.typicalSteps, scope: eff, includedSteps: inc };
}

/**
 * Overlap status of the habitual step reference (A1-040), by the same rule as a day (`stepsOverlapStatus`): habitual cardio
 * sessions of unstated kind may be locomotor, so a total-day or legacy habitual count without known included steps is
 * 'unknown'; 'none' without habitual steps or cardio sessions, or for an excludes-training count.
 */
export function habitualStepsOverlapStatus(pr: ResolvedProfile): 'none' | 'known' | 'unknown' {
  const ref = habitualStepsReference(pr);
  if (!(ref.steps > 0)) return 'none';
  const hasLoco = habitualCardioSessions(pr.habits.sessionsPerWeek, pr.habits.lifingCardioMix) > 0;
  return stepsOverlapStatus(ref.scope, ref.includedSteps, hasLoco);
}

/** Step/session overlap of a run's two operands (A1-040): the current days and the habitual reference. */
export interface StepsOverlapDisclosure {
  /** Named assumptions in force: the current-day overlap scenario and/or the habitual reference scenario. */
  assumptions: Array<typeof STEPS_OVERLAP_UNKNOWN | typeof HABITUAL_STEPS_OVERLAP_UNKNOWN>;
  current: 'none' | 'known' | 'unknown';
  reference: 'none' | 'known' | 'unknown';
}

/**
 * A1-040: overlap disclosure for `SimulationMeta.assumptions` — both operands of the current-minus-habitual step ledger. The
 * habitual reference's unresolved overlap is reported even when every current day's overlap is known (a fully described
 * current week cannot certify a symmetric baseline); it depends only on the compiled days and the profile, so full or subset
 * series masks and resumed runs report the same. Allocation allowed (finalize).
 */
export function stepsOverlapAssumptions(days: readonly DayInput[], pr: ResolvedProfile): StepsOverlapDisclosure {
  let current: StepsOverlapDisclosure['current'] = 'none';
  for (const day of days) {
    if (!(day.steps > 0)) continue;
    const st = stepsOverlapStatus(day.stepsScope, daySessionIncludedSteps(day), hasLocomotorSession(day));
    if (st === 'unknown') {
      current = 'unknown';
      break;
    }
    if (st === 'known') current = 'known';
  }
  const reference = days.length > 0 ? habitualStepsOverlapStatus(pr) : 'none';
  const assumptions: StepsOverlapDisclosure['assumptions'] = [];
  if (current === 'unknown') assumptions.push(STEPS_OVERLAP_UNKNOWN);
  if (reference === 'unknown') assumptions.push(HABITUAL_STEPS_OVERLAP_UNKNOWN);
  return { assumptions, current, reference };
}

/** Clock hour at which the day's first resistance session ends (99 when the day has none). */
export function firstRtEndH(day: DayInput): number {
  let firstRtEnd = 99;
  for (let i = 0; i < day.nSessions; i++) {
    const sess = day.sessions[i]!;
    if (sess.kind !== 'resistance' || !(sess.durationMin > 0)) continue;
    const end = sess.startH + sess.durationMin / 60;
    if (end < firstRtEnd) firstRtEnd = end;
  }
  return firstRtEnd;
}

/**
 * The activity module's run constants for `profile` under the parameter vector `p` (what `prepare` returns). Exported so
 * that the schedule compiler can estimate planned exercise energy exactly as this module books it (R-MAINT,
 * `core/activityReference.ts`). Allocation allowed (called once per run / per compile).
 */
export function activityConstants(p: ModelParams, pr: ResolvedProfile): ActivityModK {
  const g = (n: string): number => param(p, `activity.${n}`);
  const habits = pr.habits;
  const defaultX = new Float64Array(8);
  for (const key of Object.keys(CARDIO_MODALITY_CODE) as (keyof typeof CARDIO_MODALITY_CODE)[]) defaultX[CARDIO_MODALITY_CODE[key]] = DEFAULTS.cardioPctVo2max[key];
  const trainYears =
    habits.trainingHistory === 'gt3y'
      ? g('trainYearsGt3y')
      : habits.trainingHistory === '1to3y'
        ? g('trainYears1to3y')
        : habits.trainingHistory === 'lt1y'
          ? g('trainYearsLt1y')
          : 0;
  const femaleAdj = pr.input.sexUnspecified ? 0.5 * (1 + g('vo2SexF')) : pr.sex === 'female' ? g('vo2SexF') : 1;
  const base: ActivityK = {
    kcalPerL: g('kcalPerLO2'),
    metVo2: g('metVo2'),
    walkA: g('walkIntercept'),
    walkB: g('walkSlope'),
    runVo2PerM: g('runVo2PerM'),
    runEff: g('runEff'),
    obesityFactor: g('obesityWalkFactor'),
    obesityBmi: g('obesityBmi'),
    cycleBase: g('cycleBaselineMult'),
    cycleEff: g('cycleEff'),
    stepsNet: g('stepsNet'),
    displaced: g('displacedBaseline'),
    rtMetDefault: g('rtMetDefault'),
    habitCardioMet: g('habitCardioMet'),
    rpeA: g('rpeIntercept'),
    rpeB: g('rpeSlope'),
    activeMuscleFrac: g('activeMuscleFrac'),
    epocPhiMax: g('epocPhiMax'),
    epocPhiMaxInt: g('epocPhiMaxInterval'),
    epocPhiFloor: g('epocPhiFloor'),
    epocMidX: g('epocMidX'),
    epocSlopeX: g('epocSlopeX'),
    epocDurRef: g('epocDurRefMin'),
    epocDurExp: g('epocDurExp'),
    epocRt: g('epocRt'),
    epocLightX: g('epocLightX'),
    epocTauLight: g('epocTauLightH'),
    epocTau1: g('epocTau1H'),
    epocTau2: g('epocTau2H'),
    epocFastShare: g('epocFastShare'),
    epocTrainedMult: g('epocTrainedTauMult'),
    epocTrainedSpan: g('epocTrainedIdxSpan'),
    postRtRee: g('postRtRee'),
    postRtHours: g('postRtHours'),
    postRtShield: g('postRtTsShield'),
    jacksonA: g('jacksonIntercept'),
    jacksonPar: g('jacksonPar'),
    jacksonAge: g('jacksonAge'),
    jacksonBmi: g('jacksonBmi'),
    jacksonSex: g('jacksonSex'),
    par1: g('parSedentary'),
    par2: g('parLight'),
    par3: g('parModerate'),
    par4: g('parActive'),
    par5: g('parVeryActive'),
    gMax: g('vo2GMax'),
    memHalf: g('vo2MemHalf'),
    gCap: g('vo2GCap'),
    sexF: femaleAdj,
    z: responsiveness(g('vo2ResponseU'), g('vo2ZSd'), g('vo2ZMin'), g('vo2ZMax')),
    riseF: 1 - Math.exp(-1 / g('vo2TauF')),
    riseS: 1 - Math.exp(-1 / g('vo2TauS')),
    tauDn: g('vo2TauDn'),
    fastShare: g('vo2FastShare'),
    rhoMax: g('vo2RhoMax'),
    rhoYears: g('vo2RhoYears'),
    hiRef: g('vo2HiRefMinWk'),
    detrainShield: g('vo2DetrainShield'),
    trainYears,
    memBand1: g('memBand1'),
    memBand2: g('memBand2'),
    memBand3: g('memBand3'),
    memW1: g('memW1'),
    memW2: g('memW2'),
    memW3: g('memW3'),
    hardX: g('hardX'),
    mcMax: g('mitoMcMax'),
    mcHalf: g('mitoMemHalf'),
    mcRiseF: 1 - Math.exp(-1 / g('mitoTauUpC')),
    mcFallF: 1 - Math.exp(-1 / g('mitoTauDnC')),
    mrAmp: g('mitoMrAmp'),
    mrRiseF: 1 - Math.exp(-1 / g('mitoTauUpR')),
    mrFallF: 1 - Math.exp(-1 / g('mitoTauDnR')),
    aerobicRef: g('aerobicIdxRefKcalD'),
    defaultX,
  };
  // habitual exercise (core/resolveProfile convention: sessions/wk · (MET − 1) · BW / 7, RT 4.0 MET, cardio 5.0 MET)
  const perWk = habits.sessionsPerWeek;
  const mix = habits.lifingCardioMix;
  const w = pr.weightKg;
  const genericRt = perWk * (1 - mix);
  const genericCardio = habits.habitualCardio ? 0 : perWk * mix;
  const documentedCardioMin = habits.habitualCardio
    ? habits.habitualCardio.sessionsPerWeek * habits.habitualCardio.minutesPerSession
    : 0;
  const documentedCardioNet = (documentedCardioMin * (DOCUMENTED_CYCLE_MET - 1) * w) / (60 * 7);
  const eatHab = (genericRt * (HABIT_RT_MET - 1) * w + genericCardio * (base.habitCardioMet - 1) * w) / 7 + documentedCardioNet;
  const cardioNetHab = (genericCardio * (base.habitCardioMet - 1) * w) / 7 + documentedCardioNet;
  const heightM = pr.heightM;
  const bmi0 = w / (heightM * heightM);
  // VO2max: measured, else Jackson non-exercise equation with PA-R from the 10 §4.14 selector row nearest to habitual
  // steps — or, with an activity intake, nearest to PAL0 (R1 §3.4, MODEL_SPEC §5.5; `core/resolveProfile.selectorIndexFor`)
  let v0 = pr.labs.vo2maxMlKgMin ?? Number.NaN;
  if (!(v0 > 0)) {
    const bi = selectorIndexFor(pr);
    const par = bi === 0 ? base.par1 : bi === 1 ? base.par2 : bi === 2 ? base.par3 : bi === 3 ? base.par4 : base.par5;
    const male = pr.input.sexUnspecified ? 0.5 : pr.sex === 'male' ? 1 : 0;
    v0 = jacksonVo2max(male, pr.ageYears, bmi0, par, base);
  }
  v0 = v0 < 10 ? 10 : v0 > 90 ? 90 : v0;
  // Habitual MEM per week: legacy cardio plus the documented cycle dose at the model's assumed MET.
  const documentedCycleGrossKcalMin = (DOCUMENTED_CYCLE_MET * 1.05 * w) / 60;
  const documentedCycleX = vo2FromKcalPerMin(documentedCycleGrossKcalMin, w, base.kcalPerL) / v0;
  const memHabWk = genericCardio * 60 * memWeight(defaultX[CARDIO_MODALITY_CODE.other]!, base)
    + documentedCardioMin * memWeight(documentedCycleX, base);
  // D3-08: one resistance recovery mechanism per bout — the finite budget (epocRt) and the Heden rectangle (postRtRee) are
  // alternative decompositions of the same recovery, never booked together; both are 0 in production (every draw)
  let rtRecoveryMode: RtRecoveryMode = 'none';
  if (base.epocRt > 0) {
    rtRecoveryMode = 'budget';
    base.postRtRee = 0;
  } else if (base.postRtRee > 0) rtRecoveryMode = 'legacyRectangle';
  // D3-07/A1-040: the habitual step count in the step ledger, by the same scope rule as a day, with the habitual sessions'
  // included steps when known; unknown = the named no-subtraction reference scenario (`habitualStepsOverlapStatus`)
  const habSteps = habits.typicalSteps;
  const habRef = habitualStepsReference(pr);
  const habStepsLedger = stepLedgerSteps(habSteps, habRef.scope, habRef.includedSteps);
  return {
    ...base,
    bw0: w,
    heightM,
    invH2: 1 / (heightM * heightM),
    rmr0H: pr.rmr0Kcal / 24,
    habSteps,
    smmActiveKg: base.activeMuscleFrac * pr.body.skeletalMuscleKg,
    rho: retentionRho(trainYears, base),
    isFemaleAdj: femaleAdj,
    eatHabKcalD: eatHab,
    cardioNetHabKcalD: cardioNetHab,
    memHabWk,
    v0,
    habStepsLedger,
    health: {
      relModerateMin: g('healthRelModerateMin'),
      relVigorousMin: g('healthRelVigorousMin'),
      absModerateMet: g('healthAbsModerateMet'),
      absVigorousMet: g('healthAbsVigorousMet'),
      vigorousWeight: g('healthVigorousWeight'),
    },
    rtRecoveryMode,
  };
}

const activityCore = defineModule<ActivityState, ActivityModK>({
  id: 'activity',
  specSection: '§1.2',
  dossiers: '10 §4.1-4.2, §4.8-4.9, §4.13-4.14, §4.17; 09 §4.13',
  params: ACTIVITY_PARAMS,
  // declared reads = the signals actually used (the §4 readers column also lists muscleGlycogenRel and ketoAdaptFast for
  // activity; neither is used — pending pruning by the core owner, CONTRACT_REQUESTS 2026-09-30 B)
  reads: ['tissueMassKg', 'trainingStatus', 'scaleWeightKg', 'rmrKcalH'],
  writes: [
    'exEEKcalH',
    'exSessionNetKcalH',
    'stepsExtraKcalH',
    'exIntensityFrac',
    'exMinutesH',
    'exActiveMuscleKg',
    'exHardSession',
    'vo2maxMlKgMin',
    'mitoRel',
    'exPlannedKcalD',
    'aerobicIdx',
    'exSessionNetKcalD',
  ],
  records: ['vo2max', 'exerciseEE', 'exerciseEnergy', 'stepsEnergy'],

  prepare: (ctx: ModuleContext): ActivityModK => activityConstants(ctx.params, ctx.profile),

  init: (k: ActivityModK, _ctx: ModuleContext, bus: SignalBus): ActivityState => {
    // equilibrium of the habitual dose: g* at MEM_hab; vSed chosen so that VO2max0 = vSed·(1 + g*)
    const gStar = vo2GainTarget(k.memHabWk, k);
    const vSed = k.v0 / (1 + gStar);
    const mC = mitoContentTarget(k.memHabWk, k);
    const mR = mitoRespTarget(0, k);
    const memDay = k.memHabWk / 7;
    const eeRing = new Float64Array(7).fill(k.eatHabKcalD);
    const carRing = new Float64Array(7).fill(k.cardioNetHabKcalD);
    const memRing = new Float64Array(7).fill(memDay);
    const s: ActivityState = {
      vo2max: k.v0,
      vo2FastPool: k.fastShare * gStar,
      vo2SlowPool: (1 - k.fastShare) * gStar,
      mem7d: k.memHabWk,
      mitoRel: 1,
      epocRemainingKcal: 0,
      epocTauH: k.epocTau1,
      postRtReeHoursLeft: 0,
      eeNetRing: eeRing,
      ringIdx: 0,
      dayNetKcal: 0,
      vSed,
      gPeak: gStar,
      hi7d: 0,
      memRing,
      hiRing: new Float64Array(7),
      cardioNetRing: carRing,
      dayMem: 0,
      dayHiMin: 0,
      dayCardioNet: 0,
      mC,
      mR,
      mPeak: mC,
      mitoIdx0: mC * mR,
      trainedTau: trainedTauFactor(mC * mR, k),
      epocFastKcal: 0,
      epocFastTauH: k.epocTau1,
      epocSlowKcal: 0,
      epocSlowTauH: k.epocTau2,
      epocFastF: Math.exp(-1 / k.epocTau1),
      epocSlowF: Math.exp(-1 / k.epocTau2),
      stepsRatio: 1,
      stepsDayZero: 0,
      wakeHoursToday: 16,
      stepsCoef: 0,
      stepsZeroCoef: 0,
      hMins: 0,
      hXw: 0,
      hNet: 0,
      hInc: 0,
      hHard: 0,
      hRt: 0,
      hCardioMins: 0,
      hCardioNet: 0,
      hMem: 0,
      hHiMin: 0,
      idleWritten: 0,
      burnInReal: 0,
      fallback: newSession(),
      phaseScratch: newSession(),
      carry: Array.from({ length: MAX_SESSIONS }, () => newSession()),
      nCarry: 0,
    };
    bus.vo2maxMlKgMin = s.vo2max;
    bus.mitoRel = 1;
    bus.exPlannedKcalD = k.eatHabKcalD;
    bus.exSessionNetKcalD = k.eatHabKcalD;
    bus.aerobicIdx = Math.min(1, k.cardioNetHabKcalD / k.aerobicRef);
    return s;
  },

  startDay: (s, k, bus, day, clock) => {
    // body mass of the day (previous hour's scale weight) → step-energy coefficients (BW changes < 0.1 %/d)
    let bw = bus.scaleWeightKg;
    if (!(bw > 0)) bw = bus.tissueMassKg > 0 ? bus.tissueMassKg : k.bw0;
    const bmi = bw * k.invH2;
    const stepK = (k.stepsNet * (bmi >= k.obesityBmi ? k.obesityFactor : 1) * bw) / 1000;
    // step baseline of the day: habitual steps distributed like the day's steps (10 §4.14). D3-07: both sides in the step
    // ledger — a total-day count loses the locomotor steps of sessions booked as sessions (their energy is in the session),
    // the habitual reference by the same rule; the reported steps are unchanged. Identical to the old form without overlap.
    const wake = 24 - day.sleepHours;
    s.wakeHoursToday = wake > 1 ? wake : 1;
    if (day.steps > 0) {
      s.stepsDayZero = 0;
      s.stepsRatio = k.habStepsLedger / day.steps;
      s.stepsCoef = (stepK * (dayLedgerSteps(day) - k.habStepsLedger)) / day.steps;
      s.stepsZeroCoef = 0;
    } else {
      s.stepsDayZero = 1;
      s.stepsRatio = 0;
      s.stepsCoef = 0;
      s.stepsZeroCoef = (-stepK * k.habStepsLedger) / s.wakeHoursToday;
    }
    s.dayNetKcal = 0;
    s.dayMem = 0;
    s.dayHiMin = 0;
    s.dayCardioNet = 0;

    // 7-day mean net cardio EE (through yesterday) → aerobicIdx for 03's M_act (provisional definition, review M14)
    let sumC = 0;
    for (let i = 0; i < 7; i++) sumC += s.cardioNetRing[i]!;
    const idx = sumC / 7 / k.aerobicRef;
    bus.aerobicIdx = idx < 0 ? 0 : idx > 1 ? 1 : idx;

    // planned exercise energy of today (at yesterday's VO2max and body mass; RMR of the previous hour)
    if (clock.day < 0 && day.nSessions === 0 && s.burnInReal === 0) {
      bus.exPlannedKcalD = k.eatHabKcalD;
      return;
    }
    const rmrH = bus.rmrKcalH > 0 ? bus.rmrKcalH : k.rmr0H;
    let est = sessionsBookedKcal(k, day, s.vo2max, bw, bmi, rmrH);
    const firstRtEnd = firstRtEndH(day);
    // post-RT REE hours falling today: carry-in of earlier sessions ∪ the remainder of today after the first RT session
    let ts = bus.trainingStatus;
    ts = ts < 0 ? 0 : ts > 1 ? 1 : ts;
    const carry = s.postRtReeHoursLeft < 24 ? s.postRtReeHoursLeft : 24;
    let hrs = carry;
    if (firstRtEnd < 24) hrs = carry >= firstRtEnd ? 24 : carry + (24 - firstRtEnd);
    est += k.postRtRee * rmrH * (1 - k.postRtShield * ts) * hrs;
    bus.exPlannedKcalD = est;
  },

  stepHour: (s, k, bus, hour, day, clock) => {
    // steps above the habitual baseline (10 §4.14): steps_h − habitual steps distributed like the day's steps
    bus.stepsExtraKcalH = s.stepsDayZero === 1 ? s.stepsZeroCoef * (1 - hour.asleep) : s.stepsCoef * hour.steps;

    // burn-in on a habitual day without explicit sessions: its exercise energy is EAT0 (habitual state held)
    if (clock.day < 0 && day.nSessions === 0 && s.burnInReal === 0) {
      const e = k.eatHabKcalD / 24;
      s.idleWritten = 0;
      bus.exEEKcalH = e;
      bus.exSessionNetKcalH = e;
      bus.exIntensityFrac = 0;
      bus.exMinutesH = 0;
      bus.exActiveMuscleKg = 0;
      bus.exHardSession = 0;
      return;
    }

    // hour without exercise (the common case): only the EPOC queue and the post-RT elevation can contribute
    if (hour.exMin <= 0) {
      let ee = 0;
      if (s.epocFastKcal !== 0 || s.epocSlowKcal !== 0) {
        if (s.epocFastKcal > 1e-6) {
          const r = s.epocFastKcal * (1 - s.epocFastF);
          s.epocFastKcal -= r;
          ee += r;
        } else s.epocFastKcal = 0;
        if (s.epocSlowKcal > 1e-6) {
          const r = s.epocSlowKcal * (1 - s.epocSlowF);
          s.epocSlowKcal -= r;
          ee += r;
        } else s.epocSlowKcal = 0;
        s.epocRemainingKcal = s.epocFastKcal + s.epocSlowKcal;
        s.epocTauH = s.epocRemainingKcal > 0 ? (s.epocFastKcal * s.epocFastTauH + s.epocSlowKcal * s.epocSlowTauH) / s.epocRemainingKcal : k.epocTau1;
      }
      if (s.postRtReeHoursLeft > 0) {
        let ts = bus.trainingStatus;
        ts = ts < 0 ? 0 : ts > 1 ? 1 : ts;
        ee += k.postRtRee * (bus.rmrKcalH > 0 ? bus.rmrKcalH : k.rmr0H) * (1 - k.postRtShield * ts);
        s.postRtReeHoursLeft -= 1;
      }
      bus.exEEKcalH = ee;
      if (s.idleWritten === 0) {
        bus.exSessionNetKcalH = 0;
        bus.exIntensityFrac = 0;
        bus.exMinutesH = 0;
        bus.exActiveMuscleKg = 0;
        bus.exHardSession = 0;
        s.idleWritten = 1;
      }
      return;
    }
    s.idleWritten = 0;
    const h = clock.hourOfDay;
    let bw = bus.scaleWeightKg;
    if (!(bw > 0)) bw = bus.tissueMassKg > 0 ? bus.tissueMassKg : k.bw0;
    const rmrH = bus.rmrKcalH > 0 ? bus.rmrKcalH : k.rmr0H;
    const rmrMin = rmrH / 60;
    const bmi = bw * k.invH2;

    // EPOC release from the queue (exact exponentials, before this hour's new EPOC is queued)
    let epocRel = 0;
    if (s.epocFastKcal > 1e-6) {
      const r = s.epocFastKcal * (1 - s.epocFastF);
      s.epocFastKcal -= r;
      epocRel += r;
    } else s.epocFastKcal = 0;
    if (s.epocSlowKcal > 1e-6) {
      const r = s.epocSlowKcal * (1 - s.epocSlowF);
      s.epocSlowKcal -= r;
      epocRel += r;
    } else s.epocSlowKcal = 0;

    // post-RT REE elevation (09 §4.13): applies to the 72 h after the last RT hour, not additive
    let postRt = 0;
    if (s.postRtReeHoursLeft > 0 && !(hour.rtSetsTotal > 0)) {
      let ts = bus.trainingStatus;
      ts = ts < 0 ? 0 : ts > 1 ? 1 : ts;
      postRt = k.postRtRee * rmrH * (1 - k.postRtShield * ts);
    }

    // sessions overlapping this hour
    s.hMins = 0;
    s.hXw = 0;
    s.hNet = 0;
    s.hInc = 0;
    s.hHard = 0;
    s.hRt = 0;
    s.hCardioMins = 0;
    s.hCardioNet = 0;
    s.hMem = 0;
    s.hHiMin = 0;
    let covered = 0;
    for (let i = 0; i < day.nSessions; i++) {
      const sess = day.sessions[i]!;
      const mins = overlapH(sess.startH, sess.startH + sess.durationMin / 60, h, h + 1) * 60;
      if (mins <= 1e-9) continue;
      covered += mins;
      accumulateSession(s, k, sess, h, bw, rmrMin, bmi, clock.day < 0);
    }
    // A1-021: the previous day's sessions continued past midnight, with their own descriptors and phase time line
    for (let i = 0; i < s.nCarry; i++) {
      const sess = s.carry[i]!;
      const mins = overlapH(sess.startH, sess.startH + sess.durationMin / 60, h, h + 1) * 60;
      if (mins <= 1e-9) continue;
      covered += mins;
      accumulateSession(s, k, sess, h, bw, rmrMin, bmi, clock.day < 0);
    }
    if (covered === 0) {
      const fb = s.fallback;
      fb.kind = hour.rtSetsTotal > 0 ? 'resistance' : 'cardio';
      fb.modality = hour.exModality;
      fb.intensityFrac = hour.exIntensityFrac > 0 ? hour.exIntensityFrac : Number.NaN;
      fb.met = hour.exMet > 0 ? hour.exMet : Number.NaN;
      fb.durationMin = hour.exMin;
      fb.toFailure = hour.rtToFailure > 0;
      accumulatePart(s, k, fb, hour.exMin, fb.durationMin, fb.modality === CARDIO_MODALITY_CODE.hiit, bw, rmrMin, bmi, clock.day < 0);
    }
    if (s.hRt === 1) s.postRtReeHoursLeft = k.postRtHours;
    else if (s.postRtReeHoursLeft > 0) s.postRtReeHoursLeft -= 1;

    bus.exEEKcalH = s.hInc + epocRel + postRt;
    bus.exSessionNetKcalH = s.hNet;
    bus.exIntensityFrac = s.hMins > 0 ? s.hXw / s.hMins : 0;
    bus.exMinutesH = s.hMins;
    bus.exActiveMuscleKg = s.hCardioMins > 0 ? k.smmActiveKg : 0;
    bus.exHardSession = s.hHard;
    s.dayNetKcal += s.hNet;
    s.dayCardioNet += s.hCardioNet;
    s.dayMem += s.hMem;
    s.dayHiMin += s.hHiMin;
    s.epocRemainingKcal = s.epocFastKcal + s.epocSlowKcal;
    s.epocTauH = s.epocRemainingKcal > 0 ? (s.epocFastKcal * s.epocFastTauH + s.epocSlowKcal * s.epocSlowTauH) / s.epocRemainingKcal : k.epocTau1;
  },

  endOfDay: (s, k, bus, day, clock) => {
    // A1-021: sessions running past this midnight continue in tomorrow's hours with their own time line
    let nc = 0;
    for (let i = 0; i < day.nSessions && nc < MAX_SESSIONS; i++) {
      const sess = day.sessions[i]!;
      if (sess.durationMin > 0 && sess.startH + sess.durationMin / 60 > 24 + 1e-9) carryInto(s.carry[nc++]!, sess);
    }
    s.nCarry = nc;
    // today's total session net EE for daily consumers (wellbeing's EA, review m10); a burn-in day without explicit
    // sessions carried the habitual EAT0 spread over the hours (see stepHour)
    bus.exSessionNetKcalD = clock.day < 0 && day.nSessions === 0 && s.burnInReal === 0 ? k.eatHabKcalD : s.dayNetKcal;
    if (clock.day < 0) {
      // burn-in: pools and mitochondria stay at their equilibrium; the rings follow real habitual sessions once seen
      if (day.nSessions > 0) s.burnInReal = 1;
      if (s.burnInReal === 1) pushDayToRings(s);
      s.dayNetKcal = 0;
      s.dayMem = 0;
      s.dayHiMin = 0;
      s.dayCardioNet = 0;
      if (clock.day === -1 && s.burnInReal === 1) anchorToHabitualDose(s, k, bus);
      return;
    }
    // rings and rolling 7-day sums
    pushDayToRings(s);
    const mem = s.mem7d;
    const hi = s.hi7d;

    // VO2max: two-pool relaxation toward g*(MEM); detraining slowed by high-intensity maintenance (10 §4.8C)
    const m0 = hi / k.hiRef;
    const m = m0 < 1 ? m0 : 1;
    const fallF = 1 - Math.exp(-((1 - k.detrainShield * m) / k.tauDn));
    const gStar = vo2GainTarget(mem, k);
    const fs = k.fastShare;
    s.vo2FastPool = updateGainPool(s.vo2FastPool, fs * gStar, k.riseF, fallF, k.rho * fs * s.gPeak);
    s.vo2SlowPool = updateGainPool(s.vo2SlowPool, (1 - fs) * gStar, k.riseS, fallF, k.rho * (1 - fs) * s.gPeak);
    const gTot = s.vo2FastPool + s.vo2SlowPool;
    if (gTot > s.gPeak) s.gPeak = gTot;
    const v = s.vSed * (1 + gTot);
    s.vo2max = v < 8 ? 8 : v > 90 ? 90 : v;

    // mitochondrial oxidative capacity (10 §4.9): content by aerobic volume, respiration by high-intensity minutes
    const mcStar = mitoContentTarget(mem, k);
    const floorC = 1 + k.rho * (s.mPeak - 1);
    if (mcStar >= s.mC) s.mC += (mcStar - s.mC) * k.mcRiseF;
    else s.mC += ((mcStar > floorC ? mcStar : floorC) - s.mC) * k.mcFallF;
    const mrStar = mitoRespTarget(hi, k);
    s.mR += (mrStar - s.mR) * (mrStar >= s.mR ? k.mrRiseF : k.mrFallF);
    if (s.mC > s.mPeak) s.mPeak = s.mC;
    const idx = s.mC * s.mR;
    s.trainedTau = trainedTauFactor(idx, k);
    s.mitoRel = idx / s.mitoIdx0;

    bus.vo2maxMlKgMin = s.vo2max;
    bus.mitoRel = s.mitoRel;
    s.dayNetKcal = 0;
    s.dayMem = 0;
    s.dayHiMin = 0;
    s.dayCardioNet = 0;
  },

  recordHour: (_s, _k, bus, out) => {
    out[MI.exerciseEE] = bus.exEEKcalH;
    // SPEC V1.1: the booked hourly components for the energy-day display (same values as the ledger reads; no new equation)
    out[MI.exerciseEnergy] = bus.exEEKcalH;
    out[MI.stepsEnergy] = bus.stepsExtraKcalH;
  },

  recordDay: (s, _k, _bus, out) => {
    out[MI.vo2max] = s.vo2max;
  },
});

/**
 * Hook-aware signal declarations (D8-07, C7; checked by `checkSignalHooks`). Activity runs second (after moderators), so
 * every value it reads in startDay/stepHour was written in an earlier step (lag 1): water's scale weight and energy's RMR
 * in the previous hour, composition's tissue mass in the previous hour, muscle's training status the previous endOfDay.
 * The daily session net EE is written in endOfDay, which wellbeing reads later in the same endOfDay (lag 0).
 */
const ACTIVITY_SIGNAL_HOOKS: readonly SignalHookDecl[] = [
  ...(['vo2maxMlKgMin', 'mitoRel', 'exSessionNetKcalD'] as const).flatMap((signal) => [
    { signal, access: 'write', hook: 'init' } as const,
    { signal, access: 'write', hook: 'endOfDay' } as const,
  ]),
  ...(['exPlannedKcalD', 'aerobicIdx'] as const).flatMap((signal) => [
    { signal, access: 'write', hook: 'init' } as const,
    { signal, access: 'write', hook: 'startDay' } as const,
  ]),
  ...(['exEEKcalH', 'exSessionNetKcalH', 'stepsExtraKcalH', 'exIntensityFrac', 'exMinutesH', 'exActiveMuscleKg', 'exHardSession'] as const).map(
    (signal) => ({ signal, access: 'write', hook: 'stepHour' }) as const,
  ),
  ...(['scaleWeightKg', 'tissueMassKg', 'rmrKcalH', 'trainingStatus'] as const).flatMap((signal) => [
    { signal, access: 'read', hook: 'startDay', lag: 1 } as const,
    { signal, access: 'read', hook: 'stepHour', lag: 1 } as const,
  ]),
];

/** The activity module with its hook-aware signal declarations (`defineModule` does not forward `signalHooks`). */
export const activityModule: EngineModule<ActivityState, ActivityModK> = { ...activityCore, signalHooks: ACTIVITY_SIGNAL_HOOKS };

export { ACTIVITY_PARAMS } from './params';
export {
  cycleGrossKcalPerMin,
  epocPhi,
  healthClassFromMet,
  healthClassFromRelativeEffort,
  healthClassFromTalkTest,
  healthEquivalentMinutes,
  jacksonVo2max,
  memWeight,
  mitoContentTarget,
  mitoRespTarget,
  normInv,
  recoveryKernel,
  realisedEngineDose,
  realisedSessionMet,
  REALISED_DOSE_VERSION,
  REALISED_KCAL_PER_KG_H_PER_MET,
  type RealisedBout,
  type RealisedDose,
  type RealisedSegment,
  recoveryKernelIntegral,
  responsiveness,
  retentionRho,
  rpeToX,
  runNetVo2,
  sessionGrossKcalPerMin,
  trainedTauFactor,
  updateGainPool,
  vo2GainTarget,
  walkNetVo2,
  type ActivityK,
  type HealthClassK,
} from './equations';
