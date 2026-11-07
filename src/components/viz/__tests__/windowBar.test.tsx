/**
 * WindowBar (r071): the axis, the bars and the relation to the usual window as pure geometry; the sentence and the
 * table; marks, quiet mode, and the same final markup with `animate` on and off.
 */
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WindowBar, spokenWindow, windowMarkLayout, windowModel, windowTicks, windowTwin, type WindowBarProps } from '../WindowBar';
import { fakeMotion } from './motionHelpers';

const T = (hhmm: string, day = '2026-10-30') => Date.parse(`${day}T${hhmm}:00Z`);
const AXIS = [T('20:00', '2026-10-29'), T('12:00')] as const;
const BASE: WindowBarProps = {
  label: 'Sleep timing',
  axis: AXIS,
  usual: { from: T('23:00', '2026-10-29'), to: T('07:00') },
  actual: { from: T('23:12', '2026-10-29'), to: T('07:08') },
  marks: [{ t: T('23:12', '2026-10-29'), label: 'Fell asleep 23:12' }, { t: T('07:08'), label: 'Woke 07:08' }],
  tz: 'UTC',
};
const text = (el: Element) => el.textContent ?? '';

describe('windowTicks', () => {
  it('round, clock-aligned hours thinned to the span', () => {
    expect(windowTicks(AXIS[0], AXIS[1], 'UTC').map((t) => t.text)).toEqual(['20', '00', '04', '08', '12']);
    expect(windowTicks(T('22:00'), T('06:00', '2026-10-31'), 'UTC').map((t) => t.text)).toEqual(['22', '00', '02', '04', '06']);
    expect(windowTicks(T('22:00'), T('04:00', '2026-10-31'), 'UTC').map((t) => t.text)).toEqual(['22', '23', '00', '01', '02', '03', '04']);
    expect(windowTicks(T('08:00'), T('12:30'), 'UTC').map((t) => t.text)).toEqual(['08', '09', '10', '11', '12']);
    expect(windowTicks(5, 5, 'UTC')).toEqual([]);
  });
});

describe('windowModel', () => {
  it('puts the windows on the axis in shares', () => {
    const m = windowModel(BASE);
    expect(m.usual?.x0).toBeCloseTo((3 / 16) * 100, 5);
    expect(m.usual?.x1).toBeCloseTo((11 / 16) * 100, 5);
    expect(m.actual?.x0).toBeCloseTo((3.2 / 16) * 100, 5);
    expect(m.actual?.clipped).toBe(false);
    expect(m.marks.map((k) => Math.round(k.x))).toEqual([20, 70]);
    expect(m.ticks.map((t) => Math.round(t.x))).toEqual([0, 25, 50, 75, 100]);
  });

  it('a window past the axis is clipped to it and says so', () => {
    const m = windowModel({ ...BASE, actual: { from: T('18:00', '2026-10-29'), to: T('07:00') } });
    expect(m.actual?.x0).toBe(0);
    expect(m.actual?.clipped).toBe(true);
  });

  it('relation: half an hour either way is usual; earlier and later otherwise', () => {
    expect(windowModel(BASE).relation).toEqual({ start: 'usual', end: 'usual' });
    expect(windowModel({ ...BASE, actual: { from: T('00:10'), to: T('08:30') } }).relation).toEqual({ start: 'later', end: 'later' });
    expect(windowModel({ ...BASE, actual: { from: T('22:00', '2026-10-29'), to: T('06:00') } }).relation).toEqual({ start: 'earlier', end: 'earlier' });
    expect(windowModel({ ...BASE, usual: undefined }).relation).toBeNull();
  });

  it('marks outside the axis are dropped; a missing or reversed window is not drawn', () => {
    expect(windowModel({ ...BASE, marks: [{ t: T('03:00', '2026-11-05'), label: 'x' }] }).marks).toHaveLength(0);
    expect(windowModel({ ...BASE, actual: { from: 5, to: 5 } }).actual).toBeNull();
    expect(windowModel({ ...BASE, usual: undefined }).usual).toBeNull();
  });
});

describe('windowMarkLayout', () => {
  it('centres a word on its tick, keeps it inside the plot, and moves a colliding one to the second row', () => {
    const one = windowMarkLayout([{ x: 50, label: 'Woke 07:08' }], 300);
    expect(one).toEqual([{ row: 0, align: 'center' }]);
    // 17 characters at the left edge cannot centre: it starts at its tick; the second starts too near and goes up a row
    const two = windowMarkLayout([{ x: 5, label: 'Fell asleep 23:12' }, { x: 40, label: 'Woke 07:08' }], 300);
    expect(two.map((p) => p.align)).toEqual(['start', 'center']);
    expect(two.map((p) => p.row)).toEqual([0, 1]);
    expect(windowMarkLayout([{ x: 95, label: 'Woke 07:08' }], 300)[0]).toEqual({ row: 0, align: 'end' });
  });
  it('a word that fits on neither row is left out (its tick stays)', () => {
    const three = windowMarkLayout([{ x: 40, label: 'AAAAAAAAAAAAAAAA' }, { x: 42, label: 'BBBBBBBBBBBBBBBB' }, { x: 44, label: 'CCCCCCCCCCCCCCCC' }], 300);
    expect(three.map((p) => p.row)).toEqual([0, 1, null]);
  });
});

describe('words', () => {
  it('says the actual window and the usual one', () => {
    expect(spokenWindow(BASE)).toBe('Sleep timing: 23:12 to 07:08, usual 23:00 to 07:00');
    expect(spokenWindow({ ...BASE, usual: undefined })).toBe('Sleep timing: 23:12 to 07:08');
    expect(spokenWindow({ ...BASE, actual: undefined })).toBe('Sleep timing: no window recorded, usual 23:00 to 07:00');
    expect(spokenWindow({ ...BASE, actual: { from: T('18:00', '2026-10-29'), to: T('07:00') } })).toMatch(/, clipped to the axis$/);
  });

  it('quiet: later, earlier or usual, in words, and never a digit', () => {
    expect(spokenWindow({ ...BASE, quiet: true })).toBe('Sleep timing: at your usual time');
    expect(spokenWindow({ ...BASE, quiet: true, actual: { from: T('00:10'), to: T('08:30') } })).toBe('Sleep timing: later than usual');
    expect(spokenWindow({ ...BASE, quiet: true, actual: { from: T('00:10'), to: T('06:00') } })).toBe('Sleep timing: started later than usual, ended earlier than usual');
    expect(spokenWindow({ ...BASE, quiet: true, actual: undefined })).toBe('Sleep timing: nothing recorded');
    for (const q of [BASE, { ...BASE, actual: undefined }]) expect(spokenWindow({ ...q, quiet: true })).not.toMatch(/\d/);
  });

  it('windowTwin lists the windows with their lengths, then the marks', () => {
    const t = windowTwin(BASE);
    expect(t.head).toEqual(['Window', 'From', 'To', 'Length']);
    expect(t.rows[0]).toEqual(['Actual', '23:12', '07:08', '7 h 56']);
    expect(t.rows[1]).toEqual(['Usual', '23:00', '07:00', '8 h']);
    expect(t.rows[2]).toEqual(['Fell asleep 23:12', '23:12', '', '']);
  });
});

describe('WindowBar render', () => {
  it('is one img with the sentence; a hairline band under a solid bar; hour labels and the marks with their words', () => {
    const { container } = render(<WindowBar {...BASE} />);
    expect(screen.getByRole('img', { name: spokenWindow(BASE) })).toBeInTheDocument();
    expect(container.querySelector('.lmz-win__usual')).not.toBeNull();
    const actual = container.querySelector<HTMLElement>('.lmz-win__actual')!;
    expect(parseFloat(actual.style.left)).toBeCloseTo(20, 1);
    expect([...container.querySelectorAll('.lmz-win__axis .lm-mono')].map((n) => n.textContent)).toEqual(['20', '00', '04', '08', '12']);
    expect([...container.querySelectorAll('.lmz-win__markword')].map((n) => n.textContent)).toEqual(['Fell asleep 23:12', 'Woke 07:08']);
    expect(container.querySelectorAll('.lmz-win__mark')).toHaveLength(2);
  });

  it('quiet draws the bars and prints no digit anywhere', () => {
    const { container } = render(<WindowBar {...BASE} quiet />);
    expect(container.querySelector('.lmz-win__actual')).not.toBeNull();
    expect(text(container)).not.toMatch(/\d/);
    expect(screen.getByRole('img').getAttribute('aria-label')).not.toMatch(/\d/);
    expect(container.querySelector('.lmz-win__axis')).toBeNull();
  });

  it('no actual window draws the usual band alone', () => {
    const { container } = render(<WindowBar {...BASE} actual={undefined} marks={undefined} />);
    expect(container.querySelector('.lmz-win__usual')).not.toBeNull();
    expect(container.querySelector('.lmz-win__actual')).toBeNull();
  });

  it('the Table twin draws when asked', () => {
    render(<WindowBar {...BASE} twin />);
    expect(screen.getByRole('button', { name: /table/i })).toBeInTheDocument();
  });

  it('the final markup is the same with animate on and off', async () => {
    const off = render(<WindowBar {...BASE} animate={false} />).container.innerHTML;
    const restore = await fakeMotion();
    try {
      const { container } = render(<WindowBar {...BASE} />);
      expect(container.firstElementChild).toHaveAttribute('data-reveal', 'pending');
      await act(async () => {});
      expect(container.firstElementChild).not.toHaveAttribute('data-reveal');
      expect(container.innerHTML).toBe(off);
    } finally {
      restore();
    }
  });
});
