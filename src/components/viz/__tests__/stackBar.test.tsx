/**
 * StackBar (r071): the shares as pure geometry, the sentence and the table, the legend that always names the parts,
 * quiet mode, and the same final markup with `animate` on and off.
 */
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StackBar, shareWord, spokenStack, stackModel, stackTwin, type StackBarProps } from '../StackBar';
import { fakeMotion } from './motionHelpers';

const rows = [
  { id: 'resting', label: 'Resting', valueText: '742', share: 742 / 1096, hue: 'var(--lm-intensity-resting)' },
  { id: 'light', label: 'Light', valueText: '238', share: 238 / 1096, hue: 'var(--lm-intensity-light)' },
  { id: 'active', label: 'Active', valueText: '84', share: 84 / 1096, hue: 'var(--lm-intensity-active)' },
  { id: 'exercise', label: 'Exercise', valueText: '32', share: 32 / 1096, hue: 'var(--lm-intensity-exercise)' },
];
const BASE: StackBarProps = { label: 'Where it went so far', rows, total: '1\u00a0096 kcal' };
const text = (el: Element) => el.textContent ?? '';

describe('stackModel', () => {
  it('draws the parts with a share, lists every part, and leaves nothing over when they add up', () => {
    const m = stackModel([...rows, { id: 'none', label: 'Sleeping', valueText: '0', share: 0, hue: 'x' }]);
    expect(m.segments).toHaveLength(4);
    expect(m.parts).toHaveLength(5);
    expect(m.rest).toBe(0);
  });
  it('parts that do not add up leave the rest as the bare track; shares are clamped and NaN is zero', () => {
    const m = stackModel([{ id: 'a', label: 'A', valueText: '1', share: 0.4, hue: 'x' }, { id: 'b', label: 'B', valueText: '2', share: Number.NaN, hue: 'x' }, { id: 'c', label: 'C', valueText: '3', share: 7, hue: 'x' }]);
    expect(m.parts.map((p) => p.share)).toEqual([0.4, 0, 1]);
    expect(stackModel([{ id: 'a', label: 'A', valueText: '1', share: 0.6, hue: 'x' }]).rest).toBeCloseTo(0.4);
  });
  it('shareWord', () => {
    expect([0, 0.05, 0.2, 0.5, 0.9].map(shareWord)).toEqual(['none', 'a small part', 'some', 'a large part', 'most']);
  });
});

describe('words', () => {
  it('names every part with its value, and the total', () => {
    expect(spokenStack(BASE)).toBe('Where it went so far: resting 742, light 238, active 84, exercise 32; total 1\u00a0096 kcal');
  });
  it('quiet: words, no digit', () => {
    const s = spokenStack({ ...BASE, quiet: true });
    expect(s).toBe('Where it went so far: resting most, light some, active a small part, exercise a small part');
    expect(s).not.toMatch(/\d/);
  });
  it('nothing to show', () => {
    expect(spokenStack({ label: 'Stages', rows: [] })).toBe('Stages: nothing to show');
  });
  it('stackTwin lists each part, its value and its share, then the total', () => {
    const t = stackTwin(BASE);
    expect(t.head).toEqual(['Part', 'Value', 'Share']);
    expect(t.rows[0]).toEqual(['Resting', '742', '68\u00a0%']);
    expect(t.rows.at(-1)).toEqual(['Total', '1\u00a0096 kcal', '']);
  });
});

describe('StackBar render', () => {
  it('is one img with the sentence; the bar is decoration; a segment per part with a share, as wide as its share', () => {
    const { container } = render(<StackBar {...BASE} />);
    expect(screen.getByRole('img', { name: spokenStack(BASE) })).toBeInTheDocument();
    expect(container.querySelector('.lmz-stack__bar')).toHaveAttribute('aria-hidden', 'true');
    const segs = [...container.querySelectorAll<HTMLElement>('.lmz-stack__seg')];
    expect(segs).toHaveLength(4);
    expect(segs.map((s) => s.style.flexGrow)).toEqual(['677', '217', '77', '29']);
    expect(segs[0]!.style.background).toContain('--lm-intensity-resting');
    expect(container.querySelector('.lmz-stack__rest')).toBeNull();
  });

  it('the legend always names every part with its value, a zero too', () => {
    const { container } = render(<StackBar {...BASE} rows={[...rows, { id: 'z', label: 'Awake', valueText: '0 min', share: 0, hue: 'var(--lm-stage-awake)' }]} />);
    const items = [...container.querySelectorAll('.lmz-stack__item')].map((li) => li.textContent);
    expect(items).toEqual(['Resting742', 'Light238', 'Active84', 'Exercise32', 'Awake0 min']);
    expect(container.querySelectorAll('.lmz-stack__seg')).toHaveLength(4);
  });

  it('quiet shows the shares as words and no digit anywhere', () => {
    const { container } = render(<StackBar {...BASE} quiet />);
    expect(text(container)).not.toMatch(/\d/);
    expect(container.querySelectorAll('.lmz-stack__value')[0]).toHaveTextContent('most');
  });

  it('legend none draws no legend; inline and size are data attributes the css reads', () => {
    const { container, rerender } = render(<StackBar {...BASE} legend="none" />);
    expect(container.querySelector('.lmz-stack__legend')).toBeNull();
    rerender(<StackBar {...BASE} legend="inline" size="sm" />);
    expect(container.firstElementChild).toHaveAttribute('data-legend', 'inline');
    expect(container.firstElementChild).toHaveAttribute('data-size', 'sm');
  });

  it('an unclassified part is a dashed outline, never a fill; a short whole leaves the bare track', () => {
    const { container } = render(<StackBar label="Night" rows={[{ id: 'a', label: 'Deep', valueText: '1 h', share: 0.3, hue: 'var(--lm-stage-deep)' }, { id: 'u', label: 'Unclassified', valueText: '40 min', share: 0.1, hue: 'x', unknown: true }]} />);
    expect(container.querySelector('.lmz-stack__seg[data-unknown]')).not.toBeNull();
    expect(container.querySelector('.lmz-stack__rest')).not.toBeNull();
  });

  it('the Table twin draws when asked', () => {
    render(<StackBar {...BASE} twin />);
    expect(screen.getByRole('button', { name: /table/i })).toBeInTheDocument();
  });

  it('the final markup is the same with animate on and off', async () => {
    const off = render(<StackBar {...BASE} animate={false} />).container.innerHTML;
    const restore = await fakeMotion();
    try {
      const { container } = render(<StackBar {...BASE} />);
      expect(container.firstElementChild).toHaveAttribute('data-reveal', 'pending');
      await act(async () => {});
      expect(container.firstElementChild).not.toHaveAttribute('data-reveal');
      expect(container.innerHTML).toBe(off);
    } finally {
      restore();
    }
  });
});
