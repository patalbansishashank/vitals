import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { LocalDate } from '@/living';
import { periodWindow, type PeriodKind, type SignalsTab } from '../models';
import { PeriodBar } from '../PeriodBar';

const TODAY = '2026-10-04';

function renderBar(o: { tab?: SignalsTab; kind?: PeriodKind; anchor?: LocalDate; ref?: LocalDate; first?: LocalDate | null; dates?: LocalDate[] } = {}) {
  const onPeriod = vi.fn();
  const onDate = vi.fn();
  const user = userEvent.setup();
  const w = periodWindow(o.kind ?? 'day', o.anchor ?? TODAY, TODAY);
  render(
    <PeriodBar
      tab={o.tab ?? 'heart'}
      window={w}
      today={TODAY}
      referenceDay={o.ref ?? TODAY}
      firstDate={o.first === undefined ? '2026-01-15' : o.first}
      datesWithData={new Set(o.dates ?? ['2026-10-01', '2026-09-15'])}
      onPeriod={onPeriod}
      onDate={onDate}
    />,
  );
  const label = () => document.querySelector<HTMLButtonElement>('.sp-period__label')!;
  return { user, onPeriod, onDate, label };
}

describe('period bar', () => {
  it('is a radio group day · week · month · year; arrows select', async () => {
    const { user, onPeriod } = renderBar({ kind: 'week' });
    const group = screen.getByRole('radiogroup', { name: 'Period' });
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['day', 'week', 'month', 'year']);
    expect(within(group).getByRole('radio', { name: 'week' })).toHaveAttribute('aria-checked', 'true');
    within(group).getByRole('radio', { name: 'week' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onPeriod).toHaveBeenLastCalledWith('month');
    await user.click(within(group).getByRole('radio', { name: 'day' }));
    expect(onPeriod).toHaveBeenLastCalledWith('day');
  });

  it('‹ › step to the canonical neighbour; › is blocked on the current period', async () => {
    const { user, onDate } = renderBar({ kind: 'month', anchor: '2026-09-17' });
    expect(screen.getByRole('button', { name: /September 2026/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(onDate).toHaveBeenLastCalledWith('2026-08-01');
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(onDate).toHaveBeenLastCalledWith('2026-10-01');
    // the "today" key shows because October (with today) is not in view
    await user.click(screen.getByRole('button', { name: 'Go to today' }));
    expect(onDate).toHaveBeenLastCalledWith(null);
  });

  it('on the current period: › is blocked, no "today" key', async () => {
    const { user, onDate } = renderBar({ kind: 'week' });
    const next = screen.getByRole('button', { name: 'Next week' });
    expect(next).toHaveAttribute('aria-disabled', 'true');
    await user.click(next);
    expect(onDate).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Go to today' })).not.toBeInTheDocument();
  });

  it('‹ is blocked on the period of the first record, and with nothing stored', () => {
    renderBar({ kind: 'year', first: '2026-01-15' });
    expect(screen.getByRole('button', { name: 'Previous year' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('sleep: "today" goes to the reference night and hides while it is in view', () => {
    renderBar({ tab: 'sleep', anchor: '2026-10-03', ref: '2026-10-03' });
    expect(screen.queryByRole('button', { name: 'Go to last night' })).not.toBeInTheDocument();
    expect(document.querySelector('.sp-period__label')).toHaveTextContent('Night to Sat 3 Oct');
  });

  it('sleep: an older night shows "today" (named "Go to last night")', () => {
    renderBar({ tab: 'sleep', anchor: '2026-09-30', ref: '2026-10-03' });
    expect(screen.getByRole('button', { name: 'Go to last night' })).toHaveTextContent('today');
  });
});

describe('calendar popover', () => {
  it('Escape closes it and focus returns to the label', async () => {
    const { user, label } = renderBar({ anchor: '2026-10-02' });
    await user.click(label());
    expect(label()).toHaveAttribute('aria-expanded', 'true');
    const dialog = await screen.findByRole('dialog', { name: 'Go to date' });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /^Friday 2 October/ })).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(label()).toHaveFocus();
  });

  it('arrows cross months, Home/End go to the week ends, Page Up/Down a month, Space picks', async () => {
    const { user, label, onDate } = renderBar({ anchor: '2026-10-02' });
    await user.click(label());
    const dialog = await screen.findByRole('dialog', { name: 'Go to date' });
    const focused = () => (document.activeElement as HTMLElement).getAttribute('data-date');
    await waitFor(() => expect(focused()).toBe('2026-10-02'));
    await user.keyboard('{ArrowUp}');
    expect(focused()).toBe('2026-09-25');
    expect(within(dialog).getByText('September 2026')).toBeInTheDocument();
    await user.keyboard('{Home}');
    expect(focused()).toBe('2026-09-21');
    await user.keyboard('{End}');
    expect(focused()).toBe('2026-09-27');
    await user.keyboard('{PageUp}');
    expect(focused()).toBe('2026-08-27');
    expect(within(dialog).getByText('August 2026')).toBeInTheDocument();
    await user.keyboard('{PageDown}{PageDown}');
    // Page Down from 27 Sep lands on 27 Oct, after today: clamped to today
    expect(focused()).toBe('2026-10-04');
    await user.keyboard('{ArrowRight}');
    expect(focused()).toBe('2026-10-04');
    await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft} ');
    expect(onDate).toHaveBeenLastCalledWith('2026-10-01');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('month keys: the next month stops at the current one; a click picks a day', async () => {
    const { user, label, onDate } = renderBar({ anchor: '2026-10-02' });
    await user.click(label());
    const dialog = await screen.findByRole('dialog', { name: 'Go to date' });
    expect(within(dialog).getByRole('button', { name: 'Next month' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(within(dialog).getByRole('button', { name: 'Previous month' }));
    expect(within(dialog).getByText('September 2026')).toBeInTheDocument();
    const sep15 = within(dialog).getByRole('button', { name: 'Tuesday 15 September 2026, has readings' });
    expect(sep15.querySelector('.sp-cal__dot')).not.toBeNull();
    // the month's first day is the one tab stop in the grid
    expect(within(dialog).getByRole('button', { name: /^Tuesday 1 September/ })).toHaveAttribute('tabindex', '0');
    await user.click(within(dialog).getByRole('button', { name: 'Next month' }));
    expect(within(dialog).getByText('October 2026')).toBeInTheDocument();
    for (const d of ['5', '17', '31']) expect(within(dialog).getByRole('button', { name: new RegExp(`^\\w+ ${d} October 2026, after today$`) })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Previous month' }));
    await user.click(sep15.isConnected ? sep15 : within(dialog).getByRole('button', { name: /^Tuesday 15 September/ }));
    expect(onDate).toHaveBeenLastCalledWith('2026-09-15');
  });

  it('a grid labelled by its month, Monday first, with the selected day marked', async () => {
    const { user, label } = renderBar({ kind: 'week', anchor: '2026-09-23' });
    await user.click(label());
    const grid = await screen.findByRole('grid', { name: 'September 2026' });
    expect(within(grid).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(within(grid).getByRole('button', { name: /^Wednesday 23 September/ })).toHaveAttribute('data-selected', 'true');
    expect(within(grid).getByRole('gridcell', { selected: true })).toHaveTextContent('23');
  });
});
