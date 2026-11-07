/**
 * Health Connect ExerciseSession types on read (r065 autodetect CONTRACT §2): Gauge 2.8+ uploads the symbolic name
 * (`exercise_type: "running_treadmill"`) with the integer (`exercise_type_code: 57`); older uploads carry the integer in
 * `exercise_type`. `gauge_hc` and the timeline answer both normalised: `exercise_type` the symbolic name and
 * `exercise_type_code` the integer (null when unknown). The stored events stay as uploaded.
 *
 * Codes and names are androidx.health.connect.client `ExerciseSessionRecord` (1.1.0): the canonical name of a constant
 * is its lower-case suffix; the client's extra string aliases (`bench_press`, `para_gliding`, `workout`, …) and Gauge's
 * fallback `type_<code>` are read too.
 */

const CANONICAL: Readonly<Record<number, string>> = {
  0: 'other_workout', 2: 'badminton', 4: 'baseball', 5: 'basketball', 8: 'biking', 9: 'biking_stationary', 10: 'boot_camp', 11: 'boxing',
  13: 'calisthenics', 14: 'cricket', 16: 'dancing', 25: 'elliptical', 26: 'exercise_class', 27: 'fencing', 28: 'football_american',
  29: 'football_australian', 31: 'frisbee_disc', 32: 'golf', 33: 'guided_breathing', 34: 'gymnastics', 35: 'handball',
  36: 'high_intensity_interval_training', 37: 'hiking', 38: 'ice_hockey', 39: 'ice_skating', 44: 'martial_arts', 46: 'paddling',
  47: 'paragliding', 48: 'pilates', 50: 'racquetball', 51: 'rock_climbing', 52: 'roller_hockey', 53: 'rowing', 54: 'rowing_machine',
  55: 'rugby', 56: 'running', 57: 'running_treadmill', 58: 'sailing', 59: 'scuba_diving', 60: 'skating', 61: 'skiing', 62: 'snowboarding',
  63: 'snowshoeing', 64: 'soccer', 65: 'softball', 66: 'squash', 68: 'stair_climbing', 69: 'stair_climbing_machine', 70: 'strength_training',
  71: 'stretching', 72: 'surfing', 73: 'swimming_open_water', 74: 'swimming_pool', 75: 'table_tennis', 76: 'tennis', 78: 'volleyball',
  79: 'walking', 80: 'water_polo', 81: 'weightlifting', 82: 'wheelchair', 83: 'yoga',
};

/** The Health Connect client's other string names. */
const ALIASES: Readonly<Record<string, number>> = {
  workout: 0, other: 0, para_gliding: 47,
  back_extension: 13, bench_sit_up: 13, burpee: 13, crunch: 13, forward_twist: 13, jumping_jack: 13, lunge: 13, plank: 13, squat: 13, upper_twist: 13,
  barbell_shoulder_press: 70, bench_press: 70, deadlift: 70, dumbbell_curl_left_arm: 70, dumbbell_curl_right_arm: 70, dumbbell_front_raise: 70,
  dumbbell_lateral_raise: 70, dumbbell_triceps_extension_left_arm: 70, dumbbell_triceps_extension_right_arm: 70, dumbbell_triceps_extension_two_arm: 70,
  lat_pull_down: 70,
};

const BY_NAME: ReadonlyMap<string, number> = new Map([...Object.entries(CANONICAL).map(([c, name]) => [name, Number(c)] as const), ...Object.entries(ALIASES)]);

/** The code of a symbolic name (`running_treadmill`, `EXERCISE_TYPE_RUNNING_TREADMILL`, `type_57`), or null. */
export function exerciseCodeOf(name: string): number | null {
  const k = name.trim().toLowerCase().replace(/^exercise_type_/, '');
  const m = /^type_(\d{1,4})$/.exec(k);
  if (m) return Number(m[1]);
  return BY_NAME.get(k) ?? null;
}

/** The symbolic name of a code (the canonical one; `type_<code>` for a code this table does not know). */
export const exerciseNameOf = (code: number): string => CANONICAL[code] ?? `type_${code}`;

const isCode = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10_000;

/** `{ name, code }` of an ExerciseSession payload: the integer wins when both are given; null where unknown. */
export function exerciseTypeOf(p: Record<string, unknown>): { name: string | null; code: number | null } {
  const raw = p.exercise_type;
  const given = isCode(p.exercise_type_code) ? p.exercise_type_code : null;
  if (isCode(raw)) {
    const code = given ?? raw;
    return { name: exerciseNameOf(code), code };
  }
  if (typeof raw === 'string' && raw.trim()) {
    const code = given ?? exerciseCodeOf(raw);
    return { name: raw.trim().toLowerCase(), code };
  }
  return given !== null ? { name: exerciseNameOf(given), code: given } : { name: null, code: null };
}

/** The payload with `exercise_type` (name) and `exercise_type_code` (integer) normalised; anything else untouched. */
export function normaliseExercisePayload(p: unknown): unknown {
  if (typeof p !== 'object' || p === null || Array.isArray(p)) return p;
  const t = exerciseTypeOf(p as Record<string, unknown>);
  return { ...(p as Record<string, unknown>), exercise_type: t.name, exercise_type_code: t.code };
}
