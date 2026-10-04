/**
 * Signal bus (docs/MODEL_SPEC.md §4). Modules communicate ONLY through these scalar signals (plus the read-only
 * inputs). Every signal has exactly one writer. Whether a reader sees this hour's or the previous hour's value
 * follows from the evaluation order (MODEL_SPEC §3); `core/moduleRegistry.ts` checks declared reads against it.
 *
 * Naming: value + unit suffix. G = grams, GH = g/h, KcalH = kcal/h, KcalD = kcal/d, Kg, MmolL, UuMl (µU/mL),
 * H = hours, Frac = 0..1 fraction, Idx = 0..100 index, Rel = ratio to the person's own baseline (1 = baseline),
 * Mult = multiplier (1 = no effect). Daily signals (cadence 'day') are written in startDay/endOfDay.
 */

export type ModuleId =
  | 'moderators'
  | 'activity'
  | 'intake'
  | 'fasting'
  | 'energy'
  | 'fuel'
  | 'ketones'
  | 'composition'
  | 'muscle'
  | 'water'
  | 'cellular'
  | 'hormones'
  | 'appetite'
  | 'cardiometabolic'
  | 'wellbeing'
  | 'safety';

export interface SignalDef {
  readonly name: string;
  readonly unit: string;
  readonly writer: ModuleId;
  readonly cadence: 'hour' | 'day';
  readonly readers: readonly ModuleId[];
  readonly desc: string;
  /** Value before the first write (must be physiologically safe: stubs rely on it). */
  readonly init: number;
}

const s = <N extends string>(
  name: N,
  unit: string,
  writer: ModuleId,
  cadence: 'hour' | 'day',
  readers: readonly ModuleId[],
  init: number,
  desc: string,
): SignalDef & { readonly name: N } => ({ name, unit, writer, cadence, readers, init, desc });

/** The complete signal table. Order is irrelevant for semantics; it fixes the object's hidden class. */
export const SIGNAL_DEFS = [
  // ---- moderators (dossier 16)
  s('sleepDebtFastH', 'h', 'moderators', 'day', ['appetite', 'hormones'], 0, 'Fast sleep-debt state dF (16 §4.1.1)'),
  s('sleepDebtSlowH', 'h', 'moderators', 'day', ['wellbeing'], 0, 'Slow sleep-debt state dS (16 §4.1.1)'),
  s('siSleepMult', '1', 'moderators', 'day', ['cardiometabolic'], 1, 'Insulin-sensitivity multiplier from sleep debt (16 §4.0.1)'),
  s('mpsSleepMult', '1', 'moderators', 'day', ['muscle'], 1, 'MPS / RT-accretion multiplier from sleep debt (16 §4.0.1; = 09 f_sleep)'),
  s('testoSleepMult', '1', 'moderators', 'day', ['hormones'], 1, 'Testosterone multiplier from sleep debt, men (16 §4.0.1)'),
  s('partitionSleepShift', '1', 'moderators', 'day', ['composition'], 0, 'Added protein-energy share (P-ratio; added to p_E, not pCat) of loss from sleep debt in deficit (16 §4.0.1)'),
  s('lutealWeight', '0..1', 'moderators', 'day', ['energy', 'appetite', 'water'], 0, 'Luteal-phase weight s(d) incl. 2-d ramps (02 §4.3, 16 §4.5)'),
  s('cycleDay', 'd', 'moderators', 'day', ['water'], -1, 'Menstrual cycle day, 1-based (1 = first day of menses); −1 when not tracked / hormonal contraception / post-menopause'),
  s('stressLevel', '0..2', 'moderators', 'day', [], 0, 'Stress 0 low / 1 moderate / 2 high'),
  s('ageYears', 'y', 'moderators', 'day', ['energy', 'muscle', 'composition', 'wellbeing'], 30, 'Age, advanced daily'),

  // ---- activity (dossier 10, 09 §4.13)
  s('exEEKcalH', 'kcal/h', 'activity', 'hour', ['energy', 'appetite', 'safety'], 0, 'Net exercise EE this hour incl. EPOC / post-RT REE (10 §4.1-4.2, 09 §4.13)'),
  s('exSessionNetKcalH', 'kcal/h', 'activity', 'hour', ['safety'], 0, 'Session net EE only (gross − RMR), the EEE of energy availability'),
  s('exSessionNetKcalD', 'kcal/d', 'activity', 'day', ['wellbeing'], 0, "Yesterday's total session net EE (Σ exSessionNetKcalH over the day), written in activity's endOfDay; daily consumers read it instead of accumulating the hourly signal (review m10)"),
  s('stepsExtraKcalH', 'kcal/h', 'activity', 'hour', ['energy'], 0, 'Step energy above the habitual-steps baseline (10 §4.1, §4.14)'),
  s('exIntensityFrac', 'frac VO2max', 'activity', 'hour', ['intake', 'fuel', 'ketones', 'cellular'], 0, 'Mean exercise intensity this hour (0 at rest)'),
  s('exMinutesH', 'min', 'activity', 'hour', ['fuel', 'ketones', 'cellular'], 0, 'Exercise minutes in this hour'),
  s('exActiveMuscleKg', 'kg', 'activity', 'hour', ['fuel'], 0, 'Active skeletal-muscle mass of the current cardio bout'),
  s('exHardSession', '0/1', 'activity', 'hour', ['water', 'safety'], 0, 'A hard (≥85 % VO2max interval or to-failure RT) bout occurred this hour'),
  s('vo2maxMlKgMin', 'mL/kg/min', 'activity', 'day', ['fuel', 'cardiometabolic', 'wellbeing'], 40, 'Current VO2max (10 §4.8)'),
  s('mitoRel', 'rel', 'activity', 'day', [], 1, 'Mitochondrial oxidative capacity relative to baseline (10 §4.9)'),
  s('exPlannedKcalD', 'kcal/d', 'activity', 'day', ['energy'], 0, "Today's planned exercise EE (exEEKcalH estimate summed over DayInput.sessions), written in startDay"),
  s('aerobicIdx', '0..1', 'activity', 'day', ['composition'], 0, "Aerobic-activity index for 03's M_act (review M14): clamp(7-day trailing mean of net cardio session EE (exSessionNet, cardio sessions only) / 300 kcal/d, 0, 1); steps excluded (NEAT only); written in startDay (MODEL_SPEC §1.2 step 6)"),

  // ---- intake (04 §4.10/4.16/4.17, 03 §4.7A, 07 §4.1/4.2, 15 §4.2/4.10-4.12)
  s('raGlcGH', 'g/h', 'intake', 'hour', ['fuel'], 0, 'Glucose(-equivalent) appearance from the gut'),
  s('raFruGalGH', 'g/h', 'intake', 'hour', ['fuel'], 0, 'Fructose + galactose appearance (liver first pass in fuel)'),
  s('raProtGH', 'g/h', 'intake', 'hour', ['fuel', 'ketones', 'composition'], 0, 'Absorbed protein, unweighted'),
  s('raAaQGH', 'g/h', 'intake', 'hour', ['muscle', 'cellular'], 0, 'Lagged quality-weighted AA appearance A_lag (03 §4.7A)'),
  s('raFatGH', 'g/h', 'intake', 'hour', [], 0, 'Absorbed fat (long + medium chain)'),
  s('raMctGH', 'g/h', 'intake', 'hour', ['ketones'], 0, 'Absorbed MCT'),
  s('alcOxGH', 'g/h', 'intake', 'hour', ['fuel', 'energy'], 0, 'Ethanol oxidised this hour (zero-order queue, 15 §4.10)'),
  s('etohPoolG', 'g', 'intake', 'hour', ['ketones', 'muscle', 'safety'], 0, 'Ethanol not yet oxidised'),
  s('exoKetoneMmolH', 'mmol/h', 'intake', 'hour', ['ketones'], 0, 'Exogenous ketone appearance (D-BHB)'),
  s('eAbsKcalH', 'kcal/h', 'intake', 'hour', ['composition', 'energy', 'fuel'], 0, 'Metabolisable energy appearing this hour (all macros, fibre/nut ME corrections)'),
  s('absFluxKcalH', 'kcal/h', 'intake', 'hour', [], 0, 'Total absorptive energy flux used for the fed/fasted state (07 §4.1)'),
  s('insulinUuMl', 'µU/mL', 'intake', 'hour', ['fuel', 'cellular', 'cardiometabolic'], 7, 'Plasma insulin, hour mean (04 §4.17 + 05 basal term)'),
  s('insulinBasalUuMl', 'µU/mL', 'intake', 'hour', ['cellular'], 7, 'Basal (fasting) insulin Ins_f·(05 basal-decline factor) this hour, without meal excursions (04 §4.17; for 08 dI = insulinUuMl − insulinBasalUuMl)'),
  s('insulinRel', 'rel', 'intake', 'hour', ['hormones'], 1, "Insulin relative to the person's own overnight trough (lowest hourly insulin of the last burn-in day, dinner tail included; latched at the end of burn-in), so the overnight value is ≈ 1 at baseline (hormones' SHBG proxy). 05's ketone proxy I is `insulinRefRel`"),
  s('insulinRefRel', 'rel', 'intake', 'hour', ['ketones'], 1, "05's insulin proxy I (05 §4.4, §4.17) on intake's absorption rates: IR·(I_b + 0.12·Ra_C + 0.04·Ra_P)·(1 − 0.3·x), I_b = the basal-decline factor (05 liver factor / 07 §4.4.3 time course), IR = S_hep^−0.9 — the calibration domain of 05's lipolysis/ketogenesis (ruling R-KET) — integrator A2"),

  s('glucoseMmolL', 'mmol/L', 'intake', 'hour', ['cardiometabolic'], 5, 'Plasma glucose, hour mean (04 §4.16)'),
  s('fedState', '0/1', 'intake', 'hour', ['safety'], 0, 'Absorptive state (07 §4.1: flux ≥ 30 kcal/h)'),
  s('hoursPostAbsorptiveH', 'h', 'intake', 'hour', ['cardiometabolic'], 12, 'tPA: hours since the absorptive state ended (07 §4.2)'),
  s('hoursSinceMealH', 'h', 'intake', 'hour', ['cellular', 'hormones'], 12, 'hFast: reset by protein ≥10 g or net carb ≥15 g (08 §4.10)'),
  s('hoursSinceIntakeH', 'h', 'intake', 'hour', ['safety', 'appetite'], 12, 'fast_h: hours since last intake > 50 kcal (17 §2.1)'),
  s('carbAbs24G', 'g', 'intake', 'hour', ['water', 'ketones', 'cardiometabolic', 'fasting'], 250, 'Net carbohydrate eaten in the last 24 h'),
  s('kcalEaten24', 'kcal', 'intake', 'hour', ['ketones', 'fasting'], 2000, 'Energy eaten in the last 24 h'),
  s('caffeineLoadMg', 'mg', 'intake', 'hour', ['moderators', 'energy'], 0, 'Caffeine body load (15 §4.11)'),
  s('creatineSatFrac', '0..1', 'intake', 'day', ['water', 'muscle'], 0, 'Creatine saturation x/x_max (15 §4.12)'),
  s('fibreEffG', 'g/d', 'intake', 'day', ['water', 'appetite'], 16, 'Gut-lagged fibre exposure F_eff (15 §4.2)'),

  // ---- fasting (20: owner of the zero-intake regime)
  s('fastActive', '0/1', 'fasting', 'hour', ['energy', 'fuel', 'composition', 'water', 'safety', 'wellbeing'], 0, 'Water-only / modified-fast overlay active (20 §4.1, §4B.1)'),
  s('fastHoursH', 'h', 'fasting', 'hour', ['safety'], 0, 'tFast: hours since the fast overlay started'),
  s('fastRmrMult', '1', 'fasting', 'hour', ['energy'], 1, '(1 + A_SNS)·(1 − φ_AT·s_AT) applied to RMR; replaces AT_R while active or |mult − 1| > 0.001 (20 §4.2)'),
  s('fastProtOxGH', 'g/h', 'fasting', 'hour', ['composition', 'fuel'], 0, 'Protein oxidised while fasting (20 §4.4 N model × 6.25)'),
  s('fastRepletionGH', 'g/h', 'fasting', 'hour', ['composition'], 0, 'Labile-protein repletion after refeeding (20 §4.4)'),
  s('fastOedemaL', 'L', 'fasting', 'hour', ['water'], 0, 'Refeeding oedema after fasts > 3 d (20 §4.5.2)'),

  // ---- energy (02; 11 §4.5 TH_C; 15 caffeine/alcohol/fibre coefficients)
  s('teePreKcalH', 'kcal/h', 'energy', 'hour', ['fuel', 'composition'], 90, 'TEE excluding tissue-deposition costs and DNL heat'),
  s('rmrKcalH', 'kcal/h', 'energy', 'hour', ['activity'], 70, 'Resting metabolic rate incl. AT_R, k_P, C_comp, modifiers'),
  s('atKcalD', 'kcal/d', 'energy', 'day', ['safety'], 0, 'Adaptive thermogenesis AT_R + AT_N (≤ 0 in deficit)'),
  s('maintenanceKcalD', 'kcal/d', 'energy', 'day', ['composition', 'cellular', 'safety', 'fasting'], 2200, 'Instantaneous maintenance EI_inst at habitual activity (02 §4.13)'),
  s('tdeeEstKcalD', 'kcal/d', 'energy', 'day', ['composition', 'hormones', 'appetite', 'ketones', 'safety', 'fasting'], 2200, "Today's TDEE estimate (yesterday's TDEE with today's planned exercise)"),

  // ---- fuel (04; 01 accounting)
  s('liverGlycogenG', 'g', 'fuel', 'hour', ['intake', 'ketones', 'cellular', 'water'], 80, 'Liver glycogen G_L'),
  s('muscleGlycogenG', 'g', 'fuel', 'hour', ['water', 'wellbeing'], 400, 'Whole-body muscle glycogen G_M'),
  s('muscleGlycogenRel', 'rel', 'fuel', 'hour', ['cellular', 'muscle'], 1, 'G_M relative to the fed reference'),
  s('muscleGlycogenExDefFrac', '0..1', 'fuel', 'hour', ['ketones'], 0, 'Exercise-driven muscle-glycogen deficit: glycogen removed by exercise/RT bouts and not yet resynthesised, as a fraction of the fed reference (05 §4.3 δ_M restricted to exercise-driven depletion; resting and fasting glycogenolysis excluded) — integrator A2, ketone runaway fix'),
  s('liverGlycogenMaxG', 'g', 'fuel', 'day', ['ketones'], 117.45, 'Liver-glycogen capacity G_L,max = c_L,max·V_liv·0.162 g/mmol (04 §4.1), written in init/startDay; ketones sets its partition half-point G50 = g50Frac·G_L,max (05 §4.4 coupling note) — integrator A2'),
  s('choOxGH', 'g/h', 'fuel', 'hour', [], 8, 'Net carbohydrate oxidation'),
  s('fatOxGH', 'g/h', 'fuel', 'hour', [], 3, 'Net fat oxidation (residual)'),
  s('protOxGH', 'g/h', 'fuel', 'hour', [], 3, 'Protein oxidised (absorbed − deposited)'),
  s('dnlFatGH', 'g/h', 'fuel', 'hour', [], 0, 'Whole-body net DNL, g fat/h'),
  s('dnlHeatKcalH', 'kcal/h', 'fuel', 'hour', ['composition', 'energy'], 0, 'Heat of net DNL (28 % of carbohydrate energy, 04 §4.13)'),
  s('gngGH', 'g/h', 'fuel', 'hour', ['energy'], 5, 'Gluconeogenesis (amino acids + glycerol), g glucose/h'),
  s('glycogenChangeKcalH', 'kcal/h', 'fuel', 'hour', ['composition'], 0, 'ρG·ΔG this hour (energy moved into glycogen)'),
  s('rqHour', '1', 'fuel', 'hour', [], 0.85, 'Respiratory quotient this hour'),

  // ---- ketones (05)
  s('tkbMmolL', 'mmol/L', 'ketones', 'hour', [], 0.25, 'Total ketone bodies'),
  s('bhbMmolL', 'mmol/L', 'ketones', 'hour', ['appetite', 'safety', 'cardiometabolic', 'fasting'], 0.1, 'Blood BHB as read by a meter'),
  s('bhbEndoMmolL', 'mmol/L', 'ketones', 'hour', ['cellular', 'composition', 'fasting'], 0.1, 'Endogenous BHB (exogenous ketones excluded; 08 rule)'),
  s('ffaMmolL', 'mmol/L', 'ketones', 'hour', [], 0.5, 'Plasma FFA'),
  s('ketoAdaptFast', '0..1', 'ketones', 'hour', ['fuel', 'wellbeing'], 0, 'A_f fast keto/fat adaptation (05 §4.11)'),
  s('ketoAdaptSlow', '0..1', 'ketones', 'hour', [], 0, 'A_s slow ketone-kinetics adaptation'),
  s('ketoneLossKcalH', 'kcal/h', 'ketones', 'hour', ['composition'], 0, 'Urinary ketone energy loss'),
  s('brainKetoneShare', '0..1', 'ketones', 'hour', ['fuel'], 0.03, 'Share of brain energy from ketones'),

  // ---- composition (01, 03, 11, 14 via body)
  s('fatMassKg', 'kg', 'composition', 'hour', ['energy', 'hormones', 'cardiometabolic', 'wellbeing', 'safety', 'water', 'fasting'], 20, 'Fat mass FM'),
  s('leanTissueKg', 'kg', 'composition', 'hour', ['energy', 'water'], 45, 'Lean tissue LT (Hall convention, excludes glycogen and labile water)'),
  s('ffmActKg', 'kg', 'composition', 'hour', ['energy', 'muscle', 'ketones', 'wellbeing', 'hormones', 'cellular', 'fasting', 'safety'], 60, 'Metabolically active FFM (FFM0 + ΔLT)'),
  s('tissueMassKg', 'kg', 'composition', 'hour', ['water', 'safety', 'energy', 'appetite', 'activity', 'intake', 'muscle', 'ketones', 'cardiometabolic'], 80, 'FM + FFM_act (weight without glycogen/labile-water deviations)'),
  s('skeletalMuscleKg', 'kg', 'composition', 'day', ['fuel', 'muscle', 'wellbeing'], 30, 'Skeletal muscle mass'),
  s('tissueEnergyKcalH', 'kcal/h', 'composition', 'hour', ['safety'], 0, 'Energy stored in tissues this hour, S_h'),
  s('depositionCostKcalH', 'kcal/h', 'composition', 'hour', ['energy'], 0, 'η_F·dFM + η_L·dLT this hour'),
  s('leanRateKgD', 'kg/d', 'composition', 'day', ['fuel'], 0, "Planned lean-tissue change for today (protein deposition for protein oxidation)"),
  s('energyBalanceFrac', '1', 'composition', 'day', ['muscle', 'moderators', 'cellular', 'cardiometabolic'], 0, "u = (EI − TEE_est)/TEE_est for today, clamped to [−1, 1]"),
  s('energyBalance7KcalD', 'kcal/d', 'composition', 'day', ['cardiometabolic', 'water'], 0, 'EB7: trailing 7-day mean (boxcar) of the planned balance EI − TEE_est incl. today (11 §4.15; MODEL_SPEC §1.8 step 1)'),
  s('vatKg', 'kg', 'composition', 'day', [], 1.5, 'Visceral adipose tissue'),

  // ---- muscle (09, 03)
  s('rtAccretionKgD', 'kg/d', 'muscle', 'day', ['composition'], 0, 'Σ A_r − Σ D_r for tomorrow (09 §4.9-4.10)'),
  s('rtRetentionFrac', '0..1', 'muscle', 'day', ['composition'], 0, 'R_RT: share of non-RT lean loss prevented (09 §4.8)'),
  s('rtDoseFrac', '0..1', 'muscle', 'day', ['composition'], 0, 'min(1, V_wb/V_R(age)): RT dose relative to the retention dose (09 §4.8; RT index for 03 ΔL_age and the M_RT-free partition) — composition reads it instead of copying V_R'),
  s('smRtKg', 'kg', 'muscle', 'day', ['energy'], 0, 'Training-attributable skeletal muscle gained since t = 0, 0.7·Σ(M_acc − M_acc,0) (SM_RT for 02 γ_SM)'),
  s('fatFloorActive', '0..1', 'composition', 'hour', ['safety'], 0, 'Smooth fat-mass floor engaged (review M9): 1 − clamp((FM − FM_min)/1 kg, 0, 1), FM_min = 0.02·BW0; > 0 means part of the fat share of a negative balance is taken from lean tissue (MODEL_SPEC §1.8 step 4b)'),
  s('rtVolumeWb', 'sets/wk', 'muscle', 'day', ['composition'], 0, 'V_wb: muscle-mass-weighted weekly effective sets (s_RT = min(1, V_wb/12) for 11 §4.7; RT for 03 ΔL_age)'),
  s('mpsStimWb', '0..1.6', 'muscle', 'hour', ['cellular'], 0, 'Whole-body post-exercise MPS elevation S_mps (09 §4.4)'),
  s('trainingStatus', '0..1', 'muscle', 'day', ['activity'], 0, 'Whole-body training status TS'),

  // ---- water (13, 15, 04)
  s('labileWaterKg', 'kg', 'water', 'hour', ['safety', 'wellbeing'], 0, 'All labile mass deviations: (1 + h)·ΔG (glycogen and its water) + ECF + gut + oedema + PV + cycle + creatine − H_def; scale = tissueMass + labileWater'),
  s('scaleWeightKg', 'kg', 'water', 'hour', ['safety', 'activity'], 80, 'Displayed scale weight (13 §4.1)'),
  s('hydrationDeficitKg', 'kg', 'water', 'hour', ['safety'], 0, 'Acute hydration deficit H_def (15 §4.8)'),

  // ---- cellular (08)
  s('asiIdx', '0..100', 'cellular', 'hour', [], 20, 'Autophagy Signal Index (08 §4.10)'),

  // ---- hormones (12, 08 IGF-1)
  s('leptinRel', 'rel', 'hormones', 'day', [], 1, 'Leptin relative to baseline'),
  s('leptinSuffFM', '0..1', 'hormones', 'day', ['appetite'], 0.9, 'S_L(L_FM) leptin sufficiency of fat-mass leptin'),
  s('leptinSuff0', '0..1', 'hormones', 'day', ['appetite'], 0.9, 'S_L(L0) at baseline'),
  s('t3Rel', 'rel', 'hormones', 'day', [], 1, 'Total T3 relative'),
  s('testosteroneRel', 'rel', 'hormones', 'day', [], 1, 'Total testosterone relative (men)'),
  s('reproRiskFemale', '0..1', 'hormones', 'day', [], 0, 'Probability of menstrual disturbance per cycle (women)'),
  s('igf1Rel', 'rel', 'hormones', 'day', [], 1, 'IGF-1 relative (08 §4.12)'),

  // ---- appetite (12)
  s('hungerIdx', '0..100', 'appetite', 'day', ['safety'], 6, 'Hunger Pressure Index HPI'),
  s('dietFatigue', '0..1', 'appetite', 'day', [], 0, 'Diet-fatigue state F'),

  // ---- cardiometabolic (06, 04 §4.18-4.19)
  s('sHep', 'rel', 'cardiometabolic', 'day', ['intake'], 1, 'Hepatic insulin sensitivity'),
  s('sMus', 'rel', 'cardiometabolic', 'day', ['intake', 'fuel'], 1, 'Peripheral (muscle) insulin sensitivity'),
  s('carbTolerance', '0..1', 'cardiometabolic', 'day', ['intake', 'fuel'], 1, 'T_C carbohydrate-tolerance state (04 §4.19)'),
  s('insulinResistanceIdx', '0..1', 'cardiometabolic', 'day', ['energy'], 0, 'IR index for 02 m_IR and 05 IR scaling'),
  s('liverFatPct', '%', 'cardiometabolic', 'day', [], 5, 'Intrahepatic triglyceride'),

  // ---- wellbeing (19, 15 §4.9, 13 §4.10)
  s('eaKcalKgFfm', 'kcal/kg FFM/d', 'wellbeing', 'day', ['safety'], 45, 'Energy availability, smoothed EA_s (19 §4.1)'),
  s('ea7KcalKgFfm', 'kcal/kg FFM/d', 'wellbeing', 'day', ['safety'], 45, 'Energy availability 7-day mean (17 EA_7)'),
  s('ketoInduction', '0..1', 'wellbeing', 'day', ['appetite', 'safety'], 0, 'Keto-induction symptom load Φ_ind (13 §4.10)'),
  s('strengthEaMult', '1', 'wellbeing', 'day', ['muscle'], 1, 'Strength-capacity multiplier M_EA from low energy availability (19 §4.3)'),

  // ---- safety (17)
  s('safetyAbort', '0/1', 'safety', 'day', [], 0, 'Set when a planner abortOn bound is crossed (planner mode only)'),
] as const satisfies readonly SignalDef[];

export type SignalName = (typeof SIGNAL_DEFS)[number]['name'];

/** The bus: one flat, monomorphic object of numbers. Create with `createSignalBus()`, never with a literal. */
export type SignalBus = { -readonly [K in SignalName]: number };

/**
 * Allocates the bus once per run with every signal at its safe initial value.
 * Built with `Object.fromEntries` so V8 gives it fast (in-object/descriptor) properties and the same hidden class on
 * every run (monomorphic module call sites across planner evaluations). Adding 114 properties one by one with keyed
 * stores (the previous implementation) put the object into dictionary mode and roughly doubled every module's step
 * cost (CONTRACT_REQUESTS, performance). No `eval`/`new Function` (CSP). Regression-tested in core/__tests__.
 */
export function createSignalBus(): SignalBus {
  return Object.fromEntries(SIGNAL_DEFS.map((d) => [d.name, d.init])) as SignalBus;
}

/** Reset every signal to its initial value in place (for engine reuse across planner evaluations). */
export function resetSignalBus(bus: SignalBus): void {
  const b = bus as Record<string, number>;
  for (const d of SIGNAL_DEFS) b[d.name] = d.init;
}

export const SIGNAL_BY_NAME: ReadonlyMap<string, SignalDef> = new Map(SIGNAL_DEFS.map((d) => [d.name, d]));
