/**
 * State of the wellbeing module (docs/MODEL_SPEC.md §1.15). Plain monomorphic object of numbers and typed arrays:
 * `structuredClone(state)` is a valid snapshot. Units are given on every field.
 */
export interface WellbeingState {
  // ------------------------------------------------------------ running-day accumulators (reset in endOfDay)
  /** Energy ingested today so far, kcal (Σ HourInput.kcal, engine energy convention). */
  eiDayKcal: number;
  /** Session exercise energy net of resting expenditure today so far, kcal (Σ exSessionNetKcalH; the EEE of ruling R-EA). */
  eeeDayKcal: number;
  /** Net carbohydrate and fat ingested today, g. */
  carbDayG: number;
  fatDayG: number;
  /** Fibre ingested today, g. */
  fibreDayG: number;
  /** Exercise minutes today (all sessions) and minutes outside resistance-training hours (endurance proxy). */
  exMinDay: number;
  endMinDay: number;
  /** Resistance sets today. */
  rtSetsDay: number;
  /** Σ over the day's hours of whole-body muscle glycogen, g, and hours counted. */
  muscleGlySumG: number;
  hoursDay: number;
  /** 1 when the fasting overlay was active in any hour today (fast days are not carbohydrate-restriction days). */
  fastSeenDay: number;

  // ------------------------------------------------------------ energy availability (19 §4.1, 17 §2.1)
  /** Smoothed EA_s (EWMA τ 3 d), kcal/kg FFM/d. */
  eaS: number;
  /** EWMA (same τ) of the exercise part EEE/FFM, kcal/kg FFM/d. */
  eeeS: number;
  /** Daily EA samples (ring, kcal/kg FFM/d) and daily EEE/FFM samples; head index = newest sample. */
  eaRing: Float64Array;
  eeeRing: Float64Array;
  eaIdx: number;
  /** Trailing means: EA_7 (17 EA_7) and EA_c (14-d), kcal/kg FFM/d. */
  ea7: number;
  eaC: number;

  // ------------------------------------------------------------ weight, RT presence, training load
  /** Daily scale-weight samples (fatMassKg + ffmActKg + labileWaterKg), kg; head index = newest. */
  wRing: Float64Array;
  wIdx: number;
  /** Baseline scale weight latched at the end of burn-in, kg. */
  wBase: number;
  /** Cumulative loss of the 14-d smoothed scale weight vs baseline, % (≥ 0). */
  wlPct: number;
  /** 14-d OLS weight-loss rate, %BW/wk (positive = losing). */
  lossRatePctWk: number;
  /** Daily resistance-training presence (0/1 ring) and index of the newest entry. */
  rtRing: Uint8Array;
  rtIdx: number;
  /** EMA (τ 7 d) of daily training hours (all sessions) and of endurance hours, h/day. */
  trainHrEma: number;
  endHrEma: number;

  // ------------------------------------------------------------ bone (19 §4.2)
  /** Bone-formation / resorption indices relative to own baseline (totals incl. the low-CHO term). */
  p1np: number;
  ctx: number;
  /** EA-driven parts (EWMA τ_b) and baseline targets latched at the end of burn-in. */
  p1npEa: number;
  ctxEa: number;
  p1npBase: number;
  ctxBase: number;
  /** Low-carbohydrate bone term weights (0..1) for P1NP and CTX, consecutive low-carbohydrate days. */
  lowChoW1: number;
  lowChoW2: number;
  lowCarbRun: number;
  /** BMD change vs baseline, %. */
  bmdHipPct: number;
  bmdSpinePct: number;

  // ------------------------------------------------------------ strength multiplier (19 §4.3)
  /** M_EA (τ_on 28 d falling / τ_off 75 d recovering). */
  mEa: number;
  /** Penalty at the end of burn-in (baseline-relative normalisation), fraction. */
  penBase: number;

  // ------------------------------------------------------------ endurance capacity (19 §4.4)
  /** Economy-penalty state A_econ = A_fat·gI (0..1). */
  aEcon: number;
  /** Endurance capacity index, % of baseline. */
  enduranceIdx: number;
  /** Baselines latched during burn-in: muscle glycogen concentration g/100 g ww, VO2max mL/kg/min, A_econ, FM kg, tissue mass kg. */
  gConc0: number;
  /**
   * Burn-in-week accumulators (last ≤ 7 burn-in days = the habitual week): Σ daily-mean muscle glycogen concentration,
   * Σ raw P1NP / CTX targets, Σ strength penalty, and the number of days summed. `endBurnIn` turns them into the
   * baselines so that the habitual week (training days included) averages to the index baselines.
   */
  wkGConcSum: number;
  wkP1npSum: number;
  wkCtxSum: number;
  wkPenSum: number;
  wkEaSum: number;
  wkEeeSum: number;
  wkN: number;
  /**
   * Habitual EA and session EEE (kcal/kg FFM/d, burn-in-week means): the reference of 19 §4.2's f_EEE ("share of the
   * energy deficit created by exercise") — the part of the EA decrement below the person's own habitual EA that comes from
   * exercise above the habitual exercise. Without burn-in: EA 45 (the eaTierT0 threshold) and 0.
   */
  eaHab: number;
  eeeHab: number;
  vo2max0: number;
  aEcon0: number;
  fm0: number;
  mass0: number;

  // ------------------------------------------------------------ keto-induction (13 §4.10)
  /** Day index on which the current induction curve started (−1 none). */
  ketoStartDay: number;
  /** Previous-intake reference at the trigger, g/d, and Φ_max of the running curve (0..1). */
  carbPrevG: number;
  phiMax: number;
  /** 1 while carbohydrate has stayed below the trigger threshold (regime flag). */
  inLowCarb: number;
  /** Φ_ind (0..1). */
  ketoInduction: number;

  // ------------------------------------------------------------ mood tier (19 §4.5)
  /** 0 green / 1 amber / 2 red, and the rubric points behind it. */
  moodTier: number;
  moodPoints: number;

  // ------------------------------------------------------------ micronutrients (15 §4.9)
  /** Completeness score, 0..100. */
  microScore: number;
  /** EMAs (τ 7 d) of energy kcal/d, carbohydrate g/d, fat g/d, fibre g/d, low-fat-meal share, and the day's food quality. */
  energyEma7: number;
  carbEma7: number;
  fatEma7: number;
  fibreEma7: number;
  lowFatMealsEma7: number;
  foodQuality: number;
  /** Consecutive days with fat < the EFA red threshold. */
  efaLowDays: number;
  /** Flag levels per slot (0 green, 1 yellow, 2 amber, 3 red): 12 nutrients, fibre, EFA, fat-soluble absorption, iodine. */
  flags: Int8Array;
  nRed: number;
  nAmber: number;
  /** Projected calcium intake, mg/d (feeds mCa). */
  caIntakeMg: number;
}
