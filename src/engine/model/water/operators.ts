/**
 * Water-owned observables for drift and forecast comparison (C4/D5-02), provider side.
 *
 * A run's `scaleWeight` and `waterWeight` daily values are both the wake-hour samples of one path (catalogue agg 'wake'),
 * so the water-adjusted wake mass of that path is their difference (= the path's tissue mass at its wake hour). Bands of
 * any observable are built by applying its operator to every member path first and taking quantiles afterwards, never by
 * differencing P10/P90 endpoints of two separately summarised series. Allocation is fine here: none of this runs inside
 * the engine loop.
 */
import {
  WATER_ADJUSTED_WAKE_OPERATOR,
  applyOperator,
  empiricalQuantiles,
  type MeasurementOperator,
  type ModelPath,
  type OperatorId,
} from '@/lib/measurementOperators';
import type { SeriesId } from '../../types/metrics';

/** One path's wake-sampled water series as recorded in `SimulationResult.daily` (nominal run or one ensemble member). */
export interface WakeSeries {
  readonly scaleWeight?: ArrayLike<number> | null;
  readonly waterWeight?: ArrayLike<number> | null;
}

/** Series a run must record for each wake operator to be evaluable on its paths (include them in the series mask). */
export const WAKE_OPERATOR_SERIES = {
  scaleWake: ['scaleWeight'],
  waterAdjustedWake: ['scaleWeight', 'waterWeight'],
} as const satisfies Partial<Record<OperatorId, readonly SeriesId[]>>;

function wakeArray(series: WakeSeries, name: string): ArrayLike<number> | null | undefined {
  switch (name) {
    case 'scaleWeightKg':
      return series.scaleWeight;
    case 'labileWaterKg':
      return series.waterWeight;
    default:
      return null;
  }
}

/**
 * ModelPath over one run's wake samples (C4): `hourIndex` selects day ⌊hourIndex/24⌋ and the value is that day's wake
 * sample. Only wake-sampled quantities resolve (`scaleWeightKg`, `labileWaterKg`); end-of-day composition samples and any
 * other name return null, so an operator can never pair a wake sample with a midnight one. Missing or non-finite → null.
 */
export function wakeSamplePath(series: WakeSeries): ModelPath {
  return {
    value(name: string, hourIndex: number): number | null {
      const arr = wakeArray(series, name);
      if (!arr || !Number.isFinite(hourIndex) || hourIndex < 0) return null;
      const d = Math.floor(hourIndex / 24);
      if (d >= arr.length) return null;
      const v = arr[d]!;
      return Number.isFinite(v) ? v : null;
    },
  };
}

/** Per-day water-adjusted wake mass of one path (same-path scale − labile water), kg; null where a sample is missing. */
export function waterAdjustedWakeKg(series: WakeSeries, nDays: number): Array<number | null> {
  const path = wakeSamplePath(series);
  const out: Array<number | null> = [];
  for (let d = 0; d < nDays; d++) out.push(WATER_ADJUSTED_WAKE_OPERATOR.apply(path, d * 24));
  return out;
}

/**
 * Per-day quantiles of `op` over ensemble members (C4/D5-02): the operator is applied to every member path first, then
 * empirical quantiles are taken over the members with a finite value; null on a day without any. These are quantiles of
 * the drawn members (parameter sensitivity, unvalidated predictive coverage); the caller labels them (C6 BandMeta).
 */
export function wakeOperatorQuantiles(
  op: MeasurementOperator,
  members: readonly WakeSeries[],
  nDays: number,
  probs: readonly number[] = [0.1, 0.5, 0.9],
): Array<number[] | null> {
  const paths = members.map(wakeSamplePath);
  const out: Array<number[] | null> = [];
  for (let d = 0; d < nDays; d++) {
    const values = applyOperator(op, paths, d * 24).filter((v): v is number => v !== null);
    out.push(empiricalQuantiles(values, probs));
  }
  return out;
}
