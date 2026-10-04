import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockBars, blockValueText } from '../BlockBars';
import { BARS } from './fixtures';

afterEach(() => cleanup());

const COST = 'Thursday’s lift carried 30 % and was skipped twice';

describe('<BlockBars>', () => {
  it('shows each block’s value at the end of its bar; nothing logged reads "not logged"', () => {
    render(<BlockBars bars={BARS} costliest={COST} />);
    const list = screen.getByRole('list', { name: 'Adherence by part of the plan' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      'training84 out of 100',
      'protein91 out of 100',
      'energy62 out of 100',
      'fastingnot logged',
      'steps25 out of 100',
    ]);
  });

  it('fills to the mean in ink; an unknown block has no fill', () => {
    const { container } = render(<BlockBars bars={BARS} />);
    const fills = container.querySelectorAll<HTMLElement>('.lmc-bb__fill');
    expect(fills).toHaveLength(4);
    expect(fills[0]!.style.width).toBe('84%');
    expect(fills[2]!.style.width).toBe('62.4%');
  });

  it('prints a 0 / 50 / 100 scale once, and draws no target at 100', () => {
    const { container } = render(<BlockBars bars={BARS} />);
    expect(Array.from(container.querySelectorAll('.lmc-bb__nums b')).map((b) => b.textContent)).toEqual(['0', '50', '100']);
    expect(container.querySelector('[data-target], [class*="target"], [aria-label*="target"]')).toBeNull();
    // the tick at 100 is the same printed scale mark as 0 and 50
    const ticks = container.querySelectorAll<HTMLElement>('.lmc-bb__row:first-child .lmc-bb__tick');
    expect(Array.from(ticks).map((t) => t.style.left)).toEqual(['0%', '50%', '100%']);
    expect(new Set(Array.from(ticks).map((t) => t.className)).size).toBe(1);
  });

  it('names the costliest item in text under the bars', () => {
    render(<BlockBars bars={BARS} costliest={COST} />);
    expect(screen.getByText(COST)).toBeInTheDocument();
    expect(screen.getByText('cost the most')).toBeInTheDocument();
  });

  it('quiet mode: value words, no numerals on the scale', () => {
    const { container } = render(<BlockBars bars={BARS} quiet />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['trainingmostly', 'proteinas planned', 'energymostly', 'fastingnot logged', 'stepsa little']);
    expect(container.querySelectorAll('.lmc-bb__nums b')).toHaveLength(0);
    expect(container.textContent).not.toMatch(/\d/);
  });

  it('takes a passed-in quiet vocabulary', () => {
    expect(blockValueText(BARS[0]!, { quiet: true, quietWord: (m) => (m > 50 ? 'more than half' : 'less than half') })).toBe('more than half');
    expect(blockValueText(BARS[3]!, { quiet: true })).toBe('not logged');
  });
});
