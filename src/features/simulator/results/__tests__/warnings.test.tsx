/**
 * Warning day ranges and averaging notes (QA 2026-10-01): the panel shows the engine's own range (0-based inclusive
 * `startDay`/`endDay`, displayed 1-based) and its message verbatim — a 7-day-mean rule's "Averaged over the last 7
 * days" note included — and the remedy link hands the schedule exactly that range (`?days=a-b`, 0-based inclusive, as
 * `ScheduleView` parses it). Nothing is re-offset by the averaging window.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import type { SimWarning } from '@/engine';
import { WarningsPanel } from '../components/WarningsPanel';
import { groupWarnings, toWarningItem, warningRemedy, type WarningRemedy } from '../lib/warnings';

afterEach(() => cleanup());

const START = '2026-10-05';
// the engine's W-E03 / W-13-ALPERT templates, placeholders filled
const E03 =
  'Averaged over the last 7 days, your deficit is 44% of maintenance (training included). Above about 30% the model shows more muscle loss and stronger hunger and hormone effects. Results vary.';
const ALPERT =
  'Averaged over the last 7 days your deficit (1645 kcal/day) is above about 1274 kcal/day, ¾ of the most energy body fat is thought to supply. Beyond that the model draws more from lean tissue.';
const M03 = 'Protein above 35% of energy risks nausea and excess ammonia and crowds out other nutrients. A suggested ceiling is about 25% of energy.';

const warn = (id: string, severity: SimWarning['severity'], startDay: number, endDay: number, peakValue: number, message: string): SimWarning => ({
  id: id as SimWarning['id'],
  severity,
  startDay,
  endDay,
  peakValue,
  message,
  src: '17 §3',
});

/** The results screen's link shape (ResultsView `scheduleHref`): `day` = first affected date, `days` = the range, `fix` = rule. */
const remedyHref = (r: WarningRemedy) => `/simulate/s1/schedule?${new URLSearchParams({ days: `${r.startDay}-${r.endDay}`, fix: r.ruleId })}`;

/** ScheduleView's parse of `?days=a-b` (0-based, inclusive). */
function selectedDays(href: string): number[] {
  const m = /^(\d+)-(\d+)$/.exec(new URL(href, 'http://x').searchParams.get('days') ?? '')!;
  const out: number[] = [];
  for (let d = Number(m[1]); d <= Number(m[2]); d++) out.push(d);
  return out;
}

function mount(warnings: SimWarning[]) {
  return render(
    <MemoryRouter>
      <WarningsPanel groups={groupWarnings(warnings)} startDate={START} onShow={() => {}} remedyHref={remedyHref} />
    </MemoryRouter>,
  );
}

describe('warning ranges and notes are the engine’s', () => {
  it('a 7-day-mean rule on days 0–13 reads "days 1–14", keeps the averaging note verbatim and links days=0-13', () => {
    const w = warn('W-E03', 'caution', 0, 13, 44.2, E03);
    mount([w]);
    const row = screen.getByText('Your deficit reaches 44 % of maintenance.').closest('li')!;
    // the engine's message, word for word, note first
    expect(within(row).getByText(E03)).toBeInTheDocument();
    expect(within(row).getByText(/^Averaged over the last 7 days, /)).toBeInTheDocument();
    // the engine's range, 1-based, with the matching dates (5 Oct = day 1 … 18 Oct = day 14)
    expect(within(row).getByText('days 1–14 · 5 Oct – 18 Oct')).toBeInTheDocument();
    const link = within(row).getByRole('link', { name: 'Adjust energy on days 1–14' });
    const href = link.getAttribute('href')!;
    expect(new URL(href, 'http://x').searchParams.get('days')).toBe('0-13');
    expect(new URL(href, 'http://x').searchParams.get('fix')).toBe('W-E03');
    expect(selectedDays(href)).toEqual(Array.from({ length: 14 }, (_, i) => i));
  });

  it('keeps each rule’s own range: no shift by the averaging window, single days read "day N"', () => {
    const list = [
      warn('W-M03', 'danger', 0, 13, 45, M03),
      warn('W-13-ALPERT', 'caution', 5, 13, 1645, ALPERT),
      warn('W-E04', 'danger', 13, 13, 44, 'Averaged over the last 7 days, your deficit is over 40% of maintenance (training included): beyond what is usually studied outside clinical or research supervision. Individual risk is higher.'),
    ];
    const items = list.map((w) => toWarningItem(w));
    expect(items.map((i) => [i.startDay, i.endDay, i.daysText])).toEqual([
      [0, 13, 'days 1–14'],
      [5, 13, 'days 6–14'],
      [13, 13, 'day 14'],
    ]);
    // authored titles: the whole engine message is the body, verbatim
    expect(items.map((i) => i.body)).toEqual(list.map((w) => w.message));
    expect(list.map((w) => warningRemedy(w))).toEqual([
      { label: 'Lower protein on days 1–14', startDay: 0, endDay: 13, ruleId: 'W-M03' },
      { label: 'Adjust energy on days 6–14', startDay: 5, endDay: 13, ruleId: 'W-13-ALPERT' },
      { label: 'Adjust energy on day 14', startDay: 13, endDay: 13, ruleId: 'W-E04' },
    ]);
    mount(list);
    expect(screen.getByText(ALPERT)).toBeInTheDocument();
    expect(new URL(screen.getByRole('link', { name: 'Lower protein on days 1–14' }).getAttribute('href')!, 'http://x').searchParams.get('days')).toBe('0-13');
    expect(new URL(screen.getByRole('link', { name: 'Adjust energy on day 14' }).getAttribute('href')!, 'http://x').searchParams.get('days')).toBe('13-13');
    expect(screen.getByText('day 14 · 18 Oct')).toBeInTheDocument();
  });

  it('an unauthored rule keeps the engine note in its title and the rest as the body (both verbatim)', () => {
    const msg = 'Averaged over the last 7 days, something specific is high. Here is what to do.';
    const it0 = toWarningItem(warn('W-Q99', 'caution', 0, 13, 0, msg));
    expect(`${it0.title} ${it0.body}`).toBe(msg);
    expect(it0.daysText).toBe('days 1–14');
  });
});
