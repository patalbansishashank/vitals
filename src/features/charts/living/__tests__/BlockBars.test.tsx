import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockBars, blockRows, blockValueText } from '../BlockBars';
import { BARS } from './fixtures';

afterEach(() => cleanup());

const COST = 'Biggest gap: Thu lift, 0 of 2 sessions';

/** What a row shows: its name and its value (the ShareBar row's visible parts). */
const shown = (li: HTMLElement) => `${li.querySelector('.lmv-share__name')?.textContent ?? ''}${li.querySelector('.lmv-share__value')?.textContent ?? ''}`.replace(/\u00a0/g, ' ');

describe('<BlockBars>', () => {
  it('shows each block’s value in percent at the end of its bar, in sentence case; nothing logged reads "Not logged"', () => {
    render(<BlockBars bars={BARS} costliest={COST} />);
    const list = screen.getByRole('list', { name: 'Adherence by part of the plan' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map(shown)).toEqual([
      'Training84 %',
      'Protein91 %',
      'Energy62 %',
      'FastingNot logged',
      'Steps25 %',
    ]);
  });

  it('fills to the mean (the gold trace); an unknown block has no fill', () => {
    const { container } = render(<BlockBars bars={BARS} />);
    const fills = container.querySelectorAll<HTMLElement>('.lmc-bb .lmv-share__fill');
    expect(fills).toHaveLength(4);
    expect(fills[0]!.style.width).toBe('84%');
    expect(fills[2]!.style.width).toBe('62.4%');
  });

  it('prints no scale, no ticks and no target at 100 — the value at the end says the number', () => {
    const { container } = render(<BlockBars bars={BARS} />);
    expect(container.querySelector('.lmc-bb__scale, .lmc-bb__nums, .lmc-bb__tick')).toBeNull();
    expect(container.querySelector('[data-target], [class*="target"], [aria-label*="target"]')).toBeNull();
    expect(container.textContent).not.toMatch(/\b(0|50|100)\b(?! %)/);
  });

  it('names the biggest gap in one plain line under the bars, with no label of its own', () => {
    render(<BlockBars bars={BARS} costliest={COST} />);
    expect(screen.getByText(COST)).toBeInTheDocument();
    expect(screen.queryByText('cost the most')).toBeNull();
  });

  it('quiet mode: value words, no numerals anywhere', () => {
    const { container } = render(<BlockBars bars={BARS} quiet />);
    const items = screen.getAllByRole('listitem');
    expect(items.map(shown)).toEqual(['TrainingMostly', 'ProteinAs planned', 'EnergyMostly', 'FastingNot logged', 'StepsA little']);
    expect(container.textContent).not.toMatch(/\d/);
  });

  it('is drawn with the shared ShareBar (one primitive): each item reads its name, value and count; quiet speaks no digits', () => {
    const { container } = render(<BlockBars bars={BARS} />);
    expect(container.querySelector('.lmc-bb .lmv-share')).not.toBeNull();
    const sr = Array.from(container.querySelectorAll('.lmv-share__row > .lm-sr')).map((n) => n.textContent);
    expect(sr[0]).toBe('Training, 84\u00a0%, 3 items this week');
    expect(sr[3]).toBe('Fasting, Not logged, this week');
    expect(blockRows(BARS, { quiet: true }).map((r) => r.shareText)).toEqual(['', '', '', '', '']);
    cleanup();
    const quiet = render(<BlockBars bars={BARS} quiet />);
    expect(Array.from(quiet.container.querySelectorAll('.lmv-share__row > .lm-sr')).map((n) => n.textContent).join(' ')).not.toMatch(/\d/);
  });

  it('takes a passed-in quiet vocabulary', () => {
    expect(blockValueText(BARS[0]!, { quiet: true, quietWord: (m) => (m > 50 ? 'more than half' : 'less than half') })).toBe('more than half');
    expect(blockValueText(BARS[3]!, { quiet: true })).toBe('not logged');
    expect(blockValueText(BARS[0]!)).toBe('84 %');
  });
});
