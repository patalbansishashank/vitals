import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MacroSplit, macroSplitRows } from '../components/MacroSplit';

describe('meal macro composition', () => {
  it('shows energy shares, rather than treating grams of fat and carbohydrate as equivalent', () => {
    const rows = macroSplitRows({ proteinG: 10, carbG: 20, fatG: 10 });
    expect(rows.map((r) => r.share)).toEqual([40 / 210, 80 / 210, 90 / 210]);
    expect(rows.reduce((sum, r) => sum + r.share, 0)).toBeCloseTo(1);
  });

  it('leaves an empty or invalid composition empty', () => {
    expect(macroSplitRows({ proteinG: 0, carbG: -1, fatG: NaN }).map((r) => r.share)).toEqual([0, 0, 0]);
  });

  it('keeps quiet composition meaningful without numbers in its text alternative or legend', () => {
    const { container } = render(<MacroSplit proteinG={10} carbG={20} fatG={10} quiet />);
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Macro energy split: protein some, carbs a large part, fat a large part',
    );
    expect(container.textContent).not.toMatch(/\d/);
    expect(container.textContent).toContain('Protein');
  });
});
