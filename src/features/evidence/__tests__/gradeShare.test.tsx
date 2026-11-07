import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { countGrades, GradeShare } from '../components/GradeShare';

describe('grade distribution', () => {
  it('counts every mechanism once and labels all four grades', () => {
    const counts = countGrades([{ grade: 'B' }, { grade: 'A' }, { grade: 'B' }, { grade: 'D' }]);
    expect(counts).toEqual({ A: 1, B: 2, C: 0, D: 1 });
    render(<GradeShare counts={counts} />);
    expect(
      screen.getByRole('img', { name: '4 mechanisms: 1 grade A, 2 grade B, 0 grade C, 1 grade D' }),
    ).toBeInTheDocument();
  });

  it('shows no empty distribution, and the final-state markup equals animation off', () => {
    const empty = render(<GradeShare counts={countGrades([])} />);
    expect(empty.container).toBeEmptyDOMElement();
    empty.unmount();
    const counts = countGrades([{ grade: 'C' }, { grade: 'D' }]);
    const view = render(<GradeShare counts={counts} />);
    const final = view.container.innerHTML;
    view.rerender(<GradeShare counts={counts} animate={false} />);
    expect(view.container.innerHTML).toBe(final);
  });
});
