/**
 * MODULE wellbeing — energy availability, bone, strength/endurance capacity multipliers, mood/energy tier,
 * keto-induction symptoms and micronutrient completeness.
 * Spec: docs/MODEL_SPEC.md §1.15 · Dossiers: 19 §4.1-4.5 (owner); 13 §4.10 (Φ_ind, single keto-flu owner); 15 §4.9
 * (micronutrient rule table). Sleep quality is the moderators module's output and resting heart rate / HRV / temperature /
 * acetone displays are not part of the v1 metric catalogue (MODEL_SPEC §2.2), so neither is computed here.
 * Owned files: src/engine/model/wellbeing/** only.
 *
 * Timing (MODEL_SPEC §3): hourly hooks only accumulate the day's intake, session exercise energy, exercise minutes and
 * glycogen; every state below updates once per day in `endOfDay` (exact first-order relaxation with precomputed
 * e^{−1/τ}) and its outputs act on the next day. Burn-in days (clock.day < 0) keep the slow states neutral, fill the
 * windows and latch the baselines that make all indices baseline-relative.
 */
import { defineModule } from '../../core/moduleKit';
import * as math from '../../core/math';
import { MI } from '../../types/metrics';
import type { ModuleContext, StepClock } from '../../types/module';
import type { SignalBus } from '../../types/signals';
import type { DayInput, HourInput } from '../../types/inputs';
import { wellbeingParams } from './params';
import { RING_CAP, buildConstants, type WellbeingConstants } from './constants';
import type { WellbeingState } from './state';
import { N_FLAGS } from './microTables';
import { evaluateMicro } from './micronutrients';
import * as eq from './equations';

export type { WellbeingState } from './state';
export type { WellbeingConstants } from './constants';
export * from './equations';
export { evaluateMicro, FLAG_AMBER, FLAG_GREEN, FLAG_RED, FLAG_YELLOW } from './micronutrients';
export { MICRO_IDX, MICRO_NUTRIENTS, N_FLAGS } from './microTables';
export { wellbeingParams } from './params';
export { buildConstants, RING_CAP } from './constants';

/**
 * Local bindings of the hot-path helpers: closure-scope constants instead of module-namespace lookups on every call
 * (keeps the daily hooks fast under the test transformer as well; identical semantics).
 */
const { relax, relax2 } = math;
const {
  ageMultiplier, bmdTarget, ctxTarget, energyAvailability, exerciseShare, leanGate, massFactor, p1npTarget, phiInd, phiMaxFor,
  ringMean, ringPush, ringSlope, srcFactor, strengthPenalty, tte75,
} = eq;
const evaluateMicroLocal = evaluateMicro;

/** Local alias of the ring capacity (no module-namespace lookups in the daily loops). */
const ringCap = RING_CAP;

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
    caIntakeMg: 0,
  };
  evaluateMicroLocal(k, s);
  return s;
}

/** Sex-blended body-fat thresholds (male 1 / female 0 / unspecified 0.5). */
function blend(sexMix: number, male: number, female: number): number {
  return sexMix * male + (1 - sexMix) * female;
}

/** Slow daily states (bone, BMD, strength) — updated only on real days. */
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

  // BMD (19 §4.2(b)): target from cumulative loss of the 14-d smoothed scale weight; τ 120 d loss / 240 d recovery
  const mAge = ageMultiplier(bus.ageYears, k.menopause, k.ageStepYears, k.mAgeHigh);
  let rtDays = 0;
  let ri = s.rtIdx;
  for (let j = 0; j < k.winLong; j++) {
    rtDays += s.rtRing[ri]!;
    ri = ri === 0 ? ringCap - 1 : ri - 1;
  }
  const rtPerWeek = (rtDays * 7) / k.winLong;
  const mRt = rtPerWeek >= k.rtPerWeekMin ? 1 - k.rhoRt : 1;
  const shareLong = exerciseShare(ringMean(s.eeeRing, s.eaIdx, k.winLong) - s.eeeHab, s.eaC, s.eaHab);
  const mSrc = shareLong >= k.srcShare ? k.mSrcEx : 1;
  const mCa = k.menopause === 2 && s.caIntakeMg < k.caThresholdMg ? k.mCaLow : 1;
  const tgtHip = bmdTarget(k.kHip, mAge, mRt, mCa, mSrc, s.wlPct);
  const tgtSpine = bmdTarget(k.kSpine, mAge, mRt, mCa, mSrc, s.wlPct);
  s.bmdHipPct = tgtHip + (s.bmdHipPct - tgtHip) * (tgtHip < s.bmdHipPct ? k.fBmdLoss : k.fBmdRec);
  s.bmdSpinePct = tgtSpine + (s.bmdSpinePct - tgtSpine) * (tgtSpine < s.bmdSpinePct ? k.fBmdLoss : k.fBmdRec);
}

export const wellbeingModule = defineModule<WellbeingState, WellbeingConstants>({
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
    if (hour.kcal > 0) {
      s.eiDayKcal += hour.kcal;
      s.carbDayG += hour.carbG;
      s.fatDayG += hour.fatG;
      s.fibreDayG += hour.fibreG;
    }
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

    // ---- 1. energy availability (19 §4.1; ruling R-EA)
    const ea = energyAvailability(s.eiDayKcal, s.eeeDayKcal, ffm, k.eaFloor, k.eaCeil);
    const eeeK = s.eeeDayKcal / (ffm > 1 ? ffm : 1);
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

    // ---- 2. smoothed scale weight, cumulative loss and loss rate
    if (burn) {
      s.wRing.fill(scale);
      s.wIdx = 0;
      s.wBase = scale;
      s.wlPct = 0;
      s.lossRatePctWk = 0;
    } else {
      s.wIdx = ringPush(s.wRing, s.wIdx, scale);
      const wMean = ringMean(s.wRing, s.wIdx, k.weightWin);
      const wl = s.wBase > 0 ? (100 * (s.wBase - wMean)) / s.wBase : 0;
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

    // ---- 4. micronutrient completeness (15 §4.9)
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
    if (k.recMicro === 1) evaluateMicroLocal(k, s);

    // ---- 5. bone turnover and BMD (19 §4.2) — display only (skipped when hipBmdChange is not recorded)
    if (k.recBone === 1) updateBone(s, k, bus, mass, burn);

    // ---- 6. strength multiplier M_EA (19 §4.3), baseline-relative
    const bf = (100 * fm) / (mass > 1 ? mass : 1);
    const gl = leanGate(
      bf,
      blend(k.sexMix, k.leanFullM, k.leanFullF),
      blend(k.sexMix, k.leanZeroM, k.leanZeroF),
      k.leanMin,
    );
    const pen = strengthPenalty(k.strengthA, s.eaC, k.eaT1, k.strengthWidth, k.strengthCap, gl);
    if (burn) {
      s.penBase = pen;
      s.wkPenSum += pen;
      s.mEa = 1;
    } else {
      let tgt = (1 - pen) / (1 - s.penBase);
      if (tgt > 1) tgt = 1;
      s.mEa = relax2(s.mEa, tgt, k.fMeaOff, k.fMeaOn);
    }
    bus.strengthEaMult = s.mEa;

    // ---- 7. endurance capacity index (19 §4.4), % of baseline
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

    // ---- 8. mood & energy tier (19 §4.5 rubric; a guard, never a cognition score) — display only
    let pts = 0;
    if (k.recMood === 1) {
      if (s.eaC < k.eaT2) pts += k.moodPtsEaLow;
      else if (s.eaC < k.eaT1) pts += k.moodPtsEaMid;
      const r = s.lossRatePctWk;
      if (r > k.moodRateRed) pts += k.moodPtsRateRed;
      else if (r >= k.moodRateAmber) pts += k.moodPtsRateAmber;
      if (s.ketoInduction >= k.moodKetoThr) pts += k.moodPtsKeto;
      if (bus.sleepDebtSlowH > k.moodSleepDebtH) pts += k.moodPtsSleep;
      if (bf < blend(k.sexMix, k.moodBfLeanM, k.moodBfLeanF)) pts += k.moodPtsLean;
    }
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
   * after composition and water re-anchored the body to the entered weight.
   */
  endBurnIn: (s: WellbeingState, _k: WellbeingConstants, bus: SignalBus): void => {
    if (s.wkN > 0) {
      const n = s.wkN;
      s.gConc0 = s.wkGConcSum / n;
      s.p1npBase = s.wkP1npSum / n;
      s.ctxBase = s.wkCtxSum / n;
      s.penBase = s.wkPenSum / n;
      s.eaHab = s.wkEaSum / n;
      s.eeeHab = s.wkEeeSum / n;
    }
    const fm = bus.fatMassKg;
    const mass = fm + bus.ffmActKg;
    const scale = mass + bus.labileWaterKg;
    s.wRing.fill(scale);
    s.wIdx = 0;
    s.wBase = scale;
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
    out[MI.energyAvailability] = s.eaS;
    out[MI.hipBmdChange] = s.bmdHipPct;
    out[MI.enduranceCapacity] = s.enduranceIdx;
    out[MI.ketoInduction] = s.ketoInduction;
    out[MI.micronutrientScore] = s.microScore;
  },
});
