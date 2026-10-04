/**
 * Parameter registry of the energy module (MODEL_SPEC §1.5; dossiers 02 §4.1-4.13, 10 §4.3, 11 §4.5-4.6, 15 §4.10-4.11).
 * Every constant the module uses is one ParamDef here; `prepare()` copies them into the constants object.
 * Values, ranges and grades are copied from the spec / dossier sections named in `dossier`. Where a ruling rejected a
 * dossier alternative, that alternative is the registry low/high and is named in `note` (MODEL_SPEC §0.4).
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
): ParamDef => ({ id: `energy.${name}`, value, unit, low, high, grade, source, dossier, status, ...extra });

/** Structural / definitional constant: never varied in draws. */
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

const HALL2011 = 'Hall 2011 PMID 21872751';
const HALL2006 = 'Hall 2006 PMID 16449298';

export const ENERGY_PARAMS: readonly ParamDef[] = [
  // ---- person-level RMR deviation (MODEL_SPEC §8.1 "person-level heterogeneity is a parameter like any other"; finisher
  // 2026-09-30 band calibration §8.3): the individual's RMR differs from the prediction equation. Nominal 0 (the equation);
  // drawn in ensembles. Applied by the core to the run's profile: RMR0·(1 + δ) and the TRUE habitual maintenance
  // TDEE0 + δ·RMR0 (a weight-stable person eats their true maintenance), while prescriptions in % of maintenance stay
  // compiled from the equation estimate — so an ensemble shows the spread that the maintenance estimate error causes.
  P('rmrIndividualFrac', 0, 'frac of RMR0', -0.2, 0.2, 'B', "Mifflin 1990 PMID 2305711 / Frankenfield 2005 PMID 15883556 (RMSE 136 kcal/d ≈ 8 %, 79 % within ±10 %); 16 §4.11 adjusted RMR SD 8-10 %", '02 §4.1 (accuracy); 16 §4.11', 'proposed-fit', {
    label: 'Individual RMR deviation from the prediction equation (δ)',
    note: 'Triangular(−0.2, 0, 0.2): SD 8.2 % (02 total error ≈ 8 %; FFM-adjusted REE CV 10.4-13.6 % includes measurement error), P10-P90 ±11 % (16 §4.11 UI band RMR ±13 %, σ 10 %).',
  }),

  // ---- RMR mass terms (02 §4.2; ruling R-RMRMASS)
  P('gammaL', 22, 'kcal/kg/d', 19.7, 22.8, 'B', `${HALL2011} (from Nelson 1992 PMID 1415003); Mifflin 1990 PMID 2305711 FFM slope 19.7`, '02 §4.2', 'verified', {
    label: 'Marginal RMR per kg non-muscle FFM (γ_L)',
    note: "Range = 02 §4.2 uncertainty 19.7-22.8. Dossier 20's γ_P 19 kcal/kg/d is a different convention (per kg protein tissue) and is not a draw (R-RMRMASS, review M20).",
  }),
  P('gammaF', 3.2, 'kcal/kg/d', 3.1, 4.5, 'B', `${HALL2011}; Nelson 1992 PMID 1415003; Elia adipose 4.5 via Wang 2010 PMID 20962155`, '02 §4.2', 'verified', {
    label: 'Marginal RMR per kg fat mass (γ_F)',
    note: "Range = 02 §4.2 uncertainty 3.1-4.5 (Elia adipose K 4.5; Hall 2006 and dossier 20 also use 4.5, R-RMRMASS).",
  }),
  P('gammaSM', 13, 'kcal/kg/d', 12.6, 13, 'B', 'Elia 1992 organ K_i via Wang 2010 PMID 20962155', '02 §4.2', 'verified', {
    label: 'RMR per kg training-attributable skeletal muscle (γ_SM)',
  }),

  // ---- adaptive thermogenesis (02 §4.8-4.9; ruling R-AT)
  P('betaAT', 0.14, '1', 0.05, 0.4, 'B', `Hall & Jordan 2008 PMID 19064508; ${HALL2011}`, '02 §4.8', 'verified', {
    label: 'AT gain in deficit (β_AT)',
    note: 'High 0.40 = Leibel-type high-adaptation scenario (Leibel 1995 PMID 7632212 stays a documented known-miss).',
  }),
  P('betaATPlus', 0.12, '1', 0, 0.35, 'C', '11 β_OF PROPOSED FIT (Bouchard/Johannsen/Diaz/Ravussin/Roberts stored fractions); Levine 1999 PMID 9880251 needs ≈0.35-0.40', '11 §4.6; 02 §4.9; MODEL_SPEC R-AT', 'proposed-fit', {
    label: 'AT gain in surplus (β_AT⁺)',
    note: "11's separate AT_OF term is not implemented (R-AT): its β_OF value is applied through 02's ODE.",
  }),
  P('sigmaAT', 0.6, '1', 0.4, 0.8, 'B', HALL2006, '02 §4.8', 'verified', { label: 'Non-resting share of AT (σ)' }),
  P('tauROn', 7, 'd', 3, 14, 'B', `${HALL2006}; Müller 2015 PMID 26399868; Heinitz 2020 PMID 32599082`, '02 §4.8', 'verified', {
    label: 'Resting AT onset time constant',
    draw: 'logTri',
  }),
  P('tauNOn', 14, 'd', 7, 30, 'B', `${HALL2011}; Martin 2007 PMID 18198305`, '02 §4.8', 'verified', {
    label: 'Non-resting AT onset time constant',
    draw: 'logTri',
  }),
  P('tauOff', 14, 'd', 14, 42, 'C', `PROPOSED: Martins 2020 PMID 32844188 (halving within 4 wk); MATADOR Byrne 2018 PMID 28925405`, '02 §4.8', 'proposed-fit', {
    label: 'AT offset time constant (both parts)',
  }),
  FIX('atGuardFrac', 0.25, 'frac TDEE0', 'C', 'PROPOSED numerical guard |AT_R + AT_N| ≤ 0.25·TDEE0', '02 §9', 'proposed-fit'),
  FIX('guardRmrFrac', 0.6, 'frac RMR0', 'C', 'PROPOSED validity flag RMR < 0.6·RMR0', '02 §9', 'proposed-fit'),
  FIX('guardTdeeRmr', 1.1, 'ratio', 'C', 'PROPOSED validity flag TDEE < 1.1·RMR', '02 §9', 'proposed-fit'),

  // ---- thermic effect of food (02 §4.4; rulings R-ALC, R-FIBRE, R-TEFTIME)
  P('tefP', 0.25, 'frac of protein energy', 0.2, 0.3, 'B', `Westerterp 2004 PMID 15507147; Tappy 1996 PMID 8878356; ${HALL2006}; FAO 2003 FNP 77`, '02 §4.4', 'verified', {
    label: 'TEF protein',
  }),
  P('tefC', 0.075, 'frac of carbohydrate energy', 0.05, 0.1, 'B', `Westerterp 2004 PMID 15507147; Tappy 1996 PMID 8878356; ${HALL2006}`, '02 §4.4', 'verified', {
    label: 'TEF available carbohydrate',
  }),
  P('tefF', 0.025, 'frac of fat energy', 0, 0.03, 'B', `Westerterp 2004 PMID 15507147; Tappy 1996 PMID 8878356; ${HALL2006}`, '02 §4.4', 'verified', {
    label: 'TEF fat (LCT)',
  }),
  P('tefMctExtra', 0.065, 'frac of MCT energy', 0.025, 0.075, 'C', 'PROPOSED from Clegg (in Quatela 2016 PMID 27792142): MCT total 0.09 [0.05, 0.10] − LCT 0.025', '02 §4.4', 'proposed-fit', {
    label: 'Extra TEF of MCT over LCT',
  }),
  P('tefAlc', 0.1, 'frac of alcohol energy', 0.05, 0.22, 'B', 'FAO 2003 FNP 77 NME/ME 6.3/7.0; Suter 1994 PMID 8184963 (0.17-0.225)', '15 §4.10, §5.1; MODEL_SPEC R-ALC', 'verified', {
    label: 'TEF alcohol',
    note: "Dossier 02's 0.20 (Suter) lies inside the high end (ruling R-ALC).",
  }),
  P('tefFibre', 0.3, 'frac of fibre energy (2 kcal/g)', 0, 0.3, 'C', 'PROPOSED from FAO 2003 FNP 77 (NME 1.4 vs ME 2.0 kcal/g)', '02 §4.4; MODEL_SPEC R-FIBRE', 'proposed-fit', {
    label: 'TEF fibre',
    note: "The only fibre thermic term (15's +2.3 kcal/g RMR add-on is off, R-FIBRE).",
  }),
  P('tefIrSlope', 0.25, '1 per IR index', 0, 0.3, 'C', 'PROPOSED m_IR = 1 − 0.25·IR (range 0.7-1.0) from de Jonge & Bray 1997 PMID 9449148; Granata 2002 PMID 12199298', '02 §4.4', 'proposed-fit', {
    label: 'TEF reduction per unit insulin-resistance index',
  }),

  // ---- protein-turnover EE (02 §4.5)
  P('kP', 0.6, 'kcal/d per g/d', 0.3, 1.1, 'C', 'PROPOSED FIT: Lejeune 2006 PMID 16400055; Bray 2012 PMID 22215165; Mikkelsen 2000 PMID 11063440', '02 §4.5', 'proposed-fit', {
    label: 'Protein-turnover RMR per g/d protein (k_P)',
  }),
  FIX('tauP', 2, 'd', 'C', 'PROPOSED (onset within 1 d, Bray 2015 PMID 25733634)', '02 §4.5', 'proposed-fit'),
  FIX('pEffMinGPerKg', 0.4, 'g/kg/d', 'C', 'Clamp range of the k_P term', '02 §4.5', 'proposed-fit'),
  FIX('pEffMaxGPerKg', 3.5, 'g/kg/d', 'C', 'Clamp range of the k_P term', '02 §4.5', 'proposed-fit'),

  // ---- caffeine EE (15 §4.11; ruling R-CAFF)
  P('kCaff', 0.1, 'kcal/mg', 0.05, 0.25, 'B', 'Hursel 2011 PMID 21366839 (pooled chamber slope 0.105 kcal/mg); Dulloo 1989 PMID 2912010 (0.25)', '15 §4.11, §5.1; MODEL_SPEC R-CAFF', 'verified', {
    label: 'Caffeine thermogenesis per mg above habitual',
    note: "Dossier 02's 0.25 kcal/mg (Dulloo) = registry high (R-CAFF).",
  }),
  FIX('cafTolTauD', 14, 'd', 'D', 'Beaumont 2017 PMID 27762662 (28-d tolerance); thermogenic tolerance unmeasured', '15 §4.11', 'proposed-fit'),
  FIX('cafTolMg', 200, 'mg/d', 'D', 'Tolerance builds with daily use ≥ 200 mg (Beaumont 2017 PMID 27762662)', '15 §4.11', 'proposed-fit'),
  FIX('cafTolEffect', 0.5, '1', 'D', 'Full tolerance halves the thermogenic effect (1 − 0.5·Tol)', '15 §4.11', 'proposed-fit'),

  // ---- exercise compensation, metabolic part (10 §4.3; ruling R-COMP)
  P('cMet', 0.15, 'frac of net exercise energy', 0, 0.28, 'C', 'Careau 2021 PMID 34453886 (27.7 % TEE compensation = high); E-MECHANIC Martin 2019 (0 %)', '10 §4.3; MODEL_SPEC R-COMP', 'proposed-fit', {
    label: 'Metabolic exercise compensation c_met at BMI 25',
    note: "02's constrained-TEE term (27.7 %, τ ≈ 60 d) is not implemented (R-COMP).",
  }),
  P('cMetPerBmi', 0.01, 'per kg/m²', 0, 0.02, 'C', 'PROPOSED adiposity modifier from Careau 2021 PMID 34453886 (29.7 % vs 45.7 % at BMI p10/p90; percentile BMIs UNVERIFIED)', '10 §4.3', 'proposed-fit'),
  FIX('cMetBmiRef', 25, 'kg/m²', 'C', 'Reference BMI of the c_met modifier', '10 §4.3', 'proposed-fit'),
  FIX('cMetBmiLo', -5, 'kg/m²', 'C', 'Lower clamp of (BMI − 25) in the c_met modifier', '10 §4.3', 'proposed-fit'),
  FIX('cMetBmiHi', 8, 'kg/m²', 'C', 'Upper clamp of (BMI − 25) in the c_met modifier', '10 §4.3', 'proposed-fit'),
  FIX('tauComp', 14, 'd', 'D', 'PROPOSED lag of the metabolic compensation', '10 §4.3', 'proposed-fit'),
  FIX('compCapFrac', 0.05, 'frac RMR', 'C', 'Cap −5 % RMR (Thomas 2012: −7 % in one confined study; MET/E-MECHANIC 0 %)', '10 §4.3', 'proposed-fit'),
  FIX('enetWindowD', 7, 'd', 'C', 'E_net = 7-day mean of net exercise + step energy above baseline', '10 §4.3', 'verified'),

  // ---- facultative CHO thermogenesis in surplus (11 §4.5)
  P('phiC', 0.1, 'frac of CHO energy above habitual', 0.05, 0.15, 'B', 'PROPOSED FIT: Dirlewanger 2000 PMID 11126336 (+7 % EE on +40 % CHO); Horton 1995 PMID 7598063', '11 §4.5', 'proposed-fit', {
    label: 'Facultative CHO thermogenesis TH_C (only when EI > EI0)',
  }),

  // ---- biochemical inefficiency (02 §4.11; ruling R-GNG)
  P('gngCost', 0, 'frac of GNG energy', 0, 0.2, 'B', `${HALL2006} (ε_g 0.8 → 0.2)`, '02 §4.11; MODEL_SPEC R-GNG; review M5 (ruled)', 'verified', {
    label: 'Energy cost of GNG above the habitual profile',
    note: "Orchestrator ruling on review M5: default 0 (0.2·ΔGNG double counts protein TEF/k_P and dossier 20's measured fasting REE); 02's 0.2 kept as registry high (sensitivity).",
  }),

  // ---- baseline decomposition (02 §4.6, §4.13)
  FIX('neat0FloorFrac', 0.1, 'frac RMR0', 'C', 'NEAT0 floor 0.10·RMR0', '02 §4.6', 'proposed-fit'),
  FIX('habitRtMet', 4.0, 'MET', 'B', 'Default resistance session 4.0 MET for 60 min incl. rest (10 §4.1; Compendium 2024)', '10 §4.1; 09 §4.13', 'verified',
    'EAT0 fallback only; must equal core/resolveProfile HABIT_RT_MET until ResolvedProfile exposes eat0Kcal (contract request).'),
  FIX('habitCardioMet', 5.0, 'MET', 'B', 'Generic cardio session: Compendium 2024 elliptical moderate 5.0 MET', '10 §4.1', 'verified',
    'EAT0 fallback only; must equal core/resolveProfile HABIT_CARDIO_MET until ResolvedProfile exposes eat0Kcal (contract request).'),

  // ---- end-of-burn-in calibration (ruling on review B3(b))
  FIX('burnInCalibDays', 7, 'd', 'C', 'NEAT0/EAT0/EI0 re-anchored on the last 7 burn-in (habitual-week) days', 'MODEL_SPEC_DECISIONS B3; review B3(b)', 'proposed-fit'),

  // ---- luteal centring (MODEL_SPEC §1.5 review M3); amplitude is moderators.lutealAmp
  FIX('lutealMeanPrior', 0.5, '0..1', 'C', 'Mean of s(d) over a tracked cycle (luteal ≈ days 15-28 of 28 with symmetric 2-d ramps)', '02 §4.3; MODEL_SPEC §1.5 (review M3)', 'proposed-fit',
    'Prior for the running cycle mean s̄ until one full cycle of lutealWeight has been observed.'),

  // ---- maintenance α_mix fallback (MODEL_SPEC §1.5 step 3, review M12)
  FIX('alphaMixMinEiFrac', 0.1, 'frac EI0', 'C', 'Use realised TEF/EI only when EI_day > 0.1·EI0, else habitual α_mix0', 'MODEL_SPEC §1.5 (review M12)', 'proposed-fit'),

  // ---- fasting overlay hold threshold (signal fastRmrMult description, 20 §4.2)
  FIX('fastHoldEps', 0.001, '1', 'C', 'AT_R is held while fastActive or |fastRmrMult − 1| > 0.001', '20 §4.2; MODEL_SPEC R-FAST-AT', 'verified'),

  // ---- body temperature (02 §4.3) — inactive: v1 has no core-temperature input
  P('tempCoef', 0.11, 'frac RMR per °C', 0.1, 0.13, 'C', 'Landsberg 2009 PMID 19768183 (10-13 % O2 per °C)', '02 §4.3', 'verified', {
    draw: 'fixed',
    note: 'Declared per MODEL_SPEC §1.5; no core-temperature input exists in the v1 contract, so the term is inactive (|ΔT| ≤ 2 °C).',
  }),
];
