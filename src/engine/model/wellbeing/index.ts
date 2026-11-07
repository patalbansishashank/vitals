/**
 * MODULE wellbeing — energy availability exposure and internal drive, exploratory strength multiplier, research bone and
 * task-scoped endurance scenarios, model wellbeing concern flags, keto-induction symptoms, known nutrient exposure and the
 * archived micronutrient pattern heuristic.
 * Spec: docs/MODEL_SPEC.md §1.15 · Dossiers: 19 §4.1-4.5 (owner); 13 §4.10 (Φ_ind, single keto-flu owner); 15 §4.9
 * (micronutrient rule table). Sleep quality is the moderators module's output and resting heart rate / HRV / temperature /
 * acetone displays are not part of the v1 metric catalogue (MODEL_SPEC §2.2), so neither is computed here.
 * Owned files: src/engine/model/wellbeing/** only.
 *
 * Timing (MODEL_SPEC §3): hourly hooks only accumulate the day's intake, session exercise energy, exercise minutes and
 * glycogen; every state below updates once per day in `endOfDay` (exact first-order relaxation with precomputed
 * e^{−1/τ}) and its outputs act on the next day. Burn-in days (clock.day < 0) keep the slow states neutral, fill the
 * windows and latch the baselines that make all indices baseline-relative.
 *
 * 2026-10-18 review:
 *  - D8-04: the raw daily EA = (EI − net session EEE)/FFM_act is kept UNCLIPPED with a coverage status (planned, logged,
 *    partial, as-planned, unknown; an invalid FFM is unavailable, never 1 kg) and is what `energyAvailability` records; the
 *    clipped [−5, 70] sample and its 3-d EWMA / 7-d / 14-d windows stay the separately named internal drive (bus signals,
 *    strength, bone and concern flags). The strength penalty is an exploratory structure with a no-penalty alternative;
 *    M_EA = 1 means the habitual reference, and an impaired habitual baseline is flagged.
 *  - D8-01/D8-08: known nutrient exposure (calcium included) is taken from the shared ledger every day, independent of the
 *    recording mask; only display-only work (pattern score, research bone, endurance index) is skipped when unrecorded.
 *  - D8-05: BMD is a research scenario (persistent tissue loss, no RT-set protection, no calcium multiplier, no automatic
 *    recovery), never a personal forecast.
 *  - D8-09: the endurance index is task-scoped (glycogen-limited cycling TTE near 75 % VO2max); the mood tier is the model
 *    concern rubric with transparent flags, combined with observed wellbeing outside the engine (`combineWellbeingConcern`).
 */
import { defineModule } from '../../core/moduleKit';
import * as math from '../../core/math';
import { ATWATER } from '../../core/defaults';
import { EXPOSURE_UNITS } from '@/lib/bodyContracts';
import { MI } from '../../types/metrics';
import type { EngineModule, ModuleContext, SignalHookDecl, StepClock } from '../../types/module';
import type { SignalBus } from '../../types/signals';
import type { DayInput, HourInput } from '../../types/inputs';
import { wellbeingParams } from './params';
import { RING_CAP, buildConstants, type WellbeingConstants } from './constants';
import type { WellbeingState } from './state';
import { N_FLAGS, N_TRACKED, NUT_COV, TRACKED_IDX, TRACKED_NUTRIENTS } from './microTables';
import { evaluateMicro } from './micronutrients';
import { nutrientCoverageCode } from './dri';
import { CONCERN_FLAG } from './concerns';
import { EA_STATUS } from './outputs';
import * as eq from './equations';

export type { WellbeingState } from './state';
export type { WellbeingConstants } from './constants';
export * from './equations';
export { evaluateMicro, FLAG_AMBER, FLAG_GREEN, FLAG_RED, FLAG_YELLOW } from './micronutrients';
export { MICRO_IDX, MICRO_NUTRIENTS, N_FLAGS, N_TRACKED, NUT_COV, TRACKED_IDX, TRACKED_NUTRIENTS, type TrackedNutrient } from './microTables';
export { wellbeingParams } from './params';
export { buildConstants, RING_CAP } from './constants';
export * from './dri';
export * from './concerns';
export * from './outputs';

/**
 * Local bindings of the hot-path helpers: closure-scope constants instead of module-namespace lookups on every call
 * (keeps the daily hooks fast under the test transformer as well; identical semantics).
 */
const { clamp, relax, relax2 } = math;
const {
  ageMultiplier, bmdTarget, ctxTarget, exerciseShare, leanGate, massFactor, p1npTarget, phiInd, phiMaxFor,
  ringMean, ringPush, ringSlope, srcFactor, strengthPenalty, tte75,
} = eq;
const evaluateMicroLocal = evaluateMicro;

/** Local alias of the ring capacity (no module-namespace lookups in the daily loops). */
const ringCap = RING_CAP;
/** Energy convention of carbohydrate eaten during exercise (HourInput contract: total ingested = kcal + 4·exCarbG). */
const EX_CARB_KCAL_PER_G = ATWATER.carb;
const nTracked = N_TRACKED;
const tracked = TRACKED_NUTRIENTS;
const caSlot = TRACKED_IDX.calcium;

/**
 * D8-04 coverage status of a day's EA exposure (`EA_STATUS`), allocation-free. Prescribed days carry no coverage map
 * (planned scenario input); on a realised day unlogged intake is `unknown` (never an observed zero), partly logged intake
 * or missing exercise coverage is `partial`, an as-planned replay is `asPlanned`.
 */
function eaCoverageStatus(day: DayInput): number {
  const cov = day.coverage;
  if (cov === undefined) return EA_STATUS.planned;
  const ce = cov.energy;
  const cx = cov.exercise;
  if (ce === undefined || ce === 'unknown') return EA_STATUS.unknown;
  if (ce === 'partial' || cx === undefined || cx === 'unknown' || cx === 'partial') return EA_STATUS.partial;
  if (ce === 'asPlannedEstimate' || cx === 'asPlannedEstimate') return EA_STATUS.asPlanned;
  return EA_STATUS.logged;
}

/** Ledger keys of the supplement actives of each tracked nutrient (`active:<id>`, written by the compiler, D7-04/C3). */
const ACTIVE_KEYS: readonly string[] = TRACKED_NUTRIENTS.map((id) => `active:${id}`);
/** Canonical unit of each tracked nutrient (`EXPOSURE_UNITS`), mg per unit (all tracked units are masses). */
const CANON_MG: Float64Array = Float64Array.from(TRACKED_NUTRIENTS.map((id) => massUnitMg(EXPOSURE_UNITS[id])));

/** mg per unit of a mass unit string, NaN for anything else (mmol, IU, kcal…: not convertible by mass). */
function massUnitMg(unit: string): number {
  switch (unit) {
    case 'g':
      return 1000;
    case 'mg':
      return 1;
    case 'ug':
    case 'µg':
    case 'mcg':
      return 0.001;
    default:
      return Number.NaN;
  }
}

/** Known amount of the tracked nutrient's day entry, set by `trackedDayCoverage` (allocation-free return slot). */
let trackedDayValue = 0;

/**
 * D8-08/C3: coverage code (`NUT_COV`) of tracked nutrient `n` on a day, with its known amount in `trackedDayValue`
 * (canonical unit). Total intake = the food entry (`exposure[id]`) + the supplement actives of the same identity
 * (`exposure['active:<id>']`, converted by mass from its own unit; the two sources are disjoint in the ledger). Complete
 * only when every present source is complete; any known part with an unknown/partial other part is a partial lower bound;
 * an active whose unit is not a mass is an unknown contribution (never zero, never credited). Allocation-free.
 */
function trackedDayCoverage(ex: DayInput['exposure'], n: number, realised: boolean): number {
  const food = ex === undefined ? undefined : ex[tracked[n]!];
  const act = ex === undefined ? undefined : ex[ACTIVE_KEYS[n]!];
  const fc = nutrientCoverageCode(food?.coverage, realised);
  const fv = food !== undefined && fc !== NUT_COV.unknown && fc !== NUT_COV.confirmedZero ? food.knownSum : 0;
  if (act === undefined) {
    trackedDayValue = fv;
    return fc;
  }
  const f = massUnitMg(act.unit) / CANON_MG[n]!;
  const ac = f > 0 ? nutrientCoverageCode(act.coverage, realised) : NUT_COV.unknown;
  const av = ac !== NUT_COV.unknown && ac !== NUT_COV.confirmedZero ? act.knownSum * f : 0;
  if (!realised) {
    // a planned supplement alone is not planned total intake: without planned food amounts the day stays unknown
    trackedDayValue = fv + av;
    return fc === NUT_COV.unknown ? NUT_COV.unknown : NUT_COV.planned;
  }
  const fFull = fc === NUT_COV.complete || fc === NUT_COV.confirmedZero;
  const aFull = ac === NUT_COV.complete || ac === NUT_COV.confirmedZero;
  const fKnown = fFull || fc === NUT_COV.partial;
  const aKnown = aFull || ac === NUT_COV.partial;
  trackedDayValue = (fKnown ? fv : 0) + (aKnown ? av : 0);
  if (fFull && aFull) return fc === NUT_COV.confirmedZero && ac === NUT_COV.confirmedZero ? NUT_COV.confirmedZero : NUT_COV.complete;
  if (fKnown || aKnown) return NUT_COV.partial;
  return fc === NUT_COV.asPlanned || ac === NUT_COV.asPlanned ? NUT_COV.asPlanned : NUT_COV.unknown;
}

/**
 * D8-01/D8-08: push the day's KNOWN amounts of the tracked exposures from the shared ledger (`DayInput.exposure`, C3: food
 * plus supplement actives of the same identity) with their coverage, keep the per-nutrient window totals incrementally
 * (the day leaving the window is subtracted before it is overwritten) and mirror the calcium summary. Runs every real day
 * whatever the recording mask. Allocation-free, O(1).
 */
function pushNutrientExposure(s: WellbeingState, k: WellbeingConstants, day: DayInput): void {
  const win = k.nutWindow;
  const h = s.nutIdx + 1 >= ringCap ? 0 : s.nutIdx + 1;
  // with a full window the oldest day leaves it (when the window equals the ring, that is the slot about to be overwritten)
  const leave = s.nutDays >= win ? (h - win + ringCap) % ringCap : -1;
  const realised = day.coverage !== undefined;
  const ex = day.exposure;
  const kRing = s.nutKnownRing;
  const cRing = s.nutCovRing;
  for (let n = 0; n < nTracked; n++) {
    if (leave >= 0) {
      const ls = n * ringCap + leave;
      const lc = cRing[ls]!;
      if (lc === NUT_COV.complete || lc === NUT_COV.confirmedZero) {
        s.nutCompleteSum[n] = s.nutCompleteSum[n]! - kRing[ls]!;
        s.nutCompleteDays[n] = s.nutCompleteDays[n]! - 1;
        if (s.nutCompleteDays[n] === 0) s.nutCompleteSum[n] = 0;
      } else if (lc === NUT_COV.partial) s.nutPartialDays[n] = s.nutPartialDays[n]! - 1;
    }
    const code = trackedDayCoverage(ex, n, realised);
    const v = code === NUT_COV.confirmedZero ? 0 : trackedDayValue;
    const slot = n * ringCap + h;
    cRing[slot] = code;
    kRing[slot] = v;
    if (code === NUT_COV.complete || code === NUT_COV.confirmedZero) {
      s.nutCompleteSum[n] = s.nutCompleteSum[n]! + v;
      s.nutCompleteDays[n] = s.nutCompleteDays[n]! + 1;
    } else if (code === NUT_COV.partial) s.nutPartialDays[n] = s.nutPartialDays[n]! + 1;
  }
  s.nutIdx = h;
  if (s.nutDays < ringCap) s.nutDays += 1;
  const cd = s.nutCompleteDays[caSlot]!;
  s.caCompleteDays = cd;
  s.caPartialDays = s.nutPartialDays[caSlot]!;
  s.caKnownMeanMg = cd > 0 ? s.nutCompleteSum[caSlot]! / cd : 0;
}

/** Muscle glycogen concentration, g per 100 g wet muscle (G_M g ÷ (10 · SMM kg): 04 mmol/kg ww × 0.162 g/mmol ÷ 10). */
function glycogenConcentration(muscleGlycogenG: number, smmKg: number, fallback: number): number {
  return smmKg > 0.5 ? muscleGlycogenG / (10 * smmKg) : fallback;
}

function createState(k: WellbeingConstants, ctx: ModuleContext, bus: SignalBus): WellbeingState {
  const pr = ctx.profile;
  const fm = bus.fatMassKg;
  const mass = fm + bus.ffmActKg;
  const trainHr = pr.habits.sessionsPerWeek / 7;
  const s: WellbeingState = {
    eiDayKcal: 0,
    eeeDayKcal: 0,
    carbDayG: 0,
    fatDayG: 0,
    fibreDayG: 0,
    exMinDay: 0,
    endMinDay: 0,
    rtSetsDay: 0,
    muscleGlySumG: 0,
    hoursDay: 0,
    fastSeenDay: 0,

    // D8-04 exposure: before any simulated day the weight-stable prior stands in (a planned/scenario value)
    eaRawDay: k.eaT0,
    eaRawStatus: EA_STATUS.planned,
    eaRawKnownDay: k.eaT0,
    eaRawKnownIsLowerBound: 0,
    eaEiKcal: k.eiHabKcal,
    eaEeeKcal: 0,
    eaFfmKg: bus.ffmActKg,

    // 19 §2: EA_s(0) = EA(day 0); "if the user says weight-stable assume ≈ 45" (burn-in replaces the prior)
    eaS: k.eaT0,
    eeeS: 0,
    eaRing: new Float64Array(RING_CAP).fill(k.eaT0),
    eeeRing: new Float64Array(RING_CAP),
    eaIdx: 0,
    ea7: k.eaT0,
    eaC: k.eaT0,

    wRing: new Float64Array(RING_CAP).fill(bus.fatMassKg + bus.ffmActKg + bus.labileWaterKg),
    wIdx: 0,
    wBase: bus.fatMassKg + bus.ffmActKg + bus.labileWaterKg,
    tBase: mass,
    wlPct: 0,
    lossRatePctWk: 0,
    rtRing: new Uint8Array(RING_CAP),
    rtIdx: 0,
    trainHrEma: trainHr,
    endHrEma: trainHr * pr.habits.lifingCardioMix,

    p1np: 1,
    ctx: 1,
    p1npEa: 1,
    ctxEa: 1,
    p1npBase: 1,
    ctxBase: 1,
    lowChoW1: 0,
    lowChoW2: 0,
    lowCarbRun: 0,
    bmdHipPct: 0,
    bmdSpinePct: 0,

    mEa: 1,
    penBase: 0,
    eaHabBelowPolicy: 0,

    aEcon: bus.ketoAdaptFast * k.giRef,
    enduranceIdx: 100,
    gConc0: glycogenConcentration(bus.muscleGlycogenG, bus.skeletalMuscleKg, 1.75),
    wkGConcSum: 0,
    wkP1npSum: 0,
    wkCtxSum: 0,
    wkPenSum: 0,
    wkEaSum: 0,
    wkEeeSum: 0,
    wkN: 0,
    eaHab: k.eaT0,
    eeeHab: 0,
    vo2max0: bus.vo2maxMlKgMin,
    aEcon0: bus.ketoAdaptFast * k.giRef,
    fm0: fm,
    mass0: mass,

    ketoStartDay: -1,
    carbPrevG: k.carbHabG,
    phiMax: 0,
    // a habitual very-low-carbohydrate eater is already past the induction phase
    inLowCarb: k.carbHabG < k.ketoCarbThr ? 1 : 0,
    ketoInduction: 0,

    moodTier: 0,
    moodPoints: 0,
    concernFlags: 0,

    nutKnownRing: new Float64Array(N_TRACKED * RING_CAP),
    nutCovRing: new Int8Array(N_TRACKED * RING_CAP),
    nutIdx: 0,
    nutDays: 0,
    nutCompleteSum: new Float64Array(N_TRACKED),
    nutCompleteDays: new Float64Array(N_TRACKED),
    nutPartialDays: new Float64Array(N_TRACKED),
    caKnownMeanMg: 0,
    caCompleteDays: 0,
    caPartialDays: 0,

    microScore: 100,
    energyEma7: k.eiHabKcal,
    carbEma7: k.carbHabG,
    fatEma7: k.fatHabG,
    fibreEma7: k.fibreHabG,
    lowFatMealsEma7: 0,
    foodQuality: k.foodQualityHab,
    efaLowDays: 0,
    flags: new Int8Array(N_FLAGS),
    nRed: 0,
    nAmber: 0,
    caPatternMg: 0,
  };
  evaluateMicroLocal(k, s);
  return s;
}

/** Sex-blended body-fat thresholds (male 1 / female 0 / unspecified 0.5). */
function blend(sexMix: number, male: number, female: number): number {
  return sexMix * male + (1 - sexMix) * female;
}

/**
 * Bone turnover indices (scoped research identities: they do not drive BMD) and the BMD research scenario — display-only,
 * updated when `hipBmdChange` is recorded. D8-05: the BMD target follows persistent tissue loss only (water, glycogen and
 * gut content excluded via `wlPct`), credits no resistance-training protection from logged set presence, applies no
 * calcium multiplier, and does not recover automatically on regain (no validated recovery law): it only moves toward a
 * deeper target.
 */
function updateBone(s: WellbeingState, k: WellbeingConstants, bus: SignalBus, mass: number, burn: boolean): void {
  // f_EEE (19 §4.2): exercise share of the EA decrement below the person's habitual EA (habitual exercise excluded)
  const fEEE = exerciseShare(s.eeeS - s.eeeHab, s.eaS, s.eaHab);
  const srcF = srcFactor(fEEE, k.srcAtFull);
  const p1npRaw = p1npTarget(s.eaS, k.p1npDrop, k.eaT0, k.p1npWidth, k.eaRampCap, k.boneSexF, srcF);
  const ctxRaw = ctxTarget(s.eaS, k.ctxRise, k.ctxRef, k.ctxWidth, k.eaRampCap, k.boneSexF);
  if (burn) {
    // baseline-relative indices: the habitual EA defines "1.0" (19 §2: P1NP_rel relative to own baseline); endBurnIn
    // replaces the last day's value by the habitual-week mean
    s.p1npBase = p1npRaw;
    s.ctxBase = ctxRaw;
    s.wkP1npSum += p1npRaw;
    s.wkCtxSum += ctxRaw;
    s.p1npEa = 1;
    s.ctxEa = 1;
    s.p1np = 1;
    s.ctx = 1;
    s.lowChoW1 = 0;
    s.lowChoW2 = 0;
    s.lowCarbRun = 0;
    s.bmdHipPct = 0;
    s.bmdSpinePct = 0;
    return;
  }
  s.p1npEa = relax(s.p1npEa, p1npRaw / s.p1npBase, k.fB);
  s.ctxEa = relax(s.ctxEa, ctxRaw / s.ctxBase, k.fB);

  // optional low-carbohydrate term (grade C): net CHO < 0.7 g/kg/d for ≥ 7 d and training ≥ 5 h/wk
  const perKg = s.carbDayG / (mass > 1 ? mass : 1);
  s.lowCarbRun = perKg < k.lowChoCarbGPerKg ? s.lowCarbRun + 1 : 0;
  if (s.lowCarbRun >= k.lowChoDays && s.trainHrEma * 7 >= k.lowChoTrainHWk) {
    s.lowChoW1 = 1 - (1 - s.lowChoW1) * k.fLowChoUp;
    s.lowChoW2 = 1 - (1 - s.lowChoW2) * k.fLowChoUp;
  } else {
    s.lowChoW1 *= k.fLowChoP1npDecay;
    s.lowChoW2 *= k.fLowChoCtxDecay;
  }
  const p1np = s.p1npEa + k.lowChoDP1np * s.lowChoW1;
  const ctx = s.ctxEa + k.lowChoDCtx * s.lowChoW2;
  s.p1np = p1np < 0.05 ? 0.05 : p1np;
  s.ctx = ctx > 3 ? 3 : ctx;

  // BMD research scenario (19 §4.2(b), D8-05): target from persistent tissue loss; τ 120 d toward a deeper target only
  const mAge = ageMultiplier(bus.ageYears, k.menopause, k.ageStepYears, k.mAgeHigh);
  const shareLong = exerciseShare(ringMean(s.eeeRing, s.eaIdx, k.winLong) - s.eeeHab, s.eaC, s.eaHab);
  const mSrc = shareLong >= k.srcShare ? k.mSrcEx : 1;
  const tgtHip = bmdTarget(k.kHip, mAge, 1, 1, mSrc, s.wlPct);
  const tgtSpine = bmdTarget(k.kSpine, mAge, 1, 1, mSrc, s.wlPct);
  if (tgtHip < s.bmdHipPct) s.bmdHipPct = tgtHip + (s.bmdHipPct - tgtHip) * k.fBmdLoss;
  if (tgtSpine < s.bmdSpinePct) s.bmdSpinePct = tgtSpine + (s.bmdSpinePct - tgtSpine) * k.fBmdLoss;
}

/**
 * Hook-aware signal declarations (D8-07, C7): every read happens after its writer in the same pass (lag 0): activity
 * writes `exSessionNetKcalD` in its endOfDay before wellbeing's endOfDay (same-day EEE), moderators writes the sleep debt
 * in startDay. `strengthEaMult` is written in endOfDay and read by muscle, which runs EARLIER in the day order, so muscle
 * sees the previous day's value (lag 1, declared in `SIGNAL_META`).
 */
const SIGNAL_HOOKS: readonly SignalHookDecl[] = [
  ...(['eaKcalKgFfm', 'ea7KcalKgFfm', 'ketoInduction', 'strengthEaMult'] as const).flatMap((signal) => [
    { signal, access: 'write', hook: 'init' } as const,
    { signal, access: 'write', hook: 'endOfDay' } as const,
  ]),
  { signal: 'strengthEaMult', access: 'write', hook: 'endBurnIn' },
  ...(['ffmActKg', 'fatMassKg', 'labileWaterKg', 'muscleGlycogenG', 'skeletalMuscleKg', 'ketoAdaptFast', 'vo2maxMlKgMin'] as const).map(
    (signal) => ({ signal, access: 'read', hook: 'init' }) as const,
  ),
  { signal: 'muscleGlycogenG', access: 'read', hook: 'stepHour', lag: 0 },
  { signal: 'fastActive', access: 'read', hook: 'stepHour', lag: 0 },
  ...(['exSessionNetKcalD', 'ffmActKg', 'fatMassKg', 'labileWaterKg', 'skeletalMuscleKg', 'ketoAdaptFast', 'vo2maxMlKgMin', 'sleepDebtSlowH', 'ageYears'] as const).map(
    (signal) => ({ signal, access: 'read', hook: 'endOfDay', lag: 0 }) as const,
  ),
  ...(['fatMassKg', 'ffmActKg', 'labileWaterKg', 'vo2maxMlKgMin'] as const).map((signal) => ({ signal, access: 'read', hook: 'endBurnIn' }) as const),
];

const wellbeingCore = defineModule<WellbeingState, WellbeingConstants>({
  id: 'wellbeing',
  specSection: '§1.15',
  dossiers: '19 §4.1-4.5; 13 §4.10; 15 §4.9',
  params: wellbeingParams,
  // declared reads = the signals actually used; the §4 readers column lists ~25 more for wellbeing (pending pruning by
  // the core owner, CONTRACT_REQUESTS 2026-09-30 B)
  reads: [
    'exSessionNetKcalD', 'ffmActKg', 'fatMassKg', 'muscleGlycogenG', 'ketoAdaptFast', 'sleepDebtSlowH', 'labileWaterKg',
    'vo2maxMlKgMin', 'skeletalMuscleKg', 'fastActive', 'ageYears',
  ],
  writes: ['eaKcalKgFfm', 'ea7KcalKgFfm', 'ketoInduction', 'strengthEaMult'],
  records: ['moodTier', 'energyAvailability', 'hipBmdChange', 'ketoInduction', 'micronutrientScore', 'enduranceCapacity'],

  prepare: (ctx: ModuleContext): WellbeingConstants => buildConstants(ctx),

  init: (k: WellbeingConstants, ctx: ModuleContext, bus: SignalBus): WellbeingState => {
    const s = createState(k, ctx, bus);
    bus.eaKcalKgFfm = s.eaS;
    bus.ea7KcalKgFfm = s.ea7;
    bus.ketoInduction = 0;
    bus.strengthEaMult = 1;
    return s;
  },

  stepHour: (s: WellbeingState, _k: WellbeingConstants, bus: SignalBus, hour: HourInput): void => {
    s.muscleGlySumG += bus.muscleGlycogenG;
    s.hoursDay += 1;
    if (bus.fastActive > 0.5) s.fastSeenDay = 1;
    // ingested energy (C3/D6-02): signed (a reconciliation correction may be negative) and incl. carbohydrate eaten
    // during exercise, which the meal fields exclude (M8); zero hours add nothing
    s.eiDayKcal += hour.kcal + EX_CARB_KCAL_PER_G * hour.exCarbG;
    s.carbDayG += hour.carbG + hour.exCarbG;
    s.fatDayG += hour.fatG;
    s.fibreDayG += hour.fibreG;
    if (hour.exMin > 0) {
      s.exMinDay += hour.exMin;
      if (hour.rtSetsTotal > 0) s.rtSetsDay += hour.rtSetsTotal;
      else s.endMinDay += hour.exMin;
    }
  },

  endOfDay: (s: WellbeingState, k: WellbeingConstants, bus: SignalBus, day: DayInput, clock: StepClock): void => {
    const burn = clock.day < 0;
    // EEE of ruling R-EA: today's session exercise energy net of resting expenditure (EPOC, post-RT REE and steps
    // excluded) = activity's daily Σ exSessionNetKcalH, written earlier in this endOfDay pass (review m10)
    s.eeeDayKcal = bus.exSessionNetKcalD;
    if (burn && clock.day === -7) {
      s.wkGConcSum = 0;
      s.wkP1npSum = 0;
      s.wkCtxSum = 0;
      s.wkPenSum = 0;
      s.wkEaSum = 0;
      s.wkEeeSum = 0;
      s.wkN = 0;
    }
    const ffm = bus.ffmActKg;
    const fm = bus.fatMassKg;
    const mass = fm + ffm;
    const scale = mass + bus.labileWaterKg;

    // ---- 1. energy availability (19 §4.1; ruling R-EA; D8-04)
    // raw exposure: unclipped, with its coverage status; an invalid FFM denominator is unavailable (never 1 kg)
    const ffmOk = ffm > 0 && ffm < Infinity;
    s.eaEiKcal = s.eiDayKcal;
    s.eaEeeKcal = s.eeeDayKcal;
    let ea: number;
    let eeeK: number;
    if (ffmOk) {
      const raw = (s.eiDayKcal - s.eeeDayKcal) / ffm;
      const status = eaCoverageStatus(day);
      s.eaFfmKg = ffm;
      s.eaRawDay = raw;
      s.eaRawStatus = status;
      s.eaRawKnownDay = raw;
      s.eaRawKnownIsLowerBound = 0;
      if (status === EA_STATUS.partial) {
        // the known intake (observed events only, C3) bounds EA from below when exercise is covered
        const known = day.exposure === undefined ? undefined : day.exposure.energy;
        const cov = day.coverage;
        if (known !== undefined && cov !== undefined && cov.energy === 'partial') {
          s.eaRawKnownDay = (known.knownSum - s.eeeDayKcal) / ffm;
          s.eaRawKnownIsLowerBound = cov.exercise === 'complete' || cov.exercise === 'confirmedZero' ? 1 : 0;
        }
      }
      // bounded internal drive sample (legacy design operator, clipped to [floor, ceil])
      ea = clamp(raw, k.eaFloor, k.eaCeil);
      eeeK = s.eeeDayKcal / ffm;
    } else {
      // no valid denominator: the exposure is unavailable and the internal drive holds its last sample
      s.eaRawStatus = EA_STATUS.unavailable;
      s.eaRawKnownIsLowerBound = 0;
      ea = s.eaRing[s.eaIdx]!;
      eeeK = s.eeeRing[s.eaIdx]!;
    }
    s.eaS = relax(s.eaS, ea, k.fEaS);
    s.eeeS = relax(s.eeeS, eeeK, k.fEaS);
    s.eaIdx = ringPush(s.eaRing, s.eaIdx, ea);
    s.eeeRing[s.eaIdx] = eeeK;
    s.ea7 = ringMean(s.eaRing, s.eaIdx, k.winShort);
    s.eaC = ringMean(s.eaRing, s.eaIdx, k.winLong);
    if (burn) {
      s.wkEaSum += ea;
      s.wkEeeSum += eeeK;
    }
    bus.eaKcalKgFfm = s.eaS;
    bus.ea7KcalKgFfm = s.ea7;

    // ---- 2. smoothed scale weight (loss-rate concern flag) and persistent tissue loss (bone scenario, D8-05)
    if (burn) {
      s.wRing.fill(scale);
      s.wIdx = 0;
      s.wBase = scale;
      s.tBase = mass;
      s.wlPct = 0;
      s.lossRatePctWk = 0;
    } else {
      s.wIdx = ringPush(s.wRing, s.wIdx, scale);
      const wMean = ringMean(s.wRing, s.wIdx, k.weightWin);
      const wl = s.wBase > 0 ? (100 * (s.tBase - mass)) / s.wBase : 0;
      s.wlPct = wl > 0 ? wl : 0;
      s.lossRatePctWk = wMean > 0 ? (-ringSlope(s.wRing, s.wIdx, k.weightWin, k.olsSxx) * 700) / wMean : 0;
    }
    // training-load windows run through burn-in as well: the habitual burn-in week carries the user's habitual sessions
    // (MODEL_SPEC_DECISIONS B3), so the RT-presence ring and the endurance-hours EMA start from the habit
    s.trainHrEma = relax(s.trainHrEma, s.exMinDay / 60, k.fMicro);
    s.endHrEma = relax(s.endHrEma, s.endMinDay / 60, k.fMicro);
    s.rtIdx = s.rtIdx + 1 >= ringCap ? 0 : s.rtIdx + 1;
    s.rtRing[s.rtIdx] = s.rtSetsDay > 0 ? 1 : 0;

    // ---- 3. keto-induction Φ_ind (13 §4.10): trigger on the first carbohydrate-restricted eating day
    const carbDay = s.carbDayG;
    if (s.fastSeenDay === 0) {
      if (carbDay < k.ketoCarbThr) {
        if (s.inLowCarb === 0 && !burn) {
          const pm = phiMaxFor(s.carbEma7, carbDay, day.sodiumMg, k.ketoNaThrMg, k.ketoNaMitigation);
          const running = s.ketoStartDay >= 0 ? phiInd(clock.day - s.ketoStartDay, s.phiMax, k.ketoTau) : 0;
          // a re-trigger replaces the running curve only when it is stronger than the symptoms still present
          if (pm > running) {
            s.ketoStartDay = clock.day;
            s.phiMax = pm;
            s.carbPrevG = s.carbEma7;
          }
        }
        s.inLowCarb = 1;
      } else {
        s.inLowCarb = 0;
      }
    }
    if (burn || s.ketoStartDay < 0) s.ketoInduction = 0;
    else {
      const phi = phiInd(clock.day - s.ketoStartDay, s.phiMax, k.ketoTau);
      s.ketoInduction = phi > 1 ? 1 : phi;
    }
    bus.ketoInduction = s.ketoInduction;

    // ---- 4. nutrients: known exposure from the shared ledger (always, D8-01/D8-08); pattern heuristic (display only)
    const fM = k.fMicro;
    s.energyEma7 = relax(s.energyEma7, s.eiDayKcal, fM);
    s.carbEma7 = relax(s.carbEma7, carbDay, fM);
    s.fatEma7 = relax(s.fatEma7, s.fatDayG, fM);
    s.fibreEma7 = relax(s.fibreEma7, s.fibreDayG, fM);
    s.foodQuality = day.foodQuality;
    s.efaLowDays = s.fatDayG < k.efaRedG ? s.efaLowDays + 1 : 0;
    if (day.nMeals > 0 && s.eiDayKcal > 0) {
      let low = 0;
      for (let i = 0; i < day.nMeals; i++) if (day.meals[i]!.fatG < k.lowFatMealG) low++;
      s.lowFatMealsEma7 = relax(s.lowFatMealsEma7, low / day.nMeals, fM);
    }
    if (!burn) pushNutrientExposure(s, k, day);
    if (k.recMicro === 1) evaluateMicroLocal(k, s);

    // ---- 5. bone turnover and the BMD research scenario (19 §4.2; D8-05) — display only (skipped when unrecorded)
    if (k.recBone === 1) updateBone(s, k, bus, mass, burn);

    // ---- 6. strength multiplier M_EA (19 §4.3), baseline-relative; exploratory structure (D8-04)
    const bf = (100 * fm) / (mass > 1 ? mass : 1);
    const gl = leanGate(
      bf,
      blend(k.sexMix, k.leanFullM, k.leanFullF),
      blend(k.sexMix, k.leanZeroM, k.leanZeroF),
      k.leanMin,
    );
    const pen = k.strengthPenaltyOn * strengthPenalty(k.strengthA, s.eaC, k.eaT1, k.strengthWidth, k.strengthCap, gl);
    if (burn) {
      s.penBase = pen;
      s.wkPenSum += pen;
      s.mEa = 1;
    } else {
      // capped at the habitual reference: no restoration gain above an impaired baseline is asserted (deferred research)
      let tgt = (1 - pen) / (1 - s.penBase);
      if (tgt > 1) tgt = 1;
      s.mEa = relax2(s.mEa, tgt, k.fMeaOff, k.fMeaOn);
    }
    bus.strengthEaMult = s.mEa;

    // ---- 7. endurance research index (19 §4.4; D8-09): glycogen-limited cycling TTE near 75 % VO2max, % of baseline
    const hours = s.hoursDay > 0 ? s.hoursDay : 1;
    const gConc = glycogenConcentration(s.muscleGlySumG / hours, bus.skeletalMuscleKg, s.gConc0);
    const aTarget = bus.ketoAdaptFast * k.giRef;
    // A_econ follows A_fat upward at once (A_fat has its own kinetics) and recovers with τ_econ after carbohydrate restoration
    s.aEcon = aTarget >= s.aEcon ? aTarget : relax(s.aEcon, aTarget, k.fEcon);
    if (burn) {
      s.gConc0 = gConc;
      s.wkGConcSum += gConc;
      s.wkN += 1;
      s.vo2max0 = bus.vo2maxMlKgMin;
      s.aEcon0 = s.aEcon;
      s.fm0 = fm;
      s.mass0 = mass;
      s.enduranceIdx = 100;
    } else if (k.recEndurance === 1) {
      const fGly = tte75(gConc, k.tteIntercept, k.tteSlope) / tte75(s.gConc0, k.tteIntercept, k.tteSlope);
      const fEcon = (1 + k.do2Cost * s.aEcon0) / (1 + k.do2Cost * s.aEcon);
      const fAer = s.vo2max0 > 0 ? bus.vo2maxMlKgMin / s.vo2max0 : 1;
      const fMass = massFactor(s.mass0, fm - s.fm0, k.massExp);
      const idx = 100 * fGly * fEcon * fAer * fMass;
      s.enduranceIdx = idx < 0 ? 0 : idx > 300 ? 300 : idx;
    }

    // ---- 8. model wellbeing concern flags and the legacy tier rubric (19 §4.5; D8-04/D8-09): computed every day (cheap,
    // mask-independent); a guard, never a mood/cognition measurement; observed wellbeing is combined outside the engine
    let flags = 0;
    let pts = 0;
    if (s.eaC < k.eaT2) {
      flags |= CONCERN_FLAG.eaBelowT2 | CONCERN_FLAG.eaBelowT1;
      pts += k.moodPtsEaLow;
    } else if (s.eaC < k.eaT1) {
      flags |= CONCERN_FLAG.eaBelowT1;
      pts += k.moodPtsEaMid;
    }
    const r = s.lossRatePctWk;
    if (r > k.moodRateRed) {
      flags |= CONCERN_FLAG.veryRapidLoss | CONCERN_FLAG.rapidLoss;
      pts += k.moodPtsRateRed;
    } else if (r >= k.moodRateAmber) {
      flags |= CONCERN_FLAG.rapidLoss;
      pts += k.moodPtsRateAmber;
    }
    if (s.ketoInduction >= k.moodKetoThr) {
      flags |= CONCERN_FLAG.ketoSymptoms;
      pts += k.moodPtsKeto;
    }
    if (bus.sleepDebtSlowH > k.moodSleepDebtH) {
      flags |= CONCERN_FLAG.sleepDebt;
      pts += k.moodPtsSleep;
    }
    if (bf < blend(k.sexMix, k.moodBfLeanM, k.moodBfLeanF)) {
      flags |= CONCERN_FLAG.veryLean;
      pts += k.moodPtsLean;
    }
    if (s.eaHabBelowPolicy === 1) flags |= CONCERN_FLAG.impairedBaseline;
    if (s.eaRawStatus === EA_STATUS.partial || s.eaRawStatus === EA_STATUS.unknown || s.eaRawStatus === EA_STATUS.unavailable) {
      flags |= CONCERN_FLAG.exposureIncomplete;
    }
    s.concernFlags = flags;
    s.moodPoints = pts;
    s.moodTier = pts >= k.moodRedPts ? 2 : pts >= k.moodAmberPts ? 1 : 0;

    // ---- reset the running-day accumulators
    s.eiDayKcal = 0;
    s.eeeDayKcal = 0;
    s.carbDayG = 0;
    s.fatDayG = 0;
    s.fibreDayG = 0;
    s.exMinDay = 0;
    s.endMinDay = 0;
    s.rtSetsDay = 0;
    s.muscleGlySumG = 0;
    s.hoursDay = 0;
    s.fastSeenDay = 0;
  },

  /**
   * End of burn-in (MODEL_SPEC §3.4): baselines of the baseline-relative indices become the habitual-week means (so a
   * habitual exerciser's training/rest-day pattern averages to 100 % / 1.0), and the weight references are re-latched
   * after composition and water re-anchored the body to the entered weight. D8-04: a habitual EA below the T1 policy
   * reference is flagged, so "1.0 = baseline" is never read as adequate.
   */
  endBurnIn: (s: WellbeingState, k: WellbeingConstants, bus: SignalBus): void => {
    if (s.wkN > 0) {
      const n = s.wkN;
      s.gConc0 = s.wkGConcSum / n;
      s.p1npBase = s.wkP1npSum / n;
      s.ctxBase = s.wkCtxSum / n;
      s.penBase = s.wkPenSum / n;
      s.eaHab = s.wkEaSum / n;
      s.eeeHab = s.wkEeeSum / n;
    }
    s.eaHabBelowPolicy = s.eaHab < k.eaT1 ? 1 : 0;
    const fm = bus.fatMassKg;
    const mass = fm + bus.ffmActKg;
    const scale = mass + bus.labileWaterKg;
    s.wRing.fill(scale);
    s.wIdx = 0;
    s.wBase = scale;
    s.tBase = mass;
    s.wlPct = 0;
    s.lossRatePctWk = 0;
    s.fm0 = fm;
    s.mass0 = mass;
    s.vo2max0 = bus.vo2maxMlKgMin;
    s.enduranceIdx = 100;
    s.mEa = 1;
    bus.strengthEaMult = 1;
  },

  recordDay: (s: WellbeingState, _k: WellbeingConstants, _bus: SignalBus, out: Float64Array): void => {
    out[MI.moodTier] = s.moodTier;
    // D8-04: the raw (unclipped) daily exposure; its status is `eaRawStatus` (finite compatibility value when unavailable)
    out[MI.energyAvailability] = s.eaRawDay;
    out[MI.hipBmdChange] = s.bmdHipPct;
    out[MI.enduranceCapacity] = s.enduranceIdx;
    out[MI.ketoInduction] = s.ketoInduction;
    out[MI.micronutrientScore] = s.microScore;
  },
});

/** The wellbeing module with its hook-aware signal declarations (`defineModule` does not forward `signalHooks`). */
export const wellbeingModule: EngineModule<WellbeingState, WellbeingConstants> = { ...wellbeingCore, signalHooks: SIGNAL_HOOKS };
