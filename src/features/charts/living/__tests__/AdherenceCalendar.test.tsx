import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdherenceCalendar, calendarHeat, calendarWeeks, trimWeeks } from '../AdherenceCalendar';
import { calendarFixture } from './fixtures';

afterEach(() => cleanup());

const TODAY = '2026-10-15';

describe('calendarWeeks', () => {
  it('lays the month out Monday-first with padding, one cell per day', () => {
    const weeks = calendarWeeks('2026-10', calendarFixture(), TODAY);
    expect(weeks[0]!.slice(0, 3)).toEqual([null, null, null]); // 1 Oct 2026 is a Thursday
    expect(weeks[0]![3]?.date).toBe('2026-10-01');
    expect(weeks[0]![3]?.state).toBe('blank'); // not in the plan
    expect(weeks.flat().filter(Boolean)).toHaveLength(31);
    const sun = calendarWeeks('2026-10', calendarFixture(), TODAY, 'sun');
    expect(sun[0]![4]?.date).toBe('2026-10-01');
  });
});

describe('<AdherenceCalendar>', () => {
  it('renders the in-plan days as keys with full labels; out-of-plan days stay blank', () => {
    render(<AdherenceCalendar month="2026-10" days={calendarFixture()} today={TODAY} />);
    expect(screen.getByRole('grid', { name: 'Adherence, October 2026' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((h) => h.getAttribute('aria-label'))).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]);
    expect(screen.getAllByRole('button')).toHaveLength(30); // 2–31 Oct
    expect(screen.queryByRole('button', { name: /^Thu 1 Oct/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Wed 14 Oct, adherence 84' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thu 15 Oct, adherence 62 so far, today' })).toHaveAttribute('aria-current', 'date');
    expect(screen.getByRole('button', { name: 'Fri 9 Oct, not enough logged, not scored' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fri 16 Oct, coming up' })).toHaveClass('lmc-cal__day--future');
  });

  it('marks assumed days dashed and paused days struck', () => {
    const { container } = render(<AdherenceCalendar month="2026-10" days={calendarFixture()} today={TODAY} />);
    const assumed = screen.getByRole('button', { name: 'Mon 5 Oct, filled in as planned, not scored' });
    expect(assumed).toHaveClass('lmc-cal__day--assumed');
    const paused = screen.getByRole('button', { name: 'Wed 7 Oct, paused' });
    expect(paused).toHaveClass('lmc-cal__day--paused');
    expect(paused.querySelector('.lmc-cal__strike')).not.toBeNull();
    expect(screen.getByRole('button', { name: /^Fri 9 Oct/ }).querySelector('.lmc-cal__hollow')).not.toBeNull();
    // r071: an assumed day is a dashed ring (not scored), a scored one a heat dot whose intensity is the score
    expect(assumed.querySelector('.lmc-cal__assumed')).not.toBeNull();
    expect(screen.getByRole('button', { name: /^Wed 14 Oct/ }).querySelector('.lmc-cal__heat')).not.toBeNull();
    expect(screen.getByRole('button', { name: /^Wed 14 Oct/ }).querySelector('.lmc-dial')).toBeNull(); // the arcs live in the day's detail now
    expect(container.querySelectorAll('.lmc-cal__now')).toHaveLength(0);
    expect(container.querySelectorAll('[data-today="true"]')).toHaveLength(1);
  });

  it('a day logged but not scored carries a filled dot and says so', () => {
    const days = calendarFixture().map((d) => (d.date === '2026-10-09' ? { ...d, logged: true } : d));
    render(<AdherenceCalendar month="2026-10" days={days} today={TODAY} />);
    const key = screen.getByRole('button', { name: 'Fri 9 Oct, logged, not scored' });
    expect(key).toHaveAttribute('data-state', 'logged');
    expect(key.querySelector('.lmc-cal__logged')).not.toBeNull();
    expect(key.querySelector('.lmc-cal__hollow')).toBeNull();
  });

  it('quiet mode reads words, not numbers', () => {
    render(<AdherenceCalendar month="2026-10" days={calendarFixture()} today={TODAY} quiet />);
    expect(screen.getByRole('button', { name: 'Wed 14 Oct, adherence mostly' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thu 15 Oct, adherence mostly so far, today' })).toBeInTheDocument();
  });

  it('click selects the day', () => {
    const onSelect = vi.fn();
    render(<AdherenceCalendar month="2026-10" days={calendarFixture()} today={TODAY} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /^Wed 14 Oct/ }));
    expect(onSelect).toHaveBeenCalledWith('2026-10-14');
  });

  it('one tab stop (today); arrow keys move focus through the grid', () => {
    render(<AdherenceCalendar month="2026-10" days={calendarFixture()} today={TODAY} />);
    const tabbable = screen.getAllByRole('button').filter((b) => b.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
    const today = screen.getByRole('button', { name: /^Thu 15 Oct/ });
    expect(today.tabIndex).toBe(0);
    act(() => today.focus());
    fireEvent.keyDown(today, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Fri 16 Oct/ }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Fri 23 Oct/ }));
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Fri 2 Oct/ }));
    // 1 Oct is out of the plan: nothing to move to on the left
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Fri 2 Oct/ }));
    expect(screen.getByRole('button', { name: /^Fri 2 Oct/ }).tabIndex).toBe(0);
  });
});

describe('r071 heat dots', () => {
  it('the heat of a scored day runs from a faint dot to the full hue, never to nothing', () => {
    expect(calendarHeat(0)).toBeCloseTo(0.14, 6);
    expect(calendarHeat(100)).toBeCloseTo(1, 6);
    expect(calendarHeat(50)).toBeGreaterThan(calendarHeat(30));
    expect(calendarHeat(250)).toBe(1);
    expect(calendarHeat(-20)).toBeCloseTo(0.14, 6);
  });

  it('each scored day carries its heat as a variable, brighter for a higher score', () => {
    const { container } = render(<AdherenceCalendar month="2026-10" days={calendarFixture()} today={TODAY} />);
    const heat = (name: RegExp) => Number(screen.getByRole('button', { name }).querySelector<HTMLElement>('.lmc-cal__heat')!.style.getPropertyValue('--lmc-heat'));
    expect(heat(/^Wed 14 Oct/)).toBeCloseTo(calendarHeat(84), 3);
    expect(heat(/^Tue 13 Oct/)).toBeLessThan(heat(/^Wed 14 Oct/));
    // today's score is still being filled in: it says so on the dot, and the key's name says "so far"
    expect(screen.getByRole('button', { name: /^Thu 15 Oct/ }).querySelector('.lmc-cal__heat')).toHaveAttribute('data-final', 'false');
    expect(container.querySelector('.lmc-cal')).toHaveStyle({ '--lmc-hue': 'var(--lm-signal)' });
  });

  it('draws only the weeks the plan reaches', () => {
    // a plan that covers 12 to 14 Oct: the weeks before and after hold no in-plan day
    const days = calendarFixture().map((d) => ({ ...d, inPlan: d.date >= '2026-10-12' && d.date <= '2026-10-14' }));
    const all = calendarWeeks('2026-10', days, TODAY);
    const trimmed = trimWeeks(all);
    expect(all.length).toBe(5);
    expect(trimmed).toHaveLength(1);
    expect(trimmed[0]!.some((c) => c?.date === '2026-10-12')).toBe(true);
    render(<AdherenceCalendar month="2026-10" days={days} today={TODAY} />);
    expect(screen.getAllByRole('row')).toHaveLength(2); // the weekday row and the one week
    cleanup();
    render(<AdherenceCalendar month="2026-10" days={days} today={TODAY} trim={false} />);
    expect(screen.getAllByRole('row')).toHaveLength(6);
  });

  it('the first view is a data-reveal on the root only; with motion off the markup is the final one', () => {
    const a = render(<AdherenceCalendar month="2026-10" days={calendarFixture()} today={TODAY} />).container.innerHTML;
    cleanup();
    const b = render(<AdherenceCalendar month="2026-10" days={calendarFixture()} today={TODAY} animate={false} />).container.innerHTML;
    expect(a).toBe(b);
    expect(a).not.toContain('data-reveal');
  });
});
