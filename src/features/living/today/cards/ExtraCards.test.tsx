import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { extraTodayCards, sleepHistoryData } from './ExtraCards';
import type { TodayCardCtx } from './types';

describe('Today optional-card adapters', () => {
  it('keeps a missing sleep night unknown, chooses the main session, and averages recorded nights only', () => {
    const data = sleepHistoryData(
      ['2026-10-28', '2026-10-29', '2026-10-30'],
      [
        { wakingDate: '2026-10-28', asleepMinutes: 400 },
        { wakingDate: '2026-10-28', asleepMinutes: 25 },
        { wakingDate: '2026-10-30', asleepMinutes: 480 },
      ],
    );
    expect(data.values).toEqual([400, null, 480]);
    expect(data.average).toBe(440);
    expect(data.averageUpper).toBe(440);
    expect(data.nights).toBe(2);
  });
  it('retains the observed range and incomplete pattern instead of treating a partial night as complete', () => {
    const data = sleepHistoryData(
      ['2026-10-30'],
      [
        {
          wakingDate: '2026-10-30',
          asleepMinutes: 300,
          metrics: { tstLowerMin: 270, tstUpperMin: 360, incomplete: true },
        },
      ],
    );
    expect(data.values).toEqual([270]);
    expect(data.average).toBe(270);
    expect(data.averageUpper).toBe(360);
    expect(data.outline).toEqual([true]);
  });
  it('does not manufacture an average when no nights were recorded', () => {
    expect(sleepHistoryData(['2026-10-30'], [])).toMatchObject({
      values: [null],
      average: null,
      averageUpper: null,
      nights: 0,
    });
  });
  it('retains every requested optional id once and hides energy balance in quiet mode', () => {
    const ids = extraTodayCards.map((c) => c.id);
    expect(new Set(ids).size).toBe(17);
    expect(ids).toContain('sleep-4w');
    expect(ids).toContain('why');
    const c = { plan: {}, quiet: true } as TodayCardCtx;
    expect(extraTodayCards.find((d) => d.id === 'energy-balance')!.available(c)).toEqual({
      ok: false,
      reason: 'Hidden in quiet mode',
    });
  });
  it('opens Ring › Sleep on the card’s own night, and the history on its month', () => {
    const ctx = { date: '2026-10-20', today: '2026-10-30', isToday: false, quiet: false, nowMs: Date.parse('2026-10-30T12:00:00Z') } as unknown as TodayCardCtx;
    const hrefs = ['sleep-timing', 'sleep-hr', 'sleep-4w'].map((id) => {
      const d = extraTodayCards.find((c) => c.id === id)!;
      const { container, unmount } = render(<MemoryRouter>{d.render(ctx, d.defaultSize)}</MemoryRouter>);
      const href = container.querySelector('a')?.getAttribute('href');
      unmount();
      return href;
    });
    expect(hrefs).toEqual(['/sleep/2026-10-20', '/sleep/2026-10-20', '/ring/sleep?period=month&date=2026-10-01']);
  });
  it('names each signal once and keeps its qualifier as a fact under the number', () => {
    const ctx = { date: '2026-10-30', today: '2026-10-30', isToday: true, quiet: false, nowMs: Date.parse('2026-10-30T12:00:00Z') } as unknown as TodayCardCtx;
    for (const [id, title, fact] of [['hrv', 'HRV', 'Overnight'], ['skin-temp', 'Skin temperature', 'Overnight · vs usual']] as const) {
      const d = extraTodayCards.find((c) => c.id === id)!;
      const { unmount, container } = render(<MemoryRouter>{d.render(ctx, d.defaultSize)}</MemoryRouter>);
      expect(container.querySelector('h2')).toHaveTextContent(new RegExp(`^${title}$`));
      expect(screen.getByText(fact)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: `Open ${title}` })).toHaveAttribute('href', `/ring/signals/${id === 'hrv' ? 'hrv' : 'temp'}`);
      unmount();
    }
  });
  it('uses the model’s percentage directly for the plan score', () => {
    const ctx = { quiet: false, view: { adherence: { a7: 85 } } } as unknown as TodayCardCtx;
    const d = extraTodayCards.find((c) => c.id === 'plan-score')!;
    render(<MemoryRouter>{d.render(ctx, 'tile')}</MemoryRouter>);
    expect(screen.getByRole('img', { name: 'Plan score 85 percent' })).toBeInTheDocument();
  });
  it('renders words for optional plan-card measurements in quiet mode and keeps a remove action in the information panel', () => {
    const onRemove = vi.fn();
    const ctx = {
      plan: { startDate: '2026-10-01', plannedEndDate: '2026-12-01' },
      date: '2026-10-30',
      quiet: true,
      isToday: true,
      view: {
        adherence: { a7: 85 },
        logged: { fast: { state: 'running', sinceH: 14 } },
        prescription: { fast: { hours: 16 } },
        drift: null,
      },
    } as unknown as TodayCardCtx;
    const defs = extraTodayCards.filter((d) =>
      ['plan-day', 'plan-score', 'fast', 'goal', 'why'].includes(d.id),
    );
    const { container } = render(
      <MemoryRouter>
        {defs.map((d) => (
          <div key={d.id}>{d.render(ctx, d.defaultSize, onRemove)}</div>
        ))}
      </MemoryRouter>,
    );
    expect(container.textContent).not.toMatch(/\d/);
    fireEvent.click(screen.getByRole('button', { name: 'About Plan day' }));
    const panel = screen.getByRole('dialog');
    fireEvent.click(within(panel).getByRole('button', { name: 'Remove from Today: Plan day' }));
    expect(onRemove).toHaveBeenCalledOnce();
  });
});
