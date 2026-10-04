/**
 * safety — parameter registry (docs/MODEL_SPEC.md §0.4, §1.16; dossier 17 §2.5 constants block, §2.2, §2.3, §3, §4.3).
 *
 * Every threshold the module uses is a `ParamDef` with `draw: 'fixed'` (MODEL_SPEC §8.1: safety thresholds are never
 * varied in uncertainty draws). `low === high === value`: the dossier gives point bounds, not ranges. Values marked
 * `proposed-fit` are dossier 17 `PROPOSED` (engineering judgement); `unverified` are the ones the dossier labels
 * UNVERIFIED or that this work package had to interpret (see `note`).
 *
 * GENERATED once from a compact table and then maintained by hand; the file is the source of truth.
 */
import type { ModelParams, ParamDef, ParamStatus, EvidenceGrade } from '../../types/params';
import { param } from '../../core/paramsRegistry';

const p = (
  name: string,
  value: number,
  unit: string,
  grade: EvidenceGrade,
  source: string,
  dossier: string,
  status: ParamStatus,
  note: string,
): ParamDef => ({
  id: `safety.${name}`,
  value,
  unit,
  low: value,
  high: value,
  grade,
  source,
  dossier,
  status,
  draw: 'fixed',
  note,
});

export const SAFETY_PARAMS: readonly ParamDef[] = [
  p(
    'floorFemaleKcal',
    1200,
    'kcal/d',
    'A',
    'Jensen 2014 AHA/ACC/TOS PMID 24222017',
    '17 \u00a72.2 HC-E1, \u00a72.5',
    'verified',
    '7-d mean energy floor, female (prescription convention, not a physiological threshold; 17 \u00a78)',
  ),
  p(
    'floorMaleKcal',
    1500,
    'kcal/d',
    'A',
    'Jensen 2014 AHA/ACC/TOS PMID 24222017',
    '17 \u00a72.2 HC-E1, \u00a72.5',
    'verified',
    '7-d mean energy floor, male',
  ),
  p(
    'vledKcal',
    800,
    'kcal/d',
    'A',
    'NICE NG246 2025',
    '17 \u00a73 W-E02, W-M06',
    'verified',
    'Very-low-energy diet boundary (NICE NG246; AHA/ACC/TOS)',
  ),
  p(
    'capDefaultPct',
    25,
    '%',
    'C',
    'Villareal 2016 PMID 26332798',
    '17 \u00a72.3 cap_def',
    'proposed-fit',
    'Default 7-d deficit cap, % of TDEE_7 (CALERIE 25 % target)',
  ),
  p(
    'capBmiHighPct',
    30,
    '%',
    'C',
    'Jensen 2014 AHA/ACC/TOS PMID 24222017',
    '17 \u00a72.3 cap_def',
    'proposed-fit',
    'Deficit cap when BMI >= capBmiHigh (AHA lists a 30 % deficit option)',
  ),
  p(
    'capBmiLowPct',
    20,
    '%',
    'C',
    'Garthe 2011 PMID 21558571',
    '17 \u00a72.3 cap_def',
    'proposed-fit',
    'Deficit cap when BMI < capBmiLow (Garthe 19 % arm preserved LBM)',
  ),
  p(
    'capAge65Pct',
    15,
    '%',
    'B',
    'Bauer 2013 PMID 23867520',
    '17 \u00a72.3 cap_def, HC-P8',
    'proposed-fit',
    'Deficit cap for age >= 65',
  ),
  p(
    'capLeanPct',
    10,
    '%',
    'D',
    'Helms 2014 PMID 24864135',
    '17 \u00a72.3 cap_def',
    'proposed-fit',
    'Deficit cap when BF% <= BF floor + capLeanMarginPts',
  ),
  p(
    'capBmiHigh',
    30,
    'kg/m2',
    'A',
    'NICE NG246 2025',
    '17 \u00a72.3 cap_def',
    'verified',
    'BMI at or above which the high deficit cap applies',
  ),
  p(
    'capBmiLow',
    25,
    'kg/m2',
    'A',
    'NICE NG246 2025',
    '17 \u00a72.3 cap_def',
    'verified',
    'BMI below which the low deficit cap applies',
  ),
  p(
    'capLeanMarginPts',
    4,
    '% BF',
    'D',
    'Helms 2014 PMID 24864135',
    '17 \u00a72.3 cap_def',
    'proposed-fit',
    'Lean branch: BF% <= floor + 4',
  ),
  p(
    'deficitDangerPct',
    40,
    '%',
    'D',
    'Longland 2016 PMID 26817506',
    '17 \u00a73 W-E04',
    'proposed-fit',
    'Deficit above which W-E04 (danger) applies; Longland 40 % for 4 wk was supervised',
  ),
  p(
    'deficitAnyPct',
    5,
    '%',
    'C',
    'Peos 2021 PMID 33587549',
    '17 \u00a72.2 HC-E7 (5-15 % band)',
    'proposed-fit',
    'Below this the day counts as maintenance: "any deficit" in W-P*, HC-E1 applicability',
  ),
  p(
    'eaHardMin',
    30,
    'kcal/kg FFM/d',
    'B',
    'Loucks 2003 PMID 12519869',
    '17 \u00a72.2 HC-E4; \u00a73 W-E08',
    'verified',
    'EA below this is problematic (LH pulsatility disrupted; REDs 2023 debates a universal 30)',
  ),
  p(
    'eaReducedUpper',
    35,
    'kcal/kg FFM/d',
    'D',
    'Mountjoy 2023 REDs PMID 37752011',
    '17 \u00a73 W-E07',
    'proposed-fit',
    'W-E07 band upper edge (30-35 for > 14 d)',
  ),
  p(
    'eaAdequate',
    45,
    'kcal/kg FFM/d',
    'B',
    'Mountjoy 2023 REDs PMID 37752011',
    '17 \u00a72.3 EA zones; \u00a73 W-E09',
    'verified',
    'EA >= 45 adequate; 30-45 reduced',
  ),
  p(
    'eaNeedsExercise',
    1,
    '0/1',
    'D',
    '17 §2.2 HC-E4 ("applies when: any regime with exercise")',
    '17 §2.2 HC-E4; spec §7.2 W-E07…W-E09, W-E18-20 (this WP)',
    'unverified',
    '1 = the EA warnings (W-E07/E08/E09/E20 and the EA clauses of W-E18/E19) need net exercise energy in the trailing 7 d, as HC-E4 does; 0 = literal reading of the spec table, which flags most sedentary adults at maintenance (EA = EI/FFM is 35-45 for them)',
  ),
  p(
    'eaNeedsDeficit',
    1,
    '0/1',
    'D',
    'Integrator B ruling 2026-09-30 (17 §2.1 EA definition; Loucks 2003 PMID 12716733 lowered EA from 45 by diet/exercise)',
    '17 §2.2 HC-E4, §3 W-E07…W-E09, W-E18-20; MODEL_SPEC §7.2',
    'unverified',
    "1 = the EA warnings also need an energy deficit (deficit_pct_7 > deficitAnyPct): at energy balance EA = (TDEE − EEE)/FFM is the person's habitual level (30-45 for recreational exercisers), not a plan-induced reduction; 0 = exercise gate only",
  ),
  p(
    'fastDayMinHours',
    12,
    'h',
    'D',
    'Orchestrator ruling 2026-09-30 18:10 (fasts vs the 7-day floor/cap), PROPOSED',
    'MODEL_SPEC_DECISIONS 18:10; 17 §4.3',
    'proposed-fit',
    "A calendar day counts as a fast-event day when ≥ this many of its hours lie in a planned zero-intake span longer than T0 (plus the span's graded-refeed days); W-E01…W-E04 use the non-fast days of the 7-d window",
  ),
  p(
    'fastRuleWindowD',
    28,
    'd',
    'D',
    'Orchestrator ruling 2026-09-30 18:10 (28-day mean-intake floor and 28-day tissue-mass trend for fasts), PROPOSED',
    'MODEL_SPEC_DECISIONS 18:10',
    'proposed-fit',
    'With a fast-event day in the trailing window: the HC-E1 kcal floor also applies to the mean intake over this window, and the loss rate is the OLS slope of tissue mass over it',
  ),
  p(
    'bmiCautionMinLossPct',
    1,
    '%',
    'D',
    "17 §3 W-E13 ('This plan takes your BMI to …'); Integrator B 2026-09-30",
    '17 §3 W-E13',
    'unverified',
    'W-E13 fires when the projected (tissue-mass) BMI is in [18.5, 20) AND the plan has lowered tissue mass by more than this share of the start weight (a person who starts at BMI 19.5 and maintains is not warned)',
  ),
  p(
    'eaCautionDays',
    14,
    'd',
    'D',
    'Mountjoy 2023 REDs PMID 37752011',
    '17 \u00a73 W-E07, W-E20',
    'proposed-fit',
    'Persistence of EA < 35 / < 30 before the caution rules fire',
  ),
  p(
    'eaBoneDays',
    84,
    'd',
    'D',
    'Zibellini 2015 PMID 26012544',
    '17 \u00a73 W-E19',
    'proposed-fit',
    'EA < 45 for > 12 wk (bone flag)',
  ),
  p(
    'eaFemaleDays',
    28,
    'd',
    'D',
    'Loucks 2003 PMID 12519869',
    '17 \u00a73 W-E18',
    'proposed-fit',
    'EA < 45 for >= 4 wk in women (menstrual flag)',
  ),
  p(
    'rateCapDefaultPct',
    0.75,
    '%BW/wk',
    'C',
    'Garthe 2011 PMID 21558571',
    '17 \u00a72.3 cap_pct',
    'proposed-fit',
    'Default 14-d loss-rate cap (Garthe 0.7 %/wk best arm)',
  ),
  p(
    'rateCapLeanPct',
    0.5,
    '%BW/wk',
    'C',
    'Helms 2014 PMID 24864135',
    '17 \u00a72.3 cap_pct',
    'proposed-fit',
    'Cap when BF% <= BF floor + rateLeanMarginPts (Helms 0.5-1 %/wk, leaner slower)',
  ),
  p(
    'rateCapHighPct',
    1.0,
    '%BW/wk',
    'C',
    'Helms 2014 PMID 24864135',
    '17 \u00a72.3 cap_pct',
    'proposed-fit',
    'Cap when BMI >= 30 or BF% >= high-adiposity threshold',
  ),
  p(
    'rateCapAge65Pct',
    0.5,
    '%BW/wk',
    'B',
    'Bauer 2013 PMID 23867520',
    '17 \u00a72.3 cap_pct, HC-P8',
    'proposed-fit',
    'Cap for age >= 65',
  ),
  p(
    'rateLeanMarginPts',
    6,
    '% BF',
    'D',
    'Helms 2014 PMID 24864135',
    '17 \u00a72.3 cap_pct',
    'proposed-fit',
    'Lean branch: BF% <= floor + 6 (M <= 16 %, F <= 24 %)',
  ),
  p(
    'rateCapAbsKgWk',
    1.5,
    'kg/wk',
    'B',
    'Weinsier 1995 PMID 7847427',
    '17 \u00a72.2 HC-E5; \u00a73 W-E06',
    'verified',
    'Gallstone risk rises exponentially above 1.5 kg/wk',
  ),
  p(
    'highBfMale',
    30,
    '% BF',
    'D',
    'Helms 2014 PMID 24864135',
    '17 \u00a72.3 cap_pct',
    'proposed-fit',
    'High-adiposity BF% threshold, male',
  ),
  p(
    'highBfFemale',
    40,
    '% BF',
    'D',
    'Helms 2014 PMID 24864135',
    '17 \u00a72.3 cap_pct',
    'proposed-fit',
    'High-adiposity BF% threshold, female',
  ),
  p(
    'rateHairPct',
    0.75,
    '%BW/wk',
    'C',
    'Kang 2024 PMID 39623615',
    '17 \u00a73 W-E17',
    'proposed-fit',
    'Fast-loss rate that raises the hair-shedding info',
  ),
  p(
    'rateHairDays',
    56,
    'd',
    'C',
    'Kang 2024 PMID 39623615',
    '17 \u00a73 W-E17',
    'proposed-fit',
    '>= 8 wk at the hair-shedding rate',
  ),
  p(
    'cumLossMaxPct',
    20,
    '%',
    'C',
    'Erlinger 2000 PMID 11192327',
    '17 \u00a72.2 HC-E6; \u00a73 W-E11',
    'verified',
    'Cumulative loss of starting body weight',
  ),
  p(
    'cumLossDangerPct',
    24,
    '%',
    'C',
    'Erlinger 2000 PMID 11192327',
    '17 \u00a73 W-E12',
    'verified',
    'Cumulative loss above which W-E12 (danger) applies (gallstone risk factor)',
  ),
  p(
    'blockDeficitPct',
    15,
    '%',
    'C',
    'Peos 2021 PMID 33587549',
    '17 \u00a72.2 HC-E7; \u00a73 W-E10',
    'proposed-fit',
    'Continuous deficit block threshold',
  ),
  p(
    'blockMaxDays',
    84,
    'd',
    'C',
    'NICE NG246 2025',
    '17 \u00a72.2 HC-E7; \u00a73 W-E10',
    'proposed-fit',
    '12 wk cap for a deficit >= 15 % (NICE caps LED/VLED at 12 wk)',
  ),
  p(
    'blockLongDays',
    182,
    'd',
    'C',
    'Villareal 2016 PMID 26332798',
    '17 \u00a73 W-E19',
    'proposed-fit',
    '26 wk deficit >= 15 % (bone flag)',
  ),
  p(
    'blockModerateMaxDays',
    182,
    'd',
    'C',
    'Villareal 2016 PMID 26332798',
    '17 \u00a72.2 HC-E7',
    'proposed-fit',
    '26 wk cap for a 5-15 % deficit',
  ),
  p(
    'bmiUnderweight',
    18.5,
    'kg/m2',
    'B',
    'NICE NG246 2025',
    '17 \u00a73 W-E14; HC-P4',
    'verified',
    'WHO/NICE underweight boundary',
  ),
  p(
    'bmiCaution',
    20.0,
    'kg/m2',
    'D',
    'Honary 2019 PMID 31215514',
    '17 \u00a72.2 HC-P4; \u00a73 W-E13',
    'proposed-fit',
    'Start any deficit only at BMI >= 20; W-E13 below it',
  ),
  p(
    'bmiProjectedMin',
    19.0,
    'kg/m2',
    'D',
    'Honary 2019 PMID 31215514',
    '17 \u00a72.2 HC-P4',
    'proposed-fit',
    'Projected BMI floor on every deficit day (margins cover +-3 kg BF-slider error)',
  ),
  p(
    'bfFloorMale',
    10,
    '% BF',
    'D',
    'Rossow 2013 PMID 23412685',
    '17 \u00a72.2 HC-P5; \u00a72.5',
    'proposed-fit',
    'BF floor, male (physiological minimum + ~4-5 points)',
  ),
  p(
    'bfFloorFemale',
    18,
    '% BF',
    'D',
    'Hulmi 2016 PMID 28119632',
    '17 \u00a72.2 HC-P5; \u00a72.5',
    'proposed-fit',
    'BF floor, female',
  ),
  p(
    'bfCautionMale',
    12,
    '% BF',
    'D',
    'Rossow 2013 PMID 23412685',
    '17 \u00a73 W-E15',
    'proposed-fit',
    'W-E15 threshold, male',
  ),
  p(
    'bfCautionFemale',
    20,
    '% BF',
    'D',
    'Hulmi 2016 PMID 28119632',
    '17 \u00a73 W-E15',
    'proposed-fit',
    'W-E15 threshold, female',
  ),
  p(
    'bfDangerMale',
    8,
    '% BF',
    'D',
    'Rossow 2013 PMID 23412685',
    '17 \u00a73 W-E16',
    'proposed-fit',
    'W-E16 threshold, male',
  ),
  p(
    'bfDangerFemale',
    15,
    '% BF',
    'D',
    'Hulmi 2016 PMID 28119632',
    '17 \u00a73 W-E16',
    'proposed-fit',
    'W-E16 threshold, female',
  ),
  p(
    'bfStartMarginPts',
    2,
    '% BF',
    'D',
    'Sundgot-Borgen 2013 BJSM',
    '17 \u00a72.2 HC-P5',
    'proposed-fit',
    'No new deficit block if BF% < floor + 2',
  ),
  p(
    'rwHeightFactor',
    27.5,
    'kg/m2',
    'D',
    'Wolfe 2017 PMID 28298271',
    '17 \u00a72.1 RW',
    'proposed-fit',
    'Reference weight RW = min(BW, 27.5 * H^2) (align with 03)',
  ),
  p(
    'proteinFloor',
    0.8,
    'g/kg RW',
    'A',
    'Wolfe 2017 PMID 28298271',
    '17 \u00a72.2 HC-M1; \u00a73 W-M01',
    'verified',
    'RDA minimum',
  ),
  p(
    'proteinDeficitFloor',
    1.2,
    'g/kg RW',
    'A',
    'Longland 2016 PMID 26817506',
    '17 \u00a72.2 HC-M1; \u00a73 W-M02',
    'verified',
    'Floor in deficit (> 10 %), age >= 65 or RT >= 2 d/wk',
  ),
  p(
    'proteinDeficitTriggerPct',
    10,
    '%',
    'B',
    'Longland 2016 PMID 26817506',
    '17 \u00a72.2 HC-M1; \u00a73 W-M02',
    'verified',
    'Deficit above which the 1.2 g/kg floor applies',
  ),
  p(
    'proteinCapPctEnergy',
    35,
    '%E',
    'B',
    'Bilsborough 2006 PMID 16779921',
    '17 \u00a72.2 HC-M2; \u00a73 W-M03',
    'verified',
    'Protein above 35 %E: hyperammonaemia/nausea',
  ),
  p(
    'proteinCapGPerKgFfm',
    3.1,
    'g/kg FFM',
    'B',
    'Helms 2014 PMID 24092765',
    '17 \u00a72.2 HC-M2; \u00a73 W-M04',
    'verified',
    'Upper end used in lean dieting athletes',
  ),
  p(
    'proteinCkdCapGPerKgRw',
    1.3,
    'g/kg RW',
    'B',
    'KDIGO 2024 PMID 38490803',
    '17 \u00a72.2 HC-M2; \u00a73 W-M05',
    'verified',
    'CKD: avoid > 1.3 g/kg (KDIGO)',
  ),
  p(
    'rtDaysProtein',
    2,
    'd/wk',
    'B',
    'Longland 2016 PMID 26817506',
    '17 \u00a72.2 HC-M1',
    'verified',
    'RT sessions per week that raise the protein floor in deficit',
  ),
  p(
    'fatMinPctEnergy',
    15,
    '%E',
    'C',
    'Gebhard 1996 PMID 8781321',
    '17 \u00a72.2 HC-M3; \u00a73 W-M06',
    'verified',
    'Minimum fat share when EI >= 800',
  ),
  p(
    'fatMinG',
    30,
    'g/d',
    'B',
    'Gebhard 1996 PMID 8781321',
    '17 \u00a72.2 HC-M3; \u00a73 W-M06',
    'verified',
    'Minimum fat (one 10-g fat meal prevented stones, 0/7 vs 4/6)',
  ),
  p(
    'fatVeryLowG',
    10,
    'g/d',
    'B',
    'Gebhard 1996 PMID 8781321',
    '17 \u00a73 W-M07',
    'verified',
    'Fat below this for >= 7 d during rapid loss: gallstones, EFA',
  ),
  p(
    'fatVeryLowDays',
    7,
    'd',
    'B',
    'Gebhard 1996 PMID 8781321',
    '17 \u00a73 W-M07',
    'verified',
    'Persistence for W-M07',
  ),
  p(
    'carbKetoG',
    50,
    'g/d',
    'C',
    'Dynka 2026 PMID 41486865',
    '17 \u00a72.2 HC-M4; \u00a73 W-M08',
    'verified',
    'Net carbohydrate below which ketosis begins',
  ),
  p(
    'carbKetoDays',
    28,
    'd',
    'C',
    'Buren 2021 PMID 33801247',
    '17 \u00a73 W-M09',
    'verified',
    'Very-low-carb persistence for the LDL flag (17 women, 4 wk)',
  ),
  p(
    'carbLowG',
    100,
    'g/d',
    'C',
    'Dynka 2026 PMID 41486865',
    '17 \u00a73 W-P01, W-P02, W-P05; HC-P3',
    'proposed-fit',
    'Carbohydrate restriction threshold in the population rules',
  ),
  p(
    'fibreMinPer1000Kcal',
    14,
    'g/1000 kcal',
    'B',
    'Lambeau 2017 PMID 28252255',
    '17 \u00a72.2 HC-M5; \u00a73 W-M11',
    'verified',
    'IOM fibre density',
  ),
  p(
    'fibreDays',
    28,
    'd',
    'B',
    'Lambeau 2017 PMID 28252255',
    '17 \u00a73 W-M11',
    'verified',
    'Persistence for W-M11',
  ),
  p(
    'sodiumLowG',
    1.5,
    'g/d',
    'B',
    'NASEM 2019 doi:10.17226/25353',
    '17 \u00a72.2 HC-M6; \u00a73 W-M12',
    'verified',
    'NASEM AI 1.5 g/d',
  ),
  p(
    'sodiumHighG',
    2.3,
    'g/d',
    'B',
    'NASEM 2019 doi:10.17226/25353',
    '17 \u00a72.2 HC-M6; \u00a73 W-M13',
    'verified',
    'NASEM CDRR 2.3 g/d',
  ),
  p(
    'sodiumHighDays',
    28,
    'd',
    'B',
    'NASEM 2019 doi:10.17226/25353',
    '17 \u00a73 W-M13',
    'verified',
    'Persistence for W-M13',
  ),
  p(
    'fluidMinL',
    1.5,
    'L/d',
    'C',
    'EFSA DRV summary tables 2017',
    '17 \u00a72.2 HC-M9; \u00a73 W-M14',
    'verified',
    'Beverage floor',
  ),
  p(
    'fluidMaxL',
    4.0,
    'L/d',
    'C',
    'Hew-Butler 2017 PMID 28316971',
    '17 \u00a72.2 HC-M9; \u00a73 W-M15',
    'verified',
    'Beverage cap (hyponatraemia)',
  ),
  p(
    'fluidStoneL',
    2.5,
    'L/d',
    'D',
    'Kossoff 2018 PMID 29881797',
    '17 \u00a73 W-M24',
    'proposed-fit',
    'Fluid floor when ketogenic (stone risk)',
  ),
  p(
    'potassiumSuppMaxG',
    1.0,
    'g/d',
    'D',
    'NASEM 2019 doi:10.17226/25353',
    '17 \u00a72.2 HC-M7; \u00a73 W-M16',
    'verified',
    'Supplemental potassium cap',
  ),
  p(
    'magnesiumSuppMaxMg',
    350,
    'mg/d',
    'B',
    'Costello 2023 PMID 37487817',
    '17 \u00a72.2 HC-M8; \u00a73 W-M17',
    'verified',
    'IOM 1997 UL for supplements',
  ),
  p(
    'potassiumBaseMg',
    2800,
    'mg/d',
    'D',
    'NASEM 2019 doi:10.17226/25353',
    '17 \u00a72.2 HC-M7 (this WP)',
    'unverified',
    'Schedule potassium is total intake (default 2.8 g, core/defaults); supplemental = intake above this',
  ),
  p(
    'magnesiumBaseMg',
    300,
    'mg/d',
    'D',
    'Costello 2023 PMID 37487817',
    '17 \u00a72.2 HC-M8 (this WP)',
    'unverified',
    'Schedule magnesium is total intake (default 300 mg, core/defaults); supplemental = intake above this',
  ),
  p(
    'alcoholUnitsPerWeek',
    14,
    'units/wk',
    'B',
    'NHS alcohol units',
    '17 \u00a73 W-M18',
    'verified',
    'UK low-risk guidance',
  ),
  p(
    'alcoholUnitG',
    8,
    'g ethanol',
    'A',
    'NHS alcohol units',
    '17 \u00a73 W-M18',
    'verified',
    'One UK unit = 8 g ethanol',
  ),
  p(
    'alcoholDrinkG',
    14,
    'g ethanol',
    'B',
    'CCSA 2023',
    '17 \u00a73 W-M20; 15 \u00a74.10',
    'verified',
    'One standard drink (engine default 14 g per drink)',
  ),
  p(
    'alcoholOccasionDrinks',
    2,
    'drinks',
    'B',
    'CCSA 2023',
    '17 \u00a73 W-M20',
    'verified',
    'More than 2 drinks on one occasion',
  ),
  p(
    'alcoholVledKcal',
    800,
    'kcal/d',
    'B',
    'NICE CG32 2006/2017',
    '17 \u00a73 W-M19',
    'verified',
    'Alcohol on a < 800-kcal day',
  ),
  p(
    'caffeineDayMg',
    400,
    'mg/d',
    'A',
    'EFSA 2015 EFSA J 13(5):4102',
    '17 \u00a72.2 HC-M11; \u00a73 W-M21',
    'verified',
    'EFSA 2015 / FDA',
  ),
  p(
    'caffeineDoseMg',
    200,
    'mg',
    'B',
    'EFSA 2015 EFSA J 13(5):4102',
    '17 \u00a72.2 HC-M11; \u00a73 W-M21',
    'verified',
    'Single-dose ceiling',
  ),
  p(
    'caffeineBedMg',
    100,
    'mg',
    'C',
    'EFSA 2015 EFSA J 13(5):4102',
    '17 \u00a73 W-M22',
    'verified',
    'Caffeine near bedtime that can disturb sleep',
  ),
  p(
    'caffeineBedWindowH',
    6,
    'h',
    'C',
    'EFSA 2015 EFSA J 13(5):4102',
    '17 \u00a73 W-M22',
    'verified',
    'Window before bedtime',
  ),
  p(
    'creatineMaintG',
    5,
    'g/d',
    'B',
    'Kreider 2017 PMID 28615996',
    '17 \u00a72.2 HC-M12; \u00a73 W-M23',
    'verified',
    'Maintenance ceiling',
  ),
  p(
    'creatineLoadDays',
    7,
    'd',
    'B',
    'Kreider 2017 PMID 28615996',
    '17 \u00a73 W-M23',
    'verified',
    'Loading longer than this',
  ),
  p(
    'tierT0MaxH',
    20,
    'h',
    'C',
    'Zhong 2024 PMID 38987755',
    '17 \u00a74.3.2 T0',
    'proposed-fit',
    'Upper edge of tier T0',
  ),
  p(
    'tierT1MaxH',
    24,
    'h',
    'A',
    'Zhong 2024 PMID 38987755',
    '17 \u00a74.3.2 T1',
    'verified',
    'Upper edge of tier T1 (default-allowed)',
  ),
  p(
    'tierT2MaxH',
    48,
    'h',
    'B',
    'Stekovic 2019 PMID 31471173',
    '17 \u00a74.3.2 T2',
    'verified',
    'Upper edge of tier T2 (opt-in)',
  ),
  p(
    'tierT3MaxH',
    72,
    'h',
    'C',
    'Finnell 2018 PMID 29458369',
    '17 \u00a74.3.2 T3',
    'verified',
    'Upper edge of tier T3 (opt-in + upgraded eligibility)',
  ),
  p(
    'tierT4MaxH',
    168,
    'h',
    'C',
    'Wilhelmi de Toledo 2019 PMID 30601864',
    '17 \u00a74.3.2 T4',
    'verified',
    'Upper edge of tier T4 (expert mode); > this is T5 (never prescribed)',
  ),
  p(
    'fastH7Max',
    108,
    'h',
    'D',
    'Stekovic 2019 PMID 31471173',
    '17 \u00a72.2 HC-F2; \u00a73 W-F13',
    'proposed-fit',
    'Fasted hours in a trailing 7 d',
  ),
  p(
    'fastsT2In14d',
    3,
    'count',
    'D',
    'Stekovic 2019 PMID 31471173',
    '17 \u00a73 W-F13',
    'proposed-fit',
    '>= 3 fasts of tier T2 or above within 14 d',
  ),
  p(
    'fastWindowDays',
    14,
    'd',
    'D',
    'Stekovic 2019 PMID 31471173',
    '17 \u00a73 W-F13',
    'proposed-fit',
    'Look-back for W-F13',
  ),
  p(
    'eatingWindowMinH',
    4,
    'h',
    'D',
    'Zhong 2024 PMID 38987755',
    '17 \u00a72.2 HC-F5; \u00a73 W-F14',
    'proposed-fit',
    'Daily eating window below this',
  ),
  p(
    'gapT12MinH',
    24,
    'h',
    'B',
    'Stekovic 2019 PMID 31471173',
    '17 \u00a72.2 HC-F2',
    'verified',
    'Minimum normal eating between T1/T2 fasts',
  ),
  p(
    'gapT3MinH',
    168,
    'h',
    'D',
    'Stekovic 2019 PMID 31471173',
    '17 \u00a72.2 HC-F2',
    'proposed-fit',
    'T3: >= 7 d gap',
  ),
  p(
    'gapT4MinH',
    672,
    'h',
    'D',
    'Stekovic 2019 PMID 31471173',
    '17 \u00a72.2 HC-F2',
    'proposed-fit',
    'T4: >= 28 d gap',
  ),
  p(
    't1MaxPerWeek',
    3,
    'count',
    'B',
    'Stekovic 2019 PMID 31471173',
    '17 \u00a72.2 HC-F2',
    'verified',
    'T1: <= 3 per week',
  ),
  p(
    't2SplitH',
    36,
    'h',
    'B',
    'Stekovic 2019 PMID 31471173',
    '17 \u00a72.2 HC-F2',
    'unverified',
    'T2 fast-day length split (36 h ADF, abstract only)',
  ),
  p(
    't2MaxPerWeekLe36',
    3,
    'count',
    'B',
    'Stekovic 2019 PMID 31471173',
    '17 \u00a72.2 HC-F2',
    'verified',
    'T2 <= 36 h: <= 3 per week',
  ),
  p(
    't2MaxPerWeekGt36',
    2,
    'count',
    'D',
    'Stekovic 2019 PMID 31471173',
    '17 \u00a72.2 HC-F2',
    'proposed-fit',
    'T2 36-48 h: <= 2 per week',
  ),
  p(
    't3MaxPer30d',
    2,
    'count',
    'D',
    'Stekovic 2019 PMID 31471173',
    '17 \u00a72.2 HC-F2',
    'proposed-fit',
    'T3: <= 2 per 30 d',
  ),
  p(
    't4MaxPer12wk',
    1,
    'count',
    'D',
    'Stekovic 2019 PMID 31471173',
    '17 \u00a72.2 HC-F2',
    'proposed-fit',
    'T4: <= 1 per 12 wk',
  ),
  p(
    't4MaxPerYear',
    4,
    'count',
    'D',
    'Stekovic 2019 PMID 31471173',
    '17 \u00a74.3.2 T4',
    'proposed-fit',
    'T4: <= 4 per year',
  ),
  p(
    't3BmiMax',
    25,
    'kg/m2',
    'C',
    'Kerndt 1982 PMID 6758355',
    '17 \u00a73 W-F10',
    'proposed-fit',
    'Long fasts mostly studied in people with excess body fat',
  ),
  p(
    'leanFastMarginPts',
    6,
    '% BF',
    'D',
    'Kerndt 1982 PMID 6758355',
    'Spec \u00a77.2 W-20-FAST-LEAN (20 \u00a79 text says floor + 2)',
    'proposed-fit',
    'Fast >= T3 and BF% < BF floor + 6; the 20 \u00a79 prose uses BF < 12 % M / 20 % F (floor + 2) - spec wins',
  ),
  p(
    'refeedFirstDayMaxFrac',
    0.6,
    'frac of TDEE',
    'D',
    'NICE CG32 2006/2017',
    '17 \u00a72.2 HC-F3; \u00a73 W-F08',
    'proposed-fit',
    'First refeed day at or below this fraction of TDEE counts as a ramp (HC-F3 asks ~0.5; tolerance)',
  ),
  p(
    'refeedMinFastH',
    72,
    'h',
    'C',
    'NICE CG32 2006/2017',
    '17 \u00a73 W-F08',
    'verified',
    'W-F08 applies to fasts >= 72 h',
  ),
  p(
    'electrolyteFastH',
    48,
    'h',
    'D',
    'Kerndt 1982 PMID 6758355',
    '17 \u00a73 W-F06',
    'proposed-fit',
    'W-F06: fasts >= 48 h without a salt and fluid plan',
  ),
  p(
    'hardFastH',
    24,
    'h',
    'C',
    'Loy 1986 PMID 3745057',
    '17 \u00a73 W-F09',
    'verified',
    'W-F09: hard exercise during a fast >= 24 h',
  ),
  p(
    'hardIntensityFrac',
    0.85,
    'frac VO2max',
    'C',
    'Loy 1986 PMID 3745057',
    '17 \u00a73 W-F09; spec \u00a71.2 exHardSession',
    'verified',
    'Hard session intensity',
  ),
  p(
    'vigorousIntensityFrac',
    0.7,
    'frac VO2max',
    'C',
    'Compendium/LaForgia 2006, Knab 2011 (via 10 \u00a74.2)',
    '17 \u00a73 W-X04, W-X05 (vigorous)',
    'proposed-fit',
    'Vigorous = 70-85 % VO2max band of 10 \u00a74.2 (EPOC table)',
  ),
  p(
    'psmfProteinPctEnergy',
    30,
    '%E',
    'C',
    'Sours 1981 PMID 7223697',
    '17 \u00a73 W-F12; spec \u00a77.2',
    'proposed-fit',
    'PSMF-like: protein >= 30 %E at < 800 kcal',
  ),
  p(
    'psmfDays',
    3,
    'd',
    'C',
    'Sours 1981 PMID 7223697',
    '17 \u00a73 W-F12',
    'proposed-fit',
    '>= 3 consecutive days',
  ),
  p(
    'vledDays',
    3,
    'd',
    'C',
    'Sours 1981 PMID 7223697',
    '17 \u00a73 W-E02',
    'verified',
    'EI7 < 800 for >= 3 days',
  ),
  p(
    'zeroKcalDay',
    50,
    'kcal/d',
    'C',
    'definition (17 \u00a72.5)',
    '17 \u00a72.5 zero_energy_kcal_per_day_max',
    'verified',
    'A day at or below this counts as a zero-intake day (no protein-sparing pattern)',
  ),
  p(
    'ketoFedBhb',
    3.0,
    'mmol/L',
    'B',
    'Umpierrez 2024 consensus; Kitabchi 2009 (via 05 \u00a79)',
    '05 \u00a79; spec \u00a77.2 W-05-KETO-FED',
    'verified',
    'BHB >= 3.0 while eating: DKA criterion',
  ),
  p(
    'ketoAnyBhb',
    6.0,
    'mmol/L',
    'B',
    'Umpierrez 2024 consensus; Kitabchi 2009 (via 05 \u00a79)',
    '05 \u00a76/\u00a79; events table ketoneAlert',
    'verified',
    'BHB > 6.0 at any time',
  ),
  p(
    'ketoFedNeedsDiabetes',
    1,
    '0/1',
    'B',
    'Umpierrez 2024 consensus PMID 39052901; Kitabchi 2009 PMID 19564476 (DKA = BHB >= 3.0 with diabetes history and acidosis); von Geijer 2015 PMID 26428083 (lactation)',
    '05 \u00a79, \u00a78 item 8; spec \u00a77.2 W-05-KETO-FED; ruling R-FAST-GATE 2026-10-01',
    'unverified',
    '1 = W-05-KETO-FED ("ketones while eating", the DKA warning sign) applies to people with diabetes (type 1, or any diabetes treatment including diet only: 05 \u00a79 "known diabetes") and to pregnancy/breastfeeding (lactation ketoacidosis), as the rule text says; for everyone else it does not fire (nutritional and post-fast ketosis keep bicarbonate >= 18, 05 \u00a78 item 8; the ketones module still marks BHB > 6 as its warning band). 0 = the rule for everyone',
  ),
  p(
    'ketoFedRefeedWindowH',
    72,
    'h',
    'D',
    'Dai 2024 PMID 39557965 (REE back to baseline about 3 d after full refeeding); Kitabchi 2009 PMID 19564476 (starvation ketosis: intake < 500 kcal/day history)',
    '05 \u00a79 (starvation ketosis vs DKA), \u00a74.9 (ketosis exit); 20 \u00a74.2 tau_AT,off 3-7 d, \u00a74.4 tau_N,off 3 d; ruling R-FAST-GATE 2026-10-01',
    'proposed-fit',
    'Refeed phase after a fast longer than T0 (from the first intake), plus every planned graded-refeed day: only BHB > ketoAnyBhb counts as "ketones while eating" (the carry-over of fasting ketosis, not a DKA sign); was 24 h',
  ),
  p(
    'eaSampleMin',
    -5,
    'kcal/kg FFM/d',
    'C',
    '19 \u00a75 row 20 (zero-intake days: clip at -5 in all formulas); mirror of wellbeing.eaFloor',
    '19 \u00a75, \u00a72; 17 \u00a72.1 EA_7; ruling R-FAST-GATE 2026-10-01',
    'proposed-fit',
    'Lower clip of the daily EA sample (EI - EEE)/FFM used for EA_7 over non-fast days when a planned fast lies in the trailing 7 d',
  ),
  p(
    'eaSampleMax',
    70,
    'kcal/kg FFM/d',
    'C',
    '19 \u00a72 state table (typical range -5...70); mirror of wellbeing.eaCeil',
    '19 \u00a72; 17 \u00a72.1 EA_7; ruling R-FAST-GATE 2026-10-01',
    'proposed-fit',
    'Upper clip of the daily EA sample used for EA_7 over non-fast days',
  ),
  p(
    'fatFloorFracBw0',
    0.02,
    'frac BW0',
    'D',
    'MODEL_SPEC_REVIEW M9 (orchestrator ruling 2026-09-30)',
    'MODEL_SPEC §1.8, §1.16 (review M9)',
    'proposed-fit',
    'Mirror of composition.fmFloorFracBw0 (FM_min = 0.02·BW0); the registered composition value wins when present (prepare reads it), this one is the fallback',
  ),
  p(
    'fatFloorRampKg',
    1.0,
    'kg',
    'D',
    'MODEL_SPEC_REVIEW M9 (orchestrator ruling 2026-09-30)',
    'MODEL_SPEC §1.8, §1.16 (review M9)',
    'proposed-fit',
    "Mirror of composition.fmFloorRampKg (smooth floor ramp above FM_min); composition's value wins when present",
  ),
  p(
    'alpertKcalPerKgFm',
    69,
    'kcal/kg FM/d',
    'C',
    'Alpert 2005 PMID 15615615 (via 13 \u00a74.16)',
    '13 \u00a74.16',
    'verified',
    'Maximal fat-energy transfer (290 kJ/kg FM/d)',
  ),
  p(
    'alpertFraction',
    0.75,
    '1',
    'C',
    'Alpert 2005 PMID 15615615 (via 13 \u00a74.16)',
    '13 \u00a74.16',
    'proposed-fit',
    'Planner cap fraction of the Alpert limit (PROPOSED synthesis)',
  ),
  p(
    'runIncreaseMaxPct',
    30,
    '%',
    'C',
    'Nielsen 2014 PMID 25155475',
    '17 \u00a72.2 HC-X1; \u00a73 W-X01',
    'verified',
    'Week-on-week run progression for novices',
  ),
  p(
    'rtSetsStartMax',
    10,
    'sets/muscle/wk',
    'D',
    'ACSM 2009 PMID 19204579',
    '17 \u00a72.2 HC-X2; \u00a73 W-X02',
    'proposed-fit',
    'Hard sets per muscle per week at the start (novice)',
  ),
  p(
    'rtSetsIncreaseMax',
    2,
    'sets/muscle/wk per wk',
    'D',
    'ACSM 2009 PMID 19204579',
    '17 \u00a72.2 HC-X2; \u00a73 W-X02',
    'proposed-fit',
    'Week-on-week increase',
  ),
  p(
    'restDayRun',
    14,
    'd',
    'D',
    'ACSM 2009 PMID 19204579',
    '17 \u00a73 W-X03',
    'proposed-fit',
    'Days without a full rest day before the info fires',
  ),
  p(
    'gainRateMaxPct',
    0.5,
    '%BW/wk',
    'C',
    'Iraki 2019 PMID 31247944',
    '17 \u00a72.2 HC-E8; \u00a73 W-S01',
    'verified',
    'Gain rate for lean gain',
  ),
  p(
    'surplusMaxPct',
    20,
    '%',
    'C',
    'Iraki 2019 PMID 31247944',
    '17 \u00a72.2 HC-E8; \u00a73 W-S02',
    'verified',
    'Surplus above maintenance (EI <= 120 % TDEE)',
  ),
  p(
    'surplusDays',
    84,
    'd',
    'C',
    'Iraki 2019 PMID 31247944',
    '17 \u00a73 W-S02',
    'proposed-fit',
    'Persistence for W-S02 (12 wk)',
  ),
  p(
    'waistCautionMaleCm',
    102,
    'cm',
    'B',
    'Jensen 2014 AHA/ACC/TOS PMID 24222017',
    '17 \u00a72.2 HC-E8; \u00a73 W-S03',
    'verified',
    'AHA waist cut-point, male',
  ),
  p(
    'waistCautionFemaleCm',
    88,
    'cm',
    'B',
    'Jensen 2014 AHA/ACC/TOS PMID 24222017',
    '17 \u00a72.2 HC-E8; \u00a73 W-S03',
    'verified',
    'AHA waist cut-point, female',
  ),
  p(
    'whtrCaution',
    0.5,
    '1',
    'B',
    'NICE NG246 2025',
    '17 \u00a73 W-S03',
    'verified',
    'NICE WHtR increased-risk boundary',
  ),
  p(
    'whtrHigh',
    0.6,
    '1',
    'B',
    'NICE NG246 2025',
    '17 \u00a72.2 HC-E8',
    'verified',
    'NICE WHtR high-risk boundary',
  ),
  p(
    'surplusGainCapWhtrPct',
    0.25,
    '%BW/wk',
    'C',
    'Iraki 2019 PMID 31247944',
    '17 \u00a72.2 HC-E8',
    'verified',
    'Gain cap when WHtR 0.5-0.59',
  ),
  p(
    'ageOlderYears',
    65,
    'y',
    'B',
    'Bauer 2013 PMID 23867520',
    '17 \u00a72.2 HC-P8; \u00a73 W-P03',
    'verified',
    'Older-adult rules',
  ),
  p(
    'olderDeficitPct',
    15,
    '%',
    'B',
    'Bauer 2013 PMID 23867520',
    '17 \u00a73 W-P03',
    'verified',
    'Deficit above which W-P03 applies',
  ),
  p(
    'organDeficitPct',
    15,
    '%',
    'C',
    'Dynka 2026 PMID 41486865',
    '17 \u00a73 W-P05',
    'proposed-fit',
    'Deficit above which W-P05 applies',
  ),
  p(
    'restrictedFastH',
    12,
    'h',
    'B',
    'NICE NG246 2025',
    '17 \u00a72.2 HC-P3; \u00a73 W-P02',
    'proposed-fit',
    'R1: no fasting beyond 12 h',
  ),
  p(
    'rateStoneFlagPct',
    0.75,
    '%BW/wk',
    'C',
    'Weinsier 1995 PMID 7847427',
    '17 \u00a73 W-P06',
    'verified',
    'Rate above which the gallstone/gout/stone flag applies',
  ),
  p(
    'uncertainBmi',
    45,
    'kg/m2',
    'D',
    'Zhong 2024 PMID 38987755',
    '17 \u00a73 W-U02',
    'proposed-fit',
    'Model-development range: BMI',
  ),
  p(
    'uncertainAgeYears',
    70,
    'y',
    'D',
    'Zhong 2024 PMID 38987755',
    '17 \u00a73 W-U02',
    'proposed-fit',
    'Model-development range: age',
  ),
  p(
    'uncertainEiKcal',
    500,
    'kcal/d',
    'D',
    'Zhong 2024 PMID 38987755',
    '17 \u00a73 W-U02',
    'proposed-fit',
    'Model-development range: EI',
  ),
  p(
    'uncertainEiDays',
    7,
    'd',
    'D',
    'Zhong 2024 PMID 38987755',
    '17 \u00a73 W-U02',
    'proposed-fit',
    'EI below the limit for more than this many days',
  ),
  p(
    'scaleKcal',
    100,
    'kcal',
    'D',
    'definition (17 \u00a72.5)',
    'Spec \u00a77.3',
    'proposed-fit',
    'Margin scale of HC-E1',
  ),
  p(
    'scalePct',
    5,
    '%',
    'D',
    'definition (17 \u00a72.5)',
    'Spec \u00a77.3',
    'proposed-fit',
    'Margin scale of HC-E3, HC-E6',
  ),
  p(
    'scaleEa',
    5,
    'kcal/kg FFM/d',
    'D',
    'definition (17 \u00a72.5)',
    'Spec \u00a77.3',
    'proposed-fit',
    'Margin scale of HC-E4',
  ),
  p(
    'scaleRatePct',
    0.25,
    '%BW/wk',
    'D',
    'definition (17 \u00a72.5)',
    'Spec \u00a77.3',
    'proposed-fit',
    'Margin scale of HC-E5',
  ),
  p(
    'scaleBmi',
    1,
    'kg/m2',
    'D',
    'definition (17 \u00a72.5)',
    'Spec \u00a77.3',
    'proposed-fit',
    'Margin scale of HC-P4',
  ),
  p(
    'scaleBf',
    2,
    '% BF',
    'D',
    'definition (17 \u00a72.5)',
    'Spec \u00a77.3',
    'proposed-fit',
    'Margin scale of HC-P5',
  ),
  p(
    'scaleWeeks',
    1,
    'wk',
    'D',
    'engineering tolerance (WP-S), not published',
    'Spec \u00a77.3 (E7/E8 units not listed there)',
    'unverified',
    'Margin scale of HC-E7 (block length)',
  ),
  p(
    'scaleHours',
    24,
    'h',
    'D',
    'engineering tolerance (WP-S), not published',
    'Spec \u00a77.3 (F2 not listed there)',
    'unverified',
    'Margin scale of HC-F2 fastH7',
  ),
];

/** Typed view of the registry values (read once in `prepare`; plain numbers, monomorphic). */
export interface SafetyConstants {
  /** kcal/d */
  readonly floorFemaleKcal: number;
  /** kcal/d */
  readonly floorMaleKcal: number;
  /** kcal/d */
  readonly vledKcal: number;
  /** % */
  readonly capDefaultPct: number;
  /** % */
  readonly capBmiHighPct: number;
  /** % */
  readonly capBmiLowPct: number;
  /** % */
  readonly capAge65Pct: number;
  /** % */
  readonly capLeanPct: number;
  /** kg/m2 */
  readonly capBmiHigh: number;
  /** kg/m2 */
  readonly capBmiLow: number;
  /** % BF */
  readonly capLeanMarginPts: number;
  /** % */
  readonly deficitDangerPct: number;
  /** % */
  readonly deficitAnyPct: number;
  /** kcal/kg FFM/d */
  readonly eaHardMin: number;
  /** kcal/kg FFM/d */
  readonly eaReducedUpper: number;
  /** kcal/kg FFM/d */
  readonly eaAdequate: number;
  /** 0/1 */
  readonly eaNeedsExercise: number;
  /** 0/1 (EA rules need a deficit, Integrator B 2026-09-30) */
  readonly eaNeedsDeficit: number;
  /** h (fast-event day threshold, ruling 18:10) */
  readonly fastDayMinHours: number;
  /** d (28-day floor / tissue trend window for fasts, ruling 18:10) */
  readonly fastRuleWindowD: number;
  /** % (W-E13 plan-induced gate) */
  readonly bmiCautionMinLossPct: number;
  /** d */
  readonly eaCautionDays: number;
  /** d */
  readonly eaBoneDays: number;
  /** d */
  readonly eaFemaleDays: number;
  /** %BW/wk */
  readonly rateCapDefaultPct: number;
  /** %BW/wk */
  readonly rateCapLeanPct: number;
  /** %BW/wk */
  readonly rateCapHighPct: number;
  /** %BW/wk */
  readonly rateCapAge65Pct: number;
  /** % BF */
  readonly rateLeanMarginPts: number;
  /** kg/wk */
  readonly rateCapAbsKgWk: number;
  /** % BF */
  readonly highBfMale: number;
  /** % BF */
  readonly highBfFemale: number;
  /** %BW/wk */
  readonly rateHairPct: number;
  /** d */
  readonly rateHairDays: number;
  /** % */
  readonly cumLossMaxPct: number;
  /** % */
  readonly cumLossDangerPct: number;
  /** % */
  readonly blockDeficitPct: number;
  /** d */
  readonly blockMaxDays: number;
  /** d */
  readonly blockLongDays: number;
  /** d */
  readonly blockModerateMaxDays: number;
  /** kg/m2 */
  readonly bmiUnderweight: number;
  /** kg/m2 */
  readonly bmiCaution: number;
  /** kg/m2 */
  readonly bmiProjectedMin: number;
  /** % BF */
  readonly bfFloorMale: number;
  /** % BF */
  readonly bfFloorFemale: number;
  /** % BF */
  readonly bfCautionMale: number;
  /** % BF */
  readonly bfCautionFemale: number;
  /** % BF */
  readonly bfDangerMale: number;
  /** % BF */
  readonly bfDangerFemale: number;
  /** % BF */
  readonly bfStartMarginPts: number;
  /** kg/m2 */
  readonly rwHeightFactor: number;
  /** g/kg RW */
  readonly proteinFloor: number;
  /** g/kg RW */
  readonly proteinDeficitFloor: number;
  /** % */
  readonly proteinDeficitTriggerPct: number;
  /** %E */
  readonly proteinCapPctEnergy: number;
  /** g/kg FFM */
  readonly proteinCapGPerKgFfm: number;
  /** g/kg RW */
  readonly proteinCkdCapGPerKgRw: number;
  /** d/wk */
  readonly rtDaysProtein: number;
  /** %E */
  readonly fatMinPctEnergy: number;
  /** g/d */
  readonly fatMinG: number;
  /** g/d */
  readonly fatVeryLowG: number;
  /** d */
  readonly fatVeryLowDays: number;
  /** g/d */
  readonly carbKetoG: number;
  /** d */
  readonly carbKetoDays: number;
  /** g/d */
  readonly carbLowG: number;
  /** g/1000 kcal */
  readonly fibreMinPer1000Kcal: number;
  /** d */
  readonly fibreDays: number;
  /** g/d */
  readonly sodiumLowG: number;
  /** g/d */
  readonly sodiumHighG: number;
  /** d */
  readonly sodiumHighDays: number;
  /** L/d */
  readonly fluidMinL: number;
  /** L/d */
  readonly fluidMaxL: number;
  /** L/d */
  readonly fluidStoneL: number;
  /** g/d */
  readonly potassiumSuppMaxG: number;
  /** mg/d */
  readonly magnesiumSuppMaxMg: number;
  /** mg/d */
  readonly potassiumBaseMg: number;
  /** mg/d */
  readonly magnesiumBaseMg: number;
  /** units/wk */
  readonly alcoholUnitsPerWeek: number;
  /** g ethanol */
  readonly alcoholUnitG: number;
  /** g ethanol */
  readonly alcoholDrinkG: number;
  /** drinks */
  readonly alcoholOccasionDrinks: number;
  /** kcal/d */
  readonly alcoholVledKcal: number;
  /** mg/d */
  readonly caffeineDayMg: number;
  /** mg */
  readonly caffeineDoseMg: number;
  /** mg */
  readonly caffeineBedMg: number;
  /** h */
  readonly caffeineBedWindowH: number;
  /** g/d */
  readonly creatineMaintG: number;
  /** d */
  readonly creatineLoadDays: number;
  /** h */
  readonly tierT0MaxH: number;
  /** h */
  readonly tierT1MaxH: number;
  /** h */
  readonly tierT2MaxH: number;
  /** h */
  readonly tierT3MaxH: number;
  /** h */
  readonly tierT4MaxH: number;
  /** h */
  readonly fastH7Max: number;
  /** count */
  readonly fastsT2In14d: number;
  /** d */
  readonly fastWindowDays: number;
  /** h */
  readonly eatingWindowMinH: number;
  /** h */
  readonly gapT12MinH: number;
  /** h */
  readonly gapT3MinH: number;
  /** h */
  readonly gapT4MinH: number;
  /** count */
  readonly t1MaxPerWeek: number;
  /** h */
  readonly t2SplitH: number;
  /** count */
  readonly t2MaxPerWeekLe36: number;
  /** count */
  readonly t2MaxPerWeekGt36: number;
  /** count */
  readonly t3MaxPer30d: number;
  /** count */
  readonly t4MaxPer12wk: number;
  /** count */
  readonly t4MaxPerYear: number;
  /** kg/m2 */
  readonly t3BmiMax: number;
  /** % BF */
  readonly leanFastMarginPts: number;
  /** frac of TDEE */
  readonly refeedFirstDayMaxFrac: number;
  /** h */
  readonly refeedMinFastH: number;
  /** h */
  readonly electrolyteFastH: number;
  /** h */
  readonly hardFastH: number;
  /** frac VO2max */
  readonly hardIntensityFrac: number;
  /** frac VO2max */
  readonly vigorousIntensityFrac: number;
  /** %E */
  readonly psmfProteinPctEnergy: number;
  /** d */
  readonly psmfDays: number;
  /** d */
  readonly vledDays: number;
  /** kcal/d */
  readonly zeroKcalDay: number;
  /** mmol/L */
  readonly ketoFedBhb: number;
  /** mmol/L */
  readonly ketoAnyBhb: number;
  /** 0/1 */
  readonly ketoFedNeedsDiabetes: number;
  /** h */
  readonly ketoFedRefeedWindowH: number;
  /** kcal/kg FFM/d */
  readonly eaSampleMin: number;
  /** kcal/kg FFM/d */
  readonly eaSampleMax: number;
  /** frac BW0 */
  readonly fatFloorFracBw0: number;
  /** kg */
  readonly fatFloorRampKg: number;
  /** kcal/kg FM/d */
  readonly alpertKcalPerKgFm: number;
  /** 1 */
  readonly alpertFraction: number;
  /** % */
  readonly runIncreaseMaxPct: number;
  /** sets/muscle/wk */
  readonly rtSetsStartMax: number;
  /** sets/muscle/wk per wk */
  readonly rtSetsIncreaseMax: number;
  /** d */
  readonly restDayRun: number;
  /** %BW/wk */
  readonly gainRateMaxPct: number;
  /** % */
  readonly surplusMaxPct: number;
  /** d */
  readonly surplusDays: number;
  /** cm */
  readonly waistCautionMaleCm: number;
  /** cm */
  readonly waistCautionFemaleCm: number;
  /** 1 */
  readonly whtrCaution: number;
  /** 1 */
  readonly whtrHigh: number;
  /** %BW/wk */
  readonly surplusGainCapWhtrPct: number;
  /** y */
  readonly ageOlderYears: number;
  /** % */
  readonly olderDeficitPct: number;
  /** % */
  readonly organDeficitPct: number;
  /** h */
  readonly restrictedFastH: number;
  /** %BW/wk */
  readonly rateStoneFlagPct: number;
  /** kg/m2 */
  readonly uncertainBmi: number;
  /** y */
  readonly uncertainAgeYears: number;
  /** kcal/d */
  readonly uncertainEiKcal: number;
  /** d */
  readonly uncertainEiDays: number;
  /** kcal */
  readonly scaleKcal: number;
  /** % */
  readonly scalePct: number;
  /** kcal/kg FFM/d */
  readonly scaleEa: number;
  /** %BW/wk */
  readonly scaleRatePct: number;
  /** kg/m2 */
  readonly scaleBmi: number;
  /** % BF */
  readonly scaleBf: number;
  /** wk */
  readonly scaleWeeks: number;
  /** h */
  readonly scaleHours: number;
}

export function readSafetyConstants(params: ModelParams): SafetyConstants {
  return {
    floorFemaleKcal: param(params, 'safety.floorFemaleKcal'),
    floorMaleKcal: param(params, 'safety.floorMaleKcal'),
    vledKcal: param(params, 'safety.vledKcal'),
    capDefaultPct: param(params, 'safety.capDefaultPct'),
    capBmiHighPct: param(params, 'safety.capBmiHighPct'),
    capBmiLowPct: param(params, 'safety.capBmiLowPct'),
    capAge65Pct: param(params, 'safety.capAge65Pct'),
    capLeanPct: param(params, 'safety.capLeanPct'),
    capBmiHigh: param(params, 'safety.capBmiHigh'),
    capBmiLow: param(params, 'safety.capBmiLow'),
    capLeanMarginPts: param(params, 'safety.capLeanMarginPts'),
    deficitDangerPct: param(params, 'safety.deficitDangerPct'),
    deficitAnyPct: param(params, 'safety.deficitAnyPct'),
    eaHardMin: param(params, 'safety.eaHardMin'),
    eaReducedUpper: param(params, 'safety.eaReducedUpper'),
    eaAdequate: param(params, 'safety.eaAdequate'),
    eaNeedsExercise: param(params, 'safety.eaNeedsExercise'),
    eaNeedsDeficit: param(params, 'safety.eaNeedsDeficit'),
    fastDayMinHours: param(params, 'safety.fastDayMinHours'),
    fastRuleWindowD: param(params, 'safety.fastRuleWindowD'),
    bmiCautionMinLossPct: param(params, 'safety.bmiCautionMinLossPct'),
    eaCautionDays: param(params, 'safety.eaCautionDays'),
    eaBoneDays: param(params, 'safety.eaBoneDays'),
    eaFemaleDays: param(params, 'safety.eaFemaleDays'),
    rateCapDefaultPct: param(params, 'safety.rateCapDefaultPct'),
    rateCapLeanPct: param(params, 'safety.rateCapLeanPct'),
    rateCapHighPct: param(params, 'safety.rateCapHighPct'),
    rateCapAge65Pct: param(params, 'safety.rateCapAge65Pct'),
    rateLeanMarginPts: param(params, 'safety.rateLeanMarginPts'),
    rateCapAbsKgWk: param(params, 'safety.rateCapAbsKgWk'),
    highBfMale: param(params, 'safety.highBfMale'),
    highBfFemale: param(params, 'safety.highBfFemale'),
    rateHairPct: param(params, 'safety.rateHairPct'),
    rateHairDays: param(params, 'safety.rateHairDays'),
    cumLossMaxPct: param(params, 'safety.cumLossMaxPct'),
    cumLossDangerPct: param(params, 'safety.cumLossDangerPct'),
    blockDeficitPct: param(params, 'safety.blockDeficitPct'),
    blockMaxDays: param(params, 'safety.blockMaxDays'),
    blockLongDays: param(params, 'safety.blockLongDays'),
    blockModerateMaxDays: param(params, 'safety.blockModerateMaxDays'),
    bmiUnderweight: param(params, 'safety.bmiUnderweight'),
    bmiCaution: param(params, 'safety.bmiCaution'),
    bmiProjectedMin: param(params, 'safety.bmiProjectedMin'),
    bfFloorMale: param(params, 'safety.bfFloorMale'),
    bfFloorFemale: param(params, 'safety.bfFloorFemale'),
    bfCautionMale: param(params, 'safety.bfCautionMale'),
    bfCautionFemale: param(params, 'safety.bfCautionFemale'),
    bfDangerMale: param(params, 'safety.bfDangerMale'),
    bfDangerFemale: param(params, 'safety.bfDangerFemale'),
    bfStartMarginPts: param(params, 'safety.bfStartMarginPts'),
    rwHeightFactor: param(params, 'safety.rwHeightFactor'),
    proteinFloor: param(params, 'safety.proteinFloor'),
    proteinDeficitFloor: param(params, 'safety.proteinDeficitFloor'),
    proteinDeficitTriggerPct: param(params, 'safety.proteinDeficitTriggerPct'),
    proteinCapPctEnergy: param(params, 'safety.proteinCapPctEnergy'),
    proteinCapGPerKgFfm: param(params, 'safety.proteinCapGPerKgFfm'),
    proteinCkdCapGPerKgRw: param(params, 'safety.proteinCkdCapGPerKgRw'),
    rtDaysProtein: param(params, 'safety.rtDaysProtein'),
    fatMinPctEnergy: param(params, 'safety.fatMinPctEnergy'),
    fatMinG: param(params, 'safety.fatMinG'),
    fatVeryLowG: param(params, 'safety.fatVeryLowG'),
    fatVeryLowDays: param(params, 'safety.fatVeryLowDays'),
    carbKetoG: param(params, 'safety.carbKetoG'),
    carbKetoDays: param(params, 'safety.carbKetoDays'),
    carbLowG: param(params, 'safety.carbLowG'),
    fibreMinPer1000Kcal: param(params, 'safety.fibreMinPer1000Kcal'),
    fibreDays: param(params, 'safety.fibreDays'),
    sodiumLowG: param(params, 'safety.sodiumLowG'),
    sodiumHighG: param(params, 'safety.sodiumHighG'),
    sodiumHighDays: param(params, 'safety.sodiumHighDays'),
    fluidMinL: param(params, 'safety.fluidMinL'),
    fluidMaxL: param(params, 'safety.fluidMaxL'),
    fluidStoneL: param(params, 'safety.fluidStoneL'),
    potassiumSuppMaxG: param(params, 'safety.potassiumSuppMaxG'),
    magnesiumSuppMaxMg: param(params, 'safety.magnesiumSuppMaxMg'),
    potassiumBaseMg: param(params, 'safety.potassiumBaseMg'),
    magnesiumBaseMg: param(params, 'safety.magnesiumBaseMg'),
    alcoholUnitsPerWeek: param(params, 'safety.alcoholUnitsPerWeek'),
    alcoholUnitG: param(params, 'safety.alcoholUnitG'),
    alcoholDrinkG: param(params, 'safety.alcoholDrinkG'),
    alcoholOccasionDrinks: param(params, 'safety.alcoholOccasionDrinks'),
    alcoholVledKcal: param(params, 'safety.alcoholVledKcal'),
    caffeineDayMg: param(params, 'safety.caffeineDayMg'),
    caffeineDoseMg: param(params, 'safety.caffeineDoseMg'),
    caffeineBedMg: param(params, 'safety.caffeineBedMg'),
    caffeineBedWindowH: param(params, 'safety.caffeineBedWindowH'),
    creatineMaintG: param(params, 'safety.creatineMaintG'),
    creatineLoadDays: param(params, 'safety.creatineLoadDays'),
    tierT0MaxH: param(params, 'safety.tierT0MaxH'),
    tierT1MaxH: param(params, 'safety.tierT1MaxH'),
    tierT2MaxH: param(params, 'safety.tierT2MaxH'),
    tierT3MaxH: param(params, 'safety.tierT3MaxH'),
    tierT4MaxH: param(params, 'safety.tierT4MaxH'),
    fastH7Max: param(params, 'safety.fastH7Max'),
    fastsT2In14d: param(params, 'safety.fastsT2In14d'),
    fastWindowDays: param(params, 'safety.fastWindowDays'),
    eatingWindowMinH: param(params, 'safety.eatingWindowMinH'),
    gapT12MinH: param(params, 'safety.gapT12MinH'),
    gapT3MinH: param(params, 'safety.gapT3MinH'),
    gapT4MinH: param(params, 'safety.gapT4MinH'),
    t1MaxPerWeek: param(params, 'safety.t1MaxPerWeek'),
    t2SplitH: param(params, 'safety.t2SplitH'),
    t2MaxPerWeekLe36: param(params, 'safety.t2MaxPerWeekLe36'),
    t2MaxPerWeekGt36: param(params, 'safety.t2MaxPerWeekGt36'),
    t3MaxPer30d: param(params, 'safety.t3MaxPer30d'),
    t4MaxPer12wk: param(params, 'safety.t4MaxPer12wk'),
    t4MaxPerYear: param(params, 'safety.t4MaxPerYear'),
    t3BmiMax: param(params, 'safety.t3BmiMax'),
    leanFastMarginPts: param(params, 'safety.leanFastMarginPts'),
    refeedFirstDayMaxFrac: param(params, 'safety.refeedFirstDayMaxFrac'),
    refeedMinFastH: param(params, 'safety.refeedMinFastH'),
    electrolyteFastH: param(params, 'safety.electrolyteFastH'),
    hardFastH: param(params, 'safety.hardFastH'),
    hardIntensityFrac: param(params, 'safety.hardIntensityFrac'),
    vigorousIntensityFrac: param(params, 'safety.vigorousIntensityFrac'),
    psmfProteinPctEnergy: param(params, 'safety.psmfProteinPctEnergy'),
    psmfDays: param(params, 'safety.psmfDays'),
    vledDays: param(params, 'safety.vledDays'),
    zeroKcalDay: param(params, 'safety.zeroKcalDay'),
    ketoFedBhb: param(params, 'safety.ketoFedBhb'),
    ketoAnyBhb: param(params, 'safety.ketoAnyBhb'),
    ketoFedNeedsDiabetes: param(params, 'safety.ketoFedNeedsDiabetes'),
    ketoFedRefeedWindowH: param(params, 'safety.ketoFedRefeedWindowH'),
    eaSampleMin: param(params, 'safety.eaSampleMin'),
    eaSampleMax: param(params, 'safety.eaSampleMax'),
    fatFloorFracBw0: param(params, 'safety.fatFloorFracBw0'),
    fatFloorRampKg: param(params, 'safety.fatFloorRampKg'),
    alpertKcalPerKgFm: param(params, 'safety.alpertKcalPerKgFm'),
    alpertFraction: param(params, 'safety.alpertFraction'),
    runIncreaseMaxPct: param(params, 'safety.runIncreaseMaxPct'),
    rtSetsStartMax: param(params, 'safety.rtSetsStartMax'),
    rtSetsIncreaseMax: param(params, 'safety.rtSetsIncreaseMax'),
    restDayRun: param(params, 'safety.restDayRun'),
    gainRateMaxPct: param(params, 'safety.gainRateMaxPct'),
    surplusMaxPct: param(params, 'safety.surplusMaxPct'),
    surplusDays: param(params, 'safety.surplusDays'),
    waistCautionMaleCm: param(params, 'safety.waistCautionMaleCm'),
    waistCautionFemaleCm: param(params, 'safety.waistCautionFemaleCm'),
    whtrCaution: param(params, 'safety.whtrCaution'),
    whtrHigh: param(params, 'safety.whtrHigh'),
    surplusGainCapWhtrPct: param(params, 'safety.surplusGainCapWhtrPct'),
    ageOlderYears: param(params, 'safety.ageOlderYears'),
    olderDeficitPct: param(params, 'safety.olderDeficitPct'),
    organDeficitPct: param(params, 'safety.organDeficitPct'),
    restrictedFastH: param(params, 'safety.restrictedFastH'),
    rateStoneFlagPct: param(params, 'safety.rateStoneFlagPct'),
    uncertainBmi: param(params, 'safety.uncertainBmi'),
    uncertainAgeYears: param(params, 'safety.uncertainAgeYears'),
    uncertainEiKcal: param(params, 'safety.uncertainEiKcal'),
    uncertainEiDays: param(params, 'safety.uncertainEiDays'),
    scaleKcal: param(params, 'safety.scaleKcal'),
    scalePct: param(params, 'safety.scalePct'),
    scaleEa: param(params, 'safety.scaleEa'),
    scaleRatePct: param(params, 'safety.scaleRatePct'),
    scaleBmi: param(params, 'safety.scaleBmi'),
    scaleBf: param(params, 'safety.scaleBf'),
    scaleWeeks: param(params, 'safety.scaleWeeks'),
    scaleHours: param(params, 'safety.scaleHours'),
  };
}

let cachedDefaults: SafetyConstants | undefined;

/**
 * The registry's nominal values as a `SafetyConstants` object, without a run context (the planner's constraint-margin
 * layer and the tests use it). Cold path: built once by name from `SAFETY_PARAMS`.
 */
export function defaultSafetyConstants(): SafetyConstants {
  if (!cachedDefaults) {
    const o: Record<string, number> = {};
    for (const d of SAFETY_PARAMS) o[d.id.slice('safety.'.length)] = d.value;
    cachedDefaults = Object.freeze(o) as unknown as SafetyConstants;
  }
  return cachedDefaults;
}
