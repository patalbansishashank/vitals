/**
 * Parameter registry of the moderators module (MODEL_SPEC §1.1, dossier 16 §4.0-4.13; 15 §4.10-4.11; 02 §4.3).
 * Every constant is one ParamDef; `prepare()` copies them into the constants object (never read in the step loop).
 * Grades follow the dossier: sleep -> insulin/MPS/testosterone B, time constants and partition C, cycle B-, caffeine
 * timing B (slope C). `status` = `verified` for numbers read from a source, `proposed-fit` for the dossier's PROPOSED FIT
 * equations, `unverified` where the dossier says UNVERIFIED.
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
): ParamDef => ({ id: `moderators.${name}`, value, unit, low, high, grade, source, dossier, status, ...extra });

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

export const MODERATORS_PARAMS: readonly ParamDef[] = [
  // ---- sleep-deficit state (16 §4.1.1, ruling R-SLEEP)
  FIX('hRef', 7.0, 'h', 'B', 'Nedeltcheva 2010 PMID 20921542 (control arm 7 h 25 min actual sleep); 12 §4.2 D_sleep reference 7.0 h', '16 §4.1.1', 'proposed-fit', 'Ruling R-SLEEP: one global reference 7.0 h (12\'s calibrations used 7 h). Rejected alternative (convention, not a draw; review M20): 16\'s 7.5 h. 16\'s worked examples (dS 0.71 … 2.26 for 5 h × 7 nights, V5 0.88) are reproduced with hRef = 7.5 (tests override it); at 7.0 the same protocols give dS 1.81 (Si −12.7 %, testosterone −9.1 %).'),
  P('qualityPoorH', 0.75, 'h', 0.5, 1.5, 'C', 'PROPOSED (about half the short-sleep effect; Tasali 2008 PMID 18172212 slow-wave suppression; Kline 2026 PMID 41889166 poor quality -2.2 % weight loss)', '16 §4.1.9', 'proposed-fit', {
    label: 'Equivalent deficit of poor-quality sleep',
  }),
  P('shiftWorkH', 1.0, 'h', 0.5, 1.5, 'C', 'PROPOSED (circadian misalignment, Scheer 2009 PMID 19255424 N=10; McHill 2014 PMID 25404342)', '16 §4.1.9', 'proposed-fit', {
    label: 'Equivalent deficit of shift work',
  }),
  P('tauDfUp', 1, 'd', 0.5, 1.5, 'C', 'Brondel 2010 PMID 20357041 (one 4-h night -> +559 kcal next day); ±50 % (16 §4.1.11)', '16 §4.1.1', 'proposed-fit', {
    label: 'Fast debt onset time constant',
  }),
  P('tauDfDown', 2, 'd', 1, 3, 'C', 'Markwald 2013 PMID 23479616 (recovery sleep lowers intake at once); ±50 % (16 §4.1.11)', '16 §4.1.1', 'proposed-fit', {
    label: 'Fast debt recovery time constant',
  }),
  P('tauDsUp', 3, 'd', 1.5, 4.5, 'C', 'Buxton 2010 PMID 20585000 (Si by 7 nights), Broussard 2012 PMID 23070488 (4 nights); ±50 % (16 §4.1.11)', '16 §4.1.1', 'proposed-fit', {
    label: 'Slow debt onset time constant',
  }),
  P('tauDsDown', 5, 'd', 2.5, 7.5, 'C', 'Ness 2019 PMID 30892916 (2 recovery nights did not restore Si), Depner 2019 PMID 30827911; ±50 % (16 §4.1.11)', '16 §4.1.1', 'proposed-fit', {
    label: 'Slow debt recovery time constant',
  }),
  FIX('debtCap', 4, 'h', 'C', '16 §4.1.1 caps: dF ≤ 4, dS ≤ 4 for Si / MPS / partition', '16 §4.1.1', 'proposed-fit', 'Cap of dF and of the dS terms in siSleepMult, mpsSleepMult and partitionSleepShift.'),
  FIX('debtCapTesto', 5, 'h', 'C', '16 §4.1.1 (5 for testosterone: acute total deprivation −24 % at cap −25 %, Lamon 2021 PMID 33400856)', '16 §4.1.1', 'proposed-fit', 'Cap of the dS state itself and of the testosterone term.'),

  // ---- sleep debt -> multipliers (16 §4.0.1)
  P('siPerH', 0.07, '1/h', 0.03, 0.1, 'B', 'PROPOSED FIT to Buxton 2010 PMID 20585000 (clamp −11 %, IVGTT −20 %), Depner 2019 PMID 30827911 (−13 %), Broussard 2012 PMID 23070488; Zhu 2019 PMID 30870662 SMD −0.70', '16 §4.0.1, §4.1.4', 'proposed-fit', {
    label: 'Insulin-sensitivity loss per hour of slow debt',
  }),
  P('mpsPerH', 0.05, '1/h', 0.03, 0.07, 'B', 'PROPOSED FIT to Saner 2020 PMID 32078168 (myofibrillar FSR −19 %), Lamon 2021 PMID 33400856 (−18 %)', '16 §4.0.1, §4.1.5', 'proposed-fit', {
    label: 'MPS loss per hour of slow debt',
  }),
  P('testoPerH', 0.05, '1/h', 0.03, 0.07, 'B', 'PROPOSED FIT to Leproult & Van Cauter 2011 PMID 21632481 (−10 to −13 % after 5 h × 8 nights), Lamon 2021 PMID 33400856 (−24 % acute)', '16 §4.0.1, §4.1.5', 'proposed-fit', {
    label: 'Testosterone loss per hour of slow debt (men)',
  }),
  P('partitionPerH', 0.04, '1/h', 0, 0.08, 'C', 'PROPOSED shrunken FIT: half the Nedeltcheva 2010 PMID 20921542 slope; Wang 2018 PMID 29438540 shows no absolute effect (lower band edge 0)', '16 §4.1.3', 'proposed-fit', {
    label: 'P-ratio shift per hour of slow debt (deficit only)',
    note: 'The lower edge zero must stay displayed (16 §4.1.3).',
  }),
  FIX('partitionCap', 0.12, '1', 'C', '16 §4.1.3 (cap +0.12)', '16 §4.1.3', 'proposed-fit'),
  FIX('partitionDeficitRef', 0.15, '1', 'C', '16 §4.1.3 (deficit fraction at which the full shift applies)', '16 §4.1.3', 'proposed-fit'),

  // ---- caffeine dose x time before bed -> sleep loss (16 §4.2.1; PK owner = intake, 15 §4.11)
  P('caffeineTHalfH', 5.4, 'h', 4, 6, 'C', 'Abernethy & Todd 1985 PMID 4029248 (5.37 h, healthy non-smoking women); Gardiner 2023 PMID 36870101 cut-offs', '16 §4.2.1, §4.13; 15 §4.11', 'proposed-fit', {
    label: 'Caffeine half-life',
    note: 'The one-compartment PK is owned by intake (MODEL_SPEC §1.3); this registry entry is the shared value (helpers caffeineHalfLifeH / caffeineResidualMg). Individual range wide (CYP1A2, ~89 % genetic).',
  }),
  FIX('caffeineOcMult', 1.47, '1', 'C', 'Abernethy & Todd 1985 PMID 4029248 (7.88 h vs 5.37 h combined oral contraceptive)', '16 §4.2.1', 'verified', 'Half-life multiplier for combined oral contraceptive users.'),
  FIX('caffeineSmokerMult', 0.56, '1', 'C', 'Joeres 1988 PMID 3371873 (clearance 114 vs 64 mL/min)', '16 §4.2.1', 'proposed-fit', 'Half-life multiplier for smokers (PersonProfile.habits.smoker, added 2026-09-30).'),
  P('caffeineRStarMg', 37, 'mg', 34, 40, 'B', 'Derived from Gardiner 2023 PMID 36870101 cut-offs: 107 mg at 8.8 h -> 34 mg and 217.5 mg at 13.2 h -> 40 mg', '16 §4.2.1, §4.13', 'proposed-fit', {
    label: 'No-sleep-loss caffeine residual at bedtime',
  }),
  P('tstLossPerMg', 0.4, 'min/mg', 0.25, 0.55, 'C', 'PROPOSED FIT: a typical residual of ≈150 mg gives Gardiner 2023 PMID 36870101 pooled −45 min; Drake 2013 PMID 24235903', '16 §4.2.1, §4.13', 'proposed-fit', {
    label: 'Total sleep time lost per mg of bedtime caffeine above R*',
  }),
  FIX('tstLossCapMin', 120, 'min', 'C', '16 §4.2.1 (cap 120 min)', '16 §4.2.1', 'proposed-fit'),
  FIX('tstLossPtsPerMin', 3, 'min per index point', 'D', '16 §4.2.6 sleepQualityScore: −TSTloss_caffeine_min/3 (UI heuristic, never fed back)', '16 §4.2.6', 'proposed-fit', 'Index points lost = TSTloss / 3.'),

  // ---- alcohol next-night recovery penalty (15 §4.10, dossier 16 converts to the sleep-quality index)
  FIX('alcoholDoseLowGKg', 0.25, 'g/kg', 'C', 'Pietilä 2018 PMID 29549064 (4,098 subjects; ≤ 0.25 g/kg ≈ 1.4 drinks at 80 kg)', '15 §4.10', 'verified'),
  FIX('alcoholDoseHighGKg', 0.75, 'g/kg', 'C', 'Pietilä 2018 PMID 29549064; 15 §4.10 (0.75 g/kg ≈ 4.3 drinks at 80 kg)', '15 §4.10', 'verified'),
  FIX('alcoholPenaltyLow', 0.09, '1', 'C', 'Pietilä 2018 PMID 29549064; 15 §4.10 recovery_penalty(next night) ≤ 0.25 g/kg (HRV recovery −9.3 units)', '15 §4.10', 'verified'),
  FIX('alcoholPenaltyMid', 0.24, '1', 'C', 'Pietilä 2018 PMID 29549064; 15 §4.10 recovery_penalty(next night) ≤ 0.75 g/kg (−24.0 units)', '15 §4.10', 'verified'),
  FIX('alcoholPenaltyHigh', 0.39, '1', 'C', 'Pietilä 2018 PMID 29549064; 15 §4.10 recovery_penalty(next night) > 0.75 g/kg (−39.2 units)', '15 §4.10', 'verified'),
  FIX('sleepIndexBase', 100, 'points', 'D', 'MODEL_SPEC §1.1 step 6: index = 100 − penalties (16 §4.2.6 UI heuristic; its own baseline is 75)', '16 §4.2.6', 'proposed-fit', 'Spec ruling: 100 baseline; the dossier heuristic starts at 75 and adds bonuses, not implemented.'),

  // ---- menstrual cycle (02 §4.3 luteal RMR; 16 §4.5)
  P('lutealAmp', 0.05, 'fraction of RMR', 0.02, 0.09, 'B', 'PROPOSED FIT to Benton 2020 PMID 32658929 (ES 0.23-0.33), sleeping MR +6.1 % (02 [103]), 24EE +106 kcal/d (02 [104]), +9 % calorimetry (02 [102])', '02 §4.3', 'proposed-fit', {
    label: 'Luteal-phase RMR increment',
    note: 'Read by energy (a_lut·(s(d) − s̄)); declared here per MODEL_SPEC §1.1.',
  }),
  FIX('lutealRampDays', 2, 'd', 'C', '02 §4.3 "smooth with 2-day ramps"', '02 §4.3', 'proposed-fit'),
  FIX('cycleLengthDefaultD', 28, 'd', 'B', '16 §4.5 default cycle length L = 28', '16 §4.5', 'verified'),

  // ---- menopause transition drift (16 §4.7): state-only in v1 (no bus signal carries it)
  P('menopauseFatDriftKgYr', 0.2, 'kg/yr', 0.1, 0.3, 'B', 'PROPOSED offset from Greendale 2019 PMID 30843880 SWAN (+1.7 vs +1.0 %/yr fat mass ≈ +0.2 kg/yr)', '16 §4.7, §4.13', 'proposed-fit', {
    label: 'Extra fat drift during the menopause transition',
    note: 'Applies while menopause = peri; ±50 % (16 §4.13). Exposed on the state only: see CONTRACT REQUEST in the WP report.',
  }),
  P('menopauseLeanDriftKgYr', -0.12, 'kg/yr', -0.18, -0.06, 'B', 'PROPOSED offset from Greendale 2019 PMID 30843880 (lean +0.2 → −0.2 %/yr ≈ −0.12 kg/yr)', '16 §4.7, §4.13', 'proposed-fit', {
    label: 'Extra lean drift during the menopause transition',
    note: 'Applies while menopause = peri; ±50 % (16 §4.13).',
  }),
];
