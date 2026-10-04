/**
 * Constants of the catalogue layer, as ParamDefs (house rule: every number has a value, range, grade, source and status),
 * plus the engine constants the stimulus mapping must share with the muscle and activity modules. The engine values are
 * read from the engines' own registries by id, never copied, so the catalogue cannot drift from the simulator.
 *
 * Grades here describe the numbers, not the items; they never gate anything (R5 §2.5).
 */
import { ACTIVITY_PARAMS } from '@/engine/model/activity/params';
import { MUSCLE_PARAMS } from '@/engine/model/muscle/params';
import type { EvidenceGrade, ParamDef, ParamStatus } from '@/engine/types/params';
import type { StimulusIntent } from './types';

const R3 = 'R3 exercise and equipment research (2026-10-01)';
const R4 = 'R4 food, recipes and supplements research (2026-10-01)';
const R5 = 'R5 evidence policy research (2026-10-01)';
const SPEC = 'PLANNER_V2_SPEC §8 (normative)';

function p(
  name: string,
  value: number,
  unit: string,
  low: number,
  high: number,
  grade: EvidenceGrade,
  source: string,
  dossier: string,
  status: ParamStatus,
  note?: string,
): ParamDef {
  return { id: `catalogue.${name}`, value, unit, low, high, grade, source, dossier, status, ...(note ? { note } : {}) };
}
const f = (name: string, value: number, unit: string, grade: EvidenceGrade, source: string, dossier: string, status: ParamStatus, note?: string): ParamDef =>
  p(name, value, unit, value, value, grade, source, dossier, status, note);

export const CATALOGUE_PARAMS: readonly ParamDef[] = [
  // ---- stimulus mapping (R3 §3)
  p('ballisticSetFactor', 0.5, '1', 0.25, 0.75, 'D', R3, 'R3 §3.1, §3.3; PLANNER_V2 §8.3', 'proposed-fit',
    'A ≥ 20 s ballistic bout at RPE ≥ 7 is one set × this × region weight. R5 §3.3 alternative: f_load Tri(0.45, 0.8, 1.0) for gada (implies ≈ 0.8); the spec keeps 0.5.'),
  f('isometricNonFailureFactor', 0.5, '1', 'D', R3, 'R3 §3.1', 'proposed-fit', 'hold not ending within ~10 s of failure counts as half a set'),
  p('epleyDivisor', 30, 'reps', 25, 40, 'C', `${R3}; Epley 1985 coaching formula`, 'R3 §3.2', 'unverified', 'L_eq = 100/(1 + R_f/30); per-pattern divisors (25–40) are an open question'),
  f('ballisticDefaultLoadPct', 50, '%1RM', 'D', R3, 'R3 §3.3', 'proposed-fit', 'load of a timed ballistic bout when no reps are logged'),
  f('ballisticDefaultRir', 3, 'RIR', 'D', R3, 'R3 §3.3', 'proposed-fit'),
  f('ballisticMinWorkSec', 20, 's', 'D', R3, 'R3 §3.1', 'proposed-fit', 'shorter bouts are not counted as a set'),
  f('maxRepsToFailureHyp', 30, 'reps', 'D', R3, 'R3 §3.2', 'proposed-fit', 'practical rep cap for hypertrophy prescriptions; above it the region is load-limited'),
  f('maxRepsToFailureStrength', 8, 'reps', 'C', R3, 'R3 §3.2', 'proposed-fit', 'strength intent needs R_f ≤ 8 (L ≥ ~80 %1RM)'),
  f('defaultRir', 2, 'RIR', 'B', 'core/defaults DEFAULTS.rtRir', 'R3 §2.3', 'verified', 'RIR when neither RIR nor RPE is logged (engine default)'),
  f('medHypertrophySetsWk', 4, 'effective sets/region/wk', 'A', `${R3}; Pelland 2026 PMID 41343037 (dose-response curve)`, 'R3 §3.4', 'proposed-fit', 'minimum effective dose for a detectable hypertrophy response'),
  f('medMemWk', 150, 'MEM/wk', 'A', `${R3}; WHO 2020 physical-activity guideline`, 'R3 §3.4', 'verified', '150 min/wk moderate ≈ 150 moderate-equivalent minutes'),
  f('stairStepHeightM', 0.17, 'm', 'B', `${R3}; ACSM stepping equation`, 'R3 §4', 'unverified', 'stair step height for acsmStep when none is logged'),
  // ---- energy (R3 §4)
  f('pandolfEtaRoad', 1.0, '1', 'B', 'Pandolf 1977 doi:10.1152/jappl.1977.43.4.577', 'R3 §4', 'unverified'),
  f('pandolfEtaDirt', 1.1, '1', 'B', 'Pandolf 1977 doi:10.1152/jappl.1977.43.4.577', 'R3 §4', 'unverified'),
  f('pandolfEtaLightBrush', 1.2, '1', 'B', 'Pandolf 1977 doi:10.1152/jappl.1977.43.4.577', 'R3 §4', 'unverified'),
  f('pandolfEtaHeavyBrush', 1.5, '1', 'B', 'Pandolf 1977 doi:10.1152/jappl.1977.43.4.577', 'R3 §4', 'unverified'),
  // ---- equivalence (R3 §5)
  f('creditFull', 0.9, '1', 'D', R3, 'R3 §5.3; PLANNER_V2 §8.6', 'proposed-fit', 'S at or above: full credit (parity)'),
  f('creditPartial', 0.6, '1', 'D', R3, 'R3 §5.3; PLANNER_V2 §8.6', 'proposed-fit', 'S below: different stimulus'),
  f('cSamePatternSameImplement', 1.0, '1', 'C', R3, 'R3 §5.2', 'proposed-fit', 'strength transfer: same pattern, same implement geometry'),
  f('cSamePattern', 0.8, '1', 'C', R3, 'R3 §5.2', 'proposed-fit', 'same pattern, different implement'),
  f('cNeighbourPattern', 0.5, '1', 'C', R3, 'R3 §5.2', 'proposed-fit', 'neighbouring pattern'),
  f('cOtherPattern', 0.2, '1', 'C', R3, 'R3 §5.2', 'proposed-fit', 'any other pattern'),
  f('effortRirThreshold', 3, 'RIR', 'D', R3, 'R3 §5.3', 'proposed-fit', 'RIR above this triggers the "stop closer to failure" fix'),
  // ---- composer and shopping list (R3 §6, PLANNER_V2 §8.3-8.5)
  f('uAvail', 3, '1', 'D', R3, 'R3 §6', 'proposed-fit', 'utility weight of availability'),
  f('uEnjoy', 1, '1', 'D', R3, 'R3 §6', 'proposed-fit'),
  f('uCover', 2, '1', 'D', R3, 'R3 §6', 'proposed-fit'),
  f('uMinutesPer10', 0.5, '1/10 min', 'D', R3, 'R3 §6', 'proposed-fit'),
  f('uInjury', 0.5, '1', 'D', R3, 'R3 §6', 'proposed-fit', 'per injury-risk step above 1'),
  f('uSkillGap', 0.3, '1', 'D', R3, 'R3 §6', 'proposed-fit'),
  f('availOwned', 1.0, '1', 'D', R3, 'R3 §6', 'proposed-fit'),
  f('availAccess', 0.8, '1', 'D', R3, 'R3 §6', 'proposed-fit'),
  f('availAccessOutsideWindow', 0.5, '1', 'D', R3, 'R3 §6', 'proposed-fit'),
  f('availPurchase', 0.5, '1', 'D', SPEC, 'PLANNER_V2 §8.3', 'proposed-fit', 'items in the plan\'s allowed purchase list; R3 uses 0 because it has no allowance'),
  f('maxSetsPerExercise', 5, 'sets', 'D', SPEC, 'PLANNER_V2 §8.3', 'proposed-fit'),
  f('maxExercisesPerPattern', 2, '1', 'D', SPEC, 'PLANNER_V2 §8.3', 'proposed-fit'),
  f('warmupMin', 5, 'min', 'D', SPEC, 'PLANNER_V2 §8.3', 'proposed-fit'),
  f('sessionSetTolerance', 0.5, 'effective sets', 'D', SPEC, 'PLANNER_V2 §8.3', 'proposed-fit', 'per region per session'),
  f('weekTolerance', 0.1, '1', 'D', SPEC, 'PLANNER_V2 §8.3', 'proposed-fit', 'relative, per region per week'),
  f('shopMinDeltaU', 0.05, '1', 'D', R3, 'R3 §6; PLANNER_V2 §8.5', 'proposed-fit', 'items with a smaller utility gain are omitted'),
  // ---- evidence policy (R5 §2-3)
  f('bandFloorA', 0.05, 'rel σ', 'D', R5, 'R5 §2.3', 'proposed-fit'),
  f('bandFloorB', 0.1, 'rel σ', 'D', R5, 'R5 §2.3', 'proposed-fit'),
  f('bandFloorC', 0.2, 'rel σ', 'D', R5, 'R5 §2.3', 'proposed-fit'),
  f('bandFloorD', 0.35, 'rel σ', 'D', R5, 'R5 §2.3', 'proposed-fit'),
  f('tauSigmaBase', 0.1, 'σ ln τ', 'D', R5, 'R5 §3.2', 'proposed-fit', 'σ_τ = base + slope·(1 − S)'),
  f('tauSigmaSlope', 0.5, 'σ ln τ', 'D', R5, 'R5 §3.2', 'proposed-fit'),
  f('tauLo', 0.5, '1', 'D', R5, 'R5 §3.2', 'proposed-fit', 'upper end of the "transfers poorly" uniform component'),
  f('tauWShown', 0.1, '1', 'D', R5, 'R5 §3.2', 'proposed-fit', 'robust weight when every link is shown in humans'),
  f('tauWAssumed', 0.25, '1', 'D', R5, 'R5 §3.2', 'proposed-fit', 'robust weight when a link is assumed or the author is the AI'),
  // ---- food (R4 §3.4-3.5, §4.3)
  f('wKcal', 4, '1', 'D', R4, 'R4 §3.4', 'proposed-fit', 'nutrient weight in the portion-fit solver and the meal equivalence'),
  f('wProtein', 3, '1', 'D', R4, 'R4 §3.4', 'proposed-fit'),
  f('wCarb', 2, '1', 'D', R4, 'R4 §3.4', 'proposed-fit'),
  f('wFibre', 1.5, '1', 'D', R4, 'R4 §3.4', 'proposed-fit'),
  f('wFat', 2, '1', 'D', R4, 'R4 §3.4', 'proposed-fit'),
  f('tolEnergyRel', 0.05, '1', 'D', R4, 'R4 §3.5', 'proposed-fit', '±5 % or ±75 kcal (±310 kJ), whichever is larger'),
  f('tolEnergyAbsKcal', 75, 'kcal', 'D', R4, 'R4 §3.5', 'proposed-fit'),
  f('tolProteinUnder', 0.05, '1', 'D', R4, 'R4 §3.5', 'proposed-fit'),
  f('tolProteinOver', 0.2, '1', 'D', R4, 'R4 §3.5', 'proposed-fit'),
  f('tolCarbRel', 0.1, '1', 'D', R4, 'R4 §3.5', 'proposed-fit'),
  f('tolCarbLowCarbAbsG', 5, 'g', 'D', R4, 'R4 §3.5', 'proposed-fit', 'hard ceiling above target on low-carb days'),
  f('tolFatRel', 0.15, '1', 'D', R4, 'R4 §3.5', 'proposed-fit'),
  f('tolFibreUnder', 0.1, '1', 'D', R4, 'R4 §3.5', 'proposed-fit'),
  f('nutrientTaperRel', 0.5, '1', 'D', 'engineering default (no source): linear taper from the tolerance edge to 0 credit', 'SUITE_SPEC §3.7', 'unverified',
    'Fallback only; the adherence score prefers the engine-sensitivity taper (benefitRetained) when it can run.'),
];

const CAT_INDEX: ReadonlyMap<string, number> = new Map(CATALOGUE_PARAMS.map((d) => [d.id, d.value]));

/** Value of a catalogue constant (`name` without the `catalogue.` prefix). */
export function cp(name: string): number {
  const v = CAT_INDEX.get(`catalogue.${name}`);
  if (v === undefined) throw new Error(`unknown catalogue param ${name}`);
  return v;
}

/** R3 §5.1 intent defaults by goal class (grade D). */
export const INTENT_DEFAULTS = {
  muscle: { hyp: 0.6, str: 0.15, card: 0, kcal: 0.25, mob: 0 },
  strength: { hyp: 0.3, str: 0.6, card: 0, kcal: 0.1, mob: 0 },
  fatLoss: { hyp: 0.4, str: 0.1, card: 0.2, kcal: 0.3, mob: 0 },
  vo2max: { hyp: 0, str: 0, card: 0.7, kcal: 0.3, mob: 0 },
  mobility: { hyp: 0, str: 0, card: 0, kcal: 0, mob: 1 },
} as const satisfies Record<string, StimulusIntent>;
export type GoalClass = keyof typeof INTENT_DEFAULTS;

// ================================================================== engine constants (read from the engine registries)

const ENGINE_INDEX: ReadonlyMap<string, number> = new Map([...MUSCLE_PARAMS, ...ACTIVITY_PARAMS].map((d) => [d.id, d.value]));
function ev(id: string): number {
  const v = ENGINE_INDEX.get(id);
  if (v === undefined) throw new Error(`engine param ${id} not found`);
  return v;
}

/** Nominal engine constants used by the stimulus mapping (muscle 09 §4.1/§4.14, activity 10 §4.1/§4.8). */
export const ENGINE = {
  kRir: ev('muscle.kRir'),
  kRirHeavy: ev('muscle.kRirHeavy'),
  kRirLight: ev('muscle.kRirLight'),
  loadHeavyPct: ev('muscle.loadHeavyPct'),
  loadModeratePct: ev('muscle.loadModeratePct'),
  loadFullPct: ev('muscle.loadFullPct'),
  loadVeryLightPct: ev('muscle.loadVeryLightPct'),
  fLoad20: ev('muscle.fLoad20'),
  fLoadVeryLight: ev('muscle.fLoadVeryLight'),
  fRest60: ev('muscle.fRest60'),
  fRest90: ev('muscle.fRest90'),
  restShortSec: ev('muscle.restShortSec'),
  restFullSec: ev('muscle.restFullSec'),
  fLoadSMod: ev('muscle.fLoadSMod'),
  fLoadSLight: ev('muscle.fLoadSLight'),
  wIndirect: ev('muscle.wIndirect'),
  kcalPerLO2: ev('activity.kcalPerLO2'),
  metVo2: ev('activity.metVo2'),
  walkIntercept: ev('activity.walkIntercept'),
  walkSlope: ev('activity.walkSlope'),
  runVo2PerM: ev('activity.runVo2PerM'),
  runEff: ev('activity.runEff'),
  cycleBaselineMult: ev('activity.cycleBaselineMult'),
  cycleEff: ev('activity.cycleEff'),
  memBand1: ev('activity.memBand1'),
  memBand2: ev('activity.memBand2'),
  memBand3: ev('activity.memBand3'),
  memW1: ev('activity.memW1'),
  memW2: ev('activity.memW2'),
  memW3: ev('activity.memW3'),
  hardX: ev('activity.hardX'),
  vo2HiRefMinWk: ev('activity.vo2HiRefMinWk'),
  rpeIntercept: ev('activity.rpeIntercept'),
  rpeSlope: ev('activity.rpeSlope'),
} as const;
