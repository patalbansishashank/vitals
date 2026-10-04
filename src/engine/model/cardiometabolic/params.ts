/**
 * Parameter registry of the cardiometabolic module (MODEL_SPEC §1.14; dossiers 06, 04 §4.13b/4.18-4.19, 13 §4.8,
 * 10 §4.7/4.10, 11 §4.9/4.13, 21 §4 levers, 20 §4.7).
 *
 * Every constant of the module is one ParamDef here; `prepare()` copies them into the constants object `K`.
 * Conventions used for `low`/`high`:
 *  - a confidence interval or range printed in the dossier is used verbatim;
 *  - where the dossier prints none, the range is an ASSUMED spread (≈ ±40-50 % or the span of the cited studies) and the
 *    ParamDef `note` says "range assumed" — these are calibration items for the integration pass, not evidence;
 *  - structural constants (thresholds, caps, unit conversions, exponents that define the equation's shape) are `fixed`.
 * `status`: verified = number located in the cited source by the dossier author; proposed-fit = the dossier's own fit
 * ("PROPOSED FIT"/"PROPOSED"/DERIVED); unverified = dossier flag UNVERIFIED (or a number that this module had to
 * choose because the dossier gives none — flagged in `note`).
 */
import type { ParamDef } from '../../types/params';
import { GENERATORS, N_Z, Z_MARKERS } from './baselines';

type Status = NonNullable<ParamDef['status']>;

const P = (
  name: string,
  value: number,
  unit: string,
  low: number,
  high: number,
  grade: ParamDef['grade'],
  source: string,
  dossier: string,
  status: Status,
  extra: Pick<ParamDef, 'draw' | 'note' | 'label'> = {},
): ParamDef => ({ id: `cardiometabolic.${name}`, value, unit, low, high, grade, source, dossier, status, ...extra });

/** Structural / definitional constant: never varied in draws. */
const FIX = (
  name: string,
  value: number,
  unit: string,
  grade: ParamDef['grade'],
  source: string,
  dossier: string,
  status: Status,
  note?: string,
): ParamDef => P(name, value, unit, value, value, grade, source, dossier, status, { draw: 'fixed', ...(note ? { note } : {}) });

const R_ASSUMED = 'range assumed (dossier gives none)';

// Source strings (author year + PMID/DOI as given by dossier 06's reference list)
const MENSINK16 = 'Mensink 2016 WHO meta-regression (ISBN 978-92-4-156534-9; FSANZ SD1)';
const CLARKE97 = 'Clarke 1997 PMID 9006469; Weggemans 2001 PMID 11333841; Keys 1965 PMID 25286460';
const OMNIHEART = 'Appel 2005 OmniHeart PMID 16287956';
const NORWITZ = 'Norwitz 2022 PMID 35106434; Buren 2021 PMID 33801247; Retterstol 2018 PMID 30408717';
const MAGKOS = 'Magkos 2016 PMID 26916363';
const NETER = 'Neter 2003 PMID 12975389';
const FILIPPINI = 'Filippini 2021 PMID 33586450';
const DASH = 'Appel 1997 PMID 9099655; Sacks 2001 PMID 11136953; Juraschek 2017 (06 R46c)';
const DATTILO = 'Dattilo 1992 PMID 1386186';
const KODAMA = 'Kodama 2007 PMID 17533202; Halbert 1999 (06 R44b)';
const OMEGA3 = 'Skulas-Ray 2019 PMID 31422671; Wang 2023 spline (06 R38e); Skulas-Ray 2011 (06 R38b)';
const LIVER = 'Browning 2011; Kirk 2009 PMID 19208352; Mardinoglu 2018; Lim 2011 PMID 21656330; Magkos 2016 PMID 26916363';
const LUUK = 'Luukkonen 2018 PMID 29844096; Rosqvist 2014/2019 (06 R54b,c); Sevastianova 2012';
const TAHARA = 'Tahara 1995 (06 R48b); Nathan 2008 ADAG PMID 18540046';

export const CARDIOMETABOLIC_PARAMS: readonly ParamDef[] = [
  // =================================================================================================================
  // 04 §4.18 insulin sensitivity (S_hep, S_mus)
  // =================================================================================================================
  P('si.tauHep', 2, 'd', 1, 4, 'C', '04 §4.18 (48 h CR effects: Kirk 2009 PMID 19208352; Lim 2011 PMID 21656330)', '04 §4.18', 'proposed-fit', { note: R_ASSUMED }),
  P('si.tauMus', 3, 'd', 1.5, 6, 'C', '04 §4.18 (muscle sensitivity follows weight/exercise)', '04 §4.18', 'proposed-fit', { note: R_ASSUMED }),
  FIX('si.expHep', 0.4, '1', 'C', '04 §4.18 S_I = S_hep^0.4·S_mus^0.6', '04 §4.18', 'proposed-fit'),
  P('si.lfA', 0.08, '1/%', 0.04, 0.12, 'C', '04 §4.18 F_LF; Taylor/Magnusson liver data (Lim 2011 PMID 21656330; Petersen 2005 PMID 15734833)', '04 §4.18', 'proposed-fit', { note: R_ASSUMED }),
  FIX('si.lfRef', 3, '%', 'C', '04 §4.18 F_LF (normal liver fat 2-3 %)', '04 §4.18', 'proposed-fit'),
  P('si.ebDefA', 0.25, '1', 0.1, 0.4, 'C', '04 §4.18 F_EBh deficit branch (Kirk 2009 PMID 19208352; Lim 2011 PMID 21656330)', '04 §4.18', 'proposed-fit', { note: R_ASSUMED }),
  P('si.ebSurA', 0.1, '1', 0.05, 0.2, 'C', '04 §4.18 F_EBh surplus branch (Luukkonen 2018 PMID 29844096: HOMA-IR +23 % with SFA)', '04 §4.18', 'proposed-fit', { note: R_ASSUMED }),
  FIX('si.ebScale', 1000, 'kcal/d', 'C', '04 §4.18 F_EBh scale (3-day mean energy balance)', '04 §4.18', 'proposed-fit'),
  P('si.adipK', 0.08, '1/%FM', 0.04, 0.12, 'C', '04 §4.18 F_adip (Magkos 2016 PMID 26916363: +25 % at 5 % WL, ≈2× at 11-16 %)', '04 §4.18', 'proposed-fit', { note: R_ASSUMED }),
  FIX('si.adipFloor', 0.4, '1', 'C', '04 §4.18 F_adip floor', '04 §4.18', 'proposed-fit'),
  P('si.fmRefM', 18, '%FM', 14, 22, 'C', '04 §4.18 F_adip reference body fat, men', '04 §4.18', 'unverified', { note: 'dossier UNVERIFIED; ' + R_ASSUMED }),
  P('si.fmRefF', 28, '%FM', 24, 32, 'C', '04 §4.18 F_adip reference body fat, women', '04 §4.18', 'unverified', { note: 'dossier UNVERIFIED; ' + R_ASSUMED }),
  P('si.stepsA', 0.17, '1', 0.08, 0.25, 'B', '04 §4.18 F_steps (Krogh-Madsen 2010 PMID 20044474: −17 % at ≈1 300 steps/d for 2 wk)', '04 §4.18', 'proposed-fit', { note: R_ASSUMED }),
  FIX('si.stepsRef', 8000, 'steps/d', 'B', '04 §4.18 F_steps', '04 §4.18', 'proposed-fit'),
  FIX('si.stepsSpan', 6700, 'steps/d', 'B', '04 §4.18 F_steps', '04 §4.18', 'proposed-fit'),
  P('si.tauSteps', 7, 'd', 4, 14, 'B', '04 §4.18 F_steps (7-day mean steps)', '04 §4.18', 'proposed-fit', { note: R_ASSUMED }),
  P('si.fitSlope', 0.01, '1/(mL/kg/min)', 0.0, 0.02, 'D', '04 §4.18 F_fit', '04 §4.18', 'unverified', { note: 'dossier UNVERIFIED slope; ' + R_ASSUMED }),
  FIX('si.fitRef', 40, 'mL/kg/min', 'D', '04 §4.18 F_fit', '04 §4.18', 'unverified'),
  FIX('si.fitMin', 0.85, '1', 'D', '04 §4.18 F_fit clamp', '04 §4.18', 'unverified'),
  FIX('si.fitMax', 1.25, '1', 'D', '04 §4.18 F_fit clamp', '04 §4.18', 'unverified'),
  P('si.exA', 0.25, '1', 0.1, 0.4, 'B', '04 §4.18 F_exAcute (Mikines 1988 PMID 3126668; King 1995; 10 §4.10 acute peak 0.40)', '04 §4.18', 'proposed-fit', { note: R_ASSUMED }),
  FIX('si.exKcal', 400, 'kcal', 'B', '04 §4.18 E_is = min(1, EE_session/400 kcal)', '04 §4.18', 'proposed-fit'),
  FIX('si.exSets', 12, 'sets', 'B', '04 §4.18 E_is = min(1, sets/12)', '04 §4.18', 'proposed-fit'),
  FIX('si.exHoldH', 24, 'h', 'B', '04 §4.18 E_is flat for Δt < 24 h', '04 §4.18', 'proposed-fit'),
  P('si.exTauH', 30, 'h', 20, 45, 'B', '04 §4.18 E_is decay after 24 h (persists 48 h, gone by 5 d: Mikines 1988 PMID 3126668)', '04 §4.18', 'proposed-fit', { note: R_ASSUMED }),
  P('si.sfaA', 0.012, '1/%E', 0.006, 0.02, 'C', '04 §4.18 F_SFA (Vessby 2001 PMID 11317662: −10 % on SFA vs MUFA diet over 3 months)', '04 §4.18', 'proposed-fit', { note: R_ASSUMED }),
  FIX('si.sfaRef', 10, '%E', 'C', '04 §4.18 F_SFA', '04 §4.18', 'proposed-fit'),
  FIX('si.sfaFatMaxPct', 37, '%E', 'C', '04 §4.18 F_SFA domain: the SFA effect on insulin sensitivity was seen only when total fat was < 37 %E (Vessby 2001 PMID 11317662)', '04 §4.18', 'proposed-fit',
    'F_SFA = 1 at total fat ≥ 37 %E: keeps 04 §8 myth 10 (fasting insulin falls on very-low-carbohydrate / high-fat diets) instead of extrapolating the SFA slope to 20-30 %E SFA at 70-80 %E fat.'),
  P('si.tauSfa', 21, 'd', 14, 35, 'C', '04 §4.18 F_SFA lag', '04 §4.18', 'proposed-fit', { note: R_ASSUMED }),
  P('si.sugarA', 0.0034, '1/%E', 0.002, 0.005, 'C', '04 §4.18 F_sugar (Sigala 2022 PMID 35458210; Stanhope 2009 PMID 19381015: 25 %E ⇒ −8.5 %)', '04 §4.18', 'proposed-fit', { note: R_ASSUMED }),
  P('si.tauSugar', 7, 'd', 3, 14, 'C', '04 §4.18 F_sugar lag', '04 §4.18', 'proposed-fit', { note: R_ASSUMED }),
  FIX('si.homaRef', 1.56, '1', 'C', '04 §4.18 HOMA_ref = 5.0·7/22.5 at S_hep = 1', '04 §4.18', 'proposed-fit'),

  // =================================================================================================================
  // 04 §4.19 + 13 §4.8 carbohydrate tolerance T_C (ruling R-TC)
  // =================================================================================================================
  FIX('tc.ciLow', 50, 'g/d', 'C', '04 §4.19 T_C* = clamp((CI_3d − 50)/100, 0, 1)', '04 §4.19', 'proposed-fit'),
  FIX('tc.ciSpan', 100, 'g/d', 'C', '04 §4.19', '04 §4.19', 'proposed-fit'),
  FIX('tc.wFast', 0.6, '1', 'C', '04 §4.19 T_C = 0.6·T_fast + 0.4·T_slow', '04 §4.19', 'proposed-fit'),
  P('tc.tauFast', 2.5, 'd', 1, 3.5, 'C', '04 §4.19; Numao 2012 PMID 22669333; 13 §4.8 τ_f range 1-3 d', '04 §4.19', 'proposed-fit'),
  P('tc.tauSlow', 28, 'd', 10, 42, 'C', 'Jansen 2022 PMID 35108378 (13 §4.8 change point ≈ 5 wk); MODEL_SPEC R-TC (04\'s 14 d = low)', '13 §4.8', 'proposed-fit', {
    note: 'MODEL_SPEC ruling R-TC: 28 d [10, 42]; 04 §4.19 value 14 d is inside the range',
  }),
  P('tc.ogttAf', 1.0, 'mmol/L', 0.5, 1.5, 'C', '13 §4.8 a_f (Numao 2012 PMID 22669333; Goedecke 1999 PMID 10599981)', '13 §4.8', 'unverified', { note: 'dossier UNVERIFIED (iAUC data only); ' + R_ASSUMED }),
  P('tc.ogttAs', 1.0, 'mmol/L', 0.6, 1.2, 'C', '13 §4.8 a_s (Jansen 2022 PMID 35108378: ≈0.7-0.8 mmol/L decline weeks 2-9)', '13 §4.8', 'proposed-fit'),
  FIX('tc.readyThreshold', 0.1, '1', 'C', 'MODEL_SPEC §1.14 step 2: OGTT-readiness flag uses 1 − T_C > 0.1', '04 §4.19', 'proposed-fit'),

  // =================================================================================================================
  // 04 §4.13b hepatic fractional DNL (diagnostic biomarker; does not change fat mass)
  // =================================================================================================================
  FIX('fdnl.base', 3.7, '%', 'C', '04 §4.13(b) Schwarz 1995 (04 ref 43); Schwarz 2003 (04 ref 44)', '04 §4.13b', 'proposed-fit'),
  FIX('fdnl.slope', 0.416, '1/(10 %E)', 'C', '04 §4.13(b) fit anchors: 30 % CHO → 2 %, 75 % → 13 %', '04 §4.13b', 'proposed-fit'),
  FIX('fdnl.ebScale', 50, '%', 'C', '04 §4.13(b)', '04 §4.13b', 'proposed-fit'),
  FIX('fdnl.ebGain', 1.5, '1', 'C', '04 §4.13(b)', '04 §4.13b', 'proposed-fit'),
  FIX('fdnl.sugarA', 0.5, '1', 'C', '04 §4.13(b) m_sugar = 0.5 + 2.0·(free-sugar share of CHO)', '04 §4.13b', 'unverified'),
  FIX('fdnl.sugarB', 2.0, '1', 'C', '04 §4.13(b)', '04 §4.13b', 'unverified'),
  FIX('fdnl.irGain', 2.5, '1', 'C', '04 §4.13(b) m_IR = 1 + 2.5·max(0, 1 − S_hep)', '04 §4.13b', 'proposed-fit'),
  FIX('fdnl.cap', 50, '%', 'C', '04 §4.13(b)', '04 §4.13b', 'proposed-fit'),

  // =================================================================================================================
  // Lipids: composition (06 §4.2), mmol/L per 1 %E replacing carbohydrate isocalorically
  // =================================================================================================================
  P('ldl.sfa', 0.036, 'mmol/L per %E', 0.03, 0.043, 'A', MENSINK16, '06 §4.2.1 Table 4.2-A', 'verified'),
  P('ldl.mufa', -0.009, 'mmol/L per %E', -0.014, -0.003, 'A', MENSINK16, '06 §4.2.1 Table 4.2-A', 'verified'),
  P('ldl.pufa', -0.022, 'mmol/L per %E', -0.028, -0.015, 'A', MENSINK16, '06 §4.2.1 Table 4.2-A', 'verified'),
  P('ldl.prot', -0.0085, 'mmol/L per %E', -0.0128, -0.0043, 'B', OMNIHEART, '06 §4.2.6', 'verified', { note: R_ASSUMED + ' (single trial, ±50 %)' }),
  P('ldl.wtPerKg', 0.6, 'mg/dL per kg lost', 0.0, 1.3, 'B', 'Poobalan 2004 (06 R39b: TC −0.9 mg/dL/kg); Zomer 2016 PMID 27324830; Wing 2011 PMID 21593294 (Look AHEAD: 0); Petersen 2026 PMID 42660124', '06 §4.7-B', 'proposed-fit', {
    note: 'dossier range 0 to −1.3; zero for a keto-LEM responder (applied through the LEM responsiveness)',
  }),
  P('hdl.sfa', 0.011, 'mmol/L per %E', 0.01, 0.013, 'A', MENSINK16, '06 §4.2.1 Table 4.2-A', 'verified'),
  P('hdl.mufa', 0.008, 'mmol/L per %E', 0.007, 0.01, 'A', MENSINK16, '06 §4.2.1 Table 4.2-A', 'verified'),
  P('hdl.pufa', 0.006, 'mmol/L per %E', 0.004, 0.008, 'A', MENSINK16, '06 §4.2.1 Table 4.2-A', 'verified'),
  P('hdl.prot', -0.0034, 'mmol/L per %E', -0.0051, -0.0017, 'B', OMNIHEART, '06 §4.2.6', 'verified', { note: R_ASSUMED + ' (single trial, ±50 %)' }),
  // TG: relative (ln) coefficient per %E = Mensink TG coefficient / 1.2 mmol/L (06 §4.5 component 1)
  P('tg.sfa', -0.01, 'ln per %E', -0.0125, -0.0067, 'A', MENSINK16 + ' (−0.012 mmol/L ÷ 1.2)', '06 §4.5 component 1', 'verified'),
  P('tg.mufa', -0.0125, 'ln per %E', -0.015, -0.0092, 'A', MENSINK16 + ' (−0.015 mmol/L ÷ 1.2)', '06 §4.5 component 1', 'verified'),
  P('tg.pufa', -0.0175, 'ln per %E', -0.0208, -0.0142, 'A', MENSINK16 + ' (−0.021 mmol/L ÷ 1.2)', '06 §4.5 component 1', 'verified'),
  P('tg.prot', -0.017, 'ln per %E', -0.0255, -0.0085, 'B', OMNIHEART + ' (−0.0177 mmol/L per %E ≈ −1.7 %/%E at TG 106 mg/dL)', '06 §4.5 component 2', 'verified', { note: R_ASSUMED + ' (single trial, ±50 %)' }),
  FIX('tg.exchangeFatMaxPct', 53, '%E', 'A', MENSINK16 + ' (range of validity: fat 4.5-53 %E; 06 §4.5 component 1)', '06 §4.5 component 1', 'verified', 'the fatty-acid exchange terms of TG are scaled down so that they do not act beyond 53 %E fat (the keto multiplier covers the rest)'),
  FIX('lipid.tg0MeanMmolL', 1.2, 'mmol/L', 'A', MENSINK16 + ' (mean TG of the regression data set)', '06 §4.5 component 1', 'verified'),
  // baseline dependence of the LDL SFA/PUFA coefficients (06 §4.2.1 "Baseline dependence")
  P('ldl.baseScale', 0.35, '1 per 40 mg/dL', 0.2, 0.5, 'B', MENSINK16 + ' Annex 4 (0.029 vs 0.041 mmol/L per %E below/above median baseline)', '06 §4.2.1', 'proposed-fit', { note: R_ASSUMED }),
  FIX('ldl.baseRef', 112, 'mg/dL', 'B', MENSINK16 + ' Annex 4', '06 §4.2.1', 'proposed-fit'),
  FIX('ldl.baseSpan', 40, 'mg/dL', 'B', MENSINK16 + ' Annex 4', '06 §4.2.1', 'proposed-fit'),
  FIX('ldl.baseMin', 0.7, '1', 'B', MENSINK16 + ' Annex 4 (clip)', '06 §4.2.1', 'proposed-fit'),
  FIX('ldl.baseMax', 1.4, '1', 'B', MENSINK16 + ' Annex 4 (clip)', '06 §4.2.1', 'proposed-fit'),
  // dietary cholesterol: dTC = 1.5·(sqrt(z2) − sqrt(z1)), z in mg/1000 kcal; LDL 0.77·dTC, HDL 0.14·dTC
  P('chol.keys', 1.5, 'mg/dL per sqrt(mg/1000 kcal)', 1.2, 1.8, 'B', CLARKE97, '06 §4.2.5', 'proposed-fit', { note: R_ASSUMED }),
  P('chol.ldlPerTc', 0.77, '1', 0.6, 0.9, 'B', CLARKE97 + ' (Clarke LDL/TC = 0.10/0.13)', '06 §4.2.5', 'proposed-fit', { note: R_ASSUMED }),
  P('chol.hdlPerTc', 0.14, '1', 0.08, 0.2, 'B', CLARKE97 + ' (Weggemans HDL/TC = 0.008/0.056)', '06 §4.2.5', 'proposed-fit', { note: R_ASSUMED }),
  FIX('chol.capMgD', 900, 'mg/d', 'B', 'Berger 2015 PMID 26109578 (LDL response no longer significant above 900 mg/d)', '06 §4.2.5', 'verified'),
  FIX('chol.habitualM', 365, 'mg/d', 'B', 'NHANES 2017-2020 day-1 recall (06 §2.4, R60)', '06 §2.4', 'verified'),
  FIX('chol.habitualF', 276, 'mg/d', 'B', 'NHANES 2017-2020 day-1 recall (06 §2.4, R60)', '06 §2.4', 'verified'),
  P('chol.mResp', 1, '1', 0.243, 2.06, 'C', 'Katan & Beynen 1987 PMID 3544818 (hyper/hypo-responders): lognormal mean 1, CV 1.0, truncated [0, 3]', '06 §4.2.5', 'unverified', {
    draw: 'logTri', note: 'individual response multiplier; P10-P90 of lognormal(μ = −0.347, σ = 0.833); dossier: shape UNVERIFIED',
  }),
  FIX('lipid.mgdlPerMmolChol', 38.67, 'mg/dL per mmol/L', 'A', 'unit conversion (06 conventions)', '06 §0', 'verified'),
  // time constants of the composition mechanisms (06 §4.2.4, §4.5, §4.6)
  P('tau.ldlComp', 7, 'd', 4, 12, 'B', '06 §4.2.4 (95 % complete by 3 wk; LDL residence ≈ 2 d, Millar 2005 PMID 15637307)', '06 §4.2.4', 'proposed-fit', { note: R_ASSUMED }),
  P('tau.hdlComp', 10, 'd', 6, 16, 'B', '06 §4.2.4', '06 §4.2.4', 'proposed-fit', { note: R_ASSUMED }),
  P('tau.tgComp', 4, 'd', 2, 7, 'B', '06 §4.5 time dynamics (TG halves within 1 wk of VLCD)', '06 §4.5', 'proposed-fit', { note: R_ASSUMED }),
  P('tau.portfolio', 10, 'd', 6, 16, 'A', 'Whitehead 2014 (06 R28): no duration dependence across 2-12 wk', '06 §4.4', 'proposed-fit', { note: R_ASSUMED }),
  P('tau.lem', 10, 'd', 5, 16, 'C', NORWITZ + ' (LDL rises within 1-3 wk)', '06 §4.3', 'proposed-fit', { note: R_ASSUMED }),
  P('tau.ldlWeight', 37.5, 'd', 30, 45, 'C', '06 §4.7 implementation (fat-mass state, 30-45 d when the #01 lag is not available)', '06 §4.7', 'proposed-fit', { note: 'midpoint of the dossier range 30-45 d' }),

  // =================================================================================================================
  // LEM term (06 §4.3): hyper-responder LDL rise in lean people on carbohydrate restriction (grade C/D, on by default)
  // =================================================================================================================
  FIX('lem.enabled', 1, '0/1', 'D', '06 §4.18 default toggles: LEM term on (labelled grade C/D)', '06 §4.18', 'proposed-fit'),
  P('lem.a', 45, 'mg/dL', 10, 65, 'C', NORWITZ + ' (Buren BMI ~22: +70 total, ~25 composition ⇒ 45)', '06 §4.3', 'proposed-fit', { note: 'dossier range 10-65' }),
  P('lem.b', 4.5, 'mg/dL per BMI unit', 3.0, 5.9, 'C', 'Norwitz 2022 PMID 35106434 (BMI β = −4.5…−5.9 mg/dL per unit)', '06 §4.3', 'proposed-fit'),
  FIX('lem.bmiRef', 22, 'kg/m²', 'C', '06 §4.3', '06 §4.3', 'proposed-fit'),
  // s_keto is evaluated on the day's 24-h MEAN BHB (the ketones module's hourly curve); 06's "≥ 0.5 mM saturating at 1.5"
  // are trial-reported (morning/spot) values. A strict ketogenic diet (< 30 g/d) gives a 24-h mean of 0.3-0.7 mM (05:
  // Urbain; engine 0.3-0.5), so with the literal bounds s_keto stayed ≈ 0 on every diet and the LEM, liver f_cr and TG keto
  // terms — whose 06 fits assume s_keto ≈ 1 on such diets — never fired (finisher 2026-09-30). Bounds on the 24-h mean: 0.2
  // (05 §6 'light ketosis') → 0.5 (05 §6 'nutritional ketosis').
  FIX('lem.ketoLo', 0.2, 'mmol/L', 'C', '06 §4.3 s_keto (BHB ≥ ~0.5 mM spot) expressed on the 24-h mean BHB: 05 §6 light-ketosis bound 0.2', '06 §4.3; 05 §6', 'proposed-fit'),
  FIX('lem.ketoHi', 0.5, 'mmol/L', 'C', '06 §4.3 s_keto (saturating at ≥ 1.5 mM spot) expressed on the 24-h mean BHB: 05 §6 nutritional-ketosis bound 0.5', '06 §4.3; 05 §6', 'proposed-fit'),
  FIX('lem.emodSlope', 2, '1', 'D', '06 §4.3 E_mod = clip(1 − 2·(EI/EE − 1), 0, 1.5) (Feldman 2022 PMID 35938774; grade D)', '06 §4.3', 'proposed-fit'),
  FIX('lem.emodMax', 1.5, '1', 'D', '06 §4.3 E_mod cap', '06 §4.3', 'proposed-fit'),
  P('lem.mResp', 1, '1', 0.463, 2.158, 'C', 'Norwitz 2022 PMID 35106434: lognormal(μ 0, σ 0.6), P(m > 2) = 12 %', '06 §4.3', 'proposed-fit', {
    draw: 'logTri', note: 'individual LEM multiplier; nominal 1 = the dossier median (μ = 0); P10-P90 = exp(±1.2816·0.6)',
  }),

  // =================================================================================================================
  // Portfolio components (06 §4.4). Sterols and soy have no schedule input and are not modelled.
  // =================================================================================================================
  P('vf.emax', 0.45, 'mmol/L', 0.35, 0.6, 'A', 'PROPOSED FIT to oat/barley β-glucan, psyllium, glucomannan (06 R27-R29c)', '06 §4.4', 'proposed-fit', { note: R_ASSUMED }),
  P('vf.d50', 2.5, 'g/d', 1.5, 4, 'A', 'PROPOSED FIT (06 §4.4): d = 3 g → −0.245, 6.5 → −0.325, 10.2 → −0.36 mmol/L', '06 §4.4', 'proposed-fit', { note: R_ASSUMED }),
  FIX('vf.ldlRef', 115, 'mg/dL', 'A', '06 §4.4 "scale by (LDL0/115)"', '06 §4.4', 'proposed-fit'),
  P('nuts.perServing', 4.8, 'mg/dL per 28.4 g', 4.2, 5.5, 'A', 'Del Gobbo 2015 PMID 26561616 (−4.8 mg/dL per serving, CI −5.5…−4.2)', '06 §4.4', 'verified'),
  P('nuts.perServingHigh', 5.5, 'mg/dL per 28.4 g', 4.8, 6.5, 'A', 'Del Gobbo 2015 PMID 26561616 (stronger ≥ 60 g/d)', '06 §4.4', 'proposed-fit', { note: R_ASSUMED }),
  FIX('nuts.servingG', 28.4, 'g', 'A', 'Del Gobbo 2015 PMID 26561616', '06 §4.4', 'verified'),
  FIX('nuts.capServings', 3, 'servings/d', 'A', '06 §4.4 (cap at 3 servings)', '06 §4.4', 'proposed-fit'),

  // =================================================================================================================
  // HDL other drivers (06 §4.6) and time constants
  // =================================================================================================================
  P('hdl.alcPer30g', 3.99, 'mg/dL per 30 g/d', 3.25, 4.73, 'A', 'Rimm 1999 PMID 10591709 (30 g ethanol/d: +3.99 mg/dL)', '06 §4.6', 'verified'),
  P('hdl.aerobic', 2.53, 'mg/dL', 1.9, 3.5, 'A', KODAMA + ' (+2.53 mg/dL Kodama; +1.9 Halbert)', '06 §4.6', 'verified', { note: 'high bound assumed' }),
  P('hdl.aerobicRefMin', 120, 'min/wk', 90, 150, 'A', KODAMA + ' (minimal volume ≈ 900 kcal/wk ≈ 120 min/wk)', '06 §4.6', 'proposed-fit', { note: R_ASSUMED }),
  P('hdl.n3PerG', 0.75, 'mg/dL per g/d', 0.4, 1.75, 'B', 'Wang 2023 spline (06 R38e): +1.5 mg/dL per 2 g/d; +3.5 at ~1.75 g/d', '06 §4.5/4.6/4.14', 'proposed-fit'),
  P('hdl.wtStable', 0.35, 'mg/dL per kg', 0.2, 0.5, 'A', DATTILO + ' (+0.009 mmol/L per kg lost once weight-stable)', '06 §4.7-B', 'verified', { note: R_ASSUMED }),
  P('hdl.wtActive', -0.27, 'mg/dL per kg', -0.4, -0.15, 'A', DATTILO + ' (−0.007 mmol/L per kg lost while actively losing)', '06 §4.7-B', 'verified', { note: R_ASSUMED }),
  FIX('alc.validityG', 100, 'g/d', 'A', 'Rimm 1999 PMID 10591709 (upper range of the data; 06 §9 model valid to ~100 g/d)', '06 §9', 'verified'),
  FIX('hdl.activeRate', 0.25, '%/wk', 'A', '06 §4.7-B active loss = rate of loss > 0.25 %/week', '06 §4.7-B', 'verified'),
  P('tau.hdlExercise', 30, 'd', 21, 45, 'B', '06 §4.6 (30 d, exercise)', '06 §4.6', 'proposed-fit', { note: R_ASSUMED }),
  P('tau.hdlWeight', 30, 'd', 21, 45, 'B', '06 §4.6 (30 d, weight; stable component builds over 4-8 wk)', '06 §4.6', 'proposed-fit', { note: R_ASSUMED }),

  // =================================================================================================================
  // Triglycerides (06 §4.5)
  // =================================================================================================================
  P('tg.sugarHyper', 0.26, 'mmol/L', 0.11, 0.41, 'B', 'Chiavaroli 2021 (06 R35b): hypercaloric fructose +21-35 %E: TG +0.26 mmol/L (0.11, 0.41)', '06 §4.5 component 3', 'verified'),
  FIX('tg.sugarExcessRef', 28, '%E', 'B', '06 §4.5 component 3 (min(1, excess %E/28))', '06 §4.5', 'proposed-fit'),
  P('tg.sugarBalanced', 0.006, 'mmol/L per %E above 10', 0.003, 0.01, 'C', 'Te Morenga 2014 PMID 24808490 (0.11 mmol/L per ≈15-20 %E) compromise with the isocaloric null of Chiavaroli 2021', '06 §4.5 component 3', 'proposed-fit', { note: R_ASSUMED }),
  FIX('tg.sugarFreeRef', 10, '%E', 'C', '06 §4.5 component 3', '06 §4.5', 'proposed-fit'),
  P('tg.alcPerG', 0.19, 'mg/dL per g/d', 0.083, 0.297, 'A', 'Rimm 1999 PMID 10591709 (30 g/d: +5.7 mg/dL, CI 2.5-8.9)', '06 §4.5 component 4', 'verified'),
  FIX('tg.alcCapG', 60, 'g/d', 'C', '06 §4.5 component 4 (linear up to 60 g/d)', '06 §4.5', 'unverified'),
  P('tg.n3PerG', 0.09, '1/(g/d)', 0.09, 0.12, 'A', OMEGA3, '06 §4.5 component 5', 'proposed-fit', {
    note: 'conservative default 0.09; high estimate 0.12 (Wang-like) — the dossier\'s two toggles',
  }),
  FIX('tg.n3Threshold', 0.5, 'g/d', 'A', '06 §4.5 component 5', '06 §4.5', 'proposed-fit'),
  FIX('tg.n3Cap', 0.4, '1', 'A', '06 §4.5 component 5 (capped at −40 %)', '06 §4.5', 'proposed-fit'),
  FIX('tg.n3Tg0Ref', 200, 'mg/dL', 'A', '06 §4.5 component 5', '06 §4.5', 'proposed-fit'),
  FIX('tg.n3Exp', 0.4, '1', 'A', '06 §4.5 component 5', '06 §4.5', 'proposed-fit'),
  P('tg.ketoK', 0.35, 'ln', 0.2, 0.5, 'B', 'Petersen 2026 PMID 42660124; Mardinoglu 2018 (06 R53c): exp(−0.35·s_keto)', '06 §4.5 component 7', 'proposed-fit', { note: R_ASSUMED }),
  P('tg.wtBmi25', 0.015, 'ln per kg', 0.01, 0.022, 'B', MAGKOS + '; Zomer 2016 PMID 27324830; Wing 2011 PMID 21593294', '06 §4.5 component 6', 'proposed-fit', { note: R_ASSUMED }),
  P('tg.wtBmi30', 0.02, 'ln per kg', 0.014, 0.028, 'B', MAGKOS + ' (−2.1 %/kg in BMI 40)', '06 §4.5 component 6', 'proposed-fit', { note: R_ASSUMED }),
  P('tg.acute', 0.6, 'ln', 0.3, 0.9, 'C', 'Lim 2011 PMID 21656330 (TG halved in week 1 of 600 kcal/d)', '06 §4.7 implementation', 'proposed-fit', { note: R_ASSUMED }),
  FIX('deficit.threshold', 0.2, '1', 'C', '06 §4.7 acute deficit terms active when D = 1 − EI/EE > 0.2', '06 §4.7', 'proposed-fit'),
  P('tg.exercise', 0.06, 'ln', 0.03, 0.1, 'B', 'Halbert 1999 (06 R44b): −0.08 mmol/L TG; PROPOSED −6 %', '06 §4.5 component 8', 'proposed-fit', { note: R_ASSUMED }),
  FIX('tg.exerciseRefMetH', 15, 'MET·h/wk', 'B', '06 §4.5 component 8', '06 §4.5', 'proposed-fit'),
  P('tau.tgAcute', 5, 'd', 3, 7, 'C', '06 §4.7 implementation (energy-deficit acute state τ 3-7 d)', '06 §4.7', 'proposed-fit'),
  P('tau.tgOmega3', 14, 'd', 7, 28, 'C', '06 §4.5 time dynamics (UNVERIFIED)', '06 §4.5', 'unverified', { note: 'dossier UNVERIFIED; ' + R_ASSUMED }),
  P('tau.tgExercise', 21, 'd', 14, 42, 'B', '06 §4.5 time dynamics', '06 §4.5', 'proposed-fit', { note: R_ASSUMED }),
  P('tau.tgWeight', 37.5, 'd', 30, 45, 'B', '06 §4.5 time dynamics (30-45 d)', '06 §4.5', 'proposed-fit', { note: 'midpoint of the dossier range 30-45 d' }),
  P('surplus.rampKcalD', 200, 'kcal/d', 100, 400, 'D', 'engineering smoothing of the dossier indicator 1[energy surplus] (06 §4.5, §4.13)', '06 §4.5', 'unverified', {
    note: 'not dossier-sourced; 7-day mean energy balance ≥ ramp counts as fully hypercaloric',
  }),

  // =================================================================================================================
  // Blood pressure (06 §4.8; 21 §4 levers)
  // =================================================================================================================
  P('bp.naBase', 1.0, 'mmHg per g Na', 0.7, 1.4, 'A', FILIPPINI + ' (−1.0 mmHg/g normotensive; β_Na,SBP = 1.0 + 1.8·sigmoid)', '06 §4.8', 'proposed-fit', { note: R_ASSUMED }),
  P('bp.naHyper', 1.8, 'mmHg per g Na', 1.3, 2.4, 'A', FILIPPINI + ' (−2.8 mmHg/g hypertensive ⇒ 1.0 + 1.8)', '06 §4.8', 'proposed-fit', { note: R_ASSUMED }),
  FIX('bp.sigCenter', 135, 'mmHg', 'A', '06 §4.8 equation set: sigmoid((SBP0 − 135)/8)', '06 §4.8', 'proposed-fit'),
  FIX('bp.sigWidth', 8, 'mmHg', 'A', '06 §4.8 equation set', '06 §4.8', 'proposed-fit'),
  FIX('bp.naFloor', 2.0, 'g/d', 'A', '06 §4.8 Na_eff = max(Na, 2.0) if SBP0 < 130 (no effect < 2 g/d in normotensives)', '06 §4.8', 'proposed-fit'),
  FIX('bp.naFloorSbp', 130, 'mmHg', 'A', '06 §4.8', '06 §4.8', 'proposed-fit'),
  P('bp.mNa', 1, '1', 0.387, 1.8, 'C', 'Weinberger 1986 PMID 3522418; heterogeneity I² 68-75 % (Filippini 2021)', '06 §4.8', 'unverified', {
    draw: 'logTri', note: 'salt-sensitivity multiplier, mean-one lognormal σ 0.6 (dossier UNVERIFIED); P10-P90 of lognormal(−0.18, 0.6)',
  }),
  P('bp.dashSbpA', 3.5, 'mmHg', 2.0, 5.0, 'A', DASH + ' (normotensive −3.5)', '06 §4.8', 'proposed-fit', { note: R_ASSUMED }),
  P('bp.dashSbpB', 8.0, 'mmHg', 5.0, 10.0, 'A', DASH + ' (hypertensive −11.4 ⇒ 3.5 + 8.0)', '06 §4.8', 'proposed-fit', { note: R_ASSUMED }),
  P('bp.dashNaShrink', 0.55, '1', 0.4, 0.7, 'A', DASH + ' (DASH roughly halves the sodium slope: 3.0/6.7 = 0.45)', '06 §4.8', 'proposed-fit', { note: R_ASSUMED }),
  P('bp.kPerMmol', 0.08, 'mmHg per mmol/d', 0.04, 0.12, 'B', 'Aburto 2013 PMID 23558164; Filippini 2020 (06 R47b)', '06 §4.8', 'proposed-fit', { note: R_ASSUMED }),
  FIX('bp.kCapMmol', 40, 'mmol/d', 'B', '06 §4.8 min(dK, 40)', '06 §4.8', 'proposed-fit'),
  FIX('bp.kZeroMmol', 80, 'mmol/d', 'B', '06 §4.8 U-shape: 0 beyond +80 mmol/d net', '06 §4.8', 'proposed-fit'),
  FIX('bp.kHyperMin', 0.4, '1', 'B', '06 §4.8 hyper_factor 0.4 for normotensives …', '06 §4.8', 'proposed-fit'),
  FIX('bp.kHyperSbpLo', 120, 'mmHg', 'B', '06 §4.8 hyper_factor ramp start (interpretation: "normotensive" ≤ 120 mmHg)', '06 §4.8', 'unverified', 'dossier gives the end points only; linear ramp 120-140 mmHg chosen'),
  FIX('bp.kHyperSbpHi', 140, 'mmHg', 'B', '06 §4.8 … to 1.0 for SBP0 ≥ 140', '06 §4.8', 'proposed-fit'),
  FIX('bp.kLowNaFactor', 0.4, '1', 'B', '06 §4.8 (Na_base < 3 g/d: potassium effect × 0.4)', '06 §4.8', 'proposed-fit'),
  FIX('bp.kNaThresholdG', 3.0, 'g/d', 'B', '06 §4.8', '06 §4.8', 'proposed-fit'),
  P('bp.exEnduranceA', 0.75, 'mmHg', 0.4, 1.2, 'A', 'Cornelissen 2013 PMID 23525435 (normotensive −0.75)', '06 §4.8', 'proposed-fit'),
  P('bp.exEnduranceB', 7.5, 'mmHg', 5.0, 9.0, 'A', 'Cornelissen 2013 PMID 23525435 (hypertensive −8.3)', '06 §4.8', 'proposed-fit', { note: R_ASSUMED }),
  FIX('bp.exRefMin', 150, 'min/wk', 'A', '06 §4.8 min(1, aerobic_min_per_week/150)', '06 §4.8', 'proposed-fit'),
  P('bp.exRtA', 0.5, 'mmHg', 0.2, 1.0, 'A', 'MacDonald 2016 (06 R50b)', '06 §4.8', 'proposed-fit', { note: R_ASSUMED }),
  P('bp.exRtB', 5.5, 'mmHg', 3.0, 7.0, 'A', 'MacDonald 2016 (06 R50b)', '06 §4.8', 'proposed-fit', { note: R_ASSUMED }),
  FIX('bp.exRtRefSets', 12, 'sets/region/wk', 'A', '06 §4.8 RT: min(1, sets/wk/12)', '06 §4.8', 'proposed-fit'),
  P('bp.weight', 1.05, 'mmHg per kg', 0.66, 1.43, 'A', NETER + ' (−1.05 mmHg/kg, CI −1.43…−0.66)', '06 §4.7-B/§4.8', 'verified'),
  P('bp.alcohol', 0.15, 'mmHg per g/d above threshold', 0.05, 0.25, 'A', 'Roerecke 2017 PMID 29253389 (−5.5 mmHg for a 36 g/d cut from 72 g/d)', '06 §4.8', 'proposed-fit', { note: R_ASSUMED }),
  FIX('bp.alcoholThresholdG', 24, 'g/d', 'A', '06 §4.8 (no effect ≤ 2 drinks/day)', '06 §4.8', 'proposed-fit'),
  P('bp.protein', -0.14, 'mmHg per %E', -0.21, -0.07, 'B', OMNIHEART, '06 §4.2.6/§4.8', 'verified', { note: R_ASSUMED + ' (single trial)' }),
  P('bp.mufa', -0.13, 'mmHg per %E', -0.2, -0.07, 'B', OMNIHEART, '06 §4.8', 'verified', { note: R_ASSUMED + ' (single trial)' }),
  P('bp.omega3', 2.6, 'mmHg per 2 g/d', 1.5, 4.5, 'A', '21 X3: SBP −2.6·min(D, 2)/2 mmHg (Zhang 2022 PMID 35647665), plateau 2-3 g/d', '21 §3 X3', 'verified', { note: 'range from 21: −1.5…−4.5 mmHg' }),
  P('bp.sauna', 4, 'mmHg', 0, 8, 'C', 'Lee 2022 PMID 35785965 (RCT −8.0 mmHg; PROPOSED 50 % shrink)', '21 §3 X7', 'proposed-fit', { note: 'lever only when sauna sessions are scheduled; range 0-8 (RCT value)' }),
  FIX('bp.saunaRefSessions', 3, 'sessions/wk', 'C', '21 X7: −4 mmHg·min(1, sessions/3)', '21 §3 X7', 'proposed-fit'),
  FIX('bp.leverCap', 8, 'mmHg', 'C', '21 §6: lever-derived BP shift capped at −8 mmHg total', '21 §6', 'proposed-fit'),
  P('tau.bpFast', 4, 'd', 2, 7, 'A', 'Juraschek 2017 (06 R46c): DASH SBP most of the effect by week 1', '06 §4.8', 'proposed-fit', { note: R_ASSUMED }),
  P('tau.bpSodium', 21, 'd', 14, 30, 'B', 'Juraschek 2017 (06 R46c): no plateau at 4 wk; Filippini: no difference 4-11 vs ≥ 12 wk', '06 §4.8', 'proposed-fit'),
  P('tau.bpAlcohol', 10, 'd', 5, 15, 'C', '06 §4.8 (UNVERIFIED)', '06 §4.8', 'unverified', { note: 'dossier UNVERIFIED; ' + R_ASSUMED }),
  P('tau.bpExercise', 30, 'd', 21, 42, 'A', 'Cornelissen 2013 PMID 23525435 (onset over 4-12 wk)', '06 §4.8', 'proposed-fit', { note: R_ASSUMED }),
  P('tau.bpSauna', 14, 'd', 7, 28, 'C', '21 X7 HeatIdx τ 14 d (UNVERIFIED)', '21 §3 X7', 'unverified', { note: 'dossier UNVERIFIED; ' + R_ASSUMED }),

  // =================================================================================================================
  // Liver fat (06 §4.9; 11 §4.9; 10 §4.7)
  // =================================================================================================================
  FIX('liver.l0A', 2.0, '%', 'C', '06 §4.9 L0 = 2.0·exp(0.11·(BMI − 22))·exp(0.9·z_L) (Szczepaniak 2005 PMID 15339742; Magkos 2016)', '06 §4.9', 'proposed-fit'),
  FIX('liver.l0B', 0.11, '1/BMI', 'C', '06 §4.9', '06 §4.9', 'proposed-fit'),
  P('liver.wl', 0.075, 'ln per %WL', 0.05, 0.1, 'B', LIVER, '06 §4.9', 'proposed-fit', { note: R_ASSUMED }),
  P('liver.cr', 0.4, 'ln', 0.25, 0.55, 'B', 'Browning 2011; Mardinoglu 2018; Kirk 2009; Qadri 2026; Petersen 2026 (mean ln ≈ −0.42)', '06 §4.9', 'proposed-fit', { note: R_ASSUMED }),
  P('liver.ex', 0.25, 'ln', 0.1, 0.4, 'B', 'Johnson 2009 (06 R55c); Keating 2015 (06 R55d); 10 §4.7 extraLiverFat −0.25·D_aer', '06 §4.9; 10 §4.7', 'proposed-fit', { note: R_ASSUMED }),
  FIX('liver.exRefMetH', 10, 'MET·h/wk', 'B', '06 §4.9 f_ex = exp(−0.25·min(1, METs·h/wk /10))', '06 §4.9', 'proposed-fit'),
  FIX('liver.exStack', 0.5, '1', 'B', '10 §4.7: extra = max(0, extra − 0.5 × weightLossEffect) when weight loss > 5 % dominates', '10 §4.7', 'proposed-fit'),
  FIX('liver.exStackPct', 5, '%WL', 'B', '10 §4.7 (weight loss > 5 %)', '10 §4.7', 'proposed-fit'),
  P('liver.acute', 0.9, 'ln', 0.5, 1.2, 'C', 'Lim 2011 PMID 21656330 (−30 % in week 1 at D ≈ 0.75)', '06 §4.9', 'proposed-fit', { note: R_ASSUMED }),
  P('liver.tauDown', 12, 'd', 8, 20, 'B', '06 §4.9 (30 % in week 1 of VLCD; 55 % in 14 d with < 20 g carbohydrate)', '06 §4.9', 'proposed-fit', { note: R_ASSUMED }),
  P('liver.tauUp', 21, 'd', 14, 30, 'B', '06 §4.9 (rises within 3 weeks on overfeeding)', '06 §4.9', 'proposed-fit', { note: R_ASSUMED }),
  P('liver.tauD', 120, 'd', 60, 200, 'C', '06 §4.9 D state τ_D = 120 d', '06 §4.9', 'proposed-fit', { note: R_ASSUMED }),
  FIX('liver.surplusMinKcal', 100, 'kcal/d', 'D', 'engineering: below this surplus over the habitual intake the mixed k_liver applies (11 §4.9 weights are surplus energy shares)', '11 §4.9', 'unverified'),
  P('liver.kMixed', 15, '% IHTG per % BW gained', 10, 20, 'B', '11 §4.9 k_mixed default (derived)', '11 §4.9', 'proposed-fit', { note: R_ASSUMED }),
  P('liver.kSfa', 28, '% IHTG per % BW gained', 20, 37, 'B', LUUK + ' (≈ 20-37)', '11 §4.9', 'proposed-fit'),
  P('liver.kUnsat', 15, '% IHTG per % BW gained', 10, 20, 'B', 'Luukkonen 2018 PMID 29844096 (+15 %/1.0 %)', '11 §4.9', 'proposed-fit', { note: R_ASSUMED }),
  P('liver.kN6', 0, '% IHTG per % BW gained', 0, 5, 'B', 'Rosqvist 2014/2019 (06 R54b,c): ≈ 0', '11 §4.9', 'proposed-fit', { note: 'high bound assumed' }),
  P('liver.kSugar', 18, '% IHTG per % BW gained', 13, 22, 'B', 'Sevastianova 2012; Luukkonen 2018 PMID 29844096 (≈ 13-22)', '11 §4.9', 'proposed-fit'),
  FIX('liver.min', 0.5, '%', 'C', 'physical floor of the store (MRS detection limit)', '06 §4.9', 'proposed-fit'),
  FIX('liver.max', 50, '%', 'C', 'physical ceiling of the store', '06 §4.9', 'proposed-fit'),

  // =================================================================================================================
  // Glycaemic markers (06 §4.11)
  // =================================================================================================================
  P('fpg.wtBase', 0.7, 'mg/dL per kg', 0.5, 1.2, 'B', 'DIETFITS (Gardner 2018 PMID 29466592); Magkos 2016; Wing 2011 PMID 21593294', '06 §4.7-B', 'proposed-fit', { note: R_ASSUMED }),
  FIX('fpg.wtSlope', 2.3, 'mg/dL per kg per (FPG0−100)/53', 'B', '06 §4.7-B: b = 0.7 + 2.3·(FPG0 − 100)/53, clip 0.5-3.5', '06 §4.7-B', 'proposed-fit'),
  FIX('fpg.wtMin', 0.5, 'mg/dL per kg', 'B', '06 §4.7-B clip', '06 §4.7-B', 'proposed-fit'),
  FIX('fpg.wtMax', 3.5, 'mg/dL per kg', 'B', '06 §4.7-B clip', '06 §4.7-B', 'proposed-fit'),
  FIX('fpg.acuteRefD', 0.5, '1', 'C', '06 §4.7 acute FPG term (D − 0.2)+/0.5', '06 §4.7', 'proposed-fit'),
  P('fpg.acute', 0.3, '1', 0.1, 0.5, 'C', 'Lim 2011 PMID 21656330 (FPG normalised within 1 wk of 600 kcal/d in T2D)', '06 §4.7', 'proposed-fit', { note: R_ASSUMED }),
  FIX('glc.fasting', 5.0, 'mmol/L', 'C', '04 §4.16 Glc_f = 5.0·S_hep^(−0.1) (fasting glucose of the intake curves)', '04 §4.16', 'proposed-fit'),
  FIX('glc.hepExp', -0.1, '1', 'C', '04 §4.16 Glc_f = 5.0·S_hep^(−0.1)', '04 §4.16', 'proposed-fit'),
  FIX('glc.fastClampMmolL', 3, 'mmol/L', 'C', 'engineering bound on the post-absorptive glucose offset taken from the intake module (dossier 20 §4.7: fasting nadir 3.3-3.5 mmol/L)', '20 §4.7', 'unverified'),
  P('tau.fpgAcute', 5, 'd', 3, 8, 'B', '06 §4.11 (τ_INS,acute 5 d; FPG half-time 6.3 d, Tahara 1995)', '06 §4.11', 'proposed-fit', { note: R_ASSUMED }),
  P('tau.fpgWeight', 30, 'd', 20, 45, 'B', '06 §4.11 (τ_INS,weight 30 d)', '06 §4.11', 'proposed-fit', { note: R_ASSUMED }),
  P('a1c.tau', 50, 'd', 36, 65, 'A', TAHARA + ' (half-time 34.6 ± 10.1 d ⇒ τ 50 d)', '06 §4.11', 'verified'),
  FIX('a1c.eagSlope', 28.7, 'mg/dL per %', 'A', 'Nathan 2008 ADAG PMID 18540046: eAG = 28.7·A1c − 46.7', '06 §4.11', 'verified'),
  FIX('a1c.eagIntercept', 46.7, 'mg/dL', 'A', 'Nathan 2008 ADAG PMID 18540046', '06 §4.11', 'verified'),
  P('a1c.meanGlucoseFactor', 1.3, '1', 1.3, 1.8, 'B', 'Petersen 2026 PMID 42660124 (24-h mean fell 1.3× FPG on non-keto diets, 1.8× on keto)', '06 §4.11', 'proposed-fit'),

  // =================================================================================================================
  // hs-CRP (06 §4.12) and urate (06 §4.13, 20 §4.7)
  // =================================================================================================================
  P('crp.perBmi', 0.07, 'ln per BMI unit', 0.05, 0.1, 'B', 'NHANES slope 0.069-0.076/BMI (06 §2.3); Selvin 2007 PMID 17210875', '06 §4.7-B', 'proposed-fit', { note: R_ASSUMED }),
  FIX('crp.thresholdPct', 8, '%WL', 'B', '06 §4.7-B threshold rule (Magkos 2016: no change at 5 and 11 %, −33 % at 16 %)', '06 §4.7-B', 'proposed-fit'),
  P('crp.belowSlope', 0.3, '1', 0.0, 0.5, 'B', '06 §4.7-B: 30 % of the slope below the threshold', '06 §4.7-B', 'proposed-fit', { note: R_ASSUMED }),
  P('crp.exercise', 0.1, 'ln', 0.05, 0.15, 'A', 'Fedewa 2017 (06 R62b): ES 0.19-0.26 shrunk to the log scale', '06 §4.12', 'proposed-fit', { note: R_ASSUMED }),
  FIX('crp.exerciseRefMin', 150, 'min/wk', 'A', '06 §4.12', '06 §4.12', 'proposed-fit'),
  P('crp.omega3', 0.1, 'ln', 0.0, 0.15, 'C', 'Zhang 2022 / Skulas-Ray 2011 (06 R62c, R38b): conditional on CRP0 > 3 mg/L and EPA+DHA ≥ 2 g/d', '06 §4.12', 'proposed-fit', { note: R_ASSUMED }),
  FIX('crp.omega3Crp0', 3, 'mg/L', 'C', '06 §4.12', '06 §4.12', 'proposed-fit'),
  FIX('crp.omega3Dose', 2, 'g/d', 'C', '06 §4.12', '06 §4.12', 'proposed-fit'),
  P('tau.crpWeight', 45, 'd', 30, 60, 'B', '06 §4.12 (τ ≈ 30-60 d, weight-driven)', '06 §4.12', 'proposed-fit', { note: 'midpoint of the dossier range 30-60 d' }),
  P('tau.crpExercise', 60, 'd', 30, 90, 'A', '06 §4.12 (τ 60 d)', '06 §4.12', 'proposed-fit', { note: R_ASSUMED }),
  P('ua.perBhb', 0.6, 'mg/dL per mmol/L', 0.3, 1.0, 'C', 'Grundler 2024 (06 R63k); Goldfinger 1965 (06 R63l); Retterstol 2018', '06 §4.13', 'proposed-fit', { note: R_ASSUMED }),
  P('ua.cap', 4, 'mg/dL', 3, 6, 'C', '06 §4.13 (cap +4)', '06 §4.13', 'proposed-fit', { note: R_ASSUMED }),
  P('ua.alcohol', 0.013, 'mg/dL per g/d', 0.005, 0.02, 'C', 'Faller & Fox 1982 (06 R63j); Choi 2004 (06 R63h)', '06 §4.13', 'unverified', { note: 'dossier UNVERIFIED for non-gout adults; ' + R_ASSUMED }),
  FIX('ua.beverageMult', 1.0, '1', 'C', 'Choi 2004 (06 R63h): beer 1.0, spirits 0.35, wine 0.10', '06 §4.13', 'unverified',
    'convention (MODEL_SPEC review M20): the schedule has no beverage type, so the beer scaling (worst case) is used; alternatives spirits 0.35 and wine 0.10 are not sampled'),
  P('ua.fructose', 0.52, 'mg/dL', 0.3, 0.8, 'A', 'Wang 2012 (06 R63b): +35 %E fructose ⇒ +0.52 mg/dL', '06 §4.13', 'verified', { note: R_ASSUMED }),
  FIX('ua.fructoseRefPct', 35, '%E', 'A', '06 §4.13', '06 §4.13', 'proposed-fit'),
  P('ua.weight', 0.06, 'mg/dL per kg', 0.02, 0.22, 'C', 'Dessein 2000; Nielsen 2017 (06 R63c,d); NHANES slope', '06 §4.13', 'proposed-fit'),
  P('ua.dash', 0.25, 'mg/dL', 0.08, 0.43, 'A', 'DASH −0.25 mg/dL (−0.43, −0.08) (06 R63f)', '06 §4.13', 'verified'),
  FIX('ua.dashBase', 5, 'mg/dL', 'A', '06 §4.13 DASH_effect scaling clip((UA0 − 5)/2.5, 0.3, 2.5)', '06 §4.13', 'proposed-fit'),
  FIX('ua.dashSpan', 2.5, 'mg/dL', 'A', '06 §4.13', '06 §4.13', 'proposed-fit'),
  P('tau.uaUp', 5, 'd', 3, 8, 'B', '06 §4.13 (ketosis, up)', '06 §4.13', 'proposed-fit', { note: R_ASSUMED }),
  P('tau.uaDown', 7, 'd', 4, 10, 'C', '06 §4.13 (down after ketone drop, UNVERIFIED)', '06 §4.13', 'unverified', { note: 'dossier UNVERIFIED; ' + R_ASSUMED }),
  P('tau.uaWeight', 30, 'd', 20, 45, 'C', '06 §4.13 (weight/DASH components τ 30 d)', '06 §4.13', 'proposed-fit', { note: R_ASSUMED }),
  P('tau.uaDiet', 7, 'd', 3, 14, 'C', '06 §4.13: no τ given for alcohol/fructose terms; ketone-down τ used', '06 §4.13', 'unverified', { note: 'dossier gives none; ' + R_ASSUMED }),

  // =================================================================================================================
  // Engineering / interface constants of this module
  // =================================================================================================================
  FIX('zeroIntakeKcal', 50, 'kcal/d', 'A', '17 §2.5 zero-energy threshold; composition-driven targets hold on days below it', '17 §2.5', 'verified'),
  FIX('habit.rtMet', 4.0, 'MET', 'B', 'core/resolveProfile HABIT_RT_MET (10 §4.1, 09 §4.13): habitual resistance session 4.0 MET × 60 min', '10 §4.1', 'proposed-fit'),
  FIX('habit.cardioMet', 5.0, 'MET', 'B', 'core/resolveProfile HABIT_CARDIO_MET (10 §4.1): habitual cardio session 5.0 MET × 60 min', '10 §4.1', 'proposed-fit'),
  FIX('habit.sessionMin', 60, 'min', 'B', 'core/resolveProfile: habitual sessions are 1 h (10 §4.1)', '10 §4.1', 'proposed-fit'),
  FIX('exercise.aerobicMinFrac', 0.4, 'frac VO2max', 'B', '10 §4.10 chronic model counts minutes at ≥ 40 % VO2max', '10 §4.10', 'proposed-fit'),
  FIX('exercise.restMet', 1, 'MET', 'A', 'definition of net exercise energy (gross MET − 1)', '10 §4.1', 'verified'),
  FIX('exercise.o2KcalPerL', 5, 'kcal/L O2', 'A', 'energy equivalent of oxygen (definitional)', '10 §4.1', 'verified'),
  P('dash.q3Fraction', 1, '1', 0.5, 1, 'D', '15 §4.9 food quality 3 = varied whole foods (DASH-like); quality ≤ 2 = typical diet', '06 §4.8', 'unverified', {
    note: 'engineering mapping (no DASH input exists in the schedule): DASH_fraction = dash.q3Fraction·clamp01(foodQuality − 2)',
  }),
  FIX('paThresholdH', 8, 'h', 'B', '07 §4.2 post-absorptive state (diagnostic sampler only)', '07 §4.2', 'proposed-fit'),

  // =================================================================================================================
  // NHANES baseline generators (06 §2.3 Table B3, our computation from public microdata, ref R60) — fixed
  // =================================================================================================================
  ...baselineParams(),
  FIX('apob.intercept', 11.09, 'mg/dL', 'B', 'NHANES 2013-14 (06 §2.4, R60): ApoB = 11.09 + 0.587·nonHDL-C', '06 §2.4', 'verified'),
  FIX('apob.perNonHdl', 0.587, '1', 'B', 'NHANES 2013-14 (06 §2.4, R60), r = 0.94, resid SD 8.4 mg/dL', '06 §2.4', 'verified'),
  FIX('lipid.vldlDivisor', 5, '1', 'B', '06 §4.6 non-HDL-C = LDL + TG/5', '06 §6', 'proposed-fit'),

  // =================================================================================================================
  // Person-level heterogeneity: ten latent quantiles of the correlated baseline residuals (06 §4.17; MODEL_SPEC §8.1)
  // =================================================================================================================
  ...Z_MARKERS.map((m) =>
    P(`u.${m}`, 0.5, 'quantile', 0, 1, 'D', 'latent quantile of the 06 §4.17 correlated residual (nominal 0.5 ⇒ z = 0)', '06 §4.17', 'proposed-fit', {
      draw: 'uniform',
      note: 'MODEL_SPEC §8.1: mapped through Φ⁻¹ and the Cholesky factor of the residual correlation matrix',
    }),
  ),
];

/** Table B3 rows as fixed ParamDefs: `cardiometabolic.base.<marker>.<m|f>.<a|bAge|bBmi|sd>`. */
function baselineParams(): ParamDef[] {
  const out: ParamDef[] = [];
  for (const m of Z_MARKERS) {
    const g = GENERATORS[m];
    for (const sex of ['m', 'f'] as const) {
      const row = g[sex];
      for (const field of ['a', 'bAge', 'bBmi', 'sd'] as const) {
        out.push(
          FIX(`base.${m}.${sex}.${field}`, row[field], field === 'a' ? g.unit : field === 'sd' ? `${g.unit} (resid SD)` : `${g.unit} per ${field === 'bAge' ? 'decade' : 'BMI unit'}`, 'B', 'NHANES 2017-Mar 2020 weighted least squares (06 §2.3 Table B3; ref R60)', '06 §2.3 Table B3', 'verified'),
        );
      }
    }
  }
  return out;
}

/** Number of latent quantile parameters (must equal the width of the 06 §4.17 matrix). */
export const N_U_PARAMS = N_Z;
