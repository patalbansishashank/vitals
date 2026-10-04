/**
 * Runtime vocabularies of the catalogue types (validation, intake chips, AI tool schemas). Each list is checked against
 * its type at compile time in both directions, so adding a member to a union without listing it here fails `tsc`.
 */
import type {
  CardioModality,
  ContraTag,
  EnergyEquation,
  EquipmentCategory,
  ExerciseTag,
  IntensityScale,
  LoadType,
  MovementPattern,
  Tradition,
  TrainingRegion,
  VolumeUnit,
} from './types';

type Exhaustive<T, L extends readonly T[]> = [T] extends [L[number]] ? L : never;
const all =
  <T>() =>
  <const L extends readonly T[]>(l: Exhaustive<T, L>): readonly T[] =>
    l;

export const REGIONS = all<TrainingRegion>()(['chest', 'upperBack', 'shoulders', 'arms', 'core', 'glutes', 'quads', 'hamstrings', 'calves']);

export const PATTERNS = all<MovementPattern>()([
  'squat', 'hinge', 'lunge', 'kneeExtension', 'kneeFlexion', 'calfRaise', 'hipAbduction', 'horizontalPush', 'verticalPush',
  'horizontalPull', 'verticalPull', 'elbowFlexion', 'elbowExtension', 'shoulderIsolation', 'coreFlexion', 'coreAntiExtension',
  'coreAntiRotation', 'carry', 'ballisticHinge', 'rotationalSwing', 'plyometric', 'complex', 'locomotion', 'cycle', 'row',
  'swim', 'sport', 'mobility', 'inversion', 'armBalance', 'balance', 'neck',
]);

export const LOAD_TYPES = all<LoadType>()(['external', 'bodyweight', 'odd-object', 'ballistic', 'isometric', 'cardio', 'mobility']);
export const INTENSITY_SCALES = all<IntensityScale>()(['pct1RM', 'repsToFailure', 'kgRpe', 'holdSec', 'rpe', 'speed', 'power', 'met']);
export const VOLUME_UNITS = all<VolumeUnit>()(['setsReps', 'holds', 'timeOrReps', 'intervals', 'minutes', 'rounds', 'distanceOrTime']);
export const TRADITIONS = all<Tradition>()(['gym', 'home', 'bodyweight', 'outdoor', 'kettlebell', 'bands', 'indian', 'yoga', 'mobility', 'odd-object', 'cardio']);
export const ENERGY_EQUATIONS = all<EnergyEquation>()(['met', 'ludlowWalk', 'acsmWalk', 'acsmRun', 'acsmStep', 'cyclePower', 'pandolf']);
export const CONTRA_TAGS = all<ContraTag>()([
  'shoulder', 'elbow', 'wrist', 'lumbar', 'cervical', 'knee', 'ankle', 'hip', 'hypertension', 'glaucoma', 'osteoporosis',
  'pregnancy', 'pelvic_floor', 'cardiac_unscreened',
]);
export const EXERCISE_TAGS = all<ExerciseTag>()(['jumping', 'highImpact', 'overhead', 'floor', 'noisy', 'supervised']);
export const CARDIO_MODALITIES = all<CardioModality>()(['walk', 'run', 'cycle', 'swim', 'row', 'hiit', 'other']);
export const EQUIPMENT_CATEGORIES = all<EquipmentCategory>()([
  'free-weight', 'band', 'bar', 'machine', 'cardio-machine', 'cardio-outdoor', 'cardio-small', 'outdoor', 'odd-object', 'indian',
  'improvised', 'access', 'accessory', 'combat', 'gym-structure',
]);

/** Patterns that are resistance work (strength specificity applies). */
export const RESISTANCE_PATTERNS: ReadonlySet<MovementPattern> = new Set<MovementPattern>([
  'squat', 'hinge', 'lunge', 'kneeExtension', 'kneeFlexion', 'calfRaise', 'hipAbduction', 'horizontalPush', 'verticalPush',
  'horizontalPull', 'verticalPull', 'elbowFlexion', 'elbowExtension', 'shoulderIsolation', 'coreFlexion', 'coreAntiExtension',
  'coreAntiRotation', 'carry', 'ballisticHinge', 'rotationalSwing', 'plyometric', 'complex', 'inversion', 'armBalance', 'neck',
]);

/** Plain-language region names for user-facing text. */
export const REGION_LABEL: Readonly<Record<TrainingRegion, string>> = {
  chest: 'chest',
  upperBack: 'upper back',
  shoulders: 'shoulders',
  arms: 'arms',
  core: 'trunk',
  glutes: 'glutes',
  quads: 'thighs (front)',
  hamstrings: 'hamstrings',
  calves: 'calves',
};

/** Plain-language pattern names for user-facing text. */
export const PATTERN_LABEL: Readonly<Record<MovementPattern, string>> = {
  squat: 'squat', hinge: 'hip hinge', lunge: 'single-leg', kneeExtension: 'knee extension', kneeFlexion: 'leg curl',
  calfRaise: 'calf', hipAbduction: 'hip abduction', horizontalPush: 'pushing', verticalPush: 'overhead pushing',
  horizontalPull: 'rowing', verticalPull: 'pulling', elbowFlexion: 'curl', elbowExtension: 'triceps',
  shoulderIsolation: 'shoulder', coreFlexion: 'trunk', coreAntiExtension: 'trunk', coreAntiRotation: 'trunk', carry: 'carry',
  ballisticHinge: 'swing', rotationalSwing: 'club and mace swinging', plyometric: 'jumping', complex: 'whole-body',
  locomotion: 'walking or running', cycle: 'cycling', row: 'rowing machine', swim: 'swimming', sport: 'sport',
  mobility: 'mobility', inversion: 'inversion', armBalance: 'arm balance', balance: 'balance', neck: 'neck',
};
