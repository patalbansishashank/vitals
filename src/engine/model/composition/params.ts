/**
 * composition — parameter registry (docs/MODEL_SPEC.md §1.8 "Parameters"; §0.4 registry rules).
 *
 * Every constant the module uses is declared here. Values are copied from the cited dossier section; where the dossier
 * gives an uncertainty column, it becomes [low, high] (drawn triangularly, MODEL_SPEC §8.1); structural shape constants
 * of a fitted function without a stated range are `draw: 'fixed'` (low = high). Grades/status follow the dossier.
 */
import type { ParamDef, ParamStatus, EvidenceGrade, DrawKind } from '../../types/params';

const SRC = {
  hall2011: 'Hall 2011 Lancet PMID 21872751 (web appendix)',
  hall2010bjn: 'Hall 2010 Br J Nutr PMID 20132585',
  hall2008: 'Hall 2008 Int J Obes PMID 17848938',
  forbes: 'Forbes 1987 PMID 3306482; Hall 2007 PMID 17367567',
  helms: 'Helms 2014 PMID 24092765; Hector & Phillips 2018 PMID 29182451',
  lflFit: '03 §4.4.2 PROPOSED FIT to Mettler 2010 PMID 19927027, Pasiakos 2013 PMID 23739654, Krieger 2006 PMID 16469983, Wycherley 2012, Kim 2016 PMID 26883880',
  chaston: 'Chaston 2007 PMID 17075583',
  owen: 'Owen 1998 PMID 9665093',
  laurens: 'Laurens 2021 PMID 34668663',
  vazquez: 'Vazquez & Adibi 1992 PMID 1556948',
  heymsfield: 'Heymsfield 2014 PMID 24447775',
  bray: 'Bray 2012 JAMA PMID 22215165',
  rosqvist: 'Rosqvist 2014 PMID 24550191',
  jacquet: 'Jacquet 2020 Int J Obes PMID 32099104',
  dulloo: 'Dulloo 2018 PMID 29559726; Müller 2015 PMID 26399868',
  beavers: 'Beavers 2011 PMID 21795437',
  janssen: 'Janssen 2000 PMID 10904038; Heymsfield 2014 PMID 24447775',
  spec: 'MODEL_SPEC §1.8 (orchestrator ruling)',
} as const;

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
  extra: { label?: string; note?: string; draw?: DrawKind } = {},
): ParamDef {
  return { id: `composition.${name}`, value, unit, low, high, grade, source, dossier, status, ...extra };
}

/** Fixed (never drawn) structural constant. */
function fixed(name: string, value: number, unit: string, grade: EvidenceGrade, source: string, dossier: string, status: ParamStatus, note?: string): ParamDef {
  return def(name, value, unit, value, value, grade, source, dossier, status, note ? { note, draw: 'fixed' } : { draw: 'fixed' });
}

export const COMPOSITION_PARAMS: readonly ParamDef[] = [
  // ---------------------------------------------------------------- tissue energy (R-RHO, R-FPROT; §0.2)
  fixed('rhoF', 9441, 'kcal/kg', 'A', SRC.hall2011, '01 §4.7; 11 §4.1', 'verified', "03's 9 400 and Bouchard's 9 300 are inside rounding (R-RHO)"),
  fixed('etaF', 179, 'kcal/kg', 'A', SRC.hall2010bjn, '01 §4.2.4; 11 §4.1', 'verified'),
  fixed('rhoL', 1816, 'kcal/kg', 'B', SRC.hall2008, '01 §4.7; 11 §4.1; 03 §4.18', 'verified',
    "R-RHO / review M20: Hall convention (h_P 1.6 g water/g protein), fixed; 03's 1 000 kcal/kg is the hydrated-DXA-lean convention (not a draw)"),
  fixed('etaL', 229, 'kcal/kg', 'B', SRC.hall2010bjn, '01 §4.2.4; 11 §4.1', 'verified'),
  fixed('hP', 1.6, 'g/g', 'B', SRC.hall2008, '20 §4.6.2; R-FPROT', 'verified',
    'Water bound per g protein in lean tissue; fixed because ρL 1 816 is defined at h_P = 1.6 (f_prot = 1/(1 + h_P) = 0.385); 20 §4B.2 range 1.1-3.0'),
  fixed('lt0GlycogenWater', 3.0, 'g/g', 'B', '04 §4.1 (R-GLYW)', '04 §4.1; review m6 ruling', 'verified',
    'Only for the absolute LT0 = FFM0 − (1 + h)·G0/1000 (review m6, orchestrator ruling); mirrors fuel/water h'),

  // ---------------------------------------------------------------- 03 §4.4.2 leanFractionOfLoss (RT-stripped, R-RT)
  fixed('forbesC', 10.4, 'kg', 'A', SRC.forbes, '03 §4.4.2 p0; 01 §4.3.1', 'verified', 'p0 = C/(C + FM) (Forbes mass fraction)'),
  def('p0Shift', 0, '1', -0.1, 0.1, 'B', SRC.heymsfield, '03 §4.4.2 (p0 ±0.10 absolute between studies)', 'proposed-fit', {
    note: 'Additive shift of p0; carries R-FORBES between-person spread in the ensemble',
  }),
  fixed('leanBfMale', 0.3, 'frac', 'C', SRC.helms, '03 §4.4.2 leanness index L', 'proposed-fit', 'L = 0 at ≥ 30 % BF (men-equivalent)'),
  fixed('leanBfSpan', 0.2, 'frac', 'C', SRC.helms, '03 §4.4.2 leanness index L', 'proposed-fit', 'L = 1 at ≤ 10 % BF (men-equivalent)'),
  fixed('leanBfFemaleOffset', 0.1, 'frac', 'C', SRC.helms, '03 §4.4.2 leanness index L', 'proposed-fit', 'women: bf − 0.10 (≤ 20 % → L = 1)'),
  def('qSatBase', 1.2, 'g/kg FFM/d', 0.8, 1.6, 'C', SRC.helms, '03 §4.4.2 q_sat (±0.4)', 'proposed-fit'),
  fixed('qSatDeficitSlope', 2.0, 'g/kg FFM/d', 'C', SRC.helms, '03 §4.4.2 q_sat', 'proposed-fit'),
  fixed('qSatLeanSlope', 3.0, 'g/kg FFM/d', 'C', SRC.helms, '03 §4.4.2 q_sat', 'proposed-fit'),
  fixed('qSatDeficitCap', 0.45, 'frac', 'C', SRC.helms, '03 §4.4.2 q_sat (min(d, 0.45))', 'proposed-fit'),
  def('qKnee', 0.8, 'g/kg FFM/d', 0.6, 1.0, 'C', '03 §4.4.2 (≈ N-balance EAR)', '03 §4.4.2 lower protein knee (±0.2)', 'proposed-fit'),
  fixed('xpMinSpan', 0.3, 'g/kg FFM/d', 'C', SRC.lflFit, '03 §4.4.2 x_P denominator floor', 'proposed-fit'),
  def('mMin', 0.6, '1', 0.45, 0.75, 'C', SRC.lflFit, '03 §4.4.2 M_min (±0.15)', 'proposed-fit', {
    note: "R-RT: 03's −0.25·RT term of M_min is dropped (09 owns RT retention)",
  }),
  fixed('mMinDeficitRelief', 0.5, '1', 'C', SRC.lflFit, '03 §4.4.2 M_min·(1 − 0.5·clamp((d − 0.25)/0.5))', 'proposed-fit'),
  fixed('mMinDeficitPivot', 0.25, 'frac', 'C', SRC.lflFit, '03 §4.4.2 M_min', 'proposed-fit'),
  fixed('mMinDeficitSpan', 0.5, 'frac', 'C', SRC.lflFit, '03 §4.4.2 M_min', 'proposed-fit'),
  def('dCrit', 0.45, 'frac', 0.35, 0.55, 'C', 'Carbone 2019 PMID 30596808; Hoffer 1984 PMID 6707202', '03 §4.4.2 d_crit (±0.1)', 'proposed-fit'),
  fixed('dCritLeanSlope', 0.35, 'frac', 'C', SRC.lflFit, '03 §4.4.2 d_crit = 0.45 + 0.35·(1 − L)', 'proposed-fit'),
  fixed('effDWidth', 0.3, 'frac', 'C', SRC.lflFit, '03 §4.4.2 effD = clamp(1 − (d − d_crit)/0.30)', 'proposed-fit'),
  def('mDSlope', 0.65, '1/frac', 0.35, 0.95, 'C', `${SRC.chaston}; Forbes & Drenick 1979 PMID 463798`, '03 §4.4.2 M_D slope (±0.3)', 'proposed-fit'),
  fixed('mDRef', 0.25, 'frac', 'C', SRC.lflFit, '03 §4.4.2 M_D = 1 at 25 % deficit', 'proposed-fit'),
  fixed('mDMin', 0.85, '1', 'C', SRC.lflFit, '03 §4.4.2 M_D clamp', 'proposed-fit'),
  fixed('mDMax', 1.5, '1', 'C', SRC.lflFit, '03 §4.4.2 M_D clamp', 'proposed-fit'),
  def('mAct', 0.3, '1', 0.1, 0.5, 'C', SRC.chaston, '03 §4.4.2 M_act = 1 − 0.30·activity (±0.2)', 'proposed-fit'),
  def('mAgeSlope', 0.01, '1/y', 0, 0.02, 'C', 'Morton 2018 PMID 28698222; Weinheimer 2010 PMID 20591106', '03 §4.4.2 M_age (±0.01/y)', 'proposed-fit'),
  fixed('mAgePivot', 40, 'y', 'C', SRC.lflFit, '03 §4.4.2 M_age', 'proposed-fit'),
  fixed('mAgeMax', 1.4, '1', 'C', SRC.lflFit, '03 §4.4.2 M_age ≤ 1.4', 'proposed-fit'),
  fixed('pCatMax', 0.9, 'frac', 'C', SRC.lflFit, '03 §4.4.2 pCat clamp; MODEL_SPEC §1.8 p_E clamp', 'proposed-fit'),

  // ---------------------------------------------------------------- 11 §4.7 surplus partition
  def('rAT', 0.2, 'kg/kg', 0.15, 0.25, 'C', '11 §4.7 (adipose ≈ 80-85 % lipid)', '11 §4.7 r_AT', 'unverified'),
  def('rS', 0.45, 'kg/kg', 0.35, 0.55, 'C', `${SRC.bray}; Bouchard 1990 PMID 2336074; Johannsen 2019`, '11 §4.7 r_S', 'proposed-fit'),
  fixed('mPp0', 0.75, 'g/kg/d', 'C', SRC.bray, '11 §4.7 m_P shape', 'proposed-fit'),
  fixed('mPScale', 0.35, 'g/kg/d', 'C', SRC.bray, '11 §4.7 m_P shape', 'proposed-fit'),
  fixed('mPNorm', 0.95, '1', 'C', SRC.bray, '11 §4.7 m_P = (1 − e^{−(p−0.75)/0.35})/0.95', 'proposed-fit'),
  fixed('mPMin', -0.3, '1', 'C', SRC.bray, '11 §4.7 m_P clamp', 'proposed-fit'),
  fixed('mPMax', 1.05, '1', 'C', SRC.bray, '11 §4.7 m_P clamp', 'proposed-fit'),
  fixed('phiFCap', 0.45, '1', 'C', 'Forbes 1986 PMID 3479191; Hall 2011 PMID 21872751', '11 §4.7 φ_F = min(1, [C/(C + FM)]/0.45)', 'proposed-fit'),
  fixed('mFaPufa', 1.5, '1', 'D', SRC.rosqvist, '11 §4.7 m_FA PUFA-rich', 'proposed-fit'),
  fixed('mFaSfa', 0.7, '1', 'D', SRC.rosqvist, '11 §4.7 m_FA SFA-rich', 'proposed-fit'),
  fixed('mFaRefPufaShare', 0.23, 'frac of fat', 'C', 'MODEL_SPEC §5.3 (06 §2.4 NHANES, DERIVED)', '11 §4.7 m_FA = 1 at the habitual mix', 'proposed-fit',
    'Own interpolation anchor: the default fat mix (PUFA 0.23, SFA 0.32 of fat) gives m_FA = 1 exactly'),
  fixed('mFaRefSfaShare', 0.32, 'frac of fat', 'C', 'MODEL_SPEC §5.3 (06 §2.4 NHANES, DERIVED)', '11 §4.7 m_FA', 'proposed-fit'),
  fixed('mFaRichShare', 0.5, 'frac of fat', 'D', `${SRC.rosqvist} (sunflower vs palm oil muffins)`, '11 §4.7 m_FA', 'proposed-fit',
    'Own interpolation anchor (dossier gives only categorical "PUFA-rich"/"SFA-rich"): the category value is reached when that class is ≥ 50 % of fat'),
  fixed('sRtSets', 12, 'sets/wk', 'C', SRC.spec, '11 §4.7 s_RT = min(1, V_wb/12)', 'proposed-fit',
    'No longer read since R-RTSWITCH (final round 2026-09-30, MODEL_SPEC §1.8 2d): s_RT = min(1, L_RT/L_sed) keeps the surplus lean gain non-decreasing in RT volume; kept for the registry hash history and unit tests'),

  // ---------------------------------------------------------------- 11 §4.12 post-diet overshoot (R-OVERSHOOT)
  fixed('osA', 0.92, '1', 'C', SRC.jacquet, '11 §4.12 γ = 1 + a·e^{−b·%FAT0}', 'verified'),
  fixed('osB', 0.11, '1/%', 'C', SRC.jacquet, '11 §4.12', 'verified'),
  fixed('osC', 0.015, '1/%', 'C', SRC.jacquet, '11 §4.12 Pm_SS = (1 − %FAT0/100)·e^{−c·%FAT0}', 'verified',
    'Fallback when the accumulated loss is too small to give Pm_SS'),
  fixed('osRampLo', 0.1, 'frac', 'D', SRC.dulloo, '11 §4.12 depletion threshold ramp', 'proposed-fit'),
  fixed('osRampHi', 0.3, 'frac', 'D', SRC.dulloo, '11 §4.12 depletion threshold ramp', 'proposed-fit'),
  fixed('osFfmDefMin', 0.2, 'kg', 'D', SRC.dulloo, '11 §4.12 FFM_def > 0.2 kg', 'proposed-fit'),
  fixed('osExpiryD', 182, 'd', 'D', SRC.dulloo, '11 §4.12 26-wk expiry', 'proposed-fit'),
  fixed('osOldAge', 60, 'y', 'C', SRC.beavers, '11 §4.12 age modifier', 'proposed-fit'),
  fixed('osOldAgeMult', 0.5, '1', 'C', SRC.beavers, '11 §4.12 P_RF × 0.5 at age ≥ 60', 'proposed-fit'),

  // ---------------------------------------------------------------- 03 §4.13 very-low-intake (non-fasting) branch
  def('poxMin', 0.52, 'g/kg FFM/d', 0.42, 0.62, 'B', SRC.owen, '03 §4.13 Pox_min (Owen 0.52 ± 0.10)', 'proposed-fit'),
  fixed('poxMinLeanSlope', 0.5, '1', 'C', SRC.owen, '03 §4.13 Pox_min·(1 + 0.5·L)', 'proposed-fit'),
  def('pox0', 0.9, 'g/kg FFM/d', 0.7, 1.2, 'C', SRC.laurens, '03 §4.13 Pox_0', 'unverified'),
  fixed('tauN', 3, 'd', 'C', SRC.laurens, '03 §4.13 τ_N (41 % fall by day 5)', 'proposed-fit'),
  fixed('poxBhbRef', 2, 'mmol/L', 'C', 'Sherwin 1975 PMID 1133179; Nair 1988 PMID 3392207', '03 §4.13 τ_N,eff = τ_N·2/(1 + clamp(BHB/2))', 'proposed-fit'),
  fixed('poxChoSparing', 0.3, '1', 'C', SRC.vazquez, '03 §4.13 Pox ×= (1 − 0.3·clamp(CHO/100))', 'proposed-fit'),
  fixed('poxChoRefG', 100, 'g/d', 'C', SRC.vazquez, '03 §4.13', 'proposed-fit'),
  fixed('poxChoDays', 7, 'd', 'C', SRC.vazquez, '03 §4.13 (t_f < 7 d)', 'proposed-fit'),
  fixed('poxDietProt', 0.3, '1', 'C', 'Hoffer 1984 PMID 6707202', '03 §4.13 ΔL = −(Pox·FFM − 0.3·P_eff)/…', 'proposed-fit'),
  fixed('vliEnergyFrac', 0.3, 'frac TEE', 'C', SRC.spec, '03 §4.13 entry EI < 30 % TEE', 'proposed-fit'),
  fixed('vliProteinQ', 0.3, 'g/kg FFM/d', 'C', SRC.spec, '03 §4.13 entry q < 0.3', 'proposed-fit'),
  fixed('vliProteinMinG', 5, 'g/d', 'B', '20 §4.4.4 (protein ≥ 5 g/d leaves the water-only branch)', '20 §4B.1; MODEL_SPEC §1.8 2b', 'verified'),
  // review M9 (orchestrator ruling): smooth fat floor — fat share of a negative S′ × clamp((FM − FM_min)/ramp, 0, 1)
  fixed('fmFloorFracBw0', 0.02, 'frac BW0', 'D', 'MODEL_SPEC_REVIEW M9 (orchestrator ruling 2026-09-30)', 'MODEL_SPEC §1.8 (review M9)', 'proposed-fit',
    'FM_min = 0.02·BW0; below it energy demand is met from lean tissue (energy-conserving)'),
  fixed('fmFloorRampKg', 1.0, 'kg', 'D', 'MODEL_SPEC_REVIEW M9 (orchestrator ruling 2026-09-30)', 'MODEL_SPEC §1.8 (review M9)', 'proposed-fit'),

  // ---------------------------------------------------------------- 03 §4.14 age drift; SM split; EB7
  fixed('ageLeanGD', 0.4, 'g/d', 'C', SRC.janssen, '03 §4.14 ΔL_age = −0.4 g/d × …', 'proposed-fit'),
  fixed('ageLeanPivot', 45, 'y', 'C', SRC.janssen, '03 §4.14', 'proposed-fit'),
  fixed('ageLeanSpan', 20, 'y', 'C', SRC.janssen, '03 §4.14', 'proposed-fit'),
  fixed('ageLeanCap', 1.5, '1', 'C', SRC.janssen, '03 §4.14 clamp(…, 0, 1.5)', 'proposed-fit'),
  fixed('ageLeanRtOffset', 0.8, '1', 'C', SRC.janssen, '03 §4.14 × (1 − 0.8·RT)', 'proposed-fit'),
  fixed('smLossShare', 0.5, '1', 'C', SRC.janssen, '03 §4.18/§4.19 step 7 (SM share of non-RT ΔLT)', 'proposed-fit'),
  fixed('smRtShare', 0.7, '1', 'C', '09 §4.9 (SM ≈ 0.7 × FFM change)', '09 §4.9; MODEL_SPEC §1.8 step 7 (review M10)', 'proposed-fit',
    "03's 0.85 rejected so the metric matches muscle's smRtKg (R-RT)"),
  fixed('eb7WindowD', 7, 'd', 'C', '11 §4.15 (EB7 = 7-day smoothed balance)', '11 §4.15; MODEL_SPEC §1.8 step 1 (integration: boxcar)', 'proposed-fit',
    "Trailing 7-day mean (boxcar) instead of 11's EMA: constant over any weekly-periodic schedule (review m20)"),
  // review m20 (integration, 2026-09-30): continuous partition around EB7 = 0 and the sustained/fluctuation split
  fixed('partBlendKcalD', 100, 'kcal/d', 'D', 'MODEL_SPEC_REVIEW m20 (linear blend over |EB7| < 100 kcal/d)', 'MODEL_SPEC §1.8 step 2e', 'proposed-fit',
    'Half-width of the linear deficit↔surplus blend of p_E in EB7; removes the jump between the 03 and 11 shares at maintenance'),
];
