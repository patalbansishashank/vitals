/**
 * safety — state, per-run constants and the per-day scratch record (docs/MODEL_SPEC.md §1.16).
 *
 * All buffers are allocated in `newSafetyState` (called from `init`); the hot hooks only write into them.
 */
import type { EventSink } from '../../types/module';
import type { SafetyTrace } from '../../types/result';
import type { SafetyConstants } from './params';
import { N_RULES, RULES } from './rules';

/** Length of every trailing-window ring (the longest window is 14 d: rate_14, run-progression comparison). */
export const RING = 14;
/** Length of the fast-rule rings (ruling 18:10: 28-day mean-intake floor and tissue-mass trend around fasts). */
export const RING28 = 28;
/** Regions per resistance session (dossier 09 §4.15; `N_REGIONS` in types/inputs). */
export const N_REG = 9;

/** Indices into `SafetyState.runs` (consecutive-day counters of the persistence rules). */
export const RUN = {
  vled: 0,
  ea3035: 1,
  eaLow: 2,
  ea45: 3,
  def15: 4,
  hair: 5,
  fatLow: 6,
  carbKeto: 7,
  fibreLow: 8,
  sodiumHigh: 9,
  creatineLoad: 10,
  psmf: 11,
  training: 12,
  surplus: 13,
  eiLow: 14,
} as const;
export const N_RUNS = 15;

/** Per-run constants: registry values, profile-derived flags and run-time switches. Created once in `prepare`. */
export interface SafetyK extends SafetyConstants {
  readonly isFemale: boolean;
  readonly heightM: number;
  readonly age0Years: number;
  readonly eventSink: EventSink;
  /** The run's SafetyTrace arrays (owned by the core, written here). */
  readonly trace: SafetyTrace;
  /** Evaluate the warning matrix (simulate mode); the planner only needs the SafetyTrace. */
  readonly warn: boolean;
  // profile flags (17 §4.1-4.4)
  readonly pregnant: boolean;
  readonly edRisk: boolean;
  readonly diabetesDrug: boolean;
  /** W-05-KETO-FED's 3.0 mmol/L leg applies (diabetes or pregnancy/breastfeeding; `ketoFedStrict`, ruling R-FAST-GATE). */
  readonly ketoFedStrict: boolean;
  readonly organFlag: boolean;
  readonly kidneyFlag: boolean;
  readonly stoneGoutFlag: boolean;
  readonly medFlag: boolean;
  readonly contraindKeto: boolean;
  readonly exerciseFlag: boolean;
  readonly hotFlag: boolean;
  readonly kidneyStones: boolean;
  readonly novice: boolean;
  // static body facts for W-S03 / W-U03
  readonly waistCm0: number;
  readonly whtr0: number;
  /** W-U03: body fat / muscle came from the visual sliders (17 §3 "BF%/muscle from sliders"). */
  readonly bfFromSliders: boolean;
  /** Entered age, y (W-U02 "age > 70" is an input-range rule: the entered age, not the age advanced by the run). */
  readonly ageEnteredYears: number;
  readonly markerShown: boolean;
  readonly asiShown: boolean;
  /**
   * Ruling 18:10 (fasts vs the 7-day floor / deficit cap): 1 on fast-event days (≥ `fastDayMinHours` of the day in a
   * planned zero-intake span longer than T0, or a graded-refeed day of one), length nDays.
   */
  readonly fastDay: Uint8Array;
  /** 1 on days on which a planned zero-intake span with a graded refeed (refeed 'auto' / custom factors) ends (W-F08). */
  readonly plannedRefeedDay: Uint8Array;
  /**
   * 1 on days on which a planned span of ≥ `refeedMinFastH` without a refeed ends and the following day's planned intake
   * exceeds `refeedFirstDayMaxFrac` of TDEE0 (W-F08 "no refeeding ramp" for planned fasts; the end day itself may be partial).
   */
  readonly plannedNoRampDay: Uint8Array;
  /** Start hours (absolute) of planned spans of tier ≥ T3, ascending (W-M19 "within 24 h of a T3+ fast", pre-fast leg). */
  readonly longFastStartH: Float64Array;
  /**
   * Planned zero-intake spans longer than T0 (blocker round 2026-10-01): absolute hour at which intake resumes (the span's
   * `endHour`) and the meal-to-meal duration, h — a fast episode that ends there is tiered, logged and reported with the
   * meal-to-meal duration (the ruling-18:10 unit of `FastEvent.durationH`), not the zero-intake counter (one hour less
   * for whole-hour meals: a "72 h" fast was reported as "a 71 h fast" and missed W-F08).
   */
  readonly spanEndHour: Float64Array;
  readonly spanM2mH: Float64Array;
  /** Longest meal-to-meal duration of the planned spans (> T0) covering each day, h (0 = none); length nDays. */
  readonly spanM2mDay: Float64Array;
  /** Habitual sodium (mg/d) and whether the user entered it / their habitual fibre (W-M13 / W-M11 informativeness). */
  readonly habSodiumMg: number;
  readonly habSodiumEntered: boolean;
  readonly habFibreEntered: boolean;
  /** Tissue-mass BMI at t = 0 (W-E13 projected BMI), kg/m². */
  readonly bmiTm0: number;
  // planner early-abort bounds on SafetyTrace quantities (0 entries unless the core passes `abortOn`)
  readonly abortCode: Int8Array;
  readonly abortOp: Int8Array;
  readonly abortValue: Float64Array;
}

/** Scratch record for one day's derived values (written in endOfDay, read by the rule evaluation). */
export interface DayQ {
  ei: number;
  tdee: number;
  ei7: number;
  tdee7: number;
  def7: number;
  ea7: number;
  tm: number;
  bw: number;
  ffm: number;
  fm: number;
  rate14Kg: number;
  rate14Pct: number;
  cum: number;
  bmi: number;
  bf: number;
  age: number;
  fastHMax: number;
  fastH7: number;
  tier: number;
  prot7: number;
  protRw7: number;
  protPctE7: number;
  protFfm7: number;
  fat7: number;
  fatPct7: number;
  fibre7: number;
  fibreDens: number;
  carb: number;
  fat: number;
  alc7G: number;
  rtDays7: number;
  capDef: number;
  capPct: number;
  eaFinite: boolean;
  /** Net session exercise energy in the trailing 7 d, kcal, and whether the EA rules apply (needs exercise unless disabled). */
  eee7: number;
  eaApplies: boolean;
  /** Ruling 18:10: today is a fast-event day; a fast-event day lies in the trailing 28 d; 28-day mean intake, kcal/d. */
  fastDay: boolean;
  fastIn28: boolean;
  ei28: number;
  /** Intake compared with the HC-E1 floor: EI_7 over non-fast days, or min(that, EI_28) near a fast; NaN on fast days. */
  eiFloor: number;
  /** Projected BMI from tissue mass (no glycogen/water swings), kg/m², and cumulative tissue loss, %. */
  bmiTm: number;
  cumTm: number;
  /** R-T4CAP: fasted hours of the trailing 7 d that count toward the 108-h cap (T4+ episodes excluded). */
  fastH7Cap: number;
  /** 28-day deficit over all days, % (NaN before any day). */
  def28: number;
  /** Today's own planned intake is a deficit (EI < (1 − deficitAnyPct)·TDEE_est): the 7-day deficit rules attach to it. */
  dayDeficit: boolean;
}

export function newDayQ(): DayQ {
  return {
    ei: 0,
    tdee: 0,
    ei7: 0,
    tdee7: 0,
    def7: 0,
    ea7: 0,
    tm: 0,
    bw: 0,
    ffm: 0,
    fm: 0,
    rate14Kg: 0,
    rate14Pct: 0,
    cum: 0,
    bmi: 0,
    bf: 0,
    age: 0,
    fastHMax: 0,
    fastH7: 0,
    tier: 0,
    prot7: 0,
    protRw7: 0,
    protPctE7: 0,
    protFfm7: 0,
    fat7: 0,
    fatPct7: 0,
    fibre7: 0,
    fibreDens: 0,
    carb: 0,
    fat: 0,
    alc7G: 0,
    rtDays7: 0,
    capDef: 0,
    capPct: 0,
    eaFinite: false,
    eee7: 0,
    eaApplies: false,
    fastDay: false,
    fastIn28: false,
    ei28: 0,
    eiFloor: 0,
    bmiTm: 0,
    cumTm: 0,
    fastH7Cap: 0,
    def28: Number.NaN,
    dayDeficit: false,
  };
}

export interface SafetyState {
  /** Horizon length and whether the warning matrix is evaluated. */
  nDays: number;
  warn: boolean;
  /** Trailing rings (length RING = 14): daily intake, TDEE, tissue mass, net exercise EE (session), protein g, fat g, fibre g, alcohol g. */
  eiRing: Float64Array;
  tdeeRing: Float64Array;
  tmRing: Float64Array;
  eeeRing: Float64Array;
  protRing: Float64Array;
  fatRing: Float64Array;
  fibreRing: Float64Array;
  alcRing: Float64Array;
  /** 1 on fast-event days (ruling 18:10), aligned with the 14-day rings: the 7-day intake rules use non-fast days. */
  fastRing: Float64Array;
  /** 1 on days with a resistance session; running minutes per day; hard sets per region per day (RING × N_REG). */
  rtRing: Float64Array;
  runRing: Float64Array;
  setsRing: Float64Array;
  ringIdx: number;
  daysSeen: number;
  /** 28-day rings (ruling 18:10): intake, TDEE, tissue mass, fast-event-day flag; write index and samples seen. */
  ei28Ring: Float64Array;
  tdee28Ring: Float64Array;
  tm28Ring: Float64Array;
  fast28Ring: Float64Array;
  /**
   * Daily energy-availability sample clamp((EI − EEE)/FFM), kcal/kg FFM/d, aligned with the 28-day rings: EA_7 over the
   * last seven non-fast days when a planned fast lies in the trailing 7 d (ruling R-FAST-GATE).
   */
  ea28Ring: Float64Array;
  idx28: number;
  seen28: number;
  /** Index of the next entry of `k.longFastStartH` not yet in the past (W-M19 pre-fast leg). */
  nextLongIdx: number;
  /** Current fast_h counter (h since the last intake > 50 kcal) as read last hour. */
  fastRunH: number;
  /** Day accumulators (reset every endOfDay). */
  dayIntakeKcal: number;
  dayTeeKcal: number;
  dayEeeKcal: number;
  dayProtG: number;
  dayFatG: number;
  dayCarbG: number;
  dayFibreG: number;
  dayAlcG: number;
  dayCaffMg: number;
  dayCaffDoseMaxMg: number;
  dayCaffBedMg: number;
  dayFastMaxH: number;
  /** Scale weight at the day's wake hour, kg (the displayed daily weight, morning anchor); NaN until that hour. */
  dayWakeScaleKg: number;
  dayVigorousFrac: number;
  dayHardInFastH: number;
  dayKetoFedBhb: number;
  dayNoElecFastH: number;
  dayEpEndLenH: number;
  dayAlcAfterLong: number;
  /** Lowest fat mass (kg) in an hour when composition's smooth fat floor was engaged (`fatFloorActive` > 0); 1e9 when not. */
  dayFatFloorFmKg: number;
  /** Scale weight at t = 0 (the user's entered weight): BW_0 of cum_loss. */
  startWeightKg: number;
  /** Fast episodes (counter > T0): active flag, first/last day with counter > T0, max counter, hours since a T3+ fast ended. */
  epActive: number;
  epStartDay: number;
  epLastDay: number;
  epMaxH: number;
  /** Hours since a fast longer than T2 ended (W-M19 post-fast leg). */
  hoursSinceLongEnd: number;
  /**
   * Hours since a fast longer than T0 ended (05 §9: BHB > 3 in the refeed phase is starvation ketosis, not a DKA sign;
   * the refeed window is `ketoFedRefeedWindowH`).
   */
  hoursSinceFastEnd: number;
  /** Log of finished fasts longer than T0: [last-meal hour, resume hour, length h] × nEp. */
  epLog: Float64Array;
  nEp: number;
  /** Per-day: fasted hours (hours of counter >= 1 inside fasts longer than T0), and the (relabelled) fast tier 0-5. */
  fastedH: Float32Array;
  /** Per-day: the part of `fastedH` that belongs to an episode longer than T3 (R-T4CAP: not counted toward the 108-h cap). */
  fastedT4H: Float32Array;
  /** 1 while the running episode has passed T3 (its hours go to `fastedT4H` too). */
  epT4: number;
  fastTierDay: Uint8Array;
  /** Consecutive-day counters (see RUN). */
  runs: Int32Array;
  /** Hit matrix rule-major (rule × nDays) and the driving value of that hit. */
  hit: Uint8Array;
  peak: Float32Array;
  /** 1 for every rule that has at least one hit (lets `finalize` skip the empty rows). */
  ruleHit: Uint8Array;
  /** Per-day helper values for message placeholders. */
  capDefD: Float32Array;
  capPctD: Float32Array;
  alpertCapD: Float32Array;
  /**
   * Per-day own values for the attribution of rolling-window rules (blocker round 2026-10-01): a warning run covers the
   * days whose own inputs/state produced the rolling mean or trend, not the evaluation day. Day intake and TEE (kcal),
   * protein, fat and alcohol (g), end-of-day tissue mass and FFM (kg), reference weight (kg), 1 on fast-event days, 1 on
   * days in deficit (EI < TEE·(1 − deficitAnyPct)).
   */
  dEi: Float32Array;
  dTdee: Float32Array;
  dProt: Float32Array;
  dFat: Float32Array;
  dAlc: Float32Array;
  dTm: Float32Array;
  dFfm: Float32Array;
  dRw: Float32Array;
  dFast: Uint8Array;
  dDef: Uint8Array;
  /** Tissue mass at t = 0 (end of burn-in), kg: the day-0 own loss is counted from it. */
  tm0: number;
  /** 1 when the running fast episode had planned hours without electrolytes; per logged episode (parallel to `epLog`). */
  epNoElecCur: number;
  epNoElec: Uint8Array;
  /** Last day index evaluated (−1 before day 0). */
  lastDay: number;
  q: DayQ;
}

export function newSafetyState(nDays: number, warn: boolean, startWeightKg: number): SafetyState {
  const mat = warn ? N_RULES * nDays : 0;
  const perDay = warn ? nDays : 0;
  return {
    nDays,
    warn,
    eiRing: new Float64Array(RING),
    tdeeRing: new Float64Array(RING),
    tmRing: new Float64Array(RING),
    eeeRing: new Float64Array(RING),
    protRing: new Float64Array(RING),
    fatRing: new Float64Array(RING),
    fibreRing: new Float64Array(RING),
    alcRing: new Float64Array(RING),
    fastRing: new Float64Array(RING),
    rtRing: new Float64Array(RING),
    runRing: new Float64Array(RING),
    setsRing: new Float64Array(RING * N_REG),
    ringIdx: 0,
    daysSeen: 0,
    ei28Ring: new Float64Array(RING28),
    tdee28Ring: new Float64Array(RING28),
    tm28Ring: new Float64Array(RING28),
    fast28Ring: new Float64Array(RING28),
    ea28Ring: new Float64Array(RING28),
    idx28: 0,
    seen28: 0,
    nextLongIdx: 0,
    fastRunH: 0,
    dayIntakeKcal: 0,
    dayTeeKcal: 0,
    dayEeeKcal: 0,
    dayProtG: 0,
    dayFatG: 0,
    dayCarbG: 0,
    dayFibreG: 0,
    dayAlcG: 0,
    dayCaffMg: 0,
    dayCaffDoseMaxMg: 0,
    dayCaffBedMg: 0,
    dayFastMaxH: 0,
    dayWakeScaleKg: Number.NaN,
    dayVigorousFrac: 0,
    dayHardInFastH: 0,
    dayKetoFedBhb: 0,
    dayNoElecFastH: 0,
    dayEpEndLenH: 0,
    dayAlcAfterLong: 0,
    dayFatFloorFmKg: 1e9,
    startWeightKg,
    epActive: 0,
    epStartDay: 0,
    epLastDay: 0,
    epMaxH: 0,
    hoursSinceLongEnd: 1e9,
    hoursSinceFastEnd: 1e9,
    epLog: new Float64Array(3 * (2 * nDays + 4)),
    nEp: 0,
    fastedH: new Float32Array(nDays),
    fastedT4H: new Float32Array(nDays),
    epT4: 0,
    fastTierDay: new Uint8Array(nDays),
    runs: new Int32Array(N_RUNS),
    hit: new Uint8Array(mat),
    peak: new Float32Array(mat),
    ruleHit: new Uint8Array(warn ? N_RULES : 0),
    capDefD: new Float32Array(perDay),
    capPctD: new Float32Array(perDay),
    alpertCapD: new Float32Array(perDay),
    dEi: new Float32Array(perDay),
    dTdee: new Float32Array(perDay),
    dProt: new Float32Array(perDay),
    dFat: new Float32Array(perDay),
    dAlc: new Float32Array(perDay),
    dTm: new Float32Array(perDay),
    dFfm: new Float32Array(perDay),
    dRw: new Float32Array(perDay),
    dFast: new Uint8Array(perDay),
    dDef: new Uint8Array(perDay),
    tm0: 0,
    epNoElecCur: 0,
    epNoElec: new Uint8Array(2 * nDays + 4),
    lastDay: -1,
    q: newDayQ(),
  };
}

/** Record a warning-rule hit for day `d` with its driving value (no-op arrays when warnings are off). */
export function setHit(s: SafetyState, rule: number, d: number, value: number): void {
  const i = rule * s.nDays + d;
  s.hit[i] = 1;
  s.peak[i] = value;
  s.ruleHit[rule] = 1;
}

/** 1 for rules whose worst driving value is the minimum (RULES[i].worst === 'min'). */
const RULE_MIN: Uint8Array = Uint8Array.from(RULES, (r) => (r.worst === 'min' ? 1 : 0));

/**
 * Hit that keeps the worst driving value when the day is already hit (a day attributed by several windows, blocker round
 * 2026-10-01).
 */
export function setHitWorst(s: SafetyState, rule: number, d: number, value: number): void {
  const i = rule * s.nDays + d;
  if (s.hit[i] === 0) {
    s.hit[i] = 1;
    s.peak[i] = value;
    s.ruleHit[rule] = 1;
  } else if (RULE_MIN[rule] === 1 ? value < s.peak[i]! : value > s.peak[i]!) {
    s.peak[i] = value;
  }
}
