import { describe, expect, it } from 'vitest';
import { energyInText, formatEnergy, formatEnergyRange } from '../lib/energy';

describe('energy units', () => {
  it('formats signed ranges with unambiguous minus signs in either unit', () => {
    expect(formatEnergyRange(-7, -6, 'kcal')).toBe('−7 to −6\u2009kcal');
    expect(formatEnergyRange(-7, 6, 'kcal', { withUnit: false })).toBe('−7 to 6');
    expect(formatEnergyRange(7, 16, 'kcal', { withUnit: false })).toBe('7–16');
    expect(formatEnergyRange(-7, -6, 'kJ')).toBe('−30 to −30\u2009kJ');
  });
  it('formats kcal and kJ with comma grouping and a separate unit space', () => {
    expect(formatEnergy(2840, 'kcal')).toBe('2,840\u2009kcal');
    expect(formatEnergy(2840, 'kJ')).toBe('11,880\u2009kJ');
    expect(formatEnergy(-480, 'kJ', { signed: true, withUnit: false })).toBe('\u22122,010');
  });

  it('rewrites engine-written kcal text in kJ mode only', () => {
    const t = 'Your deficit (734 kcal/day) is above about 2 130 kcal/day. Two 600-kcal days; 30 kcal/kg FFM.';
    expect(energyInText(t, 'kcal')).toBe(t);
    expect(energyInText(t, 'kJ')).toBe(
      'Your deficit (3,070 kJ/day) is above about 8,910 kJ/day. Two 2,510-kJ days; 126 kJ/kg FFM.',
    );
    expect(energyInText('Under 800 kcal a day.', 'kJ')).toBe('Under 3,350 kJ a day.');
    expect(energyInText('no energy here', 'kJ')).toBe('no energy here');
    expect(energyInText('Fibre is 8 g per 1000 kcal (target 14+). Low fibre.', 'kJ')).toBe(
      'Fibre is 1.9 g per 1000 kJ (target 3.3+). Low fibre.',
    );
    expect(energyInText('Energy left after exercise is 29 kcal/kg lean mass/day, below the ~30 level linked to', 'kJ')).toBe(
      'Energy left after exercise is 121 kJ/kg lean mass/day, below the ~126 level linked to',
    );
  });
});
