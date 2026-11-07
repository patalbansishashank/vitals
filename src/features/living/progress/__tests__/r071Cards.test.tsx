import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '@/state/settingsStore';
import { renderLiving } from '../../testing';
import { FIXTURE_TODAY } from '../../data/fixtures';
import { demoActualsAdapter, demoGauge } from '../__fixtures__/activity';
import { setProgressActuals } from '../v3Adapter';
import { setProgressGauge } from '../data/gauge';
import ProgressPage from '../ProgressPage';

beforeEach(() => {
  setProgressActuals(demoActualsAdapter(FIXTURE_TODAY));
  setProgressGauge(demoGauge());
  act(() => useSettingsStore.getState().set({ quietMode: false }));
});
afterEach(() => {
  cleanup();
  setProgressActuals(null);
  setProgressGauge(null);
  act(() => useSettingsStore.getState().set({ quietMode: false }));
});

describe('r071 Progress cards', () => {
  it('shows mean energy balance as an integer hero with its scenario range beneath it', async () => {
    renderLiving(<ProgressPage />);
    const card = (await screen.findByRole('heading', { name: 'Energy out and intake' })).closest('section')!;
    expect(card.querySelectorAll('.lm-hero')).toHaveLength(1);
    const hero = card.querySelector('.lm-hero')!;
    expect(hero.getAttribute('aria-label')).toMatch(/Intake minus out −?\d+ kcal a day/);
    expect(hero.querySelector('.lm-hero__line')!.textContent).not.toMatch(/\d+\.\d| to /);
    expect(card.textContent).toMatch(/Likely −\d+ to −\d+ kcal\/day/);
    expect(document.querySelector('#checkins')).toHaveAttribute('data-size', 'card');
  });
  it('every card has a short explanation, its source and its range', async () => {
    const user = userEvent.setup();
    renderLiving(<ProgressPage />);
    await screen.findByRole('heading', { name: 'HRV' });
    const openers = screen.getAllByRole('button', { name: /^About / });
    expect(openers).toHaveLength(12);
    for (const opener of openers) {
      await user.click(opener);
      const panel = await screen.findByRole('dialog');
      const text = panel.querySelector('.lm-infopanel__text')?.textContent ?? '';
      expect(text.trim().split(/\s+/).length, opener.getAttribute('aria-label') ?? '').toBeGreaterThanOrEqual(
        25,
      );
      expect(text.trim().split(/\s+/).length, opener.getAttribute('aria-label') ?? '').toBeLessThanOrEqual(
        60,
      );
      expect(within(panel).getByText('Where this comes from')).toBeInTheDocument();
      expect(within(panel).getByText('Range', { exact: true, selector: '.lm-overflow__item' })).toBeInTheDocument();
      await user.click(within(panel).getByRole('button', { name: 'Close' }));
    }
  });

  it('no weigh-in leaves a ghost Weight card with the weight field ready to log', async () => {
    const user = userEvent.setup();
    const h = renderLiving(<ProgressPage />, {
      source: (stub) => ({
        ...stub.source,
        trend: (from, to) => {
          const d = stub.source.trend(from, to);
          return d ? { ...d, weighIns: [], trend: d.trend.map(() => Number.NaN) } : null;
        },
      }),
    });
    const weight = (await screen.findByRole('heading', { name: 'Weight' })).closest('section')!;
    expect(
      within(weight).getByRole('img', { name: 'Your weight trend will appear here' }),
    ).toBeInTheDocument();
    expect(h.result.container.querySelector('#goals .lmz-track__thumb')).toBeNull();
    await user.click(within(weight).getByRole('button', { name: 'Log your weight' }));
    expect(
      within(await screen.findByRole('dialog', { name: 'Add a measurement' })).getByRole('combobox'),
    ).toHaveValue('weight');
  });

  it('T opens the Weight information panel at its twin; closing restores focus', async () => {
    const user = userEvent.setup();
    renderLiving(<ProgressPage />);
    const card = (await screen.findByRole('heading', { name: 'Weight' })).closest('section')!;
    const plot = card.querySelector('.lmc-tl__plot') as HTMLElement;
    plot.focus();
    fireEvent.keyDown(plot, { key: 'T' });
    const panel = await screen.findByRole('dialog', { name: 'Your weight trend' });
    expect(within(panel).getByRole('region', { name: 'Weight trend table' })).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Close' }));
    expect(plot).toHaveFocus();
  });

  it('a girth row starts its own measurement, and the real quiet setting hides its value', async () => {
    const user = userEvent.setup();
    const h = renderLiving(<ProgressPage />);
    await act(() =>
      h.stub.actions.logMeasurement(FIXTURE_TODAY, { metric: 'hipCm', value: 105.7, method: 'tape' }),
    );
    await user.click(screen.getByRole('button', { name: 'Add hip measurement' }));
    const panel = await screen.findByRole('dialog', { name: 'Add a measurement' });
    expect(within(panel).getByRole('combobox')).toHaveValue('hip');
    await user.click(within(panel).getByRole('button', { name: 'Cancel' }));
    await act(async () => {
      useSettingsStore.getState().set({ quietMode: true });
    });
    await waitFor(() =>
      expect(h.result.container.querySelector('#body')?.textContent).not.toMatch(/105\.7|94\.5/),
    );
    expect(h.result.container.querySelector('#trend .lm-hero')?.getAttribute('aria-label')).not.toMatch(
      /\d|kg/,
    );
  });
});
