/**
 * Series recorder (docs/MODEL_SPEC.md §6.2): zero-allocation per step. Modules write instantaneous values into a
 * frame (Float64Array indexed by SERIES_INDEX); the recorder aggregates hourly values into daily values according to
 * the catalogue (`agg`) and stores hourly arrays when record = 'full'.
 */
import { N_SERIES, SERIES, SERIES_INDEX, type DailyAgg, type SeriesId } from '../types/metrics';
import type { RecordMode } from '../types/result';

const AGG_CODE = { end: 0, wake: 1, mean: 2, sum: 3, min: 4, max: 5 } as const;

export class Recorder {
  readonly hourFrame = new Float64Array(N_SERIES);
  readonly dayFrame = new Float64Array(N_SERIES);
  private readonly hourlyRes = new Uint8Array(N_SERIES);
  private readonly aggCode = new Uint8Array(N_SERIES);
  private readonly enabled: Uint8Array;
  /** Enabled hourly-resolution series, split by aggregation (precomputed index lists: no branching per hour). */
  private readonly idxHourly: Int32Array;
  private readonly idxSumMean: Int32Array;
  private readonly idxMin: Int32Array;
  private readonly idxMax: Int32Array;
  private readonly idxWake: Int32Array;
  private readonly idxDaily: Int32Array;
  private readonly acc = new Float64Array(N_SERIES);
  private hoursInDay = 0;
  private readonly wakeVal = new Float64Array(N_SERIES);
  private readonly lastVal = new Float64Array(N_SERIES);
  /** Flat hourly store for record 'full': one Float32Array per enabled hourly series (null otherwise). */
  readonly daily: (Float32Array | null)[];
  readonly hourly: (Float32Array | null)[];
  readonly initial = new Float64Array(N_SERIES).fill(Number.NaN);

  constructor(
    readonly nDays: number,
    readonly mode: RecordMode,
    enabled: Uint8Array,
  ) {
    this.enabled = enabled;
    this.daily = new Array<Float32Array | null>(N_SERIES).fill(null);
    this.hourly = new Array<Float32Array | null>(N_SERIES).fill(null);
    const hourlyL: number[] = [];
    const sumL: number[] = [];
    const minL: number[] = [];
    const maxL: number[] = [];
    const wakeL: number[] = [];
    const dailyL: number[] = [];
    for (let i = 0; i < N_SERIES; i++) {
      const d = SERIES[i]!;
      this.hourlyRes[i] = d.resolution === 'hourly' ? 1 : 0;
      this.aggCode[i] = AGG_CODE[d.agg];
      if (!enabled[i]) continue;
      if (mode !== 'none') {
        this.daily[i] = new Float32Array(nDays).fill(Number.NaN);
        if (mode === 'full' && d.resolution === 'hourly') this.hourly[i] = new Float32Array(nDays * 24).fill(Number.NaN);
      }
      if (d.resolution === 'hourly') {
        hourlyL.push(i);
        const agg = d.agg as DailyAgg;
        if (agg === 'sum' || agg === 'mean') sumL.push(i);
        else if (agg === 'min') minL.push(i);
        else if (agg === 'max') maxL.push(i);
        else if (agg === 'wake') wakeL.push(i);
      } else dailyL.push(i);
    }
    this.idxHourly = Int32Array.from(hourlyL);
    this.idxSumMean = Int32Array.from(sumL);
    this.idxMin = Int32Array.from(minL);
    this.idxMax = Int32Array.from(maxL);
    this.idxWake = Int32Array.from(wakeL);
    this.idxDaily = Int32Array.from(dailyL);
    this.lastVal.fill(Number.NaN);
    this.resetAccumulators();
  }

  private resetAccumulators(): void {
    const acc = this.acc;
    const sm = this.idxSumMean;
    for (let j = 0; j < sm.length; j++) acc[sm[j]!] = 0;
    const mn = this.idxMin;
    for (let j = 0; j < mn.length; j++) acc[mn[j]!] = Number.POSITIVE_INFINITY;
    const mx = this.idxMax;
    for (let j = 0; j < mx.length; j++) acc[mx[j]!] = Number.NEGATIVE_INFINITY;
    const wk = this.idxWake;
    for (let j = 0; j < wk.length; j++) this.wakeVal[wk[j]!] = Number.NaN;
    this.hoursInDay = 0;
  }

  beginHour(): void {
    const f = this.hourFrame;
    const idx = this.idxHourly;
    for (let j = 0; j < idx.length; j++) f[idx[j]!] = Number.NaN;
  }

  /** Call after every module's recordHour. `isWakeHour` = this hour is the day's wake hour. */
  commitHour(day: number, hourOfDay: number, isWakeHour: boolean): void {
    const f = this.hourFrame;
    const last = this.lastVal;
    const idx = this.idxHourly;
    if (this.mode === 'full') {
      const off = day * 24 + hourOfDay;
      for (let j = 0; j < idx.length; j++) {
        const i = idx[j]!;
        const v = f[i]!;
        last[i] = v;
        const h = this.hourly[i];
        if (h) h[off] = v;
      }
    } else {
      for (let j = 0; j < idx.length; j++) {
        const i = idx[j]!;
        last[i] = f[i]!;
      }
    }
    const acc = this.acc;
    const sm = this.idxSumMean;
    for (let j = 0; j < sm.length; j++) {
      const i = sm[j]!;
      acc[i] = acc[i]! + f[i]!;
    }
    const mn = this.idxMin;
    for (let j = 0; j < mn.length; j++) {
      const i = mn[j]!;
      const v = f[i]!;
      if (v < acc[i]! || v !== v) acc[i] = v;
    }
    const mx = this.idxMax;
    for (let j = 0; j < mx.length; j++) {
      const i = mx[j]!;
      const v = f[i]!;
      if (v > acc[i]! || v !== v) acc[i] = v;
    }
    if (isWakeHour) {
      const wk = this.idxWake;
      for (let j = 0; j < wk.length; j++) this.wakeVal[wk[j]!] = f[wk[j]!]!;
      // morning anchor (MODEL_SPEC §3.4, §6): the t = 0 value of a wake-hour series is day 0's wake-hour value
      if (day === 0) for (let j = 0; j < wk.length; j++) this.initial[wk[j]!] = f[wk[j]!]!;
    }
    this.hoursInDay++;
  }

  beginDay(): void {
    const f = this.dayFrame;
    const idx = this.idxDaily;
    for (let j = 0; j < idx.length; j++) f[idx[j]!] = Number.NaN;
  }

  /** Call after every module's recordDay. Finalises daily aggregates for `day`. */
  commitDay(day: number): void {
    if (this.mode !== 'none') {
      const hi = this.idxHourly;
      for (let j = 0; j < hi.length; j++) {
        const i = hi[j]!;
        const code = this.aggCode[i];
        let v: number;
        if (code === 0) v = this.lastVal[i]!;
        else if (code === 1) v = this.wakeVal[i]!;
        else if (code === 2) v = this.hoursInDay > 0 ? this.acc[i]! / this.hoursInDay : Number.NaN;
        else if (code === 3) v = this.acc[i]!;
        else v = Number.isFinite(this.acc[i]!) ? this.acc[i]! : Number.NaN;
        this.daily[i]![day] = v;
      }
    }
    const f = this.dayFrame;
    const di = this.idxDaily;
    for (let j = 0; j < di.length; j++) {
      const i = di[j]!;
      const v = f[i]!;
      this.lastVal[i] = v;
      if (this.mode !== 'none') this.daily[i]![day] = v;
    }
    this.resetAccumulators();
  }

  /**
   * Store the current frames as the t = 0 values (after burn-in). Series aggregated at the wake hour are overwritten with
   * day 0's wake-hour value when that hour is committed (morning anchor: the entered weight is a morning weight).
   */
  captureInitial(): void {
    for (let i = 0; i < N_SERIES; i++) {
      this.initial[i] = this.hourlyRes[i] === 1 ? this.hourFrame[i]! : this.dayFrame[i]!;
    }
  }

  lastValue(i: number): number {
    return this.lastVal[i]!;
  }

  /** Build the public maps (allocation allowed: called once). */
  export(ids: readonly SeriesId[]): {
    daily: Partial<Record<SeriesId, Float32Array>>;
    hourly: Partial<Record<SeriesId, Float32Array>>;
    initial: Partial<Record<SeriesId, number>>;
    final: Partial<Record<SeriesId, number>>;
  } {
    const daily: Partial<Record<SeriesId, Float32Array>> = {};
    const hourly: Partial<Record<SeriesId, Float32Array>> = {};
    const initial: Partial<Record<SeriesId, number>> = {};
    const final: Partial<Record<SeriesId, number>> = {};
    for (const id of ids) {
      const i = SERIES_INDEX[id];
      if (this.enabled[i] === 0) continue;
      const d = this.daily[i];
      const h = this.hourly[i];
      if (d) daily[id] = d;
      if (h) hourly[id] = h;
      initial[id] = this.initial[i]!;
      final[id] = this.lastVal[i]!;
    }
    return { daily, hourly, initial, final };
  }
}
