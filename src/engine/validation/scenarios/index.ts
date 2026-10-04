/**
 * Registry of every end-to-end scenario of MODEL_SPEC §9.2, plus the oracle comparisons O-1 / O-2 of §9.1.
 * One file per dossier group; each exports a `Scenario[]`.
 */
import type { Scenario } from '../harness/types';
import { SCENARIOS_01 } from './d01';
import { SCENARIOS_LONGLAND } from './longland';
import { SCENARIOS_ORACLE } from './oracle';
import { SCENARIOS_ENERGY } from './energyActivity';
import { SCENARIOS_FASTING } from './fasting';
import { SCENARIOS_FUEL_KETONE } from './fuelKetone';
import { SCENARIOS_OTHER } from './other';
import { SCENARIOS_PROTEIN } from './protein';
import { SCENARIOS_ACTIVITY_INTAKE } from './activityIntake';

export const ALL_SCENARIOS: readonly Scenario[] = [
  ...SCENARIOS_ORACLE,
  ...SCENARIOS_01,
  ...SCENARIOS_LONGLAND,
  ...SCENARIOS_ENERGY,
  ...SCENARIOS_PROTEIN,
  ...SCENARIOS_FUEL_KETONE,
  ...SCENARIOS_FASTING,
  ...SCENARIOS_OTHER,
  ...SCENARIOS_ACTIVITY_INTAKE,
];

/** Scenario by id. */
export function scenarioById(id: string): Scenario | undefined {
  return ALL_SCENARIOS.find((s) => s.id === id);
}

export { SCENARIOS_01, SCENARIOS_LONGLAND, SCENARIOS_ORACLE, SCENARIOS_ENERGY, SCENARIOS_FASTING, SCENARIOS_FUEL_KETONE, SCENARIOS_OTHER, SCENARIOS_PROTEIN, SCENARIOS_ACTIVITY_INTAKE };
