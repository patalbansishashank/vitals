/**
 * Additive wire adapters of the 2026-10-18 contracts: the command input schemas accept the new optional fields while
 * existing inputs stay valid (D1-03, D3-05, D3-07, D4-02, D4-05, D5-01, D5-05, D5-06, D5-07, D6-01, D6-04, D6-06, D7-04).
 * The profile-model sanitizers are covered in `src/state/__tests__/profileContracts.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { getCommand } from '@/commands/registry';
import { Value } from '@/commands/schema';
import '@/commands/defs/living';
import '@/commands/defs/profile';
import { supplementRowContractErrors } from '@/commands/defs/intake';

const errorsOf = (id: string, input: unknown) => {
  const def = getCommand(id);
  if (!def) throw new Error(`no command ${id}`);
  return Value.Errors(def.input, input).map((e) => `${e.path} ${e.message}`);
};

describe('command input schemas: new optional fields, old inputs unchanged', () => {
  it('log.confirmDay takes an explicit day intake report; a meal flag remains meal-level only', () => {
    expect(errorsOf('log.confirmDay', { date: '2026-10-18' })).toEqual([]);
    expect(errorsOf('log.confirmDay', { date: '2026-10-18', intake: 'none' })).toEqual([]);
    expect(errorsOf('log.confirmDay', { date: '2026-10-18', intake: 'mostly' })).not.toEqual([]);
    expect(errorsOf('log.meal', { components: [], method: 'typed', complete: true })).toEqual([]);
  });

  it('log.meal carries occurrence, amount method, carbohydrate basis, batch fraction and form', () => {
    const input = {
      date: '2026-10-17',
      clockH: 22,
      occurredAt: '2026-10-17T22:00:00+05:30',
      components: [{ name: 'dal', grams: 250, amountMethod: 'household', carbBasis: 'available', batchFraction: 0.25, labelPer100g: { energyKcal: 120 } }],
      method: 'typed',
      extra: true,
      intakeDurationH: 0.5,
      form: 'solid',
    };
    expect(errorsOf('log.meal', input)).toEqual([]);
    expect(errorsOf('log.meal', { ...input, components: [{ name: 'dal', amountMethod: 'guessed' }] })).not.toEqual([]);
    expect(errorsOf('log.meal', { ...input, occurredAt: 'last night' })).not.toEqual([]);
  });

  it('log.substance keeps its unit enum and adds occurrence and explicit item identity', () => {
    expect(errorsOf('log.substance', { substance: 'caffeine', clockH: 8, amount: 100, unit: 'mg' })).toEqual([]);
    expect(errorsOf('log.substance', { substance: 'creatine', clockH: 8, amount: 5000, unit: 'mg', occurredAt: '2026-10-18T08:00:00Z', itemId: 'sup:creatine', extra: false })).toEqual([]);
    expect(errorsOf('log.substance', { substance: 'alcohol', clockH: 20, amount: 2, unit: 'pints' })).not.toEqual([]);
  });

  it('log.supplement takes a label serving; unknown potency is valid, unknown identities are not', () => {
    const product = { servingAmount: 1, servingUnit: 'tablet', actives: [{ ingredient: 'magnesium', amount: null, unit: 'mg', basis: 'elemental' }] };
    expect(errorsOf('log.supplement', { supplementId: 'magnesium', dose: 2, unit: 'tablet' })).toEqual([]);
    expect(errorsOf('log.supplement', { supplementId: 'magnesium', dose: 2, unit: 'tablet', servings: 2, product })).toEqual([]);
    expect(errorsOf('log.supplement', { supplementId: 'magnesium', dose: 2, unit: 'tablet', product: { ...product, actives: [{ ...product.actives[0], ingredient: 'unobtainium' }] } })).not.toEqual([]);
  });

  it('log.subjective adds fixed-time ratings, concerns and a symptom report', () => {
    expect(errorsOf('log.subjective', { hunger: 6 })).toEqual([]);
    expect(errorsOf('log.subjective', { hunger: 6, fullness: 3, craving: 7, ratedAtClockH: 11, fatigue: 8, concerns: ['persistentFatigue', 'menstrualChange'], symptom: { category: 'exertionalChestDiscomfort', status: 'new', context: 'exertional' } })).toEqual([]);
    expect(errorsOf('log.subjective', { concerns: ['burnout'] })).not.toEqual([]);
    expect(errorsOf('log.subjective', { symptom: { category: 'exertionalChestDiscomfort', status: 'maybe' } })).not.toEqual([]);
  });

  it('log.measurement adds occurrence, scan masses, BP pairing and ketone specimen', () => {
    expect(errorsOf('log.measurement', { metric: 'weightKg', value: 80 })).toEqual([]);
    expect(errorsOf('log.measurement', { metric: 'bodyFatPct', value: 24, method: 'dxa', occurredAt: '2026-10-01T08:30:00+05:30', device: 'Hologic', scanMassKg: 80, scanFatMassKg: 19.2 })).toEqual([]);
    expect(errorsOf('log.measurement', { metric: 'sbpMmHg', value: 128, episodeId: 'bp-1', restMin: 5, setting: 'home', timeOfDay: 'morning' })).toEqual([]);
    expect(errorsOf('log.measurement', { metric: 'ketonesMmolL', value: 1.2, specimen: 'capillaryBlood' })).toEqual([]);
    expect(errorsOf('log.measurement', { metric: 'ketonesMmolL', value: 1.2, specimen: 'sweat' })).not.toEqual([]);
  });

  it('log.steps and log.fast take scope and protocol; plan.checkIn takes the preview being confirmed', () => {
    expect(errorsOf('log.steps', { steps: 9000, scope: 'totalDay' })).toEqual([]);
    expect(errorsOf('log.fast', { action: 'start', protocol: 'modified' })).toEqual([]);
    expect(errorsOf('plan.checkIn', {})).toEqual([]);
    expect(errorsOf('plan.checkIn', { previewId: 'chk-2026-10-18' })).toEqual([]);
  });

  it('profile.patch accepts measurement provenance and habit context with null clears', () => {
    expect(errorsOf('profile.patch', { knownBodyFat: { use: true, pct: 22, source: 'dxa', measuredOn: '2026-10-01', scanMassKg: 80, scanFatMassKg: 17.6, parentIds: ['raw-1'] } })).toEqual([]);
    expect(errorsOf('profile.patch', { waist: { cm: 84, landmark: 'iliacCrest', measuredOn: null } })).toEqual([]);
    expect(errorsOf('profile.patch', { habits: { stepsScope: 'excludesTraining', trainingGrowthState: null } })).toEqual([]);
    expect(errorsOf('profile.patch', { waist: { landmark: 'kneecap' } })).not.toEqual([]);
  });
});

describe('intake supplements rows (D7-04)', () => {
  it('validates optional product/schedule shapes; legacy rows and unknown potency are valid', () => {
    const legacy = { _v: 2, stance: 'taking', rows: [{ supplementId: 'creatine', state: 'taking', dose: 5, unit: 'g', timesOfDay: ['morning'] }] };
    expect(supplementRowContractErrors(legacy)).toEqual([]);
    const ok = {
      ...legacy,
      rows: [
        {
          ...legacy.rows[0],
          product: { servingAmount: 5, servingUnit: 'g', actives: [{ ingredient: 'creatine', amount: 5, unit: 'g', basis: 'asLabelled' }] },
          schedule: { kind: 'weekly', daysOfWeek: [0, 3] },
        },
        { supplementId: 'vitD', state: 'taking', timesOfDay: [], product: { servingAmount: 1, servingUnit: 'capsule', actives: [{ ingredient: 'vitD', amount: null, unit: 'ug', basis: 'asLabelled' }] } },
      ],
    };
    expect(supplementRowContractErrors(ok)).toEqual([]);
    const bad = { ...legacy, rows: [{ ...legacy.rows[0], product: { servingAmount: 0, servingUnit: 'g', actives: [{ ingredient: 'creatine', amount: -1, unit: 'g', basis: 'magic' }] }, schedule: { kind: 'sometimes' } }] };
    const errs = supplementRowContractErrors(bad).map((e) => e.path);
    expect(errs.some((p) => p.startsWith('/rows/0/product'))).toBe(true);
    expect(errs.some((p) => p.startsWith('/rows/0/schedule'))).toBe(true);
    expect(supplementRowContractErrors(null)).toEqual([]);
  });
});
