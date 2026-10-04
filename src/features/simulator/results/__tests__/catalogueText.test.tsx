/**
 * Display text that must come from the engine catalogue (QA release check 2026-10-01): the keto-adaptation channel is
 * whatever the engine's `ketoAdaptation` entry says it is (slow component or a labelled combined index) — label,
 * short name, description, unit and decimals — with no UI-side override. And Settings › energy (kJ) reaches every
 * energy readout of the results screen.
 */
import '@/features/charts/test/setupDom';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KJ_PER_KCAL } from '@/components';
import type { SimulationResult } from '@/engine';
import { seriesDef, type SeriesDef } from '@/engine/types/metrics';
import { metricInfo } from '@/features/evidence';
import { useSafetyStore } from '@/state/safetyStore';
import { ResultsScreen, type ResultsScreenProps } from '../ResultsScreen';
import { MetricPicker } from '../components/MetricPicker';
import { ReadoutRail } from '../components/ReadoutRail';
import { buildResultsData } from '../lib/adapt';
import { explainDrivers } from '../lib/explainContext';
import { convertUnit, leadSentences, METRIC_UNITS, shortFromLabel, toDisplayMetric, type UnitPrefs } from '../lib/metrics';
import { computeReadouts, readoutLine } from '../lib/readouts';
import { useResultsUiStore } from '../store';
import { DAYS, PROFILE, SCHEDULE, engineResult, resolved } from './fixture';
import { withSystemWrite } from '@/state/scope';

const engine = engineResult();
const result: SimulationResult = { ...engine, warnings: engine.warnings.filter((w) => w.severity !== 'danger') };
const { compiled } = resolved();
const KJ: UnitPrefs = { units: 'metric', energyUnit: 'kJ', glucoseUnit: 'mmol' };

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
};

function mount(energyUnit: 'kcal' | 'kJ', url = '/simulate/s1/results') {
  const p: ResultsScreenProps = {
    scenarioId: 's1',
    scenarioName: 'Spring cut',
    sim: {
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
    },
    inputs: { profile: PROFILE, schedule: SCHEDULE },
    horizonDays: DAYS,
    onRun: () => {},
    prefs: { units: 'metric', energyUnit, glucoseUnit: 'mmol', showFigure: true, textures: false },
    scheduleHref: () => '/simulate/s1/schedule',
  };
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/simulate/:sid/results" element={<ResultsScreen {...p} />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useResultsUiStore.setState({ byScenario: {}, bandOpen: true, breakdownOpen: false });
  withSystemWrite(() => useSafetyStore.setState({ dangerAcks: {} }));
});
afterEach(() => cleanup());

/* --------------------------------------------------------------------------------------- keto-adaptation text */

const KETO = seriesDef('ketoAdaptation') as SeriesDef & { shortLabel?: string; decimals?: number };
/** The unit the results screen should print for the entry (index scale for 0–1, else the catalogue unit). */
const ketoUnit = KETO.unit === '0–1' ? 'index' : convertUnit(KETO.id, KETO.unit, METRIC_UNITS).unit;

describe('keto-adaptation text comes from the engine catalogue', () => {
  const dm = toDisplayMetric(KETO);

  it('label, short label, description, unit and decimals follow the catalogue entry', () => {
    expect(dm.label).toBe(KETO.label);
    expect(dm.shortLabel).toBe(KETO.shortLabel ?? shortFromLabel(KETO.label));
    expect(dm.description).toBe(KETO.description);
    // no authored mechanism line overrides the catalogue's definition: the lane line is its leading sentences
    expect(dm.mechanism).toBe(leadSentences(KETO.description));
    if (KETO.description) expect(KETO.description.startsWith(dm.mechanism!)).toBe(true);
    expect(dm.engineUnit).toBe(KETO.unit);
    if (KETO.presentation !== 'deltaFromBaseline') expect(dm.unit).toBe(ketoUnit);
    if (KETO.decimals != null) expect(dm.decimals).toBe(KETO.decimals);
    else if (dm.unit === 'index') expect(dm.decimals).toBe(0);
    else if (dm.unit === '%') expect(dm.decimals).toBe(1);
  });

  it('leadSentences keeps whole sentences within the budget', () => {
    expect(leadSentences('One. Two two. Three three three.', 14)).toBe('One. Two two.');
    expect(leadSentences('A very long single sentence that exceeds the budget on its own.', 10)).toBe('A very long single sentence that exceeds the budget on its own.');
    expect(leadSentences('Rises to 0.5 mmol/L. Then falls.', 40)).toBe('Rises to 0.5 mmol/L. Then falls.');
    expect(leadSentences(undefined)).toBeUndefined();
  });

  it('the Evidence adapter (Explain drawer title, unit, definition) reads the same entry', () => {
    const info = metricInfo('ketoAdaptation');
    expect(info.label).toBe(KETO.label);
    expect(info.unit).toBe(KETO.unit);
    expect(info.description).toBe(KETO.description);
  });

  it('the metric picker row shows the catalogue label and unit', () => {
    const adapted = buildResultsData({ result, schedule: SCHEDULE, compiled });
    expect(adapted.metrics.has('ketoAdaptation')).toBe(true);
    render(
      <MetricPicker
        open
        onClose={() => {}}
        series={adapted.data.series}
        metrics={adapted.metrics}
        mode="lanes"
        laneIds={['fatMass']}
        overlayIds={[]}
        onLaneIdsChange={() => {}}
        onOverlayIdsChange={() => {}}
        onReset={() => {}}
        pinnedIds={[]}
        onTogglePin={() => {}}
        onExplain={() => {}}
      />,
    );
    const row = screen.getByRole('checkbox', { name: new RegExp(`^${KETO.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).closest('li')!;
    expect(row.querySelector('.rs-picker__name')!.textContent).toBe(KETO.label);
    expect(row.querySelector('.rs-picker__unit')!.textContent).toBe(ketoUnit + (KETO.grade === 'D' ? ' · exploratory' : ''));
    expect(within(row).getByRole('button', { name: `Explain ${KETO.label}` })).toBeInTheDocument();
  });

  it('the readout strip and the Explain drivers use the catalogue short label', () => {
    const adapted = buildResultsData({ result, schedule: SCHEDULE, compiled });
    const readouts = computeReadouts(adapted.data, ['ketoAdaptation'], adapted.metrics);
    expect(readouts[0]).toMatchObject({ label: KETO.label, shortLabel: dm.shortLabel, unit: ketoUnit, decimals: dm.decimals });
    render(<ReadoutRail readouts={readouts} pinnedIds={['ketoAdaptation']} />);
    const name = screen.getByRole('button', { name: `${KETO.label}: explain` });
    expect(name.textContent).toBe(dm.shortLabel);

    const drivers = explainDrivers({ data: adapted.data, result, compiled, prefs: METRIC_UNITS }, 'bhb', { t: null, pinned: false, res: 'daily' });
    const keto = drivers.find((d) => d.label === dm.shortLabel);
    expect(keto).toBeDefined();
    expect(keto!.unit).toBe(ketoUnit);
  });

  it('the Explain drawer shows the catalogue label, unit and definition', async () => {
    mount('kcal', '/simulate/s1/results?explain=ketoAdaptation');
    await flush();
    const dialog = await screen.findByRole('dialog', { name: KETO.label });
    expect(dialog.querySelector('.ev-xp__eng')!.textContent).toContain(`· ${ketoUnit}`);
    if (KETO.description) expect(within(dialog).getByText(KETO.description)).toBeInTheDocument();
  });

  it('the Explain drawer prints a catalogue definition when the entry has one', async () => {
    const def = seriesDef('scaleWeight');
    expect(def.description).toBeTruthy();
    mount('kcal', '/simulate/s1/results?explain=scaleWeight');
    await flush();
    const dialog = await screen.findByRole('dialog', { name: def.label });
    expect(within(dialog).getByText(def.description!)).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------------------------- energy in kJ */

describe('results readouts follow Settings › energy (kJ)', () => {
  const kcal = buildResultsData({ result, schedule: SCHEDULE, compiled });
  const kj = buildResultsData({ result, schedule: SCHEDULE, compiled }, KJ);
  const s = (a: typeof kcal, id: string) => a.data.series.find((x) => x.id === id);

  it('energy channels are kJ = kcal × 4.184, including the TDEE stack and energy availability', () => {
    for (const id of ['tdee', 'maintenance', 'rmr', 'metabolicAdaptation', 'energyBalance']) {
      const a = s(kcal, id);
      const b = s(kj, id);
      if (!a || !b) continue;
      expect(a.unit).toBe('kcal/d');
      expect(b.unit).toBe('kJ/d');
      expect(b.daily.values[DAYS - 1]).toBeCloseTo(a.daily.values[DAYS - 1]! * KJ_PER_KCAL, 0);
    }
    const tdee = s(kj, 'tdee')!;
    expect(tdee.stack!.components[0]!.daily[3]).toBeCloseTo(s(kcal, 'tdee')!.stack!.components[0]!.daily[3]! * KJ_PER_KCAL, 0);
    const ea = kj.metrics.get('energyAvailability');
    if (ea) {
      expect(ea.unit).toBe('kJ/kg FFM/d');
      expect(ea.thresholds?.map((t) => t.value)).toEqual(kcal.metrics.get('energyAvailability')!.thresholds!.map((t) => t.value * KJ_PER_KCAL));
    }
  });

  it('start → end readouts and the copied summary print kJ', () => {
    const r = computeReadouts(kj.data, ['maintenance'], kj.metrics)[0]!;
    const k = computeReadouts(kcal.data, ['maintenance'], kcal.metrics)[0]!;
    expect(r.unit).toBe('kJ/d');
    expect(r.end).toBeCloseTo(k.end * KJ_PER_KCAL, 0);
    expect(readoutLine(r)).toMatch(/kJ\/d/);
    expect(readoutLine(r)).not.toMatch(/kcal/);
  });

  it('Explain drivers print energy in kJ', () => {
    const drivers = explainDrivers({ data: kj.data, result, compiled, prefs: KJ }, 'fatMass', { t: null, pinned: false, res: 'daily' });
    const energy = drivers.filter((d) => /^energy vs maintenance/.test(d.label));
    expect(energy.length).toBeGreaterThan(0);
    for (const d of energy) expect(d.unit).toBe('kJ/d');
    const tdee = explainDrivers({ data: kj.data, result, compiled, prefs: KJ }, 'energyBalance', { t: null, pinned: false, res: 'daily' });
    expect(tdee.every((d) => d.unit !== 'kcal/d')).toBe(true);
  });

  it('the screen: strip, intake and energy lanes, and the energy breakdown say kJ', async () => {
    useResultsUiStore.setState({ breakdownOpen: true }); // phones (jsdom) start with the breakdown collapsed
    const { container } = mount('kJ');
    await flush();
    const strip = screen.getByRole('region', { name: 'Start to end' });
    expect(within(strip).getAllByText(/kJ\/d/).length).toBeGreaterThan(0);
    expect(strip.textContent).not.toMatch(/kcal/);
    const inputs = container.querySelector<HTMLElement>('[data-lane="intake"]')!;
    const energy = container.querySelector<HTMLElement>('[data-lane="energy"]')!;
    expect(within(inputs).getByText('kJ/d')).toBeInTheDocument();
    expect(within(energy).getByText('kJ/d vs maintenance')).toBeInTheDocument();
    expect(inputs.textContent).not.toMatch(/kcal/);
    expect(energy.textContent).not.toMatch(/kcal/);
    const tdeeLane = container.querySelector<HTMLElement>('[data-lane="tdee"]');
    if (tdeeLane) expect(tdeeLane.textContent).not.toMatch(/kcal/);
    expect(screen.getByText('kJ/d · daily')).toBeInTheDocument(); // "Where the energy goes" caption
  });

  it('the Explain drawer names the channel unit in kJ', async () => {
    mount('kJ', '/simulate/s1/results?explain=tdee');
    await flush();
    const dialog = await screen.findByRole('dialog', { name: seriesDef('tdee').label });
    expect(within(dialog).getAllByText(/kJ\/d/).length).toBeGreaterThan(0);
    expect(dialog.textContent).not.toMatch(/kcal/);
  });
});
