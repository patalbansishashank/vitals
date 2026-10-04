import '@/features/charts/test/setupDom';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartController } from '@/features/charts';
import { FigureOverTime } from '../components/FigureOverTime';
import { buildResultsData } from '../lib/adapt';
import { bodyTimeline } from '../lib/bodyState';
import { DAYS, SCHEDULE, engineResult, resolved } from './fixture';

vi.setConfig({ testTimeout: 30_000 });

function setup(props: { showFigure?: boolean } = {}) {
  const result = engineResult();
  const { rp, compiled } = resolved();
  const adapted = buildResultsData({ result, bands: null, schedule: SCHEDULE, compiled }, { units: 'metric', energyUnit: 'kcal', glucoseUnit: 'mmol' });
  const controller = new ChartController(adapted.data.time.days);
  const timeline = bodyTimeline(result, rp.body);
  const ui = (
    <FigureOverTime timeline={timeline} data={adapted.data} controller={controller} showFigure={props.showFigure ?? true} units="metric" />
  );
  return { controller, ...render(ui) };
}

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-motion');
});

describe('<FigureOverTime>', () => {
  it('draws the figure with the start as a ghost, and a figure | visceral switch', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Figure over time' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'figure' })).toBeChecked();
    expect(screen.queryByTestId('rs-visceral')).toBeNull();
    expect(document.querySelector('.rs-figure__stage .lm-fig3d')).not.toBeNull();
  });

  it('the visceral view follows the crosshair day', async () => {
    const { controller } = setup();
    await userEvent.click(screen.getByRole('radio', { name: 'visceral' }));
    expect(screen.getByTestId('rs-visceral')).toBeInTheDocument();
    expect(document.querySelector('.rs-figure__stage')).toBeNull();
    act(() => controller.setCursor(0.5, 'program', { force: true, pin: true }));
    const first = screen.getByTestId('rs-visceral').innerHTML;
    act(() => controller.setCursor(DAYS - 0.5, 'program', { force: true, pin: true }));
    const last = screen.getByTestId('rs-visceral').innerHTML;
    expect(first).not.toEqual(last);
  });

  it('reduced motion: Play jumps start to end and speaks the day once', async () => {
    document.documentElement.setAttribute('data-motion', 'reduce');
    const { controller } = setup();
    await userEvent.click(screen.getByRole('radio', { name: 'visceral' }));
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    // jumped straight to the last day, no running animation (the key never flips to "Stop")
    expect(Math.floor(controller.cursor.get().t ?? -1)).toBe(DAYS - 1);
    expect(screen.getByRole('button', { name: 'Play' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('rs-figure-live').textContent).toMatch(/visceral fat about \d+ square centimetres/);
  });

  it('with the figure hidden in Settings it shows the numbers only', () => {
    setup({ showFigure: false });
    expect(screen.queryByRole('radio', { name: 'visceral' })).toBeNull();
    expect(document.querySelector('.lm-fig3d')).toBeNull();
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });
});
