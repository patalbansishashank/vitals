/**
 * DottedTrack (r071): the dot model (snapped lit width, thumb, second lap, marks), the sentences, the quiet and unknown
 * forms, and the final markup being the same with animate on and off.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DottedTrack, TRACK_PITCH, spokenTrack, trackColumns, trackModel, trackTwin } from '../DottedTrack';
import { canonicalHtml, fakeMotion } from './motionHelpers';

const plain = (s: string | null | undefined) => (s ?? '').replace(/\u00a0/g, ' ');

describe('trackColumns', () => {
  it('one dot per 8 px, at least 8; an explicit count wins but never closer than 4 px', () => {
    expect(trackColumns(288)).toBe(36);
    expect(trackColumns(40)).toBe(8);
    expect(trackColumns(300, 28)).toBe(28);
    expect(trackColumns(100, 90)).toBe(25);
    expect(trackColumns(300, 1)).toBe(37);
  });
});

describe('trackModel', () => {
  it('snaps the lit width down to whole dots and rests the thumb in the next slot (Eaten 750 of 1 850)', () => {
    const m = trackModel({ value: 750, goal: 1850, width: 288 });
    expect(m.columns).toBe(36);
    expect(m.pitch).toBe(TRACK_PITCH);
    expect(m.litCols).toBe(Math.floor((750 / 1850) * 36));
    expect(m.litCols).toBe(14);
    expect(m.litPx).toBe(112);
    expect(m.thumbPx).toBe(116);
    expect(m.span).toBe(288);
    expect(m.known).toBe(true);
    expect(m.lapped).toBe(false);
  });

  it('a track is always a whole number of dots wide and the lit width is a whole number of dots', () => {
    for (const w of [173, 288, 301, 347, 600]) {
      const m = trackModel({ value: 12.34, goal: 50, width: w });
      expect(m.litPx % m.pitch).toBeCloseTo(0, 9);
      expect(m.span).toBe(m.columns * m.pitch);
      expect(m.span).toBeLessThanOrEqual(w);
    }
  });

  it('reaching the goal fills every dot and rests the thumb on the last one', () => {
    const m = trackModel({ value: 150, goal: 150, width: 288 });
    expect(m.litCols).toBe(36);
    expect(m.thumbPx).toBe(35.5 * 8);
    expect(m.lapped).toBe(false);
  });

  it('past the goal the second lap lights from the start and the thumb wraps onto it', () => {
    const m = trackModel({ value: 2450, goal: 2100, width: 288 });
    expect(m.lapped).toBe(true);
    expect(m.litCols).toBe(36);
    expect(m.lapCols).toBe(Math.floor((2450 / 2100 - 1) * 36));
    expect(m.thumbPx).toBe((m.lapCols + 0.5) * 8);
    expect(trackModel({ value: 9000, goal: 2100, width: 288 }).lapCols).toBe(36);
  });

  it('null, unknown and loading are not zero: nothing lit, no thumb position implied', () => {
    expect(trackModel({ value: null, goal: 100 }).known).toBe(false);
    expect(trackModel({ value: 50, goal: 100, state: 'unknown' }).known).toBe(false);
    expect(trackModel({ value: 50, goal: 100, state: 'loading' }).litCols).toBe(0);
  });

  it('spans a domain: a plan day 15 of 84 with week marks, a planned position and a range', () => {
    const m = trackModel({ value: 15, goal: 84, from: 0, to: 84, width: 336, ticks: { count: 84, majorEvery: 7 }, ghost: 20, band: [10, 30], marks: [{ at: 28, label: 'Week 4' }, { at: 2 }, { at: 84 }] });
    expect(m.columns).toBe(84);
    expect(m.pitch).toBe(4);
    expect(m.litCols).toBe(Math.floor((15 / 84) * 84));
    expect(m.majorEvery).toBe(7);
    expect(m.goalX).toBe(m.span);
    expect(m.ghostX).toBeCloseTo((20 / 84) * m.span, 9);
    expect(m.bandX![0]).toBeCloseTo((10 / 84) * m.span, 9);
    expect(m.marks.map((k) => k.align)).toEqual(['mid', 'start', 'end']);
  });

  it('a second tone covers the first `valueB` of the fill, never more than the fill', () => {
    expect(trackModel({ value: 600, goal: 1000, valueB: 200, width: 288 }).bCols).toBe(Math.floor(0.2 * 36));
    expect(trackModel({ value: 600, goal: 1000, valueB: 900, width: 288 }).bCols).toBe(Math.floor(0.6 * 36));
    expect(trackModel({ value: 600, goal: 1000, valueB: null, width: 288 }).bCols).toBe(0);
  });
});

describe('spokenTrack', () => {
  const base = { label: 'Protein', value: 32, goal: 150, valueText: '32 g', goalText: 'of 150 g' } as const;
  it('says value and goal; floor says at least, limit says limit', () => {
    expect(spokenTrack(base)).toBe('Protein: 32 g, goal 150 g');
    expect(spokenTrack({ ...base, goalKind: 'floor' })).toBe('Protein: 32 g, at least 150 g');
    expect(spokenTrack({ ...base, label: 'Eaten', value: 1900, goal: 2100, valueText: '1 900 kcal', goalText: 'of 2 100 kcal', goalKind: 'limit' })).toBe('Eaten: 1 900 kcal, limit 2 100 kcal');
  });
  it('a goal reached or passed is plain: never praise, "over" only for a limit', () => {
    expect(spokenTrack({ ...base, value: 150 })).toContain('goal reached');
    expect(spokenTrack({ ...base, value: 190 })).toBe('Protein: 32 g, goal 150 g, past the goal');
    expect(spokenTrack({ ...base, value: 190, goalKind: 'limit' })).toContain('over the limit');
  });
  it('adds the planned position, the likely range and provisional', () => {
    const s = spokenTrack({ ...base, unit: 'kg', ghost: 85, band: [84, 86], state: 'provisional' });
    expect(s).toBe('Protein: 32 g, goal 150 g, planned 85 kg, likely 84 kg to 86 kg, provisional');
  });
  it('unknown speaks the caller’s words, quiet and loading speak none of the numbers', () => {
    expect(spokenTrack({ ...base, value: null, valueText: 'Nothing logged yet' })).toBe('Protein, Nothing logged yet');
    expect(spokenTrack({ ...base, value: null, valueText: '' })).toBe('Protein, no value yet');
    expect(spokenTrack({ ...base, quiet: true })).toBe('Protein, under half of the goal');
    expect(spokenTrack({ ...base, quiet: true, quietWord: 'about a fifth' })).toBe('Protein, about a fifth');
    expect(spokenTrack({ ...base, state: 'loading' })).toBe('Protein, loading');
  });
});

describe('DottedTrack', () => {
  it('is a meter whose value text is the sentence; the dots are hidden from assistive technology', () => {
    const { container } = render(<DottedTrack label="Energy eaten" value={750} goal={1850} valueText="750 kcal" goalText="of 1 850 kcal" />);
    const m = screen.getByRole('meter', { name: 'Energy eaten' });
    expect(plain(m.getAttribute('aria-valuetext'))).toBe('Energy eaten: 750 kcal, goal 1 850 kcal');
    expect(m).toHaveAttribute('aria-valuemin', '0');
    expect(m).toHaveAttribute('aria-valuemax', '1850');
    expect(m).toHaveAttribute('aria-valuenow', '750');
    for (const svg of container.querySelectorAll('svg')) expect(svg).toHaveAttribute('aria-hidden', 'true');
    // the unlit layer holds every dot; the lit layer is the same dots, clipped to the snapped width by a variable
    expect(container.querySelectorAll('[data-layer="unlit"] circle')).toHaveLength(36);
    expect(container.querySelectorAll('[data-layer="lit"] circle')).toHaveLength(36);
    const bar = container.querySelector('.lmz-track__bar') as HTMLElement;
    expect(bar.style.getPropertyValue('--lit')).toBe('112px');
    expect(bar.style.getPropertyValue('--span')).toBe('288px');
    expect(bar.style.getPropertyValue('--thumb')).toBe('116px');
    expect(container.querySelector('.lmz-track__thumb')).not.toBeNull();
    expect(container.querySelector('.lmz-track__notch')).not.toBeNull();
  });

  it('over a limit: the second lap is drawn and the words say over the limit, never praise', () => {
    const { container } = render(<DottedTrack label="Eaten" value={2450} goal={2100} goalKind="limit" valueText="2 450 kcal" goalText="of 2 100 kcal" />);
    expect(container.querySelector('[data-layer="lap"]')).not.toBeNull();
    expect(container.querySelector('.lmz-track')).toHaveAttribute('data-over', 'true');
    expect(container.querySelector('.lmz-track')).toHaveAttribute('data-kind', 'limit');
    expect(plain(screen.getByRole('meter').getAttribute('aria-valuetext'))).toContain('over the limit');
    expect(container.innerHTML).not.toMatch(/danger|rose/);
    // a value inside the goal draws no second lap
    const inside = render(<DottedTrack label="Eaten" value={1000} goal={2100} valueText="1 000 kcal" />);
    expect(inside.container.querySelector('[data-layer="lap"]')).toBeNull();
  });

  it('unknown draws no fill and no thumb, and says why in the caller’s words', () => {
    const { container } = render(<DottedTrack label="Protein" value={null} goal={150} valueText="Not known for what was logged" thumb />);
    expect(container.querySelector('.lmz-track__thumb')).toBeNull();
    expect(container.querySelector('[data-layer="lit"]')).toBeNull();
    expect(container.querySelector('[data-layer="unlit"]')).not.toBeNull();
    const m = screen.getByRole('meter');
    expect(m).not.toHaveAttribute('aria-valuenow');
    expect(m).toHaveAttribute('aria-valuetext', 'Protein, Not known for what was logged');
    expect(container.querySelector('.lmz-track')).toHaveAttribute('data-unknown', 'true');
  });

  it('loading is busy with the unlit dots only; `thumb={false}` draws none', () => {
    const { container, rerender } = render(<DottedTrack label="Steps" value={5000} goal={9000} valueText="5 000" state="loading" />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('[data-layer="lit"]')).toBeNull();
    expect(container.querySelector('.lmz-track__thumb')).toBeNull();
    rerender(<DottedTrack label="Steps" value={5000} goal={9000} valueText="5 000" thumb={false} />);
    expect(container.querySelector('.lmz-track__thumb')).toBeNull();
    expect(container.querySelector('[data-layer="lit"]')).not.toBeNull();
  });

  it('provisional is a pattern (a state the CSS draws as dotted rings), a hue and a second tone are data attributes', () => {
    const { container } = render(<DottedTrack label="Steps" value={5000} goal={9000} valueText="5 000" state="provisional" hue="steps" litB="food" valueB={2000} />);
    expect(container.querySelector('.lmz-track')).toHaveAttribute('data-state', 'provisional');
    expect(container.querySelector('.lmz-track')).toHaveAttribute('data-hue', 'steps');
    expect(container.querySelector('[data-layer="b"]')).toHaveAttribute('data-hue', 'food');
    expect(plain(screen.getByRole('meter').getAttribute('aria-valuetext'))).toMatch(/provisional$/);
  });

  it('quiet: no digit anywhere (aria included), no numeric aria, and the fill still follows the ratio', () => {
    const { container } = render(<DottedTrack label="Energy eaten" value={750} goal={1850} valueText="750 kcal" goalText="of 1 850 kcal" quiet endLabels={['start', 'goal']} />);
    const m = screen.getByRole('meter');
    for (const a of ['aria-valuenow', 'aria-valuemin', 'aria-valuemax']) expect(m).not.toHaveAttribute(a);
    for (const el of container.querySelectorAll('[aria-label],[aria-valuetext]')) expect(`${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('aria-valuetext') ?? ''}`).not.toMatch(/\d/);
    expect(container.textContent).not.toMatch(/\d/);
    expect((container.querySelector('.lmz-track__bar') as HTMLElement).style.getPropertyValue('--lit')).toBe('112px');
  });

  it('marks, a planned position, a range, end labels and mark labels', () => {
    const { container } = render(
      <DottedTrack label="Plan" value={15} goal={84} from={0} to={84} valueText="Day 15" goalText="of 84" ticks={{ count: 84, majorEvery: 7 }} ghost={20} band={[10, 30]} marks={[{ at: 28, label: 'Week 4', tone: 'hue' }, { at: 56, tone: 'caution' }]} endLabels={['Day 1', 'Day 84']} />,
    );
    expect(container.querySelectorAll('.lmz-track__mark')).toHaveLength(2);
    expect(container.querySelector('.lmz-track__ghost')).not.toBeNull();
    expect(container.querySelector('.lmz-track__band')).not.toBeNull();
    expect(container.querySelector('.lmz-track__marklabel')).toHaveTextContent('Week 4');
    expect(container.querySelector('.lmz-track__ends')).toHaveTextContent('Day 1');
    expect(container.querySelector('.lmz-track__ends')).toHaveTextContent('Day 84');
    // week marks: every 7th dot is the larger one (the fallback width holds 72 dots, at least 4 px apart)
    const dots = [...container.querySelectorAll('[data-layer="unlit"] circle')];
    expect(dots).toHaveLength(72);
    expect(dots.filter((c) => c.getAttribute('r') === '2.6')).toHaveLength(11);
  });

  it('twin: the rows say value, goal and share; a Table key shows them', async () => {
    const props = { label: 'Protein', value: 32, goal: 150, goalKind: 'floor' as const, valueText: '32 g', goalText: 'of 150 g' };
    const twin = trackTwin(props);
    expect(twin.rows).toEqual([
      ['Value', '32 g'],
      ['At least', '150 g'],
      ['Share of goal', '21 %'],
    ]);
    render(<DottedTrack {...props} twin />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.getByRole('region', { name: 'Protein table' })).toBeInTheDocument();
  });

  it('the final markup is identical with animate on and off', async () => {
    const props = { label: 'Energy eaten', value: 750, goal: 1850, valueText: '750 kcal', goalText: 'of 1 850 kcal', marks: [{ at: 900, label: 'Lunch' }], band: [600, 900] as [number, number] };
    const off = render(<DottedTrack {...props} animate={false} />).container.innerHTML;
    const restore = await fakeMotion();
    try {
      const on = render(<DottedTrack {...props} />);
      await act(async () => {});
      expect(canonicalHtml(on.container.innerHTML)).toBe(canonicalHtml(off));
    } finally {
      restore();
    }
  });

  it('first view is pending until the track is in view; animate={false} and the sweep alias are final at once', async () => {
    const restore = await fakeMotion({ inView: false });
    try {
      const a = render(<DottedTrack label="Steps" value={5000} goal={9000} valueText="5 000" />);
      expect(a.container.querySelector('.lmz-track')).toHaveAttribute('data-reveal', 'pending');
      const b = render(<DottedTrack label="Steps" value={5000} goal={9000} valueText="5 000" animate={false} />);
      expect(b.container.querySelector('.lmz-track')).not.toHaveAttribute('data-reveal');
      const c = render(<DottedTrack label="Steps" value={5000} goal={9000} valueText="5 000" sweep={false} />);
      expect(c.container.querySelector('.lmz-track')).not.toHaveAttribute('data-reveal');
    } finally {
      restore();
    }
  });

  it('a change moves the clip and the thumb through variables (nothing animates width or left)', () => {
    const { container, rerender } = render(<DottedTrack label="Steps" value={4500} goal={9000} valueText="4 500" />);
    const bar = () => container.querySelector('.lmz-track__bar') as HTMLElement;
    expect(bar().style.getPropertyValue('--lit')).toBe('144px');
    rerender(<DottedTrack label="Steps" value={6750} goal={9000} valueText="6 750" />);
    expect(bar().style.getPropertyValue('--lit')).toBe('216px');
    expect(container.querySelector('.lmz-track')).toHaveAttribute('data-live', 'true');
  });
});
