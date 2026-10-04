import './setupDom';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import ChartsDemoPage from '../ChartsDemoPage';
import { ChartFrame } from '../components/ChartFrame';
import { CompareView } from '../components/CompareView';
import { ConvergenceChart } from '../components/ConvergenceChart';
import { DataTable } from '../components/DataTable';
import { DayView } from '../components/DayView';
import { OverlayView } from '../components/OverlayView';
import { PreviewStrip } from '../components/PreviewStrip';
import { TdeeStack } from '../components/TdeeStack';
import { WeightDecomposition } from '../components/WeightDecomposition';
import { ChartController } from '../core/controller';
import { makeChartData, makeComparison, makeConvergence } from '../fixtures';

const data = makeChartData({ days: 84 });
const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
};

afterEach(() => cleanup());

describe('chart components mount in jsdom', () => {
  it('ChartFrame renders lanes with accessible summaries and switches views', async () => {
    render(<ChartFrame data={data} defaultLaneIds={['fat_mass', 'lean_mass', 'ketones', 'tdee', 'hunger']} />);
    await flush();
    expect(screen.getByRole('region', { name: 'Projection channels' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Fat mass, kilograms, grade A\. Falls from/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Projection channels, 5 lanes/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'overlay' }));
    await flush();
    expect(screen.getByRole('group', { name: /Overlay: change from start for 3 metrics/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'focus' }));
    await flush();
    expect(document.querySelector('[data-mode="focus"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-mode="strip"]').length).toBe(4);
  });

  it('keyboard: arrows move the crosshair, T opens the table twin, Esc leaves focus', async () => {
    const ctl = new ChartController(84);
    render(<ChartFrame data={data} controller={ctl} defaultLaneIds={['fat_mass', 'glycogen']} />);
    await flush();
    const body = screen.getByRole('group', { name: /Projection channels/ });
    act(() => body.focus());
    expect(ctl.cursor.get().t).toBe(83.5);
    fireEvent.keyDown(body, { key: 'ArrowLeft' });
    expect(ctl.cursor.get().t).toBe(82.5);
    fireEvent.keyDown(body, { key: 'ArrowLeft', shiftKey: true });
    expect(ctl.cursor.get().t).toBe(75.5);
    fireEvent.keyDown(body, { key: 'Home' });
    expect(ctl.cursor.get().t).toBe(0.5);
    fireEvent.keyDown(body, { key: 'PageDown' });
    expect(ctl.cursor.get().t).toBeGreaterThan(0.5);
    fireEvent.keyDown(body, { key: 't' });
    await flush();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Fat mass/ })).toBeInTheDocument();
    fireEvent.keyDown(body, { key: 'f' });
    await flush();
    expect(document.querySelector('[data-mode="focus"]')).not.toBeNull();
    fireEvent.keyDown(screen.getByRole('group', { name: /Projection channels/ }), { key: 'Escape' });
    await flush();
    expect(document.querySelector('[data-mode="focus"]')).toBeNull();
  });

  it('zoom keys in the toolbar change the shared window', async () => {
    const ctl = new ChartController(84);
    ctl.durationMs = 0;
    render(<ChartFrame data={data} controller={ctl} defaultLaneIds={['fat_mass']} />);
    await flush();
    fireEvent.click(screen.getByRole('radio', { name: '1 wk' }));
    expect(ctl.zoom.get().x1 - ctl.zoom.get().x0).toBe(7);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 450)); // zoom animates; resolution swaps after it
    });
    expect(ctl.view.get()).toMatchObject({ res: 'hourly', animating: false });
    const x0 = ctl.zoom.get().x0;
    expect(x0).toBe(42); // week containing the window centre
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(ctl.zoom.get().x0).toBe(x0 + 7);
  });

  it('OverlayView lists excluded metrics honestly', async () => {
    render(<OverlayView data={data} controller={new ChartController(84)} metricIds={['fat_mass', 'ketones', 'hunger']} />);
    await flush();
    expect(screen.getByText(/Ketones vary ten-fold/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { pressed: false }).map((b) => b.textContent)).toEqual(expect.arrayContaining(['Fat mass%', 'Hunger pressurepts']));
  });

  it('secondary charts mount', async () => {
    const tdee = data.series.find((s) => s.id === 'tdee')!;
    render(
      <>
        <CompareView data={makeComparison()} selected="A" />
        <DayView data={data} day={37} onDayChange={() => {}} />
        <TdeeStack series={tdee} time={data.time} phases={data.phases} />
        <WeightDecomposition composition={data.composition!} time={data.time} />
        <ConvergenceChart traces={makeConvergence()} />
        <PreviewStrip fat={data.series[0]!.daily.values} ketosis={data.states![0]!.daily} />
        <DataTable time={data.time} series={data.series.slice(0, 3)} x0={0} x1={7} res="daily" />
      </>,
    );
    await flush();
    expect(screen.getByRole('img', { name: /^1\. lose 10 kg\./ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Eat 12:30 to 19:45/ })).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /^Week 1:/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole('img', { name: /Optimiser progress/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Preview: fat mass/ })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Projection data table' })).getAllByRole('row')).toHaveLength(8);
  });

  it('the day view finds engine-named hourly metrics (bhb, muscleGlycogen, autophagyIdx)', async () => {
    const rename: Record<string, string> = { ketones: 'bhb', muscle_glycogen: 'muscleGlycogen', liver_glycogen: 'liverGlycogen', autophagy: 'autophagyIdx' };
    const engineNamed = { ...data, series: data.series.map((s) => ({ ...s, id: rename[s.id] ?? s.id })) };
    const { container } = render(<DayView data={engineNamed} day={37} onDayChange={() => {}} />);
    await flush();
    const text = container.textContent ?? '';
    expect(text).toContain('Blood ketones (BHB)');
    expect(text).toContain('Muscle glycogen');
    expect(text).toContain('Autophagy signal');
  });

  it('the demo route renders every view', async () => {
    render(<ChartsDemoPage />);
    await flush();
    expect(screen.getByRole('heading', { name: 'Charts' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How the plans compare' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'One day, hour by hour' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Why did the scale move?' })).toBeInTheDocument();
  });
});
