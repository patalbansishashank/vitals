import { describe, expect, it } from 'vitest';
import { energyInText, formatEnergy } from '../lib/energy';

describe('energy units', () => {
  it('formats kcal and kJ with thin-space grouping', () => {
    expect(formatEnergy(2840, 'kcal')).toBe('2\u00a0840\u2009kcal');
    expect(formatEnergy(2840, 'kJ')).toBe('11\u00a0880\u2009kJ');
    expect(formatEnergy(-480, 'kJ', { signed: true, withUnit: false })).toBe('\u22122\u00a0010');
  });

  it('rewrites engine-written kcal text in kJ mode only', () => {
    const t = 'Your deficit (734 kcal/day) is above about 2 130 kcal/day. Two 600-kcal days; 30 kcal/kg FFM.';
    expect(energyInText(t, 'kcal')).toBe(t);
    expect(energyInText(t, 'kJ')).toBe(
      'Your deficit (3\u00a0070 kJ/day) is above about 8\u00a0910 kJ/day. Two 2\u00a0510-kJ days; 126 kJ/kg FFM.',
    );
    expect(energyInText('Under 800 kcal a day.', 'kJ')).toBe('Under 3\u00a0350 kJ a day.');
    expect(energyInText('no energy here', 'kJ')).toBe('no energy here');
    expect(energyInText('Fibre is 8 g per 1000 kcal (target 14+). Low fibre.', 'kJ')).toBe(
      'Fibre is 1.9 g per 1000 kJ (target 3.3+). Low fibre.',
    );
    expect(energyInText('Energy left after exercise is 29 kcal/kg lean mass/day, below the ~30 level linked to', 'kJ')).toBe(
      'Energy left after exercise is 121 kJ/kg lean mass/day, below the ~126 level linked to',
    );
  });
});
