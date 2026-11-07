/**
 * (r069 U2) The shared date control: one row that reads the selection and opens the calendar (a sheet on a phone);
 * every pick applies at once; the period bank, the range's two taps, "Today", the month and year zoom, the bounds,
 * the data dots and the keyboard.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DomainName } from '@/components';
import type { LocalDate } from '@/living';
import { DateControl, type DateMarks } from '../DateControl';
import { ALL_PERIODS, dayPeriod, type Period, type PeriodKind } from '../../period';

const TODAY = '2026-10-29';

function Harness({
  start = dayPeriod(TODAY),
  periods,
  max,
  useMarks,
  domain,
  onChange,
}: {
  start?: Period;
  periods?: readonly PeriodKind[];
  max?: LocalDate;
  useMarks?: DateMarks;
  domain?: DomainName;
  onChange?: (p: Period) => void;
}) {
  const [p, setP] = useState(start);
  return (
    <DateControl
      value={p}
      today={TODAY}
      periods={periods}
      max={max}
      useMarks={useMarks}
      domain={domain}
      onChange={(n) => {
        onChange?.(n);
        setP(n);
      }}
    />
  );
}

const trigger = () => screen.getByRole('button', { name: /, choose (a day|dates)$/ });
const calendar = () => screen.getByRole('dialog');
const grid = () => within(calendar()).getByRole('grid');

describe('DateControl', () => {
  it('shows only the selection and opens a Day-only calendar without a period bank', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(trigger()).toHaveAccessibleName('Today · Thu 29 Oct, choose a day');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /week/i })).toBeNull();
    await user.click(trigger());
    expect(await screen.findByRole('dialog', { name: 'Choose a day' })).toBeInTheDocument();
    expect(within(calendar()).queryByRole('radiogroup', { name: 'Period' })).toBeNull();
    expect(grid()).toHaveAccessibleName('October 2026');
    expect(within(grid()).getByRole('button', { name: /^Thu 29 Oct, today/ })).toHaveAttribute('aria-current', 'date');
  });

  it('applies a day at once and closes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(trigger());
    await user.click(within(grid()).getByRole('button', { name: /^Fri 23 Oct/ }));
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'day', from: '2026-10-23', to: '2026-10-23' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger()).toHaveAccessibleName('Fri 23 Oct, choose a day');
  });

  it('keeps days after `max` out of reach, and lets a plan page open days ahead without it', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness max={TODAY} />);
    await user.click(trigger());
    expect(within(grid()).getByRole('button', { name: /^Fri 30 Oct/ })).toBeDisabled();
    expect(within(calendar()).getByRole('button', { name: 'Next month' })).toBeDisabled();
    unmount();
    render(<Harness />);
    await user.click(trigger());
    expect(within(grid()).getByRole('button', { name: /^Fri 30 Oct/ })).toBeEnabled();
  });

  it('switches period from the bank (the page follows while the calendar stays open), then picks a week', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness periods={ALL_PERIODS} max={TODAY} onChange={onChange} />);
    await user.click(trigger());
    expect(await screen.findByRole('dialog', { name: 'Choose dates' })).toBeInTheDocument();
    const bank = within(calendar()).getByRole('radiogroup', { name: 'Period' });
    expect(within(bank).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Day', 'Week', 'Month', 'Year', 'Range']);
    await user.click(within(bank).getByRole('radio', { name: 'Week' }));
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'week', from: '2026-10-26', to: '2026-11-01' });
    expect(calendar()).toBeInTheDocument();
    expect(within(calendar()).getByText('This week · 26 Oct–1 Nov')).toBeInTheDocument();
    // the whole week is the selection
    const cells = within(grid()).getAllByRole('gridcell').filter((c) => c.getAttribute('aria-selected') === 'true');
    expect(cells).toHaveLength(6); // 26–31 Oct: 1 Nov is next month's
    await user.click(within(grid()).getByRole('button', { name: /^Wed 14 Oct/ }));
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'week', from: '2026-10-12', to: '2026-10-18' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger()).toHaveAccessibleName('Week · 12–18 Oct, choose dates');
  });

  it('takes a range in two taps, either order', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness periods={ALL_PERIODS} max={TODAY} onChange={onChange} />);
    await user.click(trigger());
    await user.click(within(calendar()).getByRole('radio', { name: 'Range' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(within(calendar()).getByText('Tap the first day')).toBeInTheDocument();
    await user.click(within(grid()).getByRole('button', { name: /^Tue 20 Oct/ }));
    expect(within(calendar()).getByText('Tue 20 Oct – tap the last day')).toBeInTheDocument();
    await user.click(within(grid()).getByRole('button', { name: /^Mon 12 Oct/ }));
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'range', from: '2026-10-12', to: '2026-10-20' });
    expect(trigger()).toHaveAccessibleName('12–20 Oct · 9 days, choose dates');
  });

  it('picks a month or a year from their own grids', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness periods={ALL_PERIODS} max={TODAY} onChange={onChange} />);
    await user.click(trigger());
    await user.click(within(calendar()).getByRole('radio', { name: 'Month' }));
    const months = within(calendar()).getByRole('group', { name: 'Months of 2026' });
    expect(within(months).getByRole('button', { name: 'October 2026' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(months).getByRole('button', { name: 'November 2026' })).toBeDisabled();
    await user.click(within(months).getByRole('button', { name: 'August 2026' }));
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'month', from: '2026-08-01', to: '2026-08-31' });
    await user.click(trigger());
    await user.click(within(calendar()).getByRole('radio', { name: 'Year' }));
    const years = within(calendar()).getByRole('group', { name: 'Years' });
    expect(within(years).getAllByRole('button').at(-1)).toHaveAccessibleName('2026');
    await user.click(within(years).getByRole('button', { name: '2025' }));
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'year', from: '2025-01-01', to: '2025-12-31' });
    expect(trigger()).toHaveAccessibleName('2025, choose dates');
  });

  it('zooms out from the month name to jump to another month', async () => {
    const user = userEvent.setup();
    render(<Harness max={TODAY} />);
    await user.click(trigger());
    await user.click(within(calendar()).getByRole('button', { name: 'October 2026, choose a month' }));
    await user.click(within(calendar()).getByRole('button', { name: 'March 2026' }));
    expect(grid()).toHaveAccessibleName('March 2026');
  });

  it('goes back to today (this week, …) in one tap', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness start={{ kind: 'week', from: '2026-09-07', to: '2026-09-13' }} periods={ALL_PERIODS} max={TODAY} onChange={onChange} />);
    await user.click(trigger());
    expect(grid()).toHaveAccessibleName('September 2026');
    await user.click(within(calendar()).getByRole('button', { name: 'This week' }));
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'week', from: '2026-10-26', to: '2026-11-01' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('marks the days that hold data, asking only for the month on screen', async () => {
    const user = userEvent.setup();
    const asked: string[] = [];
    const useMarks: DateMarks = (from, to) => {
      asked.push(`${from}/${to}`);
      return new Set(['2026-10-05']);
    };
    render(<Harness useMarks={useMarks} />);
    expect(asked).toEqual([]);
    await user.click(trigger());
    expect(asked.at(-1)).toBe('2026-10-01/2026-10-31');
    expect(within(grid()).getByRole('button', { name: 'Mon 5 Oct, has data' })).toHaveClass('has-data');
    expect(within(grid()).getByRole('button', { name: 'Tue 6 Oct' })).not.toHaveClass('has-data');
  });

  it('moves through the grid by keyboard, into the next month too', async () => {
    const user = userEvent.setup();
    render(<Harness start={dayPeriod('2026-09-29')} />);
    await user.click(trigger());
    const sel = within(grid()).getByRole('button', { name: /^Tue 29 Sep/ });
    expect(sel).toHaveAttribute('tabindex', '0');
    sel.focus();
    fireEvent.keyDown(sel, { key: 'ArrowDown' });
    expect(grid()).toHaveAccessibleName('October 2026');
    expect(document.activeElement).toHaveAccessibleName(/^Tue 6 Oct/);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(document.activeElement).toHaveAccessibleName(/^Mon 5 Oct/);
  });

  // r071: the tab's hue reaches the calendar icon and the dots of days that hold data
  it('takes the tab’s hue: data-domain on the row and on the calendar, which the icon and the dots read', async () => {
    const user = userEvent.setup();
    render(<Harness domain="energy" useMarks={() => new Set(['2026-10-27'])} />);
    expect(trigger()).toHaveAttribute('data-domain', 'energy');
    await user.click(trigger());
    expect(calendar().querySelector('.lv-cal')).toHaveAttribute('data-domain', 'energy');
    expect(within(grid()).getByRole('button', { name: /^Tue 27 Oct/ })).toHaveClass('has-data');
  });

  it('without a hue it has no data-domain (stone icon, stone dots)', () => {
    render(<Harness />);
    expect(trigger()).not.toHaveAttribute('data-domain');
  });
});

describe('DateControl styles (dateControl.css, beside the component since r071)', () => {
  const css = readFileSync(resolve(__dirname, '../dateControl.css'), 'utf8');
  const rule = (selector: string) => {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return css.match(new RegExp(`(?:^|\\n)\\s*${esc} \\{([^}]*)\\}`))?.[1] ?? '';
  };

  it('the row is a field-radius control in the card material, its dates a mono-caps fact, its icon the domain solid', () => {
    expect(readFileSync(resolve(__dirname, '../DateControl.tsx'), 'utf8')).toContain("import './dateControl.css';");
    expect(rule('.lv-datectl')).toMatch(/border-radius: var\(--lm-radius-field\);/);
    expect(rule('.lv-datectl')).toMatch(/background: var\(--lm-card-bg\);/);
    const detail = rule('.lv-datectl__detail');
    expect(detail).toMatch(/font-family: var\(--lm-text-meta--font\);/);
    expect(detail).toMatch(/text-transform: uppercase;/);
    expect(rule('.lv-datectl__icon')).toMatch(/color: var\(--lm-hue, var\(--lm-ink-2\)\);/);
    // selection stays gold: an open row's edge, the selected day and span
    expect(rule(".lv-datectl[aria-expanded='true']")).toMatch(/border-color: var\(--lm-gold-edge\);/);
    expect(css).toMatch(/\.lv-cal__cell\.is-sel::before \{[^}]*background: var\(--lm-gold-wash\);/);
  });

  it('a day that holds data wears the tab’s hue (stone without one); the weekday letters are mono caps', () => {
    expect(rule('.lv-cal__day.has-data::after')).toMatch(/background: var\(--lm-hue, var\(--lm-ink-3\)\);/);
    expect(rule('.lv-cal__day.has-data::after')).toMatch(/width: 5px;/);
    expect(rule('.lv-cal__wd')).toMatch(/text-transform: uppercase;/);
    expect(rule('.lv-cal__wd')).toMatch(/font-family: var\(--lm-text-meta--font\);/);
  });

  it('no longer lives in living.css (package 2 owns that file)', () => {
    expect(readFileSync(resolve(__dirname, '../../living.css'), 'utf8')).not.toMatch(/\.lv-datectl|\.lv-cal\b/);
  });
});
