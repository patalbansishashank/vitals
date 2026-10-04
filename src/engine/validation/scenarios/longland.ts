/**
 * Longland 2016: 4 wk at ≈ 40 % energy deficit with RT + HIIT 6 d/wk, protein 1.2 (CON) vs 2.4 (PRO) g/kg
 * (dossier 03 §4.4.2 model table and §7, dossier 09 #5, dossier 01 §7.12 negative control).
 * Shared by the Longland dossier scenario (magnitudes) and the O-2 oracle scenario (direction, see `oracle.ts`).
 * The direction check PRO > CON lean lives in O-2 only, so it is not counted twice.
 */
import { person } from '../fixtures/personas';
import { atModelTee, buildSchedule, cardioSession, kcalProgram, rtSession } from '../fixtures/programs';
import { above, val } from '../harness/run';
import { REQUIRES } from '../harness/stubs';
import type { ArmSpec, Scenario } from '../harness/types';

/** Dossier 03 model-table assumption: 100 kg, 25 % BF (LBM 75 kg), young man; height 183 cm is our choice (BMI 29.9). */
export const LONGLAND_MAN = person({ sex: 'male', ageYears: 24, heightCm: 183, weightKg: 100, bodyFatPct: 25, steps: 7000 });

/** 33 kcal per kg LBM per day, all food provided (dossier 03 Longland row): 33 × 75 kg. */
export const LONGLAND_KCAL = 33 * 75;

const rt = rtSession(17, { volume: 'high', rir: 1 });
const hiit = cardioSession('hiit', 17, 30);
const walkish = cardioSession('other', 17, 45);

/**
 * Week: Mon/Wed/Fri whole-body RT (high volume), Tue/Thu HIIT 30 min, Sat 45-min moderate cardio, Sun rest (6 training days;
 * the dossier gives only "RT + HIIT 6 d/wk", so the session mix is an assumption).
 */
function longlandSchedule(proteinGPerKg: number) {
  const macros = { protein: { unit: 'gPerKgBw', value: proteinGPerKg } as const, carbs: { unit: 'pctEnergy', value: 40 } as const, fat: { unit: 'remainder' } as const };
  const day = (id: string, ex: ReturnType<typeof rtSession>[]) => kcalProgram(id, LONGLAND_KCAL, macros, { exercise: ex });
  return buildSchedule({
    days: 28,
    programs: [day('rt', [rt]), day('hiit', [hiit]), day('cardio', [walkish]), day('rest', [])],
    use: [0, 1, 0, 1, 0, 2, 3],
  });
}

/**
 * Both arms eat the same intake: 60 % of the model's own TDEE on the control arm's training week (the study's ≈ 40 %
 * deficit; fixture fix 2026-09-30). 33 kcal/kg LBM (LONGLAND_KCAL, the dossier's model-table intake for its assumed
 * 100-kg man) is only a 28-31 % deficit against the engine's TDEE with six training days, so fat loss fell short (PRO −3.1
 * vs −4.8 ± 1.6 kg) for a reason unrelated to protein.
 */
function longlandArm(proteinGPerKg: number): ArmSpec {
  return {
    label: `${proteinGPerKg} g/kg`,
    profile: LONGLAND_MAN,
    schedule: atModelTee(LONGLAND_MAN, longlandSchedule(proteinGPerKg), 0.6, longlandSchedule(1.2)),
  };
}

export const LONGLAND_ARMS: Record<string, ArmSpec> = { con: longlandArm(1.2), pro: longlandArm(2.4) };

export const LONGLAND: Scenario = {
  id: '03-longland-2016',
  dossier: '03',
  target: 'Longland',
  title: 'Longland 2016 deficit + RT/HIIT, 1.2 vs 2.4 g/kg protein, 4 wk',
  level: 'I',
  gate: 'M',
  requires: REQUIRES.TRAINING,
  citation: 'Longland et al. 2016 Am J Clin Nutr 103:738 (PMID 26817506); dossier 03 §4.4.2 / §7, dossier 09 #5, dossier 01 §7.12',
  notes:
    '40 young men, 4 wk at ≈ 40 % deficit (33 kcal/kg LBM/d, all food provided), RT + HIIT 6 d/wk, protein 1.2 (CON) vs 2.4 (PRO) g/kg. Body: 100 kg, 25 % BF, 24-y man ' +
    '(the dossier 03 model-table assumption; height 183 cm is ours). Energy for both arms = 60 % of the model\'s own TDEE on the control arm\'s training week (the study\'s ≈ 40 % deficit; 33 kcal/kg LBM = 2 475 kcal/d was only a 28-31 % deficit against the engine\'s TDEE with six training days), carbohydrate fixed at 40 %E, fat = remainder (macro split not in the dossier). ' +
    'Weekly mix RT ×3, HIIT ×2, moderate cardio ×1 is an assumption. Study numbers: LBM +0.1 ± 1.0 vs +1.2 ± 1.0 kg, FM −3.5 ± 1.4 vs −4.8 ± 1.6 kg (4-compartment). ' +
    'Compared with the engine `leanMass` (DXA-equivalent, includes water) because the study measured LBM. Tolerances are the study SDs. Direction PRO > CON lean is the O-2 row (`oracle.ts`); the dossier 03 §7 #1 difference targets (lean ≥ 0.4 kg, fat ≥ 0.5 kg) are rows here. ' +
    'Gating per §9.2: PRO lean magnitude is K (documented under-prediction: dossier 03 model +0.3 vs +1.2 kg; dossier 09 −0.7…−1.0 kg); the fat-loss ordering is K (dossier 03 model predicts PRO loses LESS fat: −3.9 vs −4.5 kg).',
  arms: LONGLAND_ARMS,
  expectations: [
    { id: 'conLean', label: 'CON: lean-mass change (+0.1 ± 1.0 kg)', unit: 'kg', measure: (c) => c.arm('con').delta('leanMass', 28), check: val(0.1, 1.0), source: 'dossier 03 §7 Longland; 09 #5' },
    { id: 'proLean', label: 'PRO: lean-mass change (+1.2 ± 1.0 kg)', unit: 'kg', measure: (c) => c.arm('pro').delta('leanMass', 28), check: val(1.2, 1.0), gate: 'K', source: 'dossier 03 §7 Longland; 09 #5', note: 'Known under-prediction (03: +0.3 kg, 09: 0.7-1.0 kg low).' },
    { id: 'conFat', label: 'CON: fat-mass change (−3.5 ± 1.4 kg)', unit: 'kg', measure: (c) => c.arm('con').delta('fatMass', 28), check: val(-3.5, 1.4), source: 'dossier 03 §7 Longland' },
    { id: 'proFat', label: 'PRO: fat-mass change (−4.8 ± 1.6 kg)', unit: 'kg', measure: (c) => c.arm('pro').delta('fatMass', 28), check: val(-4.8, 1.6), source: 'dossier 03 §7 Longland' },
    { id: 'leanDiff', label: 'between-group lean difference PRO − CON (observed 1.1 kg, target ≥ 0.4 kg)', unit: 'kg', measure: (c) => c.arm('pro').delta('leanMass', 28) - c.arm('con').delta('leanMass', 28), check: above(0.4), source: 'dossier 03 §7 #1 (lean difference ≥ 0.4 kg)' },
    { id: 'proMoreFatLoss', label: 'PRO loses more fat than CON, difference ≥ 0.5 kg (observed 1.3 kg)', unit: 'kg', measure: (c) => c.arm('con').delta('fatMass', 28) - c.arm('pro').delta('fatMass', 28), check: above(0.5), gate: 'M' /* promoted from K at integration 2026-09-30: inside its band */, source: 'dossier 03 §4.4.2 model table', note: 'Model predicts the opposite order (−3.9 PRO vs −4.5 CON); tracked, non-gating.' },
  ],
};

export const SCENARIOS_LONGLAND: Scenario[] = [LONGLAND];
