/**
 * W3 (C6 inline grammar) on the results screen: research indices read as a status word only (D2-02, D2-06, D2-07, D2-08,
 * D3-04, D8-05, D8-06, D8-08, D8-09), a scenario or limited estimate keeps its number and adds its word, and the Explain
 * sheet carries the reason, the range basis (model variations, coverage not validated: D8-02), a model-limit stop (D1-08),
 * the time resolution and the model version — never the operating screen.
 */
import '@/features/charts/test/setupDom';
import { describe, expect, it } from 'vitest';
import type { SimulationResult } from '@/engine';
import { bandMetaFor } from '@/lib/bodyContracts';
import { seriesDef } from '@/engine/types/metrics';
import { SCHEDULE, engineResult, resolved } from '../__tests__/fixture';
import { buildResultsData, statusWordsOf } from './adapt';
import { explainDetails, explainStatus, reasonText } from './explainContext';
import { WORD_ONLY, toDisplayMetric } from './metrics';
import { computeReadouts, qualifierWord, readoutLine } from './readouts';

const { compiled } = resolved();

const withMeta = (r: SimulationResult, meta: Partial<SimulationResult['meta']>): SimulationResult => ({ ...r, meta: { ...r.meta, ...meta } });

describe('word-only research indices (C6)', () => {
  it('a legacy signalling index reads "Exploratory" with no number, no range and no percent', () => {
    const adapted = buildResultsData({ result: engineResult(), schedule: SCHEDULE, compiled });
    const [r] = computeReadouts(adapted.data, ['autophagyIdx'], adapted.metrics);
    expect(r!.statusText).toBe('Exploratory');
    expect(Number.isNaN(r!.end)).toBe(true);
    expect(r!.range).toBeUndefined();
    expect(Number.isNaN(r!.pctChange)).toBe(true);
    expect(readoutLine(r!)).toBe(`${r!.label}: Exploratory`);
  });

  it('declares the word of every research index that must not print a number', () => {
    expect(WORD_ONLY.get('hipBmdChange')).toBe('unavailable');
    expect(WORD_ONLY.get('enduranceCapacity')).toBe('scenario');
    expect(WORD_ONLY.get('ketoAdaptation')).toBe('exploratory');
    expect(WORD_ONLY.get('menstrualRisk')).toBe('exploratory');
    expect(WORD_ONLY.get('adherence')).toBe('exploratory');
    expect(WORD_ONLY.has('fatMass')).toBe(false);
    // D2-06: never "adherence" as a chance of keeping to the plan
    expect(toDisplayMetric(seriesDef('adherence')).label).toBe('Adherence index');
  });

  it('the engine’s own forbidding status still wins over the word-only policy', () => {
    const result = withMeta(engineResult(), { outputStatus: { autophagyIdx: { status: 'modelLimit', reasonCode: 'tissueFloorModelLimit' } } });
    const adapted = buildResultsData({ result, schedule: SCHEDULE, compiled });
    const [r] = computeReadouts(adapted.data, ['autophagyIdx'], adapted.metrics);
    expect(r!.statusText).toBe('Model limit');
  });
});

describe('qualifying statuses keep the number and add the word', () => {
  it('a scenario estimate reads its range and "scenario"', () => {
    const result = withMeta(engineResult(), { outputStatus: { fatMass: { status: 'scenario', reasonCode: 'lowProteinSurplusPartition', uncertaintyKind: 'scenario' } } });
    const n = result.meta.nDays;
    const p10 = new Float32Array(n).fill(10);
    const p90 = new Float32Array(n).fill(30);
    const adapted = buildResultsData({ result, bands: { p10: { fatMass: p10 }, p90: { fatMass: p90 }, draws: 8, total: 8 }, schedule: SCHEDULE, compiled });
    const [r] = computeReadouts(adapted.data, ['fatMass'], adapted.metrics);
    expect(r!.statusText).toBeNull();
    expect(Number.isFinite(r!.end)).toBe(true);
    expect(qualifierWord(r!)).toBe('Scenario');
    expect(readoutLine(r!)).toMatch(/, scenario$/);
    expect(readoutLine(r!)).not.toMatch(/likely/);
  });

  it('a plain estimate adds no word', () => {
    const adapted = buildResultsData({ result: engineResult(), schedule: SCHEDULE, compiled });
    const [r] = computeReadouts(adapted.data, ['fatMass'], adapted.metrics);
    expect(qualifierWord(r!)).toBeNull();
  });
});

describe('the Explain sheet carries reasons and details (C6 info sheet)', () => {
  it('gives plain reasons for engine reason codes, prefixed codes included', () => {
    expect(reasonText('lowProteinSurplusPartition')).toMatch(/broad scenario/);
    expect(reasonText('intakeTiming:glp1Medication')).toMatch(/daily totals still apply/);
    expect(reasonText('eaExposure.incomplete')).toMatch(/not a diagnosis/);
    expect(reasonText('noSuchCode')).toBeUndefined();
  });

  it('says what a range is made of: model variations with coverage not validated, or a fixed display range', () => {
    const result = engineResult();
    const draws = explainDetails(result, { source: 'draws', meta: bandMetaFor('draws', 16) });
    expect(draws.find((d) => d.label === 'Range from')?.value).toBe('16 model variations · coverage not validated');
    const fallback = explainStatus(result, 'fatMass', { source: 'fallback' });
    expect(fallback?.uncertaintyKind).toBe('heuristic');
    expect(fallback?.details?.find((d) => d.label === 'Range from')?.value).toMatch(/fixed display range/);
    expect(draws.find((d) => d.label === 'Model version')?.value).toBe(result.meta.engineVersion);
  });

  it('a model-limit stop says until which day the run is valid (D1-08)', () => {
    const result = withMeta(engineResult(), { validity: { status: 'modelLimit', validThroughHour: 24 * 9 + 5, reasonCode: 'tissueFloorModelLimit', version: 1 } });
    const row = explainDetails(result).find((d) => d.label === 'Model limit');
    expect(row?.value).toMatch(/^valid through day 10/);
  });

  it('a word-only index explains why its number is not shown', () => {
    const st = explainStatus(engineResult(), 'hipBmdChange');
    expect(st?.status).toBe('unavailable');
    expect(st?.reason).toMatch(/no personal bone density forecast/);
  });

  it('the table view gets the status words of hidden and word-only series', () => {
    const result = withMeta(engineResult(), { outputStatus: { tdee: { status: 'modelLimit', reasonCode: 'modelLimit' } } });
    const adapted = buildResultsData({ result, schedule: SCHEDULE, compiled });
    const words = statusWordsOf(adapted.metrics);
    expect(words.tdee).toBe('Model limit');
    expect(words.autophagyIdx).toBe('Exploratory');
    expect(words.fatMass).toBeUndefined();
  });
});
