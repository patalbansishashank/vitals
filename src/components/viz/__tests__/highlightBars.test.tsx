/**
 * HighlightBars (r071): the bar model (ratios, stacks, the highlighted day, the lines), the sentences, the quiet form,
 * scrubbing by keys and pointer, and the final markup being the same with animate on and off.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HighlightBars, barDate, barsModel, barsTwin, spokenBar, spokenBars, type HighlightBarsProps } from '../HighlightBars';
import { fakeMotion } from './motionHelpers';

const plain = (s: string | null | undefined) => (s ?? '').replace(/\u00a0/g, ' ');
// Sat 24 Oct … Fri 30 Oct 2026
const DATES = ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'];
const STEPS = [5260, 7290, 8380, 4810, 7650, 6640, 7605];
const base: HighlightBarsProps = { dates: DATES, values: STEPS, name: 'Steps, last week', goal: 9000, unit: 'steps' };

describe('barDate', () => {
  it('reads an ISO date as short, narrow, day number and long weekday', () => {
    expect(barDate('2026-10-30')).toEqual({ short: 'Fri 30 Oct', narrow: 'F', day: '30', weekday: 'Friday' });
    expect(barDate('2026-10-24').narrow).toBe('S');
  });
  it('a label that is not a date is used as it is', () => {
    expect(barDate('Week 3')).toEqual({ short: 'Week 3', narrow: 'W', day: 'Week 3', weekday: 'Week 3' });
  });
});

describe('barsModel', () => {
  it('ratios are value / max, the goal and the lines are ratios of the same scale', () => {
    const m = barsModel({ ...base, average: 6900, limit: 8800 });
    expect(m.max).toBe(9000);
    expect(m.bars[2]!.ratio).toBeCloseTo(8380 / 9000, 10);
    expect(m.goalRatio).toBe(1);
    expect(m.avgRatio).toBeCloseTo(6900 / 9000, 10);
    expect(m.limitRatio).toBeCloseTo(8800 / 9000, 10);
    expect(m.highlight).toBe(6);
  });
  it('the scale reaches the largest of the values and the lines; `max` overrides', () => {
    expect(barsModel({ dates: DATES, values: [100, 400, 200, 300, 50, 10, 20] }).max).toBe(400);
    expect(barsModel({ dates: DATES, values: STEPS, goal: 20_000 }).max).toBe(20_000);
    expect(barsModel({ dates: DATES, values: STEPS, max: 11_000 }).max).toBe(11_000);
    expect(barsModel({ dates: [], values: [] }).max).toBe(1);
  });
  it('null and NaN are no bar; a null day is not zero', () => {
    const m = barsModel({ dates: DATES.slice(0, 3), values: [100, null, Number.NaN] });
    expect(m.bars.map((b) => b.value)).toEqual([100, null, null]);
    expect(m.bars[1]!.ratio).toBe(0);
    expect(m.mean).toBe(100);
  });
  it('highlight: the last day by default, an index, or none', () => {
    expect(barsModel(base).highlight).toBe(6);
    expect(barsModel({ ...base, highlight: 2 }).highlight).toBe(2);
    expect(barsModel({ ...base, highlight: null }).highlight).toBeNull();
    expect(barsModel({ ...base, highlight: 40 }).highlight).toBeNull();
  });
  it('stacks sum into the bar and keep their order; zero and missing parts are not segments', () => {
    const stacks = [
      { id: 'a', label: 'Reels', hue: 'videos' as const, values: [10, 0, 5, 20, 8, 9, 30] },
      { id: 'b', label: 'Shorts', hue: 'recovery' as const, values: [5, 5, 0, 10, 2, 1, 15] },
    ];
    const m = barsModel({ dates: DATES, values: [], stacks, limit: 40 });
    expect(m.stacked).toBe(true);
    expect(m.bars.map((b) => b.value)).toEqual([15, 5, 5, 30, 10, 10, 45]);
    expect(m.max).toBe(45);
    expect(m.bars[1]!.segs!.map((s) => s.id)).toEqual(['b']);
    expect(m.bars[6]!.segs!.map((s) => s.value)).toEqual([30, 15]);
    expect(m.limitRatio).toBeCloseTo(40 / 45, 10);
  });
  it('outline marks a partial day', () => {
    expect(barsModel({ ...base, outline: [false, false, false, false, false, false, true] }).bars.map((b) => b.outline)).toEqual([false, false, false, false, false, false, true]);
  });
});

describe('sentences', () => {
  it('up to eight days are listed with their words, then the goal', () => {
    expect(plain(spokenBars(base))).toBe('Steps, last week, 7 days: Sat 24 Oct 5,260, Sun 25 Oct 7,290, Mon 26 Oct 8,380, Tue 27 Oct 4,810, Wed 28 Oct 7,650, Thu 29 Oct 6,640, Fri 30 Oct 7,605; goal 9,000 steps');
  });
  it('more days are summarised: the latest, the average, the highest', () => {
    const dates = Array.from({ length: 14 }, (_, i) => `2026-10-${String(17 + i).padStart(2, '0')}`);
    const values = dates.map((_, i) => 5000 + i * 100);
    const s = plain(spokenBars({ dates, values, name: 'Steps, 14 days', unit: 'steps' }));
    expect(s).toBe('Steps, 14 days, 14 days: latest 6,300 steps on Fri 30 Oct; average 5,650; highest 6,300 on Fri 30 Oct');
  });
  it('a day with no reading says so; none at all says so', () => {
    expect(spokenBars({ ...base, values: [null, null, null, null, null, null, null] })).toBe('Steps, last week: no readings');
    expect(spokenBar({ ...base, values: [null, 1, 2, 3, 4, 5, 6] }, 0)).toBe('Sat 24 Oct, no reading');
  });
  it('one day in words, the caller’s override first', () => {
    expect(plain(spokenBar(base, 6))).toBe('Fri 30 Oct, 7,605 steps');
    expect(spokenBar({ ...base, spoken: (i) => `bar ${i}` }, 3)).toBe('bar 3');
  });
  it('quiet has no digit: weekdays, counts in words and words against the goal', () => {
    const s = spokenBars({ ...base, quiet: true });
    expect(s).toBe('Steps, last week, seven days, Friday: over half of the goal');
    expect(s).not.toMatch(/\d/);
    expect(spokenBar({ ...base, quiet: true }, 2)).toBe('Monday, over half of the goal');
    expect(spokenBar({ dates: DATES, values: STEPS, quiet: true }, 3)).toMatch(/Tuesday, (low|medium|high)/);
  });
});

describe('barsTwin', () => {
  it('lists every day, with a column per stack when stacked', () => {
    const t = barsTwin(base);
    expect(t.head).toEqual(['Day', 'Value']);
    expect(t.rows).toHaveLength(7);
    expect(plain(String(t.rows[0]![1]))).toBe('5,260');
    expect(t.title).toBe('Steps, last week table');
    const stacked = barsTwin({ dates: DATES.slice(0, 2), values: [], name: 'Videos', stacks: [{ id: 'a', label: 'Reels', hue: 'videos', values: [3, 4] }, { id: 'b', label: 'Shorts', hue: 'recovery', values: [1] }] });
    expect(stacked.head).toEqual(['Day', 'Total', 'Reels', 'Shorts']);
    expect(stacked.rows).toEqual([['Sat 24 Oct', '4', '3', '1'], ['Sun 25 Oct', '4', '4', '—']]);
  });
});

describe('HighlightBars', () => {
  it('is one image with the summary as its name; the bars and the axis are hidden from assistive technology', () => {
    const { container } = render(<HighlightBars {...base} />);
    const img = screen.getByRole('img', { name: /^Steps, last week, 7 days/ });
    expect(img).toHaveAttribute('tabindex', '0');
    expect(container.querySelector('.lmz-bars__plot')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.lmz-bars__axis')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('.lmz-bars__bar')).toHaveLength(7);
    // today is the highlighted day; the goal is a hairline; never coloured by goal met
    expect(container.querySelectorAll('.lmz-bars__col[data-hl]')).toHaveLength(1);
    expect(container.querySelector('.lmz-bars__col[data-hl]')).toHaveAttribute('data-i', '6');
    expect(container.querySelector('.lmz-bars__line[data-kind="goal"]')).not.toBeNull();
    expect(container.innerHTML).not.toMatch(/data-met|goal-met/);
  });

  it('bar heights are percentages of the scale', () => {
    const { container } = render(<HighlightBars {...base} />);
    const bars = [...container.querySelectorAll<HTMLElement>('.lmz-bars__bar')];
    expect(bars[2]!.style.getPropertyValue('--h')).toBe(`${Number(((8380 / 9000) * 100).toFixed(2))}%`);
    expect(bars[3]!.style.getPropertyValue('--h')).toBe(`${Number(((4810 / 9000) * 100).toFixed(2))}%`);
  });

  it('the axis is a weekday letter under each bar, today’s in ivory', () => {
    const { container } = render(<HighlightBars {...base} />);
    const ticks = [...container.querySelectorAll('.lmz-bars__tick')];
    expect(ticks.map((t) => t.textContent)).toEqual(['S', 'S', 'M', 'T', 'W', 'T', 'F']);
    expect(ticks[6]).toHaveAttribute('data-tone', 'ink');
    expect(ticks[0]).toHaveAttribute('data-tone', 'muted');
    // more than ten bars: the day number every seventh bar
    const dates = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10));
    const dense = render(<HighlightBars dates={dates} values={dates.map((_, i) => i)} name="Steps, 30 days" />);
    expect(dense.container.querySelector('.lmz-bars')).toHaveAttribute('data-dense', 'true');
    expect([...dense.container.querySelectorAll('.lmz-bars__tick')].map((t) => t.textContent).filter(Boolean)).toEqual(['1', '8', '15', '22', '30']);
  });

  it('a null day draws no bar, and the average has its word in the margin, never over a bar', () => {
    const { container } = render(<HighlightBars {...base} values={[5260, null, 8380, 4810, 7650, 6640, 7605]} average={6900} />);
    expect(container.querySelectorAll('.lmz-bars__bar')).toHaveLength(6);
    expect(container.querySelector('.lmz-bars__col[data-empty]')).toHaveAttribute('data-i', '1');
    expect(container.querySelector('.lmz-bars')).toHaveAttribute('data-avg', 'true');
    const label = container.querySelector('.lmz-bars__avg')!;
    expect(label).toHaveTextContent('avg');
    // the word is a sibling of the columns, in the plot's margin
    expect(label.closest('.lmz-bars__cols')).toBeNull();
    expect(container.querySelector('.lmz-bars__line[data-kind="avg"]')).not.toBeNull();
  });

  it('partial days are dashed outlines, never a colour alone', () => {
    const { container } = render(<HighlightBars {...base} outline={[false, false, false, false, false, false, true]} />);
    const bars = container.querySelectorAll('.lmz-bars__bar');
    expect(bars[6]).toHaveAttribute('data-outline', 'true');
    expect(bars[5]).not.toHaveAttribute('data-outline');
  });

  it('stacks draw a segment per app with a limit line', () => {
    const stacks = [
      { id: 'a', label: 'Reels', hue: 'videos' as const, values: [10, 0, 5, 20, 8, 9, 30] },
      { id: 'b', label: 'Shorts', hue: 'recovery' as const, values: [5, 5, 0, 10, 2, 1, 15] },
    ];
    const { container } = render(<HighlightBars dates={DATES} values={[]} name="Short videos, last week" stacks={stacks} limit={40} />);
    expect(container.querySelectorAll('.lmz-bars__stack')).toHaveLength(7);
    expect(container.querySelectorAll('.lmz-bars__col[data-i="6"] .lmz-bars__seg')).toHaveLength(2);
    expect(container.querySelector('.lmz-bars__seg')).toHaveAttribute('data-hue', 'videos');
    expect(container.querySelector('.lmz-bars__line[data-kind="limit"]')).not.toBeNull();
    expect(container.querySelector('.lmz-bars')).toHaveAttribute('data-stacked', 'true');
    // two series always have a legend, and the sentence says what is stacked
    expect([...container.querySelectorAll('.lmz-bars__legend li')].map((li) => li.textContent)).toEqual(['Reels', 'Shorts']);
    expect(screen.getByRole('img', { name: /stacked by Reels and Shorts/ })).toBeInTheDocument();
  });

  it('keys step through the days: the live region reads each, the tooltip leads with the value, the callback hears it', async () => {
    const user = userEvent.setup();
    const onScrub = vi.fn();
    const { container } = render(<HighlightBars {...base} onScrub={onScrub} />);
    await user.tab();
    expect(screen.getByRole('img', { name: /Steps, last week/ })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(onScrub).toHaveBeenLastCalledWith(0);
    expect(plain(container.querySelector('[aria-live="polite"]')!.textContent)).toBe('Sat 24 Oct, 5,260 steps');
    const tip = container.querySelector('.lmz-tip')!;
    expect(plain(tip.textContent)).toBe('5,260 steps Sat 24 Oct');
    expect(within(tip as HTMLElement).getByText(/5,260 steps/)).toHaveClass('lmz-tip__v');
    expect(container.querySelector('.lmz-bars__col[data-active]')).toHaveAttribute('data-i', '0');
    await user.keyboard('{End}');
    expect(onScrub).toHaveBeenLastCalledWith(6);
    await user.keyboard('{ArrowLeft}');
    expect(plain(container.querySelector('[aria-live="polite"]')!.textContent)).toBe('Thu 29 Oct, 6,640 steps');
    await user.keyboard('{Home}');
    expect(onScrub).toHaveBeenLastCalledWith(0);
    await user.keyboard('{Escape}');
    expect(onScrub).toHaveBeenLastCalledWith(null);
    expect(container.querySelector('.lmz-tip')).toBeNull();
    // leaving the picture clears it too
    await user.keyboard('{ArrowRight}');
    await user.tab();
    expect(container.querySelector('.lmz-tip')).toBeNull();
  });

  it('a day with no reading is read as such', async () => {
    const user = userEvent.setup();
    const { container } = render(<HighlightBars {...base} values={[null, 1, 2, 3, 4, 5, 6]} />);
    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent('Sat 24 Oct, no reading');
    expect(container.querySelector('.lmz-tip')).toHaveTextContent('No reading');
  });

  it('hover scrubs by position; a mouse leaving clears it', () => {
    const onScrub = vi.fn();
    const { container } = render(<HighlightBars {...base} onScrub={onScrub} />);
    const cols = container.querySelector('.lmz-bars__cols') as HTMLElement;
    cols.getBoundingClientRect = () => ({ left: 100, width: 140, top: 0, height: 72, right: 240, bottom: 72, x: 100, y: 0, toJSON: () => ({}) });
    fireEvent.pointerMove(cols, { clientX: 100 + 20 * 2 + 5, pointerType: 'mouse' });
    expect(onScrub).toHaveBeenLastCalledWith(2);
    fireEvent.pointerMove(cols, { clientX: 100 + 139, pointerType: 'mouse' });
    expect(onScrub).toHaveBeenLastCalledWith(6);
    fireEvent.pointerLeave(cols, { pointerType: 'mouse' });
    expect(onScrub).toHaveBeenLastCalledWith(null);
  });

  it('the spark is bars only: no axis, no tab stop, no average word, still one named image', () => {
    const { container } = render(<HighlightBars {...base} variant="spark" average={6900} />);
    expect(container.querySelector('.lmz-bars__axis')).toBeNull();
    expect(container.querySelector('.lmz-bars__avg')).toBeNull();
    expect(screen.getByRole('img', { name: /Steps, last week/ })).not.toHaveAttribute('tabindex');
    expect(container.querySelectorAll('.lmz-bars__bar')).toHaveLength(7);
  });

  it('quiet: no digit in the markup or in any aria attribute, even scrubbed', async () => {
    const user = userEvent.setup();
    const { container } = render(<HighlightBars {...base} quiet />);
    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(container.textContent).not.toMatch(/\d/);
    for (const el of container.querySelectorAll('[aria-label]')) expect(el.getAttribute('aria-label')).not.toMatch(/\d/);
    expect(container.querySelector('.lmz-tip')).toHaveTextContent('Saturday');
    // a dense axis would be day numbers: quiet leaves it blank
    const dates = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10));
    const dense = render(<HighlightBars dates={dates} values={dates.map((_, i) => i)} name="Steps, last month" quiet />);
    expect(dense.container.textContent).not.toMatch(/\d/);
  });

  it('twin: a Table key shows the days', async () => {
    render(<HighlightBars {...base} twin />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Table' }));
    const table = screen.getByRole('region', { name: 'Steps, last week table' });
    expect(within(table).getAllByRole('row')).toHaveLength(8);
  });

  it('no days at all is an empty, honest picture', () => {
    const { container } = render(<HighlightBars dates={[]} values={[]} name="Steps" />);
    expect(screen.getByRole('img', { name: 'Steps: no readings' })).not.toHaveAttribute('tabindex');
    expect(container.querySelectorAll('.lmz-bars__bar')).toHaveLength(0);
  });

  it('the final markup is identical with animate on and off', async () => {
    const props = { ...base, average: 6900, outline: [false, false, false, false, false, false, true] };
    const off = render(<HighlightBars {...props} animate={false} />).container.innerHTML;
    const restore = await fakeMotion();
    try {
      const on = render(<HighlightBars {...props} />);
      await act(async () => {});
      expect(on.container.innerHTML).toBe(off);
    } finally {
      restore();
    }
  });

  it('first view is pending until the bars are in view; animate={false} is final at once', async () => {
    const restore = await fakeMotion({ inView: false });
    try {
      const a = render(<HighlightBars {...base} />);
      expect(a.container.querySelector('.lmz-bars')).toHaveAttribute('data-reveal', 'pending');
      const b = render(<HighlightBars {...base} animate={false} />);
      expect(b.container.querySelector('.lmz-bars')).not.toHaveAttribute('data-reveal');
    } finally {
      restore();
    }
  });

  it('a hue override and a bar-stagger index are data on the picture', () => {
    const { container } = render(<HighlightBars {...base} hue="steps" />);
    expect(container.querySelector('.lmz-bars')).toHaveAttribute('data-hue', 'steps');
    expect(container.querySelectorAll<HTMLElement>('.lmz-bars__col')[3]!.style.getPropertyValue('--i')).toBe('3');
  });
});
