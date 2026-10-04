/**
 * Dossier 01 §7 end-to-end scenarios (MODEL_SPEC §9.2 row 01): 7.1 Minnesota, 7.2 Jebb 12 d, 7.3 CALERIE-1, 7.4 CALERIE-2,
 * 7.5 Hall 2015 RC vs RF, 7.6 Hall 2016 KD, 7.7 overfeeding set (Bouchard, Diaz, Bray 2012; Horton is 11, Levine is 02),
 * 7.8 Friedlander (Q). Gate M except 7.8 Q and the K/Q rows called out per expectation.
 *
 * Every scenario is expressed with the real input schema. Where a study prescribes absolute intakes and reports the
 * participants' weight-stable energy need, the persona is tuned with `personWithTdee` so the engine's baseline
 * maintenance equals the published one (stated in `notes`); where it does not, intakes are % of maintenance.
 */
import { resolveProfile } from '../../core/resolveProfile';
import { person, personWithTdee, tdee0Of } from '../fixtures/personas';
import {
  buildSchedule,
  cardioSession,
  constantSchedule,
  gramMacros,
  kcalProgram,
  neutralMacros,
  pctMacros,
  pctMacros3,
  pctProgram,
  segmentSchedule,
} from '../fixtures/programs';
import { above, below, range, rel, val } from '../harness/run';
import type { Scenario } from '../harness/types';
import { REQUIRES } from '../harness/stubs';
import { fatLossKg, rqNonProtein, scaleDelta, storedEnergyKcal, tdeePctVsBaseline } from './util';

const CORE = REQUIRES.CORE;

// ------------------------------------------------------------------ 7.1 Minnesota semistarvation (Keys 1950 via Hall 2006)

const KEYS_MAN = person({ sex: 'male', ageYears: 25.5, heightCm: 179, weightKg: 69.4, bodyFatPct: 12.97, steps: 15000 });

export const MINNESOTA: Scenario = {
  id: '01-7.1-minnesota',
  dossier: '01',
  target: '7.1',
  title: 'Minnesota semistarvation, 24 wk',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Keys 1950 via Hall 2006 Am J Physiol Endocrinol Metab 291:E23 (PMID 16449298); dossier 01 §7.1',
  notes:
    'Baseline 3 630 kcal/d (CI 1826 + FI 1343 + PI 461) → semistarvation 1 585 kcal/d (CI 1100, FI 290, PI 195) = 43.7 % of baseline, i.e. −56 %. ' +
    'The engine cannot reach a 3 630 kcal/d maintenance from steps for a 69 kg man, so the deficit is applied as 43.7 % of the engine maintenance ' +
    '(same relative cut); macros 12.3/67.8/18.3 %E + 1.6 % fibre. Body: 69.4 kg (BMI 21.7 at 1.79 m), FM 9 kg (Hall 2006 Fig. 3), age 25.5 y. ' +
    'The voluntary-activity decline Hall used (δ 26 → 9 kcal/kg/d) is NOT imposed as an input: the energy module owns adaptive NEAT (02 §4.8). ' +
    'The 12-wk controlled refeed and 8-wk ad libitum phases are not scheduled: the refeeding energies are not in the dossier and ad libitum intake is out of v1.',
  arms: {
    main: {
      profile: KEYS_MAN,
      schedule: constantSchedule(168, pctProgram('semistarvation', 43.7, pctMacros3(12.3, 67.8, 18.3), { steps: 15000 })),
    },
  },
  expectations: [
    { id: 'bw24wk', label: 'body weight at 24 wk (76 % of 69.4 kg)', unit: 'kg', measure: (c) => c.main.after('scaleWeight', 168), check: val(52.74, 2), source: 'dossier 01 §7.1 (BW ±2 kg)' },
    { id: 'fm24wk', label: 'fat mass at 24 wk (34 % of 9 kg)', unit: 'kg', measure: (c) => c.main.after('fatMass', 168), check: val(3.06, 1), source: 'dossier 01 §7.1 (FM ±1 kg)' },
    { id: 'loss', label: 'weight lost (16-17 kg)', unit: 'kg', measure: (c) => -scaleDelta(c.main, 168), check: range(14.7, 18.7), gate: 'Q', source: 'dossier 01 §7.1 [5,6]' },
  ],
};

// ------------------------------------------------------------------ 7.2 Jebb 1996, 12-d whole-body calorimetry

const JEBB_SPEC = { sex: 'male', ageYears: 28, heightCm: 178, weightKg: 72, bodyFatPct: 13 } as const;
const JEBB_OVER = personWithTdee(JEBB_SPEC, (12.4 * 1000) / 4.184); // 16.5 MJ/d = +33 %  →  maintenance 12.4 MJ/d
const JEBB_UNDER = personWithTdee(JEBB_SPEC, (10.6 * 1000) / 4.184); // 3.5 MJ/d = −67 %  →  maintenance 10.6 MJ/d

export const JEBB: Scenario = {
  id: '01-7.2-jebb',
  dossier: '01',
  target: '7.2',
  title: 'Jebb 1996 12-d over/underfeeding',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Jebb et al. 1996 Am J Clin Nutr 64:259 (PMID 8780331); dossier 01 §7.2',
  notes:
    '6 lean men, 12 d in a whole-body calorimeter. Overfeeding 16.5 MJ/d (3 944 kcal; carbohydrate 540 g, fat 150 g, protein remainder ≈ 108 g) vs a ' +
    'weight-stable 12.4 MJ/d; underfeeding 3.5 MJ/d (837 kcal; carbohydrate 83 g, fat 20 g, protein ≈ 80 g) vs 10.6 MJ/d. Personas differ only in the ' +
    'habitual step count solved so that the engine TDEE0 equals the published baseline. Energy is absolute (kcal), macros in grams.',
  arms: {
    over: {
      label: 'overfeeding',
      profile: JEBB_OVER.profile,
      schedule: constantSchedule(12, kcalProgram('over', Math.round((16.5 * 1000) / 4.184), gramMacros(108, 540))),
    },
    under: {
      label: 'underfeeding',
      profile: JEBB_UNDER.profile,
      schedule: constantSchedule(12, kcalProgram('under', Math.round((3.5 * 1000) / 4.184), gramMacros(80, 83))),
    },
  },
  expectations: [
    { id: 'bwOver', label: 'overfeeding: weight change day 12', unit: 'kg', measure: (c) => scaleDelta(c.arm('over'), 12), check: val(2.9, 0.5), source: 'dossier 01 §7.2 (BW ±0.5 kg)' },
    { id: 'bwUnder', label: 'underfeeding: weight change day 12', unit: 'kg', measure: (c) => scaleDelta(c.arm('under'), 12), check: val(-3.18, 0.5), source: 'dossier 01 §7.2 (BW ±0.5 kg)' },
    { id: 'choOver', label: 'overfeeding: carbohydrate oxidation day 12 (551 g/d)', unit: 'g/d', measure: (c) => c.arm('over').day('choOxidation', 11), check: rel(551, 0.15), source: 'dossier 01 §7.2 (CHO ox ±15 %)' },
    { id: 'choUnder', label: 'underfeeding: carbohydrate oxidation day 12 (106 g/d)', unit: 'g/d', measure: (c) => c.arm('under').day('choOxidation', 11), check: rel(106, 0.15), source: 'dossier 01 §7.2 (CHO ox ±15 %)' },
    { id: 'teeOver', label: 'overfeeding: TEE change days 9-12 vs baseline (+6.2 %)', unit: '%', measure: (c) => tdeePctVsBaseline(c.arm('over'), 8, 12), check: val(6.2, 3), gate: 'Q', source: 'dossier 01 §7.2', note: 'Tolerance not given by the dossier; ±3 points assumed for the Q row.' },
    { id: 'teeUnder', label: 'underfeeding: TEE change days 9-12 vs baseline (−10.5 %)', unit: '%', measure: (c) => tdeePctVsBaseline(c.arm('under'), 8, 12), check: val(-10.5, 4), gate: 'Q', source: 'dossier 01 §7.2', note: 'Tolerance not given by the dossier; ±4 points assumed for the Q row.' },
    { id: 'fatOxOver', label: 'overfeeding: fat oxidation day 12 (59 g/d)', unit: 'g/d', measure: (c) => c.arm('over').day('fatOxidation', 11), check: rel(59, 0.25), gate: 'Q', source: 'dossier 01 §7.2' },
    { id: 'fatOxUnder', label: 'underfeeding: fat oxidation day 12 (177 g/d)', unit: 'g/d', measure: (c) => c.arm('under').day('fatOxidation', 11), check: rel(177, 0.25), gate: 'Q', source: 'dossier 01 §7.2' },
  ],
};

// ------------------------------------------------------------------ 7.3 CALERIE-1, 6 months

const CAL1 = person({ sex: 'female', ageYears: 37, heightCm: 165, weightKg: 75.7 }); // BMI 27.8 (dossier: 27.8 ± 0.7)
const CAL1_BW0 = 75.7;
const cal1Macros = neutralMacros('female');
/** 12.5 % of a ≈ 2 200 kcal/d maintenance ≈ 275 kcal/d net: 6 sessions/wk × 60 min at 5.2 MET (net 4.2 × 75.7 kg) ≈ 273 kcal/d. */
const CAL1_EX = [cardioSession('other', 17, 60, { met: 5.2 })];

export const CALERIE1: Scenario = {
  id: '01-7.3-calerie1',
  dossier: '01',
  target: '7.3',
  title: 'CALERIE-1, 6 mo (control, CR 25 %, CR 12.5 % + EX 12.5 %, VLCD)',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Heilbronn 2006 JAMA 295:1539 (PMID 16595757); Racette 2006 J Gerontol; Redman 2007; dossier 01 §7.3',
  notes:
    '48 overweight adults, BMI 27.8, age 36.8: modelled as one 37-y woman, 165 cm, 75.7 kg (BMI 27.8; the trial mixed sexes). Control 100 % of ' +
    'maintenance; CR 25 % = 75 %; CR + EX = 87.5 % diet + 6 × 60-min cardio/wk (≈ 273 kcal/d net = 12.5 % of maintenance); VLCD = 890 kcal/d for 12 wk ' +
    '(phase length not in the dossier: assumed) then maintenance of the current weight (100 % of current maintenance). Targets are % of baseline weight × 75.7 kg.',
  arms: {
    control: { label: 'control', profile: CAL1, schedule: constantSchedule(182, pctProgram('control', 100, cal1Macros)) },
    cr: { label: 'CR 25 %', profile: CAL1, schedule: constantSchedule(182, pctProgram('cr25', 75, cal1Macros)) },
    crex: {
      label: 'CR 12.5 % + EX 12.5 %',
      profile: CAL1,
      schedule: buildSchedule({
        days: 182,
        // R-MAINT: the protocol cut intake 12.5 % from BASELINE intake and added 12.5 % expenditure by exercise → % of the
        // habitual-activity maintenance ('habitual'), not of the maintenance at the planned activity
        programs: [pctProgram('crexTrain', 87.5, cal1Macros, { exercise: CAL1_EX }, undefined, 'habitual'), pctProgram('crexRest', 87.5, cal1Macros, {}, undefined, 'habitual')],
        use: [0, 0, 0, 0, 0, 0, 1],
      }),
    },
    vlcd: {
      label: 'VLCD then maintenance',
      profile: CAL1,
      schedule: segmentSchedule(
        [kcalProgram('vlcd', 890, pctMacros(30, 40)), pctProgram('hold', 100, cal1Macros, {}, 'current')],
        [
          { days: 84, program: 0 },
          { days: 98, program: 1 },
        ],
      ),
    },
  },
  expectations: [
    { id: 'control', label: 'control: weight change at 6 mo (−1.0 %)', unit: 'kg', measure: (c) => scaleDelta(c.arm('control'), 182), check: val(-0.01 * CAL1_BW0, 1.5), source: 'dossier 01 §7.3 (±1.5 kg)' },
    { id: 'cr', label: 'CR 25 %: weight change at 6 mo (−10.4 %)', unit: 'kg', measure: (c) => scaleDelta(c.arm('cr'), 182), check: val(-0.104 * CAL1_BW0, 1.5), source: 'dossier 01 §7.3 (±1.5 kg)' },
    { id: 'crex', label: 'CR + EX: weight change at 6 mo (−10.0 %)', unit: 'kg', measure: (c) => scaleDelta(c.arm('crex'), 182), check: val(-0.1 * CAL1_BW0, 1.5), source: 'dossier 01 §7.3 (±1.5 kg)' },
    { id: 'vlcd', label: 'VLCD: weight change at 6 mo (−13.9 %)', unit: 'kg', measure: (c) => scaleDelta(c.arm('vlcd'), 182), check: val(-0.139 * CAL1_BW0, 1.5), gate: 'Q', source: 'dossier 01 §7.3', note: 'Q: the VLCD phase length is an assumption, not a published input.' },
    { id: 'teeCr', label: 'CR: TDEE change at month 3 vs baseline (−454 ± 76 kcal/d)', unit: 'kcal/d', measure: (c) => c.arm('cr').mean('tdee', 84, 91) - c.arm('cr').profile.tdee0Kcal, check: val(-454, 76), gate: 'Q', source: 'dossier 01 §7.3 [51]' },
    { id: 'teeVlcd', label: 'VLCD: TDEE change at month 3 vs baseline (−633 ± 66 kcal/d)', unit: 'kcal/d', measure: (c) => c.arm('vlcd').mean('tdee', 80, 84) - c.arm('vlcd').profile.tdee0Kcal, check: val(-633, 66), gate: 'Q', source: 'dossier 01 §7.3 [51]' },
  ],
};

// ------------------------------------------------------------------ 7.4 CALERIE-2, 2 years from measured intake

// Baseline intake (integration 2026-09-30, DERIVED from dossier 01 §7.4): the intake change averages
// (480·26 + 274·26 + 224·52)/104 ≈ 300 kcal/d over 2 y at an achieved CR of 11.7 % → weight-stable intake ≈ 2 570 kcal/d.
// The default-steps persona had TDEE0 1 952 kcal/d, i.e. the same −480 kcal/d was a 25 % cut and the engine — like the BWP
// oracle fed the same inputs (−9.98 vs −9.76 kg at 1 y) — lost 2.6 kg too much. The persona is tuned with personWithTdee.
const CAL2_BASELINE_KCAL = (480 * 26 + 274 * 26 + 224 * 52) / 104 / 0.117;
const CAL2 = personWithTdee({ sex: 'female', ageYears: 38, heightCm: 165, weightKg: 68.5 }, CAL2_BASELINE_KCAL).profile; // BMI 25.2
const CAL2_BW0 = 68.5;
const cal2T = tdee0Of(CAL2);
const cal2Prog = (id: string, dKcal: number) => kcalProgram(id, Math.round(cal2T + dKcal), neutralMacros('female'));

export const CALERIE2: Scenario = {
  id: '01-7.4-calerie2',
  dossier: '01',
  target: '7.4',
  title: 'CALERIE-2, 2 y from the measured intake trajectory',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Ravussin 2015 J Gerontol A 70:1097; Sanghvi 2015 Am J Clin Nutr 102:353; Guo Brager Hall 2018 (PMID 29373640); dossier 01 §7.4',
  notes:
    'Measured intake change vs baseline (DLW/DXA): −480 kcal/d wk 0-26, −274 wk 26-52, −224 wk 52-78; wk 78-104 continues the last value (assumed). ' +
    'Baseline energy intake = engine TDEE0 (weight-stable). Persona: 38-y woman, 165 cm, 68.5 kg (BMI 25.2, trial range 21.9-28.0). Target: 10.4 % weight loss ' +
    'maintained (dossier §7.4 [53]); group mean within ±1 kg.',
  arms: {
    main: {
      profile: CAL2,
      schedule: segmentSchedule(
        [cal2Prog('cr0', -480), cal2Prog('cr1', -274), cal2Prog('cr2', -224)],
        [
          { days: 182, program: 0 },
          { days: 182, program: 1 },
          { days: 182, program: 2 },
          { days: 182, program: 2 },
        ],
      ),
    },
  },
  expectations: [
    { id: 'bw1y', label: 'weight change at 12 mo (−10.4 %)', unit: 'kg', measure: (c) => scaleDelta(c.main, 364), check: val(-0.104 * CAL2_BW0, 1), source: 'dossier 01 §7.4 (±1 kg)' },
    { id: 'bw2y', label: 'weight change at 24 mo (−10.4 % maintained)', unit: 'kg', measure: (c) => scaleDelta(c.main, 728), check: val(-0.104 * CAL2_BW0, 1), source: 'dossier 01 §7.4 (±1 kg)' },
  ],
};

// ------------------------------------------------------------------ 7.5 Hall 2015, isocaloric fat vs carbohydrate restriction

const HALL15_SPEC = { sex: 'male', ageYears: 36, heightCm: 171, weightKg: 105, bodyFatPct: 40, extra: { sexUnspecified: true } } as const;
const HALL15 = personWithTdee(HALL15_SPEC, 2740);
const H15_KCAL = 2740 - 810; // 1 930 kcal/d

export const HALL2015: Scenario = {
  id: '01-7.5-hall2015',
  dossier: '01',
  target: '7.5',
  title: 'Hall 2015 reduced-carbohydrate (RC) vs reduced-fat (RF), 6 d',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Hall et al. 2015 Cell Metab 22:427 (PMID 26278052); dossier 01 §7.5',
  notes:
    '19 adults with obesity (10 M / 9 F, BMI 35.9, FM 42 kg), baseline 2 740 kcal/d (50 % C, 35 % F, 15 % P). Persona: sex-unspecified, 36 y, 171 cm, ' +
    '105 kg (BMI 35.9), FM 42 kg, step count solved so the engine TDEE0 = 2 740 kcal/d. 6 d at −810 kcal/d (1 930 kcal/d) removing only carbohydrate ' +
    '(RC: 140 g carbohydrate, protein 103 g, fat remainder ≈ 105 g) or only fat (RF: carbohydrate 342 g, protein 103 g, fat remainder ≈ 15 g). ' +
    'A third arm `base` holds baseline for RQ/EE/BHB differences. RQ is not a recorded series: it is approximated from the CHO/fat oxidation series ' +
    '(non-protein RQ), so the RQ rows are Q (CONTRACT REQUEST: record a daily 24-h RQ). Cumulative-fat-loss and direction rows are the dossier tolerances (±60 g over 6 d).',
  arms: {
    rc: { label: 'RC', profile: HALL15.profile, schedule: constantSchedule(6, kcalProgram('rc', H15_KCAL, gramMacros(103, 140))) },
    rf: { label: 'RF', profile: HALL15.profile, schedule: constantSchedule(6, kcalProgram('rf', H15_KCAL, gramMacros(103, 342))) },
    base: { label: 'baseline', profile: HALL15.profile, schedule: constantSchedule(6, kcalProgram('base', 2740, gramMacros(103, 342))) },
  },
  expectations: [
    { id: 'fatRc', label: 'RC: cumulative fat loss over 6 d (245 ± 21 g)', unit: 'kg', measure: (c) => fatLossKg(c.arm('rc'), 6), check: val(0.245, 0.06), source: 'dossier 01 §7.5 (fat ±60 g / 6 d)' },
    { id: 'fatRf', label: 'RF: cumulative fat loss over 6 d (463 ± 37 g)', unit: 'kg', measure: (c) => fatLossKg(c.arm('rf'), 6), check: val(0.463, 0.06), source: 'dossier 01 §7.5 (fat ±60 g / 6 d)' },
    { id: 'rfMoreFat', label: 'RF loses more fat than RC (key finding)', unit: 'kg', measure: (c) => fatLossKg(c.arm('rf'), 6) - fatLossKg(c.arm('rc'), 6), check: above(0), source: 'dossier 01 §7.5' },
    { id: 'deficit', label: 'realised energy deficit vs baseline (−810 kcal/d)', unit: 'kcal/d', measure: (c) => c.arm('rc').mean('inEnergy', 0, 6) - c.arm('base').mean('inEnergy', 0, 6), check: val(-810, 25), source: 'dossier 01 §7.5 (deficit −810 kcal/d)' },
    { id: 'bwRc', label: 'RC: weight change day 6 (−1.85 kg)', unit: 'kg', measure: (c) => scaleDelta(c.arm('rc'), 6), check: val(-1.85, 0.45), gate: 'Q', source: 'dossier 01 §7.5' },
    { id: 'bwRf', label: 'RF: weight change day 6 (−1.30 kg)', unit: 'kg', measure: (c) => scaleDelta(c.arm('rf'), 6), check: val(-1.3, 0.45), gate: 'Q', source: 'dossier 01 §7.5' },
    { id: 'rqRc', label: 'RC: 24-h RQ change vs baseline (−0.055), non-protein approximation', unit: 'RQ', measure: (c) => rqNonProtein(c.arm('rc').day('choOxidation', 5), c.arm('rc').day('fatOxidation', 5)) - rqNonProtein(c.arm('base').day('choOxidation', 5), c.arm('base').day('fatOxidation', 5)), check: val(-0.055, 0.01), gate: 'Q', source: 'dossier 01 §7.5 (RQ ±0.01)' },
    { id: 'rqRf', label: 'RF: 24-h RQ change vs baseline (+0.005), non-protein approximation', unit: 'RQ', measure: (c) => rqNonProtein(c.arm('rf').day('choOxidation', 5), c.arm('rf').day('fatOxidation', 5)) - rqNonProtein(c.arm('base').day('choOxidation', 5), c.arm('base').day('fatOxidation', 5)), check: val(0.005, 0.01), gate: 'Q', source: 'dossier 01 §7.5 (RQ ±0.01)' },
    { id: 'eeRc', label: 'RC: 24-h EE change vs baseline, day 4-6 (−97.7 kcal/d)', unit: 'kcal/d', measure: (c) => c.arm('rc').mean('tdee', 3, 6) - c.arm('base').mean('tdee', 3, 6), check: val(-97.7, 50), gate: 'Q', source: 'dossier 01 §7.5 [43]', note: 'Tolerance not given: ±50 kcal/d assumed.' },
    { id: 'eeRf', label: 'RF: 24-h EE change vs baseline, day 4-6 (−49.6 kcal/d)', unit: 'kcal/d', measure: (c) => c.arm('rf').mean('tdee', 3, 6) - c.arm('base').mean('tdee', 3, 6), check: val(-49.6, 50), gate: 'Q', source: 'dossier 01 §7.5 [43]', note: 'Tolerance not given: ±50 kcal/d assumed.' },
    { id: 'bhbRc', label: 'RC: fasting BHB change vs baseline, day 6 (+0.088 mM)', unit: 'mmol/L', measure: (c) => c.arm('rc').day('bhb', 5) - c.arm('base').day('bhb', 5), check: val(0.088, 0.06), gate: 'Q', source: 'dossier 01 §7.5 [43]', note: 'Daily mean BHB, not the fasting sample.' },
  ],
};

// ------------------------------------------------------------------ 7.6 Hall 2016, isocaloric ketogenic diet

const HALL16 = person({ sex: 'male', ageYears: 34, heightCm: 178, weightKg: 95, bodyFatPct: 30 });

export const HALL2016: Scenario = {
  id: '01-7.6-hall2016',
  dossier: '01',
  target: '7.6',
  title: 'Hall 2016 isocaloric ketogenic diet, 4 wk BD then 4 wk KD',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Hall et al. 2016 Am J Clin Nutr 104:324 (PMID 27385608); dossier 01 §7.6',
  notes:
    '17 men with overweight/obesity: modelled as a 34-y man, 178 cm, 95 kg, 30 % BF (baseline body not in the dossier: assumption). Both phases isocaloric at ' +
    '90 % of maintenance (dossier: overall deficit ≈ 300 kcal/d); BD 15 % protein / 48.4 % carbohydrate / rest fat, KD 15 % protein / 5 % carbohydrate / rest fat ' +
    '(protein clamped in grams because energy is identical). Rows: KD must not lose fat faster than BD; EE difference 0-160 kcal/d (chamber +57, sleeping +89, DLW +151).',
  arms: {
    main: {
      profile: HALL16,
      schedule: segmentSchedule(
        [pctProgram('bd', 90, pctMacros(15, 48.4)), pctProgram('kd', 90, pctMacros(15, 5))],
        [
          { days: 28, program: 0 },
          { days: 28, program: 1 },
        ],
      ),
    },
  },
  expectations: [
    {
      id: 'noFasterFat',
      label: 'fat loss on KD (days 29-56) minus fat loss on BD (days 1-28)',
      unit: 'kg',
      measure: (c) => c.main.after('fatMass', 28) - c.main.after('fatMass', 56) - (c.main.initial('fatMass') - c.main.after('fatMass', 28)),
      check: below(0.1),
      source: 'dossier 01 §7.6 (KD must NOT produce faster fat loss)',
      note: '0.1 kg allows for noise-free model differences; the KD must not be faster.',
    },
    { id: 'eeDiff', label: 'EE difference KD (days 43-56) − BD (days 15-28)', unit: 'kcal/d', measure: (c) => c.main.mean('tdee', 42, 56) - c.main.mean('tdee', 14, 28), check: range(0, 160), source: 'dossier 01 §7.6 (0-160 kcal/d)' },
    { id: 'rqKd', label: 'RQ change KD − BD (−0.111), non-protein approximation', unit: 'RQ', measure: (c) => rqNonProtein(c.main.day('choOxidation', 55), c.main.day('fatOxidation', 55)) - rqNonProtein(c.main.day('choOxidation', 27), c.main.day('fatOxidation', 27)), check: val(-0.111, 0.03), gate: 'Q', source: 'dossier 01 §7.6 [44]' },
    { id: 'leanLoss', label: 'lean-tissue loss on KD exceeds BD (protein utilisation rose)', unit: 'kg', measure: (c) => c.main.after('leanTissue', 28) - c.main.after('leanTissue', 56) - (c.main.initial('leanTissue') - c.main.after('leanTissue', 28)), check: above(0), gate: 'Q', source: 'dossier 01 §7.6 [44]' },
  ],
};

// ------------------------------------------------------------------ 7.7a Bouchard 1990 / Tremblay 1992 twins, +1000 kcal/d x 84 d

const BOUCHARD = person({ sex: 'male', ageYears: 21, heightCm: 172, weightKg: 60.3, bodyFatPct: 11.4 }); // FM 6.9 kg
const bouT = tdee0Of(BOUCHARD);

export const BOUCHARD_OVERFEED: Scenario = {
  id: '01-7.7a-bouchard',
  dossier: '01',
  target: '7.7a',
  title: 'Bouchard 1990 / Tremblay 1992 overfeeding, +1000 kcal/d, 6 d/wk, 84 d in 100 d',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Bouchard et al. 1990 N Engl J Med 322:1477 (PMID 2336074); Tremblay 1992 Am J Clin Nutr 56:857; Hall 2010 PLoS One / BJN simulation; dossier 01 §7.7a',
  notes:
    '12 MZ male pairs, baseline BW 60.3 kg with FM 6.9 kg (Hall 2010 simulation inputs), age ≈ 21. Surplus = habitual intake + 1 000 kcal/d on 6 of every 7 days for ' +
    '84 days, the remaining 16 days at maintenance, 100 days in total (measured +8.1 kg, range 4.3-13.3; Hall 2010 simulation 60.3 → 69.7 kg).',
  arms: {
    main: {
      profile: BOUCHARD,
      schedule: buildSchedule({
        days: 100,
        programs: [kcalProgram('over', Math.round(bouT + 1000), neutralMacros('male')), pctProgram('rest', 100, neutralMacros('male'))],
        use: (d) => (d < 98 && d % 7 !== 6 ? 0 : 1),
      }),
    },
  },
  expectations: [
    { id: 'bw', label: 'weight change after 100 d (+8.1 kg)', unit: 'kg', measure: (c) => scaleDelta(c.main, 100), check: val(8.1, 1.5), source: 'dossier 01 §7.7a (BW ±1.5 kg)' },
    { id: 'fm', label: 'fat-mass change after 100 d (measured +5.4 kg: 6.9 → 12.3)', unit: 'kg', measure: (c) => c.main.delta('fatMass', 100), check: val(5.4, 1.5), gate: 'Q', source: 'dossier 01 §7.7a' },
    { id: 'rmr', label: 'resting metabolic rate after 100 d (1 793 ± 190 kcal/d)', unit: 'kcal/d', measure: (c) => c.main.after('rmr', 100), check: val(1793, 190), gate: 'Q', source: 'dossier 01 §7.7a [1]' },
    { id: 'stored', label: 'share of the surplus stored (Tremblay: 222 of 353 MJ = 63 %)', unit: '%', measure: (c) => (100 * storedEnergyKcal(c.main, 100)) / (84 * 1000), check: val(63, 12), gate: 'Q', source: 'dossier 01 §7.7a [82]' },
  ],
};

// ------------------------------------------------------------------ 7.7b Diaz 1992, +50 % for 42 d

const DIAZ = person({ sex: 'male', ageYears: 30, heightCm: 178, weightKg: 75, bodyFatPct: 20 });
/**
 * Finisher fixture fix 2026-09-30: the study's absolute surplus (+6.2 MJ/d ≈ +1 482 kcal/d) at its 12/42/46 %E P/C/F
 * (dossier 11 §4 table), on top of the persona's maintenance; 150 % of this persona's TDEE0 was only +1 214 kcal/d.
 */
const DIAZ_SURPLUS_KCAL = Math.round(6200 / 4.184);

export const DIAZ_OVERFEED: Scenario = {
  id: '01-7.7b-diaz',
  dossier: '01',
  target: '7.7b',
  title: 'Diaz 1992 overfeeding +50 % for 42 d',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Diaz et al. 1992 Am J Clin Nutr 56:641 (PMID 1414962); dossier 01 §7.7b',
  notes: '6 lean + 3 overweight men, +50 % (6.2 MJ/d) for 42 d: +7.6 ± 1.6 kg, 58 ± 18 % fat, BMR +0.9 MJ/d. Modelled as a 30-y man, 178 cm, 75 kg, 20 % BF, at maintenance + 6.2 MJ/d with the study\'s 12/42/46 %E P/C/F.',
  arms: { main: { profile: DIAZ, schedule: constantSchedule(42, kcalProgram('over50', Math.round(tdee0Of(DIAZ) + DIAZ_SURPLUS_KCAL), pctMacros(12, 42))) } },
  expectations: [
    { id: 'bw', label: 'weight change after 42 d (+7.6 ± 1.6 kg)', unit: 'kg', measure: (c) => scaleDelta(c.main, 42), check: val(7.6, 1.5), source: 'dossier 01 §7.7b (BW ±1.5 kg)' },
    { id: 'fatShare', label: 'fat share of the weight gain (58 ± 18 %)', unit: '%', measure: (c) => (100 * c.main.delta('fatMass', 42)) / scaleDelta(c.main, 42), check: val(58, 18), gate: 'Q', source: 'dossier 01 §7.7b [57]' },
    { id: 'bmr', label: 'BMR change after 42 d (+0.9 MJ/d = +215 kcal/d)', unit: 'kcal/d', measure: (c) => c.main.after('rmr', 42) - c.main.profile.rmr0Kcal, check: val(215, 100), gate: 'Q', source: 'dossier 01 §7.7b [57]', note: 'Tolerance not given: ±100 kcal/d assumed.' },
  ],
};

// ------------------------------------------------------------------ 7.7d Bray 2012 protein overfeeding, +954 kcal/d for 8 wk

const BRAY = person({ sex: 'male', ageYears: 26, heightCm: 176, weightKg: 75 });
const brayT = tdee0Of(BRAY);
/** Bray diets: fat 40 %E in all arms, protein 5/15/25 %E, carbohydrate the remainder (minus ≈ 1.6 %E for the fibre energy). */
const brayProg = (id: string, protein: number) => kcalProgram(id, Math.round(brayT + 954), pctMacros3(protein, 100 - 40 - 1.6 - protein, 40));

export const BRAY2012: Scenario = {
  id: '01-7.7d-bray2012',
  dossier: '01',
  target: '7.7d',
  title: 'Bray 2012 low/normal/high-protein overfeeding, +954 kcal/d for 8 wk',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Bray et al. 2012 JAMA 307:47 (PMID 22215165); dossier 01 §7.7d, 02 V2 (R-BRAY), 11 §4.15',
  notes:
    '25 adults, 8 wk at habitual + 954 kcal/d, protein 5 / 15 / 25 %E at fat 40 %E. Modelled as a 26-y man, 176 cm, 75 kg (BMI 24). Gate per §9.2: weight and REE rows M, ' +
    'except the 5 % protein weight arm K (dossier 11: "Bray 5 % arm K"); lean rows Q (no tolerance in the dossier, ±1 kg assumed).',
  arms: {
    low: { label: '5 % protein', profile: BRAY, schedule: constantSchedule(56, brayProg('low', 5)) },
    normal: { label: '15 % protein', profile: BRAY, schedule: constantSchedule(56, brayProg('normal', 15)) },
    high: { label: '25 % protein', profile: BRAY, schedule: constantSchedule(56, brayProg('high', 25)) },
  },
  expectations: [
    { id: 'bwLow', label: '5 % protein: weight change (+3.16 kg)', unit: 'kg', measure: (c) => scaleDelta(c.arm('low'), 56), check: val(3.16, 1.5), gate: 'K', source: 'dossier 01 §7.7d; §9.2 dossier 11 (5 % arm K)' },
    { id: 'bwNormal', label: '15 % protein: weight change (+6.05 kg)', unit: 'kg', measure: (c) => scaleDelta(c.arm('normal'), 56), check: val(6.05, 1.5), source: 'dossier 01 §7.7d (±1.5 kg)' },
    { id: 'bwHigh', label: '25 % protein: weight change (+6.51 kg)', unit: 'kg', measure: (c) => scaleDelta(c.arm('high'), 56), check: val(6.51, 1.5), source: 'dossier 01 §7.7d (±1.5 kg)' },
    { id: 'leanNormal', label: '15 % protein: lean-mass change (+2.87 kg)', unit: 'kg', measure: (c) => c.arm('normal').delta('leanMass', 56), check: val(2.87, 1), gate: 'Q', source: 'dossier 01 §7.7d [60]' },
    { id: 'leanHigh', label: '25 % protein: lean-mass change (+3.18 kg)', unit: 'kg', measure: (c) => c.arm('high').delta('leanMass', 56), check: val(3.18, 1), gate: 'Q', source: 'dossier 01 §7.7d [60]' },
    { id: 'leanLow', label: '5 % protein: lean-mass change (≈ 0 kg)', unit: 'kg', measure: (c) => c.arm('low').delta('leanMass', 56), check: val(0, 1), gate: 'Q', source: 'dossier 01 §7.7d [60]' },
    { id: 'fatSimilar', label: 'fat gain similar across arms (25 % minus 5 % arm)', unit: 'kg', measure: (c) => c.arm('high').delta('fatMass', 56) - c.arm('low').delta('fatMass', 56), check: range(-1, 1), gate: 'Q', source: 'dossier 01 §7.7d [60]' },
    { id: 'reeLow', label: '5 % protein: REE change (≈ 0 kcal/d)', unit: 'kcal/d', measure: (c) => c.arm('low').after('rmr', 56) - c.arm('low').profile.rmr0Kcal, check: val(0, 60), source: 'dossier 02 V2 (±60, R-BRAY)' },
    { id: 'reeNormal', label: '15 % protein: REE change (+160 kcal/d)', unit: 'kcal/d', measure: (c) => c.arm('normal').after('rmr', 56) - c.arm('normal').profile.rmr0Kcal, check: val(160, 60), source: 'dossier 02 V2 (±60, R-BRAY)' },
    { id: 'reeHigh', label: '25 % protein: REE change (+227 kcal/d)', unit: 'kcal/d', measure: (c) => c.arm('high').after('rmr', 56) - c.arm('high').profile.rmr0Kcal, check: val(227, 60), source: 'dossier 02 V2 (±60, R-BRAY)' },
  ],
};

// ------------------------------------------------------------------ 7.8 Friedlander 2005 (Q)

const FRIED = person({ sex: 'male', ageYears: 24, heightCm: 178, weightKg: 76, bodyFatPct: 15 });
const friedProtein = resolveProfile(FRIED).habitualProteinG;

export const FRIEDLANDER: Scenario = {
  id: '01-7.8-friedlander',
  dossier: '01',
  target: '7.8',
  title: 'Friedlander 2005, 3 wk at −40 % energy with protein maintained',
  level: 'I',
  gate: 'Q',
  requires: CORE,
  citation: 'Friedlander et al. 2005 J Appl Physiol 99:2254 (PMID 15774701, dossier ref [81]); dossier 01 §7.8',
  notes: 'Qualitative row (§9.2: "7.8 Q"). ≈ 4 kg lost, slightly under half as fat, negative N balance despite maintained protein. Modelled as a 24-y man, 178 cm, 76 kg, 15 % BF; protein held at the habitual grams.',
  arms: { main: { profile: FRIED, schedule: constantSchedule(21, pctProgram('minus40', 60, { protein: { unit: 'g', value: friedProtein }, carbs: { unit: 'pctEnergy', value: 45 }, fat: { unit: 'remainder' } })) } },
  expectations: [
    { id: 'bw', label: 'weight lost in 3 wk (≈ 4 kg)', unit: 'kg', measure: (c) => -scaleDelta(c.main, 21), check: val(4, 1.2), source: 'dossier 01 §7.8' },
    { id: 'fatShare', label: 'fat share of the weight lost (slightly under half)', unit: 'fraction', measure: (c) => fatLossKg(c.main, 21) / -scaleDelta(c.main, 21), check: range(0.3, 0.5), source: 'dossier 01 §7.8' },
    { id: 'nBalance', label: 'nitrogen balance negative, days 8-21', unit: 'g N/d', measure: (c) => c.main.mean('nitrogenBalance', 7, 21), check: below(0), source: 'dossier 01 §7.8' },
  ],
};

export const SCENARIOS_01: Scenario[] = [MINNESOTA, JEBB, CALERIE1, CALERIE2, HALL2015, HALL2016, BOUCHARD_OVERFEED, DIAZ_OVERFEED, BRAY2012, FRIEDLANDER];
