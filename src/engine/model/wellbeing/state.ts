/**
 * State of the wellbeing module (docs/MODEL_SPEC.md §1.15). Plain monomorphic object of numbers and typed arrays:
 * `structuredClone(state)` is a valid snapshot. Units are given on every field.
 */
export interface WellbeingState {
  // ------------------------------------------------------------ running-day accumulators (reset in endOfDay)
  /**
   * Energy ingested today so far, kcal: Σ (HourInput.kcal + 4·exCarbG), signed (D6-02 reconciliation corrections may be
   * negative; carbohydrate eaten during exercise is ingested energy, M8). Reported ME convention (C3).
   */
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

  // ------------------------------------------------------------ energy availability exposure (D8-04, C3/C6)
  /**
   * Raw daily EA of the last completed day, kcal/kg FFM/d: (EI − net session EEE)/FFM_act, UNCLIPPED. Finite compatibility
   * value when `eaRawStatus` is unavailable (the previous valid value; never read it then).
   */
  eaRawDay: number;
  /** Status code of `eaRawDay` (`EA_STATUS`): unavailable / planned / logged complete / partial / as-planned / unknown. */
  eaRawStatus: number;
  /**
   * EA implied by the KNOWN intake only, kcal/kg FFM/d ((known EI − EEE)/FFM_act); a lower bound of the day's EA when
   * `eaRawKnownIsLowerBound` = 1 (intake partially logged, exercise covered). Equals `eaRawDay` on fully covered days.
   */
  eaRawKnownDay: number;
  eaRawKnownIsLowerBound: number;
  /** The last completed day's ledger: EI (ME) kcal, net session EEE kcal and the FFM_act denominator kg. */
  eaEiKcal: number;
  eaEeeKcal: number;
  eaFfmKg: number;

  // ------------------------------------------------------------ internal EA drive (19 §4.1, 17 §2.1): design operators
  /** Smoothed EA_s (EWMA τ 3 d) of the CLIPPED daily samples, kcal/kg FFM/d: the bounded internal drive, not exposure. */
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
  /** Daily scale-weight samples (fatMassKg + ffmActKg + labileWaterKg), kg; head index = newest (loss-rate concern flag). */
  wRing: Float64Array;
  wIdx: number;
  /** Baseline scale weight latched at the end of burn-in, kg. */
  wBase: number;
  /** Baseline TISSUE mass FM + FFM_act latched with `wBase`, kg (no glycogen, water or gut content). */
  tBase: number;
  /**
   * Persistent tissue loss vs baseline as % of the baseline body weight, ≥ 0 (D8-05: reversible water/glycogen/gut changes
   * are not bone-relevant loss).
   */
  wlPct: number;
  /** 14-d OLS weight-loss rate, %BW/wk (positive = losing). */
  lossRatePctWk: number;
  /** Daily resistance-training presence (0/1 ring) and index of the newest entry (informational: no bone protection credit, D8-05). */
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
  /**
   * Legacy research scenario of BMD change vs baseline, % (D8-05): NOT a personal forecast (status exploratory/unavailable),
   * driven by persistent tissue loss only, no any-set protection, no calcium multiplier, no automatic recovery.
   */
  bmdHipPct: number;
  bmdSpinePct: number;

  // ------------------------------------------------------------ strength multiplier (19 §4.3; exploratory, D8-04)
  /** M_EA (τ_on 28 d falling / τ_off 75 d recovering); 1 = the person's HABITUAL reference, not healthy adequacy. */
  mEa: number;
  /** Penalty at the end of burn-in (baseline-relative normalisation), fraction. */
  penBase: number;
  /** 1 when the habitual (burn-in) EA lies below the T1 policy reference: M_EA = 1 then means an impaired baseline. */
  eaHabBelowPolicy: number;

  // ------------------------------------------------------------ endurance capacity (19 §4.4; exploratory, task-scoped, D8-09)
  /** Economy-penalty state A_econ = A_fat·gI (0..1). */
  aEcon: number;
  /**
   * Glycogen-limited cycling time-to-exhaustion near 75 % VO2max, % of own baseline (task-scoped research index; never a
   * race-time or generic endurance prediction, `ENDURANCE_INDEX_SCOPE`).
   */
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

  // ------------------------------------------------------------ wellbeing concern flags (19 §4.5 rubric; D8-09)
  /** Model concern tier 0 / 1 / 2 (legacy rubric points behind it); a guard, never a mood or cognition measurement. */
  moodTier: number;
  moodPoints: number;
  /** Transparent model concern flags (`CONCERN_FLAG` bits); observed concerns are combined outside (`combineWellbeingConcern`). */
  concernFlags: number;

  // ------------------------------------------------------------ known nutrient exposure (D8-08, C3): from the shared ledger
  /**
   * Daily known amounts of the tracked exposures (`TRACKED_NUTRIENTS` order × RING_CAP days, nutrient-major), canonical
   * units; a partial day holds its known lower bound. Coverage codes per slot in `nutCovRing` (`NUT_COV`).
   */
  nutKnownRing: Float64Array;
  nutCovRing: Int8Array;
  /** Head index of the nutrient rings and the number of days pushed (≤ RING_CAP). */
  nutIdx: number;
  nutDays: number;
  /**
   * Running window totals per tracked nutrient (incremental, O(1) per day): sum of known amounts over completely covered
   * logged days, the number of such days and the number of partial days inside the observation window.
   */
  nutCompleteSum: Float64Array;
  nutCompleteDays: Float64Array;
  nutPartialDays: Float64Array;
  /** Known calcium: mean over completely covered days of the observation window, mg/d (valid only when caCompleteDays > 0), and the day counts behind it. */
  caKnownMeanMg: number;
  caCompleteDays: number;
  caPartialDays: number;

  // ------------------------------------------------------------ micronutrient pattern heuristic (15 §4.9; archived, D8-08)
  /** Legacy rule-based score 0..100 from typical food density (heuristic; no optimisation, no deficiency meaning). */
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
  /** Calcium of the typical-density PATTERN prior, mg/d (a scenario estimate, never actual intake; feeds nothing). */
  caPatternMg: number;
}
