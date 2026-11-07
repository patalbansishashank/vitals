/**
 * C6 status propagation through the results adapter and readouts (D2-01/D2-02/D6-02/D7-02 surfaces): numbers and
 * statuses travel separately; a forbidding status hides the values from its day on and the readout shows the word, never
 * a zero, a NaN or the last value carried forward; an exploratory research index has no range.
 */
import '@/features/charts/test/setupDom';
import { describe, expect, it } from 'vitest';
import type { SimulationResult } from '@/engine';
import { buildResultsData, seriesStatus, statusHidesValues } from './adapt';
import { computeReadouts, readoutLine } from './readouts';
import { METRIC_UNITS, displayCatalogue, toDisplayMetric } from './metrics';
import { seriesDef } from '@/engine/types/metrics';
import { SCHEDULE, engineResult, resolved } from '../__tests__/fixture';

const { compiled } = resolved();

function withStatus(result: SimulationResult, outputStatus: NonNullable<SimulationResult['meta']['outputStatus']>): SimulationResult {
  return { ...result, meta: { ...result.meta, outputStatus } };
}

describe('C6 statuses in the results adapter', () => {
  it('marks research indices Exploratory: no band, no range, the status word alone (D2-02)', () => {
    const result = engineResult();
    const n = result.meta.nDays;
    const p = new Float32Array(n).fill(1);
    const adapted = buildResultsData({ result, bands: { p10: { autophagyIdx: p, fatMass: p }, p90: { autophagyIdx: p, fatMass: p }, draws: 8, total: 8 }, schedule: SCHEDULE, compiled });
    expect(adapted.metrics.get('autophagyIdx')?.exploratory).toBe(true);
    expect(adapted.metrics.get('autophagyIdx')?.status).toBe('exploratory');
    expect(adapted.bandSource.get('autophagyIdx')).toBe('none');
    const [r] = computeReadouts(adapted.data, ['autophagyIdx'], adapted.metrics);
    expect(r!.status).toBe('exploratory');
    expect(r!.range).toBeUndefined();
    expect(r!.statusText).toBe('Exploratory');
    expect(Number.isNaN(r!.end)).toBe(true);
    expect(readoutLine(r!)).toBe(`${r!.label}: Exploratory`);
  });

  it('an out-of-domain lab keeps its measured start and shows the status for the future, never the last value', () => {
    // an older producer stamped fromDay 1; the zero-based daily[0] is already a response after day 1 (A1-052)
    const base = withStatus(engineResult(), { ldl: { status: 'outOfDomain', reasonCode: 'measuredAnchorOutOfDomain', fromDay: 1 } });
    // D7-02: the accepted measurement the run anchored at t = 0 (LDL 310 mg/dL ≈ 8.02 mmol/L)
    const result = { ...base, meta: { ...base.meta, observedAnchors: [{ series: 'ldl' as const, value: 8.02, unit: 'mmol/L', outOfDomain: true }] } };
    const adapted = buildResultsData({ result, schedule: SCHEDULE, compiled });
    // no modelled LDL sample is drawn, day 0 included; the series stays as a status with its measured start
    expect(adapted.data.series.some((s) => s.id === 'ldl')).toBe(false);
    expect(adapted.metrics.get('ldl')?.observed).toEqual({ value: 8.02, unit: 'mmol/L' });
    const [end] = computeReadouts(adapted.data, ['ldl'], adapted.metrics);
    expect(end!.statusText).toBe('Unsupported');
    expect(Number.isNaN(end!.end)).toBe(true);
    // the measured start stays exactly as measured, in its absolute unit; the forecast reads Unsupported
    expect(end!.measuredStart).toBe(8.02);
    expect(readoutLine(end!)).toBe(`${end!.label}: 8.02 mmol/L at start · Unsupported`);
    // with mg/dL display the same measurement converts for display only, with the series' own factor
    const mg = buildResultsData({ result, schedule: SCHEDULE, compiled }, { ...METRIC_UNITS, glucoseUnit: 'mgdl' });
    const m = mg.metrics.get('ldl')!;
    expect(m.observed?.value).toBeCloseTo(8.02 * m.factor, 6);
    expect(m.observed?.unit).toBe(m.unit.replace(/ vs start$/, ''));
    // day 0 (the first end-of-day response) reads Unsupported too, with the exact measured start (A1-052)
    const [day0] = computeReadouts(adapted.data, ['ldl'], adapted.metrics, 0);
    expect(day0!.statusText).toBe('Unsupported');
    expect(readoutLine(day0!)).toBe(`${day0!.label}: 8.02 mmol/L at start · Unsupported`);
    // without an anchor a change-from-start series has no absolute start to show: the status alone
    const bare = buildResultsData({ result: base, schedule: SCHEDULE, compiled });
    const [b] = computeReadouts(bare.data, ['ldl'], bare.metrics);
    expect(readoutLine(b!)).toBe(`${b!.label}: Unsupported`);
  });

  it('a status hiding the whole run leaves the chart and stays only as a status readout (no zero, no NaN shown)', () => {
    const result = withStatus(engineResult(), { tdee: { status: 'modelLimit', reasonCode: 'modelLimit' } });
    const adapted = buildResultsData({ result, schedule: SCHEDULE, compiled });
    expect(adapted.data.series.some((s) => s.id === 'tdee')).toBe(false);
    expect(adapted.metrics.get('tdee')?.status).toBe('modelLimit');
    const [r] = computeReadouts(adapted.data, ['tdee'], adapted.metrics);
    expect(r!.statusText).toBe('Model limit');
    expect(r!.measuredStart).toBeUndefined();
    expect(readoutLine(r!)).toBe(`${r!.label}: Model limit`);
  });

  it('interpretable statuses keep their numbers', () => {
    expect(statusHidesValues('scenario')).toBe(false);
    expect(statusHidesValues('estimated')).toBe(false);
    expect(statusHidesValues('unavailable')).toBe(true);
    expect(statusHidesValues(undefined)).toBe(false);
    expect(seriesStatus(engineResult(), { id: 'fatMass', exploratory: false })).toEqual({});
  });
});

describe('display catalogue labels and goal eligibility (C4/C6)', () => {
  it('never calls the non-fat scale mass a DXA lean mass', () => {
    const m = toDisplayMetric(seriesDef('leanMass'));
    expect(m.label).toBe('Non-fat scale mass');
    expect(m.shortLabel).not.toMatch(/DXA/);
  });

  it('reads goal eligibility from the capability registry, not the goal shape', () => {
    const cat = new Map(displayCatalogue().map((m) => [m.id, m]));
    expect(cat.get('autophagyIdx')!.goalEligible).toBe(false);
    expect(cat.get('adherence')!.goalEligible).toBe(false);
    expect(cat.get('fatMass')!.goalEligible).toBe(true);
  });
});
