/** The generated kitchen module equals the R12 seed, and the seed is valid (ids, prefixes, regions, food links). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateKitchenSeed } from '@/catalogues/kitchen';
import { FOOD_FIXTURE } from '../foods.fixture';
import { KITCHEN_COUNTS, KITCHEN_SEED } from '../kitchen';

const ROOT = join(__dirname, '..', '..', '..', '..');
const SEED = JSON.parse(readFileSync(join(ROOT, 'research', 'R12-seed.json'), 'utf8')) as Record<string, unknown>;

describe('kitchen catalogue module', () => {
  it('equals the R12 seed (regenerate with node scripts/kitchen-catalogue.mjs)', () => {
    expect(JSON.parse(JSON.stringify(KITCHEN_SEED))).toEqual(SEED);
  });

  it('is byte-identical to what the generator writes', async () => {
    // @ts-expect-error plain ESM script without types
    const { render } = (await import('../../../../scripts/kitchen-catalogue.mjs')) as { render: (s: unknown) => string };
    expect(readFileSync(join(ROOT, 'src', 'content', 'catalogues', 'kitchen.ts'), 'utf8')).toBe(render(SEED));
  });

  it('has the counts the hand-back reports', () => {
    expect(KITCHEN_COUNTS).toEqual({ equipment: 181, cuisines: 139, staples: 288, pantry: 546, regions: 17 });
  });

  it('passes validation (unique ids, prefixes, regions, preTick ⊆ defaults, no perishable pre-ticked, fixture ids)', () => {
    expect(validateKitchenSeed(KITCHEN_SEED, new Set(FOOD_FIXTURE.map((f) => f.id)))).toEqual([]);
  });

  it('validation catches broken references', () => {
    const bad = {
      ...KITCHEN_SEED,
      equipment: [...KITCHEN_SEED.equipment, { ...KITCHEN_SEED.equipment[0]!, id: 'eq.gas_stove_2' }, { ...KITCHEN_SEED.equipment[1]!, id: 'st.wrong', regionDefault: ['nowhere'] }],
    };
    const errors = validateKitchenSeed(bad);
    expect(errors).toContain('duplicate id eq.gas_stove_2');
    expect(errors).toContain('st.wrong: equipment ids start with eq.');
    expect(errors).toContain('st.wrong: unknown region nowhere');
  });
});
