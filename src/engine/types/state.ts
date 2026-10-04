/**
 * Full engine state (docs/MODEL_SPEC.md §1): one plain object per module, owned and defined by that module's folder.
 * `structuredClone(state)` is a valid snapshot (typed arrays included) for planner warm starts and re-planning.
 */
import type { ModeratorsState } from '../model/moderators';
import type { ActivityState } from '../model/activity';
import type { IntakeState } from '../model/intake';
import type { FastingState } from '../model/fasting';
import type { EnergyState } from '../model/energy';
import type { FuelState } from '../model/fuel';
import type { KetonesState } from '../model/ketones';
import type { CompositionState } from '../model/composition';
import type { MuscleState } from '../model/muscle';
import type { WaterState } from '../model/water';
import type { CellularState } from '../model/cellular';
import type { HormonesState } from '../model/hormones';
import type { AppetiteState } from '../model/appetite';
import type { CardiometabolicState } from '../model/cardiometabolic';
import type { WellbeingState } from '../model/wellbeing';
import type { SafetyState } from '../model/safety';
import type { SignalBus } from './signals';

export interface EngineState {
  moderators: ModeratorsState;
  activity: ActivityState;
  intake: IntakeState;
  fasting: FastingState;
  energy: EnergyState;
  fuel: FuelState;
  ketones: KetonesState;
  composition: CompositionState;
  muscle: MuscleState;
  water: WaterState;
  cellular: CellularState;
  hormones: HormonesState;
  appetite: AppetiteState;
  cardiometabolic: CardiometabolicState;
  wellbeing: WellbeingState;
  safety: SafetyState;
}

/** Serializable, versioned snapshot (dossier 18 §4.18 re-planning). */
export interface StateSnapshot {
  engineVersion: string;
  registryHash: string;
  day: number;
  state: EngineState;
  bus: SignalBus;
}

export type {
  ModeratorsState,
  ActivityState,
  IntakeState,
  FastingState,
  EnergyState,
  FuelState,
  KetonesState,
  CompositionState,
  MuscleState,
  WaterState,
  CellularState,
  HormonesState,
  AppetiteState,
  CardiometabolicState,
  WellbeingState,
  SafetyState,
};
