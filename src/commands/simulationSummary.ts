/** Daily-unit readout for MCP: hourly energy fluxes are not kcal/day until aggregated over a day. */
import type { SimulationResult } from '@/engine/types/result';
import { METRIC_IDS, SERIES, SERIES_INDEX } from '@/engine/types/metrics';

export function simulationSummaryMetrics(result: Pick<SimulationResult, 'initial' | 'final' | 'daily'> | null, point: 'initial' | 'final'): Record<string, number> {
  if (!result) return {};
  const out: Record<string, number> = {};
  for (const id of METRIC_IDS) {
    const def = SERIES[SERIES_INDEX[id]]!;
    const daily = result.daily[id];
    const value = point === 'initial'
      ? def.agg === 'sum' ? daily?.[0] : result.initial[id]
      : daily?.length ? daily[daily.length - 1] : def.agg === 'end' ? result.final[id] : undefined;
    if (value !== undefined && Number.isFinite(value)) out[id] = Math.round(value * 100) / 100;
  }
  return out;
}
