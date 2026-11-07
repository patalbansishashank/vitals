import '@/features/charts/test/setupDom';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { simulate } from '@/engine';
import type { OutputStatus } from '@/lib/bodyContracts';
import { ChartFrame } from '@/features/charts/components/ChartFrame';
import { DayView } from '@/features/charts/components/DayView';
import { laneSummary } from '@/features/charts/lib/summary';
import { buildTable, tableToCSV } from '@/features/charts/lib/table';
import { seriesReadoutRow } from '@/features/charts/components/LaneStack';
import * as png from '@/features/charts/lib/pngExport';
import * as tableDownload from '@/features/charts/components/DataTable';
import { ResultsScreen } from '../ResultsScreen';
import { ReadoutRail } from '../components/ReadoutRail';
import { LadderCurves } from '@/features/planner/components/LadderCurves';
import { LadderCard } from '@/features/planner/components/LadderCard';
import { LadderTable } from '@/features/planner/components/LadderTable';
import { fixtureLadder, fixtureRequest } from '@/features/planner/__tests__/fixtures';
import { comparisonRows, outcomeView } from '@/features/planner/ladder';
import { seriesFor } from '@/features/planner/planFacts';
import { runGoalStatus } from '@/engine/planner/domain/capabilities';
import { goalTrajectory, goalTrajectoryBands } from '@/engine/planner/domain/goalSpecs';
import { PROFILE, SCHEDULE, engineResult, resolved } from '../__tests__/fixture';
import { buildResultsData } from './adapt';
import { computeReadouts } from './readouts';

const flush = async () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const ids = ['autophagyIdx', 'ketoAdaptation', 't3'];
const adapted = () =>
  buildResultsData({ result: engineResult(), schedule: SCHEDULE, compiled: resolved().compiled });

describe('A2-025 operating word policy travels through every chart consumer', () => {
  it.each(ids)('%s retains its curve while lane, cursor, table and CSV read only its word', async (id) => {
    const a = adapted();
    const s = a.data.series.find((s) => s.id === id)!;
    expect(s.daily.values.some(Number.isFinite)).toBe(true);
    expect(s.display?.wordOnly).toBe('Exploratory');
    expect(laneSummary(s)).toBe(`${s.label}: Exploratory. Press T for the data table.`);
    expect(seriesReadoutRow(s).value(2.5, 'daily')).toMatchObject({
      value: 'Exploratory',
      unit: '',
      spoken: `${s.label}: Exploratory`,
    });
    const model = buildTable(a.data.time, [s], 0, 2, 'daily');
    expect(model.rows.every((r) => r.cells[0]!.status === 'Exploratory')).toBe(true);
    expect(tableToCSV(model).split('\n')[1]).toMatch(/,Exploratory,,$/);
    render(
      <>
        <ReadoutRail readouts={computeReadouts(a.data, [id], a.metrics)} pinnedIds={[]} />
        <ChartFrame data={{ ...a.data, intake: undefined, series: [s] }} defaultTableOpen />
      </>,
    );
    await flush();
    const lane = document.querySelector(`[data-lane="${id}"]`)!;
    expect(lane.querySelector('.lmc-gut__val')!.textContent).toBe('Exploratory');
    expect(lane.querySelector('.lmc-delta')!.textContent).toBe('');
    expect(
      screen.getByRole('img', { name: `${s.label}: Exploratory. Press T for the data table.` }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('cell').every((c) => c.textContent === 'Exploratory')).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Focus' }));
    await flush();
    expect(document.querySelector('.lmc-gut__val')!.textContent).toBe('Exploratory');
  });

  it('day view suppresses a finite autophagy number and numeric unit', async () => {
    const a = adapted();
    render(<DayView data={a.data} day={1} metricIds={['autophagyIdx']} />);
    await flush();
    expect(document.querySelector('[data-lane="autophagyIdx"] .lmc-gut__val')!.textContent).toBe(
      'Exploratory',
    );
  });

  it.each(['fallback', 'draws'] as const)(
    'actual frame PNG handler preserves words and neutral %s range semantics',
    async (source) => {
      const result = engineResult();
      const a = buildResultsData({
        result,
        ...(source === 'draws'
          ? {
              bands: {
                p10: { fatMass: new Float32Array(result.meta.nDays).fill(10) },
                p90: { fatMass: new Float32Array(result.meta.nDays).fill(30) },
                draws: 8,
                total: 8,
              },
            }
          : {}),
      });
      const out = vi.spyOn(png, 'downloadChartPng').mockResolvedValue(true);
      const csv = vi.spyOn(tableDownload, 'downloadText').mockImplementation(() => {});
      const selected = a.data.series.filter((s) => [...ids, 'fatMass'].includes(s.id));
      render(<ChartFrame data={{ ...a.data, intake: undefined, series: selected }} />);
      await flush();
      fireEvent.click(screen.getByRole('button', { name: 'Export image (PNG)' }));
      expect(out).toHaveBeenCalledOnce();
      fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
      expect(csv).toHaveBeenCalledOnce();
      expect(csv.mock.calls[0]![0]).not.toMatch(/likely/);
      expect(csv.mock.calls[0]![0].split('\n')[1]).toMatch(/Exploratory/);
      const input = out.mock.calls[0]![0];
      expect(input.disclaimer).toMatch(/ranges; personal coverage is not validated/);
      expect(input.disclaimer).not.toMatch(/likely|80\s?%/);
      expect(
        input.series.filter((s) => ids.includes(s.id)).every((s) => s.display?.wordOnly === 'Exploratory'),
      ).toBe(true);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      const fill = vi.fn();
      ctx.fillText = fill;
      vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
        tag === 'canvas'
          ? canvas
          : document.createElementNS('http://www.w3.org/1999/xhtml', tag)) as typeof document.createElement);
      png.renderChartPng(input);
      const text = fill.mock.calls.map((c) => String(c[0]));
      expect(text.filter((t) => t === 'Exploratory')).toHaveLength(3);
      expect(text.join(' ')).not.toMatch(/likely|80\s?%/);
    },
  );

  it('numeric estimates retain exact endpoint conversions, ranges and neutral cursor speech', () => {
    const a = buildResultsData(
      { result: engineResult() },
      { units: 'imperial', energyUnit: 'kJ', glucoseUnit: 'mmol' },
    );
    const s = a.data.series.find((s) => s.id === 'fatMass')!;
    expect(s.unit).toBe('lb');
    expect(s.daily.values.at(-1)).toBeCloseTo(engineResult().daily.fatMass!.at(-1)! * 2.20462262185, 4);
    expect(s.daily.band).toBeDefined();
    expect(laneSummary(s)).toMatch(/range/);
    expect(seriesReadoutRow(s).value(2.5, 'daily').spoken).not.toMatch(/likely/);
    expect(tableToCSV(buildTable(a.data.time, [s], 0, 2, 'daily'))).toMatch(/range low,Fat mass range high/);
  });
});

describe('A2-026 goal qualification is separate from engine attainment', () => {
  it.each(['scenario', 'limited', 'partial', 'modelLimit'] as OutputStatus[])(
    '%s agrees across card data, table and accessible curves',
    async (status) => {
      const v2 = fixtureLadder();
      const request = fixtureRequest();
      for (const p of [v2.rungs.hard!, v2.rungs.medium!, v2.rungs.easy!, v2.ideal!])
        p.scorecard[0]!.status = status;
      const o = v2.rungs.hard!.summary.outcomes[0]!;
      const view = outcomeView(o, request.goals[0], 'hard', 'imperial', { status });
      expect(view.qualifier).toBe(
        status === 'modelLimit' ? null : status[0]!.toUpperCase() + status.slice(1),
      );
      const text = comparisonRows(v2, request.goals, 'imperial').find((r) => r.id === 'goal-0')!.cells.hard!;
      expect(text).toContain(status === 'modelLimit' ? 'Model limit' : view.qualifier!);
      if (status === 'modelLimit') expect(text).toBe('Model limit');
      else expect(text).toContain('lb');
      render(
        <MemoryRouter>
          <LadderTable
            v2={v2}
            goals={request.goals}
            units="imperial"
            energy="kcal"
            selected="hard"
            onSelect={() => {}}
          />
          <LadderCurves v2={v2} request={request} units="imperial" energy="kcal" selected="hard" />
        </MemoryRouter>,
      );
      await flush();
      const svg = document.querySelector('.lp-curve__svg')!;
      expect(svg.getAttribute('aria-label')).toContain(
        status === 'modelLimit' ? 'Model limit' : view.qualifier!,
      );
      if (status === 'modelLimit') {
        expect(svg.querySelectorAll('.lp-curve__line')).toHaveLength(0);
        expect(svg.querySelectorAll('.lp-curve__target')).toHaveLength(0);
        expect(svg.querySelectorAll('.lp-curve__band')).toHaveLength(0);
      }
    },
  );

  it('real waist Scenario is visible in the Card, Table and Curves for that rung', async () => {
    const simulation = engineResult();
    const status = runGoalStatus(simulation, 'waist').status;
    expect(status).toBe('scenario');
    const request = fixtureRequest();
    request.goals = [{ ...request.goals[0]!, metric: 'waist', target: 90, targetKind: 'absolute' }];
    const v2 = fixtureLadder({}, { rungs: ['hard'], ideal: false });
    const plan = v2.rungs.hard!;
    plan.simulation = simulation;
    plan.scorecard = [{ ...plan.scorecard[0]!, metric: 'waist', status }];
    plan.summary.outcomes = [
      {
        ...plan.summary.outcomes[0]!,
        metric: 'waist',
        label: 'Waist',
        unit: 'cm',
        start: simulation.initial.waist!,
        p50: simulation.daily.waist!.at(-1)!,
        target: 90,
      },
    ];
    render(
      <MemoryRouter>
        <LadderCard
          kind="hard"
          plan={plan}
          v2={v2}
          request={request}
          phases={[]}
          dayToDay=""
          units="metric"
          energy="kcal"
          selected
          onSelect={() => {}}
        />
        <LadderTable
          v2={v2}
          goals={request.goals}
          units="metric"
          energy="kcal"
          selected="hard"
          onSelect={() => {}}
        />
        <LadderCurves v2={v2} request={request} units="metric" energy="kcal" selected="hard" />
      </MemoryRouter>,
    );
    await flush();
    expect(document.querySelector('.lp-curve__svg')!.getAttribute('aria-label')).toContain('Scenario');
    expect(document.querySelector('[data-row="goal-0"]')!.textContent).toContain('Scenario');
    expect(document.querySelector('.lp-lcard')!.textContent).toContain('Scenario');
  });

  it('gentle mode hides amounts and paths while estimated outcomes have no qualifier', async () => {
    const v2 = fixtureLadder();
    const request = fixtureRequest();
    expect(
      outcomeView(v2.rungs.hard!.summary.outcomes[0]!, request.goals[0], 'hard', 'metric', {
        status: 'estimated',
      }).qualifier,
    ).toBeNull();
    render(
      <MemoryRouter>
        <LadderCurves v2={v2} request={request} units="metric" energy="kcal" selected="hard" gentle />
      </MemoryRouter>,
    );
    await flush();
    const svg = document.querySelector('.lp-curve__svg')!;
    expect(svg.getAttribute('aria-label')).toMatch(/hidden in gentle mode/);
    expect(svg.querySelector('.lp-curve__line')).toBeNull();
  });
});

describe('A2-008 fresh tissue-goal curves', () => {
  it('uses actual same-day tissue binding and coherent goal bands independent of raw wake BF', async () => {
    const simulation = engineResult();
    const trajectory = goalTrajectory(simulation, {
      metric: 'bodyFatPct',
      functional: 'end',
      useTissueMass: true,
    });
    expect(trajectory.available).toBe(true);
    const binding = { metric: 'bodyFatPct' as const, functional: 'end' as const, useTissueMass: true };
    const envelope = goalTrajectoryBands([simulation, simulation], binding)!;
    expect(envelope).not.toBeNull();
    const band = {
      p10: Float32Array.from(envelope.low),
      p50: Float32Array.from(trajectory.values!),
      p90: Float32Array.from(envelope.high),
    };
    const bands = { draws: 2, series: { [trajectory.bandKey]: band } };
    const option = { simulation, bands };
    const before = seriesFor(option, 'bodyFatPct', 'metric')!;
    expect(before.baseline).toBeCloseTo(trajectory.initial!, 5);
    expect(before.trajectory).toMatchObject({
      operator: 'tissueFatFraction',
      bandKey: trajectory.bandKey,
      startDay: 0,
      available: true,
    });
    expect(before.daily.band!.lo).toEqual(before.daily.values);
    expect(before.daily.band!.hi).toEqual(before.daily.values);
    const i = simulation.meta.nDays - 1;
    expect(before.daily.values[i]).toBeCloseTo(
      (100 * simulation.daily.fatMass![i]!) / simulation.safety.tissueMassKg[i]!,
      5,
    );
    const modified = {
      ...simulation,
      daily: {
        ...simulation.daily,
        bodyFatPct: Float32Array.from(simulation.daily.bodyFatPct!, (v) => v + 5),
      },
    };
    const after = seriesFor({ simulation: modified, bands }, 'bodyFatPct', 'metric')!;
    expect(after.daily.values).toEqual(before.daily.values);
    expect(after.baseline).toBe(before.baseline);
    expect(after.daily.band).toEqual(before.daily.band);
    const v2 = fixtureLadder({}, { rungs: ['hard'], ideal: false });
    const plan = v2.rungs.hard!;
    plan.simulation = simulation;
    plan.bands = bands;
    const request = fixtureRequest();
    request.goals = [
      { ...request.goals[0]!, metric: 'bodyFatPct', target: trajectory.initial! - 2, targetKind: 'absolute' },
    ];
    plan.summary.outcomes = [
      {
        ...plan.summary.outcomes[0]!,
        metric: 'bodyFatPct',
        unit: '%',
        start: trajectory.initial!,
        target: trajectory.initial! - 2,
        p50: trajectory.functionalAt(trajectory.endDay)!,
      },
    ];
    const ui = render(
      <MemoryRouter>
        <LadderCurves v2={v2} request={request} units="metric" energy="kcal" selected="hard" />
      </MemoryRouter>,
    );
    await flush();
    const panel = document.querySelector('.lp-curve')!;
    expect(panel.textContent).toMatch(/body fat · tissue/);
    const line = panel.querySelector('.lp-curve__line')!.getAttribute('d');
    const range = panel.querySelector('.lp-curve__band')!.getAttribute('d');
    const target = panel.querySelector('.lp-curve__target')!.getAttribute('y1');
    plan.simulation = modified;
    ui.rerender(
      <MemoryRouter>
        <LadderCurves v2={{ ...v2 }} request={request} units="metric" energy="kcal" selected="hard" />
      </MemoryRouter>,
    );
    await flush();
    expect(panel.querySelector('.lp-curve__line')!.getAttribute('d')).toBe(line);
    expect(panel.querySelector('.lp-curve__band')!.getAttribute('d')).toBe(range);
    expect(panel.querySelector('.lp-curve__target')!.getAttribute('y1')).toBe(target);
    const rawBefore = buildResultsData({ result: simulation }).data.series.find(
      (s) => s.id === 'bodyFatPct',
    )!;
    const rawAfter = buildResultsData({ result: modified }).data.series.find((s) => s.id === 'bodyFatPct')!;
    expect(rawAfter.daily.values[i]! - rawBefore.daily.values[i]!).toBeCloseTo(5, 4);
  });
});

it('A2-027 production results strip speaks and displays neutral ranges on an ordinary nonfasting run', async () => {
  const schedule = { ...SCHEDULE, days: SCHEDULE.days.map(() => ({ program: 0 })) };
  const result = simulate(PROFILE, schedule, { record: 'full' });
  render(
    <MemoryRouter>
      <ResultsScreen
        scenarioId="reaudit-range"
        scenarioName="Cut"
        sim={{
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
          resultHash: 'r',
          runId: 1,
        }}
        inputs={{ profile: PROFILE, schedule }}
        horizonDays={schedule.horizonDays}
        prefs={{
          units: 'metric',
          energyUnit: 'kcal',
          glucoseUnit: 'mmol',
          showFigure: false,
          textures: false,
        }}
        scheduleHref={() => '/schedule'}
      />
    </MemoryRouter>,
  );
  await flush();
  const strip = screen.getByRole('region', { name: 'Start to end' });
  expect(strip.textContent).toMatch(/range /);
  expect(strip.textContent).not.toMatch(/likely|80\s?%/);
  expect(
    [...strip.querySelectorAll('[aria-label]')].map((n) => n.getAttribute('aria-label')).join(' '),
  ).not.toMatch(/likely/);
});
