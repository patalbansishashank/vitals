/**
 * Parameters of the activity intake (plan/01-after-launch/research/R1-activity-intake.md §3.2, §3.4; MODEL_SPEC §5.5).
 *
 * Every constant the answers map to is one ParamDef (value, plausible range, grade, source, research §, status), copied from
 * R1 and the dossiers it builds on (02 §4.6, §4.12-4.13; 10 §4.1.4, §4.14). The intake runs once in `resolveProfile`, outside
 * the step loop and outside the ensemble registry, so `low`/`high` document the plausible range (and feed the uncertainty band
 * where R1 says so: occupation class half-range) but are not drawn. `ACTIVITY_INTAKE_K` is the nominal constants object;
 * `activityIntakeConstants(values)` rebuilds it from overridden values (sensitivity tests).
 *
 * Units: e_occ / e_home in kcal·kg⁻¹·h⁻¹ above seated rest with steps excluded (≈ MET − 1 net of the step share); METs in
 * MET (1 MET ≈ 1 kcal·kg⁻¹·h⁻¹); steps in steps/d; coefficients of variation dimensionless.
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
): ParamDef => ({ id: `activityIntake.${name}`, value, unit, low, high, grade, source, dossier, status, ...extra });

/** No range in the source: documented as fixed. */
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

const COMPENDIUM = '2024 Adult Compendium of Physical Activities, occupation codes (pacompendium.com/occupation)';
const FAO = 'FAO/WHO/UNU 2004; Black 1996 lifestyle PAL table via Endotext NBK279077';
const NASEM = 'NASEM 2023 Dietary Reference Intakes for Energy ch. 7 (DLW equations, PAL categories)';
const HONG = 'Hong 2024 PMID 39066055 (step validity vs activPAL)';
const R1 = 'R1 §3.2';
const R1U = 'R1 §3.4; 02 §4.12';

export const ACTIVITY_INTAKE_PARAMS: readonly ParamDef[] = [
  // ---- the pre-intake TDEE0 form (02 §4.13 init step 2), shared by both paths
  P('stepKcalPerKgPer1000', 0.44, 'kcal/kg/1000 steps', 0.36, 0.5, 'B', 'Ohkawara 2011 calorimeter (02 [48]); DERIVED from Ludlow & Weyand 2016 PMID 26679617', '10 §4.1.4; 02 §4.6', 'proposed-fit', {
    label: 'Energy per 1 000 steps per kg',
    note: 'Same value as activity.stepsNet (the activity module books steps above the habitual count with it).',
  }),
  FIX('neatNonStepFrac', 0.15, 'frac RMR0', 'C', '02 §4.13 init step 2 (PROPOSED, calibrated to PAL 1.4 at 5 000 steps/d)', '02 §4.13; R1 open question 4', 'proposed-fit',
    'Everyday-living baseline (non-locomotor NEAT). R1 keeps 0.15: raising it would lift desk workers above FAO 1.4-1.5.'),

  // ---- occupation: energy above seated rest per work hour, steps excluded (R1 §3.2)
  P('occDesk', 0, 'kcal/kg/h', 0, 0.1, 'B', `${COMPENDIUM}: office/driving 1.3-1.5 MET ≈ seated reference`, `${R1}; 02 §4.6`, 'proposed-fit', { label: 'Desk work (above sitting)' }),
  P('occMixed', 0.4, 'kcal/kg/h', 0.1, 0.45, 'C', 'between quiet standing 0.14 (Saeidifard 2018 PMID 29385357) and standing tasks 1.8 MET (Compendium 2024)', `${R1}; 02 §4.6`, 'proposed-fit', {
    label: 'Mixed sitting and moving work',
    note: 'PROPOSED-fit (I1 integration): raised from R1\'s 0.25 to 0.40, inside its 0.10-0.45 range, so the mixed-job archetype reaches the FAO/WHO 1.6-1.7 lifestyle band (R1 had 1.58 before the TEF difference, the engine 1.556; no DLW study by occupation class, R1 open question 2). 0.33 only reaches PAL 1.58.',
  }),
  P('occOnFeet', 0.5, 'kcal/kg/h', 0.2, 0.8, 'C', `${COMPENDIUM}: standing light 1.8 MET, patient care 2.3-3.3 MET, minus sitting 1.3 MET and the step share`, `${R1}; 02 §4.6`, 'proposed-fit', { label: 'On-feet work' }),
  P('occManualModerate', 1.0, 'kcal/kg/h', 0.6, 1.6, 'C', `${COMPENDIUM}: custodial 3.8, carpentry 4.3, manual labour 4.5, farming moderate 4.8 MET, minus walking share and duty cycle`, `${R1}; 02 §4.6`, 'proposed-fit', { label: 'Physical work (lifting, carrying)' }),
  P('occManualHeavy', 2.0, 'kcal/kg/h', 1.2, 3.0, 'D', `${COMPENDIUM}: carpentry heavy 7.0, farming vigorous 7.8 MET, duty cycle ~40-50 %`, `${R1}; 02 §4.6`, 'proposed-fit', {
    label: 'Heavy physical work',
    note: 'R1 grades this coefficient C/D; the lower grade is recorded.',
  }),

  // ---- skipped work class: population prior shares (R1 §3.2; mean 0.32, SD 0.41 derived from these and the class ranges, with occMixed 0.40)
  FIX('priorShareDesk', 0.45, 'frac', 'D', 'Church 2011 PMID 21647427 ("<20 % moderate-intensity jobs"); shares PROPOSED', `${R1}; 02 §4.6`, 'proposed-fit', 'US-flavoured; locale priors are R1 open question 3.'),
  FIX('priorShareMixed', 0.25, 'frac', 'D', 'Church 2011 PMID 21647427; shares PROPOSED', `${R1}; 02 §4.6`, 'proposed-fit'),
  FIX('priorShareOnFeet', 0.2, 'frac', 'D', 'Church 2011 PMID 21647427; shares PROPOSED', `${R1}; 02 §4.6`, 'proposed-fit'),
  FIX('priorShareManualModerate', 0.08, 'frac', 'D', 'Church 2011 PMID 21647427; shares PROPOSED', `${R1}; 02 §4.6`, 'proposed-fit'),
  FIX('priorShareManualHeavy', 0.02, 'frac', 'D', 'Church 2011 PMID 21647427; shares PROPOSED', `${R1}; 02 §4.6`, 'proposed-fit'),

  // ---- home, commute, recreation (R1 §3.2)
  P('homeKcalPerKgH', 0.5, 'kcal/kg/h', 0.15, 0.9, 'C', 'quiet standing 0.14 (Saeidifard 2018 PMID 29385357) → household tasks ~2.0-2.5 MET (Compendium 2024; exact codes UNVERIFIED)', `${R1}; 02 §4.6`, 'unverified', { label: 'Chores, cooking, childcare on feet' }),
  FIX('homeHoursLittle', 0.5, 'h/d', 'D', 'R1 default for "a little (< 1 h)"', `${R1}; 02 §4.6`, 'proposed-fit'),
  FIX('homeHoursSome', 1.5, 'h/d', 'D', 'R1 default for "some (1-2 h)"', `${R1}; 02 §4.6`, 'proposed-fit'),
  FIX('homeHoursALot', 3, 'h/d', 'D', 'R1 default for "a lot (3 h +)"', `${R1}; 02 §4.6`, 'proposed-fit'),
  P('metCycleCommute', 6.8, 'MET', 4.0, 8.0, 'B', 'Compendium "bicycling to/from work, self-selected pace" (code value UNVERIFIED in R1)', `${R1}; 10 §4.14`, 'unverified', { label: 'Cycling commute' }),
  P('metSportLight', 3.5, 'MET', 2.45, 4.55, 'B', 'Compendium 2024 intensity bands', `${R1}; 10 §4.1`, 'proposed-fit', { note: 'Range ±30 % (R1).' }),
  P('metSportModerate', 5, 'MET', 3.5, 6.5, 'B', 'Compendium 2024 intensity bands', `${R1}; 10 §4.1`, 'proposed-fit', { note: 'Range ±30 % (R1).' }),
  P('metSportVigorous', 8, 'MET', 5.6, 10.4, 'B', 'Compendium 2024 intensity bands', `${R1}; 10 §4.1`, 'proposed-fit', { note: 'Range ±30 % (R1).' }),
  P('walkCadence', 105, 'steps/min', 100, 120, 'B', 'Tudor-Locke 2011 (100 steps/min = moderate walking) via 10 §4.14', `R1 §3.1; 10 §4.14`, 'proposed-fit', { label: 'Walking commute cadence' }),
  P('quietStandKcalPerKgH', 0.14, 'kcal/kg/h', 0.11, 0.16, 'B', 'Saeidifard 2018 PMID 29385357: standing vs sitting +0.15 kcal/min (95 % CI 0.12-0.17) at 65 kg', 'R1 §2.2; 02 §4.6', 'verified', {
    label: 'Standing instead of sitting',
    note: 'Anchor of the occupation and home coefficients (R1 V5: 6 h at 65 kg = +54 kcal/d); not a term of the closed form.',
  }),

  // ---- workday / day-off steps when no step number is given (R1 §3.2, range ×0.6-1.5)
  P('stepsWorkDesk', 6000, 'steps/d', 3600, 9000, 'C', 'Tigbe 2011 office postal workers 6 709 (via 10 §4.14); 10 §4.14 anchors', `${R1}; 10 §4.14`, 'proposed-fit'),
  P('stepsWorkMixed', 8000, 'steps/d', 4800, 12000, 'C', '10 §4.14 selector anchors', `${R1}; 10 §4.14`, 'proposed-fit'),
  P('stepsWorkOnFeet', 11000, 'steps/d', 6600, 16500, 'C', '10 §4.14 selector anchors', `${R1}; 10 §4.14`, 'proposed-fit'),
  P('stepsWorkManualModerate', 12000, 'steps/d', 7200, 18000, 'C', '10 §4.14 selector anchors', `${R1}; 10 §4.14`, 'proposed-fit'),
  P('stepsWorkManualHeavy', 14000, 'steps/d', 8400, 21000, 'C', 'Tigbe 2011 walking postal workers 16 035 (via 10 §4.14); 10 §4.14 anchors', `${R1}; 10 §4.14`, 'proposed-fit'),
  P('stepsOffMostlyHome', 4500, 'steps/d', 2700, 6750, 'C', 'Bassett 2010 US mean 5 117 (via 10 §4.14)', `${R1}; 10 §4.14`, 'proposed-fit'),
  P('stepsOffMixed', 7000, 'steps/d', 4200, 10500, 'C', '10 §4.14 typical day', `${R1}; 10 §4.14`, 'proposed-fit'),
  P('stepsOffOutAndAbout', 10000, 'steps/d', 6000, 15000, 'C', 'Bohannon 2007 adult mean 9 448 (via 10 §4.14)', `${R1}; 10 §4.14`, 'proposed-fit'),

  // ---- uncertainty band (R1 §3.4)
  FIX('cvRmrEquation', 0.1, '1', 'A', 'RMR equations: 21-32 % of people outside ±10 % (02 §4.12 [10])', R1U, 'proposed-fit', 'Applied to 1.15·RMR0 (resting + everyday living).'),
  FIX('cvRmrMeasured', 0.05, '1', 'B', 'biological CV_intra of REE ≈ 5 % (02 §4.12 [15])', '02 §4.12', 'verified'),
  FIX('cvStepCost', 0.1, '1', 'B', 'step cost 0.36-0.50 kcal/kg/1000 (10 §4.1.4)', R1U, 'proposed-fit'),
  FIX('cvStepsWrist', 0.1, '1', 'B', `${HONG}: wrist MAPE 6.4 % / 10.5 %`, R1U, 'proposed-fit'),
  FIX('cvStepsPhone', 0.25, '1', 'B', `${HONG}: phone app MAPE 29.6 %`, R1U, 'proposed-fit'),
  FIX('cvStepsPhoneNotCarried', 0.35, '1', 'D', 'R1 Q5a: phone not with the person most of the day', 'R1 §5', 'proposed-fit'),
  FIX('cvStepsRough', 0.4, '1', 'D', 'guessed or derived steps: no validation found (R1 §2.3)', R1U, 'proposed-fit'),
  FIX('cvHome', 0.6, '1', 'C', 'over-report-prone answer (R1 §2.3)', R1U, 'proposed-fit'),
  FIX('cvRecreation', 0.5, '1', 'C', 'exercise over-reported, Lichtman 1992 PMID 1454084 (+51 ± 75 %)', R1U, 'proposed-fit'),
  FIX('cvCycleCommute', 0.3, '1', 'C', 'R1 §3.4', R1U, 'proposed-fit'),
  FIX('cvTraining', 0.2, '1', 'C', 'session cost (10 §4.1)', R1U, 'proposed-fit'),
  FIX('floorAnswered', 0.1, '1', 'A', `${NASEM}: MAPE 8.7-9.4 % even with the measured PAL category`, R1U, 'proposed-fit'),
  FIX('floorSkipped', 0.12, '1', 'A', '02 §4.12 cv0 (no body composition, PAL self-report ≈ NASEM RMSE/mean)', R1U, 'proposed-fit'),
  FIX('floorBodyFat', 0.1, '1', 'A', '02 §4.12 cv0 (body fat measured)', '02 §4.12', 'proposed-fit'),
  FIX('floorMeasuredRmr', 0.08, '1', 'A', '02 §4.12 cv0 (RMR measured)', R1U, 'proposed-fit'),

  // ---- sustainability and comparison categories
  FIX('palWarn', 2.4, '1', 'B', `${FAO}: PAL > 2.40 difficult to maintain long-term`, 'R1 §3.1; 02 §4.6', 'verified'),
  FIX('palCap', 2.5, '1', 'B', `${NASEM}: very active range top 2.50`, 'R1 §3.1; 02 §4.6', 'verified'),
  FIX('nasemInactiveMax', 1.53, '1', 'A', NASEM, '02 §4.6', 'verified'),
  FIX('nasemLowActiveMax', 1.68, '1', 'A', NASEM, '02 §4.6', 'verified'),
  FIX('nasemActiveMax', 1.85, '1', 'A', NASEM, '02 §4.6', 'verified'),
];

/** Constants object of the intake (read once; never inside a step loop). */
export interface ActivityIntakeK {
  /** kcal per kg per step. */
  stepK: number;
  neatNonStepFrac: number;
  /** e_occ by class and its 1-SD (= (high − low)/3.92, R1 §3.4 "class half-range as 95 % interval"), kcal/kg/h. */
  occ: Record<'desk' | 'mixed' | 'onFeet' | 'manualModerate' | 'manualHeavy', { e: number; sd: number; share: number; stepsWork: number }>;
  homeKcalPerKgH: number;
  homeHours: Record<'little' | 'some' | 'aLot', number>;
  metCycle: number;
  metSport: Record<'light' | 'moderate' | 'vigorous', number>;
  walkCadence: number;
  quietStandKcalPerKgH: number;
  stepsOff: Record<'mostlyHome' | 'mixed' | 'outAndAbout', number>;
  cvRmrEquation: number;
  cvRmrMeasured: number;
  cvStepCost: number;
  cvStepsWrist: number;
  cvStepsPhone: number;
  cvStepsPhoneNotCarried: number;
  cvStepsRough: number;
  cvHome: number;
  cvRecreation: number;
  cvCycleCommute: number;
  cvTraining: number;
  floorAnswered: number;
  floorSkipped: number;
  floorBodyFat: number;
  floorMeasuredRmr: number;
  palWarn: number;
  palCap: number;
  nasemInactiveMax: number;
  nasemLowActiveMax: number;
  nasemActiveMax: number;
}

/** Build the constants object from a value vector in `ACTIVITY_INTAKE_PARAMS` order (default: the nominal values). */
export function activityIntakeConstants(values: ArrayLike<number> = ACTIVITY_INTAKE_PARAMS.map((d) => d.value)): ActivityIntakeK {
  const byId = new Map<string, number>();
  ACTIVITY_INTAKE_PARAMS.forEach((d, i) => byId.set(d.id, values[i]!));
  const g = (name: string): number => {
    const v = byId.get(`activityIntake.${name}`);
    if (v === undefined) throw new Error(`activityIntake.${name} missing`);
    return v;
  };
  const def = (name: string): ParamDef => ACTIVITY_INTAKE_PARAMS.find((d) => d.id === `activityIntake.${name}`)!;
  const cls = (name: string, share: string, steps: string) => ({ e: g(name), sd: (def(name).high - def(name).low) / 3.92, share: g(share), stepsWork: g(steps) });
  return {
    stepK: g('stepKcalPerKgPer1000') / 1000,
    neatNonStepFrac: g('neatNonStepFrac'),
    occ: {
      desk: cls('occDesk', 'priorShareDesk', 'stepsWorkDesk'),
      mixed: cls('occMixed', 'priorShareMixed', 'stepsWorkMixed'),
      onFeet: cls('occOnFeet', 'priorShareOnFeet', 'stepsWorkOnFeet'),
      manualModerate: cls('occManualModerate', 'priorShareManualModerate', 'stepsWorkManualModerate'),
      manualHeavy: cls('occManualHeavy', 'priorShareManualHeavy', 'stepsWorkManualHeavy'),
    },
    homeKcalPerKgH: g('homeKcalPerKgH'),
    homeHours: { little: g('homeHoursLittle'), some: g('homeHoursSome'), aLot: g('homeHoursALot') },
    metCycle: g('metCycleCommute'),
    metSport: { light: g('metSportLight'), moderate: g('metSportModerate'), vigorous: g('metSportVigorous') },
    walkCadence: g('walkCadence'),
    quietStandKcalPerKgH: g('quietStandKcalPerKgH'),
    stepsOff: { mostlyHome: g('stepsOffMostlyHome'), mixed: g('stepsOffMixed'), outAndAbout: g('stepsOffOutAndAbout') },
    cvRmrEquation: g('cvRmrEquation'),
    cvRmrMeasured: g('cvRmrMeasured'),
    cvStepCost: g('cvStepCost'),
    cvStepsWrist: g('cvStepsWrist'),
    cvStepsPhone: g('cvStepsPhone'),
    cvStepsPhoneNotCarried: g('cvStepsPhoneNotCarried'),
    cvStepsRough: g('cvStepsRough'),
    cvHome: g('cvHome'),
    cvRecreation: g('cvRecreation'),
    cvCycleCommute: g('cvCycleCommute'),
    cvTraining: g('cvTraining'),
    floorAnswered: g('floorAnswered'),
    floorSkipped: g('floorSkipped'),
    floorBodyFat: g('floorBodyFat'),
    floorMeasuredRmr: g('floorMeasuredRmr'),
    palWarn: g('palWarn'),
    palCap: g('palCap'),
    nasemInactiveMax: g('nasemInactiveMax'),
    nasemLowActiveMax: g('nasemLowActiveMax'),
    nasemActiveMax: g('nasemActiveMax'),
  };
}

/** Nominal constants. */
export const ACTIVITY_INTAKE_K: ActivityIntakeK = activityIntakeConstants();
