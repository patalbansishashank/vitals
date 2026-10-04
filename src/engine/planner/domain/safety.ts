/**
 * Dossier-17 bounds compiled for one planner request (17 §2.2 constraint table, §2.3 parametrised caps, §2.5 constants,
 * §4.2 population rules, §4.3 fasting tiers). Two inputs are intersected (the stricter value always wins):
 *   1. the profile itself (body, age, `PersonProfile.safety.flags`) — always applied, so the planner is safe even when
 *      no screening outcome is supplied;
 *   2. the onboarding screening outcome (`PlannerSafetyInput`: plannerLocks, fasting eligibility, opt-ins) produced by
 *      `src/features/onboarding/safetyRules.ts`, consumed structurally.
 *
 * Every number below is copied from dossier 17 §2.5 (single source of truth); `PROPOSED` marks the dossier's own
 * engineering values. Nothing here runs the engine.
 */
import type { ResolvedProfile } from '../../types/profile';
import type { PlannerSafetyInput, PracticalConstraints } from './types';

/** 17 §2.5 constants (version 1). */
export const HC = {
  /** HC-E1: 7-d mean intake floor, kcal/d. */
  energyFloorKcal: { female: 1200, male: 1500 },
  /** HC-E2: restricted days (50 < EI < upper): ≥ min kcal, ≤ 2 per rolling 7 d, never consecutive. */
  restrictedDay: { upperKcal: { female: 1000, male: 1200 }, minKcal: { female: 500, male: 600 }, maxPer7d: 2 },
  /** HC-E3 / §2.3 deficit cap, % of TDEE_7 (PROPOSED shape). */
  deficitCapPct: { default: 25, bmiGe30: 30, bmiLt25: 20, ageGe65: 15, leanWithin4: 10 },
  /** HC-E4 energy availability floor, kcal/kg FFM/d. */
  eaMin: 30,
  /** HC-E5 / §2.3 rate cap, % BW per week (PROPOSED shape) and absolute kg/wk. */
  rateCapPct: { default: 0.75, leanWithin6: 0.5, highAdiposity: 1.0, age65to74: 0.5 },
  rateCapAbsKg: 1.5,
  /** HC-E6 cumulative loss cap, % of starting BW. */
  cumLossMaxPct: 20,
  /** HC-E7 continuous-deficit blocks (PROPOSED). */
  deficitBlocks: { highThresholdPct: 15, highMaxWeeks: 12, highBreakWeeksDefault: 2, moderateLowPct: 5, moderateMaxWeeks: 26, moderateBreakWeeks: 2 },
  /** HC-E8 surplus. */
  surplus: { maxPctTdee: 120, gainPctBwWk: 0.5, gainPctBwWkWhtr: 0.25, blockWaistCm: { male: 102, female: 88 }, blockWhtr: 0.6, blockBmi: 30, cautionWaistCm: { male: 102, female: 88 }, cautionWhtr: 0.5 },
  /** HC-P4 BMI margins (PROPOSED) and HC-P5 body-fat floors (PROPOSED). */
  bmi: { startDeficitMin: 20, projectedMin: 19 },
  bfFloorPct: { male: 10, female: 18 },
  /** HC-M1 / HC-M2 protein, g/kg reference weight RW = min(BW, 27.5·H²) unless stated. */
  protein: { floor: 0.8, floorDeficitOrAge65: 1.2, floorAge65Maintenance: 1.0, capPctEnergy: 35, capGPerKgFfm: 3.1, softCapRw: 2.2, ckdCapRw: 1.3 },
  /**
   * Planning headroom under the 3.1 g/kg FFM cap (R-PLAN-SAFETY): the Simulator's W-M04 divides by the run-time FFM,
   * which falls in a deficit, so a plan written at exactly 3.1 g/kg FFM0 is flagged within weeks.
   */
  proteinPlanCapGPerKgFfm: 2.9,
  /** HC-M1: "deficit" for the 1.2 g/kg floor means deficit_pct_7 > 10 %. */
  proteinDeficitThresholdPct: 10,
  /** HC-M3 fat. */
  fat: { minPctEnergy: 15, minG: 30, mealMinG: 10, mealRuleDeficitPct: 20, appliesAboveKcal: 800 },
  /** HC-M4 carbohydrate: ketogenic range and block length. */
  carbs: { ketogenicG: 50, maxBlockWeeks: 12 },
  /** HC-M5 fibre soft floor, g per 1000 kcal. */
  fibreSoftGPer1000: 14,
  /** HC-M12 creatine maintenance maximum, g/d. */
  creatineMaxG: 5,
  /** HC-M9 fasting-day beverages, L/d (T2-T4 2.0-3.0). */
  fastingFluidL: { min: 2.0, max: 3.0 },
  /** 17 §4.3.3 fasting sodium (elemental) g/d: T2 ≥ 36 h 1.5-2.5; T3/T4 2.0-3.0. */
  fastingSodiumG: { t2: [1.5, 2.5] as const, t3: [2.0, 3.0] as const },
  /** HC-F5 daily eating window, h. */
  window: { defaultMin: 6, optInMin: 4, r1Min: 12 },
  /** HC-F2 cumulative zero-intake hours in any 7 d (tiers T0-T3; a single T4 fast follows its own tier rule, R-T4CAP). */
  fastH7Max: 108,
  /** HC-F2 normal eating between consecutive fasts, h: T1/T2 24 h, 7 d if either is T3, 28 d if either is T4 (engine gapT*MinH). */
  gapH: { T12: 24, T3: 168, T4: 672 },
  /** HC-F2 counts (engine t1MaxPerWeek, t2SplitH, t2MaxPerWeekGt36, t3MaxPer30d, t4MaxPer12wk, t4MaxPerYear). */
  fastsPerWeekMax: 3,
  t2SplitH: 36,
  fastsGt36PerWeekMax: 2,
  t3Per30dMax: 2,
  t4Per12wkMax: 1,
  t4PerYearMax: 4,
  /** HC-F1 tier upper bounds, h (T0 ≤ 20, T1 ≤ 24, T2 ≤ 48, T3 ≤ 72, T4 ≤ 168, T5 never). */
  tierMaxH: { T0: 20, T1: 24, T2: 48, T3: 72, T4: 168 },
  /** 17 §4.3.2 tier eligibility beyond the gate. */
  tierBmiMin: { T2: 20, T3: 22, T4: 25 },
  t3BfMinPct: { male: 15, female: 25 },
  /** HC-X2 novice RT (PROPOSED): ≤ 10 hard sets per muscle per week at start, ≤ +2 sets/wk, 2-3 sessions/wk. */
  rtNovice: { startSetsMax: 10, setsIncreasePerWeek: 2, sessionsMax: 3 },
  /** HC-X3 sedentary start (PROPOSED): ≤ 150 min/wk moderate at start, ≤ +30 %/wk, ≥ 1 rest day/wk. */
  sedentary: { startMinPerWeek: 150, increasePct: 30, restDaysMin: 1 },
  /** Zero-energy threshold per day / intake event (17 §2.5). */
  zeroKcal: 50,
} as const;

export type FastTier = 'T0' | 'T1' | 'T2' | 'T3' | 'T4' | 'T5';

/** Tier of a zero-intake span of `h` hours (1e-6 h tolerance for floating-point meal clocks). */
export function tierForHours(h: number): FastTier {
  const x = h - 1e-6;
  if (x <= HC.tierMaxH.T0) return 'T0';
  if (x <= HC.tierMaxH.T1) return 'T1';
  if (x <= HC.tierMaxH.T2) return 'T2';
  if (x <= HC.tierMaxH.T3) return 'T3';
  if (x <= HC.tierMaxH.T4) return 'T4';
  return 'T5';
}

/** Compiled safety caps for one request (all values already intersected; the stricter wins). */
export interface SafetyCaps {
  blocked: string | null;
  sex: 'male' | 'female';
  ageYears: number;
  bmi: number;
  bodyFatPct: number;
  bfFloorPct: number;
  whtr: number;
  /** Reference weight for protein RW = min(BW, 27.5·H²), kg (17 §2.1, PROPOSED). */
  rwKg: number;
  weightKg: number;
  ffmKg: number;
  tdee0Kcal: number;
  /** HC-E3 cap, % (0 = no deficit allowed). */
  deficitCapPct: number;
  /** HC-E5 cap, % BW / wk and kg/wk. */
  rateCapPct: number;
  rateCapKg: number;
  /** HC-E8: surplus allowed and its limits. */
  surplusAllowed: boolean;
  gainCapPct: number;
  maxPctTdee: number;
  /**
   * Largest planned surplus of a gaining phase, % of maintenance: HC-E8's 120 %, or 104.5 % when the waist is above
   * 102 / 88 cm or the waist-to-height ratio is ≥ 0.5 (17 §3 W-S03: a surplus above 5 % is a caution then; 0.5 point of
   * headroom, R-PLAN-SAFETY). Refeed days inside a deficit are not gaining phases and keep `maxPctTdee`.
   */
  surplusPhaseMaxPct: number;
  /** HC-E1 planning floor, kcal/d: min(1200 F / 1500 M, TDEE0). */
  energyFloorKcal: number;
  restrictedDayUpperKcal: number;
  restrictedDayMinKcal: number;
  proteinFloorRw: number;
  /** Floor used for deficit days (HC-M1: 1.2 when deficit > 10 %, age ≥ 65, or RT ≥ 2 d/wk in deficit). */
  proteinFloorDeficitRw: number;
  proteinCapRw: number;
  proteinCapGPerKgFfm: number;
  fatFloorG: number;
  /** Carbohydrate floor g/d (0 = none; 50 = no ketogenic range; 100 in R1). */
  carbFloorG: number;
  ketogenicAllowed: boolean;
  creatineAllowed: boolean;
  /** Longest zero-intake span (meal to meal) the planner may schedule, h (T4 up to 168 h only in expert mode; T5 never). */
  maxFastH: number;
  /** Plain-language reason for the fasting limit (explanations: why a fast was or was not used). */
  fastingLimitReason: string;
  /** Tiers usable by the planner given eligibility and consent. */
  fastTierAllowed: Record<FastTier, boolean>;
  /**
   * The fasting tier the user opted into (explicit opt-in, implied by the screening's effective cap, or the profile flag),
   * null without one — consent only; eligibility and the user's longest fast are in `fastTierAllowed` / `maxFastH`
   * (ruling R-FAST-GATE: fasting structures are offered when a tier is opted in).
   */
  fastingOptIn: 'T2' | 'T3' | 'T4' | null;
  /** Minimum daily eating window, h (HC-F5, R1, max-fast lock). */
  minWindowH: number;
  exercise: { allowed: boolean; lightModerateOnly: boolean; lowImpact: boolean; noVigorousOutdoor: boolean };
  /** Novice / sedentary progression limits apply (HC-X2 / HC-X3). */
  rtNovice: boolean;
  sedentaryStart: boolean;
  mode: 'M0' | 'R1' | 'R2' | 'H';
  flags: ReadonlySet<string>;
  optInLevers: ReadonlySet<string>;
  noWeightLossGoal: boolean;
  /** Plain-language reasons for every restriction beyond the defaults (feeds safety notes and explanations). */
  reasons: string[];
}

function lockValue(locks: ReadonlyArray<{ id: string; value?: number }>, id: string): number | undefined {
  let v: number | undefined;
  for (const l of locks) if (l.id === id && typeof l.value === 'number' && Number.isFinite(l.value)) v = v === undefined ? l.value : v;
  return v;
}

function hasLock(locks: ReadonlyArray<{ id: string; value?: number }>, id: string): boolean {
  return locks.some((l) => l.id === id);
}

/**
 * Compile the 17 bounds for a person. Pure; deterministic. `input` may be undefined (then only profile rules apply).
 */
export function compileSafetyCaps(rp: ResolvedProfile, input: PlannerSafetyInput | undefined, practical?: PracticalConstraints): SafetyCaps {
  const reasons: string[] = [];
  const sex: 'male' | 'female' = rp.sex === 'female' ? 'female' : 'male';
  const age = rp.ageYears;
  const bmi = rp.body.bmi;
  const bf = rp.body.bodyFatPct;
  const bfFloor = HC.bfFloorPct[sex];
  const whtr = Number.isFinite(rp.body.whtr) ? rp.body.whtr : NaN;
  const waist = rp.input.body.waistCm ?? rp.body.circumferences?.waistCm ?? NaN;
  const pf = rp.safety.flags;
  const flags = new Set<string>(input?.flags ?? []);
  const locks = input?.plannerLocks ?? [];
  const mode: SafetyCaps['mode'] = input?.mode ?? rp.safety.mode ?? 'M0';
  const restr = new Set(input?.restrictions ?? []);
  if (mode === 'R1') restr.add('R1');
  if (mode === 'R2') restr.add('R2');
  const rwKg = Math.min(rp.weightKg, 27.5 * rp.heightM * rp.heightM);

  // ---- hard blocks (HC-P1, HC-P2, HC-P6, mode H)
  let blocked: string | null = null;
  if (input?.plannerAccess === 'blocked' || mode === 'H') blocked = 'The planner is not available for this profile (safety screening).';
  // fails closed: an age that is not a number (a damaged or imported profile) cannot pass the adults-only gate
  if (!(age >= 18)) blocked = 'The planner is for adults only (see Evidence › Safety limits).';
  if (pf.pregnantOrBreastfeeding) blocked = 'The planner is off during pregnancy and breastfeeding (see Evidence › Safety limits).';
  const med = pf.diabetesMedication;
  if (pf.type1Diabetes || med === 'insulin' || med === 'sulfonylurea' || med === 'sglt2')
    blocked = 'The planner is off with type 1 diabetes or insulin, sulfonylurea or SGLT2-inhibitor treatment (see Evidence › Safety limits).';

  // ---- deficit cap (17 §2.3)
  let cap: number = HC.deficitCapPct.default;
  if (bmi >= 30) cap = HC.deficitCapPct.bmiGe30;
  if (bmi < 25) cap = HC.deficitCapPct.bmiLt25;
  if (age >= 65) cap = Math.min(cap, HC.deficitCapPct.ageGe65);
  if (bf <= bfFloor + 4) cap = Math.min(cap, HC.deficitCapPct.leanWithin4);
  const lockCap = lockValue(locks, 'deficit-cap');
  if (lockCap !== undefined && lockCap < cap) {
    cap = lockCap;
    reasons.push(`Energy deficit limited to ${lockCap} % by your safety screening.`);
  }
  let noDeficit = hasLock(locks, 'no-deficit') || restr.has('R1');
  if (bmi < HC.bmi.startDeficitMin) {
    noDeficit = true;
    reasons.push('No energy deficit: BMI is below 20 (see Evidence › Safety limits).');
  }
  if (bf < bfFloor + 2) {
    noDeficit = true;
    reasons.push(`No energy deficit: estimated body fat is within 2 points of the ${bfFloor} % floor (see Evidence › Safety limits).`);
  }
  if (age >= 75 || (pf.sarcF ?? 0) >= 4) {
    noDeficit = true;
    reasons.push('No energy deficit at age 75+ or with a SARC-F score of 4 or more (see Evidence › Safety limits).');
  }
  if (restr.has('R2') || pf.cardiovascularOrBp || pf.liverDisease) cap = Math.min(cap, 15);
  if (pf.planningPregnancy) noDeficit = true;
  if (noDeficit) cap = 0;

  // ---- rate cap (17 §2.3)
  let rate: number = HC.rateCapPct.default;
  if (bf <= bfFloor + 6) rate = HC.rateCapPct.leanWithin6;
  if (bmi >= 30 || bf >= (sex === 'male' ? 30 : 40)) rate = HC.rateCapPct.highAdiposity;
  if (age >= 65 && age < 75) rate = Math.min(rate, HC.rateCapPct.age65to74);
  if (pf.gout || pf.gallstones) rate = Math.min(rate, 0.5);
  const lockRate = lockValue(locks, 'rate-cap');
  if (lockRate !== undefined) rate = Math.min(rate, lockRate);
  const rateKg = Math.min((rate / 100) * rp.weightKg, HC.rateCapAbsKg);

  // ---- surplus (HC-E8)
  let surplusAllowed = true;
  if (waist > HC.surplus.blockWaistCm[sex] || whtr >= HC.surplus.blockWhtr || bmi >= HC.surplus.blockBmi) {
    surplusAllowed = false;
    reasons.push('No planned weight-gain surplus at this waist, waist-to-height ratio or BMI (see Evidence › Safety limits).');
  }
  const gainCap = whtr >= 0.5 && whtr < 0.6 ? HC.surplus.gainPctBwWkWhtr : HC.surplus.gainPctBwWk;

  // ---- protein (HC-M1/M2)
  let pFloor: number = age >= 65 ? HC.protein.floorAge65Maintenance : HC.protein.floor;
  let pFloorDef: number = HC.protein.floorDeficitOrAge65;
  // hard caps are 35 %E and 3.1 g/kg FFM (applied per day by repair); 2.2 g/kg RW is only a soft target (17 HC-M2)
  let pCap = Infinity;
  if (pf.kidneyDisease || flags.has('kidney-disease')) {
    pCap = Math.min(pCap, HC.protein.ckdCapRw);
    reasons.push('Protein capped at 1.3 g/kg (kidney disease; see Evidence › Safety limits).');
  }
  let lpFloor = lockValue(locks, 'protein-floor');
  if (practical?.proteinFloorGPerKg !== undefined && Number.isFinite(practical.proteinFloorGPerKg))
    lpFloor = Math.max(lpFloor ?? 0, practical.proteinFloorGPerKg);
  if (lpFloor !== undefined) {
    pFloor = Math.max(pFloor, lpFloor);
    pFloorDef = Math.max(pFloorDef, lpFloor);
  }
  const lpCap = lockValue(locks, 'protein-cap');
  if (lpCap !== undefined) pCap = Math.min(pCap, lpCap);
  if (pFloorDef > pCap) pFloorDef = pCap;
  if (pFloor > pCap) pFloor = pCap;

  // ---- fat (HC-M3 + lock)
  let fatFloor: number = HC.fat.minG;
  const lf = lockValue(locks, 'fat-floor');
  if (lf !== undefined) fatFloor = Math.max(fatFloor, lf);

  // ---- carbohydrate (HC-M4, HC-P3, 17 §4.2 keto exclusions)
  let carbFloor = 0;
  let keto = mode === 'M0' && !restr.has('R1') && !restr.has('R2');
  if (pf.kidneyDisease || pf.liverDisease || pf.gout || pf.pancreatitis || pf.fatOxidationDisorderOrPorphyria || med === 'sglt2' || pf.type1Diabetes)
    keto = false;
  if (hasLock(locks, 'no-ketogenic')) keto = false;
  if (!keto) carbFloor = HC.carbs.ketogenicG;
  if (restr.has('R1')) carbFloor = Math.max(carbFloor, 100);
  const lc = lockValue(locks, 'carb-floor');
  if (lc !== undefined) carbFloor = Math.max(carbFloor, lc);
  if (practical?.carbFloorGPerDay !== undefined && Number.isFinite(practical.carbFloorGPerDay)) carbFloor = Math.max(carbFloor, practical.carbFloorGPerDay);

  // ---- fasting tiers (HC-F1, 17 §4.3.2 / §4.3.4)
  // consent: explicit opt-in, else implied by the screening's effective cap (> 24 h ⇒ T2, > 48 h ⇒ T3), else the profile flag
  const capH = input?.fasting?.maxFastHours;
  const impliedTier = capH === undefined ? null : capH > HC.tierMaxH.T3 ? 'T4' : capH > HC.tierMaxH.T2 ? 'T3' : capH > HC.tierMaxH.T1 ? 'T2' : null;
  const optTier = input?.optIns?.fastingTier ?? impliedTier ?? (pf.fastingOptIn && pf.fastingOptIn !== 'none' ? pf.fastingOptIn : null);
  const exAll12 = pf.pregnantOrBreastfeeding || pf.planningPregnancy || restr.has('R1') || pf.eatingDisorderRisk || (med && med !== 'none') || pf.type1Diabetes;
  const exT2 =
    pf.kidneyDisease || pf.liverDisease || pf.cardiovascularOrBp || pf.gout || pf.fatOxidationDisorderOrPorphyria || pf.heavyAlcoholUse ||
    pf.acuteIllnessLast4Weeks || pf.medicationInteraction || restr.has('R2');
  const exT3 = exT2 || pf.kidneyStones || pf.gallstones;
  const tiers: Record<FastTier, boolean> = { T0: true, T1: true, T2: false, T3: false, T4: false, T5: false };
  if (exAll12 || pf.heavyAlcoholUse || pf.acuteIllnessLast4Weeks) tiers.T1 = false;
  if (!exAll12 && !exT2 && age < 65 && (optTier === 'T2' || optTier === 'T3' || optTier === 'T4') && bmi >= HC.tierBmiMin.T2 && bf >= bfFloor + 2)
    tiers.T2 = true;
  if (tiers.T2 && !exT3 && (optTier === 'T3' || optTier === 'T4') && bmi >= HC.tierBmiMin.T3 && bf >= HC.t3BfMinPct[sex]) tiers.T3 = true;
  // T4 (> 72 h to 7 d): expert mode with clinician attestation (ruling 18:10; the UI keeps it flagged off), BMI ≥ 25, no
  // medication (17 §4.3.2 T4 row) and T3 eligibility; T5 (> 7 d) is never prescribed.
  if (tiers.T3 && input?.expertMode === true && optTier === 'T4' && bmi >= HC.tierBmiMin.T4 && !(med && med !== 'none') && !pf.medicationInteraction)
    tiers.T4 = true;
  let maxFast = exAll12 ? 12 : tiers.T4 ? HC.tierMaxH.T4 : tiers.T3 ? HC.tierMaxH.T3 : tiers.T2 ? HC.tierMaxH.T2 : tiers.T1 ? HC.tierMaxH.T1 : HC.tierMaxH.T0;
  const profileMaxFast = maxFast;
  const userFast = practical?.maxFastHours;
  if (userFast !== undefined && Number.isFinite(userFast)) maxFast = Math.min(maxFast, userFast);
  const lockFast = lockValue(locks, 'max-fast');
  if (lockFast !== undefined) maxFast = Math.min(maxFast, lockFast);
  const inFast = input?.fasting?.maxFastHours;
  if (inFast !== undefined && Number.isFinite(inFast)) maxFast = Math.min(maxFast, inFast);
  // a tier is usable only when the effective cap reaches into it
  if (maxFast <= HC.tierMaxH.T0) tiers.T1 = false;
  if (maxFast <= HC.tierMaxH.T1) tiers.T2 = false;
  if (maxFast <= HC.tierMaxH.T2) tiers.T3 = false;
  if (maxFast <= HC.tierMaxH.T3) tiers.T4 = false;
  if (exAll12) reasons.push('No fasting longer than 12 hours for this profile (see Evidence › Safety limits).');
  const fastingLimitReason = exAll12
    ? 'fasting beyond 12 hours is excluded for your profile by the safety screening'
    : userFast !== undefined && userFast < profileMaxFast
      ? `you set your longest acceptable fast to ${Math.round(userFast)} hours`
      : maxFast <= HC.tierMaxH.T1
        ? 'fasts longer than 24 hours need an opt-in in your safety settings'
        : maxFast <= HC.tierMaxH.T3
          ? `your fasting opt-in allows fasts up to ${Math.round(maxFast)} hours`
          : 'expert mode allows fasts up to 7 days';

  // ---- eating window (HC-F5)
  const shortWin = !!(input?.optIns?.shortEatingWindow && (input?.fasting?.shortWindowAvailable ?? true));
  let minWindow: number = shortWin ? HC.window.optInMin : HC.window.defaultMin;
  if (restr.has('R1')) minWindow = Math.max(minWindow, HC.window.r1Min);
  const lw = lockValue(locks, 'min-eating-window');
  if (lw !== undefined) minWindow = Math.max(minWindow, lw);
  if (maxFast < HC.tierMaxH.T0) minWindow = Math.max(minWindow, 24 - maxFast);

  // ---- exercise (HC-X2..X5, locks)
  const exercise = {
    allowed: !hasLock(locks, 'no-exercise-prescription'),
    lightModerateOnly: hasLock(locks, 'exercise-light-moderate') || !!pf.exerciseRestriction || !!pf.faintingOrChestPain || !!pf.cardiovascularOrBp,
    lowImpact: hasLock(locks, 'exercise-low-impact'),
    noVigorousOutdoor: !!pf.hotClimate,
  };
  let creatineAllowed = !hasLock(locks, 'no-creatine') && !pf.kidneyDisease && !flags.has('kidney-disease');

  // E20: markers — numeric lab locks (blood-marker rules). Only the ones these caps can represent change the search;
  // the rest (fat, saturated fat, alcohol, added sugar, caffeine, potassium supplement) pass through for display.
  const lab = compileLabLocks(locks);
  if (lab.creatineOff && creatineAllowed) {
    creatineAllowed = false;
    reasons.push('The plan will not add creatine because of a blood result (your own use is not refused).');
  }
  let surplusPhaseMaxPct = !surplusAllowed ? 100 : waist > HC.surplus.cautionWaistCm[sex] || whtr >= HC.surplus.cautionWhtr ? 104.5 : HC.surplus.maxPctTdee;
  let maxPctTdee: number = surplusAllowed ? HC.surplus.maxPctTdee : 100;
  if (lab.surplusMaxPct !== undefined && lab.surplusMaxPct < maxPctTdee) {
    maxPctTdee = Math.max(100, lab.surplusMaxPct);
    surplusPhaseMaxPct = Math.min(surplusPhaseMaxPct, maxPctTdee);
    reasons.push(`Planned surplus kept to ${Math.round(maxPctTdee - 100)} % above maintenance because of a blood result.`);
  }
  reasons.push(...lab.displayReasons);

  return {
    blocked,
    sex,
    ageYears: age,
    bmi,
    bodyFatPct: bf,
    bfFloorPct: bfFloor,
    whtr,
    rwKg,
    weightKg: rp.weightKg,
    ffmKg: rp.ffm0Kg,
    tdee0Kcal: rp.tdee0Kcal,
    deficitCapPct: cap,
    rateCapPct: rate,
    rateCapKg: rateKg,
    surplusAllowed,
    gainCapPct: gainCap,
    maxPctTdee,
    surplusPhaseMaxPct,
    // HC-E1 applies to deficits only: when maintenance itself is below the floor, the effective planning floor is
    // maintenance (no deficit possible, maintenance allowed)
    energyFloorKcal: Math.min(HC.energyFloorKcal[sex], rp.tdee0Kcal),
    restrictedDayUpperKcal: HC.restrictedDay.upperKcal[sex],
    restrictedDayMinKcal: HC.restrictedDay.minKcal[sex],
    proteinFloorRw: pFloor,
    proteinFloorDeficitRw: pFloorDef,
    proteinCapRw: pCap,
    proteinCapGPerKgFfm: HC.protein.capGPerKgFfm,
    fatFloorG: fatFloor,
    carbFloorG: carbFloor,
    ketogenicAllowed: carbFloor < HC.carbs.ketogenicG,
    creatineAllowed,
    maxFastH: maxFast,
    fastingLimitReason,
    fastTierAllowed: tiers,
    fastingOptIn: optTier === 'T2' || optTier === 'T3' || optTier === 'T4' ? optTier : null,
    minWindowH: minWindow,
    exercise,
    rtNovice: rp.habits.trainingHistory === 'none' || rp.habits.trainingHistory === 'lt1y',
    sedentaryStart: rp.habits.sessionsPerWeek === 0,
    mode,
    flags,
    optInLevers: new Set(input?.optIns?.levers ?? []),
    noWeightLossGoal: hasLock(locks, 'no-weight-loss-goal') || restr.has('R1'),
    reasons,
  };
}

// E20: markers — lab locks written by the blood-marker rules (values in `LAB_LOCK_UNIT` of src/markers/types.ts).
/** Lab lock ids the caps represent; the others are recorded for display only. */
export const LAB_LOCKS_APPLIED = ['creatine-cap', 'surplus-cap'] as const;
export const LAB_LOCKS_DISPLAY_ONLY = ['fat-cap', 'satfat-cap', 'alcohol-cap', 'added-sugar-cap', 'caffeine-cap', 'potassium-supp-cap'] as const;

const LAB_DISPLAY_TEXT: Readonly<Record<(typeof LAB_LOCKS_DISPLAY_ONLY)[number], (v: number) => string>> = {
  'fat-cap': (v) => `Total fat kept under ${v} % of energy because of a blood result.`,
  'satfat-cap': (v) => `Saturated fat kept under ${v} % of energy because of a blood result.`,
  'alcohol-cap': (v) => (v <= 0 ? 'The plan adds no alcohol because of a blood result.' : `Alcohol kept to ${v} g a day or less because of a blood result.`),
  'added-sugar-cap': (v) => `Added sugar kept under ${v} % of energy because of a blood result.`,
  'caffeine-cap': (v) => `Caffeine kept to ${v} mg a day or less because of a blood result.`,
  'potassium-supp-cap': (v) =>
    v <= 0 ? 'The plan will not add a potassium supplement or salt substitute because of a blood result.' : `Potassium supplements kept to ${v} g a day or less because of a blood result.`,
};

/** Strictest (lowest) value of a lock, across duplicates. */
function minLock(locks: ReadonlyArray<{ id: string; value?: number }>, id: string): number | undefined {
  let v: number | undefined;
  for (const l of locks) if (l.id === id && typeof l.value === 'number' && Number.isFinite(l.value)) v = v === undefined ? l.value : Math.min(v, l.value);
  return v;
}

/**
 * Lab locks → what the caps can express. `creatine-cap` 0 ⇒ the planner adds no creatine (like 'no-creatine');
 * `surplus-cap` is a % of maintenance (values below 100 are read as "% above maintenance", the research's shape).
 */
export function compileLabLocks(locks: ReadonlyArray<{ id: string; value?: number }>): { creatineOff: boolean; surplusMaxPct?: number; displayReasons: string[] } {
  const creatine = minLock(locks, 'creatine-cap');
  const surplus = minLock(locks, 'surplus-cap');
  const displayReasons: string[] = [];
  for (const id of LAB_LOCKS_DISPLAY_ONLY) {
    const v = minLock(locks, id);
    if (v !== undefined) displayReasons.push(LAB_DISPLAY_TEXT[id](v));
  }
  const out: { creatineOff: boolean; surplusMaxPct?: number; displayReasons: string[] } = { creatineOff: creatine !== undefined && creatine <= 0, displayReasons };
  if (surplus !== undefined) out.surplusMaxPct = surplus < 100 ? 100 + Math.max(0, surplus) : surplus;
  return out;
}

/** Fasting tier permission for a planned zero-intake span of `h` hours (HC-F1, §10.3 tier data). */
export function fastAllowed(caps: SafetyCaps, h: number): boolean {
  if (h > caps.maxFastH + 1e-6) return false;
  return caps.fastTierAllowed[tierForHours(h)];
}
