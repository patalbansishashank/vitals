/**
 * Parameter definitions of the wellbeing module (docs/MODEL_SPEC.md §1.15; dossiers 19 §4.20 register, 13 §4.10, 15 §4.9).
 *
 * Conventions used below:
 *  - value / low / high are copied from the cited dossier row; where the dossier gives no range the parameter is a
 *    definitional or structural constant (low = high, therefore never drawn, MODEL_SPEC §8.1).
 *  - `status`: verified = number located in the cited source; proposed-fit = dossier PROPOSED FIT / PROPOSED / ASSUMPTION;
 *    unverified = dossier UNVERIFIED.
 *  - the micronutrient tables (15 §4.9) are grade D: they carry ±30 % plausible bounds but `draw: 'fixed'` (the
 *    `micronutrientScore` metric has no uncertainty band, §6 row 55).
 */
import type { EvidenceGrade, ParamDef, ParamStatus } from '../../types/params';
import { MICRO_NUTRIENTS, MICRO_PATTERN_ROWS } from './microTables';

const ID = 'wellbeing.';

function def(
  name: string,
  value: number,
  unit: string,
  low: number,
  high: number,
  grade: EvidenceGrade,
  source: string,
  dossier: string,
  status: ParamStatus,
  note?: string,
): ParamDef {
  return { id: ID + name, value, unit, low, high, grade, source, dossier, status, label: name, ...(note ? { note } : {}) };
}

/** Definitional / structural constant: not drawn. */
function fixed(name: string, value: number, unit: string, grade: EvidenceGrade, source: string, dossier: string, status: ParamStatus, note?: string): ParamDef {
  return def(name, value, unit, value, value, grade, source, dossier, status, note);
}

const LOUCKS = 'Loucks 2003 PMID 12519869; Ihle 2004 PMID 15231009; Papageorgiou 2018 PMID 29933113';
const PAPA18 = 'Papageorgiou 2018 PMID 29933113';
const PAPA17 = 'Papageorgiou 2017 PMID 28847532';
const HEIKURA = 'Heikura 2020 PMID 32038477';
const BMD_SRC = 'Villareal 2006 PMID 17159017; Villareal 2016 PMID 26332798; Zibellini 2015 PMID 26012544';
const STRENGTH_SRC = 'Nindl 2007 PMID 17762372; Pardue 2017 PMID 28770669; Tornberg 2017 PMID 28723842; Vanheest 2014 PMID 23846160';
const BERGSTROM = 'Bergström 1967 PMID 5584523';
const BURKE = 'Burke 2021 PMID 32697366; Burke 2017 PMID 28012184; Shaw 2019 PMID 31033901';
const BOSTOCK = 'Bostock 2020 PMID 32232045';
const CALTON_GARDNER = 'Gardner 2010 PMID 20573800; Calton 2010 PMID 20537171';

const core: ParamDef[] = [
  // ---------------------------------------------------------------- 19 §4.1 energy availability
  def('eaTierT0', 45, 'kcal/kg FFM/d', 42, 48, 'B', LOUCKS, '19 §4.1, §4.20', 'verified', 'EA tier limit T0/T1 (also the weight-stable prior of EA_s(0) and the P1NP reference); ±3'),
  def('eaTierT1', 30, 'kcal/kg FFM/d', 27, 33, 'B', LOUCKS, '19 §4.1, §4.20', 'verified', 'Loucks threshold (LH pulsatility); strength/mood reference; ±3'),
  def('eaTierT2', 15, 'kcal/kg FFM/d', 12, 18, 'B', LOUCKS, '19 §4.1, §4.20', 'verified', 'severe-LEA tier limit T2/T3; ±3'),
  def('eaTauS', 3, 'd', 2, 5, 'C', 'ASSUMPTION consistent with 3-5 d responses (Ihle 2004; Papageorgiou 2017/2018)', '19 §4.1, §4.20', 'proposed-fit', 'EWMA τ of EA_s'),
  fixed('eaWindowShortD', 7, 'd', 'A', 'definition of EA_7 (17 §2.1)', '17 §2.1; 19 §4.1', 'verified', 'trailing mean length of ea7KcalKgFfm'),
  fixed('eaWindowLongD', 14, 'd', 'B', 'definition of EA_c (19 §4.1)', '19 §4.1', 'verified', 'trailing mean length of EA_c'),
  fixed('eaFloor', -5, 'kcal/kg FFM/d', 'C', '19 §5 row 20 (zero-intake days: clip at −5 in all formulas)', '19 §5, §2', 'proposed-fit'),
  fixed('eaCeil', 70, 'kcal/kg FFM/d', 'C', '19 §2 state table (typical range −5…70)', '19 §2', 'proposed-fit', 'upper clip of the daily EA sample'),

  // ---------------------------------------------------------------- 19 §4.2(a) bone turnover
  def('boneP1npDrop', 0.17, '1', 0.1, 0.25, 'B', PAPA18, '19 §4.2(a), §4.20', 'verified', 'P1NP fall at EA 15 (diet-created) 54.8→45.2 µg/L'),
  fixed('boneP1npEaWidth', 30, 'kcal/kg FFM/d', 'B', PAPA18, '19 §4.2(a)', 'verified', 'width of the (45 − EA_s)/30 ramp'),
  def('boneCtxRise', 0.15, '1', 0.05, 0.25, 'C', `${PAPA18}; Ihle 2004 PMID 15231009`, '19 §4.2(a), §4.20', 'verified', 'CTX rise at EA ≤ 15 (n.s. in the source)'),
  def('boneCtxEaRef', 20, 'kcal/kg FFM/d', 15, 25, 'C', 'Ihle 2004 PMID 15231009 (NTX rises only at EA 10)', '19 §4.2(a), §4.20', 'proposed-fit', 'CTX threshold EA'),
  fixed('boneCtxEaWidth', 5, 'kcal/kg FFM/d', 'C', 'Ihle 2004 PMID 15231009', '19 §4.2(a)', 'proposed-fit', 'width of the (20 − EA_s)/5 ramp'),
  fixed('boneEaRampCap', 1.3, '1', 'C', 'clip upper bound of the EA ramps', '19 §4.2(a)', 'proposed-fit'),
  def('boneSexFMale', 0.5, '1', 0, 1, 'C', PAPA17, '19 §4.2(a), §4.20', 'proposed-fit', 'sexF for men (women 1.0); n.s. in men and no sex difference → half weight'),
  def('boneSrcFactor', 0.5, '1', 0.3, 1, 'C', PAPA18, '19 §4.2(a), §4.20', 'proposed-fit', 'srcF at f_EEE = 1: srcF = 1 − (1 − value)·f_EEE (−8 % vs −17 % for exercise vs diet LEA)'),
  def('boneTauB', 2, 'd', 1, 5, 'C', 'ASSUMPTION (onset ≤ 3 d, Papageorgiou 2018)', '19 §4.2(a), §4.20', 'proposed-fit', 'τ_b bone-marker relaxation (recovery assumed equal)'),
  fixed('lowChoCarbGPerKg', 0.7, 'g/kg/d', 'C', HEIKURA, '19 §4.2(a)', 'proposed-fit', 'low-CHO bone term trigger (net CHO)'),
  fixed('lowChoDays', 7, 'd', 'C', HEIKURA, '19 §4.2(a)', 'proposed-fit'),
  fixed('lowChoTrainHWk', 5, 'h/wk', 'C', HEIKURA, '19 §4.2(a)', 'proposed-fit'),
  def('lowChoDP1np', -0.14, '1', -0.21, -0.07, 'C', HEIKURA, '19 §4.2(a), §4.20', 'verified', '±50 %'),
  def('lowChoDCtx', 0.22, '1', 0.11, 0.33, 'C', HEIKURA, '19 §4.2(a), §4.20', 'verified', '±50 %'),
  def('lowChoTau', 10, 'd', 5, 15, 'C', HEIKURA, '19 §4.2(a), §4.20', 'proposed-fit', 'approach τ (full effect ≈ 3.5 wk)'),
  def('lowChoP1npDecayTau', 14, 'd', 7, 28, 'D', HEIKURA, '19 §4.2(a)', 'unverified', 'P1NP part decays after CHO restoration'),
  def('lowChoCtxDecayTau', 1, 'd', 0.5, 2, 'C', HEIKURA, '19 §4.2(a)', 'proposed-fit', 'CTX part removed within 1 d of CHO restoration'),

  // ---------------------------------------------------------------- 19 §4.2(b) BMD
  def('bmdKHip', 0.2, '% BMD per % weight lost', 0.1, 0.3, 'B', BMD_SRC, '19 §4.2(b), §4.20', 'proposed-fit', 'register value (Villareal 2006 2.2/10.7 = 0.21); 15 §4.14 "k_h basis" slip resolved by the register (MODEL_SPEC §2.2)'),
  def('bmdKSpine', 0.13, '% BMD per % weight lost', 0, 0.2, 'C', 'Villareal 2016 PMID 26332798; Soltani 2016 PMID 27154437', '19 §4.2(b), §4.20', 'proposed-fit', 'spine (internal state, not a metric)'),
  def('bmdMAgeHigh', 1.5, '1', 1, 2, 'D', 'Villareal 2011 PMID 21449785; Riedt 2005 PMID 15746990; Shapses 2001 PMID 11450709', '19 §4.2(b), §4.20', 'unverified', 'mAge for ≥ 65 y or postmenopausal (1.0 below 50 / premenopausal)'),
  fixed('bmdAgeStepYears', 65, 'y', 'C', 'Villareal 2011 PMID 21449785', '19 §4.2(b)', 'proposed-fit'),
  def('bmdRhoRt', 0.35, '1', 0, 0.67, 'C', 'Villareal 2011 PMID 21449785; Beavers 2025 PMID 40540267', '19 §4.2(b), §4.20', 'proposed-fit', 'ρ_RT: mRT = 1 − ρ_RT with progressive RT ≥ 2×/wk (contested, O4)'),
  fixed('bmdRtSessionsPerWeek', 2, 'sessions/wk', 'C', 'Villareal 2011 PMID 21449785', '19 §4.2(b)', 'proposed-fit'),
  def('bmdMSrc', 0.25, '1', 0, 0.5, 'C', 'Villareal 2006 PMID 17159017; Soltani 2016 PMID 27154437', '19 §4.2(b), §4.20', 'proposed-fit', 'mSrc when ≥ 60 % of the deficit is exercise energy'),
  fixed('bmdSrcShare', 0.6, '1', 'C', 'Villareal 2006 PMID 17159017', '19 §4.2(b)', 'proposed-fit'),
  def('bmdMCaLow', 1.5, '1', 1, 3, 'D', 'Riedt 2005 PMID 15746990; Ricci 1998 PMID 9626637', '19 §4.2(b), §4.20', 'unverified', 'mCa: postmenopausal and Ca < 1.0 g/d'),
  fixed('bmdCaThresholdMg', 1000, 'mg/d', 'C', 'Riedt 2005 PMID 15746990', '19 §4.2(b)', 'proposed-fit'),
  def('bmdTauLoss', 120, 'd', 60, 200, 'C', 'ASSUMPTION (Zibellini 2015: ≥ 6 mo to see loss)', '19 §4.2(b), §4.20', 'proposed-fit'),
  def('bmdTauRecovery', 240, 'd', 120, 480, 'D', 'ASSUMPTION (no human recovery data, O3)', '19 §4.2(b), §4.20', 'unverified'),

  // ---------------------------------------------------------------- 19 §4.3 strength capacity
  def('strengthA', 0.15, '1', 0.1, 0.3, 'C', STRENGTH_SRC, '19 §4.3, §4.20', 'proposed-fit', 'a_strength at EA_c 15 (a_power 0.20 is not exposed: no power series/signal in v1)'),
  fixed('strengthEaWidth', 15, 'kcal/kg FFM/d', 'C', STRENGTH_SRC, '19 §4.3', 'proposed-fit', 'width of the (30 − EA_c)/15 ramp'),
  fixed('strengthEaRampCap', 1.3, '1', 'C', STRENGTH_SRC, '19 §4.3', 'proposed-fit'),
  def('strengthTauOn', 28, 'd', 14, 56, 'C', 'ASSUMPTION (Nindl 2007 8-wk course)', '19 §4.3, §4.20', 'unverified', 'τ while M_EA is falling'),
  def('strengthTauOff', 75, 'd', 40, 180, 'C', 'ASSUMPTION (Rossow 2013 / Pardue 2017 recovery 3-13 mo)', '19 §4.3, §4.20', 'unverified', 'τ while M_EA is recovering'),
  def('leanGateFullBfM', 18, '% BF', 14, 22, 'C', 'ASSUMPTION (19 O1)', '19 §4.3, §4.20', 'unverified', 'g_lean = 1 up to this body fat (men)'),
  def('leanGateFullBfF', 28, '% BF', 24, 32, 'C', 'ASSUMPTION (19 O1)', '19 §4.3, §4.20', 'unverified', 'g_lean = 1 up to this body fat (women)'),
  def('leanGateZeroBfM', 30, '% BF', 26, 34, 'C', 'ASSUMPTION (19 O1)', '19 §4.3, §4.20', 'unverified', 'g_lean reaches its minimum at this body fat (men)'),
  def('leanGateZeroBfF', 40, '% BF', 36, 44, 'C', 'ASSUMPTION (19 O1)', '19 §4.3, §4.20', 'unverified', 'g_lean reaches its minimum at this body fat (women)'),
  fixed('leanGateMin', 0.3, '1', 'C', 'ASSUMPTION (19 O1)', '19 §4.3', 'unverified'),

  // ---------------------------------------------------------------- 19 §4.4 endurance capacity
  fixed('tteIntercept', 36.8, 'min', 'A', BERGSTROM, '19 §4.4, §4.20', 'verified', 'TTE_75 = intercept + slope·G, G in g/100 g wet muscle, r = 0.92, n = 9'),
  fixed('tteSlope', 41.6, 'min per g/100 g ww', 'A', BERGSTROM, '19 §4.4, §4.20', 'verified'),
  fixed('econRefIntensity', 0.75, 'frac VO2max', 'A', BERGSTROM, '19 §4.4', 'verified', 'reference intensity of the capacity index (71-82 % VO2max)'),
  def('econDo2Cost', 0.065, '1', 0.05, 0.08, 'B', BURKE, '19 §4.4, §4.20', 'verified', 'fractional rise in O2 cost at full fat adaptation and gI = 1'),
  def('econGiLo', 0.6, 'frac VO2max', 0.55, 0.65, 'B', 'Shaw 2019 PMID 31033901', '19 §4.4, §4.20', 'proposed-fit', 'gI = 0 at or below this intensity'),
  def('econGiHi', 0.7, 'frac VO2max', 0.65, 0.75, 'B', 'Shaw 2019 PMID 31033901', '19 §4.4, §4.20', 'proposed-fit', 'gI = 1 at or above this intensity'),
  def('econTauRecovery', 3, 'd', 1, 7, 'C', 'ASSUMPTION (Burke 2021: substrate use normal after 5-6 d)', '19 §4.4, §4.20', 'proposed-fit', 'A_econ recovery τ after carbohydrate restoration'),
  def('massExponent', 1, '1', 0.79, 1, 'B', 'Cureton 1978 PMID 723510; Swain 1994 PMID 8133740', '19 §4.4', 'proposed-fit', 'relative VO2max ∝ M^−exponent at constant absolute VO2 (1 running; 0.79 uphill cycling)'),

  // ---------------------------------------------------------------- 13 §4.10 keto-induction (Φ_ind)
  fixed('ketoCarbThresholdG', 50, 'g/d', 'C', BOSTOCK, '13 §4.10', 'proposed-fit', 'carbohydrate threshold that triggers induction'),
  fixed('ketoTauP', 2.5, 'd', 'C', BOSTOCK, '13 §4.10', 'proposed-fit', 'τ_p of Φ = Φ_max·(Δt/τ_p)·e^{1−Δt/τ_p} (peak at Δt = τ_p)'),
  fixed('ketoTauPHeavy', 6, 'd', 'C', BOSTOCK, '13 §4.10', 'proposed-fit', 'heavy-tail τ_p (IQR upper bound 15 d)'),
  fixed('ketoHeavyTailFraction', 0.25, '1', 'C', BOSTOCK, '13 §4.10', 'proposed-fit', 'share of simulated users on the heavy tail'),
  def('ketoHeavyTailQuantile', 0.5, '1', 0, 1, 'C', BOSTOCK, '13 §4.10; MODEL_SPEC §1.15, §8.1', 'proposed-fit', 'latent quantile: heavy-tail τ_p when > 1 − fraction (nominal 0.5 → τ_p 2.5 d)'),
  fixed('ketoNaMitigation', 0.3, '1', 'D', BOSTOCK, '13 §4.10', 'proposed-fit', 'Φ_max × (1 − value) when sodium ≥ threshold (grade D)'),
  fixed('ketoNaThresholdG', 2, 'g/d', 'D', BOSTOCK, '13 §4.10', 'proposed-fit'),

  // ---------------------------------------------------------------- 19 §4.5 mood tier rubric
  fixed('weightWindowD', 14, 'd', 'C', 'Helms 2014 PMID 24864135; Garthe 2011 PMID 21558571 (14-d loss rate)', '19 §4.2(b), §4.5', 'proposed-fit', 'smoothing window of scale weight (WL_pct) and of the weight-loss rate r'),
  fixed('moodPtsEaMid', 1, 'points', 'C', 'Loucks 2003 PMID 12519869', '19 §4.5', 'proposed-fit', 'EA_c 15-30'),
  fixed('moodPtsEaLow', 2, 'points', 'C', 'Loucks 2003 PMID 12519869', '19 §4.5', 'proposed-fit', 'EA_c < 15'),
  fixed('moodRateAmber', 1, '%BW/wk', 'C', 'Garthe 2011 PMID 21558571 (PROPOSED cut-off)', '19 §4.5, §4.20', 'proposed-fit', 'r ≥ 1.0 %BW/wk'),
  fixed('moodRateRed', 1.5, '%BW/wk', 'C', 'PROPOSED cut-off (19 §4.5)', '19 §4.5, §4.20', 'proposed-fit', 'r > 1.5 %BW/wk'),
  fixed('moodPtsRateAmber', 1, 'points', 'C', '19 §4.5', '19 §4.5', 'proposed-fit'),
  fixed('moodPtsRateRed', 2, 'points', 'C', '19 §4.5', '19 §4.5', 'proposed-fit'),
  fixed('moodKetoThreshold', 0.3, '1', 'C', BOSTOCK, '19 §4.5', 'proposed-fit', 'Φ ≥ 0.3 adds one point'),
  fixed('moodPtsKeto', 1, 'points', 'C', '19 §4.5', '19 §4.5', 'proposed-fit'),
  fixed('moodSleepDebtH', 1, 'h/night', 'C', '16 §4.1 (sleep debt > 1 h/night)', '19 §4.5', 'proposed-fit', 'read from the slow debt state dS'),
  fixed('moodPtsSleep', 1, 'points', 'C', '19 §4.5', '19 §4.5', 'proposed-fit'),
  fixed('moodBfLeanM', 10, '% BF', 'D', 'ASSUMPTION (Rossow 2013 BF 4.5 %)', '19 §4.5', 'unverified', 'very lean: BF < value (men)'),
  fixed('moodBfLeanF', 18, '% BF', 'D', 'ASSUMPTION (Rossow 2013 BF 4.5 %)', '19 §4.5', 'unverified', 'very lean: BF < value (women)'),
  fixed('moodPtsLean', 1, 'points', 'D', '19 §4.5', '19 §4.5', 'unverified'),
  fixed('moodAmberPts', 2, 'points', 'D', 'ASSUMPTION (19 O13)', '19 §4.5, §4.20', 'proposed-fit', 'tier amber from this many points (green 0-1)'),
  fixed('moodRedPts', 4, 'points', 'D', 'ASSUMPTION (19 O13)', '19 §4.5, §4.20', 'proposed-fit', 'tier red from this many points'),
];

// ------------------------------------------------------------------ 15 §4.9 micronutrient rule table (grade D)
const microScalars: ParamDef[] = [
  fixed('microEmaTau', 7, 'd', 'D', CALTON_GARDNER, '15 §4.9', 'proposed-fit', 'E, c, f EMA time constant (dossier: EMA 7 d)'),
  fixed('microRedR', 0.75, 'R', 'D', '15 §4.9 rule table', '15 §4.9', 'proposed-fit', 'flag RED if R < 0.75'),
  fixed('microAmberR', 1.0, 'R', 'D', '15 §4.9 rule table', '15 §4.9', 'proposed-fit'),
  fixed('microYellowR', 1.3, 'R', 'D', '15 §4.9 rule table', '15 §4.9', 'proposed-fit'),
  fixed('microScoreRedPts', 6, 'points', 'D', '15 §4.9 rule table (overall_score = 100 − 6·#RED − 3·#AMBER)', '15 §4.9', 'proposed-fit'),
  fixed('microScoreAmberPts', 3, 'points', 'D', '15 §4.9 rule table', '15 §4.9', 'proposed-fit'),
  fixed('microFibreTargetPer1000', 14, 'g/1000 kcal', 'B', 'NASEM DRI (AI 14 g/1000 kcal); 15 §4.9', '15 §4.9', 'verified', 'FIBRE AMBER below this'),
  fixed('microFibreYellowG', 25, 'g/d', 'D', '15 §4.9 rule table', '15 §4.9', 'proposed-fit', 'FIBRE YELLOW below this'),
  fixed('microLowCarbG', 100, 'g/d', 'D', CALTON_GARDNER, '15 §4.9', 'proposed-fit', 'carbohydrate-restricted pattern: c < 100 g/d …'),
  fixed('microLowCarbEnergyFrac', 0.25, '1', 'D', CALTON_GARDNER, '15 §4.9', 'proposed-fit', '… or < 25 % of energy'),
  fixed('microEfaAmberG', 20, 'g/d', 'D', 'Holman-index literature (15 §4.9 ref 94)', '15 §4.9', 'proposed-fit', 'EFA AMBER if fat < 20 g/d'),
  fixed('microEfaRedG', 15, 'g/d', 'D', 'Holman-index literature (15 §4.9 ref 94)', '15 §4.9', 'proposed-fit', 'EFA RED if fat < 15 g/d …'),
  fixed('microEfaRedDays', 28, 'd', 'D', 'Holman-index literature (15 §4.9 ref 94)', '15 §4.9', 'proposed-fit', '… for more than 4 weeks'),
  fixed('microLowFatMealG', 5, 'g/meal', 'D', 'Carotenoid / vitamin D / vitamin E absorption studies (15 §4.9 refs 91-93)', '15 §4.9', 'proposed-fit', 'FAT_SOL_ABSORPTION RED if fat per meal < 5 g for most meals'),
  fixed('microIronRiskKcal', 1500, 'kcal/d', 'D', '15 §4.9 iron rule', '15 §4.9', 'proposed-fit', 'iron_risk AMBER trigger: menstruating and energy below this …'),
  fixed('microIronRiskTrainHWk', 5, 'h/wk', 'D', '15 §4.9 iron rule', '15 §4.9', 'proposed-fit', 'iron_risk RED escalation: endurance training ≥ this'),
  fixed('microIronVegMult', 1.8, '1', 'D', 'NIH-ODS iron RDA ×1.8 for vegetarians (UNVERIFIED in 15)', '15 §4.9', 'unverified', 'iron EAR multiplier for vegetarian / vegan diets'),
  fixed('microMvmVitaminRdaMult', 1.2, 'EAR', 'D', '15 §4.9 (R = 1.2 ≈ RDA); multivitamin = 100 % of RDA of vitamins', '15 §4.9', 'proposed-fit', 'multivitamin adds this many EARs of each vitamin'),
  fixed('microMvmMineralFrac', 0.4, 'RDA', 'D', 'Fulgoni/NHANES MVM users (15 §4.9 ref 85): ~30-50 % of the Mg/Ca RDA', '15 §4.9', 'proposed-fit', 'multivitamin adds this share of the RDA of Mg and Ca (midpoint of 30-50 %)'),
];

/** Per-nutrient tables (density, EARs, quality and pattern multipliers). Grade D, never drawn. */
const microTables: ParamDef[] = [];
for (const n of MICRO_NUTRIENTS) {
  const grade: EvidenceGrade = 'D';
  const src = `${CALTON_GARDNER}; NASEM DRI (EAR values UNVERIFIED in the dossier except D/E/A/C/Zn)`;
  const st: ParamStatus = 'proposed-fit';
  const push = (name: string, value: number, unit: string, note: string, status: ParamStatus = st): void => {
    microTables.push({
      id: `${ID}micro.${n.key}.${name}`, value, unit, low: value * 0.7, high: value * 1.3, grade, source: src, dossier: '15 §4.9', status, draw: 'fixed', label: `micro.${n.key}.${name}`, note,
    });
  };
  push('density', n.density, `${n.unit}/1000 kcal`, 'typical Western density (A TO Z baseline); ±30 % uncertainty');
  push('earF', n.earF, n.unit, `EAR women 31-50${n.isAi ? ' (AI)' : ''}`);
  push('earM', n.earM, n.unit, `EAR men${n.isAi ? ' (AI)' : ''}`);
  // identity multipliers (1) are definitional and not registered
  if (n.q1 !== 1) push('q1', n.q1, '1', 'food quality 1 multiplier (refined / ultra-processed)');
  if (n.q3 !== 1) push('q3', n.q3, '1', 'food quality 3 multiplier (varied whole foods)');
}
for (const row of MICRO_PATTERN_ROWS) {
  for (const n of MICRO_NUTRIENTS) {
    const v = row.mult[n.key];
    if (v === undefined) continue;
    microTables.push({
      id: `${ID}micro.${n.key}.${row.key}`, value: v, unit: '1', low: v * 0.7, high: v * 1.3, grade: 'D',
      source: `${CALTON_GARDNER}; ${row.anchor}`, dossier: '15 §4.9', status: 'proposed-fit', draw: 'fixed', label: `micro.${n.key}.${row.key}`,
      note: `${row.label} pattern multiplier on typical density; ±30 % uncertainty`,
    });
  }
}

export const wellbeingParams: readonly ParamDef[] = [...core, ...microScalars, ...microTables];
