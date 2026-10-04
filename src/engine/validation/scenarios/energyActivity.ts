/**
 * Dossiers 02 (energy expenditure and adaptation), 10 (cardio and activity expenditure) and 11 (overfeeding and surplus
 * partitioning): the end-to-end targets of MODEL_SPEC §9.2 rows 02, 10 and 11. Dossier 01's Bouchard, Diaz, Bray and Jebb
 * arms are shared from `d01.ts` where the dossiers add tolerances of their own.
 *
 * Conventions: intake is either an absolute kcal figure (studies that prescribe energy) or a % of the engine baseline
 * maintenance; "compensation" studies (10 V6, V8) feed the measured intake, not an appetite model (ad libitum intake is an
 * output only in v1, MODEL_SPEC §11.1). Every mapping and assumption is stated in `notes`.
 */
import { resolveProfile } from '../../core/resolveProfile';
import type { ExerciseSession, PersonProfile } from '../../types';
import { person, tdee0Of } from '../fixtures/personas';
import {
  buildSchedule,
  cardioSession,
  constantSchedule,
  kcalProgram,
  neutralMacros,
  pctMacros,
  pctMacros3,
  pctProgram,
  segmentSchedule,
  trainingSchedule,
} from '../fixtures/programs';
import { above, below, range, rel, val } from '../harness/run';
import { REQUIRES } from '../harness/stubs';
import type { ArmSpec, Scenario } from '../harness/types';
import type { ArmView } from '../harness/view';
import { BOUCHARD_OVERFEED, BRAY2012, CALERIE1, HALL2016, JEBB } from './d01';
import { fatLossKg, meanTdee, scaleDelta, storedEnergyKcal } from './util';

const CORE = REQUIRES.CORE;
const AT_BALANCE = { kind: 'pctMaintenance', pct: 100, reference: 'current' } as const;

// =====================================================================================================================
// Dossier 02 §7
// =====================================================================================================================

// ---- V1 Levine 1999

const LEVINE = person({ sex: 'male', ageYears: 30, heightCm: 178, weightKg: 72, bodyFatPct: 18 });
const levineT = tdee0Of(LEVINE);

export const D02_V1_LEVINE: Scenario = {
  id: '02-V1-levine-1999-overfeeding',
  dossier: '02',
  target: 'V1',
  title: 'Levine 1999: +1 000 kcal/d for 56 d in non-obese adults (TEE, NEAT, weight)',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Levine, Eberhardt & Jensen 1999 Science 283:212 (PMID 9880251); dossier 02 §7 V1, dossier 11 §7 item 6',
  notes:
    '16 non-obese adults, +1 000 kcal/d (20/40/40 %E protein/fat/carbohydrate) for 56 d, free living. Average non-obese adult: a 30-y man, 178 cm, 72 kg, 18 % BF (assumption). Energy = baseline maintenance + 1 000 kcal/d. ' +
    'Dossier: engine ΔTEE +350-550 kcal/d with tolerance ±150 kcal/d (target 450 ± 150); weight +4.7 ± 1.8 kg with tolerance ±1.5 kg. Levine\'s cohort was a high-NEAT-responder sample, so the NEAT/BMR/DIT breakdown ' +
    '(+330 ± 258 / +79 ± 127 / +139 ± 84 kcal/d) is Q with the study SDs as bands.',
  arms: { main: { profile: LEVINE, schedule: constantSchedule(56, kcalProgram('levine', Math.round(levineT + 1000), pctMacros3(20, 38.4, 40))) } },
  expectations: [
    { id: 'tee', label: 'TEE change over days 42-56 vs baseline maintenance (+350-550 kcal/d)', unit: 'kcal/d', measure: (c) => meanTdee(c.main, 41, 56) - c.main.profile.tdee0Kcal, check: val(450, 150), source: 'dossier 02 V1 (TEE ±150 kcal/d)' },
    { id: 'bw', label: 'weight change after 56 d (+4.7 ± 1.8 kg)', unit: 'kg', measure: (c) => scaleDelta(c.main, 56), check: val(4.7, 1.5), source: 'dossier 02 V1 (weight ±1.5 kg)' },
    { id: 'neat', label: 'NEAT change (+330 ± 258 kcal/d)', unit: 'kcal/d', measure: (c) => c.main.mean('neat', 41, 56) - c.main.mean('neat', 0, 1), check: val(330, 258), gate: 'Q', source: 'dossier 02 V1', note: 'High-responder cohort; the study SD is the Q band.' },
    { id: 'bmr', label: 'BMR change (+79 ± 127 kcal/d)', unit: 'kcal/d', measure: (c) => c.main.mean('rmr', 41, 56) - c.main.profile.rmr0Kcal, check: val(79, 127), gate: 'Q', source: 'dossier 02 V1' },
    { id: 'tef', label: 'DIT change (+139 ± 84 kcal/d)', unit: 'kcal/d', measure: (c) => c.main.mean('tef', 41, 56) - c.main.mean('tef', 0, 1), check: val(139, 84), gate: 'Q', source: 'dossier 02 V1', note: 'The first day carries no overfeeding difference in the tef baseline used here.' },
  ],
};

// ---- V3 Hall 2016 (arm of 01-7.6) TEE difference

export const D02_V3_HALL2016: Scenario = {
  id: '02-V3-hall2016-tee',
  dossier: '02',
  target: 'V3',
  title: 'Hall 2016 isocaloric ketogenic diet: expenditure difference −30 … +100 kcal/d',
  level: 'I',
  gate: 'M',
  requires: REQUIRES.FASTING,
  citation: 'Hall et al. 2016 Am J Clin Nutr 104:324 (dossier 02 refs [84,85]); dossier 02 §7 V3',
  notes: 'Arm of 01-7.6 (28 d BD then 28 d KD at 90 % of maintenance). Observed chamber EE +57 ± 13 (re-analysed +24 ± 30), SEE +89 ± 14 kcal/d; dossier 02 accepts −30 to +100 kcal/d with κ_CHO = 0 (01-7.6 uses the wider 0-160).',
  arms: HALL2016.arms,
  expectations: [{ id: 'dTee', label: 'expenditure KD (days 43-56) − BD (days 15-28) (−30 … +100 kcal/d)', unit: 'kcal/d', measure: (c) => meanTdee(c.main, 42, 56) - meanTdee(c.main, 14, 28), check: range(-30, 100), source: 'dossier 02 V3' }],
};

// ---- V4 CALERIE-1 adaptive thermogenesis (arm of 01-7.3)

export const D02_V4_CALERIE1: Scenario = {
  id: '02-V4-calerie1-adaptive-thermogenesis',
  dossier: '02',
  target: 'V4',
  title: 'CALERIE-1 (Heilbronn 2006 / Redman 2009): adaptive thermogenesis at 25 % restriction for 6 months',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Heilbronn et al. 2006, Redman et al. 2009 (dossier 02 refs [69,71]); dossier 02 §7 V4',
  notes:
    'The 25 % CR arm of 01-7.3. Observed weight −10.4 ± 0.9 % (asserted in 01-7.3), sedentary 24-h EE beyond composition −135 ± 42, composition-adjusted TDEE −240 ± 83 kcal/d at M6. Dossier engine range: AT_R + AT_N within −100 to −350 kcal/d ' +
    '(`metabolicAdaptation` is the total AT_R + AT_N); the "AT_R + ΔTEF −60 to −200" split needs AT_R separately and is not encoded (CONTRACT REQUEST: record AT_R and AT_N separately).',
  arms: { main: CALERIE1.arms['cr'] as ArmSpec },
  expectations: [{ id: 'at', label: 'AT_R + AT_N at month 6 (−100 … −350 kcal/d)', unit: 'kcal/d', measure: (c) => c.main.after('metabolicAdaptation', 182), check: range(-350, -100), source: 'dossier 02 V4' }],
};

// ---- V5 Martins 2020

const MARTINS = person({ sex: 'male', ageYears: 45, heightCm: 170, weightKg: 105, extra: { sexUnspecified: true } });

export const D02_V5_MARTINS: Scenario = {
  id: '02-V5-martins-2020',
  dossier: '02',
  target: 'V5',
  title: 'Martins 2020: 1 000 kcal/d for 8 wk (−14 kg) then 4 wk of weight stabilisation',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Martins et al. 2020 Am J Clin Nutr (dossier 02 ref [62]); dossier 02 §7 V5',
  notes:
    '71 obese adults: a sex-unspecified 45-y adult, 170 cm, 105 kg (BMI 36; assumption). 1 000 kcal/d for 56 d, then 28 d at 100 % of the CURRENT maintenance (weight stabilisation). Observed RMR-AT −92 ± 110 (W9) → −38 ± 124 kcal/d (W13); dossier: engine AT_R −60 to −120 at W9 and ' +
    '≥ 40 % smaller at W13. `metabolicAdaptation` is the total AT_R + AT_N, so the W9 range row is Q (the split is a CONTRACT REQUEST); the W13/W9 ratio ≤ 0.6 is gated (the total relaxes at least as fast as AT_R over 4 weeks of maintenance).',
  arms: { main: { profile: MARTINS, schedule: segmentSchedule([kcalProgram('vlcd', 1000, pctMacros(25, 45)), pctProgram('stabilise', 100, neutralMacros('male'), {}, 'current')], [{ days: 56, program: 0 }, { days: 28, program: 1 }]) } },
  expectations: [
    { id: 'w9', label: 'adaptive thermogenesis at week 9 (−60 … −120 kcal/d; observed −92 ± 110)', unit: 'kcal/d', measure: (c) => c.main.after('metabolicAdaptation', 56), check: range(-120, -60), gate: 'Q', source: 'dossier 02 V5', note: 'Total AT compared with an AT_R range: Q until AT_R is a series.' },
    { id: 'recovery', label: 'AT at week 13 / AT at week 9 (≤ 0.6, "≥ 40 % smaller")', unit: 'ratio', measure: (c) => c.main.after('metabolicAdaptation', 84) / c.main.after('metabolicAdaptation', 56), check: below(0.6), source: 'dossier 02 V5' },
    { id: 'loss', label: 'weight lost in 8 wk (≈ 14 kg)', unit: 'kg', measure: (c) => -scaleDelta(c.main, 56), check: val(14, 3), gate: 'Q', source: 'dossier 02 V5', note: 'Band ±3 kg assumed.' },
  ],
};

// ---- V6 Biggest Loser (Q)

const BIGLOSER = person({ sex: 'male', ageYears: 38, heightCm: 178, weightKg: 155, extra: {} }); // BMI 48.9
const blExercise: ExerciseSession[] = [cardioSession('other', 7, 90, { met: 7.5 }), cardioSession('other', 16, 90, { met: 7.5 })];

export const D02_V6_BIGGEST_LOSER: Scenario = {
  id: '02-V6-biggest-loser',
  dossier: '02',
  target: 'V6',
  title: 'Biggest Loser (Johannsen 2012 / Fothergill 2016): severe obesity, vigorous exercise + restriction, 30 wk',
  level: 'I',
  gate: 'Q',
  requires: CORE,
  citation: 'Johannsen et al. 2012, Fothergill et al. 2016 (dossier 02 refs [57,58]); dossier 02 §7 V6',
  notes:
    'Severe obesity (BMI 49): a 38-y man, 178 cm, 155 kg. The dossier gives outcomes (−38 % weight at 30 wk, 17 % of the loss FFM, RMR adaptation −504 ± 171 kcal/d at week 30) but not the intake or exercise dose: 2 × 90 min of vigorous cardio (7.5 MET) daily and 1 500 kcal/d ' +
    'are ASSUMED, hence Q. Engine expectation (AT_R + C_comp): −300 to −650 kcal/d; the total AT series is compared. Without C_comp the model must under-predict (Hall 2022).',
  arms: { main: { profile: BIGLOSER, schedule: buildSchedule({ days: 210, programs: [pctProgram('bl', 100, neutralMacros('male'), { exercise: blExercise })].map((p) => ({ ...p, energy: { kind: 'kcal' as const, kcal: 1500 } })), use: 0 }) } },
  expectations: [
    { id: 'loss', label: 'weight change at 30 wk (−38 %)', unit: '%', measure: (c) => c.main.pct('scaleWeight', 210), check: val(-38, 8), source: 'dossier 02 V6', note: 'Band ±8 points assumed (intake and exercise dose assumed).' },
    { id: 'at', label: 'adaptive thermogenesis at week 30 (−300 … −650 kcal/d; observed −504 ± 171)', unit: 'kcal/d', measure: (c) => c.main.after('metabolicAdaptation', 210), check: range(-650, -300), source: 'dossier 02 V6' },
  ],
};

// ---- V7 MATADOR vs ICECAP (Q)

const ICECAP = person({ sex: 'male', ageYears: 28, heightCm: 178, weightKg: 82, bodyFatPct: 20, trainingYears: 3, trainingHistory: '1to3y', sessionsPerWeek: 3, liftingCardioMix: 0 });
const icecap = (blocks: readonly ('er' | 'bal')[]): ArmSpec => ({
  profile: ICECAP,
  schedule: buildSchedule({
    days: blocks.length * 7,
    programs: [pctProgram('er', 75, neutralMacros('male'), {}, 'blockStart'), pctProgram('balance', 100, neutralMacros('male'), {}, 'blockStart')],
    use: (d) => (blocks[Math.floor(d / 7)] === 'er' ? 0 : 1),
    blocks: blocks.map((_, i) => ({ name: `wk${i}`, startDay: 7 * i, endDay: 7 * (i + 1) })),
  }),
});
const CONT12: ('er' | 'bal')[] = Array.from({ length: 12 }, () => 'er');
const INT15: ('er' | 'bal')[] = ['er', 'er', 'er', 'bal', 'er', 'er', 'er', 'bal', 'er', 'er', 'er', 'bal', 'er', 'er', 'er'];

export const D02_V7_ICECAP: Scenario = {
  id: '02-V7-icecap-intermittent',
  dossier: '02',
  target: 'V7',
  title: 'ICECAP (Peos 2021): 12 wk continuous restriction vs 3 wk restriction / 1 wk balance blocks',
  level: 'I',
  gate: 'Q',
  requires: CORE,
  citation: 'Byrne 2018 MATADOR, Peos 2021 ICECAP (dossier 02 refs [75,76]); dossier 02 §7 V7 ("treat MATADOR as out-of-tolerance-allowed"); MATADOR itself is 13-V8',
  notes:
    'Resistance-trained man (28 y, 178 cm, 82 kg, 20 % BF), 75 % of the block-start maintenance in restriction weeks and 100 % in balance weeks; intermittent = restriction ×3 weeks + balance ×1 week (three cycles plus 3 weeks, 15 weeks), continuous = 12 restriction weeks. ' +
    'Dossier: ICECAP shows ≈ no difference (FM 15.3 vs 18.0 kg, p = 0.32); a modest difference in fat loss per restriction week (≤ 1-2 kg) is tolerated. Q rows only.',
  arms: { cont: icecap(CONT12), int: icecap(INT15) },
  expectations: [
    { id: 'fatDiff', label: 'fat loss, continuous minus intermittent (|difference| ≤ 1.5 kg; ≈ 0)', unit: 'kg', measure: (c) => fatLossKg(c.arm('cont'), 84) - fatLossKg(c.arm('int'), 105), check: range(-1.5, 1.5), source: 'dossier 02 V7 (≤ 1-2 kg per ER-week, ICECAP ≈ 0)' },
    { id: 'atSmaller', label: 'AT is smaller in the intermittent arm at the end of its last balance week (direction, AT_int − AT_cont > 0)', unit: 'kcal/d', measure: (c) => c.arm('int').after('metabolicAdaptation', 105) - c.arm('cont').after('metabolicAdaptation', 84), check: above(0), source: 'dossier 02 V7 (direction: smaller AT in intermittent)' },
  ],
};

// ---- V8 Leibel 1995 (K)

const LEIBEL = person({ sex: 'male', ageYears: 30, heightCm: 178, weightKg: 75, bodyFatPct: 15 });

export const D02_V8_LEIBEL: Scenario = {
  id: '02-V8-leibel-1995',
  dossier: '02',
  target: 'V8',
  title: 'Leibel 1995: TEE per kg FFM at −10 % and +10 % maintained weight (known discrepancy)',
  level: 'I',
  gate: 'K',
  requires: CORE,
  citation: 'Leibel, Rosenbaum & Hirsch 1995 N Engl J Med 332:621 (dossier 02 ref [53]); dossier 02 §7 V8 (§9.2: K)',
  notes:
    'Non-obese man (30 y, 178 cm, 75 kg, 15 % BF). −10 %: 42 d at 65 % of maintenance, then 42 d at 100 % of the CURRENT maintenance; +10 %: 35 d at 125 %, then 42 d at 100 % of the current maintenance. The expenditure beyond composition is the ' +
    'total adaptive thermogenesis (`metabolicAdaptation`) per kg FFM at the end of the maintenance phase; published −6 to −8 kcal/kg FFM/d at −10 %, +8 to +9 at +10 %. Known discrepancy: the default β_AT gives ≈ −1 ("do not tune to this dataset"). ' +
    'The phase lengths are assumptions (the weight-loss durations are not in the dossier).',
  arms: {
    minus10: { profile: LEIBEL, schedule: segmentSchedule([pctProgram('lose', 65, neutralMacros('male')), pctProgram('hold', 100, neutralMacros('male'), {}, 'current')], [{ days: 42, program: 0 }, { days: 42, program: 1 }]) },
    plus10: { profile: LEIBEL, schedule: segmentSchedule([pctProgram('gain', 125, neutralMacros('male')), pctProgram('hold', 100, neutralMacros('male'), {}, 'current')], [{ days: 35, program: 0 }, { days: 42, program: 1 }]) },
  },
  expectations: [
    { id: 'minus10', label: '−10 %: AT per kg FFM at the end of maintenance (−6 … −8 kcal/kg FFM/d)', unit: 'kcal/kg FFM/d', measure: (c) => c.arm('minus10').after('metabolicAdaptation', 84) / c.arm('minus10').profile.ffm0Kg, check: range(-8, -6), source: 'dossier 02 V8' },
    { id: 'plus10', label: '+10 %: AT per kg FFM at the end of maintenance (+8 … +9 kcal/kg FFM/d)', unit: 'kcal/kg FFM/d', measure: (c) => c.arm('plus10').after('metabolicAdaptation', 77) / c.arm('plus10').profile.ffm0Kg, check: range(8, 9), source: 'dossier 02 V8' },
  ],
};

// ---- V9 Ohkawara 2011

const OHKAWARA = person({ sex: 'male', ageYears: 30, heightCm: 172, weightKg: 64.5 });
const ohkT = tdee0Of(OHKAWARA);

export const D02_V9_OHKAWARA: Scenario = {
  id: '02-V9-ohkawara-steps',
  dossier: '02',
  target: 'V9',
  title: 'Ohkawara 2011: +20 615 steps/d raise 24-h EE by 588 kcal/d (64.5-kg men)',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Ohkawara et al. 2011 (dossier 02 ref [48]); dossier 02 §7 V9',
  notes: '64.5-kg men: a 30-y man, 172 cm, 64.5 kg; 7 000 habitual + 20 615 = 27 615 steps/d at unchanged intake (baseline maintenance, kcal). TEE change over days 2-3 vs TDEE0; ±15 %.',
  arms: { main: { profile: OHKAWARA, schedule: constantSchedule(3, kcalProgram('steps', Math.round(ohkT), neutralMacros('male'), { steps: 27615 })) } },
  expectations: [{ id: 'ee', label: '24-h EE change with +20 615 steps (+588 kcal/d)', unit: 'kcal/d', measure: (c) => c.main.mean('tdee', 1, 3) - c.main.profile.tdee0Kcal, check: rel(588, 0.15), source: 'dossier 02 V9 (±15 %)' }],
};

// ---- V10 Mikkelsen 2000

const MIKKELSEN = person({ sex: 'male', ageYears: 30, heightCm: 180, weightKg: 78 });
const mikArm = (proteinPct: number): ArmSpec => ({ profile: MIKKELSEN, schedule: constantSchedule(4, pctProgram(`p${proteinPct}`, 100, pctMacros(proteinPct, 55 - (proteinPct - 12.5)))) });

export const D02_V10_MIKKELSEN: Scenario = {
  id: '02-V10-mikkelsen-protein-tee',
  dossier: '02',
  target: 'V10',
  title: 'Mikkelsen 2000: 4 d isoenergetic, +17-18 %E protein replacing carbohydrate raises 24-h EE by 118 kcal/d',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Mikkelsen et al. 2000 Am J Clin Nutr (dossier 02 ref [94]); dossier 02 §7 V10',
  notes: 'A 30-y man, 180 cm, 78 kg at 100 % of maintenance for 4 d; control 12.5 % protein / 55 % carbohydrate vs high protein 30 % / 37.5 % (+17.5 %E from carbohydrate). 24-h EE difference over days 2-4: +80 to +120 kcal/d (dossier engine expectation; observed +118, +3.9 %).',
  arms: { control: mikArm(12.5), high: mikArm(30) },
  expectations: [{ id: 'dEE', label: '24-h EE, high − control protein (+80 … +120 kcal/d)', unit: 'kcal/d', measure: (c) => meanTdee(c.arm('high'), 1, 4) - meanTdee(c.arm('control'), 1, 4), check: range(80, 120), source: 'dossier 02 V10' }],
};

// =====================================================================================================================
// Dossier 10 §7
// =====================================================================================================================

const at75 = (kg: number): PersonProfile => person({ sex: 'male', ageYears: 35, heightCm: 178, weightKg: kg, bodyFatPct: 20 });
/** Net exercise energy of one day: the day's exerciseEE minus a no-exercise day. */
const netDay = (v: ArmView, exDay: number, restDay: number): number => v.day('exerciseEE', exDay) - v.day('exerciseEE', restDay);

// ---- V1 / V2 walking and running energy

const WALKER = at75(75);

export const D10_V2_WALK: Scenario = {
  id: '10-V2-walking-5kmh-60min',
  dossier: '10',
  target: 'V2',
  title: 'Level walking at 5 km/h for 60 min, 75-kg adult (Compendium 299 kcal gross, Ludlow 228 net)',
  level: 'I',
  gate: 'M',
  requires: REQUIRES.CORE,
  citation: 'Herrmann 2024, Ludlow & Weyand 2016, Weyand 2013 (dossier 10 refs [Herrmann24][Ludlow16][Weyand13]); dossier 10 §7 V2',
  notes: 'A 75-kg 35-y man; day 1 has one 60-min walk at 5 km/h, day 0 and day 2 none; the net exercise energy is `exerciseEE` of day 1 minus day 0 (net of RMR, incl. any post-exercise excess). Ludlow net 228 kcal ±10 % (gross 299 = net + 71 kcal RMR).',
  arms: {
    main: {
      profile: WALKER,
      schedule: buildSchedule({
        days: 3,
        programs: [pctProgram('rest', 100, neutralMacros('male')), pctProgram('walk', 100, neutralMacros('male'), { exercise: [cardioSession('walk', 17, 60, { speedKmh: 5 })] })],
        use: [1, 0, 1],
      }),
    },
  },
  expectations: [{ id: 'net', label: 'net exercise energy of the walk (228 kcal net)', unit: 'kcal', measure: (c) => netDay(c.main, 0, 1), check: rel(228, 0.1), source: 'dossier 10 V2 (±10 %)' }],
};

const W71 = at75(71);
export const D10_V1_WALK_RUN: Scenario = {
  id: '10-V1-wilkin-walk-run',
  dossier: '10',
  target: 'V1',
  title: 'Wilkin 2012: 1 600 m walked at 86 m/min and run at 160 m/min, 71-kg adults (gross EE 372.5 / 471 kJ)',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Wilkin et al. 2012 (dossier 10 ref [Wilkin12]); dossier 10 §7 V1',
  notes:
    '1 600 m at 86 m/min = 18.6 min at 5.16 km/h; at 160 m/min = 10 min at 9.6 km/h; 71-kg man. Gross EE = net exercise energy (exerciseEE difference to a rest day) + RMR for the duration (RMR0/1 440 per minute): 372.5 kJ = 89.0 kcal (walk), 471 kJ = 112.6 kcal (run), ±15 %.',
  arms: {
    walk: { profile: W71, schedule: buildSchedule({ days: 3, programs: [pctProgram('rest', 100, neutralMacros('male')), pctProgram('walk', 100, neutralMacros('male'), { exercise: [cardioSession('walk', 17, 18.6, { speedKmh: 5.16 })] })], use: [1, 0, 1] }) },
    run: { profile: W71, schedule: buildSchedule({ days: 3, programs: [pctProgram('rest', 100, neutralMacros('male')), pctProgram('run', 100, neutralMacros('male'), { exercise: [cardioSession('run', 17, 10, { speedKmh: 9.6 })] })], use: [1, 0, 1] }) },
  },
  expectations: [
    { id: 'walk', label: 'walk: gross EE of the bout (89.0 kcal)', unit: 'kcal', measure: (c) => netDay(c.arm('walk'), 0, 1) + (c.arm('walk').profile.rmr0Kcal / 1440) * 18.6, check: rel(89.0, 0.15), source: 'dossier 10 V1 (gross ±15 %)' },
    { id: 'run', label: 'run: gross EE of the bout (112.6 kcal)', unit: 'kcal', measure: (c) => netDay(c.arm('run'), 0, 1) + (c.arm('run').profile.rmr0Kcal / 1440) * 10, check: rel(112.6, 0.15), source: 'dossier 10 V1 (gross ±15 %)' },
  ],
};

// ---- V6 Martin 2019 (TIGER): 8 vs 20 kcal/kg/wk supervised aerobic exercise

const MARTIN = person({ sex: 'female', ageYears: 45, heightCm: 165, weightKg: 86, bodyFatPct: 40 }); // BMI 31.6
const martT = tdee0Of(MARTIN);
/** Net kcal of one session = (MET − 1)·kg·h; MET 6.3 for 30 min (8 kcal/kg/wk in 3 sessions) and 45 min (20 kcal/kg/wk in 5 sessions). */
const martinArm = (sessions: number, minutes: number, intakeExtra: number): ArmSpec => ({
  profile: MARTIN,
  schedule: trainingSchedule({ days: 168, sessionsPerWeek: sessions, session: [cardioSession('other', 17, minutes, { met: 6.3 })], energy: { kind: 'kcal', kcal: Math.round(martT + intakeExtra) }, macros: neutralMacros('female') }),
});

export const D10_V6_MARTIN: Scenario = {
  id: '10-V6-martin-2019-compensation',
  dossier: '10',
  target: 'V6',
  title: 'Martin 2019 (TIGER): 24 wk of 8 vs 20 kcal/kg/wk supervised aerobic exercise, measured intake compensation',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Martin et al. 2019 (dossier 10 ref [Martin19]); dossier 10 §7 V6 ("compensation: totals ±1 kg")',
  notes:
    'BMI 31.5 adults: a 45-y woman, 165 cm, 86 kg. Low dose 8 kcal/kg/wk = 688 kcal/wk in 3 sessions/wk (30 min at 6.3 MET, net 6.3−1 = 5.3 × 86 × 0.5 = 228 kcal each); high dose 20 kcal/kg/wk = 1 720 kcal/wk in 5 sessions (45 min at 6.3 MET, 342 kcal). ' +
    'Intake = baseline maintenance + the measured compensatory intake (+90.7 / +123.6 kcal/d). Published weight change = predicted loss − compensation: compensation 1.5 kg (65 %) and 2.7 kg (47 %) imply predicted losses 2.31 and 5.74 kg, i.e. observed ' +
    'losses 0.81 and 3.04 kg; tolerance ±1 kg on the totals. RMR unchanged (±50 kcal/d, Q).',
  arms: { low: martinArm(3, 30, 90.7), high: martinArm(5, 45, 123.6) },
  expectations: [
    { id: 'low', label: 'low dose: weight change after 24 wk (−0.81 kg)', unit: 'kg', measure: (c) => scaleDelta(c.arm('low'), 168), check: val(-0.81, 1.0), source: 'dossier 10 V6 (totals ±1 kg)' },
    { id: 'high', label: 'high dose: weight change after 24 wk (−3.04 kg)', unit: 'kg', measure: (c) => scaleDelta(c.arm('high'), 168), check: val(-3.04, 1.0), source: 'dossier 10 V6 (totals ±1 kg)' },
    { id: 'rmr', label: 'RMR unchanged in the high-dose arm (0 ± 50 kcal/d)', unit: 'kcal/d', measure: (c) => c.arm('high').mean('rmr', 154, 168) - c.arm('high').profile.rmr0Kcal, check: val(0, 50), gate: 'Q', source: 'dossier 10 V6', note: 'Band ±50 kcal/d assumed; RMR falls slightly with the lost mass.' },
  ],
};

// ---- V8 MET-2 (Donnelly 2013)

const MET2 = person({ sex: 'male', ageYears: 30, heightCm: 168, weightKg: 88, extra: { sexUnspecified: true } });
const met2Arm = (minutes: number): ArmSpec => ({
  profile: MET2,
  // intake unchanged from baseline while exercising (R-MAINT: % of the habitual-activity maintenance)
  schedule: trainingSchedule({ days: 304, sessionsPerWeek: 5, session: [cardioSession('other', 17, minutes, { met: 5.55 })], energy: { kind: 'pctMaintenance', pct: 100, activity: 'habitual' }, macros: neutralMacros('male') }),
});

export const D10_V8_MET2: Scenario = {
  id: '10-V8-met2-donnelly-2013',
  dossier: '10',
  target: 'V8',
  title: 'MET-2 (Donnelly 2013): 400 vs 600 kcal/session, 5 d/wk for 10 months at unchanged intake',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Donnelly et al. 2013 (dossier 10 ref [Donnelly13]); dossier 10 §7 V8',
  notes:
    'Overweight adults: a sex-unspecified 30-y adult, 168 cm, 88 kg (BMI 31). 400 kcal/session = 60 min at 5.55 MET net ((5.55 − 1) × 88 × 1 h); 600 kcal/session = 90 min. Sessions on 5 days/week for 304 days (10 months) with intake fixed at baseline maintenance ' +
    '("given user-fixed intake matched to baseline"). Published weight change −3.9 ± 4.9 and −5.2 ± 5.6 kg; tolerance ±1.5 kg on the means.',
  arms: { s400: met2Arm(60), s600: met2Arm(90) },
  expectations: [
    { id: 's400', label: '400 kcal/session: weight change after 10 months (−3.9 kg)', unit: 'kg', measure: (c) => scaleDelta(c.arm('s400'), 304), check: val(-3.9, 1.5), source: 'dossier 10 V8 (±1.5 kg)' },
    { id: 's600', label: '600 kcal/session: weight change after 10 months (−5.2 kg)', unit: 'kg', measure: (c) => scaleDelta(c.arm('s600'), 304), check: val(-5.2, 1.5), source: 'dossier 10 V8 (±1.5 kg)' },
  ],
};

// ---- V12 fasted vs fed exercise and V13 HIIT vs MICT (no timing/intensity fat-loss bonus)

const TIMING = person({ sex: 'female', ageYears: 30, heightCm: 165, weightKg: 70, bodyFatPct: 32 });
const fastedArm = (fasted: boolean): ArmSpec => ({
  profile: TIMING,
  schedule: trainingSchedule({
    days: 28,
    sessionsPerWeek: 3,
    session: [cardioSession('other', fasted ? 7 : 9, 45, { met: 6 })],
    energy: { kind: 'pctMaintenance', pct: 80 },
    macros: neutralMacros('female'),
    extras: { meals: { meals: [{ clockH: 8, share: 0.3 }, { clockH: 13, share: 0.35 }, { clockH: 19, share: 0.35 }] } },
  }),
});

export const D10_V12_FASTED: Scenario = {
  id: '10-V12-fasted-vs-fed-exercise',
  dossier: '10',
  target: 'V12',
  title: 'Fasted vs fed exercise in a hypocaloric diet: no fat-loss bonus (Schoenfeld 2014, Vieira 2016, Iwayama 2015)',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Schoenfeld 2014, Vieira 2016, Iwayama 2015 (dossier 10 refs); dossier 10 §7 V12',
  notes: 'A 30-y woman (165 cm, 70 kg, 32 % BF) at 80 % of maintenance for 4 weeks with 3 × 45-min moderate cardio sessions (6 MET) per week either at 07:00 before the 08:00 breakfast (fasted) or at 09:00 (fed); identical energy. Dossier: fat-mass difference = 0 within energy-model noise; the noise band ±0.15 kg is assumed.',
  arms: { fasted: fastedArm(true), fed: fastedArm(false) },
  expectations: [{ id: 'fatDiff', label: 'fat loss, fasted minus fed session timing (0 ± 0.15 kg)', unit: 'kg', measure: (c) => fatLossKg(c.arm('fasted'), 28) - fatLossKg(c.arm('fed'), 28), check: val(0, 0.15), source: 'dossier 10 V12 (difference = 0 within energy-model noise)' }],
};

const hiitArm = (hiit: boolean): ArmSpec => ({
  profile: TIMING,
  schedule: trainingSchedule({ days: 84, sessionsPerWeek: 3, session: [cardioSession(hiit ? 'hiit' : 'cycle', 17, 30, { met: 8, ...(hiit ? { pctVo2max: 0.9 } : { pctVo2max: 0.6 }) })], energy: { kind: 'pctMaintenance', pct: 100 }, macros: neutralMacros('female') }),
});

export const D10_V13_HIIT: Scenario = {
  id: '10-V13-hiit-vs-mict',
  dossier: '10',
  target: 'V13',
  title: 'HIIT vs MICT at matched energy: no intensity multiplier on fat loss (Keating 2017, Wewege 2017)',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Keating et al. 2017, Wewege et al. 2017 (dossier 10 refs); dossier 10 §7 V13',
  notes: 'Same woman as V12; 12 weeks, 3 × 30-min sessions per week at an identical gross MET of 8 (matched energy) but 90 % vs 60 % VO2max (HIIT vs continuous); intake at 100 % of maintenance. Dossier: no intensity multiplier on fat loss; the fat difference must be inside ±0.15 kg (assumed noise band).',
  arms: { hiit: hiitArm(true), mict: hiitArm(false) },
  expectations: [{ id: 'fatDiff', label: 'fat loss, HIIT minus MICT at matched energy (0 ± 0.15 kg)', unit: 'kg', measure: (c) => fatLossKg(c.arm('hiit'), 84) - fatLossKg(c.arm('mict'), 84), check: val(0, 0.15), source: 'dossier 10 V13 (no intensity multiplier)' }],
};

// ---- V14 HERITAGE and V16 detraining

const HERITAGE = person({ sex: 'male', ageYears: 35, heightCm: 178, weightKg: 80, bodyFatPct: 26 });

export const D10_V14_HERITAGE: Scenario = {
  id: '10-V14-heritage-vo2max',
  dossier: '10',
  target: 'V14',
  title: 'HERITAGE: 20 weeks of endurance training raise VO2max by 18 ± 9 %',
  level: 'I',
  gate: 'M',
  requires: REQUIRES.FULL,
  citation: 'Bouchard et al. 1999, Ross et al. 2019 (dossier 10 refs [Bouchard99][Ross19]); dossier 10 §7 V14',
  notes: 'Sedentary man (35 y, 178 cm, 80 kg, 26 % BF): cycle training 3 sessions/wk progressing from 30 min at 55 % to 50 min at 75 % VO2max over 14 weeks, held to week 20 (entered as 4 blocks: 30 min/55 %, 35 min/62 %, 45 min/70 %, 50 min/75 %); intake at maintenance. Mean +18 %, tolerance ±4 points (nominal run).',
  arms: {
    main: {
      profile: HERITAGE,
      schedule: (() => {
        const blocks = [
          { until: 28, min: 30, pct: 0.55 },
          { until: 56, min: 35, pct: 0.62 },
          { until: 98, min: 45, pct: 0.7 },
          { until: 140, min: 50, pct: 0.75 },
        ];
        const programs = blocks.map((b, i) => pctProgram(`block${i}`, 100, neutralMacros('male'), { exercise: [cardioSession('cycle', 17, b.min, { pctVo2max: b.pct })] }, 'current'));
        programs.push(pctProgram('rest', 100, neutralMacros('male'), {}, 'current'));
        return buildSchedule({
          days: 140,
          programs,
          use: (d) => {
            if (![0, 2, 4].includes(d % 7)) return blocks.length;
            return blocks.findIndex((b) => d < b.until);
          },
        });
      })(),
    },
  },
  expectations: [{ id: 'vo2', label: 'VO2max change after 20 weeks (+18 %)', unit: '%', measure: (c) => c.main.pct('vo2max', 140), check: val(18, 4), source: 'dossier 10 V14 (mean ±4 points)' }],
};

const ATHLETE = person({ sex: 'male', ageYears: 30, heightCm: 178, weightKg: 72, bodyFatPct: 10, sessionsPerWeek: 5, liftingCardioMix: 1, extra: { labs: { vo2maxMlKgMin: 62 } } });
const athleteArm = (maintain: boolean): ArmSpec => ({
  profile: ATHLETE,
  // weight-stable at the planned (reduced) activity: since R-MAINT 100 % of maintenance removes the habitual exercise energy
  // itself (formerly 92 % of the habitual-activity maintenance)
  schedule: trainingSchedule({ days: 57, sessionsPerWeek: maintain ? 1 : 0, session: [cardioSession('hiit', 17, 30)], energy: { kind: 'pctMaintenance', pct: 100 }, macros: neutralMacros('male'), trainUntilDay: maintain ? 28 : 0 }),
});

export const D10_V16_DETRAINING: Scenario = {
  id: '10-V16-detraining-vo2max',
  dossier: '10',
  target: 'V16',
  title: 'Coyle 1984 / Madsen 1993: VO2max after detraining and with one high-intensity bout per week',
  level: 'I',
  gate: 'M',
  requires: REQUIRES.FULL,
  citation: 'Coyle et al. 1984, Madsen et al. 1993 (dossier 10 refs [Coyle84][Madsen93]); dossier 10 §7 V16',
  notes:
    'Endurance-trained man (30 y, 178 cm, 72 kg, 10 % BF, VO2max 62 mL/kg/min entered as a lab baseline, 5 cardio sessions/wk habitually). Detraining arm: no training for 56 days at 100 % of the maintenance at the planned activity (R-MAINT: the habitual exercise energy is removed from the reference; formerly 92 % of the habitual-activity maintenance). Maintenance arm: 1 × 30-min HIIT bout per week for 4 weeks, then none. ' +
    'Published: −7 % at 21 d, −16 % at 56 d (tolerance ±4 points at 21 d; the 56-d value uses the same band); one high-intensity bout per week for 4 weeks: 0 ± 2 % (checked at day 28).',
  arms: { detrain: athleteArm(false), maintain: athleteArm(true) },
  expectations: [
    { id: 'd21', label: 'detraining: VO2max change at 21 d (−7 %)', unit: '%', measure: (c) => c.arm('detrain').pct('vo2max', 21), check: val(-7, 4), source: 'dossier 10 V16 (±4 points at 21 d)' },
    { id: 'd56', label: 'detraining: VO2max change at 56 d (−16 %)', unit: '%', measure: (c) => c.arm('detrain').pct('vo2max', 56), check: val(-16, 4), source: 'dossier 10 V16' },
    { id: 'maintain', label: 'one HIIT bout/wk for 4 wk: VO2max change (0 ± 2 %)', unit: '%', measure: (c) => c.arm('maintain').pct('vo2max', 28), check: val(0, 2), source: 'dossier 10 V16 (0 ± 2 % with maintenance)' },
  ],
};

// ---- V22 exercise without weight loss lowers VAT

const VAT = person({ sex: 'male', ageYears: 45, heightCm: 178, weightKg: 98, bodyFatPct: 30 });

export const D10_V22_VAT: Scenario = {
  id: '10-V22-vat-exercise-without-weight-loss',
  dossier: '10',
  target: 'V22',
  title: 'Verheggen 2016: exercise without weight loss lowers visceral fat (−6.1 %), sign and order of magnitude',
  level: 'I',
  gate: 'M',
  requires: REQUIRES.FULL,
  citation: 'Verheggen et al. 2016, Johnson 2009, Sabag 2022 (dossier 10 refs); dossier 10 §7 V22',
  notes: 'Overweight man (45 y, 178 cm, 98 kg, 30 % BF): 12 weeks of 4 × 45-min moderate cardio/wk at 100 % of the CURRENT maintenance (weight-stable by construction since R-MAINT: the reference includes the planned exercise; before, it was the habitual-activity maintenance and the arm lost ≈ 1.5 kg of fat, which is what made the row pass). Row: VAT change sign negative and within the order of magnitude of −6.1 % (assumed band −15.3 … −2.4, a factor 2.5 either side).',
  arms: { main: { profile: VAT, schedule: trainingSchedule({ days: 84, sessionsPerWeek: 4, session: [cardioSession('other', 17, 45, { met: 6 })], energy: AT_BALANCE, macros: neutralMacros('male') }) } },
  expectations: [{ id: 'vat', label: 'visceral-fat change after 12 wk without weight loss (−6.1 %)', unit: '%', measure: (c) => c.main.pct('visceralFat', 84), check: range(-15.3, -2.4), source: 'dossier 10 V22 (sign and order of magnitude)' }],
};

// =====================================================================================================================
// Dossier 11 §7 and the §4.15 prototype table (ΔBW ±25 %)
// =====================================================================================================================

const P25 = (target: number): ReturnType<typeof rel> => rel(target, 0.25);

// ---- #1 Bouchard with dossier 11 tolerances (arms of 01-7.7a)

export const D11_1_BOUCHARD: Scenario = {
  id: '11-1-bouchard-partition',
  dossier: '11',
  target: '#1',
  title: 'Bouchard 1990 (dossier 11 tolerances): weight, fat, FFM and energy stored',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Bouchard et al. 1990 (dossier 11 ref [1]); dossier 11 §7 #1',
  notes: 'The arm of 01-7.7a. Targets: ΔBW 8.1 (±1.5), ΔFM 5.4 (±1.0), ΔFFM 2.7 (±1.0) kg, stored energy 63 % of 84 000 kcal (±8 points).',
  arms: BOUCHARD_OVERFEED.arms,
  expectations: [
    { id: 'bw', label: 'ΔBW (8.1 kg)', unit: 'kg', measure: (c) => scaleDelta(c.main, 100), check: val(8.1, 1.5), source: 'dossier 11 #1' },
    { id: 'fm', label: 'ΔFM (5.4 kg)', unit: 'kg', measure: (c) => c.main.delta('fatMass', 100), check: val(5.4, 1.0), source: 'dossier 11 #1' },
    { id: 'ffm', label: 'ΔFFM incl. glycogen and water (2.7 kg)', unit: 'kg', measure: (c) => c.main.delta('leanMass', 100), check: val(2.7, 1.0), source: 'dossier 11 #1' },
    { id: 'stored', label: 'stored energy share of the 84 000 kcal surplus (63 %)', unit: '%', measure: (c) => (100 * storedEnergyKcal(c.main, 100)) / 84000, check: val(63, 8), source: 'dossier 11 #1 (±8 points)' },
  ],
};

// ---- #2 Bray with dossier 11 tolerances (arms of 01-7.7d)

export const D11_2_BRAY: Scenario = {
  id: '11-2-bray-protein-surplus',
  dossier: '11',
  target: '#2',
  title: 'Bray 2012 (dossier 11 tolerances): 15 vs 25 % protein in a +954 kcal/d surplus',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Bray et al. 2012 (dossier 11 ref [8]); dossier 11 §7 #2; §9.2 (5 % arm K)',
  notes: 'Arms of 01-7.7d. ΔFM 3.45 vs 3.44 kg (difference < 0.3, each ±0.6); DXA-equivalent ΔFFM incl. glycogen + water ≥ 1.8 kg (observed +2.87 / +3.18); ΔREE +160 / +227 kcal/d within ±80.',
  arms: BRAY2012.arms,
  expectations: [
    { id: 'fat15', label: '15 % protein: ΔFM (3.45 kg)', unit: 'kg', measure: (c) => c.arm('normal').delta('fatMass', 56), check: val(3.45, 0.6), source: 'dossier 11 #2 (±0.6 kg)' },
    { id: 'fat25', label: '25 % protein: ΔFM (3.44 kg)', unit: 'kg', measure: (c) => c.arm('high').delta('fatMass', 56), check: val(3.44, 0.6), source: 'dossier 11 #2 (±0.6 kg)' },
    { id: 'fatDiff', label: 'ΔFM difference 25 % − 15 % protein (< 0.3 kg)', unit: 'kg', measure: (c) => Math.abs(c.arm('high').delta('fatMass', 56) - c.arm('normal').delta('fatMass', 56)), check: below(0.3), source: 'dossier 11 #2' },
    { id: 'ffm15', label: '15 % protein: ΔFFM incl. glycogen + water (≥ 1.8 kg)', unit: 'kg', measure: (c) => c.arm('normal').delta('leanMass', 56), check: above(1.8), source: 'dossier 11 #2' },
    { id: 'ffm25', label: '25 % protein: ΔFFM incl. glycogen + water (≥ 1.8 kg)', unit: 'kg', measure: (c) => c.arm('high').delta('leanMass', 56), check: above(1.8), source: 'dossier 11 #2' },
    { id: 'ree15', label: '15 % protein: ΔREE (+160 ± 80 kcal/d)', unit: 'kcal/d', measure: (c) => c.arm('normal').after('rmr', 56) - c.arm('normal').profile.rmr0Kcal, check: val(160, 80), source: 'dossier 11 #2 (±80, k_P on)' },
    { id: 'ree25', label: '25 % protein: ΔREE (+227 ± 80 kcal/d)', unit: 'kcal/d', measure: (c) => c.arm('high').after('rmr', 56) - c.arm('high').profile.rmr0Kcal, check: val(227, 80), source: 'dossier 11 #2 (±80, k_P on)' },
  ],
};

// ---- #3 Horton 1995

const HORTON = person({ sex: 'male', ageYears: 30, heightCm: 178, weightKg: 78, bodyFatPct: 20 });
const hortonRp = resolveProfile(HORTON);
const hortonProg = (asFat: boolean) =>
  kcalProgram(
    asFat ? 'plusFat' : 'plusCarb',
    Math.round(1.5 * hortonRp.tdee0Kcal),
    asFat
      ? { protein: { unit: 'g', value: hortonRp.habitualProteinG }, carbs: { unit: 'g', value: hortonRp.habitualCarbG }, fat: { unit: 'remainder' } }
      : { protein: { unit: 'g', value: hortonRp.habitualProteinG }, carbs: { unit: 'remainder' }, fat: { unit: 'g', value: hortonRp.habitualFatG } },
  );
const hortonArm = (asFat: boolean): ArmSpec => ({ profile: HORTON, schedule: constantSchedule(14, hortonProg(asFat)) });
const storedShare = (v: ArmView): number => (100 * storedEnergyKcal(v, 14)) / (0.5 * v.profile.tdee0Kcal * 14);

export const D11_3_HORTON: Scenario = {
  id: '11-3-horton-carbohydrate-vs-fat-surplus',
  dossier: '11',
  target: '#3 (prototype)',
  title: 'Horton 1995: +50 % of maintenance for 14 d as carbohydrate or as fat, share of the excess stored',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Horton et al. 1995 Am J Clin Nutr 62:19 (dossier 11 ref [4]); dossier 11 §7 #3, §4.15 prototype table (74 % vs 89 %, ±8 points)',
  notes:
    'A 30-y man (178 cm, 78 kg, 20 % BF) at 150 % of maintenance for 14 d; the extra 50 % is pure carbohydrate (protein and fat at habitual grams) or pure fat (protein and carbohydrate at habitual grams). Stored share = (ρF·ΔFM + ρL·ΔLT + ρG·ΔG)/(excess energy). ' +
    'Published 75-85 % (CHO) vs 90-95 % (fat); the prototype table gives 74 % vs 89 % with ±8 points; engine difference ≥ 8 points and fat-surplus storage ≥ 88 %.',
  arms: { carb: hortonArm(false), fat: hortonArm(true) },
  expectations: [
    { id: 'carb', label: 'carbohydrate surplus: energy stored (75-85 %; prototype 74 %)', unit: '%', measure: (c) => storedShare(c.arm('carb')), check: val(74, 8), source: 'dossier 11 #3 / prototype table (±8 points)' },
    { id: 'fat', label: 'fat surplus: energy stored (90-95 %; prototype 89 %)', unit: '%', measure: (c) => storedShare(c.arm('fat')), check: val(89, 8), source: 'dossier 11 #3 / prototype table (±8 points)' },
    { id: 'diff', label: 'storage difference fat − carbohydrate (≥ 8 points)', unit: '% points', measure: (c) => storedShare(c.arm('fat')) - storedShare(c.arm('carb')), check: above(8), source: 'dossier 11 #3 (difference ≥ 8 points)' },
    { id: 'fatMin', label: 'fat-surplus storage (≥ 88 %)', unit: '%', measure: (c) => storedShare(c.arm('fat')), check: above(88), source: 'dossier 11 #3' },
  ],
};

// ---- #4 Jebb 1996 / Schutz 1989 oxidative hierarchy (arms of 01-7.2) and a 36-h fat surplus

export const D11_4_JEBB: Scenario = {
  id: '11-4-jebb-oxidative-hierarchy',
  dossier: '11',
  target: '#4',
  title: 'Jebb 1996 / Schutz 1989: carbohydrate oxidation tracks intake, fat balance takes the surplus',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Jebb et al. 1996, Schutz et al. 1989 (dossier 11 refs [16,17]); dossier 11 §7 #4',
  notes:
    'The overfeeding arm of 01-7.2 (+33 % mixed for 12 d, carbohydrate 540 g/d). Rows: CHO oxidation within 5 % of CHO intake by day 5; fat oxidation ≈ 59 g/d despite 150 g/d intake (±25 % Q); ' +
    'fat balance 70-80 % of the energy imbalance = energy stored as fat over days 6-12 / (intake − TEE energy over the same days), computed from the series.',
  arms: { main: JEBB.arms['over'] as ArmSpec },
  expectations: [
    { id: 'cho', label: 'CHO oxidation on day 5 vs CHO intake 540 g/d (within 5 %)', unit: 'g/d', measure: (c) => c.main.day('choOxidation', 4), check: rel(540, 0.05), source: 'dossier 11 #4 (within 5 % by day 5)' },
    { id: 'fatBalance', label: 'fat balance as a share of the energy imbalance, days 6-12 (70-80 %)', unit: '%', measure: (c) => (100 * (9441 * (c.main.after('fatMass', 12) - c.main.after('fatMass', 5)))) / (c.main.sum('inEnergy', 5, 12) - c.main.sum('tdee', 5, 12)), check: range(70, 80), source: 'dossier 11 #4 (fat balance 70-80 % of the imbalance)' },
    { id: 'fatOx', label: 'fat oxidation on day 12 despite 150 g/d intake (≈ 59 g/d)', unit: 'g/d', measure: (c) => c.main.day('fatOxidation', 11), check: rel(59, 0.25), gate: 'Q', source: 'dossier 11 #4' },
  ],
};
const FATLOAD = person({ sex: 'male', ageYears: 30, heightCm: 178, weightKg: 75, bodyFatPct: 15 });
const flT = resolveProfile(FATLOAD);
const fatLoadProg = kcalProgram('fat987', Math.round(flT.tdee0Kcal + 987), { protein: { unit: 'g', value: flT.habitualProteinG }, carbs: { unit: 'g', value: flT.habitualCarbG }, fat: { unit: 'remainder' } });

export const D11_4B_FAT_LOAD: Scenario = {
  id: '11-4b-schutz-fat-load',
  dossier: '11',
  target: '#4 (36 h fat load)',
  title: 'Schutz 1989: +987 kcal of fat for 36 h changes fat oxidation < 5 % and 24-h EE < 2 %',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Schutz et al. 1989 (dossier 11 ref [17]); dossier 11 §7 #4',
  notes: 'A 30-y man (178 cm, 75 kg, 15 % BF); day 0 at maintenance, days 1-2 at maintenance + 987 kcal/d as pure fat (48 h stand in for the 36-h protocol, whole days only). Rows on day 2: fat oxidation vs the maintenance day within 5 %; 24-h EE within 2 %.',
  arms: { main: { profile: FATLOAD, schedule: segmentSchedule([pctProgram('maintenance', 100, neutralMacros('male')), fatLoadProg], [{ days: 1, program: 0 }, { days: 2, program: 1 }]) } },
  expectations: [
    { id: 'fatOx', label: 'fat oxidation change on the second fat-load day vs the maintenance day (< 5 %)', unit: '%', measure: (c) => Math.abs(100 * (c.main.day('fatOxidation', 2) / c.main.day('fatOxidation', 0) - 1)), check: below(5), source: 'dossier 11 #4' },
    { id: 'ee', label: '24-h EE change on the second fat-load day (< 2 %)', unit: '%', measure: (c) => Math.abs(100 * (c.main.day('tdee', 2) / c.main.day('tdee', 0) - 1)), check: below(2), source: 'dossier 11 #4' },
  ],
};

// ---- #6 Johannsen 2019 and the remaining prototype-table rows (ΔBW ±25 %)

const JOHANN = person({ sex: 'male', ageYears: 30, heightCm: 178, weightKg: 75 });
const johannT = tdee0Of(JOHANN);

export const D11_6_JOHANNSEN: Scenario = {
  id: '11-6-johannsen-2019',
  dossier: '11',
  target: '#6',
  title: 'Johannsen 2019: +1 158 kcal/d for 56 d (weight 7.5 ± 1.5, fat 4.2 ± 1.0 kg)',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Johannsen et al. 2019 (dossier 11 ref [13]); dossier 11 §7 #6, prototype table',
  notes: 'A 30-y man (178 cm, 75 kg; body assumed) at baseline maintenance + 1 158 kcal/d for 56 d, habitual macros. Targets ΔBW 7.5 (±1.5), ΔFM 4.2 (±1.0) kg; unexplained 24-h EE ≤ +100 kcal/d is not a series.',
  arms: { main: { profile: JOHANN, schedule: constantSchedule(56, kcalProgram('johannsen', Math.round(johannT + 1158), neutralMacros('male'))) } },
  expectations: [
    { id: 'bw', label: 'ΔBW (7.5 kg)', unit: 'kg', measure: (c) => scaleDelta(c.main, 56), check: val(7.5, 1.5), source: 'dossier 11 #6' },
    { id: 'fm', label: 'ΔFM (4.2 kg)', unit: 'kg', measure: (c) => c.main.delta('fatMass', 56), check: val(4.2, 1.0), source: 'dossier 11 #6' },
  ],
};

interface ProtoRow {
  id: string;
  title: string;
  study: string;
  days: number;
  pct?: number;
  extraKcal?: number;
  expectBw: number;
  note: string;
}
const PROTO_ROWS: readonly ProtoRow[] = [
  { id: 'ravussin', title: 'Ravussin 1985: ×1.6 of maintenance (+8 010 kJ/d) for 9 d', study: 'Ravussin et al. (dossier 11 ref [18])', days: 9, extraKcal: 1914, expectBw: 3.2, note: 'observed 3.2 kg, 75 % stored; the study\'s absolute surplus +8 010 kJ/d ≈ +1 914 kcal/d is fed (finisher fixture fix 2026-09-30: ×1.6 of this persona\'s TDEE0 was only +1 460 kcal/d)' },
  { id: 'roberts', title: 'Roberts 1990: +1 011 kcal/d for 21 d', study: 'Roberts et al. (dossier 11 ref [19])', days: 21, extraKcal: 1011, expectBw: 2.5, note: 'observed 2.5 kg, 85-90 % stored' },
  { id: 'boden', title: 'Boden 2015: ≈ 6 000 vs 2 600 kcal/d for 7 d', study: 'Boden et al. (dossier 11 ref [77])', days: 7, extraKcal: 3400, expectBw: 3.5, note: 'observed 3.5 kg (energy = baseline + 3 400 kcal/d)' },
  { id: 'sagayama', title: 'Sagayama 2014: +1 500 kcal/d for 3 d', study: 'Sagayama et al. (dossier 11 ref [84])', days: 3, extraKcal: 1500, expectBw: 0.7, note: 'observed 0.7 kg, FM ns' },
  { id: 'muller', title: 'Müller 2015: +50 % for 7 d', study: 'Müller et al. (dossier 11 ref [97])', days: 7, pct: 150, expectBw: 1.8, note: 'observed 1.8 kg' },
];
const protoPerson = person({ sex: 'male', ageYears: 30, heightCm: 178, weightKg: 75, bodyFatPct: 18 });
const protoT = tdee0Of(protoPerson);

export const D11_PROTOTYPE: Scenario[] = PROTO_ROWS.map((r) => ({
  id: `11-proto-${r.id}`,
  dossier: '11',
  target: `§4.15 ${r.id}`,
  title: r.title,
  level: 'I' as const,
  gate: 'M' as const,
  requires: CORE,
  citation: `${r.study}; dossier 11 §4.15 prototype table (ΔBW ±25 %)`,
  notes: `A 30-y man (178 cm, 75 kg, 18 % BF; the studies' bodies are not tabulated), habitual macros. ${r.note}. Tolerance ΔBW ±25 % of the published value (§9.2 row 11). The dossier notes gut content and ECF explain most short-study under-prediction.`,
  arms: {
    main: {
      profile: protoPerson,
      schedule: constantSchedule(r.days, r.pct !== undefined ? pctProgram(`x${r.pct}`, r.pct, neutralMacros('male')) : kcalProgram(`plus${r.extraKcal}`, Math.round(protoT + (r.extraKcal ?? 0)), neutralMacros('male'))),
    },
  },
  expectations: [{ id: 'bw', label: `ΔBW after ${r.days} d (${r.expectBw} kg)`, unit: 'kg', measure: (c: { main: ArmView }) => scaleDelta(c.main, r.days), check: P25(r.expectBw), source: 'dossier 11 §4.15 prototype table (ΔBW ±25 %)' }],
}));

// ---- #8 Sagayama short surplus and return to baseline; Boden insulin sensitivity

export const D11_8_SAGAYAMA: Scenario = {
  id: '11-8-sagayama-return-to-baseline',
  dossier: '11',
  target: '#8',
  title: 'Sagayama 2014: 3 d at +1 500 kcal/d, fat gain small, weight back to baseline within 7 d at maintenance',
  level: 'I',
  gate: 'M',
  requires: CORE,
  citation: 'Sagayama et al. 2014, Boden et al. 2015 (dossier 11 refs [84,77]); dossier 11 §7 #8',
  notes: '3 d at baseline maintenance + 1 500 kcal/d then 7 d at maintenance (same man as the prototype rows). Targets: ΔBW +0.7 (engine 0.6-1.2 kg incl. gut/ECF), ΔFM ≤ 0.35 kg, weight back to baseline (+0.3 kg) within 7 days at maintenance.',
  arms: { main: { profile: protoPerson, schedule: segmentSchedule([kcalProgram('plus1500', Math.round(protoT + 1500), neutralMacros('male')), pctProgram('maintenance', 100, neutralMacros('male'))], [{ days: 3, program: 0 }, { days: 7, program: 1 }]) } },
  expectations: [
    { id: 'bw3', label: 'ΔBW after 3 d (0.6-1.2 kg)', unit: 'kg', measure: (c) => scaleDelta(c.main, 3), check: range(0.6, 1.2), source: 'dossier 11 #8' },
    { id: 'fm3', label: 'ΔFM after 3 d (≤ 0.35 kg)', unit: 'kg', measure: (c) => c.main.delta('fatMass', 3), check: below(0.35), source: 'dossier 11 #8' },
    { id: 'back', label: 'weight vs baseline after 7 d at maintenance (≤ +0.3 kg)', unit: 'kg', measure: (c) => scaleDelta(c.main, 10), check: below(0.3), source: 'dossier 11 #8 (return to baseline in ≤ 7 d)', note: 'A +0.3 kg residual (the fat gained) is allowed.' },
  ],
};

export const SCENARIOS_ENERGY: Scenario[] = [
  D02_V1_LEVINE,
  D02_V3_HALL2016,
  D02_V4_CALERIE1,
  D02_V5_MARTINS,
  D02_V6_BIGGEST_LOSER,
  D02_V7_ICECAP,
  D02_V8_LEIBEL,
  D02_V9_OHKAWARA,
  D02_V10_MIKKELSEN,
  D10_V1_WALK_RUN,
  D10_V2_WALK,
  D10_V6_MARTIN,
  D10_V8_MET2,
  D10_V12_FASTED,
  D10_V13_HIIT,
  D10_V14_HERITAGE,
  D10_V16_DETRAINING,
  D10_V22_VAT,
  D11_1_BOUCHARD,
  D11_2_BRAY,
  D11_3_HORTON,
  D11_4_JEBB,
  D11_4B_FAT_LOAD,
  D11_6_JOHANNSEN,
  ...D11_PROTOTYPE,
  D11_8_SAGAYAMA,
];
