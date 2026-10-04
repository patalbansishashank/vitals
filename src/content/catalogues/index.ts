/**
 * Seed catalogues (E8 data): 170 exercises (gym, home, bodyweight, bands, kettlebell, odd objects, yoga, mobility, cardio
 * and Indian traditional training), 64 equipment items, 23 supplements (+12 "no expected benefit", 2 advisories), the
 * source table, and a small food fixture for tests. `SEED_CATALOGUE` is the assembled, validated catalogue; merge the
 * user's extension with `createCatalogue(SEED_INPUT, user)`.
 */
import { createCatalogue, exerciseMapping, type CatalogueInput } from '@/catalogues';
import type { MappingDef } from '@/catalogues';
import { SEED_EQUIPMENT } from './equipment';
import { SEED_EXERCISES } from './exercises';
import { CATALOGUE_SOURCES } from './sources';
import { SEED_SUPPLEMENTS } from './supplements';

export { SEED_EXERCISES } from './exercises';
export { SEED_EQUIPMENT } from './equipment';
export { SEED_SUPPLEMENTS, NO_EXPECTED_BENEFIT, SUPPLEMENT_ADVISORIES } from './supplements';
export { CATALOGUE_SOURCES } from './sources';
export { FOOD_FIXTURE, FOOD_FIXTURE_SOURCES } from './foods.fixture';

/** Version of the seed data; logged sessions record it (SUITE_SPEC `catalogueVersion`). */
export const CATALOGUE_VERSION = 'seed-2026.10.01';

/** Mapping records (R5) of every mapped seed exercise. */
export const SEED_MAPPINGS: readonly MappingDef[] = SEED_EXERCISES.map(exerciseMapping).filter((m): m is MappingDef => m !== null);

export const SEED_INPUT: CatalogueInput = {
  version: CATALOGUE_VERSION,
  exercises: SEED_EXERCISES,
  equipment: SEED_EQUIPMENT,
  supplements: SEED_SUPPLEMENTS,
  sources: CATALOGUE_SOURCES,
  mappings: SEED_MAPPINGS,
};

export const SEED_CATALOGUE = createCatalogue(SEED_INPUT);
