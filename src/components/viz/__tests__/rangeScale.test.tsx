/**
 * RangeScale (r071): the ticks, marker and bands as pure geometry; the sentence and the table; the meter role, quiet
 * mode, the states; and the same final markup with `animate` on and off.
 */
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RangeScale, bandAt, rangeTwin, scaleModel, spokenRange, type RangeBand, type RangeScaleProps } from '../RangeScale';
import { fakeMotion } from './motionHelpers';

const HRV: RangeScaleProps = { label: 'HRV', value: 48, min: 20, max: 80, usual: [38, 62], unit: 'ms', spokenUnit: 'milliseconds' };
const BANDS: RangeBand[] = [
  { from: -Infinity, word: 'Calm', severity: 'ok' },
  { from: 34, word: 'Elevated', severity: 'caution' },
  { from: 67, word: 'High', severity: 'danger' },
];
const STRESS: RangeScaleProps = { label: 'Stress', value: 59, min: 0, max: 100, bands: BANDS, unit: 'ring index' };
const text = (el: Element) => el.textContent ?? '';

describe('scaleModel', () => {
  it('41 ticks, a long one every fifth, the usual range lit, the marker at the value', () => {
    const m = scaleModel(HRV);
    expect(m.ticks).toHaveLength(41);
    expect(m.ticks.filter((t) => t.major)).toHaveLength(9);
    expect(m.ticks.filter((t) => t.usual)).toHaveLength(17);
    expect(m.ticks[0]!.x).toBe(2);
    expect(m.ticks[40]!.x).toBe(298);
    expect(m.marker).toBeCloseTo(2 + (28 / 60) * 296, 5);
    expect(m.position).toBe('within');
    expect(m.clamped).toBeNull();
  });

  it('inline is 96 wide with fewer ticks; a number sets the count', () => {
    expect(scaleModel({ ...HRV, size: 'inline' })).toMatchObject({ w: 96, h: 12 });
    expect(scaleModel({ ...HRV, size: 'inline' }).ticks).toHaveLength(17);
    expect(scaleModel({ ...HRV, ticks: 21 }).ticks).toHaveLength(21);
  });

  it('a value outside the scale sits at the end and says so; above and below the usual range', () => {
    expect(scaleModel({ ...HRV, value: 95 })).toMatchObject({ clamped: 'above', position: 'above', marker: 298 });
    expect(scaleModel({ ...HRV, value: 5 })).toMatchObject({ clamped: 'below', position: 'below', marker: 2 });
    expect(scaleModel({ ...HRV, value: 30 }).position).toBe('below');
  });

  it('bands: the band holding the value, edges as long ticks only in bands mode, each band as a share of the scale', () => {
    const m = scaleModel({ ...STRESS, ticks: 'bands' });
    expect(m.band?.word).toBe('Elevated');
    expect(m.ticks.filter((t) => t.edge).map((t) => t.value)).toEqual([34, 67]);
    expect(m.spans.map((s) => Math.round(s.width * 100))).toEqual([34, 33, 33]);
    expect(scaleModel(STRESS).ticks.some((t) => t.edge)).toBe(false);
    expect(bandAt(BANDS, 10)?.word).toBe('Calm');
    expect(bandAt(BANDS, 90)?.word).toBe('High');
    expect(bandAt(undefined, 1)).toBeNull();
  });

  it('calibrating lights no usual ticks; none has no marker', () => {
    expect(scaleModel({ ...HRV, state: 'calibrating' }).ticks.some((t) => t.usual)).toBe(false);
    expect(scaleModel({ ...HRV, state: 'none' }).marker).toBeNull();
    expect(scaleModel({ ...HRV, value: null }).marker).toBeNull();
  });
});

describe('words', () => {
  it('says the reading, its unit, the band and the usual range', () => {
    expect(spokenRange(HRV)).toBe('HRV 48 milliseconds, your usual range 38 to 62');
    expect(spokenRange(STRESS)).toBe('Stress 59 ring index, elevated');
    expect(spokenRange({ ...HRV, bands: BANDS.map((b) => ({ ...b, from: b.from === -Infinity ? b.from : b.from + 0 })) })).toMatch(/, your usual range 38 to 62$/);
  });

  it('quiet speaks words only', () => {
    expect(spokenRange({ ...HRV, quiet: true })).toBe('HRV, within your usual range');
    expect(spokenRange({ ...STRESS, quiet: true })).toBe('Stress, elevated');
    expect(spokenRange({ label: 'Light', value: 4000, min: 2000, max: 6500, quiet: true })).toBe('Light, in the middle of the scale');
    for (const q of [HRV, STRESS]) expect(spokenRange({ ...q, quiet: true })).not.toMatch(/\d/);
  });

  it('none, calibrating and stale', () => {
    expect(spokenRange({ ...HRV, state: 'none' })).toBe('HRV: no reading');
    expect(spokenRange({ ...HRV, value: null })).toBe('HRV: no reading');
    expect(spokenRange({ ...HRV, state: 'calibrating' })).toBe('HRV 48 milliseconds, building your baseline');
    expect(spokenRange({ ...HRV, state: 'calibrating', quiet: true })).toBe('HRV: building your baseline');
    expect(spokenRange({ ...HRV, state: 'stale', ageText: '3 h ago' })).toBe('HRV 48 milliseconds, your usual range 38 to 62, stale, 3 h ago');
  });

  it('rangeTwin lists the reading, the band, the usual range, the scale and every band edge', () => {
    const t = rangeTwin({ ...STRESS, usual: [30, 50] });
    expect(t.head).toEqual(['Measure', 'Value']);
    expect(t.rows.map((r) => r[0])).toEqual(['Reading', 'State', 'Usual range', 'Scale', 'Calm', 'Elevated', 'High']);
    expect(t.rows[0]).toEqual(['Reading', '59 ring index']);
    expect(t.rows[4]).toEqual(['Calm', 'below the first edge']);
  });
});

describe('RangeScale render', () => {
  it('is a meter whose value text is the sentence, with the numbers', () => {
    const { container } = render(<RangeScale {...HRV} />);
    const m = screen.getByRole('meter', { name: 'HRV' });
    expect(m).toHaveAttribute('aria-valuenow', '48');
    expect(m).toHaveAttribute('aria-valuemin', '20');
    expect(m).toHaveAttribute('aria-valuemax', '80');
    expect(m).toHaveAttribute('aria-valuetext', 'HRV 48 milliseconds, your usual range 38 to 62');
    expect(container.querySelectorAll('.lmz-scale__t')).toHaveLength(41);
    expect(container.querySelectorAll('.lmz-scale__t[data-in]')).toHaveLength(17);
    expect(container.querySelector('.lmz-scale__marker')).not.toBeNull();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('quiet drops the numeric attributes and every digit; the marker stays', () => {
    const { container } = render(<RangeScale {...STRESS} quiet ticks="bands" endLabels={['0', '100']} />);
    const m = screen.getByRole('meter');
    for (const a of ['aria-valuenow', 'aria-valuemin', 'aria-valuemax']) expect(m).not.toHaveAttribute(a);
    expect(m.getAttribute('aria-valuetext')).not.toMatch(/\d/);
    expect(text(container)).not.toMatch(/\d/);
    expect(container.querySelector('.lmz-scale__marker')).not.toBeNull();
  });

  it('end labels are real text; quiet keeps the ones without a digit', () => {
    const { container, rerender } = render(<RangeScale label="Light" value={3400} min={2000} max={6500} endLabels={['Warm', '6500 K']} unit="K" />);
    expect(text(container)).toContain('Warm');
    expect(text(container)).toContain('6500 K');
    rerender(<RangeScale label="Light" value={3400} min={2000} max={6500} endLabels={['Warm', '6500 K']} unit="K" quiet />);
    expect(text(container)).toContain('Warm');
    expect(text(container)).not.toContain('6500');
  });

  it('bands mode names each band with a mark and marks the current one', () => {
    const { container } = render(<RangeScale {...STRESS} ticks="bands" />);
    const words = [...container.querySelectorAll('.lmz-scale__band')];
    expect(words.map((w) => w.textContent)).toEqual(['Calm', 'Elevated', 'High']);
    expect(words.map((w) => w.getAttribute('data-severity'))).toEqual(['ok', 'caution', 'danger']);
    expect(container.querySelector('.lmz-scale__band[data-current]')).toHaveTextContent('Elevated');
    expect(container.querySelectorAll('.lmz-scale__mark')).toHaveLength(3);
  });

  it('when the words of every band do not fit, the current band is named once under the scale', () => {
    const many: RangeBand[] = ['Very low', 'Low', 'Fair', 'Good', 'High', 'Very high'].map((word, i) => ({ from: i === 0 ? -Infinity : i * 16, word, severity: 'info' as const }));
    const { container } = render(<RangeScale label="Level" value={55} min={0} max={100} bands={many} ticks="bands" />);
    expect(container.querySelector('.lmz-scale__bands')).toBeNull();
    const solo = container.querySelector('.lmz-scale__band--solo');
    expect(solo).toHaveTextContent('Good');
    expect(container.querySelector('.lmz-scale__labels')).toHaveAttribute('data-solo');
  });

  it('end labels keep their sides when quiet hides one: the left word stays on the left', () => {
    const { container } = render(<RangeScale label="Light" value={4000} min={2000} max={6500} endLabels={['2000 K', 'Cool']} quiet />);
    const labels = [...container.querySelectorAll('.lmz-scale__labels > .lm-mono')].map((n) => n.textContent);
    expect(labels).toEqual(['', 'Cool']);
  });

  it('inline is a 96 px glyph with no labels', () => {
    const { container } = render(<RangeScale {...HRV} size="inline" endLabels={['a', 'b']} />);
    expect(container.firstElementChild).toHaveAttribute('data-size', 'inline');
    expect(container.querySelector('svg')).toHaveAttribute('width', '96');
    expect(container.querySelector('.lmz-scale__labels')).toBeNull();
  });

  it('calibrating draws no lit ticks and says building baseline; none says no reading; stale says its age', () => {
    const { container, rerender } = render(<RangeScale {...HRV} state="calibrating" />);
    expect(container.querySelector('.lmz-scale__t[data-in]')).toBeNull();
    expect(text(container)).toContain('Building baseline');
    rerender(<RangeScale {...HRV} state="none" value={null} />);
    expect(container.querySelector('.lmz-scale__marker')).toBeNull();
    expect(text(container)).toContain('No reading');
    expect(screen.getByRole('meter')).not.toHaveAttribute('aria-valuenow');
    rerender(<RangeScale {...HRV} state="stale" ageText="3 h ago" />);
    expect(text(container)).toContain('3 h ago');
    expect(container.querySelector('.lmz-scale__stale')).not.toBeNull();
    expect(container.querySelector('.lmz-scale__marker')).toHaveAttribute('data-hollow', 'true');
  });

  it('the Table twin draws when asked', () => {
    render(<RangeScale {...HRV} twin />);
    expect(screen.getByRole('button', { name: /table/i })).toBeInTheDocument();
  });

  it('the final markup is the same with animate on and off', async () => {
    const off = render(<RangeScale {...HRV} animate={false} />).container.innerHTML;
    const restore = await fakeMotion();
    try {
      const { container } = render(<RangeScale {...HRV} />);
      expect(container.firstElementChild).toHaveAttribute('data-reveal', 'pending');
      await act(async () => {});
      expect(container.firstElementChild).not.toHaveAttribute('data-reveal');
      expect(container.innerHTML).toBe(off);
    } finally {
      restore();
    }
  });
});
