import { expect, it } from 'vitest';
import { mergeBodies } from '../controller';

it('join-merge keeps this device’s value where the synced one is missing or empty, including an empty object', () => {
  const synced = { units: 'metric', labs: {}, notes: '', tags: [], weightKg: 70 };
  const mine = { units: 'imperial', labs: { ldlMmolL: 3.4 }, notes: 'mine', tags: ['a'], weightKg: 71, extra: 1 };
  expect(mergeBodies(synced, mine)).toEqual({ units: 'metric', labs: { ldlMmolL: 3.4 }, notes: 'mine', tags: ['a'], weightKg: 70, extra: 1 });
});
