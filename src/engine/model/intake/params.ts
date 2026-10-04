/**
 * Parameters of the intake module (docs/MODEL_SPEC.md §1.3, §0.4). Every number is copied from the cited dossier
 * section; ranges are the dossier's own (`low`/`high`); where the dossier gives no range the parameter is `fixed`
 * (low = high = value) and the note says so. Rejected alternatives of a ruling are named in `note`.
 */
import type { ParamDef } from '../../types/params';

type Opt = Pick<ParamDef, 'status' | 'label' | 'draw' | 'note'>;

function p(
  name: string,
  value: number,
  unit: string,
  low: number,
  high: number,
  grade: ParamDef['grade'],
  source: string,
  dossier: string,
  opt: Opt = {},
): ParamDef {
  return { id: `intake.${name}`, value, unit, low, high, grade, source, dossier, ...opt };
}

/** Fixed (no dossier range): low = high = value. */
function f(name: string, value: number, unit: string, grade: ParamDef['grade'], source: string, dossier: string, opt: Opt = {}): ParamDef {
  return p(name, value, unit, value, value, grade, source, dossier, { draw: 'fixed', ...opt });
}

// ---- sources (author year + PMID, as given in the dossiers' reference lists)
const FUCHS_2019 = 'Fuchs 2019 PMID 31166604 (04 ref 16)';
const LEE_WOLEVER_1998 = 'Lee & Wolever 1998 PMID 9881888 (04 ref 80)';
const MOGHADDAM_2006 = 'Moghaddam 2006 PMID 16988118; Meng 2017 PMID 28202475 (04 refs 77, 81)';
const TOSH_2013 = 'Tosh 2013 PMID 23422921 (04 ref 84)';
const ACHESON_1982 = 'Acheson 1982 PMID 6755166 (04 ref 41)';
const HOLT_1997 = 'Holt 1997 PMID 9356547 (04 ref 88)';
const NUMAO_2012 = 'Numao 2012 PMID 22669333 (04 ref 105)';
const DOSSIER04_FIT = 'dossier 04 §4.16 PROPOSED FIT (Lee & Wolever 1998 PMID 9881888; Moghaddam 2006 PMID 16988118)';
const TROMMELEN_2023 = 'Trommelen 2023 PMID 38118410 (03 ref 31)';
const BOHE_2001 = 'Bohé 2001 PMID 11306673 (03 ref 33)';
const TOUGAS_2000 = 'Tougas 2000 PMID 10894578; Hunt & Stubbs 1975 PMID 1127608 (07 refs 1, 3)';
const KLEIN_1993 = 'Klein 1993 PMID 8238506; Browning 2012 PMID 22140269 (07 refs 12, 13)';
const MORRIS_2015 = 'Morris 2015 PMID 25870289; Gu 2020 PMID 32525525 (07 refs 87, 100)';
const HFAST_08 = 'dossier 08 §4.10 PROPOSED threshold (reset rule; chosen so coffee, tea, electrolytes and pure fat do not reset)';
const JONES_2010 = 'Jones 2010 PMID 20304569 (15 ref 113)';
const BEAUMONT_2017 = 'Beaumont 2017 PMID 27762662 (15 ref 134)';
const HULTMAN_1996 = 'Hultman 1996 PMID 8828669 (15 ref 136)';
const KREIDER_2017 = 'Kreider 2017 PMID 28615996 (15 ref 138)';
const KARL_2017 = 'Karl 2017 PMID 28179223; Corbin 2023 PMID 37258525 (15 refs 2, 1)';
const ZOU_2007 = 'Zou 2007 PMID 18065582 (15 ref 3)';
const NOVOTNY_2012 = 'Novotny 2012 PMID 22760558 (15 ref 33)';
const STUBBS_2017 = 'Stubbs 2017 PMID 29163194; Clarke 2012 PMID 22561291 (05 refs 50, 51)';
const HALL_2010_05 = 'dossier 05 §4.4/§4.17 calibrated fallback (Klein 1993 PMID 8238506: fasting insulin −50 % by 72 h)';
const REYNOLDS_2016 = 'Reynolds 2016 PMID 27747394 (21 ref 19)';

export const INTAKE_PARAMS: readonly ParamDef[] = [
  // ------------------------------------------------------------ carbohydrate appearance (04 §4.10 step 1, §4.16)
  p('raGlcMaxGH', 60, 'g/h', 60, 66, 'B', FUCHS_2019, '04 §4.10', {
    status: 'verified',
    label: 'Max intestinal glucose absorption',
    note: '≈1.0–1.1 g/min (peak exogenous glucose oxidation); excess is queued to later hours',
  }),
  p('raGlcFruMaxGH', 90, 'g/h', 90, 105, 'B', FUCHS_2019, '04 §4.10', {
    status: 'verified',
    label: 'Max glucose + fructose absorption',
    note: '≈1.5–1.75 g/min; the lower end is the nominal value',
  }),

  // ------------------------------------------------------------ glucose curve (04 §4.16)
  p('glcFastMmolL', 5.0, 'mmol/L', 4.8, 5.6, 'C', DOSSIER04_FIT, '04 §4.16', {
    status: 'unverified',
    label: 'Fasting glucose Glc_f at S_hep = 1',
    note: 'range = overnight-fasted reference 4.8-5.6 mmol/L (07 §4.4.1 Table A, 12 h row)',
  }),
  f('glcShepExp', -0.1, '1', 'C', DOSSIER04_FIT, '04 §4.16', { status: 'proposed-fit', label: 'Glc_f exponent on S_hep' }),
  p('glcA50', 2.8, 'mmol/L', 2.0, 3.5, 'C', DOSSIER04_FIT, '04 §4.16', {
    status: 'unverified',
    label: 'Peak glucose rise after 50 g glucose (A_50)',
  }),
  p('glcKL', 80, 'g', 60, 110, 'C', LEE_WOLEVER_1998, '04 §4.16', {
    status: 'proposed-fit',
    label: 'Glycaemic-load half-saturation K_L',
    note: 'fitted to +68 % (25→50 g) and +38 % (50→100 g) iAUC steps (K = 106 and 61 respectively)',
  }),
  p('glcProtCoef', 0.006, '1/g', 0.003, 0.01, 'C', MOGHADDAM_2006, '04 §4.16', {
    status: 'proposed-fit',
    label: 'Glucose-excursion reduction per g protein (M_PF)',
  }),
  f('glcProtCapG', 50, 'g', 'C', MOGHADDAM_2006, '04 §4.16', { status: 'proposed-fit', label: 'Protein cap in M_PF' }),
  p('glcFatCoef', 0.0025, '1/g', 0.001, 0.005, 'C', MOGHADDAM_2006, '04 §4.16', {
    status: 'proposed-fit',
    label: 'Glucose-excursion reduction per g fat (M_PF)',
  }),
  f('glcFatCapG', 30, 'g', 'C', MOGHADDAM_2006, '04 §4.16', { status: 'proposed-fit', label: 'Fat cap in M_PF' }),
  f('glcFibCoef', 0.035, '1/g', 'C', TOSH_2013, '04 §4.16', {
    status: 'unverified',
    label: 'Glucose-excursion reduction per g viscous fibre (M_fib)',
    note: 'β-glucan −3.5 %/g; conversion to % UNVERIFIED; no range in the dossier',
  }),
  f('glcFibCapG', 12, 'g', 'C', TOSH_2013, '04 §4.16', { status: 'unverified', label: 'Viscous-fibre cap in M_fib' }),
  f('glcSmusExp', -0.5, '1', 'C', DOSSIER04_FIT, '04 §4.16', { status: 'proposed-fit', label: 'A_m exponent on S_mus' }),
  f('glcAmpCapMmolL', 4.5, 'mmol/L', 'C', DOSSIER04_FIT, '04 §4.16', { status: 'proposed-fit', label: 'Cap of the per-meal glucose rise' }),
  p('glcTolCoef', 0.6, '1', 0.3, 1.0, 'C', 'Numao 2012 PMID 22669333; Hengist 2024 (04 refs 105, 107)', '04 §4.19', {
    status: 'unverified',
    label: 'Glucose-excursion multiplier slope on (1 − T_C) (M_tol)',
  }),
  f('mClockSlopePerH', 0.0142, '1/h', 'B', MORRIS_2015, '07 §4.7.1', {
    status: 'proposed-fit',
    label: 'Circadian glucose-excursion slope (mClock)',
    note: 'R-CIRC: replaces 04 §4.16 M_circ 1.0 breakfast / 1.15 later (UNVERIFIED alternative); no range in 07',
  }),
  f('mClockWakeOffsetH', 1, 'h', 'B', MORRIS_2015, '07 §4.7.1', {
    status: 'proposed-fit',
    label: 'mClock reference = habitual wake + 1 h (= 08:00 for a 07:00 wake)',
  }),
  f('mClockSpanH', 14, 'h', 'B', MORRIS_2015, '07 §4.7.1', { status: 'proposed-fit', label: 'mClock clamp span' }),

  // ------------------------------------------------------------ glucose in fasting (07 §4.4.3 continuous reference)
  f('glcFastFloorMmolL', 3.5, 'mmol/L', 'B', KLEIN_1993, '07 §4.4.3', {
    status: 'proposed-fit',
    label: 'Fasting-glucose floor of the 07 reference curve',
    note: 'men; 07 §4.14 gives 3.2 mmol/L for women (sex term not in MODEL_SPEC §1.3, not applied); max anchor error ±0.4 mmol/L',
  }),
  f('glcFastAmpMmolL', 1.4, 'mmol/L', 'B', KLEIN_1993, '07 §4.4.3', { status: 'proposed-fit', label: 'Fasting-glucose logistic amplitude' }),
  f('glcFastT50H', 48, 'h', 'B', KLEIN_1993, '07 §4.4.3', { status: 'proposed-fit', label: 'Fasting-glucose logistic midpoint' }),
  f('glcFastScaleH', 12, 'h', 'B', KLEIN_1993, '07 §4.4.3', { status: 'proposed-fit', label: 'Fasting-glucose logistic scale' }),
  f('fastRefTauH', 12, 'h', 'B', KLEIN_1993, '07 §4.4', { status: 'proposed-fit', label: 'Overnight reference τ (normalisation point)' }),
  f('tauRefAbsH', 4.5, 'h', 'B', TOUGAS_2000, '07 §4.2', {
    status: 'proposed-fit',
    label: 'Absorption time of the 700-kcal reference meal (τ = tPA + 4.5 h)',
  }),

  // ------------------------------------------------------------ insulin curve (04 §4.17) + basal decline (05 §4.17, R-INS)
  p('insFastUuMl', 7, 'µU/mL', 5, 8, 'C', 'dossier 04 §4.17 typical lean fasting value', '04 §4.17', {
    status: 'unverified',
    label: 'Fasting insulin Ins_f at S_hep = 1',
  }),
  f('insShepExp', -0.9, '1', 'C', 'dossier 04 §4.17 PROPOSED FIT (HOMA link §4.18)', '04 §4.17', { status: 'proposed-fit', label: 'Ins_f exponent on S_hep' }),
  p('insBmaxUuMl', 250, 'µU/mL', 150, 350, 'C', ACHESON_1982, '04 §4.17', {
    status: 'proposed-fit',
    label: 'Maximal carbohydrate insulin excursion B_max',
    note: '±40 %; fit: 75 g → ≈50 µU/mL, 479 g → 154 (observed 139)',
  }),
  p('insKIG', 300, 'g', 150, 500, 'C', LEE_WOLEVER_1998, '04 §4.17', { status: 'proposed-fit', label: 'Insulin-load half-saturation K_I' }),
  p('insBPUuMlPerG', 0.6, 'µU/mL/g', 0.3, 1.0, 'C', HOLT_1997, '04 §4.17', { status: 'unverified', label: 'Insulin excursion per g protein b_P', note: 'Integrator A2: briefly 0.3 for ketogenesis; restored to the 04 value once ketones read 05\'s own insulin proxy (insulinRefRel)' }),
  f('insSmusExp', -0.7, '1', 'C', 'dossier 04 §4.17 PROPOSED FIT', '04 §4.17', { status: 'proposed-fit', label: 'B_m exponent on S_mus' }),
  f('insTpOffsetH', 0.25, 'h', 'C', 'dossier 04 §4.17 PROPOSED FIT', '04 §4.17', { status: 'proposed-fit', label: 'Insulin peak delay over t_p' }),
  f('insGiWeight', 0.5, '1', 'C', LEE_WOLEVER_1998, '04 §4.17', {
    status: 'proposed-fit',
    label: 'GI weight in the insulin load L_I = Σ(0.5 + 0.5·GI/100)·C',
  }),
  f('insTolCoef', 0.2, '1', 'C', NUMAO_2012, '04 §4.19', { status: 'proposed-fit', label: 'First-phase insulin loss slope on (1 − T_C) (M_ins)' }),
  f('insFloor', 0.45, '1', 'C', HALL_2010_05, '05 §4.17', { status: 'proposed-fit', label: 'Basal-insulin floor I_floor' }),
  f('insFloorExp', 0.5, '1', 'C', HALL_2010_05, '05 §4.17', { status: 'proposed-fit', label: 'Basal-insulin exponent Iexp' }),
  // time-based lower envelope of the basal decline (07 §4.4.3 InsulinRel(τ) = 0.45 + 0.55·e^(−p(τ − 12)/10), grade A:
  // Klein 1993, 70 % of the 12 → 72 h fall by 24 h; floor = insFloor). Integrator A2: with 04's liver kinetics the
  // liver-glycogen factor alone gives ≈ 40 % of the fall by 24 h (07 #2 miss) and delays the fasting FFA rise.
  f('insFastOnsetH', 12, 'h', 'A', KLEIN_1993, '07 §4.4.3', { status: 'proposed-fit', label: 'Fasting insulin decline: onset τ since the meal' }),
  f('insFastTauH', 10, 'h', 'A', KLEIN_1993, '07 §4.4.3', { status: 'proposed-fit', label: 'Fasting insulin decline: time constant' }),
  f('insGRefPer60KgFfm', 60, 'g', 'C', HALL_2010_05, '05 §4.17', {
    status: 'proposed-fit',
    label: 'Liver-glycogen reference G_ref per 60 kg FFM',
  }),
  // ketones' insulin proxy (05 §4.17 K.a_c / a_p; integrator A2 — see index.ts step 9 and MODEL_SPEC §1.3)
  f('ketIPerGCarbH', 0.12, '1 per g/h', 'C', HALL_2010_05, '05 §4.4, §4.17', { status: 'proposed-fit', label: "05 insulin proxy: rise of I per g/h of carbohydrate appearance (a_c)" }),
  f('ketIPerGProtH', 0.04, '1 per g/h', 'C', HALL_2010_05, '05 §4.4, §4.17', { status: 'proposed-fit', label: "05 insulin proxy: rise of I per g/h of protein appearance (a_p)" }),
  f('insExCoef', 0.3, '1', 'C', 'dossier 05 §3/§4.17 ex_I (exercise insulin suppression)', '05 §4.17', {
    status: 'proposed-fit',
    label: 'Insulin reduction per unit exercise intensity',
  }),

  // ------------------------------------------------------------ protein digestion (03 §4.7A)
  f('protVmaxGH', 11, 'g/h', 'C', TROMMELEN_2023, '03 §4.7A', {
    status: 'proposed-fit',
    label: 'Protein digestion Vmax',
    note: 'least-squares fit to Trommelen appearance; the MPS grid fit used 12 g/h (alternative fit, not a range: review M20)',
  }),
  f('protKmG', 20, 'g', 'C', TROMMELEN_2023, '03 §4.7A', {
    status: 'proposed-fit',
    label: 'Protein digestion Km',
    note: 'MPS grid fit used 25 g (alternative fit, not a range)',
  }),
  f('protFsys', 0.66, '1', 'C', TROMMELEN_2023, '03 §4.7A', {
    status: 'proposed-fit',
    label: 'Systemic (non-splanchnic) AA fraction F_sys',
    note: 'observed 12-h plateau for 25 g; MPS grid fit used 0.70 (alternative fit, not a range)',
  }),
  f('protTauLagH', 0.5, 'h', 'C', BOHE_2001, '03 §4.7A', { status: 'proposed-fit', label: 'AA signal latency τ_lag' }),

  // ------------------------------------------------------------ gastric emptying, fat appearance, fed state (07 §4.1, R-ABS)
  p('gutKgeKcalH', 270, 'kcal/h', 130, 300, 'B', TOUGAS_2000, '07 §4.1', { status: 'proposed-fit', label: 'Gastric emptying Vmax kGE' }),
  p('gutKGEKcal', 150, 'kcal', 100, 250, 'B', TOUGAS_2000, '07 §4.1', { status: 'proposed-fit', label: 'Gastric emptying half-saturation KGE' }),
  p('gutLagH', 0.5, 'h', 0.25, 0.75, 'B', TOUGAS_2000, '07 §4.1', { status: 'proposed-fit', label: 'Gastric lag for solid/mixed meals' }),
  p('fedThresholdKcalH', 30, 'kcal/h', 15, 60, 'C', 'dossier 07 §4.1 PROPOSED (≈0.3 × hourly RMR)', '07 §4.1', {
    status: 'proposed-fit',
    label: 'Absorptive-state threshold',
  }),

  // ------------------------------------------------------------ hFast clock (08 §4.10, R-HFAST)
  f('hFastProteinG', 10, 'g', 'D', HFAST_08, '08 §4.10', { status: 'proposed-fit', label: 'hFast reset: protein threshold' }),
  f('hFastCarbG', 15, 'g', 'D', HFAST_08, '08 §4.10', { status: 'proposed-fit', label: 'hFast reset: net-carbohydrate threshold' }),

  // ------------------------------------------------------------ alcohol (15 §4.10)
  p('alcKoxMaleGPerKgH', 0.1, 'g/kg/h', 0.067, 0.233, 'B', JONES_2010, '15 §4.10', {
    status: 'unverified',
    label: 'Ethanol oxidation rate, men',
    note: 'range derived by scaling 0.10 with the elimination range 10-35 vs mean 15 mg/100 mL/h (Widmark r UNVERIFIED)',
  }),
  p('alcKoxFemaleGPerKgH', 0.085, 'g/kg/h', 0.057, 0.198, 'B', JONES_2010, '15 §4.10', {
    status: 'unverified',
    label: 'Ethanol oxidation rate, women',
    note: 'range derived as for men (10-35 vs 15 mg/100 mL/h)',
  }),

  // ------------------------------------------------------------ caffeine (15 §4.11, 16 §4.13)
  // Half-life and its oral-contraceptive multiplier are single-owner parameters of the registry: `moderators.caffeineTHalfH`
  // and `moderators.caffeineOcMult` (16 §4.2.1/§4.13; same values as 15 §4.11), read by intake in prepare (integrator A2).
  p('cafTolTauD', 14, 'd', 14, 28, 'C', BEAUMONT_2017, '15 §4.11', { status: 'proposed-fit', label: 'Caffeine tolerance time constant' }),
  f('cafTolThresholdMg', 200, 'mg/d', 'C', BEAUMONT_2017, '15 §4.11', { status: 'proposed-fit', label: 'Daily caffeine building tolerance' }),

  // ------------------------------------------------------------ creatine (15 §4.12, R-CREATINE)
  p('crXMax', 0.2, '1', 0.1, 0.4, 'B', HULTMAN_1996, '15 §4.12', { status: 'proposed-fit', label: 'Creatine saturation x_max (+20 % muscle creatine)' }),
  f('crDoseSatG', 2.5, 'g/d', 'B', HULTMAN_1996, '15 §4.12', { status: 'proposed-fit', label: 'Dose giving full x_target' }),
  f('crTauUpNumGD', 30, 'g·d', 'B', HULTMAN_1996, '15 §4.12', { status: 'proposed-fit', label: 'τ_up = clamp(30/D, 1.5, 15) d numerator' }),
  f('crTauUpMinD', 1.5, 'd', 'B', HULTMAN_1996, '15 §4.12', { status: 'proposed-fit', label: 'τ_up lower clamp' }),
  f('crTauUpMaxD', 15, 'd', 'B', HULTMAN_1996, '15 §4.12', { status: 'proposed-fit', label: 'τ_up upper clamp' }),
  f('crTauDownD', 10, 'd', 'B', HULTMAN_1996, '15 §4.12', { status: 'proposed-fit', label: 'Creatine wash-out τ_down' }),
  p('crResponder', 1, '1', 0.25, 1, 'B', 'Powers 2003 PMID 12937471; Kreider 2017 PMID 28615996 (15 refs 137, 138)', '15 §4.12', {
    status: 'proposed-fit',
    draw: 'fixed',
    label: 'Creatine responder factor on x_max',
    note: 'non-responder phenotype ×0.25 (20-30 % of people) exposed as a range, never drawn',
  }),
  f('crLoadGPerKg', 0.3, 'g/kg/d', 'B', KREIDER_2017, '15 §4.12', {
    status: 'verified',
    label: 'Loading dose when the loading flag is set (ISSN 0.3 g/kg/d)',
  }),

  // ------------------------------------------------------------ fibre / nut ME correction (15 §4.2, R-FIBRE)
  p('fibreKFKcalPerG', 5.0, 'kcal/g', 3.5, 6.5, 'B', KARL_2017, '15 §4.2', { status: 'proposed-fit', label: 'Faecal-energy slope k_F' }),
  p('fibreGEKcalPerG', 4.2, 'kcal/g', 4.0, 4.4, 'B', KARL_2017, '15 §4.2', {
    status: 'unverified',
    label: 'Gross energy of fibre GE_fib',
    note: 'k_net = k_F − GE_fib + c_f (c_f = engine credit 2 kcal/g, core/defaults ATWATER.fibre) = 2.8 kcal/g',
  }),
  p('fibreRefGPer1000Kcal', 8, 'g/1000 kcal', 7.6, 8, 'B', KARL_2017, '15 §4.2', { status: 'proposed-fit', label: 'Typical fibre density F_ref' }),
  f('fibreCapNegFrac', 0.06, '1', 'B', ZOU_2007, '15 §4.2', { status: 'proposed-fit', label: 'Fibre ME correction lower cap (fraction of E)' }),
  f('fibreCapPosFrac', 0.03, '1', 'C', ZOU_2007, '15 §4.2', { status: 'proposed-fit', label: 'Fibre ME correction upper cap (fraction of E, guess)' }),
  p('fibreTauD', 3, 'd', 2, 4, 'B', 'Cummings 1992 PMID 1333426 (15 ref 9: whole-gut transit 60-70 h)', '15 §4.2', {
    status: 'proposed-fit',
    label: 'Fibre exposure EMA time constant τ_F',
  }),
  p('nutKcalPerG', 6.1, 'kcal/g', 6.0, 6.1, 'B', NOVOTNY_2012, '15 §4.2', {
    status: 'verified',
    label: 'Label energy of whole nuts',
    note: 'almonds 6.0-6.1 kcal/g (Atwater); walnuts 6.61 (other food, not a range)',
  }),
  p('nutFibreGPerG', 0.11, 'g/g', 0.1, 0.12, 'C', NOVOTNY_2012, '15 §4.2', {
    status: 'unverified',
    label: 'Fibre per g nuts (excluded from F_eff)',
  }),

  // ------------------------------------------------------------ exogenous ketones (05 §4.12)
  f('ketoneMwGPerMol', 104.1, 'g/mol', 'A', STUBBS_2017, '05 §4.17', { status: 'verified', label: 'Molar mass of BHB' }),
  f('ketoneTpFastedH', 0.5, 'h', 'B', STUBBS_2017, '05 §4.12', { status: 'proposed-fit', label: 'Ketone-ester absorption peak, fasted' }),
  f('ketoneTpFedH', 0.75, 'h', 'B', STUBBS_2017, '05 §4.12', { status: 'proposed-fit', label: 'Ketone-ester absorption peak, fed' }),
  f('ketoneFedFactor', 0.75, '1', 'B', STUBBS_2017, '05 §4.12', { status: 'proposed-fit', label: 'Ketone appearance factor when fed' }),
  f('ketoneKcalPerG', 4.45, 'kcal/g', 'B', 'Hall 2010 PMID 19934407 (05 ref 1: ρK)', '05 §4.15', {
    status: 'proposed-fit',
    label: 'Energy of exogenous D-BHB (counted in eAbs as it appears, review m16)',
  }),
  f('exCarbTpH', 0.5, 'h', 'B', 'dossier 04 §4.16 t_p class for liquid glucose; review M8 ruling', '04 §4.3', {
    status: 'proposed-fit',
    label: 'Time-to-peak of carbohydrate taken during exercise (absorbed as glucose)',
  }),

  // ------------------------------------------------------------ post-meal walk (21 C2, R-LEVERS)
  p('walkGlcFactor', 0.88, '1', 0.78, 0.99, 'B', REYNOLDS_2016, '21 C2', {
    status: 'verified',
    label: 'Post-meal walk: meal glucose-excursion factor',
  }),
  p('walkGlcFactorLastMeal', 0.78, '1', 0.67, 0.91, 'B', REYNOLDS_2016, '21 C2', {
    status: 'verified',
    label: 'Post-meal walk after the evening (last) meal',
  }),
  f('walkMinMinutes', 5, 'min', 'B', REYNOLDS_2016, '21 L2', { status: 'proposed-fit', label: 'Minimum walk minutes counted as a post-meal walk' }),
];
