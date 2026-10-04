/**
 * Parameter registry of the `fuel` module (docs/MODEL_SPEC.md §1.6; dossier 04 owner).
 *
 * Every number is copied from MODEL_SPEC §1.6 or the cited dossier section (04 unless stated). Grades use the dossier's
 * letter (A− → A, B− → B, B/C → B). `status` follows the dossier's label for that number (PROPOSED FIT / PROPOSED /
 * DERIVED → proposed-fit, UNVERIFIED → unverified, sourced table value → verified). Parameters without a dossier range
 * are fixed (low = high). Unit conversions (0.162 g glycogen per mmol glucosyl unit) are module constants, not ParamDefs.
 */
import type { ParamDef } from '../../types/params';

const S = {
  rothman: 'Rothman 1991 PMID 1948033',
  magnusson: 'Magnusson 1992 PMID 1401068',
  taylor: 'Taylor 1996 PMID 8550823',
  hellerstein: 'Hellerstein 1997 PMID 9276749',
  iwayama: 'Iwayama 2021 PMID 34802419',
  gonzalez15: 'Gonzalez 2015 PMID 26487008',
  gonzalez16: 'Gonzalez 2016 PMID 27436612',
  fuchs16: 'Fuchs 2016 PMID 27013608',
  fuchs19: 'Fuchs 2019 PMID 31166604',
  murray: 'Murray & Rosenbloom 2018 PMID 29444266',
  areta: 'Areta & Hopkins 2018 PMID 29923148',
  bergstrom: 'Bergström 1967 PMID 5584523',
  bussau: 'Bussau 2002 PMID 12111292',
  sherman: 'Sherman 1981 PMID 7333741',
  shiose: 'Shiose 2016 PMID 27231310',
  olsson: 'Olsson & Saltin 1970 PMID 5475323',
  fernandez: 'Fernández-Elías 2015 PMID 25911631',
  phinney: 'Phinney 1983 PMID 6865776',
  volek: 'Volek 2016 PMID 26892521',
  macdougall: 'MacDougall 1999 PMID 10364416',
  koopman: 'Koopman 2006 PMID 16369816',
  tesch: 'Tesch 1986 PMID 3758035',
  tarry: 'Tarry 2025 PMID 40922559',
  jentjens: 'Jentjens & Jeukendrup 2003 PMID 12617691',
  ivy: 'Ivy 1988 PMID 3132449',
  carey: 'Carey 2003 PMID 12453829',
  mikines: 'Mikines 1988 PMID 3126668',
  sun: 'Sun & Empie 2012 PMID 23031075',
  schwarz: 'Schwarz 1995 PMID 8675642',
  acheson82: 'Acheson 1982 PMID 6755166',
  acheson88: 'Acheson 1988 PMID 3165600',
  campbell: 'Campbell 1992 PMID 1476178',
  owen: 'Owen 1967 PMID 6061736',
  kolnes: 'Kolnes 2025 PMID 39747857',
  hall2010: 'Hall 2010 PMID 19934407',
  livesey: 'Livesey & Elia 1988 PMID 3281434',
} as const;

export const FUEL_PARAMS: readonly ParamDef[] = [
  // ---------------------------------------------------------------- capacities, water (04 §4.1)
  { id: 'fuel.cLMax', value: 500, unit: 'mmol/L liver', low: 400, high: 550, grade: 'A', source: `${S.gonzalez15}; ${S.murray}`, dossier: '04 §4.1', status: 'verified', label: 'Liver glycogen capacity (concentration)', note: 'final round 2026-09-30: 420 (Rothman 07-1 g4/g15) was tested and NOT applied — it moves 05 V3 Deru\'s exercise-arm time to 0.5 mM from 20 to 21 h (17.5 ± 3), a ketone target' },
  { id: 'fuel.vLiv', value: 1.45, unit: 'L', low: 1.2, high: 1.8, grade: 'A', source: `${S.magnusson}; ${S.taylor}; ${S.fuchs16}`, dossier: '04 §4.1', status: 'verified', label: 'Liver volume', note: 'FFM scaling of V_liv is UNVERIFIED in 04 §2 and not applied' },
  { id: 'fuel.cMMax', value: 180, unit: 'mmol/kg ww', low: 180, high: 290, grade: 'A', source: `${S.bergstrom}; ${S.bussau}; ${S.sherman}; ${S.shiose}`, dossier: '04 §4.1, §4.7', status: 'proposed-fit', label: 'Muscle glycogen capacity c_M,max = c_M,cap', note: 'final round 2026-09-30: 200 → 180 (registry low) — fits Bussau\'s 72-h supercompensation ratio (04 V4 b72) without moving any other 04/05/07/20/O-3 row; 04\'s value was 200' },
  { id: 'fuel.hWater', value: 3.0, unit: 'g/g', low: 2, high: 4, grade: 'B', source: `${S.olsson}; ${S.fernandez}; ${S.shiose}`, dossier: '04 §4.1', status: 'verified', label: 'Water stored per g glycogen', note: 'R-GLYW: read by water via liverGlycogenG/muscleGlycogenG; 01/11 2.7 used only inside the BWP oracle' },

  // ---------------------------------------------------------------- liver during fasting and exercise (04 §4.2-4.3)
  { id: 'fuel.tauL', value: 20, unit: 'h', low: 18, high: 36, grade: 'A', source: `${S.magnusson}; ${S.taylor}; ${S.iwayama}; ${S.rothman}`, dossier: '04 §4.2', status: 'proposed-fit', label: 'Liver glycogenolysis time constant', note: 'Integrator A2 (coupled calibration, 2026-09-30): 20 h (dossier value 24; 18 would fit best but breaks the 2 % O-10 band of the hourly liver form). 04 §4.2\'s own check gives −35 %/10.5 h (Taylor −41 %) and −54 %/18.5 h (Magnusson −65 %) at 24 h vs −41 %/−61 % at 20 h (fuel.validation: Taylor 216, Magnusson 125 vs 207/98 mmol/L); Rothman 0-22 h 2.9 vs 3.0 g/h. In the coupled engine the fed-state suppression (σ_fed ≈ 1 for ~15 h/d) leaves the liver high, and 20 h brings the fasting liver toward 07 §4.4.1 (40 g at 24 h) and the 24-72 h BHB onto 05 V1-V3/20 BHB_ref' },
  { id: 'fuel.gLFloor', value: 5, unit: 'g', low: 0, high: 15, grade: 'C', source: S.hellerstein, dossier: '04 §4.2', status: 'unverified', label: 'Liver glycogen floor' },
  { id: 'fuel.rHalf', value: 10, unit: 'g/h', low: 10, high: 10, grade: 'C', source: S.taylor, dossier: '04 §4.2', status: 'unverified', label: 'Glucose appearance for full suppression of glycogenolysis (σ_fed = min(1, A/R_half))' },
  { id: 'fuel.liverExSlope', value: 30, unit: 'g/h per unit VO2max fraction', low: 15, high: 45, grade: 'C', source: `${S.iwayama}; ${S.gonzalez15}`, dossier: '04 §4.3', status: 'proposed-fit', label: 'Exercise liver glycogenolysis slope', note: '±50 % per 04 §4.3' },
  { id: 'fuel.liverExThreshold', value: 0.2, unit: 'frac VO2max', low: 0.15, high: 0.3, grade: 'C', source: S.gonzalez15, dossier: '04 §4.3', status: 'unverified', label: 'Exercise liver glycogenolysis threshold' },
  { id: 'fuel.liverExSpareCho', value: 1.2, unit: 'g/min', low: 1.2, high: 1.5, grade: 'C', source: `${S.gonzalez15}; ${S.gonzalez16}`, dossier: '04 §4.3', status: 'proposed-fit', label: 'CHO intake during exercise giving full liver sparing' },
  { id: 'fuel.gLRef', value: 80, unit: 'g', low: 80, high: 80, grade: 'C', source: S.murray, dossier: '04 §4.3', status: 'proposed-fit', label: 'Reference liver glycogen in the exercise term (G_L/G_L,ref)^0.5' },

  // ---------------------------------------------------------------- muscle use in exercise (04 §4.4-4.5)
  { id: 'fuel.uEx75', value: 0.9, unit: 'mmol/kg ww/min', low: 0.63, high: 1.17, grade: 'B', source: `${S.bergstrom}; ${S.sherman}`, dossier: '04 §4.4', status: 'proposed-fit', label: 'Muscle glycogen use at 75 % VO2max', note: '±30 % per 04 §4.4' },
  { id: 'fuel.uExOnset', value: 0.25, unit: 'frac VO2max', low: 0.25, high: 0.25, grade: 'B', source: `${S.bergstrom}; ${S.sherman}`, dossier: '04 §4.4', status: 'proposed-fit', label: 'Intensity below which muscle glycogen use is 0 (u_ex = 0.9·((I − 0.25)/0.50)^1.5)' },
  { id: 'fuel.uExSpan', value: 0.5, unit: 'frac VO2max', low: 0.5, high: 0.5, grade: 'B', source: `${S.bergstrom}; ${S.sherman}`, dossier: '04 §4.4', status: 'proposed-fit', label: 'Intensity span from onset to the 75 % anchor' },
  { id: 'fuel.uExExp', value: 1.5, unit: '1', low: 1.2, high: 2, grade: 'B', source: `${S.bergstrom}; ${S.sherman}`, dossier: '04 §4.4', status: 'proposed-fit', label: 'Intensity exponent of muscle glycogen use' },
  { id: 'fuel.uExAvailExp', value: 0.5, unit: '1', low: 0.3, high: 1.9, grade: 'B', source: `${S.bergstrom}; ${S.sherman}`, dossier: '04 §4.4', status: 'proposed-fit', label: 'Glycogen-availability exponent (c/110)^a' },
  { id: 'fuel.cMAvailRef', value: 110, unit: 'mmol/kg ww', low: 110, high: 110, grade: 'B', source: `${S.bergstrom}; ${S.areta}`, dossier: '04 §4.4-4.5', status: 'proposed-fit', label: 'Reference concentration in the availability terms (c/110)' },
  { id: 'fuel.ketoExReduction', value: 0.75, unit: '1', low: 0.6, high: 0.8, grade: 'C', source: S.phinney, dossier: '04 §4.4', status: 'proposed-fit', label: 'Keto-adaptation reduction of exercise glycogen use (1 − 0.75·A_keto)' },
  { id: 'fuel.exFloorFrac', value: 0.1, unit: 'frac of initial', low: 0.1, high: 0.1, grade: 'B', source: S.murray, dossier: '04 §4.4', status: 'verified', label: 'Muscle glycogen floor in exercise (fraction of the initial value)' },
  { id: 'fuel.dMax', value: 0.4, unit: 'frac', low: 0.25, high: 0.5, grade: 'B', source: `${S.murray}; ${S.macdougall}; ${S.koopman}`, dossier: '04 §4.5', status: 'proposed-fit', label: 'Maximal RT session depletion D_max' },
  { id: 'fuel.s0', value: 3, unit: 'sets', low: 2, high: 5, grade: 'B', source: `${S.macdougall}; ${S.koopman}; ${S.tesch}`, dossier: '04 §4.5', status: 'proposed-fit', label: 'RT sets scale s0 in D_RT = D_max·(1 − e^{−sets/s0})' },
  { id: 'fuel.rtAvailExp', value: 0.3, unit: '1', low: 0.3, high: 0.3, grade: 'B', source: `${S.macdougall}; ${S.koopman}`, dossier: '04 §4.5', status: 'proposed-fit', label: 'Availability exponent of RT depletion (c/110)^0.3' },

  // ---------------------------------------------------------------- muscle at rest (04 §4.6; 20 §4.3.1)
  { id: 'fuel.kMr', value: 0.0035, unit: '1/h', low: 0.002, high: 0.005, grade: 'C', source: `${S.tarry}; ${S.iwayama}`, dossier: '04 §4.6', status: 'proposed-fit', label: 'Resting post-absorptive muscle glycogenolysis k_Mr' },
  { id: 'fuel.cMFloor', value: 25, unit: 'mmol/kg ww', low: 15, high: 40, grade: 'C', source: S.murray, dossier: '04 §4.6', status: 'unverified', label: 'Resting muscle glycogen floor' },
  { id: 'fuel.ketoRestReduction', value: 0.5, unit: '1', low: 0.5, high: 0.5, grade: 'C', source: S.volek, dossier: '04 §4.6', status: 'proposed-fit', label: 'Keto-adaptation reduction of resting muscle glycogenolysis (1 − 0.5·A_keto)' },
  { id: 'fuel.fastMuscleAsymptote', value: 0.35, unit: 'frac of G_M at fast start', low: 0.35, high: 0.35, grade: 'C', source: S.kolnes, dossier: '20 §4.3.1', status: 'proposed-fit', label: 'Fasting muscle glycogen asymptote (−k_Mf·(G_M − 0.35·G_M0))', note: 'k_Mf itself is fasting.kMf (MODEL_SPEC §1.4), read in prepare' },

  // ---------------------------------------------------------------- muscle repletion (04 §4.7)
  { id: 'fuel.sMax', value: 7.5, unit: 'mmol/kg ww/h', low: 5, high: 10, grade: 'A', source: `${S.bussau}; ${S.carey}`, dossier: '04 §4.7', status: 'proposed-fit', label: 'Maximal muscle glycogen synthesis S_max' },
  { id: 'fuel.kR', value: 0.3, unit: 'g/kg/h', low: 0.2, high: 0.5, grade: 'A', source: S.jentjens, dossier: '04 §4.7', status: 'proposed-fit', label: 'CHO supply half-saturation K_R' },
  { id: 'fuel.synCapExp', value: 4, unit: '1', low: 4, high: 4, grade: 'B', source: `${S.bussau}; ${S.sherman}`, dossier: '04 §4.7, §4.9', status: 'proposed-fit', label: 'Saturation exponent (1 − (c/c_cap)^4)' },
  { id: 'fuel.eRapid', value: 1.0, unit: '1', low: 0.5, high: 1.5, grade: 'A', source: `${S.ivy}; ${S.jentjens}`, dossier: '04 §4.7', status: 'proposed-fit', label: 'Rapid post-exercise synthesis enhancement E_rapid' },
  { id: 'fuel.tauE1', value: 1.5, unit: 'h', low: 1, high: 3, grade: 'A', source: S.ivy, dossier: '04 §4.7', status: 'proposed-fit', label: 'Rapid enhancement time constant τ_E1' },
  { id: 'fuel.eSlow', value: 0.3, unit: '1', low: 0.1, high: 0.5, grade: 'B', source: S.mikines, dossier: '04 §4.7', status: 'proposed-fit', label: 'Slow post-exercise enhancement E_slow' },
  { id: 'fuel.tauE2', value: 36, unit: 'h', low: 24, high: 48, grade: 'B', source: S.mikines, dossier: '04 §4.7', status: 'proposed-fit', label: 'Slow enhancement time constant τ_E2' },
  { id: 'fuel.protCredit', value: 0.5, unit: 'g CHO-eq/g protein', low: 0.5, high: 0.5, grade: 'C', source: `${S.murray}; ${S.jentjens}`, dossier: '04 §4.7', status: 'unverified', label: 'Protein credit in R_eff when CHO < 1.0 g/kg/h' },
  { id: 'fuel.protCreditCap', value: 0.4, unit: 'g/kg/h', low: 0.4, high: 0.4, grade: 'C', source: `${S.murray}; ${S.jentjens}`, dossier: '04 §4.7', status: 'unverified', label: 'Protein rate counted in R_eff (min(R_prot, 0.4))' },
  { id: 'fuel.protCreditChoMax', value: 1.0, unit: 'g/kg/h', low: 1.0, high: 1.0, grade: 'C', source: `${S.murray}; ${S.jentjens}`, dossier: '04 §4.7', status: 'unverified', label: 'CHO rate above which protein adds nothing' },

  // ---------------------------------------------------------------- liver repletion, fructose (04 §4.8, §4.20)
  { id: 'fuel.alphaGlc', value: 0.2, unit: '1', low: 0.15, high: 0.25, grade: 'B', source: S.taylor, dossier: '04 §4.8', status: 'proposed-fit', label: 'Liver share of glucose supply at rest α_glc' },
  { id: 'fuel.alphaGlcPostEx', value: 0.1, unit: '1', low: 0.05, high: 0.15, grade: 'B', source: `${S.fuchs16}; ${S.fuchs19}`, dossier: '04 §4.8', status: 'proposed-fit', label: 'Liver share after exercise (any E_ex > 0.3)' },
  { id: 'fuel.alphaGlcExThreshold', value: 0.3, unit: '1', low: 0.3, high: 0.3, grade: 'B', source: `${S.fuchs16}; ${S.fuchs19}`, dossier: '04 §4.8', status: 'proposed-fit', label: 'E_ex above which the post-exercise α_glc applies' },
  { id: 'fuel.alphaFru', value: 0.15, unit: '1', low: 0.07, high: 0.3, grade: 'B', source: `${S.fuchs19}; ${S.sun}`, dossier: '04 §4.8', status: 'proposed-fit', label: 'Fructose/galactose share to liver glycogen α_fru', note: 'the glucose share (0.40 at nominal) is 1 − α_fru − fruOx so the split always sums to 1' },
  { id: 'fuel.fruOx', value: 0.45, unit: '1', low: 0.45, high: 0.45, grade: 'B', source: `${S.sun}; ${S.fuchs19}`, dossier: '04 §4.8, §4.20', status: 'verified', label: 'Fructose/galactose share oxidised in the liver' },
  { id: 'fuel.vLSyn', value: 8, unit: 'g/h', low: 6, high: 10, grade: 'B', source: S.fuchs19, dossier: '04 §4.8', status: 'verified', label: 'Maximal liver glycogen synthesis V_L,syn' },

  // ---------------------------------------------------------------- oxidation demand (04 §4.10, §4.14, §4.22)
  { id: 'fuel.fCpaRef', value: 0.45, unit: '1', low: 0.35, high: 0.55, grade: 'B', source: `${S.magnusson}; ${S.schwarz}`, dossier: '04 §4.10', status: 'verified', label: 'Post-absorptive CHO share at reference glycogen f_C,pa' },
  { id: 'fuel.fCpaMin', value: 0.05, unit: '1', low: 0.05, high: 0.05, grade: 'B', source: S.acheson82, dossier: '04 §4.10', status: 'proposed-fit', label: 'Lower clamp of f_C,pa' },
  { id: 'fuel.fCpaMax', value: 0.85, unit: '1', low: 0.85, high: 0.85, grade: 'B', source: S.acheson82, dossier: '04 §4.10', status: 'proposed-fit', label: 'Upper clamp of f_C,pa' },
  { id: 'fuel.ketoOxReduction', value: 0.75, unit: '1', low: 0.6, high: 0.9, grade: 'C', source: `${S.phinney}; ${S.volek}`, dossier: '04 §4.10-4.11', status: 'proposed-fit', label: 'Keto-adaptation reduction of the post-absorptive CHO share' },
  { id: 'fuel.fCMax', value: 0.95, unit: '1', low: 0.9, high: 1.0, grade: 'B', source: S.acheson82, dossier: '04 §4.10', status: 'verified', label: 'Maximal CHO share under insulin f_C,max' },
  { id: 'fuel.ec50Ox', value: 54, unit: 'µU/mL', low: 44, high: 64, grade: 'A', source: S.campbell, dossier: '04 §4.10, §4.14', status: 'verified', label: 'Insulin EC50 for suppression of FFA oxidation', note: '324 ± 60 pM (6 pM per µU/mL)' },
  { id: 'fuel.choOxKcalPerG', value: 4.1, unit: 'kcal/g', low: 4.1, high: 4.1, grade: 'B', source: S.acheson82, dossier: '04 §4.10', status: 'unverified', label: 'Energy per g carbohydrate oxidised (spec CHOox = f_C·EE_np/4.1)' },
  { id: 'fuel.fatOxKcalPerG', value: 9.44, unit: 'kcal/g', low: 9.44, high: 9.44, grade: 'B', source: S.hall2010, dossier: '01 §4.1.1; MODEL_SPEC §1.6 step 8', status: 'verified', label: 'Energy per g fat oxidised (ρ_F of Hall 2010)' },
  { id: 'fuel.brainGlcGD', value: 120, unit: 'g/d', low: 110, high: 145, grade: 'B', source: S.owen, dossier: '04 §4.22', status: 'proposed-fit', label: 'Brain glucose need without ketones (Glucose_need = 120·(1 − 1.2·K) + 10)' },
  { id: 'fuel.brainKetoneSlope', value: 1.2, unit: '1', low: 1.2, high: 1.2, grade: 'B', source: S.owen, dossier: '04 §4.22', status: 'proposed-fit', label: 'Brain glucose sparing per unit ketone share' },
  { id: 'fuel.otherGlcGD', value: 10, unit: 'g/d', low: 10, high: 10, grade: 'B', source: S.owen, dossier: '04 §4.22', status: 'proposed-fit', label: 'Other obligatory glucose use' },

  // ---------------------------------------------------------------- DNL, GNG (04 §4.10, §4.13, §4.22; R-DNL)
  { id: 'fuel.dnlYield', value: 0.3125, unit: 'g fat/g glucose', low: 0.28, high: 0.36, grade: 'B', source: S.acheson88, dossier: '04 §4.13; R-DNL', status: 'proposed-fit', label: 'Net DNL yield (3.2 g glucose per g fat)' },
  { id: 'fuel.dnlGateFrac', value: 0.95, unit: 'frac of G_cap', low: 0.95, high: 0.95, grade: 'B', source: `${S.acheson88}; ${S.acheson82}`, dossier: '04 §4.10', status: 'proposed-fit', label: 'Glycogen fill above which surplus glucose goes to DNL' },
  { id: 'fuel.gngProtYield', value: 0.57, unit: 'g glucose/g protein', low: 0.57, high: 0.57, grade: 'B', source: S.owen, dossier: '04 §4.22', status: 'verified', label: 'Glucose from protein via gluconeogenesis' },
  { id: 'fuel.fProt', value: 0.385, unit: 'kg protein/kg lean tissue', low: 0.385, high: 0.385, grade: 'B', source: 'Hall 2010 PMID 19934407', dossier: 'MODEL_SPEC §0.2 R-FPROT; 20 §4.6.2 (h_P 1.6)', status: 'verified', label: 'Protein content of lean tissue f_prot = 1/(1 + h_P)', note: 'definitional (Hall convention); must equal composition\'s f_prot' },
  { id: 'fuel.gngGlycerolFrac', value: 0.1, unit: 'g glucose/g fat oxidised', low: 0.1, high: 0.1, grade: 'B', source: S.owen, dossier: '04 §4.11, §4.22', status: 'verified', label: 'Glycerol-derived glucose per g fat oxidised' },

  // ---------------------------------------------------------------- initial muscle glycogen (04 §2, Areta meta-regression)
  { id: 'fuel.cM0Dw', value: 462, unit: 'mmol/kg dw', low: 293, high: 631, grade: 'A', source: S.areta, dossier: '04 §2, §4.1', status: 'verified', label: 'Resting vastus glycogen on a normal diet at VO2max 53', note: 'low/high = ±1.28 SD (SD 132)' },
  { id: 'fuel.cM0Vo2Slope', value: 6.7, unit: 'mmol/kg dw per mL/kg/min', low: 6.7, high: 6.7, grade: 'A', source: S.areta, dossier: '04 §2', status: 'verified', label: 'Initial glycogen per unit VO2max' },
  { id: 'fuel.cM0Vo2Ref', value: 53, unit: 'mL/kg/min', low: 53, high: 53, grade: 'A', source: S.areta, dossier: '04 §2', status: 'verified', label: 'Reference VO2max of the Areta regression' },
  { id: 'fuel.cM0HighCho', value: 102, unit: 'mmol/kg dw', low: 55, high: 149, grade: 'A', source: S.areta, dossier: '04 §2', status: 'verified', label: 'Initial glycogen increment for habitual CHO ≥ 6 g/kg/d', note: 'low/high = ±47 (95 % CI)' },
  { id: 'fuel.cM0HighChoGPerKg', value: 6, unit: 'g/kg/d', low: 6, high: 6, grade: 'A', source: S.areta, dossier: '04 §2', status: 'verified', label: 'Habitual CHO threshold for the high-CHO increment' },
  { id: 'fuel.dwPerWw', value: 4.3, unit: 'kg ww/kg dw', low: 4.3, high: 4.3, grade: 'A', source: S.murray, dossier: '04 header, §2', status: 'verified', label: 'Dry-to-wet weight conversion (dw ≈ 4.3 × ww)' },

  // ---------------------------------------------------------------- events (MODEL_SPEC §7.1)
  { id: 'fuel.liverLowG', value: 20, unit: 'g', low: 20, high: 20, grade: 'A', source: S.rothman, dossier: '04 §4.2, §6', status: 'verified', label: 'liverGlycogenLow event threshold' },
  { id: 'fuel.switchG', value: 30, unit: 'g', low: 30, high: 30, grade: 'C', source: S.rothman, dossier: '07 §4.3; MODEL_SPEC §7.1', status: 'proposed-fit', label: 'Liver glycogen at which the metabolic switch Sw = 1/(1 + (G_L/30)^4) crosses 0.5' },
  { id: 'fuel.glycogenLowFrac', value: 0.3, unit: 'frac of G_cap', low: 0.3, high: 0.3, grade: 'B', source: S.acheson88, dossier: 'MODEL_SPEC §7.1', status: 'proposed-fit', label: 'glycogenLow event threshold' },
  { id: 'fuel.glycogenLowHabFrac', value: 0.75, unit: 'frac of habitual daily low', low: 0.75, high: 0.75, grade: 'D', source: 'MODEL_SPEC §7.1 event convention (integrator A2, 2026-09-30): below 30 % of capacity alone fired at steady state for older / low-VO2max users', dossier: 'MODEL_SPEC §7.1', status: 'proposed-fit', label: 'glycogenLow also needs total glycogen below this fraction of the habitual daily low', draw: 'fixed' },
  { id: 'fuel.superCompFrac', value: 1.3, unit: 'rel', low: 1.3, high: 1.3, grade: 'B', source: `${S.sherman}; ${S.bussau}`, dossier: '04 §4.9; MODEL_SPEC §7.1', status: 'proposed-fit', label: 'supercompensation event threshold (× habitual daily muscle-glycogen high, at least the fed reference)' },

  // ---------------------------------------------------------------- respiratory exchange (04 §4.12, per-gram factors)
  { id: 'fuel.vo2PerGCho', value: 0.829, unit: 'L/g', low: 0.829, high: 0.829, grade: 'A', source: S.livesey, dossier: '04 §4.12', status: 'unverified', label: 'O2 per g carbohydrate oxidised' },
  { id: 'fuel.vo2PerGFat', value: 2.019, unit: 'L/g', low: 2.019, high: 2.019, grade: 'A', source: S.livesey, dossier: '04 §4.12', status: 'unverified', label: 'O2 per g fat oxidised' },
  { id: 'fuel.vo2PerGProt', value: 0.966, unit: 'L/g', low: 0.966, high: 0.966, grade: 'A', source: S.livesey, dossier: '04 §4.12', status: 'unverified', label: 'O2 per g protein oxidised' },
  { id: 'fuel.vco2PerGCho', value: 0.829, unit: 'L/g', low: 0.829, high: 0.829, grade: 'A', source: S.livesey, dossier: '04 §4.12', status: 'unverified', label: 'CO2 per g carbohydrate oxidised' },
  { id: 'fuel.vco2PerGFat', value: 1.427, unit: 'L/g', low: 1.427, high: 1.427, grade: 'A', source: S.livesey, dossier: '04 §4.12', status: 'unverified', label: 'CO2 per g fat oxidised' },
  { id: 'fuel.vco2PerGProt', value: 0.781, unit: 'L/g', low: 0.781, high: 0.781, grade: 'A', source: S.livesey, dossier: '04 §4.12', status: 'unverified', label: 'CO2 per g protein oxidised' },
];

/** Fallback for `fasting.kMf` (MODEL_SPEC §1.4, 20 §4B.2: 0.008 h⁻¹ [0.005, 0.012]) while the fasting module does not declare it. */
export const KMF_FALLBACK_PER_H = 0.008;
