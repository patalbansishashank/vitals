import { describe, expect, it } from 'vitest';
import type { SimulationResult } from '@/engine/types/result';
import { simulationSummaryMetrics } from '../simulationSummary';

const result = { initial: { tdee: 85, rmr: 71, scaleWeight: 75 }, final: { tdee: 70, rmr: 66, scaleWeight: 74.9 }, daily: { tdee: Float32Array.of(2800, 2500), rmr: Float32Array.of(1704, 1600), scaleWeight: Float32Array.of(75, 74.8) } } as Pick<SimulationResult, 'initial' | 'final' | 'daily'>;
describe('MCP simulation summary units and time basis', () => {
  it('reports daily energy rather than the hourly engine flux, retaining the starting stock', () => {
    expect(simulationSummaryMetrics(result, 'initial')).toMatchObject({ tdee: 2800, rmr: 1704, scaleWeight: 75 });
    expect(simulationSummaryMetrics(result, 'final')).toMatchObject({ tdee: 2500, rmr: 1600, scaleWeight: 74.8 });
  });
  it('withholds an unrecorded daily flow instead of relabeling its hourly rate', () => {
    const missing = { ...result, daily: {} };
    expect(simulationSummaryMetrics(missing, 'initial')).not.toHaveProperty('tdee');
    expect(simulationSummaryMetrics(missing, 'final')).not.toHaveProperty('tdee');
    expect(simulationSummaryMetrics(null, 'final')).toEqual({});
  });
});
