import '../../test/setupDom';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TrendLane } from '../TrendLane';
import { trendFixture } from './fixtures';

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
};

afterEach(() => cleanup());

describe('<TrendLane>', () => {
  it('draws every weigh-in as a dot; flagged ones are hollow, never removed', async () => {
    const data = trendFixture();
    data.weighIns[7]!.flagged = true;
    const { container } = render(<TrendLane data={data} size="progress" />);
    await flush();
    const dots = container.querySelectorAll('[data-mark="weigh-in"]');
    expect(dots).toHaveLength(9);
    const flagged = container.querySelectorAll('[data-mark="weigh-in"][data-flagged="true"]');
    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.getAttribute('class')).toContain('lmc-tl__dot--flagged');
    expect(screen.getByText('unusual, kept')).toBeInTheDocument(); // legend
  });

  it('is one tab stop with the generated summary', async () => {
    render(<TrendLane data={trendFixture()} size="today" />);
    await flush();
    const plot = screen.getByRole('img', { name: /^Weight trend 83\.1 kilograms, expected today 82\.8 to 83\.6; 9 weigh-ins/ });
    expect(plot).toHaveAttribute('tabindex', '0');
  });

  it('draws the yellow now-hand only when today is in the window', async () => {
    const { container, rerender } = render(<TrendLane data={trendFixture()} size="today" />);
    await flush();
    expect(container.querySelectorAll('[data-mark="now"]')).toHaveLength(1);
    rerender(<TrendLane data={trendFixture({ todayIndex: null })} size="today" />);
    await flush();
    expect(container.querySelector('[data-mark="now"]')).toBeNull();
  });

  it('prints y numerals and the unit, and hides both in quiet mode (shape only)', async () => {
    const { container, rerender } = render(<TrendLane data={trendFixture()} size="checkin" />);
    await flush();
    expect(container.querySelectorAll('[data-mark="y-tick"]').length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('[data-mark="y-unit"]')?.textContent).toBe('kg');
    rerender(<TrendLane data={trendFixture()} size="checkin" quiet />);
    await flush();
    expect(container.querySelectorAll('[data-mark="y-tick"]')).toHaveLength(0);
    expect(container.querySelector('[data-mark="y-unit"]')).toBeNull();
    expect(screen.getByText('trend going down')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'table' })).toBeNull();
    expect(screen.getByRole('img', { name: /numbers hidden/ })).toBeInTheDocument();
  });

  it('a far goal becomes an edge label on Today; Progress stretches the scale to include it', async () => {
    const { container, rerender } = render(<TrendLane data={trendFixture()} size="today" />);
    await flush();
    expect(container.querySelector('[data-mark="goal-edge"]')?.textContent).toBe('goal 79.5 kg ↓');
    expect(container.querySelector('[data-mark="goal"]')).toBeNull();
    rerender(<TrendLane data={trendFixture()} size="progress" />);
    await flush();
    expect(container.querySelector('[data-mark="goal"]')).not.toBeNull();
    expect(container.querySelector('[data-mark="goal-edge"]')).toBeNull();
  });

  it('shows the goal-date bracket label and engraved event markers', async () => {
    const data = trendFixture({
      events: [
        { day: 4, kind: 'version', label: 'v2' },
        { day: 6, kind: 'pause', label: 'paused', endDay: 7 },
      ],
    });
    const { container } = render(<TrendLane data={data} size="progress" />);
    await flush();
    expect(container.querySelector('[data-mark="goal-date"]')?.textContent).toBe('likely 21–30 Dec');
    expect(container.querySelector('[data-mark="version"]')?.textContent).toBe('v2');
    expect(container.querySelector('[data-mark="pause"]')?.textContent).toBe('paused');
  });

  it('the table key toggles the table twin: date · weigh-in · trend · expected range · event', async () => {
    render(<TrendLane data={trendFixture({ events: [{ day: 4, kind: 'version', label: 'v2' }] })} size="checkin" />);
    await flush();
    expect(screen.queryByRole('table')).toBeNull();
    const key = screen.getByRole('button', { name: 'table' });
    expect(key).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(key);
    const table = screen.getByRole('table');
    expect(key).toHaveAttribute('aria-pressed', 'true');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['date', 'weigh-inkg', 'trendkg', 'expected rangekg', 'event']);
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(15);
    const today = within(table).getByRole('rowheader', { name: /Thu 1 Oct/ }).closest('tr')!;
    expect(within(today).getAllByRole('cell').map((c) => c.textContent)).toEqual(['83.3', '83.1', '82.8–83.6', '—']);
    expect(within(table).getByText('v2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeInTheDocument();
    fireEvent.click(key);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('keyboard: focus shows the crosshair at today, arrows move it a day, Esc clears', async () => {
    const { container } = render(<TrendLane data={trendFixture()} size="checkin" />);
    await flush();
    const plot = screen.getByRole('img', { name: /^Weight trend/ });
    act(() => plot.focus());
    expect(container.querySelector('[data-mark="crosshair"]')).not.toBeNull();
    expect(container.querySelector('.lmc-lv-tip b')?.textContent).toBe('Thu 1 Oct');
    fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    expect(container.querySelector('.lmc-lv-tip b')?.textContent).toBe('Wed 30 Sep');
    expect(container.querySelector('.lmc-lv-tip')?.textContent).toContain('expected 82.9–83.7');
    fireEvent.keyDown(plot, { key: 'Home' });
    expect(container.querySelector('.lmc-lv-tip b')?.textContent).toBe('Fri 18 Sep');
    fireEvent.keyDown(plot, { key: 'Escape' });
    expect(container.querySelector('[data-mark="crosshair"]')).toBeNull();
    fireEvent.keyDown(plot, { key: 't' });
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('never uses a status colour: marks are body hue, ink and the now-hand only', async () => {
    const { container } = render(<TrendLane data={trendFixture()} size="progress" />);
    await flush();
    const html = container.innerHTML;
    expect(html).not.toMatch(/--lm-(danger|caution|ok|status|signal)\b/);
  });
});
