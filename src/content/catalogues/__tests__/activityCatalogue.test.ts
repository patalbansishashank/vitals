/**
 * SPEC V1.6 catalogue: the immutable Compendium 2024 source table, the log/import-only activity types (air bike, treadmill
 * desk and the rest of the spec's list) beside the unchanged traditional and gym training, the code/analog reference of
 * every entry, and the Health Connect / Google Fit / Gauge alias coverage with sensor traits.
 */
import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_ALIASES,
  ACTIVITY_TRAITS,
  ACTIVITY_TYPE_IDS,
  COMPENDIUM_2024,
  FIT_ALIASES,
  GAUGE_ALIASES,
  HC_ALIASES,
  SEED_CATALOGUE,
  SEED_EXERCISES,
  activityTraitsOf,
  compendiumRow,
  resolveActivityAlias,
} from '@/content/catalogues';

const byId = new Map(SEED_EXERCISES.map((e) => [e.id, e]));

/** Every `ExerciseSessionRecord.EXERCISE_TYPE_*` constant on the Health Connect reference (retrieved 2026-10-27). */
const HC_TYPES: Readonly<Record<string, number>> = {
  OTHER_WORKOUT: 0, BADMINTON: 2, BASEBALL: 4, BASKETBALL: 5, BIKING: 8, BIKING_STATIONARY: 9, BOOT_CAMP: 10, BOXING: 11, CALISTHENICS: 13,
  CRICKET: 14, DANCING: 16, ELLIPTICAL: 25, EXERCISE_CLASS: 26, FENCING: 27, FOOTBALL_AMERICAN: 28, FOOTBALL_AUSTRALIAN: 29, FRISBEE_DISC: 31,
  GOLF: 32, GUIDED_BREATHING: 33, GYMNASTICS: 34, HANDBALL: 35, HIGH_INTENSITY_INTERVAL_TRAINING: 36, HIKING: 37, ICE_HOCKEY: 38,
  ICE_SKATING: 39, MARTIAL_ARTS: 44, PADDLING: 46, PARAGLIDING: 47, PILATES: 48, RACQUETBALL: 50, ROCK_CLIMBING: 51, ROLLER_HOCKEY: 52,
  ROWING: 53, ROWING_MACHINE: 54, RUGBY: 55, RUNNING: 56, RUNNING_TREADMILL: 57, SAILING: 58, SCUBA_DIVING: 59, SKATING: 60, SKIING: 61,
  SNOWBOARDING: 62, SNOWSHOEING: 63, SOCCER: 64, SOFTBALL: 65, SQUASH: 66, STAIR_CLIMBING: 68, STAIR_CLIMBING_MACHINE: 69,
  STRENGTH_TRAINING: 70, STRETCHING: 71, SURFING: 72, SWIMMING_OPEN_WATER: 73, SWIMMING_POOL: 74, TABLE_TENNIS: 75, TENNIS: 76,
  VOLLEYBALL: 78, WALKING: 79, WATER_POLO: 80, WEIGHTLIFTING: 81, WHEELCHAIR: 82, YOGA: 83,
};

const SPEC_IDS = [
  'air_bike', 'air_cycling', 'treadmill_desk_slow', 'stair_climber', 'stepper', 'walk_brisk', 'table_tennis', 'tennis', 'basketball',
  'volleyball', 'boxing', 'martial_arts', 'pilates', 'stretching', 'dance_general', 'gardening', 'housework', 'rowing_water', 'kayak',
  'skating', 'climbing', 'circuit', 'calisthenics', 'other_light', 'other_moderate', 'other_vigorous',
];

describe('Compendium 2024 source table (immutable)', () => {
  it('holds the official rows verbatim, frozen, with measured/estimated status', () => {
    expect(COMPENDIUM_2024.size).toBeGreaterThan(1000);
    expect(COMPENDIUM_2024.size).toBeLessThanOrEqual(1114);
    const est = [...COMPENDIUM_2024.values()].filter((r) => !r.measured).length;
    expect(est).toBeGreaterThan(150);
    expect(est).toBeLessThanOrEqual(202);
    for (const [code, met] of [['01305', 8.8], ['01228', 8.0], ['02119', 4.3], ['11003', 2.0], ['11004', 2.8], ['07030', 1.0], ['02065', 9.3], ['17200', 4.8]] as const) {
      expect(compendiumRow(code)?.met, code).toBe(met);
    }
    expect(compendiumRow('02119')!.description).toMatch(/arms only/);
    expect(compendiumRow('15730')!.measured).toBe(false);
    const r = compendiumRow('11004')!;
    expect(Object.isFrozen(r)).toBe(true);
    expect(r.version).toBe('compendium-2024');
    expect(() => {
      (r as { met: number }).met = 9;
    }).toThrow();
  });
});

describe('activity types (SPEC V1.6)', () => {
  it('every spec type exists, is log/import-only, and existing ids are unchanged', () => {
    for (const id of SPEC_IDS) {
      const e = byId.get(id);
      expect(e, id).toBeDefined();
      expect(e!.prescribable, id).toBe(false);
      expect(ACTIVITY_TYPE_IDS).toContain(id);
    }
    // traditional and gym training are still there, prescribable, with their values
    for (const id of ['mudgar_two_hand', 'gada_swing', 'dand', 'baithak', 'bb_back_squat', 'stationary_bike', 'brisk_walk', 'stepmill', 'pilates_mat']) {
      expect(byId.get(id)?.prescribable, id).toBeUndefined();
    }
    expect(byId.get('mudgar_two_hand')!.energy.metGross).toBe(7.5);
    expect(SEED_EXERCISES.filter((e) => e.prescribable === false).length).toBe(ACTIVITY_TYPE_IDS.length);
  });

  it('the catalogue never contains 02119 (Airdyne arms only) as the air bike', () => {
    const air = byId.get('air_bike')!;
    expect(air.energy.compendiumCode).not.toBe('02119');
    expect(air.energy.analog).toBe(true);
    expect(['01305', '01228']).toContain(air.energy.compendiumCode);
    expect(air.energy.metGross).not.toBe(4.3);
    expect(air.energy.equation).toBe('met');
    expect(SEED_EXERCISES.filter((e) => e.energy.compendiumCode === '02119')).toEqual([]);
  });

  it('treadmill desk uses the active-workstation rows 11003/11004', () => {
    const d = byId.get('treadmill_desk_slow')!;
    expect(d.energy.compendiumCode).toBe('11004');
    expect(d.energy.metGross).toBe(compendiumRow('11004')!.met);
    expect(d.energy.metRange).toEqual([compendiumRow('11003')!.met, compendiumRow('11004')!.met]);
  });

  it('every entry references a code with analog: true or a mapping note; non-analog codes resolve with the same MET', () => {
    const bad: string[] = [];
    for (const e of SEED_EXERCISES) {
      const en = e.energy;
      if (en.analog === undefined) bad.push(`${e.id}: no analog flag`);
      if (en.analog !== true && !(en.mappingNote && en.mappingNote.length > 0)) bad.push(`${e.id}: neither analog nor mapping note`);
      if (en.analog === false) {
        const row = en.compendiumCode ? compendiumRow(en.compendiumCode) : undefined;
        if (!row) bad.push(`${e.id}: code ${en.compendiumCode} not in the table`);
        else if (row.met !== en.metGross) bad.push(`${e.id}: MET ${en.metGross} ≠ official ${row.met}`);
      }
      if (en.analog === true && en.compendiumCode && /^\d{5}$/.test(en.compendiumCode) && !compendiumRow(en.compendiumCode)) bad.push(`${e.id}: analog code ${en.compendiumCode} unresolved`);
    }
    expect(bad).toEqual([]);
  });

  it('activity types never enter composition (prescribable: false keeps plans unchanged)', () => {
    const ids = new Set(ACTIVITY_TYPE_IDS);
    expect(SEED_CATALOGUE.exercises.filter((e) => ids.has(e.id)).every((e) => e.prescribable === false)).toBe(true);
  });
});

describe('import aliases and traits (SPEC V1.6)', () => {
  it('covers every Health Connect exercise type', () => {
    const got = new Map(HC_ALIASES.map((a) => [a.label, a]));
    for (const [name, code] of Object.entries(HC_TYPES)) {
      const a = got.get(`EXERCISE_TYPE_${name}`);
      expect(a, name).toBeDefined();
      expect(a!.code).toBe(String(code));
      expect(byId.has(a!.exerciseId), `${name} → ${a!.exerciseId}`).toBe(true);
    }
    expect(HC_ALIASES.length).toBe(Object.keys(HC_TYPES).length);
  });

  it('covers the Google Fit list (114 types) including the treadmill and stationary codes', () => {
    expect(FIT_ALIASES.length).toBe(114);
    expect(new Set(FIT_ALIASES.map((a) => a.code)).size).toBe(114);
    expect(resolveActivityAlias('fit', 18).exerciseId).toBe('stationary_bike');
    expect(resolveActivityAlias('fit', 18).needsReview).toBe(true); // may be an air bike
    expect(resolveActivityAlias('fit', 58).exerciseId).toBe('treadmill_run');
    expect(resolveActivityAlias('fit', 88).exerciseId).toBe('treadmill_incline_walk');
    expect(resolveActivityAlias('fit', 88).needsReview).toBe(true); // walking or running
    expect(resolveActivityAlias('fit', 95).exerciseId).toBe('treadmill_incline_walk');
    for (const code of [0, 3, 5, 45, 117, 118, 122]) expect(resolveActivityAlias('fit', code).nonActivity, String(code)).toBe(true);
  });

  it('every alias target exists, carries explicit traits, and Gauge/ring types are mapped', () => {
    for (const a of ACTIVITY_ALIASES) {
      expect(byId.has(a.exerciseId), `${a.namespace}:${a.code} → ${a.exerciseId}`).toBe(true);
      expect(ACTIVITY_TRAITS[a.exerciseId], a.exerciseId).toBeDefined();
    }
    for (const id of ACTIVITY_TYPE_IDS) expect(ACTIVITY_TRAITS[id], id).toBeDefined();
    expect(GAUGE_ALIASES.filter((a) => a.namespace === 'gauge').map((a) => a.code).sort()).toEqual(['cycle', 'dance', 'gym', 'hike', 'other', 'run', 'sport', 'squash', 'walk', 'yoga']);
  });

  it('an unknown code maps to other_moderate with needsReview (kept, never dropped or guessed)', () => {
    const u = resolveActivityAlias('hc', 9999, 'EXERCISE_TYPE_NEW');
    expect(u).toMatchObject({ exerciseId: 'other_moderate', needsReview: true, code: '9999', label: 'EXERCISE_TYPE_NEW' });
    expect(resolveActivityAlias('gauge', 'zumba').exerciseId).toBe('other_moderate');
  });

  it('traits: treadmill gait, Keytel domain flags, power only for leg ergometers, gripping work never HR-eligible', () => {
    for (const id of ['treadmill_run', 'treadmill_incline_walk', 'treadmill_desk_slow']) {
      expect(ACTIVITY_TRAITS[id]).toMatchObject({ treadmill: true, stepsLocomotor: true, hrEnergyEligible: 'inDomain' });
    }
    expect(ACTIVITY_TRAITS.air_bike!.hrEnergyEligible).toBe('outOfDomain');
    expect(ACTIVITY_TRAITS.elliptical!.hrEnergyEligible).toBe('outOfDomain');
    expect(ACTIVITY_TRAITS.air_bike!.estimators).not.toContain('power');
    expect(ACTIVITY_TRAITS.row_erg!.estimators).not.toContain('power');
    const withPower = Object.entries(ACTIVITY_TRAITS).filter(([, t]) => t.estimators.includes('power')).map(([id]) => id);
    expect(withPower).toEqual(['stationary_bike']);
    const withSpeed = Object.entries(ACTIVITY_TRAITS).filter(([, t]) => t.estimators.includes('speedGrade'));
    for (const [id, t] of withSpeed) expect(t.stepsLocomotor, id).toBe(true);
    expect(ACTIVITY_TRAITS.cycle_outdoor!.estimators).not.toContain('speedGrade');
    for (const id of ['mudgar_two_hand', 'gada_swing', 'db_curl', 'kb_swing', 'bb_back_squat']) {
      const t = activityTraitsOf(byId.get(id)!);
      expect(t.hrEnergyEligible, id).toBe('never');
      expect(t.stepsLocomotor, id).toBe(false);
    }
    for (const id of ['hiit_bodyweight', 'bike_hiit', 'circuit', 'tennis', 'football', 'dance_general', 'strength_general', 'hatha_yoga']) {
      expect(ACTIVITY_TRAITS[id]!.hrEnergyEligible, id).toBe('never');
    }
  });
});
