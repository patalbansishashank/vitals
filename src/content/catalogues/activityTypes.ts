/**
 * Activity types and import aliases (SPEC V1.6, 2026-10-27): external activity codes → canonical Vitals exercise ids, and
 * the sensor-facing traits of each canonical type. Pure data plus two lookups; V2 (`activityDetect`, `activityEnergy`) and
 * V3 (candidate import) read it, the engine never does.
 *
 * Namespaces (`ActivityAlias.namespace`):
 *  - `hc`    Health Connect `ExerciseSessionRecord.EXERCISE_TYPE_*` (androidx.health.connect.client, all 61 constants on the
 *            reference page retrieved 2026-10-27);
 *  - `fit`   Google Fit activity-type integers (developers.google.com/fit/rest/v1/reference/activity-types, all 114 rows,
 *            retrieved 2026-10-27; e.g. 18 stationary biking, 58 treadmill running, 88 treadmill general, 95 treadmill walking);
 *  - `gauge` Gauge's own workout types (`ActivityMeta.ORDER`: walk, run, cycle, gym, squash, sport, yoga, dance, hike, other);
 *  - `ring`  J-Style 2301 sport modes Gauge can start (run, walk).
 * These lists are interoperability taxonomies, not MET lookups (RESEARCH III.A): a label says what was done, never how hard.
 *
 * Mapping policy (warrants: analytically true for the code tables, A; the type → id choice is a product mapping, C):
 *  - a specific Vitals type when one exists; otherwise the intensity-class generic (`other_light | other_moderate |
 *    other_vigorous`, by the activity's typical Compendium range) with `needsReview`, so the person confirms the type;
 *  - an ambiguous code (stationary biking may be an air bike; treadmill general may be a run) keeps `needsReview`;
 *  - a code that is not physical activity (in vehicle, still, tilting, elevator, escalator, meditation, guided breathing) is
 *    `nonActivity` and never becomes a bout;
 *  - an unknown code → `other_moderate` with `needsReview` (`resolveActivityAlias`).
 *
 * Traits (`ActivityTraits`, engineering defaults (P), confidence C, editable per bout in review):
 *  - `stepsLocomotor`: the type's steps are gait inside its own energy (the bout's selected steps are `stepsIncluded`);
 *  - `treadmill`: belt gait, the hands may be fixed (step-fusion rule b);
 *  - `carry`: where the phone usually is (pocket for gait, none for water/cycling/court sports, unknown otherwise);
 *  - `estimators`: the estimators that MAY apply, in V2's booking order. `power` only for leg cycle ergometers (never rowers,
 *    fan bikes or arm ergometers: display watts are not validated metabolic work); `speedGrade` only for gait (never outdoor
 *    cycling from GPS speed); `personalHr` is reserved (no calibration at launch); `keytel` only where `hrEnergyEligible` is
 *    not `never` and D2 is on;
 *  - `hrEnergyEligible` (RESEARCH E5, SPEC V2.4.5): `inDomain` steady walk, run, treadmill and leg cycling; `outOfDomain`
 *    (eligible, flagged, ±50 %) air bike and elliptical; `never` intervals/HIIT, team, racket and dance sports, circuit,
 *    resistance, gripping/isometric work, yoga, water sports, sleep, rest.
 *
 * DECISION defaults encoded here (SPEC §5; recommended defaults, not owner selections until answered):
 *  - D2 (population HR calories): ON only in Keytel's domain; air bike and elliptical eligible but `outOfDomain` (±50 %),
 *    because the owner asked for HR-based air-bike calories. With D2 off V2 books MET and keeps Keytel as a comparison —
 *    the traits do not change.
 *  - D1 (step source): the `treadmill` and `carry` traits feed rule (b) of steps-fuse/1 (S2) and V3's review; the
 *    sole-sustained-gait rule (c) itself is not decided here.
 */
import type { ActivityAlias, ActivityEstimator, ActivityTraits, ExerciseRecord } from '@/catalogues/types';

export const HC_TYPES_VERSION = 'androidx.health.connect ExerciseSessionRecord (2026-10-27)';
export const FIT_TYPES_VERSION = 'google-fit activity-types (2026-10-27)';
export const GAUGE_TYPES_VERSION = 'gauge ActivityMeta.ORDER (2026-10-27)';
export const RING_TYPES_VERSION = 'jstyle-2301 sport modes (2026-10-27)';
/** Version of this alias table and traits (enters candidate estimate revisions). */
export const ACTIVITY_TYPES_VERSION = 'activity-types/1';

/** The generic type of an unknown external code. */
export const UNKNOWN_ACTIVITY_ID = 'other_moderate';

type Flag = 'R' | 'N';
const flags = (f?: Flag): Pick<ActivityAlias, 'needsReview' | 'nonActivity'> =>
  f === 'R' ? { needsReview: true } : f === 'N' ? { nonActivity: true, needsReview: true } : {};
const hc = (code: number, name: string, exerciseId: string, f?: Flag): ActivityAlias => ({
  namespace: 'hc', code: String(code), label: `EXERCISE_TYPE_${name}`, version: HC_TYPES_VERSION, exerciseId, ...flags(f),
});
const fit = (code: number, label: string, exerciseId: string, f?: Flag): ActivityAlias => ({
  namespace: 'fit', code: String(code), label, version: FIT_TYPES_VERSION, exerciseId, ...flags(f),
});
const gauge = (code: string, exerciseId: string, f?: Flag): ActivityAlias => ({ namespace: 'gauge', code, label: code, version: GAUGE_TYPES_VERSION, exerciseId, ...flags(f) });
const ring = (code: string, exerciseId: string, f?: Flag): ActivityAlias => ({ namespace: 'ring', code, label: code, version: RING_TYPES_VERSION, exerciseId, ...flags(f) });

/** Every Health Connect exercise type (61). */
export const HC_ALIASES: readonly ActivityAlias[] = [
  hc(0, 'OTHER_WORKOUT', 'other_moderate', 'R'),
  hc(2, 'BADMINTON', 'badminton'),
  hc(4, 'BASEBALL', 'other_moderate', 'R'),
  hc(5, 'BASKETBALL', 'basketball'),
  hc(8, 'BIKING', 'cycle_outdoor'),
  hc(9, 'BIKING_STATIONARY', 'stationary_bike', 'R'),
  hc(10, 'BOOT_CAMP', 'circuit'),
  hc(11, 'BOXING', 'boxing'),
  hc(13, 'CALISTHENICS', 'calisthenics'),
  hc(14, 'CRICKET', 'cricket'),
  hc(16, 'DANCING', 'dance_general'),
  hc(25, 'ELLIPTICAL', 'elliptical'),
  hc(26, 'EXERCISE_CLASS', 'other_moderate', 'R'),
  hc(27, 'FENCING', 'other_moderate', 'R'),
  hc(28, 'FOOTBALL_AMERICAN', 'other_vigorous', 'R'),
  hc(29, 'FOOTBALL_AUSTRALIAN', 'other_vigorous', 'R'),
  hc(31, 'FRISBEE_DISC', 'other_moderate', 'R'),
  hc(32, 'GOLF', 'other_moderate', 'R'),
  hc(33, 'GUIDED_BREATHING', 'other_light', 'N'),
  hc(34, 'GYMNASTICS', 'calisthenics', 'R'),
  hc(35, 'HANDBALL', 'other_vigorous', 'R'),
  hc(36, 'HIGH_INTENSITY_INTERVAL_TRAINING', 'hiit_bodyweight', 'R'),
  hc(37, 'HIKING', 'hike'),
  hc(38, 'ICE_HOCKEY', 'other_vigorous', 'R'),
  hc(39, 'ICE_SKATING', 'skating'),
  hc(44, 'MARTIAL_ARTS', 'martial_arts'),
  hc(46, 'PADDLING', 'kayak', 'R'),
  hc(47, 'PARAGLIDING', 'other_light', 'R'),
  hc(48, 'PILATES', 'pilates'),
  hc(50, 'RACQUETBALL', 'other_vigorous', 'R'),
  hc(51, 'ROCK_CLIMBING', 'climbing'),
  hc(52, 'ROLLER_HOCKEY', 'other_vigorous', 'R'),
  hc(53, 'ROWING', 'rowing_water'),
  hc(54, 'ROWING_MACHINE', 'row_erg'),
  hc(55, 'RUGBY', 'other_vigorous', 'R'),
  hc(56, 'RUNNING', 'jog_outdoor'),
  hc(57, 'RUNNING_TREADMILL', 'treadmill_run'),
  hc(58, 'SAILING', 'other_light', 'R'),
  hc(59, 'SCUBA_DIVING', 'other_moderate', 'R'),
  hc(60, 'SKATING', 'skating'),
  hc(61, 'SKIING', 'other_vigorous', 'R'),
  hc(62, 'SNOWBOARDING', 'other_moderate', 'R'),
  hc(63, 'SNOWSHOEING', 'other_vigorous', 'R'),
  hc(64, 'SOCCER', 'football'),
  hc(65, 'SOFTBALL', 'other_moderate', 'R'),
  hc(66, 'SQUASH', 'other_vigorous', 'R'),
  hc(68, 'STAIR_CLIMBING', 'stair_climb'),
  hc(69, 'STAIR_CLIMBING_MACHINE', 'stair_climber'),
  hc(70, 'STRENGTH_TRAINING', 'strength_general'),
  hc(71, 'STRETCHING', 'stretching'),
  hc(72, 'SURFING', 'other_moderate', 'R'),
  hc(73, 'SWIMMING_OPEN_WATER', 'swim'),
  hc(74, 'SWIMMING_POOL', 'swim'),
  hc(75, 'TABLE_TENNIS', 'table_tennis'),
  hc(76, 'TENNIS', 'tennis'),
  hc(78, 'VOLLEYBALL', 'volleyball'),
  hc(79, 'WALKING', 'walk'),
  hc(80, 'WATER_POLO', 'other_vigorous', 'R'),
  hc(81, 'WEIGHTLIFTING', 'strength_general'),
  hc(82, 'WHEELCHAIR', 'other_moderate', 'R'),
  hc(83, 'YOGA', 'hatha_yoga'),
];

/** Every Google Fit activity type (114). */
export const FIT_ALIASES: readonly ActivityAlias[] = [
  fit(9, 'Aerobics', 'dance_general', 'R'),
  fit(119, 'Archery', 'other_light', 'R'),
  fit(10, 'Badminton', 'badminton'),
  fit(11, 'Baseball', 'other_moderate', 'R'),
  fit(12, 'Basketball', 'basketball'),
  fit(13, 'Biathlon', 'other_vigorous', 'R'),
  fit(1, 'Biking', 'cycle_outdoor'),
  fit(14, 'Handbiking', 'other_moderate', 'R'),
  fit(15, 'Mountain biking', 'cycle_outdoor', 'R'),
  fit(16, 'Road biking', 'cycle_outdoor'),
  fit(17, 'Spinning', 'spin_class'),
  fit(18, 'Stationary biking', 'stationary_bike', 'R'),
  fit(19, 'Utility biking', 'cycle_outdoor'),
  fit(20, 'Boxing', 'boxing'),
  fit(21, 'Calisthenics', 'calisthenics'),
  fit(22, 'Circuit training', 'circuit'),
  fit(23, 'Cricket', 'cricket'),
  fit(113, 'Crossfit', 'circuit', 'R'),
  fit(106, 'Curling', 'other_light', 'R'),
  fit(24, 'Dancing', 'dance_general'),
  fit(102, 'Diving', 'other_moderate', 'R'),
  fit(117, 'Elevator', 'other_light', 'N'),
  fit(25, 'Elliptical', 'elliptical'),
  fit(103, 'Ergometer', 'other_moderate', 'R'),
  fit(118, 'Escalator', 'other_light', 'N'),
  fit(26, 'Fencing', 'other_moderate', 'R'),
  fit(27, 'Football (American)', 'other_vigorous', 'R'),
  fit(28, 'Football (Australian)', 'other_vigorous', 'R'),
  fit(29, 'Football (Soccer)', 'football'),
  fit(30, 'Frisbee', 'other_moderate', 'R'),
  fit(31, 'Gardening', 'gardening'),
  fit(32, 'Golf', 'other_moderate', 'R'),
  fit(122, 'Guided Breathing', 'other_light', 'N'),
  fit(33, 'Gymnastics', 'calisthenics', 'R'),
  fit(34, 'Handball', 'other_vigorous', 'R'),
  fit(114, 'HIIT', 'hiit_bodyweight', 'R'),
  fit(35, 'Hiking', 'hike'),
  fit(36, 'Hockey', 'other_vigorous', 'R'),
  fit(37, 'Horseback riding', 'other_moderate', 'R'),
  fit(38, 'Housework', 'housework'),
  fit(104, 'Ice skating', 'skating'),
  fit(0, 'In vehicle', 'other_light', 'N'),
  fit(115, 'Interval Training', 'hiit_bodyweight', 'R'),
  fit(39, 'Jumping rope', 'jump_rope'),
  fit(40, 'Kayaking', 'kayak'),
  fit(41, 'Kettlebell training', 'circuit_kb', 'R'),
  fit(42, 'Kickboxing', 'martial_arts'),
  fit(43, 'Kitesurfing', 'other_moderate', 'R'),
  fit(44, 'Martial arts', 'martial_arts'),
  fit(45, 'Meditation', 'other_light', 'N'),
  fit(46, 'Mixed martial arts', 'martial_arts'),
  fit(108, 'Other (unclassified fitness activity)', 'other_moderate', 'R'),
  fit(47, 'P90X exercises', 'circuit', 'R'),
  fit(48, 'Paragliding', 'other_light', 'R'),
  fit(49, 'Pilates', 'pilates'),
  fit(50, 'Polo', 'other_moderate', 'R'),
  fit(51, 'Racquetball', 'other_vigorous', 'R'),
  fit(52, 'Rock climbing', 'climbing'),
  fit(53, 'Rowing', 'rowing_water'),
  fit(54, 'Rowing machine', 'row_erg'),
  fit(55, 'Rugby', 'other_vigorous', 'R'),
  fit(8, 'Running', 'jog_outdoor'),
  fit(56, 'Jogging', 'jog_outdoor'),
  fit(57, 'Running on sand', 'jog_outdoor', 'R'),
  fit(58, 'Running (treadmill)', 'treadmill_run'),
  fit(59, 'Sailing', 'other_light', 'R'),
  fit(60, 'Scuba diving', 'other_moderate', 'R'),
  fit(61, 'Skateboarding', 'other_moderate', 'R'),
  fit(62, 'Skating', 'skating'),
  fit(63, 'Cross skating', 'skating', 'R'),
  fit(105, 'Indoor skating', 'skating'),
  fit(64, 'Inline skating (rollerblading)', 'skating'),
  fit(65, 'Skiing', 'other_vigorous', 'R'),
  fit(66, 'Back-country skiing', 'other_vigorous', 'R'),
  fit(67, 'Cross-country skiing', 'other_vigorous', 'R'),
  fit(68, 'Downhill skiing', 'other_moderate', 'R'),
  fit(69, 'Kite skiing', 'other_moderate', 'R'),
  fit(70, 'Roller skiing', 'other_vigorous', 'R'),
  fit(71, 'Sledding', 'other_moderate', 'R'),
  fit(73, 'Snowboarding', 'other_moderate', 'R'),
  fit(74, 'Snowmobile', 'other_light', 'R'),
  fit(75, 'Snowshoeing', 'other_vigorous', 'R'),
  fit(120, 'Softball', 'other_moderate', 'R'),
  fit(76, 'Squash', 'other_vigorous', 'R'),
  fit(77, 'Stair climbing', 'stair_climb'),
  fit(78, 'Stair-climbing machine', 'stair_climber'),
  fit(79, 'Stand-up paddleboarding', 'other_moderate', 'R'),
  fit(3, 'Still (not moving)', 'other_light', 'N'),
  fit(80, 'Strength training', 'strength_general'),
  fit(81, 'Surfing', 'other_moderate', 'R'),
  fit(82, 'Swimming', 'swim'),
  fit(84, 'Swimming (open water)', 'swim'),
  fit(83, 'Swimming (swimming pool)', 'swim'),
  fit(85, 'Table tennis (ping pong)', 'table_tennis'),
  fit(86, 'Team sports', 'other_vigorous', 'R'),
  fit(87, 'Tennis', 'tennis'),
  fit(5, 'Tilting (sudden device gravity change)', 'other_light', 'N'),
  fit(88, 'Treadmill (walking or running)', 'treadmill_incline_walk', 'R'),
  fit(4, 'Unknown (unable to detect activity)', 'other_moderate', 'R'),
  fit(89, 'Volleyball', 'volleyball'),
  fit(90, 'Volleyball (beach)', 'volleyball', 'R'),
  fit(91, 'Volleyball (indoor)', 'volleyball'),
  fit(92, 'Wakeboarding', 'other_moderate', 'R'),
  fit(7, 'Walking', 'walk'),
  fit(93, 'Walking (fitness)', 'walk_brisk'),
  fit(94, 'Nording walking', 'walk_brisk', 'R'),
  fit(95, 'Walking (treadmill)', 'treadmill_incline_walk'),
  fit(116, 'Walking (stroller)', 'walk'),
  fit(96, 'Waterpolo', 'other_vigorous', 'R'),
  fit(97, 'Weightlifting', 'strength_general'),
  fit(98, 'Wheelchair', 'other_moderate', 'R'),
  fit(99, 'Windsurfing', 'other_moderate', 'R'),
  fit(100, 'Yoga', 'hatha_yoga'),
  fit(101, 'Zumba', 'dance_general'),
];

/** Gauge workout types and the ring's sport modes. */
export const GAUGE_ALIASES: readonly ActivityAlias[] = [
  gauge('walk', 'walk'),
  gauge('run', 'jog_outdoor'),
  gauge('cycle', 'cycle_outdoor', 'R'),
  gauge('gym', 'strength_general', 'R'),
  gauge('squash', 'other_vigorous', 'R'),
  gauge('sport', 'other_moderate', 'R'),
  gauge('yoga', 'hatha_yoga'),
  gauge('dance', 'dance_general'),
  gauge('hike', 'hike'),
  gauge('other', 'other_moderate', 'R'),
  ring('run', 'jog_outdoor', 'R'),
  ring('walk', 'walk'),
];

export const ACTIVITY_ALIASES: readonly ActivityAlias[] = [...HC_ALIASES, ...FIT_ALIASES, ...GAUGE_ALIASES];

const BY_KEY: ReadonlyMap<string, ActivityAlias> = new Map(ACTIVITY_ALIASES.map((a) => [`${a.namespace}:${a.code}`, a]));

/**
 * The alias of an external code; an unknown code resolves to `other_moderate` with `needsReview` (never dropped, never a
 * guessed specific type). The returned alias keeps the external code and label as given.
 */
export function resolveActivityAlias(namespace: ActivityAlias['namespace'], code: string | number, label?: string): ActivityAlias {
  const hit = BY_KEY.get(`${namespace}:${String(code)}`);
  if (hit) return hit;
  return { namespace, code: String(code), label: label ?? String(code), version: 'unknown', exerciseId: UNKNOWN_ACTIVITY_ID, needsReview: true };
}

/**
 * (0.6.7 AD-VITALS) Health Connect's symbolic exercise names (`ExerciseSessionRecord.EXERCISE_TYPE_INT_TO_STRING_MAP`,
 * what Gauge sends as `exercise_type`, e.g. "running_treadmill") → their integer code, from the alias table's labels.
 */
const HC_CODE_BY_NAME: ReadonlyMap<string, number> = new Map(
  HC_ALIASES.map((a) => [a.label.replace(/^EXERCISE_TYPE_/, '').toLowerCase(), Number(a.code)] as const),
);

/**
 * The Health Connect integer code of an exercise type as an upload names it: an integer as it is; a known symbolic name
 * ("running_treadmill", any case); Gauge's "type_<n>" for a code its SDK had no name for. Null otherwise.
 */
export function hcExerciseCodeOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v < 10_000 ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  const hit = HC_CODE_BY_NAME.get(s.replace(/^exercise_type_/, ''));
  if (hit !== undefined) return hit;
  const m = /^type_(\d{1,4})$/.exec(s);
  return m ? Number(m[1]) : null;
}

// ------------------------------------------------------------------ traits

const GAIT: readonly ActivityEstimator[] = ['reported', 'speedGrade', 'personalHr', 'keytel', 'met'];
const LEG_CYCLE: readonly ActivityEstimator[] = ['reported', 'power', 'personalHr', 'keytel', 'met'];
const HR_FLAGGED: readonly ActivityEstimator[] = ['reported', 'keytel', 'met'];
const MET_ONLY: readonly ActivityEstimator[] = ['reported', 'met'];

const T = (stepsLocomotor: boolean, carry: ActivityTraits['carry'], estimators: readonly ActivityEstimator[], hrEnergyEligible: ActivityTraits['hrEnergyEligible'], treadmill = false): ActivityTraits =>
  Object.freeze({ stepsLocomotor, treadmill, carry, estimators, hrEnergyEligible });

/** Traits of every alias target and every activity type (explicit; `activityTraitsOf` derives the rest). */
export const ACTIVITY_TRAITS: Readonly<Record<string, ActivityTraits>> = {
  // gait
  walk: T(true, 'pocket', GAIT, 'inDomain'),
  brisk_walk: T(true, 'pocket', GAIT, 'inDomain'),
  walk_brisk: T(true, 'pocket', GAIT, 'inDomain'),
  hike: T(true, 'pocket', GAIT, 'inDomain'),
  jog_outdoor: T(true, 'pocket', GAIT, 'inDomain'),
  treadmill_run: T(true, 'pocket', GAIT, 'inDomain', true),
  treadmill_incline_walk: T(true, 'pocket', GAIT, 'inDomain', true),
  treadmill_walk: T(true, 'pocket', GAIT, 'inDomain', true),
  treadmill_desk_slow: T(true, 'pocket', GAIT, 'inDomain', true),
  stair_climb: T(true, 'pocket', MET_ONLY, 'never'),
  stair_climber: T(true, 'pocket', MET_ONLY, 'never'),
  stepper: T(true, 'pocket', MET_ONLY, 'never'),
  // cycling and machines
  cycle_outdoor: T(false, 'none', ['reported', 'personalHr', 'keytel', 'met'], 'inDomain'),
  stationary_bike: T(false, 'none', LEG_CYCLE, 'inDomain'),
  spin_class: T(false, 'none', HR_FLAGGED, 'outOfDomain'),
  bike_hiit: T(false, 'none', MET_ONLY, 'never'),
  air_bike: T(false, 'none', HR_FLAGGED, 'outOfDomain'),
  elliptical: T(false, 'none', HR_FLAGGED, 'outOfDomain'),
  row_erg: T(false, 'none', MET_ONLY, 'never'),
  air_cycling: T(false, 'none', MET_ONLY, 'never'),
  // water
  swim: T(false, 'none', MET_ONLY, 'never'),
  rowing_water: T(false, 'none', MET_ONLY, 'never'),
  kayak: T(false, 'none', MET_ONLY, 'never'),
  // court, field and combat sports, dance
  badminton: T(true, 'none', MET_ONLY, 'never'),
  table_tennis: T(true, 'none', MET_ONLY, 'never'),
  tennis: T(true, 'none', MET_ONLY, 'never'),
  basketball: T(true, 'none', MET_ONLY, 'never'),
  volleyball: T(true, 'none', MET_ONLY, 'never'),
  football: T(true, 'none', MET_ONLY, 'never'),
  cricket: T(true, 'none', MET_ONLY, 'never'),
  boxing: T(false, 'none', MET_ONLY, 'never'),
  martial_arts: T(false, 'none', MET_ONLY, 'never'),
  dance_general: T(true, 'unknown', MET_ONLY, 'never'),
  skating: T(false, 'unknown', MET_ONLY, 'never'),
  climbing: T(false, 'none', MET_ONLY, 'never'),
  jump_rope: T(false, 'unknown', MET_ONLY, 'never'),
  // conditioning, resistance, mind-body
  hiit_bodyweight: T(false, 'unknown', MET_ONLY, 'never'),
  circuit: T(false, 'unknown', MET_ONLY, 'never'),
  circuit_kb: T(false, 'unknown', MET_ONLY, 'never'),
  calisthenics: T(false, 'unknown', MET_ONLY, 'never'),
  strength_general: T(false, 'unknown', MET_ONLY, 'never'),
  pilates: T(false, 'none', MET_ONLY, 'never'),
  stretching: T(false, 'none', MET_ONLY, 'never'),
  hatha_yoga: T(false, 'none', MET_ONLY, 'never'),
  // daily life
  gardening: T(true, 'pocket', MET_ONLY, 'never'),
  housework: T(true, 'pocket', MET_ONLY, 'never'),
  // generic intensity classes
  other_light: T(false, 'unknown', MET_ONLY, 'never'),
  other_moderate: T(false, 'unknown', MET_ONLY, 'never'),
  other_vigorous: T(false, 'unknown', MET_ONLY, 'never'),
};

/**
 * Traits of any catalogue exercise: the explicit row, else derived from the record (walking/running cardio = gait in the
 * pocket with the gait estimators, in Keytel's domain; every other item = MET only, never HR energy — resistance,
 * gripping and isometric work such as mudgar, gada, dumbbells and kettlebells are never HR-energy eligible).
 */
export function activityTraitsOf(ex: Pick<ExerciseRecord, 'id' | 'cardioModality' | 'loadType'>): ActivityTraits {
  const own = ACTIVITY_TRAITS[ex.id];
  if (own) return own;
  const gait = ex.loadType === 'cardio' && (ex.cardioModality === 'walk' || ex.cardioModality === 'run');
  return gait ? T(true, 'pocket', GAIT, 'inDomain') : T(false, 'unknown', MET_ONLY, 'never');
}
