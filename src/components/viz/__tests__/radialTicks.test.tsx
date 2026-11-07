/**
 * RadialTicks (r071): the ring model (lit ticks, the second lap, the mark, the arcs of the parts), the sentences, the
 * quiet form, and the final markup being the same with animate on and off.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEG, quietStep, ratioWord, tickRing } from '../geometry';
import { RadialTicks, quietNeeds, radialCount, radialModel, radialPx, radialTwin, spokenRadial, type RadialPart } from '../RadialTicks';
import { fakeMotion } from './motionHelpers';

/** The visible and spoken words with the no-break spaces of the number format read as spaces. */
const plain = (s: string | null | undefined) => (s ?? '').replace(/\u00a0/g, ' ');
const litCount = (el: Element) => el.querySelectorAll('.lmz-radial__t[data-lit]').length;

describe('tickRing', () => {
  it('a closed ring puts tick 0 at 12 o’clock, evenly spaced, a major every sixth', () => {
    const t = tickRing({ count: 72 });
    expect(t).toHaveLength(72);
    expect(t[0]).toEqual({ i: 0, angle: 0, major: true });
    expect(t[1]!.angle).toBeCloseTo(5 * DEG, 10);
    expect(t[71]!.angle).toBeCloseTo(355 * DEG, 10);
    expect(t.filter((x) => x.major).map((x) => x.i)).toEqual(Array.from({ length: 12 }, (_, k) => k * 6));
  });

  it('an arc centres its ticks in the slots it owns and leaves the gap at the end', () => {
    const start = -56 * DEG;
    const t = tickRing({ count: 24, startRad: start, sweepRad: 120 * DEG, gapRad: 8 * DEG });
    const pitch = (112 * DEG) / 24;
    expect(t[0]!.angle).toBeCloseTo(start + pitch / 2, 10);
    expect(t[23]!.angle).toBeCloseTo(start + 23.5 * pitch, 10);
    expect(t[23]!.angle).toBeLessThan(start + 112 * DEG);
  });

  it('majorEvery 0 has none, and a count below 1 still gives one tick', () => {
    expect(tickRing({ count: 12, majorEvery: 0 }).some((x) => x.major)).toBe(false);
    expect(tickRing({ count: 0 })).toHaveLength(1);
  });
});

describe('quiet steps and words', () => {
  it('three steps: a third, two thirds, all; none when there is nothing', () => {
    expect([0, 0.2, 0.5, 0.9, 1.4].map((r) => quietStep(r, 72))).toEqual([0, 24, 48, 72, 72]);
    expect(quietStep(0.4, 24)).toBe(16);
  });
  it('the ratio words never carry a digit, and unknown is not none', () => {
    for (const r of [0, 0.3, 0.7, 1, 1.4]) expect(ratioWord(r)).not.toMatch(/\d/);
    expect(ratioWord(0, false)).toBe('no value yet');
    expect(ratioWord(0)).toBe('none yet');
    expect(quietNeeds('needs 3 more nights')).toBe('needs three more nights');
    expect(quietNeeds('needs 40 more nights')).toBe('needs several more nights');
  });
});

describe('radialModel', () => {
  it.each([1, 3, 5, 10])('draws %i evenly spaced, equal-length discrete ticks and lights one per completed item', (count) => {
    for (let done = 0; done <= count; done++) {
      const arc = radialModel({ value: done, max: count, count, majorEvery: 0 }).arcs[0]!;
      expect(arc.ticks).toHaveLength(count);
      expect(arc.lit).toBe(done);
      arc.ticks.forEach((tick, i) => {
        expect(tick.major).toBe(false);
        expect(tick.angle).toBeCloseTo(i * 2 * Math.PI / count);
      });
    }
  });
  it('72 ticks from 120 px, 60 under it, 24 at icon size', () => {
    expect([radialPx('xs'), radialPx('sm'), radialPx('md'), radialPx('lg'), radialPx(90)]).toEqual([28, 72, 120, 160, 90]);
    expect([28, 72, 119, 120, 160].map(radialCount)).toEqual([24, 60, 60, 72, 72]);
    expect(radialModel({ value: 1, goal: 2, size: 'xs' }).count).toBe(24);
    expect(radialModel({ value: 1, goal: 2, size: 'md' }).count).toBe(72);
    expect(radialModel({ value: 1, goal: 2, count: 6 }).count).toBe(6);
  });

  it('lights round(share × count) ticks of a goal-scaled ring and none of an unknown one', () => {
    const m = radialModel({ value: 7605, goal: 9000 });
    expect(m.arcs[0]!.lit).toBe(Math.round((7605 / 9000) * 72));
    expect(m.arcs[0]!.ticks.filter((t) => t.lit)).toHaveLength(61);
    expect(m.arcs[0]!.ticks.find((t) => t.edge)!.i).toBe(60);
    expect(m.over).toBe(false);
    const unknown = radialModel({ value: null, goal: 9000 });
    expect(unknown.known).toBe(false);
    expect(unknown.arcs[0]!.lit).toBe(0);
    for (const state of ['none', 'unknown', 'loading'] as const) expect(radialModel({ value: 5000, goal: 9000, state }).arcs[0]!.lit).toBe(0);
  });

  it('fractional lights a partly lit tick instead of rounding', () => {
    const arc = radialModel({ value: 7605, goal: 9000, fractional: true }).arcs[0]!;
    expect(arc.lit).toBe(60);
    const partial = arc.ticks[60]!.partial;
    expect(partial).toBeGreaterThan(0.8);
    expect(partial).toBeLessThan(0.9);
  });

  it('past the scale the ring is full and the second lap lights the excess; a limit has none', () => {
    const arc = radialModel({ value: 10_800, goal: 9000 }).arcs[0]!;
    expect(arc.lit).toBe(72);
    expect(arc.lapOn).toBe(true);
    expect(arc.lap).toBe(Math.round(0.2 * 72));
    expect(radialModel({ value: 10_800, goal: 9000 }).over).toBe(true);
    expect(radialModel({ value: 10_800, goal: 9000, lap2: false }).arcs[0]!.lapOn).toBe(false);
    expect(radialModel({ value: 10_800, goal: 9000, goalKind: 'limit' }).arcs[0]!.lapOn).toBe(false);
    // twice the goal: the second lap is full too
    expect(radialModel({ value: 20_000, goal: 9000 }).arcs[0]!.lap).toBe(72);
  });

  it('a `max` makes the goal a longer tick, and `mark` says where else', () => {
    const m = radialModel({ value: 79, max: 200, goal: 150 });
    expect(m.markIndex).toBe(Math.round(0.75 * 72));
    expect(m.arcs[0]!.ticks.find((t) => t.mark)!.i).toBe(54);
    expect(radialModel({ value: 5, goal: 10 }).markIndex).toBeNull();
    expect(radialModel({ value: 5, goal: 10, mark: 10 }).markIndex).toBe(0);
    expect(radialModel({ value: 5, max: 10, mark: 5 }).markIndex).toBe(36);
  });

  it('quiet lights three steps, or the ratio when asked; no second lap in steps', () => {
    expect(radialModel({ value: 7605, goal: 9000, quiet: true }).arcs[0]!.lit).toBe(72);
    expect(radialModel({ value: 4000, goal: 9000, quiet: true }).arcs[0]!.lit).toBe(48);
    expect(radialModel({ value: 1000, goal: 9000, quiet: true }).arcs[0]!.lit).toBe(24);
    expect(radialModel({ value: 3000, goal: 9000, quiet: true, quietFill: 'ratio' }).arcs[0]!.lit).toBe(24);
    expect(radialModel({ value: 12_000, goal: 9000, quiet: true }).arcs[0]!.lapOn).toBe(false);
  });

  it('a band and a pending amount become arcs in radians', () => {
    const m = radialModel({ value: 50, max: 100, band: [40, 60], pending: 20 });
    expect(m.band![0]).toBeCloseTo(0.4 * 2 * Math.PI, 10);
    expect(m.band![1]).toBeCloseTo(0.6 * 2 * Math.PI, 10);
    expect(m.pending![0]).toBeCloseTo(0.5 * 2 * Math.PI, 10);
    expect(m.pending![1]).toBeCloseTo(0.7 * 2 * Math.PI, 10);
    expect(radialModel({ value: 50, max: 100, band: [60, 40] }).band).toBeNull();
  });

  const PARTS: RadialPart[] = [
    { id: 'recovery', label: 'Recovery', value: 71, hue: 'recovery' },
    { id: 'activity', label: 'Activity', value: 92, hue: 'steps', confidence: 'low' },
    { id: 'sleep', label: 'Sleep', value: null, hue: 'sleep', needs: 'needs 3 more nights' },
  ];
  it('parts split the ring into arcs with 8 degree gaps, 24 ticks each; a missing part lights nothing', () => {
    const m = radialModel({ value: 84, parts: PARTS });
    expect(m.arcs).toHaveLength(3);
    expect(m.count).toBe(24);
    expect(m.arcs.map((a) => a.lit)).toEqual([Math.round(0.71 * 24), Math.round(0.92 * 24), 0]);
    expect(m.arcs[2]!.missing).toBe(true);
    expect(m.arcs[1]!.low).toBe(true);
    for (const a of m.arcs) {
      expect(a.ticks).toHaveLength(24);
      expect(a.end - a.start).toBeCloseTo(112 * DEG, 10);
    }
    // the first arc is centred on 12 o'clock; the arcs are 120 degrees apart
    expect((m.arcs[0]!.start + m.arcs[0]!.end) / 2).toBeCloseTo(0, 10);
    expect(m.arcs[1]!.start - m.arcs[0]!.start).toBeCloseTo(120 * DEG, 10);
  });
  it('quiet parts light thirds of their own arc', () => {
    const quiet = [{ ...PARTS[0]!, value: 20 }, { ...PARTS[1]!, value: 50 }, { ...PARTS[0]!, id: 'x', value: 90 }];
    expect(radialModel({ value: 84, parts: quiet, quiet: true }).arcs.map((a) => a.lit)).toEqual([8, 16, 24]);
    expect(radialModel({ value: 84, parts: PARTS, quiet: true }).arcs.map((a) => a.lit)).toEqual([24, 24, 0]);
  });
});

describe('spokenRadial', () => {
  it('says value, goal and whether it was reached, plainly', () => {
    expect(plain(spokenRadial({ label: 'Steps', value: 7605, goal: 9000, unit: 'steps' }))).toBe('Steps: 7,605 steps, goal 9,000 steps');
    expect(plain(spokenRadial({ label: 'Steps', value: 9000, goal: 9000, unit: 'steps' }))).toContain('goal reached');
    expect(plain(spokenRadial({ label: 'Heart Points', value: 194, goal: 150, unit: 'points' }))).toBe('Heart Points: 194 points, goal 150 points, past the goal');
    expect(plain(spokenRadial({ label: 'Eaten', value: 2450, goal: 2100, goalKind: 'limit', unit: 'kcal' }))).toBe('Eaten: 2,450 kcal, limit 2,100 kcal, over the limit');
    expect(plain(spokenRadial({ label: 'Protein', value: 32, goal: 150, goalKind: 'floor', unit: 'g' }))).toBe('Protein: 32 g, at least 150 g');
  });
  it('takes the caller’s words, a spoken override, and tags stale, provisional and learning', () => {
    expect(plain(spokenRadial({ label: 'Sleep', value: 476, goal: 480, valueText: '7 h 56', goalText: '8 h' }))).toBe('Sleep: 7 h 56, goal 8 h');
    expect(spokenRadial({ label: 'Sleep', value: 1, goal: 2, spoken: 'Slept well' })).toBe('Slept well');
    expect(spokenRadial({ label: 'HR', value: 79, max: 200, state: 'stale', unit: 'bpm' })).toMatch(/, stale$/);
    expect(spokenRadial({ label: 'HR', value: 79, max: 200, state: 'provisional', unit: 'bpm' })).toMatch(/, provisional$/);
    expect(spokenRadial({ label: 'HRV', value: 48, max: 100, state: 'learning' })).toMatch(/, still learning$/);
  });
  it('null is "no value yet", loading says so, quiet has no digit', () => {
    expect(spokenRadial({ label: 'Steps', value: null, goal: 9000 })).toBe('Steps, no value yet');
    expect(spokenRadial({ label: 'Steps', value: 5000, goal: 9000, state: 'loading' })).toBe('Steps, loading');
    expect(spokenRadial({ label: 'Steps', value: 7605, goal: 9000, quiet: true })).toBe('Steps, over half of the goal');
    expect(spokenRadial({ label: 'Steps', value: 7605, goal: 9000, quiet: true, quietWord: 'most of the goal' })).toBe('Steps, most of the goal');
  });
  it('parts read like the Day score: the score, then each part; missing parts say what they need', () => {
    const parts: RadialPart[] = [
      { id: 'r', label: 'Recovery', value: 71 },
      { id: 'a', label: 'Activity', value: 92 },
      { id: 's', label: 'Sleep', value: null, needs: 'needs 3 more nights' },
    ];
    expect(spokenRadial({ label: 'Day score', value: 82, parts })).toBe('Day score 82 of 100: recovery 71, activity 92, sleep needs 3 more nights');
    const quiet = spokenRadial({ label: 'Day score', value: 82, parts, quiet: true });
    expect(quiet).not.toMatch(/\d/);
    expect(quiet).toContain('sleep needs three more nights');
    expect(spokenRadial({ label: 'Day score', value: null, parts })).toMatch(/^Day score, no score yet:/);
  });
});

describe('RadialTicks', () => {
  it('is a meter whose value text is the sentence; the ticks and the centre are hidden from assistive technology', () => {
    const { container } = render(<RadialTicks label="Steps" value={7605} goal={9000} unit="steps" centre={<span>7,605</span>} />);
    const m = screen.getByRole('meter', { name: 'Steps' });
    expect(plain(m.getAttribute('aria-valuetext'))).toBe('Steps: 7,605 steps, goal 9,000 steps');
    expect(m).toHaveAttribute('aria-valuemin', '0');
    expect(m).toHaveAttribute('aria-valuemax', '9000');
    expect(m).toHaveAttribute('aria-valuenow', '7605');
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.lmz-radial__centre')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.lmz-radial__centre')).toHaveTextContent('7,605');
    expect(container.querySelectorAll('.lmz-radial__t')).toHaveLength(72);
    expect(litCount(container)).toBe(61);
  });

  it('size sets the box and the tick count', () => {
    const { container } = render(<RadialTicks label="Steps" value={50} goal={100} size="sm" />);
    expect(container.querySelectorAll('.lmz-radial__t')).toHaveLength(60);
    expect(container.querySelector('.lmz-radial')).toHaveStyle({ '--lmz-size': '72px' });
  });

  it('a value past the aria max is capped, an unknown has no numbers and no lit tick', () => {
    const { container, rerender } = render(<RadialTicks label="Steps" value={12000} goal={9000} />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '9000');
    expect(container.querySelector('.lmz-radial')).toHaveAttribute('data-over', 'true');
    rerender(<RadialTicks label="Steps" value={null} goal={9000} />);
    const m = screen.getByRole('meter');
    expect(m).not.toHaveAttribute('aria-valuenow');
    expect(m).toHaveAttribute('aria-valuetext', 'Steps, no value yet');
    expect(litCount(container)).toBe(0);
  });

  it('the second lap is an inner ring of dashes, lit by the excess', () => {
    const { container } = render(<RadialTicks label="Heart Points" value={194} goal={150} />);
    const lap = container.querySelectorAll('.lmz-radial__lap');
    expect(lap).toHaveLength(72);
    expect(container.querySelectorAll('.lmz-radial__lap[data-lit]')).toHaveLength(Math.round((194 / 150 - 1) * 72));
    expect(litCount(container)).toBe(72);
    const limit = render(<RadialTicks label="Eaten" value={2450} goal={2100} goalKind="limit" />);
    expect(limit.container.querySelectorAll('.lmz-radial__lap')).toHaveLength(0);
  });

  it('draws the longer goal tick, the band, the pending arc and a hollow zero', () => {
    const { container, rerender } = render(<RadialTicks label="Heart rate" value={79} max={200} goal={150} band={[60, 100]} pending={20} />);
    expect(container.querySelectorAll('.lmz-radial__t[data-mark]')).toHaveLength(1);
    expect(container.querySelector('.lmz-radial__band')).not.toBeNull();
    expect(container.querySelector('.lmz-radial__pending')).not.toBeNull();
    rerender(<RadialTicks label="Steps" value={0} goal={9000} />);
    expect(container.querySelector('.lmz-radial__t[data-zero]')).not.toBeNull();
    expect(litCount(container)).toBe(0);
  });

  it('states: provisional and learning are patterns on the lit ticks, loading is busy and bare', () => {
    const { container, rerender } = render(<RadialTicks label="Steps" value={7605} goal={9000} state="provisional" />);
    expect(container.querySelector('.lmz-radial')).toHaveAttribute('data-state', 'provisional');
    expect(screen.getByRole('meter').getAttribute('aria-valuetext')).toMatch(/provisional$/);
    rerender(<RadialTicks label="Steps" value={7605} goal={9000} state="loading" />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('meter')).not.toHaveAttribute('aria-valuenow');
    expect(litCount(container)).toBe(0);
  });

  it('quiet: no digit in the markup or in any aria attribute, and the fill is three steps', () => {
    const { container } = render(<RadialTicks label="Steps" value={7605} goal={9000} quiet quietWord="most of the goal" centre={<span>about three quarters</span>} />);
    const m = screen.getByRole('meter');
    for (const a of ['aria-valuenow', 'aria-valuemin', 'aria-valuemax']) expect(m).not.toHaveAttribute(a);
    for (const el of container.querySelectorAll('[aria-label],[aria-valuetext]')) expect(`${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('aria-valuetext') ?? ''}`).not.toMatch(/\d/);
    expect(container.textContent).not.toMatch(/\d/);
    expect(litCount(container)).toBe(72);
  });

  it('parts: a legend names the arcs, a missing part is a dashed outline with its need, low confidence is dashed', () => {
    const parts: RadialPart[] = [
      { id: 'r', label: 'Recovery', value: 71, hue: 'recovery' },
      { id: 'a', label: 'Activity', value: 92, hue: 'steps', confidence: 'low' },
      { id: 's', label: 'Sleep', value: null, hue: 'sleep', needs: 'needs 3 more nights' },
    ];
    const { container } = render(<RadialTicks label="Day score" value={82} parts={parts} size="lg" />);
    expect(container.querySelectorAll('g[data-arc]')).toHaveLength(3);
    expect(container.querySelectorAll('.lmz-radial__missing')).toHaveLength(1);
    expect(container.querySelector('g[data-arc="a"]')).toHaveAttribute('data-low', 'true');
    expect(container.querySelector('g[data-arc="r"]')).toHaveAttribute('data-hue', 'recovery');
    const legend = container.querySelector('.lmz-radial__legend')!;
    expect(legend.textContent).toContain('Recovery');
    expect(legend.textContent).toContain('needs 3 more nights');
    expect(plain(screen.getByRole('meter').getAttribute('aria-valuetext'))).toBe('Day score 82 of 100: recovery 71, activity 92, sleep needs 3 more nights');
    const quiet = render(<RadialTicks label="Day score" value={82} parts={parts} quiet />);
    expect(quiet.container.textContent).not.toMatch(/\d/);
  });

  it('twin: a Table key shows the rows of the ring; radialTwin carries the same words', async () => {
    const props = { label: 'Steps', value: 7605, goal: 9000, unit: 'steps' } as const;
    const twin = radialTwin(props);
    expect(twin.head).toEqual(['Measure', 'Value']);
    expect(twin.rows.map((r) => plain(String(r[0])))).toEqual(['Value', 'Goal', 'Share of goal']);
    expect(plain(String(twin.rows[2]![1]))).toBe('85 %');
    render(<RadialTicks {...props} twin />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.getByRole('region', { name: 'Steps table' })).toBeInTheDocument();
    expect(plain(document.body.textContent)).toContain('7,605 steps');
    // quiet draws no table
    const { container } = render(<RadialTicks {...props} twin quiet />);
    expect(container.querySelector('.lmz-twin')).toBeNull();
  });

  it('a card can hand the ring its own twin node', () => {
    render(<RadialTicks label="Steps" value={1} goal={2} twin={<p>my table</p>} />);
    expect(screen.getByText('my table')).toBeInTheDocument();
  });

  it('the final markup is identical with animate on and off', async () => {
    const props = { label: 'Steps', value: 7605, goal: 9000, unit: 'steps', band: [7000, 8000] as [number, number], centre: <b>7,605</b> };
    const off = render(<RadialTicks {...props} animate={false} />).container.innerHTML;
    const restore = await fakeMotion();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const on = render(<RadialTicks {...props} />);
      await act(async () => {});
      // mid-sweep the ticks still carry their delays; once the sweep has settled the markup is the static one
      expect(on.container.querySelector('.lmz-radial__t[data-lit]')).toHaveStyle({ '--d': '0' });
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      expect(on.container.innerHTML).toBe(off);
    } finally {
      vi.useRealTimers();
      restore();
    }
  });

  it('first view is pending until the ring is in view, and then sweeps only the ticks that changed', async () => {
    const restore = await fakeMotion({ inView: false });
    try {
      const { container } = render(<RadialTicks label="Steps" value={7605} goal={9000} />);
      expect(container.querySelector('.lmz-radial')).toHaveAttribute('data-reveal', 'pending');
    } finally {
      restore();
    }
    const restore2 = await fakeMotion();
    try {
      const { container, rerender } = render(<RadialTicks label="Steps" value={4500} goal={9000} />);
      await act(async () => {});
      expect(container.querySelector('.lmz-radial')).not.toHaveAttribute('data-reveal');
      rerender(<RadialTicks label="Steps" value={5400} goal={9000} />);
      const ticks = [...container.querySelectorAll<SVGLineElement>('.lmz-radial__t')];
      const delays = ticks.map((t) => t.style.getPropertyValue('--d'));
      // 36 → 43 lit: only ticks 36..42 carry a delay, counted from 0 (never from the start of the ring)
      expect(delays.slice(0, 36).every((d) => d === '')).toBe(true);
      expect(delays.slice(36, 43)).toEqual(['0', '1', '2', '3', '4', '5', '6']);
      expect(delays.slice(43).every((d) => d === '')).toBe(true);
    } finally {
      restore2();
    }
  });

  it('animate={false} and the sweep alias render the final frame at once', async () => {
    const restore = await fakeMotion({ inView: false });
    try {
      const a = render(<RadialTicks label="Steps" value={7605} goal={9000} animate={false} />);
      expect(a.container.querySelector('.lmz-radial')).not.toHaveAttribute('data-reveal');
      const b = render(<RadialTicks label="Steps" value={7605} goal={9000} sweep={false} />);
      expect(b.container.querySelector('.lmz-radial')).not.toHaveAttribute('data-reveal');
    } finally {
      restore();
    }
  });

  it('a hue override sets data-hue on the picture', () => {
    const { container } = render(<RadialTicks label="Heart rate" value={79} max={200} hue="heart" />);
    expect(container.querySelector('.lmz-radial')).toHaveAttribute('data-hue', 'heart');
  });
});
