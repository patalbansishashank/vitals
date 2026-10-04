import '@/features/charts/test/setupDom';
import { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimulationResult, SimWarning } from '@/engine';
import { useSafetyStore } from '@/state/safetyStore';
import { ResultsScreen, type ResultsScreenProps, type SimulationLike } from '../ResultsScreen';
import { MetricPicker, rowCaveat } from '../components/MetricPicker';
import { buildResultsData } from '../lib/adapt';
import { CORE_METRIC_IDS } from '../lib/metrics';
import { useResultsUiStore } from '../store';
import { DAYS, PROFILE, SCHEDULE, engineResult, resolved } from './fixture';
import { withSystemWrite } from '@/state/scope';

const engine = engineResult();
/** The fixture scenario trips danger rules (a fast inside a deficit); most tests read the acknowledged view. */
const result: SimulationResult = { ...engine, warnings: engine.warnings.filter((w) => w.severity !== 'danger') };

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
};

function sim(over: Partial<SimulationLike> = {}): SimulationLike {
  return {
    status: 'done',
    phase: null,
    progress: 1,
    result,
    bands: null,
    stale: false,
    hasResult: true,
    error: null,
    startedAt: 0,
    finishedAt: 1,
    resultHash: 'h1',
    runId: 1,
    ...over,
  };
}

let lastSearch = '';
function Loc() {
  const { search } = useLocation();
  useEffect(() => {
    lastSearch = search;
  }, [search]);
  return null;
}

function mount(props: Partial<ResultsScreenProps> = {}, url = '/simulate/s1/results') {
  const onRun = vi.fn();
  const p: ResultsScreenProps = {
    scenarioId: 's1',
    scenarioName: 'Spring cut',
    sim: sim(),
    inputs: { profile: PROFILE, schedule: SCHEDULE },
    horizonDays: DAYS,
    onRun,
    prefs: { units: 'metric', energyUnit: 'kcal', glucoseUnit: 'mmol', showFigure: true, textures: false },
    scheduleHref: (o) => `/simulate/s1/schedule${o?.startDay != null ? `?days=${o.startDay}-${o.endDay}&fix=${o.fix}` : ''}`,
    ...props,
  };
  const view = render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/simulate/:sid/results"
          element={
            <>
              <ResultsScreen {...p} />
              <Loc />
            </>
          }
        />
        <Route path="*" element={<Loc />} />
      </Routes>
    </MemoryRouter>,
  );
  return { ...view, onRun };
}

beforeEach(() => {
  useResultsUiStore.setState({ byScenario: {}, bandOpen: true, breakdownOpen: false });
  withSystemWrite(() => useSafetyStore.setState({ dangerAcks: {} }));
});
afterEach(() => cleanup());

describe('ResultsScreen with a real engine result', () => {
  it('renders the strip, the channel stack with the core lanes, figure, warnings and breakdown', async () => {
    mount();
    await flush();
    const strip = screen.getByRole('region', { name: 'Start to end' });
    for (const name of ['fat mass', 'lean tissue', 'scale weight', 'waist', 'maintenance']) expect(within(strip).getByRole('button', { name: new RegExp(`^${name}`, 'i') })).toBeInTheDocument();
    expect(within(strip).getAllByText(/^likely /).length).toBeGreaterThanOrEqual(4);
    expect(screen.getByRole('region', { name: /Spring cut: projection channels/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Fat mass, kilograms, grade A\./ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Hunger pressure/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: new RegExp(`${CORE_METRIC_IDS.length} lanes`) })).toBeInTheDocument();
    expect(screen.getAllByText('Figure over time').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Warnings' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Why did the scale move?' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Where the energy goes' })).toBeInTheDocument();
    expect(screen.getAllByText(/Projections for an average person with your inputs/).length).toBeGreaterThan(0);
  });

  it('shows the never-run stage with the Run key', async () => {
    const { onRun } = mount({ sim: sim({ status: 'idle', result: null, hasResult: false, resultHash: null }) });
    await flush();
    expect(screen.getByRole('heading', { name: 'Run your first projection.' })).toBeInTheDocument();
    expect(screen.getByText(/Vitals will simulate 21 days across \d+ channels/)).toBeInTheDocument();
    const strip = screen.getByRole('region', { name: 'Start to end' });
    expect(within(strip).getAllByText('run to see the projection').length).toBe(5);
    fireEvent.click(screen.getByRole('button', { name: /run/i, pressed: undefined, description: undefined }).closest('button')!);
    expect(onRun).toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: /projection channels/ })).toBeNull();
  });

  it('shows the first run as a stage with progress, and a running re-run over the previous render', async () => {
    mount({ sim: sim({ status: 'running', phase: 'nominal', result: null, hasResult: false, resultHash: null, startedAt: Date.now() }) });
    await flush();
    expect(screen.getByRole('heading', { name: /Running 21 days/ })).toBeInTheDocument();
    cleanup();
    mount({ sim: sim({ status: 'running', phase: 'nominal', stale: true, startedAt: Date.now() }) });
    await flush();
    expect(screen.getByRole('region', { name: /projection channels/ })).toBeInTheDocument();
    expect(screen.getAllByText(/^Running · \d/).length).toBeGreaterThan(0);
  });

  it('marks a stale projection and offers Run again', async () => {
    const { onRun } = mount({ sim: sim({ stale: true }) });
    await flush();
    expect(screen.getByText('Schedule changed since this run.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Run again' }));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('reports a worker error humanely and keeps the last render dimmed', async () => {
    mount({ sim: sim({ status: 'error', error: 'Glycogen went out of range' }) });
    await flush();
    expect(screen.getByText('The simulation stopped.')).toBeInTheDocument();
    expect(screen.getByText(/This is our bug, not your plan/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy details' })).toBeInTheDocument();
  });

  it('honours ?view=focus&m=<metricId> (loose ids) and writes view changes back', async () => {
    mount({}, '/simulate/s1/results?view=focus&m=blood_glucose_x&x=1');
    await flush();
    expect(document.querySelector('[data-mode="focus"]')).not.toBeNull(); // unknown id → first lane
    cleanup();
    mount({}, '/simulate/s1/results?view=focus&m=ldl');
    await flush();
    const focus = document.querySelector('[data-mode="focus"]');
    expect(focus).not.toBeNull();
    expect(within(focus as HTMLElement).getAllByText(/LDL cholesterol/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('radio', { name: 'lanes' }));
    await flush();
    expect(lastSearch).toBe('');
  });

  it('opens Explain from a strip readout and records it in the URL', async () => {
    mount();
    await flush();
    const strip = screen.getByRole('region', { name: 'Start to end' });
    fireEvent.click(within(strip).getByRole('button', { name: /^Fat mass: explain/ }));
    await flush();
    expect(lastSearch).toContain('explain=fatMass');
    expect(screen.getAllByRole('heading', { name: 'Fat mass' }).length).toBeGreaterThan(0);
  });

  it('shows the danger acknowledgement before the projection, then the persistent strip', async () => {
    const danger: SimWarning = { id: 'W-E02', severity: 'danger', startDay: 3, endDay: 20, peakValue: 600, message: 'Under 800 kcal/day is a very-low-energy diet: guidelines say medical supervision only.', src: '17' };
    const r: SimulationResult = { ...result, warnings: [...result.warnings.filter((w) => w.severity !== 'danger'), danger] };
    mount({ sim: sim({ result: r }) });
    await flush();
    expect(screen.getByRole('heading', { name: /Before you see this projection/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /projection channels/ })).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Start to end' })).getAllByText('shown after the acknowledgement below').length).toBe(5);
    fireEvent.click(screen.getByRole('checkbox', { name: /I understand/ }));
    fireEvent.click(screen.getByRole('button', { name: /Show the projection/ }));
    await flush();
    expect(screen.getByRole('region', { name: /Simulation — not a recommendation/ })).toBeInTheDocument();
    expect(screen.getAllByText('Simulation — not a recommendation').length).toBeGreaterThan(0);
    expect(screen.getByText(/Stop and get help/)).toBeInTheDocument();
  });

  it('lists warnings with Show and a remedy link to the offending days', async () => {
    const caution: SimWarning = { id: 'W-E03', severity: 'caution', startDay: 3, endDay: 9, peakValue: 31, message: 'Your deficit is 31% of maintenance. Above about 25% the model shows more muscle loss.', src: '17' };
    mount({ sim: sim({ result: { ...result, warnings: [caution] } }) });
    await flush();
    expect(screen.getByText('Your deficit reaches 31 % of maintenance.')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Adjust energy on days 4–10' });
    expect(link.getAttribute('href')).toBe('/simulate/s1/schedule?days=3-9&fix=W-E03');
    expect(screen.getByRole('button', { name: '1 caution' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    await flush();
    expect(screen.getByText(/^pinned · /)).toBeInTheDocument();
  });

  it('says so when there are no cautions', async () => {
    mount({ sim: sim({ result: { ...result, warnings: [] } }) });
    await flush();
    expect(screen.getByText('No cautions for this schedule.')).toBeInTheDocument();
  });

  it('persists the lane selection per scenario and handles an empty selection', async () => {
    useResultsUiStore.getState().setLanes('s1', []);
    mount();
    await flush();
    expect(screen.getByText('No channels selected.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default set' }));
    await flush();
    expect(useResultsUiStore.getState().byScenario.s1?.laneIds).toBeNull();
    expect(screen.queryByText('No channels selected.')).toBeNull();
  });
});

describe('MetricPicker', () => {
  const { compiled } = resolved();
  const adapted = buildResultsData({ result, schedule: SCHEDULE, compiled });
  const base = {
    open: true,
    onClose: () => {},
    series: adapted.data.series,
    metrics: adapted.metrics,
    overlayIds: ['fatMass'],
    onOverlayIdsChange: () => {},
    onReset: () => {},
    pinnedIds: [] as string[],
    onTogglePin: () => {},
    onExplain: () => {},
  };

  it('groups by category with counts, grade badges and mandatory caveats', () => {
    render(<MetricPicker {...base} mode="lanes" laneIds={[...CORE_METRIC_IDS]} onLaneIdsChange={() => {}} />);
    expect(screen.getByRole('region', { name: 'body composition' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'cellular signalling' })).toBeInTheDocument();
    expect(screen.getByText(/Autophagy cannot be measured in your organs/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Fat mass/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Autophagy signal/ })).not.toBeChecked();
    expect(screen.getAllByText(/mmol\/L vs start · relative to your baseline/).length).toBeGreaterThan(3);
    expect(screen.getByText(/Lanes: 8 · Overlay: 1 \/ 6/)).toBeInTheDocument();
    expect(rowCaveat(adapted.metrics.get('autophagyIdx'))).toMatch(/Autophagy cannot be measured/);
    expect(rowCaveat(adapted.metrics.get('ldl'))).toBeUndefined(); // grade A marker: caveat shown with the chart, not per row
  });

  it('adds a lane at the end of its category and filters by search and grade', () => {
    const onLaneIdsChange = vi.fn();
    render(<MetricPicker {...base} mode="lanes" laneIds={['fatMass', 'bhb']} onLaneIdsChange={onLaneIdsChange} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Waist/ }));
    expect(onLaneIdsChange).toHaveBeenCalledWith(['fatMass', 'waist', 'bhb']);
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: 'ketones' } });
    expect(screen.queryByRole('checkbox', { name: /Waist/ })).toBeNull();
    expect(screen.getByRole('checkbox', { name: /Blood ketones/ })).toBeInTheDocument();
  });

  it('refuses a 7th overlay metric with the reason', () => {
    const six = ['fatMass', 'scaleWeight', 'glycogenTotal', 'tdee', 'hunger', 'rmr'];
    render(<MetricPicker {...base} mode="overlay" laneIds={six} overlayIds={six} onLaneIdsChange={() => {}} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /^Waist/ }));
    expect(screen.getByRole('status')).toHaveTextContent('Overlay shows up to 6 metrics. Switch to Lanes to see more.');
  });
});

describe('ResultsScreen with the unfiltered engine result', () => {
  it('gates a projection whose own warnings include a danger rule', async () => {
    const dangers = engine.warnings.filter((w) => w.severity === 'danger');
    mount({ sim: sim({ result: engine, resultHash: 'real' }) });
    await flush();
    if (dangers.length) {
      expect(screen.getByRole('heading', { name: /Before you see this projection/ })).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: /projection channels/ })).toBeNull();
    } else {
      expect(screen.getByRole('region', { name: /projection channels/ })).toBeInTheDocument();
    }
  });

  it('shows the ensemble refining the ranges while draws stream in', async () => {
    const p10 = { fatMass: result.daily.fatMass!.map((v) => v - 0.3) };
    const p90 = { fatMass: result.daily.fatMass!.map((v) => v + 0.3) };
    mount({ sim: sim({ status: 'running', phase: 'ensemble', bands: { p10, p90, drawsDone: 12, drawsTotal: 32 } }) });
    await flush();
    expect(screen.getByText('Refining ranges · 12/32')).toBeInTheDocument();
    expect(screen.getByText(/ranges from 12 of 32 draws/)).toBeInTheDocument();
  });
});
