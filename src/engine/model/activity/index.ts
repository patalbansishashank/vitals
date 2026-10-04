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
 */
import { defineModule } from '../../core/moduleKit';
import { param } from '../../core/paramsRegistry';
import { selectorIndexFor } from '../../core/resolveProfile';
import { DEFAULTS } from '../../core/defaults';
import { CARDIO_MODALITY_CODE, N_REGIONS } from '../../types/inputs';
import type { DayInput, SessionResolved } from '../../types/inputs';
import { MI } from '../../types/metrics';
import type { ModuleContext } from '../../types/module';
import type { ModelParams } from '../../types/params';
import type { ResolvedProfile } from '../../types/profile';
import type { SignalBus } from '../../types/signals';
import { ACTIVITY_PARAMS } from './params';
import {
  epocPhi,
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
} from './equations';

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
  };
}

/**
 * Accumulate one session's contribution to this hour into the state scratch and the EPOC queue (no allocation).
 * `burn` = a burn-in (habitual-week) day: the habitual cardio sessions of `habitualWeek` carry no intensity and are
 * entered at the Compendium 5.0 MET that TDEE0's EAT0 assumes, which is < 40 % VO2max (MEM weight 0) for fit people; for
 * the training dose (MEM, high-intensity minutes) such sessions count at the modality's default moderate intensity
 * (MODEL_SPEC §5.3 table, 10 §4.8 band midpoints) — the same assumption as the habitual MEM of `prepare` — so a habitual
 * exerciser's VO2max equilibrium carries a real training gain that detraining can lose (10 V16: −11 % at 21 d, −19 % at
 * 56 d instead of 0; integration 2026-09-30). Sessions with an explicit intensity always use it.
 */
function accumulateSession(s: ActivityState, k: ActivityModK, sess: SessionResolved, mins: number, bw: number, rmrMin: number, bmi: number, burn: boolean): void {
  const gross = sessionGrossKcalPerMin(k, sess, s.vo2max, bw, k.heightM, rmrMin, bmi);
  // relative intensity: the stated work intensity when given, else the one implied by the gross cost
  let x = sess.kind !== 'resistance' && sess.intensityFrac > 0 ? sess.intensityFrac : vo2FromKcalPerMin(gross, bw, k.kcalPerL) / s.vo2max;
  if (x > 1.2) x = 1.2;
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
  // EPOC (10 §4.2): φ of the session's net cost, queued into the fast / slow components (released from the next hour)
  const add = epocPhi(x, sess.durationMin, isRt, sess.modality === CARDIO_MODALITY_CODE.hiit, k) * net;
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

/**
 * Booked energy of a day's sessions before the post-RT REE (MODEL_SPEC §1.2 step 6, the `exPlannedKcalD` estimate):
 * Σ over sessions of (net of the person's own RMR − displaced lifestyle baseline + EPOC) at the given VO2max (mL/kg/min),
 * body mass (kg), BMI and RMR (kcal/h). The single definition used by `startDay` and by the R-MAINT planned-activity
 * estimator (`core/activityReference.ts`). No allocation.
 */
export function sessionsBookedKcal(k: ActivityModK, day: DayInput, vo2max: number, bw: number, bmi: number, rmrH: number): number {
  const rmrMin = rmrH / 60;
  let est = 0;
  for (let i = 0; i < day.nSessions; i++) {
    const sess = day.sessions[i]!;
    const dur = sess.durationMin;
    if (!(dur > 0)) continue;
    const gross = sessionGrossKcalPerMin(k, sess, vo2max, bw, k.heightM, rmrMin, bmi);
    let x = sess.kind !== 'resistance' && sess.intensityFrac > 0 ? sess.intensityFrac : vo2FromKcalPerMin(gross, bw, k.kcalPerL) / vo2max;
    if (x > 1.2) x = 1.2;
    let netMin = gross - rmrMin;
    if (netMin < 0) netMin = 0;
    const net = netMin * dur;
    const isRt = sess.kind === 'resistance';
    est += net - k.displaced * rmrMin * dur + epocPhi(x, dur, isRt, sess.modality === CARDIO_MODALITY_CODE.hiit, k) * net;
  }
  return est;
}

/**
 * Aerobic training dose of a day's cardio sessions (10 §4.8, as `accumulateSession` books it on a real day): writes the
 * moderate-equivalent minutes (MEM) into `out[0]` and the minutes at x ≥ hardX into `out[1]`. For the R-MAINT
 * planned-activity estimator (VO2max trajectory). No allocation.
 */
export function dayAerobicDose(k: ActivityModK, day: DayInput, vo2max: number, bw: number, bmi: number, rmrH: number, out: Float64Array): void {
  const rmrMin = rmrH / 60;
  let mem = 0;
  let hi = 0;
  for (let i = 0; i < day.nSessions; i++) {
    const sess = day.sessions[i]!;
    const dur = sess.durationMin;
    if (!(dur > 0) || sess.kind === 'resistance') continue;
    let x = sess.intensityFrac;
    if (!(x > 0)) x = vo2FromKcalPerMin(sessionGrossKcalPerMin(k, sess, vo2max, bw, k.heightM, rmrMin, bmi), bw, k.kcalPerL) / vo2max;
    if (x > 1.2) x = 1.2;
    mem += dur * memWeight(x, k);
    if (x >= k.hardX) hi += dur;
  }
  out[0] = mem;
  out[1] = hi;
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
  const metMix = HABIT_RT_MET * (1 - mix) + base.habitCardioMet * mix;
  const eatHab = (perWk * (metMix - 1) * w) / 7;
  const cardioNetHab = (perWk * mix * (base.habitCardioMet - 1) * w) / 7;
  // habitual MEM per week: cardio sessions of 60 min at the default moderate intensity (10 §4.8 band weight)
  const memHabWk = perWk * mix * 60 * memWeight(defaultX[CARDIO_MODALITY_CODE.other]!, base);
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
  return {
    ...base,
    bw0: w,
    heightM,
    invH2: 1 / (heightM * heightM),
    rmr0H: pr.rmr0Kcal / 24,
    habSteps: habits.typicalSteps,
    smmActiveKg: base.activeMuscleFrac * pr.body.skeletalMuscleKg,
    rho: retentionRho(trainYears, base),
    isFemaleAdj: femaleAdj,
    eatHabKcalD: eatHab,
    cardioNetHabKcalD: cardioNetHab,
    memHabWk,
    v0,
  };
}

export const activityModule = defineModule<ActivityState, ActivityModK>({
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
  records: ['vo2max', 'exerciseEE'],

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
    // step baseline of the day: habitual steps distributed like the day's steps (10 §4.14)
    const wake = 24 - day.sleepHours;
    s.wakeHoursToday = wake > 1 ? wake : 1;
    if (day.steps > 0) {
      s.stepsDayZero = 0;
      s.stepsRatio = k.habSteps / day.steps;
      s.stepsCoef = stepK * (1 - s.stepsRatio);
      s.stepsZeroCoef = 0;
    } else {
      s.stepsDayZero = 1;
      s.stepsRatio = 0;
      s.stepsCoef = 0;
      s.stepsZeroCoef = (-stepK * k.habSteps) / s.wakeHoursToday;
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
      accumulateSession(s, k, sess, mins, bw, rmrMin, bmi, clock.day < 0);
    }
    if (covered === 0) {
      const fb = s.fallback;
      fb.kind = hour.rtSetsTotal > 0 ? 'resistance' : 'cardio';
      fb.modality = hour.exModality;
      fb.intensityFrac = hour.exIntensityFrac > 0 ? hour.exIntensityFrac : Number.NaN;
      fb.met = hour.exMet > 0 ? hour.exMet : Number.NaN;
      fb.durationMin = hour.exMin;
      fb.toFailure = hour.rtToFailure > 0;
      accumulateSession(s, k, fb, hour.exMin, bw, rmrMin, bmi, clock.day < 0);
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
  },

  recordDay: (s, _k, _bus, out) => {
    out[MI.vo2max] = s.vo2max;
  },
});

export { ACTIVITY_PARAMS } from './params';
export {
  cycleGrossKcalPerMin,
  epocPhi,
  jacksonVo2max,
  memWeight,
  mitoContentTarget,
  mitoRespTarget,
  normInv,
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
} from './equations';
