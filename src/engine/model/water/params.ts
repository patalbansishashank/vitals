/**
 * Parameter registry of the water module (docs/MODEL_SPEC.md §1.10, ruling R-WATER).
 *
 * Every constant of the module is declared here as a ParamDef (§0.4). Values are copied from the dossier sections named
 * in `dossier`; where the spec ruled between dossiers, the rejected alternative is named in `note`. Ranges the dossiers do
 * not give are marked "range assumed" in `note` (they only bound uncertainty draws, never the nominal run).
 *
 * The glycogen-water ratio h (3.0 g/g [2, 4]) is deliberately NOT declared here: fuel owns it (`fuel.hWater`, MODEL_SPEC
 * §1.6 / R-GLYW) and water reads it in `prepare` (see index.ts).
 */
import type { DrawKind, EvidenceGrade, ParamDef, ParamStatus } from '../../types/params';

function def(
  id: string,
  value: number,
  unit: string,
  low: number,
  high: number,
  grade: EvidenceGrade,
  source: string,
  dossier: string,
  status: ParamStatus,
  note?: string,
  draw?: DrawKind,
): ParamDef {
  return {
    id: `water.${id}`,
    value,
    unit,
    low,
    high,
    grade,
    source,
    dossier,
    status,
    ...(note !== undefined ? { note } : {}),
    ...(draw !== undefined ? { draw } : {}),
  };
}

/** A structural / definitional constant: never varied in draws. */
function fixed(
  id: string,
  value: number,
  unit: string,
  grade: EvidenceGrade,
  source: string,
  dossier: string,
  status: ParamStatus,
  note?: string,
): ParamDef {
  return def(id, value, unit, value, value, grade, source, dossier, status, note, 'fixed');
}

const HALL2016 = 'Hall 2016 PMID 27385608';
const YANG1976 = 'Yang & Van Itallie 1976 PMID 956398';
const HEYMAN2020 = 'Heyman 2020 PMID 32457696';
const KERNDT1982 = 'Kerndt 1982 PMID 6758355';
const VISSER2009 = 'Visser 2009 PMID 19282825';
const HEER2000 = 'Heer 2000 PMID 10751219';
const STEPHEN1986 = 'Stephen 1986 PMID 2823871';
const YAMADA2022 = 'Yamada 2022 PMID 36423296';

export const WATER_PARAMS: readonly ParamDef[] = [
  // ---- E_cna: carbohydrate/insulin-sensitive natriuresis (13 §4.3, A_nat = 0 per 15 §5.1 merge)
  def('eMax', 0.6, 'L', 0.3, 1.0, 'C', `${HALL2016}; ${YANG1976}`, '13 §4.3', 'proposed-fit',
    'E_max: Hall 2016 residual ~0.4 L after glycogen; Yang KD water loss.'),
  def('cRefCna', 100, 'g/d', 50, 150, 'C', `${HALL2016}; ${KERNDT1982}`, '13 §4.3', 'proposed-fit',
    'C_ref: natriuresis absent above ~100 g carbohydrate/d (mixed diets).'),
  // Fasting target of E_cna (finisher 2026-09-30, CONTRACT_REQUESTS A2 → A1 "obese woman's early fast loses too little
  // water"): 20 §4.5.2's E_fast* = −1.3 L·(ECF0/17 L) with ECF0 = 0.2 L/kg·BW0 (01 §4.12's ECF0, the value 20's Tables
  // A1-A3 were generated with) replaces 13's −E_max·(1 + k_fast) while fastActive — one state, one implementation (R-WATER),
  // but with 20's body-size scaling (lean woman 60 kg −0.92 L, lean man 75 kg −1.15 L, obese woman 100 kg −1.45 L; 13's
  // fixed −0.9 L left the obese woman 0.5 kg short on days 1-3). The time constants stay 13's.
  def('eFastL', 1.3, 'L', 1.1, 1.5, 'C', `${KERNDT1982}; Hall 2016 PMID 27385608 (zero-carbohydrate value, via 20 §4.5.2)`, '20 §4.5.2', 'proposed-fit',
    'Range = 20 §4A UI band for fasting ΔBW (±15 %, PROPOSED from inter-individual SDs). alt: 13 §4.3 −E_max·(1 + k_fast), k_fast 0.5 [0, 1] (fixed −0.9 L at every body size; replaced).'),
  fixed('ecfRefL', 17, 'L', 'C', '20 §4.5.2 E_fast* normalisation', '20 §4.5.2', 'proposed-fit'),
  fixed('ecfPerKgBw', 0.2, 'L/kg', 'C', '01 §4.12 ECF0 = 0.2·BW (BWP placeholder; used by 20 §4A)', '01 §4.1.3, §4.12; 20 §4A', 'proposed-fit',
    'Silva 2007 regression (01 §4.1.3) not available in the dossiers; 14\'s FFM-based ECW (0.38·0.73·FFM) gives obese adults less ECF than lean ones and contradicts 20\'s tables.'),
  def('tauDown', 1.5, 'd', 1, 3, 'C', `${HEYMAN2020}; ${KERNDT1982}`, '13 §4.3', 'proposed-fit',
    'Natriuresis onset (E* < E).'),
  def('tauUp', 0.7, 'd', 0.3, 1.5, 'C', HEYMAN2020, '13 §4.3', 'proposed-fit',
    'Antinatriuresis on carbohydrate re-entry (+0.5 L/d).'),

  // ---- S_na: dietary-sodium water with partial habituation (13 §4.4 + 15 §4.7/§5.1)
  def('tauNa', 1.5, 'd', 0.5, 2, 'C', `${VISSER2009}; ${HEER2000}`, '15 §4.7; 13 §4.4', 'proposed-fit',
    '15 value; 13 §4.4 tau_Na = 1.0 d rejected (R-WATER). With hNa 0.5 gives 0.0054 kg per mmol/d.'),
  def('tauHab', 5, 'd', 3, 10, 'C', 'Proposed (Heer 2000 PMID 10751219 consistency)', '13 §4.4', 'proposed-fit',
    'Set-point adaptation time constant.'),
  def('hNa', 0.5, '1', 0, 1, 'C', `${VISSER2009}; ${HEER2000}`, '15 §4.7, §5.1; MODEL_SPEC §1.10', 'proposed-fit',
    '0 = Heer full habituation (no steady-state water), 1 = Visser none. Na_hab -> Na0 + (1 - hNa)(Na_in - Na0).'),
  def('sweatNaMmolL', 35, 'mmol/L', 10, 70, 'B', 'Baker 2017 PMID 28332116', '15 §4.7', 'verified',
    'Whole-body sweat sodium, typical ~35 (0.8 g/L); enters as L_sweat.'),
  fixed('naPerLEcf', 140, 'mmol/L', 'B', 'Heyman 2020 PMID 32457696 (isosmotic rule)', '13 §4.1', 'verified',
    '140 mmol Na retained = 1 L extracellular water = 1 kg. Titze 2002 (1.3-1.7 g per mmol) not used.'),

  // ---- M_gut: gut-content mass (13 §4.5)
  def('gutS0Male', 162, 'g/d', 151, 173, 'B', STEPHEN1986, '13 §4.5', 'verified', 'Stool on low-fibre diet, SE +/-11.'),
  def('gutS0Female', 83, 'g/d', 72, 94, 'B', STEPHEN1986, '13 §4.5', 'verified', 'Stool on low-fibre diet, SE +/-11.'),
  def('gutSlope', 5, 'g stool/g NSP', 3.5, 5.5, 'B', STEPHEN1986, '13 §4.5', 'verified',
    'Range 3.5-5.5 from 15 V20 (Cummings 5.3, Karl 4.0 per AOAC g).'),
  def('gutTtrMale', 2.0, 'd', 1.5, 3.5, 'C', STEPHEN1986, '13 §4.5', 'proposed-fit', 'Whole-gut transit time, men.'),
  def('gutTtrFemale', 3.0, 'd', 1.5, 3.5, 'C', STEPHEN1986, '13 §4.5', 'proposed-fit', 'Whole-gut transit time, women.'),
  def('gutTauEmpty', 1.5, 'd', 1.0, 1.5, 'C', 'Proposed (13 T21: tau ≈ transit/2 ≈ 1-1.5 d)', '13 §4.5, T21', 'proposed-fit',
    'Colon emptying when fastActive (target 0). Range 1-1.5 d is 13 T21 itself; 20 §4B.2 uses 1 d (same range edge, documented here, not a rejected convention: M20).'),

  // ---- P_ex: plasma-volume expansion after hard sessions (13 §4.6)
  def('pvMlPerKg', 4.5, 'mL/kg', 3.8, 5.2, 'B', 'Gillen 1991 PMID 1761491', '13 §4.6', 'verified',
    '+4.5 +/- 0.7 mL/kg per hard interval session (+10 % PV at 24 h).'),
  def('pvTau', 2, 'd', 1, 3, 'C', 'Proposed (13 §4.6; Convertino 2007)', '13 §4.6', 'proposed-fit',
    'PROPOSED decay; range assumed (no dossier range).'),
  def('pvCapL', 0.5, 'L', 0.3, 0.8, 'D', '13 §2 state-table range 0-0.5 L', '13 §2, §4.6', 'unverified',
    'Saturation of P_ex when sessions repeat daily (chronic training PV expansion ~0.4-0.5 L); range assumed.'),

  // ---- menstrual water (13 §4.6; 16 §4.5), opt-in through cycle tracking (cycleDay >= 1)
  def('cycleAmpKg', 0.2, 'kg', 0, 0.5, 'D', 'White 2011 PMID 21845193', '13 §4.6; 16 §4.5', 'unverified',
    'Peak-to-trough amplitude of the deterministic cycle term, peak day 1 of flow. 16 §4.5 treats the effect as a display band only (sign inconsistent across studies); set 0 to disable.'),
  def('cycleTroughPos', 0.25, '1', 0.2, 0.35, 'D', 'White 2011 PMID 21845193 (via 16 §4.5)', '16 §4.5', 'proposed-fit',
    'Position in the cycle (fraction of its length) of the lowest self-reported fluid retention (mid-follicular).'),
  def('cycleOvEndPos', 0.6, '1', 0.5, 0.7, 'D', 'White 2011 PMID 21845193 (via 16 §4.5)', '16 §4.5', 'proposed-fit',
    'End of the 11-day rise around ovulation, fraction of the cycle.'),
  def('cycleOvLevel', 0.41, '1', 0.3, 0.6, 'D', 'White 2011 PMID 21845193 (via 16 §4.5)', '16 §4.5', 'proposed-fit',
    'Normalised retention at the end of the ovulation rise: (0.50 - 0.22)/(0.90 - 0.22) of the reported scores.'),

  // ---- creatine water (15 §4.12)
  def('creatineWaterKg', 0.9, 'kg', 0.5, 1.5, 'C', 'Powers 2003 PMID 12937471', '15 §4.12', 'proposed-fit',
    'W_Cr = 0.9 kg x creatineSatFrac (x / x_max).'),

  // ---- hydration deficit H_def (15 §4.8), grade D
  def('hDefTau', 0.5, 'd', 0.25, 1, 'D', 'Proposed (15 §4.8)', '15 §4.8', 'unverified', 'Thirst-driven recovery; range assumed.'),
  def('hDefFKidney', 0.6, '1', 0.3, 1, 'D', 'Proposed (15 §4.8)', '15 §4.8', 'unverified',
    'Share of the fluid shortfall that shows as mass (kidneys conserve water first); range assumed.'),
  def('hDefCapKg', 2.5, 'kg', 2, 3, 'D', 'Proposed (15 §4.8)', '15 §4.8', 'unverified', '~3 % of 80 kg; range assumed.'),
  fixed('hDefRefill', 0, '1', 'D', 'Definition (15 §4.8 refill_fraction)', '15 §4.8', 'unverified',
    'Share of sweat replaced inside the session; fluidL is total beverages so 0 (all sweat must be covered by fluidL).'),
  def('needBeverageFrac', 0.81, '1', 0.7, 0.9, 'D', 'IOM 2005 (via 15 §4.8 [73])', '15 §4.8', 'proposed-fit',
    'Share of total water turnover drunk as beverages; range assumed.'),
  fixed('needOffsetL', 0.3, 'L', 'D', 'Proposed (15 §4.8)', '15 §4.8', 'proposed-fit', 'Metabolic water offset in need_fluid_L.'),
  fixed('needMinL', 1.2, 'L', 'D', 'Proposed (15 §4.8)', '15 §4.8', 'proposed-fit', 'Floor of need_fluid_L.'),
  // Total water turnover regression WT (mL/d), Yamada 2022 (15 §4.8): coefficients are equation constants, not draws.
  fixed('wtPal', 1076, 'mL/d per PAL', 'A', YAMADA2022, '15 §4.8', 'verified'),
  fixed('wtBw', 14.34, 'mL/d per kg', 'A', YAMADA2022, '15 §4.8', 'verified'),
  fixed('wtSex', 374.9, 'mL/d (male = 1)', 'A', YAMADA2022, '15 §4.8', 'verified'),
  fixed('wtHumidity', 5.823, 'mL/d per %', 'A', YAMADA2022, '15 §4.8', 'verified'),
  fixed('wtAthlete', 1070, 'mL/d (athlete = 1)', 'A', YAMADA2022, '15 §4.8', 'verified'),
  fixed('wtHdi', 104.6, 'mL/d per HDI class', 'A', YAMADA2022, '15 §4.8', 'verified'),
  fixed('wtAltitude', 0.4726, 'mL/d per m', 'A', YAMADA2022, '15 §4.8', 'verified'),
  fixed('wtAge2', -0.3529, 'mL/d per y^2', 'A', YAMADA2022, '15 §4.8', 'verified'),
  fixed('wtAge', 24.78, 'mL/d per y', 'A', YAMADA2022, '15 §4.8', 'verified'),
  fixed('wtTemp2', 1.865, 'mL/d per degC^2', 'A', YAMADA2022, '15 §4.8', 'verified'),
  fixed('wtTemp', -19.66, 'mL/d per degC', 'A', YAMADA2022, '15 §4.8', 'verified'),
  fixed('wtIntercept', -713.1, 'mL/d', 'A', YAMADA2022, '15 §4.8', 'verified'),
  // Environment terms the schedule does not carry: example conditions of 15 §4.8 (sedentary man, 10 degC, sea level).
  def('envTempC', 10, 'degC', -5, 30, 'D', '15 §4.8 worked example conditions', '15 §4.8', 'unverified',
    'Ambient temperature for WT (no schedule input; hotClimate is not used). Only matters when fluidL is entered.'),
  def('envHumidityPct', 40, '%', 20, 80, 'D', '15 §4.8 worked example conditions (back-solved to 3.2 L/d)', '15 §4.8', 'unverified',
    'Relative humidity for WT (no schedule input).'),
  fixed('envAltitudeM', 0, 'm', 'D', '15 §4.8 worked example conditions', '15 §4.8', 'unverified', 'Sea level.'),
  fixed('envHdi', 0, 'class', 'D', '15 §4.8 worked example conditions', '15 §4.8', 'unverified', 'High human-development class.'),
  fixed('envAthlete', 0, '1', 'D', '15 §4.8 worked example conditions', '15 §4.8', 'unverified', 'Athlete flag off.'),

  // ---- events (MODEL_SPEC §7.1; 13 T4, §4.7): definitions, not draws
  fixed('reboundKg', 0.5, 'kg', 'B', 'Peos 2021 PMID 33630880 (13 T4)', '13 T4, §7.1', 'proposed-fit',
    'waterRebound: 3-day-window rise of the daily-mean scale weight while fat mass falls.'),
  fixed('reboundDays', 3, 'd', 'B', 'MODEL_SPEC §7.1', '13 T4', 'proposed-fit', 'Window of waterRebound.'),
  fixed('plateauKg', 0.1, 'kg', 'C', 'MODEL_SPEC §7.1', '13 §4.7', 'proposed-fit', 'weightPlateau: change of the 7-d mean over 14 d below this.'),
  fixed('plateauDays', 14, 'd', 'C', 'MODEL_SPEC §7.1', '13 §4.7', 'proposed-fit', 'weightPlateau comparison lag.'),
  fixed('plateauEb7KcalD', -200, 'kcal/d', 'C', 'MODEL_SPEC §7.1', '13 §4.7', 'proposed-fit',
    'weightPlateau requires EB7 (energyBalance7KcalD, composition) below this.'),
];
