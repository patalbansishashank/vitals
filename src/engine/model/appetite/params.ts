/**
 * Parameter registry of the appetite module (MODEL_SPEC §1.12; dossiers 12 §4.9-4.10, 10 §4.3, 16 §4.1/§4.5, 15 §4.6,
 * 13 §4.10, 21 §4G).
 *
 * Numbers are copied from the dossiers. Where the dossier gives an explicit range it becomes [low, high]; otherwise the
 * parameter is `fixed`. Rulings applied: R-COMP (10 §4.3 owns the appetite half of exercise compensation; 12's 150/120
 * form = registry high), R-SLEEP (D_sleep reads 16's fast debt dF with the 7-h reference), R-INTAKE (outputs only).
 */
import type { ParamDef } from '../../types/params';

type Status = NonNullable<ParamDef['status']>;
type Extra = Pick<ParamDef, 'draw' | 'note' | 'label'>;

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
  extra: Extra = {},
): ParamDef => ({ id: `appetite.${name}`, value, unit, low, high, grade, source, dossier, status, ...extra });

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

const SRC_ATTRITION =
  'PROPOSED FIT to excess 12-month attrition: Trepanowski 2017 PMID 28459931; Dansinger 2005 PMID 15632335; Gardner 2018 PMID 29466592';
const SRC_LEVERS = 'PROPOSED mapping (21 §4G G10): Madigan 2015 (self-weighing) ref 139; Berry 2021 ref 142; Hollis 2008 ref 141';

export const APPETITE_PARAMS: readonly ParamDef[] = [
  // ---------------------------------------------------------------- appetite drive D (12 §4.9.1)
  P('dWlSlope', 95, 'kcal/d per kg', 57, 133, 'B', 'Polidori 2016 PMID 27804272 (proportional control kP ≈ 95 kcal/d per kg lost)', '12 §4.9.1, §4.9.6', 'verified', {
    label: 'Weight-loss appetite feedback slope',
    note: 'Range = 12 §4.9.6 suggested ±40 % inter-individual SD (UNVERIFIED).',
  }),
  FIX('wcFrac', 0.08, 'of W0', 'C', 'PROPOSED from Edwards 2022 PMID 35253406; Nymo 2018 PMID 29930313 (hormone/hunger plateaus)', '12 §4.9.1', 'proposed-fit', 'Saturation weight W_c = 0.08·W0.'),
  FIX('dWlGainSlope', 47.5, 'kcal/d per kg', 'D', 'PROPOSED (weight gain suppresses appetite; half the loss slope)', '12 §4.9.1', 'proposed-fit'),
  FIX('dWlGainCapKcal', 500, 'kcal/d', 'D', 'PROPOSED', '12 §4.9.1', 'proposed-fit'),
  P('wRefTauD', 3650, 'd', 730, 3650, 'D', 'PROPOSED; Nymo 2018 PMID 29930313; Sumithran 2011 PMID 22029981; Purcell 2014 PMID 25459211', '12 §4.9.4', 'proposed-fit', {
    label: 'Defended reference weight drift τ_ref',
    note: '12 gives a plausible range of 2 y to ∞; the unbounded upper end is truncated at the nominal 10 y.',
  }),
  FIX('lambdaLeanCoef', 1.5, '1', 'D', 'PROPOSED from Dulloo 1997 PMID 9062520; Keim 1998 PMID 9771856; Pardue 2017 PMID 28770669', '12 §4.9.1', 'proposed-fit', 'Λ_lean = [1 + c·(1 − S_L(L_FM))]/[1 + c·(1 − S_L(L0))].'),
  FIX('exAppMaxKcal', 100, 'kcal/d', 'B', 'Martin 2019 PMID 31172175 (E-MECHANIC intake +91/+124 kcal/d); Flack 2018', '10 §4.3; MODEL_SPEC R-COMP', 'proposed-fit',
    'Exercise appetite compensation A_max. R-COMP: 10 §4.3 owns the appetite half; 12 §4.9.1\'s 150 kcal/d is the rejected alternative (review M20: alternatives in note, not drawn).'),
  FIX('exAppKKcal', 150, 'kcal/d', 'B', 'Martin 2019 PMID 31172175; Flack 2018 (fit)', '10 §4.3; MODEL_SPEC R-COMP', 'proposed-fit',
    'Exercise appetite compensation half-scale K. 12 §4.9.1\'s 120 kcal/d is the rejected alternative (R-COMP; review M20).'),
  P('sExTauD', 28, 'd', 14, 42, 'D', 'PROPOSED lag (10 §4.3 tauAp 28 d); Martin 2019 PMID 31172175 (compensation builds over weeks)', '10 §4.3; 12 §4.9.5; MODEL_SPEC §1.12 (review m17)', 'proposed-fit', {
    label: 'Exercise-appetite filter τ of S_ex',
    note: 'Review m17: 10\'s owner value 28 d replaces the spec\'s earlier 14 d (12 §4.9.1).',
  }),
  FIX('dSleepPerHKcal', 100, 'kcal/d per h', 'C', 'Al Khatib 2017 PMID 27804960 (+385 kcal/d); Spiegel 2004 PMID 15583226', '12 §4.9.1; 16 §7 V6; MODEL_SPEC R-SLEEP', 'proposed-fit', 'Per hour of 16\'s fast sleep debt dF (7-h reference).'),
  FIX('dSleepCapH', 4, 'h', 'C', '12 §4.9.1 clamp(·, 0, 4)', '12 §4.9.1', 'proposed-fit'),
  FIX('dFatAmpKcal', 150, 'kcal/d', 'D', 'PROPOSED from Siedler 2023 PMID 37181269; Peos 2021 PMID 33587549', '12 §4.9.1', 'proposed-fit'),
  FIX('fatigueDeficitScale', 0.3, '1', 'D', 'PROPOSED (F* = min(1, |u|/0.3))', '12 §4.9.1', 'proposed-fit'),
  FIX('fatigueDeficitThresh', 0.05, '1', 'D', 'PROPOSED (fatigue builds when u < −0.05)', '12 §4.9.1', 'proposed-fit'),
  FIX('fatigueTauBuildD', 45, 'd', 'D', 'PROPOSED from Siedler 2023 PMID 37181269 (6 wk continuous restriction)', '12 §4.9.1', 'proposed-fit'),
  FIX('fatigueTauRecoverD', 7, 'd', 'D', 'PROPOSED from Peos 2021 PMID 33587549 (1-wk breaks)', '12 §4.9.1', 'proposed-fit'),
  FIX('dMealPerMealKcal', 60, 'kcal/d per meal', 'C', 'PROPOSED from Leidy & Campbell 2011 PMID 21123467; Ohkawara 2013 PMID 23404961', '12 §4.9.1', 'proposed-fit'),
  FIX('mealsRef', 3, 'meals/d', 'C', 'Leidy & Campbell 2011 PMID 21123467 (< 3 meals/d raises appetite)', '12 §4.9.1', 'proposed-fit'),
  FIX('mealTauD', 10, 'd', 'D', 'PROPOSED (entrainment decay UNVERIFIED)', '12 §4.9.1', 'unverified'),
  P('dLutealKcal', 168, 'kcal/d', 50, 300, 'C', 'Tucker 2025 PMID 39008822 (luteal vs follicular intake +168 kcal/d)', '16 §4.5, §7 V12', 'verified', {
    label: 'Luteal-phase appetite drive',
    note:
      'Added to D as 168·(s(d) − s̄) with s̄ the cycle mean of lutealWeight (mean-zero, as the luteal RMR term after review M3): ' +
      'the habitual intake EI_hab is cycle-averaged. 16 V12 intake effect as an output (prescribed-intake mode).',
  }),
  FIX('lutealMeanWindowD', 28, 'd', 'C', '16 §4.5 default cycle length L = 28 d', '16 §4.5', 'verified', 'Fallback window for s̄ when the profile gives no cycle length (the profile cycle length is used when present).'),

  // ---------------------------------------------------------------- satiety-effective intake S (12 §4.9.2)
  FIX('liquidDiscount', 0.9, '1', 'B', 'DiMeglio & Mattes 2000 PMID 10878689; Mourao 2007 PMID 17579632', '12 §4.9.2', 'proposed-fit'),
  FIX('hProtCoef', 0.25, '1', 'B', 'Weigle 2005 PMID 16002798; Gosby 2011 PMID 22022472', '12 §4.9.2', 'proposed-fit', 'H_P = 0.25·EI_hab·min(ln 2.5, ln(max(P, 0.3·P_ref)/P_ref)).'),
  FIX('hProtCapRatio', 2.5, '1', 'B', '12 §4.9.2 (min(ln 2.5, …))', '12 §4.9.2', 'proposed-fit'),
  FIX('hProtFloorRatio', 0.3, '1', 'B', '12 §4.9.2 (max(P, 0.3·P_ref))', '12 §4.9.2', 'proposed-fit'),
  FIX('hFibCoef', 0.05, '1', 'C', 'Howarth 2001 PMID 11396693 (halved to respect Wanders 2011 PMID 21676152)', '12 §4.9.2', 'proposed-fit'),
  FIX('hFibPerG', 14, 'g/d', 'C', 'Howarth 2001 PMID 11396693 (+14 g/d)', '12 §4.9.2', 'proposed-fit'),
  FIX('hFibCap', 0.08, 'of EI_hab', 'C', '12 §4.9.2 clamp ±0.08·EI_hab', '12 §4.9.2', 'proposed-fit'),
  FIX('vViscous', 1.5, '1', 'C', 'Wanders 2011 PMID 21676152 (viscous fibres reduce appetite in 59 % vs 14 % of comparisons)', '12 §4.9.2; 15 §4.5', 'proposed-fit', 'Mixed whole-food fibre v = 1.0; the viscous share above the habitual share gets v = 1.5.'),
  P('hEdEps', 0.5, '1', 0.25, 1.0, 'B', 'Rolls 2006 PMID 16400043; Ello-Martin 2007 PMID 17556681', '12 §4.9.2; 15 §4.6', 'proposed-fit', {
    label: 'Energy-density satiety elasticity ε', note: 'Range from 15 §4.6 (0.25-1.0).',
  }),
  FIX('edAutoIntercept', 1.15, 'kcal/g', 'B', 'PROPOSED (15 §4.6 ED_auto(u) = 1.15 + 0.35·u; Hall 2019 PMID 31105044)', '15 §4.6', 'proposed-fit', 'Population preset energy density when the user gives none.'),
  FIX('edAutoSlope', 0.35, 'kcal/g', 'B', 'PROPOSED (15 §4.6; Dicken 2025)', '15 §4.6', 'proposed-fit'),
  FIX('hUpfKcal', 300, 'kcal/d', 'B', 'Hall 2019 PMID 31105044 (+508 kcal/d split ≈ 50 % ED / 50 % residual)', '12 §4.9.2', 'proposed-fit'),
  FIX('hUpfScale', 0.8, '1', 'B', 'Hall 2019 PMID 31105044 (0 vs ≈ 0.8 UPF share)', '12 §4.9.2', 'proposed-fit'),

  // ---------------------------------------------------------------- unmet appetite, ketosis, HPI (12 §4.9.3)
  FIX('satDefMaxKcal', 1400, 'kcal/d', 'C', 'PROPOSED; Karl 2016 PMID 26975533 (+907 kcal after 48 h severe deficit); Mars 2005 PMID 15755824', '12 §4.9.3', 'proposed-fit'),
  FIX('satDefScaleKcal', 1000, 'kcal/d', 'C', 'PROPOSED (saturation shape)', '12 §4.9.3', 'proposed-fit'),
  FIX('effortTauD', 1, 'd', 'C', 'PROPOSED (acute deficit acts within a day)', '12 §4.9.3', 'proposed-fit'),
  FIX('ketoHalfMmolL', 0.3, 'mmol/L', 'B', 'Nymo 2017 PMID 28439092; Sumithran 2013 PMID 23632752', '12 §4.0, §4.9.4', 'proposed-fit', 'K half-max and K_ad* threshold (BHB ≥ 0.3 mM).'),
  FIX('ketoAtten', 0.9, '1', 'B', 'Nymo 2017 PMID 28439092; Gibson 2015 PMID 25402637', '12 §4.9.3', 'proposed-fit'),
  FIX('kAdTauUpD', 10, 'd', 'C', 'PROPOSED from Nymo 2017 PMID 28439092', '12 §4.9.3', 'proposed-fit'),
  FIX('kAdTauDownD', 3, 'd', 'C', 'PROPOSED from Sumithran 2013 PMID 23632752', '12 §4.9.3', 'proposed-fit'),
  FIX('ketoInductionKcal', 100, 'kcal-eq/d', 'D', 'MODEL_SPEC §1.12 step 3 (13 §4.10 appetite hook; Nymo 2017 PMID 28439092)', '13 §4.10; MODEL_SPEC §1.12', 'proposed-fit'),
  // 07 §4.10 fasting-hunger time course (orchestrator ruling 2026-09-30, adopted unchanged by 20 §4.4): Hfast(τ) =
  // 15 mm·x·e^(1−x), x = max(0, τ − 12)/18 (peak at 30 h, ≈ 1/3 of the peak at 72 h, ≈ 0 by day 5). The HPI keeps its
  // acute-deficit peak (12 App. A F/E anchors); beyond the Hfast peak the acute-deficit drive of a zero-intake span follows
  // the normalised decline x·e^(1−x), so multi-day fasts peak around day 2 and then fall (20 §4.10 item 5: "multi-day fasts
  // reduce hunger after day 2–3"; 07: 93 % report no hunger on 4-21-d modified fasts; 12 §4.4 ketosis suppresses ghrelin).
  // τ = hours since the last intake > 50 kcal (intake's fast_h); feeding resets it (refeeding: normal SatDef again).
  FIX('fastHungerOnsetH', 12, 'h', 'C', 'PROPOSED form, 07 §4.10 Hfast x = p(τ − 12)/18; Natalucci 2005 PMID 15941923; Wilhelmi de Toledo 2019 PMID 30601864', '07 §4.10; 20 §4.4', 'proposed-fit',
    'Post-absorptive onset of the Hfast shape (07 §4.1-4.2 t_PA); the dossier gives no range.'),
  P('fastHungerWidthH', 18, 'h', 12, 36, 'C', 'PROPOSED form, 07 §4.10 Hfast; range from 20 §4.10 table "hunger peaks late day 1–day 2" (peak 24-48 h ⇒ width 12-36 h)', '07 §4.10; 20 §4.4, §4.10', 'proposed-fit'),
  FIX('hpiMidKcal', 800, 'kcal-eq/d', 'D', '12 §4.9.3 scaling choice (maintenance ≈ 6, 25 % deficit week 1 ≈ 40-50)', '12 §4.9.3', 'proposed-fit'),
  FIX('hpiScaleKcal', 300, 'kcal-eq/d', 'D', '12 §4.9.3 scaling choice', '12 §4.9.3', 'proposed-fit'),

  // ---------------------------------------------------------------- adherence P_surv (12 §4.10a) and 21 levers
  FIX('hazardCoef', 0.0005, '1/d', 'D', SRC_ATTRITION, '12 §4.10a', 'proposed-fit'),
  FIX('hazardHpiThresh', 20, 'index', 'D', SRC_ATTRITION, '12 §4.10a', 'proposed-fit'),
  FIX('hazardHpiScale', 40, 'index', 'D', SRC_ATTRITION, '12 §4.10a', 'proposed-fit'),
  P('leverSelfMonitor', 0.1, '1', 0.05, 0.15, 'D', SRC_LEVERS, '21 §4G G10', 'proposed-fit', {
    note: 'Δp of the self-monitoring package; applied as hazard × (1 − ΣΔp) (MODEL_SPEC §1.12 step 4). No schedule input yet.',
  }),
  P('leverMealReplacement', 0.05, '1', 0, 0.1, 'D', 'PROPOSED (21 §4G G10); Min 2021 ref 128', '21 §4G G10', 'proposed-fit'),
  P('leverPreMealWater', 0.03, '1', 0, 0.05, 'D', 'PROPOSED (21 §4G G10); Dennis 2010 ref 129; Parretti 2015 ref 130', '21 §4G G10', 'proposed-fit'),
  P('leverFlexibleRestraint', 0.03, '1', 0, 0.05, 'D', 'PROPOSED (21 §4G G10); Westenhoefer 1999 ref 144', '21 §4G G10', 'proposed-fit'),
  FIX('leverCap', 0.15, '1', 'D', '21 §4G G10 (sum of all Δp capped at +0.15)', '21 §4G G10', 'proposed-fit'),
];
