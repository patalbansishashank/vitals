/**
 * The day rail (r071 0B): nodes, rows, the spine's list semantics, the one tap target and the segmented ring.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dumbbell } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { Rail, RailNode, RailRow, segmentArcs, type RailStatus } from '../Rail';

describe('segmentArcs', () => {
  it('draws n equal arcs clockwise from 12 o’clock with a gap between them, the first `lit` lit', () => {
    const arcs = segmentArcs(4, 2);
    expect(arcs).toHaveLength(4);
    expect(arcs.map((a) => a.lit)).toEqual([true, true, false, false]);
    expect(arcs[0]!.a0).toBeGreaterThan(0);
    expect(arcs[3]!.a1).toBeLessThan(Math.PI * 2);
    for (let i = 1; i < arcs.length; i++) expect(arcs[i]!.a0).toBeGreaterThan(arcs[i - 1]!.a1);
    // equal arcs
    const spans = arcs.map((a) => a.a1 - a.a0);
    for (const s of spans) expect(s).toBeCloseTo(spans[0]!, 9);
  });

  it('keeps between 2 and 12 segments and a visible gap even with many', () => {
    expect(segmentArcs(1)).toHaveLength(2);
    expect(segmentArcs(40)).toHaveLength(12);
    const arcs = segmentArcs(12);
    expect(arcs[1]!.a0 - arcs[0]!.a1).toBeGreaterThan(0.05);
  });
});

describe('RailNode', () => {
  it.each<RailStatus>(['empty', 'done', 'partial', 'skipped', 'assumed'])('a %s node without onPress is a status mark with its name', (status) => {
    render(<RailNode status={status} label={`Snack: ${status}`} />);
    const node = screen.getByRole('img', { name: `Snack: ${status}` });
    expect(node).toHaveAttribute('data-status', status);
    expect(node).toHaveAttribute('data-size', '28');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('with onPress it is one button named for the action, and pressing calls it once', async () => {
    const onPress = vi.fn();
    render(<RailNode status="empty" label="Snack: log as planned" onPress={onPress} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Snack: log as planned' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('draws the check for every status (it only shows when done) and the size 44 variant', () => {
    const { container } = render(<RailNode status="done" size={44} label="Lift: done" />);
    expect(container.querySelector('.lm-rail__check path')).not.toBeNull();
    expect(container.querySelector('.lm-rail__node')).toHaveAttribute('data-size', '44');
  });

  it('an exercise draws one ring segment per set, `lit` of them lit; done lights all', () => {
    const { container, rerender } = render(<RailNode status="empty" segments={4} lit={1} number={4} label="Squat: 1 of 4 sets" />);
    expect(container.querySelectorAll('.lm-rail__arcs path')).toHaveLength(4);
    expect(container.querySelectorAll('.lm-rail__arcs path[data-lit]')).toHaveLength(1);
    expect(container.querySelector('.lm-rail__node')).toHaveAttribute('data-segmented', 'true');
    expect(container.querySelector('.lm-rail__num')).toHaveTextContent('4');
    rerender(<RailNode status="done" segments={4} label="Squat: done" />);
    expect(container.querySelectorAll('.lm-rail__arcs path[data-lit]')).toHaveLength(4);
    rerender(<RailNode status="partial" segments={4} lit={9} label="Squat" />);
    expect(container.querySelectorAll('.lm-rail__arcs path[data-lit]')).toHaveLength(4);
  });

  it('a glyph node carries its hue for the glyph tint only', () => {
    const { container } = render(<RailNode status="empty" glyph={Dumbbell} hue="steps" label="Lift" />);
    expect(container.querySelector('.lm-rail__node')).toHaveAttribute('data-hue', 'steps');
    expect(container.querySelector('.lm-rail__glyph')).not.toBeNull();
  });
});

describe('RailRow and Rail', () => {
  function Day({ onOpen }: { onOpen?: () => void }) {
    return (
      <Rail label="Today's plan">
        <RailRow time="12:30" node={<RailNode status="done" label="Lunch: logged" />} title="Rajma and rice" meta={['Lunch', '600 kcal']} onOpen={onOpen} />
        <RailRow time="16:30" node={<RailNode status="empty" label="Snack: log as planned" onPress={() => {}} />} title="Snack" meta="Food" trailing={<button type="button">Log</button>} />
        <RailRow node={<RailNode status="skipped" label="Walk: skipped" />} title="Walk" />
      </Rail>
    );
  }

  it('is a list of stops with the time, the title and the facts under it', () => {
    render(<Day />);
    const list = screen.getByRole('list', { name: "Today's plan" });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText('12:30')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Rajma and rice')).toBeInTheDocument();
    // several text facts stay in one bounded line with their separator
    expect(rows[0]!.querySelector('.lm-rail__meta .lm-overflow__item')).toHaveTextContent('Lunch · 600 kcal');
    expect(within(rows[1]!).getByText('Food').closest('.lm-mono')).toBeInTheDocument();
    expect(rows[2]!.querySelector('.lm-rail__time')).toBeNull();
    expect(rows[2]!.querySelector('.lm-rail__meta')).toBeNull();
    expect(list).toHaveAttribute('data-time-at', 'start');
  });

  it('the title is the row’s one tap target only when the row opens', async () => {
    const onOpen = vi.fn();
    const { rerender } = render(<Day />);
    expect(screen.queryByRole('button', { name: 'Rajma and rice' })).toBeNull();
    rerender(<Day onOpen={onOpen} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Rajma and rice' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('keeps the node and the trailing keys as their own targets beside the title', () => {
    render(<Day onOpen={() => {}} />);
    expect(screen.getByRole('button', { name: 'Snack: log as planned' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log' }).closest('.lm-rail__trail')).not.toBeNull();
  });

  it('a highlighted row is marked, and a rail can put its times at the end', () => {
    render(
      <Rail timeAt="end">
        <RailRow time="09:00" highlight node={<RailNode status="empty" label="Weigh in" />} title="Weigh in" />
      </Rail>,
    );
    expect(screen.getByRole('listitem')).toHaveAttribute('data-highlight', 'true');
    expect(screen.getByRole('list')).toHaveAttribute('data-time-at', 'end');
  });
});
