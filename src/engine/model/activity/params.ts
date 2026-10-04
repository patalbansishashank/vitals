/**
 * Parameter registry of the activity module (MODEL_SPEC §1.2; dossier 10 §4.1-4.3, §4.8-4.9, §4.14, §4.17; 09 §4.13).
 * Every constant is one ParamDef; `prepare()` copies them into the constants object (never read in the step loop).
 * Grades follow the dossier: METs/units and the ACSM/Ludlow equations A, per-step and run defaults B, sport/RT MET C,
 * EPOC magnitude A-/B (kinetics C), VO2max dose function and mitochondria B/C (PROPOSED FIT).
 * Where the dossier gives no range for a PROPOSED number the range is ±30 % (rounded) and the note says so.
 */
import type { ParamDef } from '../../types/params';

const P = (
  name: string,
  value: number,
  unit: string,
  low: number,
  high: number,
  grade: ParamDef['grade'],
  source: string,
  dossier: string,
  status: NonNullable<ParamDef['status']>,
  extra: Pick<ParamDef, 'draw' | 'note' | 'label'> = {},
): ParamDef => ({ id: `activity.${name}`, value, unit, low, high, grade, source, dossier, status, ...extra });

/** A structural / definitional constant: never varied in draws. */
const FIX = (
  name: string,
  value: number,
  unit: string,
  grade: ParamDef['grade'],
  source: string,
  dossier: string,
  status: NonNullable<ParamDef['status']>,
  note?: string,
): ParamDef => P(name, value, unit, value, value, grade, source, dossier, status, { draw: 'fixed', ...(note ? { note } : {}) });

const NO_RANGE = 'range ±30 % (rounded): the dossier gives none for this PROPOSED number';

export const ACTIVITY_PARAMS: readonly ParamDef[] = [
  // ---- energy of a bout (10 §4.1)
  P('kcalPerLO2', 5.0, 'kcal/L O2', 4.686, 5.047, 'A', 'Manini 2010 PMID 19698803: 4.686 at RQ 0.707, 5.047 at 1.00; MODEL_SPEC §1.2 fixes 5 kcal/L', '10 §4.1.1', 'verified', {
    label: 'Energy per litre of oxygen',
    note: 'MODEL_SPEC §1.2 step 2: gross = VO2 · 5 kcal/L; registry range = the RQ span of the Manini equation.',
  }),
  FIX('metVo2', 3.5, 'mL/kg/min per MET', 'A', 'Herrmann 2024 PMID 38242596 (1 MET = 3.5 mL O2/kg/min)', '10 §4.1.1', 'verified', 'Compendium convention; true resting VO2 is 2.6 ± 0.4 (Byrne 2005 PMID 15831804), handled by the net-of-own-RMR rule.'),
  FIX('walkIntercept', 3.85, 'mL/kg/min', 'A', 'Ludlow & Weyand 2016 PMID 26679617 (VO2 = VO2rest + 3.85 + 5.97·V²/H)', '10 §4.1.4', 'verified'),
  FIX('walkSlope', 5.97, 'mL/kg/min per (m/s)²/m', 'A', 'Ludlow & Weyand 2016 PMID 26679617', '10 §4.1.4', 'verified'),
  FIX('runVo2PerM', 0.2, 'mL/kg/m', 'B', 'ACSM running equation (TTU 2013; Hall 2004), net 0.2 mL/kg/m = 1.0 kcal/kg/km', '10 §4.1.5', 'verified'),
  P('runEff', 0.9, '1', 0.8, 1.0, 'B', 'Minetti 2002 PMID 12183501 (0.81 kcal/kg/km), Compendium (MET−1)/speed 0.83-0.91: default net 0.90 kcal/kg/km', '10 §4.1.5', 'proposed-fit', {
    label: 'Running economy factor (× ACSM net cost)',
  }),
  P('obesityWalkFactor', 1.1, '1', 1.05, 1.15, 'B', 'Browning 2006 PMID 16210434 (net walking cost per kg ≈ +10 % in class II obesity)', '10 §4.1.3-4.1.4', 'verified', {
    label: 'Walking and step cost factor at BMI ≥ 35',
  }),
  FIX('obesityBmi', 35, 'kg/m²', 'B', '10 §4.17 (obesityF applied at BMI ≥ 35)', '10 §4.17', 'verified'),
  FIX('cycleBaselineMult', 2.4, '× RMR', 'B', 'PROPOSED FIT to 11 Compendium stationary-cycling rows (R² 0.99), Herrmann 2024 PMID 38242596', '10 §4.1.6', 'proposed-fit'),
  P('cycleEff', 0.26, '1', 0.23, 0.28, 'B', 'PROPOSED FIT to the Compendium cycling-by-watts rows (net efficiency 26 %)', '10 §4.1.6', 'proposed-fit', {
    label: 'Cycling net mechanical efficiency',
  }),
  P('stepsNet', 0.44, 'kcal/kg/1000 steps', 0.36, 0.5, 'B', 'DERIVED from Ludlow & Weyand 2016 PMID 26679617 (cadence 110/min, step length 0.415·H)', '10 §4.1.4', 'proposed-fit', {
    label: 'Net cost of walking steps',
  }),
  P('displacedBaseline', 0.2, '× RMR', 0.2, 0.5, 'D', 'PROPOSED (10 §4.1.3: displaced sedentary time 0.2-0.5 × RMR/min, default 0.2)', '10 §4.1.3', 'proposed-fit', {
    label: 'Displaced lifestyle baseline during a bout',
  }),
  P('rtMetDefault', 4.0, 'MET', 3.0, 6.0, 'C', 'Herrmann 2024 PMID 38242596 / Melanson 2002 PMID 12439085: default 4.0 MET per 60-min session (range 3.0-6.0)', '10 §4.1.7; 09 §4.13', 'proposed-fit', {
    label: 'Resistance session MET when the session carries none',
    note: 'The compiler resolves style METs (3.5 / 5.0 / 6.0 / 5.8 / 3.0, core/defaults RT_STYLE_MET) into SessionResolved.met; this default only applies when a session has no MET.',
  }),
  FIX('habitCardioMet', 5.0, 'MET', 'C', 'Compendium elliptical moderate 5.0; core/resolveProfile HABIT_CARDIO_MET (habitual cardio session)', '10 §4.1.2', 'proposed-fit', 'Habitual cardio session MET used for the burn-in exercise energy and the habitual MEM.'),
  P('rpeIntercept', 0.25, 'frac VO2max', 0.2, 0.3, 'D', 'ENGINEERING DEFAULT: ACSM verbal anchors of the CR-10 scale (light 2, moderate 4, vigorous 6, near-maximal 8) mapped onto the 10 §4.8 MEM band edges 0.40/0.55/0.70/0.85', '10 §4.8', 'unverified', {
    label: 'RPE → %VO2max intercept',
    note: 'The spec cites a "10 §4.1 RPE mapping" that does not exist in the dossier (only an "RPE-band" input in §3): interim linear map x = 0.25 + 0.075·RPE (RPE 2 → 0.40 … 10 → 1.00). Range = ±20 %. Orchestrator ruling 2026-09-30 18:10: kept as an interim, unverified convention (evidence/known-misses note).',
  }),
  P('rpeSlope', 0.075, 'frac VO2max per RPE unit', 0.06, 0.09, 'D', 'ENGINEERING DEFAULT (see rpeIntercept)', '10 §4.8', 'unverified', {
    label: 'RPE → %VO2max slope',
  }),
  P('activeMuscleFrac', 0.4, '× SMM', 0.3, 0.5, 'D', 'MODEL_SPEC §1.2 step 4: cycling/running ≈ 0.40·SMM (04 §4.4 UNVERIFIED); range ±25 % (engineering)', '10 §4.5; 04 §4.4', 'unverified', {
    label: 'Active skeletal-muscle share of a cardio bout',
    note: 'Rejected alternative (different notion, review M20): 10 §4.5 "worked-muscle mass ≈ 20 kg for running/cycling" (≈ 0.6·SMM) is the whole working leg musculature, not the recruited mass.',
  }),

  // ---- EPOC (10 §4.2)
  P('epocPhiMax', 0.15, 'fraction of net', 0.06, 0.15, 'B', 'LaForgia 2006 PMID 17101527 (EPOC 6-15 % of the net cost); Borsheim 2003 PMID 14599232', '10 §4.2', 'proposed-fit', {
    label: 'EPOC fraction, continuous work (ceiling)',
  }),
  P('epocPhiMaxInterval', 0.2, 'fraction of net', 0.06, 0.25, 'B', 'Panissa 2021 PMID 32656951 (HIIE/SIT); HIIT plausible range 0.06-0.25 (10 §4.2 table)', '10 §4.2', 'proposed-fit', {
    label: 'EPOC fraction, interval work (ceiling)',
  }),
  P('epocPhiFloor', 0.02, 'fraction of net', 0, 0.04, 'B', 'Wilkin 2012 PMID 22446673 (walking EPOC returns to rest in ~10 min); 10 §4.2 light exercise 0-0.04', '10 §4.2', 'proposed-fit', {
    label: 'EPOC fraction floor (light exercise)',
  }),
  FIX('epocMidX', 0.68, 'frac VO2max', 'C', 'PROPOSED FIT S(x) = 1/(1 + exp(−(x − 0.68)/0.06)) to the 10 §4.2 anchors', '10 §4.2', 'proposed-fit'),
  FIX('epocSlopeX', 0.06, 'frac VO2max', 'C', 'PROPOSED FIT (see epocMidX)', '10 §4.2', 'proposed-fit'),
  FIX('epocDurRefMin', 45, 'min', 'C', 'PROPOSED FIT Dfac = min(1, dur/45)^0.7', '10 §4.2', 'proposed-fit'),
  FIX('epocDurExp', 0.7, '1', 'C', 'PROPOSED FIT (see epocDurRefMin)', '10 §4.2', 'proposed-fit'),
  P('epocRt', 0, 'fraction of net', 0, 0.1, 'C', 'Abboud 2013 PMID 23085971; Melanson 2002 PMID 12439085 (resistance EPOC 0-0.10)', '10 §4.2; 09 §4.13', 'proposed-fit', {
    label: 'EPOC fraction of a resistance session',
    note: 'Review m12 (accepted): post-RT REE 0.05·REE for 72 h (09 §4.13) IS the slow EPOC of resistance work, so the default is 0 and only one of the two terms is booked. 10 §4.2 / MODEL_SPEC §1.2 list 0.05 [0, 0.10]; set value 0.05 to restore it (then reduce postRtRee).',
  }),
  FIX('epocLightX', 0.5, 'frac VO2max', 'C', '10 §4.17 epocKcal: light = x < 0.5 (single fast component)', '10 §4.17', 'proposed-fit'),
  FIX('epocTauLightH', 0.15, 'h', 'C', 'Wilkin 2012 PMID 22446673 (10-15 min); 10 §4.2 light kinetics a1 = 1, τ1 = 0.15 h', '10 §4.2', 'proposed-fit'),
  FIX('epocTau1H', 0.4, 'h', 'C', 'PROPOSED kinetics, vigorous: a1 = 0.6, τ1 = 0.4 h (36 % remaining at 1 h)', '10 §4.2', 'proposed-fit'),
  FIX('epocTau2H', 4, 'h', 'C', 'PROPOSED kinetics, vigorous: τ2 = 4 h (5 % remaining at 8 h)', '10 §4.2', 'proposed-fit'),
  FIX('epocFastShare', 0.6, '1', 'C', 'PROPOSED kinetics, vigorous: a1 = 0.6', '10 §4.2', 'proposed-fit'),
  FIX('epocTrainedTauMult', 0.25, '1', 'C', 'Borsheim 2003 PMID 14599232: trained individuals τ × 0.75; 10 §4.9 τ × 0.75 at index ≥ 1.4 (factor = 1 − 0.25·clamp((M_c·M_r − 1)/0.4))', '10 §4.2, §4.9', 'proposed-fit'),
  FIX('epocTrainedIdxSpan', 0.4, '1', 'C', '10 §4.9: oxidative-capacity index 1.4 = fully trained', '10 §4.9', 'proposed-fit'),

  // ---- post-RT REE (09 §4.13)
  P('postRtRee', 0.05, 'fraction of REE', 0, 0.1, 'C', 'Heden 2011 PMID 20886227 (REE +5 % ≈ 96 kcal/d at 24-72 h), Schuenke 2002 PMID 11882927; range mirrors epocRt (09 gives none)', '09 §4.13', 'proposed-fit', {
    label: 'Post-resistance-session REE elevation',
  }),
  FIX('postRtHours', 72, 'h', 'C', 'Heden 2011 PMID 20886227 (elevated at 72 h)', '09 §4.13', 'proposed-fit'),
  FIX('postRtTsShield', 0.5, '1', 'C', '09 §4.13: ΔREE = 0.05·REE·(1 − 0.5·H_wb), H_wb read as the whole-body training status TS', '09 §4.13', 'proposed-fit', 'H_wb is not defined in dossier 09; trainingStatus (0..1) is the only whole-body training variable on the bus.'),

  // ---- VO2max: baseline (10 §4.8A) and dose-response (10 §4.8B-C)
  FIX('jacksonIntercept', 56.363, 'mL/kg/min', 'B', 'Jackson 1990 PMID 2287267 (R² 0.61, SEE 5.7)', '10 §4.8A', 'verified'),
  FIX('jacksonPar', 1.921, 'mL/kg/min per PA-R unit', 'B', 'Jackson 1990 PMID 2287267', '10 §4.8A', 'verified'),
  FIX('jacksonAge', -0.381, 'mL/kg/min per y', 'B', 'Jackson 1990 PMID 2287267', '10 §4.8A', 'verified'),
  FIX('jacksonBmi', -0.754, 'mL/kg/min per kg/m²', 'B', 'Jackson 1990 PMID 2287267', '10 §4.8A', 'verified'),
  FIX('jacksonSex', 10.987, 'mL/kg/min (male)', 'B', 'Jackson 1990 PMID 2287267 (sex: men 1, women 0; unspecified sex = half)', '10 §4.8A', 'verified'),
  P('parSedentary', 0.5, 'PA-R', 0, 1, 'C', '10 §4.14 selector 1 (steps ≈ 4 000 → PA-R 0-1): range midpoint', '10 §4.14', 'proposed-fit', { label: 'PA-R, sedentary selector' }),
  FIX('parLight', 2, 'PA-R', 'C', '10 §4.14 selector 2 (steps ≈ 6 500 → PA-R 2)', '10 §4.14', 'proposed-fit'),
  P('parModerate', 3.5, 'PA-R', 3, 4, 'C', '10 §4.14 selector 3 (steps ≈ 8 500 → PA-R 3-4): range midpoint', '10 §4.14', 'proposed-fit', { label: 'PA-R, moderately active selector' }),
  FIX('parActive', 5, 'PA-R', 'C', '10 §4.14 selector 4 (steps ≈ 11 000 → PA-R 5)', '10 §4.14', 'proposed-fit'),
  P('parVeryActive', 6.5, 'PA-R', 6, 7, 'C', '10 §4.14 selector 5 (steps ≈ 15 000 → PA-R 6-7): range midpoint', '10 §4.14', 'proposed-fit', { label: 'PA-R, very active selector' }),
  P('vo2GMax', 0.35, 'fraction of vSed', 0.25, 0.45, 'C', 'PROPOSED FIT to HERITAGE (Bouchard 1999 PMID 10484570; Ross 2019 PMID 30862704: +18 ± 9 %), Egan 2013 PMID 24069271', '10 §4.8B', 'proposed-fit', {
    label: 'Maximal VO2max gain fraction (dose-function ceiling)',
  }),
  P('vo2MemHalf', 130, 'MEM/wk', 100, 170, 'C', 'PROPOSED FIT (D(MEM) = MEM²/(MEM² + K²)); HERITAGE MEM ≈ 130 → +16.8 % at 20 wk', '10 §4.8B', 'proposed-fit', {
    label: 'Half-saturation of the VO2max dose function',
  }),
  FIX('vo2GCap', 0.6, 'fraction of vSed', 'B', 'HERITAGE maximum +51 % (Bouchard 1999 PMID 10484570): cap 0.60', '10 §4.8B', 'proposed-fit'),
  P('vo2SexF', 0.95, '1', 0.85, 1.0, 'C', 'Diaz-Canestro 2019 / Skinner 2001 (conflicting); HERITAGE ml/kg/min no sex difference = 1.0; 10 §4.8B default 0.95 (women)', '10 §4.8B', 'proposed-fit', {
    label: 'Sex factor of the VO2max response (women)',
    note: 'Low edge 0.85 is an engineering bound (men +1.95 mL/kg/min more than women in the meta-analysis).',
  }),
  P('vo2ResponseU', 0.5, 'quantile', 0, 1, 'C', 'Latent quantile of the individual VO2max responsiveness z ~ N(1, 0.5) truncated [0.2, 2.0] (Bouchard 1999 PMID 10484570: heritability of response 47 %)', '10 §4.8B', 'proposed-fit', {
    draw: 'uniform',
    label: 'Individual VO2max responsiveness (quantile)',
    note: 'z = clamp(1 + vo2ZSd·Φ⁻¹(u), vo2ZMin, vo2ZMax); nominal u = 0.5 → z = 1 (MODEL_SPEC §8.1 latent-quantile pattern).',
  }),
  FIX('vo2ZSd', 0.5, '1', 'C', '10 §4.8B z ~ N(1, 0.5)', '10 §4.8B', 'proposed-fit'),
  FIX('vo2ZMin', 0.2, '1', 'C', '10 §4.8B truncation [0.2, 2.0]', '10 §4.8B', 'proposed-fit'),
  FIX('vo2ZMax', 2.0, '1', 'C', '10 §4.8B truncation [0.2, 2.0]', '10 §4.8B', 'proposed-fit'),
  P('vo2TauF', 15, 'd', 12, 18, 'B', 'Hickson 1981 PMID 7219130 (t½ 10.3 and 10.8 d ⇒ τ ≈ 15 d); range ±20 % (engineering)', '10 §4.8C', 'proposed-fit', {
    label: 'VO2max fast-pool time constant',
  }),
  P('vo2TauS', 60, 'd', 40, 90, 'C', 'PROPOSED (reconciles the 3-wk plateau at fixed load with gains through 20-26 wk under progressive load); range engineering', '10 §4.8C', 'proposed-fit', {
    label: 'VO2max slow-pool time constant',
  }),
  P('vo2TauDn', 30, 'd', 20, 40, 'B', 'Coyle 1984 PMID 6511559 (−7 % at 21 d, −16 % at 56 d in athletes)', '10 §4.8C', 'proposed-fit', {
    label: 'VO2max detraining time constant',
  }),
  FIX('vo2FastShare', 0.55, '1', 'C', '10 §4.8C pools: 55 % fast / 45 % slow', '10 §4.8C', 'proposed-fit'),
  P('vo2RhoMax', 0.45, '1', 0.35, 0.55, 'C', 'PROPOSED retention floor ρ = 0.45·(1 − e^(−trainYears/2)), 2-point anchored (Coyle 1984 PMID 6511559; Mujika 2000 PMID 10999420); range ±20 % (engineering)', '10 §4.8C', 'proposed-fit', {
    label: 'Retained fraction of the training gain (asymptote)',
  }),
  FIX('vo2RhoYears', 2, 'y', 'C', '10 §4.8C ρ time scale (trainYears/2)', '10 §4.8C', 'proposed-fit'),
  FIX('vo2HiRefMinWk', 30, 'min/wk', 'B', 'Madsen 1993 PMID 8282588 (one 35-min high-intensity bout/wk keeps VO2max): m = min(1, HIminPerWeek/30)', '10 §4.8C', 'proposed-fit'),
  FIX('vo2DetrainShield', 0.9, '1', 'B', 'Madsen 1993 PMID 8282588: rate × (1 − 0.9·m)', '10 §4.8C', 'proposed-fit'),
  FIX('trainYearsLt1y', 0.5, 'y', 'D', 'ENGINEERING DEFAULT: midpoint of "< 1 y" (aerobic training history for ρ)', '10 §4.8C', 'unverified'),
  FIX('trainYears1to3y', 2, 'y', 'D', 'ENGINEERING DEFAULT: midpoint of "1-3 y"', '10 §4.8C', 'unverified'),
  FIX('trainYearsGt3y', 5, 'y', 'D', 'ENGINEERING DEFAULT: representative of "> 3 y"', '10 §4.8C', 'unverified'),

  // ---- moderate-equivalent minutes (10 §4.8B)
  FIX('memBand1', 0.4, 'frac VO2max', 'B', '10 §4.8B MEM weights: 0 below 0.40', '10 §4.8B', 'proposed-fit'),
  FIX('memBand2', 0.55, 'frac VO2max', 'B', '10 §4.8B', '10 §4.8B', 'proposed-fit'),
  FIX('memBand3', 0.7, 'frac VO2max', 'B', '10 §4.8B', '10 §4.8B', 'proposed-fit'),
  FIX('memW1', 0.4, 'MEM/min', 'B', '10 §4.8B weight 0.40-0.55', '10 §4.8B', 'proposed-fit'),
  FIX('memW2', 1.0, 'MEM/min', 'B', '10 §4.8B weight 0.55-0.70', '10 §4.8B', 'proposed-fit'),
  FIX('memW3', 1.5, 'MEM/min', 'B', '10 §4.8B weight ≥ 0.70 (continuous work; the interval weights 3.0/0.3 need a work:rest split the schedule does not carry)', '10 §4.8B', 'proposed-fit'),
  FIX('hardX', 0.85, 'frac VO2max', 'B', '10 §4.8B high-intensity threshold; MODEL_SPEC §1.2 step 4 exHardSession', '10 §4.8B', 'proposed-fit'),

  // ---- mitochondrial oxidative capacity (10 §4.9)
  P('mitoMcMax', 0.5, '1', 0.35, 0.65, 'C', 'PROPOSED FIT M_c* = 1 + 0.5·D_c(MEM): Granata 2016 PMID 27402675 (CS +40-50 %), Coyle 1984 PMID 6511559 (+50 % retained); ' + NO_RANGE, '10 §4.9', 'proposed-fit', {
    label: 'Maximal mitochondrial-content gain',
  }),
  P('mitoMemHalf', 150, 'MEM/wk', 110, 190, 'C', 'PROPOSED FIT D_c = MEM²/(MEM² + 150²); ' + NO_RANGE, '10 §4.9', 'proposed-fit', {
    label: 'Half-saturation of the mitochondrial-content dose function',
  }),
  P('mitoTauUpC', 21, 'd', 15, 30, 'C', 'PROPOSED (Egan 2013 PMID 24069271: rises within 1 wk); ' + NO_RANGE, '10 §4.9', 'proposed-fit', { label: 'Mitochondrial content, rise τ' }),
  P('mitoTauDnC', 17.3, 'd', 12, 23, 'C', 'Coyle 1984 PMID 6511559 (CS t½ = 12 d ⇒ τ = 17.3 d); ' + NO_RANGE, '10 §4.9', 'proposed-fit', { label: 'Mitochondrial content, decay τ' }),
  P('mitoMrAmp', 0.3, '1', 0.2, 0.4, 'C', 'PROPOSED FIT M_r* = 1 + 0.30·min(1, HImin/30): MacInnis 2017, Granata 2016 PMID 27402675; ' + NO_RANGE, '10 §4.9', 'proposed-fit', {
    label: 'Maximal respiratory-capacity gain per mitochondrion',
  }),
  P('mitoTauUpR', 14, 'd', 10, 18, 'C', 'PROPOSED; ' + NO_RANGE, '10 §4.9', 'proposed-fit', { label: 'Respiratory capacity, rise τ' }),
  P('mitoTauDnR', 10, 'd', 7, 13, 'C', 'PROPOSED (Granata 2016 PMID 27402675: markers back to baseline in 2 wk); ' + NO_RANGE, '10 §4.9', 'proposed-fit', { label: 'Respiratory capacity, decay τ' }),

  // ---- aerobic index for 03's M_act (MODEL_SPEC §1.2 step 6; definition provisional, review M14)
  FIX('aerobicIdxRefKcalD', 300, 'kcal/d', 'D', 'Review M14, ruled by the orchestrator: aerobicIdx = clamp(7-d mean net cardio EE / 300 kcal/d, 0, 1) (≈ 150 min/wk moderate → 0.5)', '10 §4.12', 'proposed-fit', 'Definition ruled (M14): net cardio session EE only; steps stay in NEAT.'),
];
