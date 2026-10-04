import { render, screen } from '@testing-library/react';
import { AdherenceDial } from '../AdherenceDial';
import { TAU, arcPath, arcState, bandOutline, dialArcs, dialSentence, polar } from '../adherenceGeometry';
import type { DialItem } from '../types';

const items: DialItem[] = [
  { id: 'energy', label: 'Food energy', weight: 0.34, credit: 1, status: 'done' },
  { id: 'protein', label: 'Protein', weight: 0.16, credit: 0.8, status: 'partial' },
  { id: 'lift', label: 'Lift · 45 min', weight: 0.3, credit: null, status: 'unknown' },
  { id: 'steps', label: 'Steps', weight: 0.2, credit: 0, status: 'skipped' },
];

describe('adherence dial geometry (COMPONENTS §13.9)', () => {
  it('divides the whole circle by item weight, clockwise from 12, with fixed pixel gaps', () => {
    const r = 54;
    const arcs = dialArcs(items, r, 2);
    expect(arcs).toHaveLength(4);
    const gap = 2 / r;
    // starts half a gap after 12 o'clock and runs clockwise in the given (prescription) order
    expect(arcs[0]!.start).toBeCloseTo(gap / 2, 6);
    for (let i = 1; i < arcs.length; i++) expect(arcs[i]!.start).toBeCloseTo(arcs[i - 1]!.end + gap, 6);
    // spans are proportional to weight; spans + gaps make the full circle (the circle is always the whole day)
    const spans = arcs.map((a) => a.end - a.start);
    const usable = TAU - gap * arcs.length;
    spans.forEach((s, i) => expect(s).toBeCloseTo(items[i]!.weight * usable, 6));
    expect(spans.reduce((a, b) => a + b, 0) + gap * arcs.length).toBeCloseTo(TAU, 6);
    expect(arcs.reduce((s, a) => s + a.share, 0)).toBeCloseTo(1, 9);
  });

  it('keeps unknown items in the circle (not counted, but part of the day) and renormalises weights', () => {
    const arcs = dialArcs([{ id: 'a', label: 'a', weight: 2, credit: 1 }, { id: 'b', label: 'b', weight: 2, credit: null }], 50);
    expect(arcs.map((a) => a.share)).toEqual([0.5, 0.5]);
    expect(arcs[1]!.state).toBe('unknown');
  });

  it('maps outcomes to arc states: done, partial (with the inked share), missed, unknown', () => {
    expect(arcState({ credit: 1 })).toBe('done');
    expect(arcState({ credit: 0.999 })).toBe('done');
    expect(arcState({ credit: 0.4 })).toBe('partial');
    expect(arcState({ credit: 0 })).toBe('missed');
    expect(arcState({ credit: 0.5, status: 'skipped' })).toBe('missed');
    expect(arcState({ credit: null })).toBe('unknown');
    const partial = dialArcs(items, 54).find((a) => a.id === 'protein')!;
    expect(partial.state).toBe('partial');
    expect(partial.split).toBeCloseTo(partial.start + 0.8 * (partial.end - partial.start), 9);
  });

  it('drops zero-weight items and handles one item and empty input', () => {
    expect(dialArcs([], 50)).toEqual([]);
    expect(dialArcs([{ id: 'z', label: 'z', weight: 0, credit: 1 }], 50)).toEqual([]);
    const one = dialArcs([{ id: 'x', label: 'x', weight: 1, credit: 1 }], 50, 2);
    expect(one).toHaveLength(1);
    expect(one[0]!.end - one[0]!.start).toBeCloseTo(TAU - 2 / 50, 6);
  });

  it('places 0 at 12 o’clock and 90° at 3 o’clock (SVG y down)', () => {
    const [x0, y0] = polar(100, 100, 50, 0);
    expect([x0, y0]).toEqual([100, 50]);
    const [x1, y1] = polar(100, 100, 50, Math.PI / 2);
    expect(x1).toBeCloseTo(150, 9);
    expect(y1).toBeCloseTo(100, 9);
    expect(arcPath(100, 100, 50, 0, Math.PI)).toMatch(/A50,50 0 0 1/);
    expect(arcPath(100, 100, 50, 0, Math.PI * 1.5)).toMatch(/A50,50 0 1 1/);
    expect(arcPath(100, 100, 50, 1, 1)).toBe('');
    expect(bandOutline(100, 100, 50, 4, 0, 1)).toMatch(/Z$/);
  });

  it('writes the full sentence for screen readers', () => {
    expect(dialSentence(items, 62, { final: false })).toBe(
      'Adherence so far 62 of 100, based on 3 of 4 items: Food energy done, Protein 80 percent, Lift · 45 min not logged, Steps missed.',
    );
    expect(dialSentence(items, null, { final: true })).toMatch(/^Adherence: not enough logged yet, based on 3 of 4 items/);
    expect(dialSentence(items, 62, { final: false, quietWord: 'mostly' })).toMatch(/^Adherence so far: mostly, based on/);
  });
});

describe('<AdherenceDial>', () => {
  it('renders one mark per item with the right state, the score and "so far", and a hidden table', () => {
    const { container } = render(<AdherenceDial items={items} score={62} size="md" final={false} />);
    expect(screen.getByRole('img', { name: /Adherence so far 62 of 100/ })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-arc]')).toHaveLength(4);
    expect(container.querySelector('[data-arc="energy"]')).toHaveAttribute('data-state', 'done');
    expect(container.querySelector('[data-arc="lift"]')).toHaveAttribute('data-state', 'unknown');
    expect(container.querySelector('[data-arc="steps"]')).toHaveAttribute('data-state', 'missed');
    expect(screen.getByText('62')).toBeInTheDocument();
    expect(screen.getByText('so far')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Items of the day' })).toBeInTheDocument();
  });

  it('never celebrates or colours: no green/red, no streak text, "—" when there is no score', () => {
    const { container } = render(<AdherenceDial items={items} score={null} size="sm" />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/ok-mark|danger-mark|\bgreen\b|\bred\b|streak/i);
  });

  it('quiet mode: empty centre, the word under the dial', () => {
    render(<AdherenceDial items={items} score={62} size="md" quietWord="mostly" />);
    expect(screen.queryByText('62')).not.toBeInTheDocument();
    expect(screen.getByText('mostly')).toBeInTheDocument();
  });

  it('glyph size draws arcs only', () => {
    const { container } = render(<AdherenceDial items={items} score={62} size="glyph" />);
    expect(container.querySelector('.lmc-dial__num')).toBeNull();
    expect(container.querySelector('table')).toBeNull();
  });
});
