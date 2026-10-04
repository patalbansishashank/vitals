/**
 * Read-only accessors over one arm's `SimulationResult` used by scenario `measure` functions.
 *
 * Time convention. `daily[id][d]` is the catalogue's daily aggregate of day d (day d = clock 00:00-24:00):
 *   'end'  → value at 24:00 of day d;  'wake' → value at the wake hour of day d (≈ 07:00, "the morning weighing");
 *   'sum' / 'mean' / 'min' / 'max' → over the 24 hours of day d.
 * "After n days" therefore means: 'end' → daily[n − 1]; 'wake' → daily[n] (the morning of day n, exists when the
 * horizon has n + 1 days — the scenario builders add that day); aggregates over a day → daily[n − 1].
 */
import type { ResolvedProfile, SimulationResult, CompiledSchedule } from '../../types';
import { SERIES_INDEX, seriesDef, type SeriesId } from '../../types/metrics';

export class ArmView {
  constructor(
    readonly id: string,
    readonly profile: ResolvedProfile,
    readonly compiled: CompiledSchedule,
    readonly result: SimulationResult,
  ) {}

  get nDays(): number {
    return this.result.meta.nDays;
  }

  /** Days actually simulated (shorter than nDays when a planner-style abort fired). */
  get daysRun(): number {
    return this.result.meta.aborted ? this.result.meta.aborted.day + 1 : this.nDays;
  }

  /** True when the series was recorded. */
  has(id: SeriesId): boolean {
    return this.result.daily[id] !== undefined;
  }

  daily(id: SeriesId): Float32Array | undefined {
    return this.result.daily[id];
  }

  hourly(id: SeriesId): Float32Array | undefined {
    return this.result.hourly[id];
  }

  /**
   * Baseline value of a series (`SimulationResult.initial`): the state at t = 0 (after burn-in, midnight before day 0), except
   * for wake-hour series (scale weight, DXA-lean, body fat, water detail), whose baseline is day 0's wake-hour value = the
   * entered morning weight (morning anchor, MODEL_SPEC §3.4). Use `t0` for changes counted from t = 0 itself.
   */
  initial(id: SeriesId): number {
    return this.result.initial[id] ?? Number.NaN;
  }

  /**
   * Value at t = 0 itself (midnight after burn-in). Differs from `initial` only for the scale-derived wake-hour series: the
   * midnight scale is the entered weight plus the habitual overnight fall (`meta.checks.t0ScaleKg`, runs with checks on).
   */
  t0(id: SeriesId): number {
    if (id !== 'scaleWeight' && id !== 'leanMass' && id !== 'bodyFatPct') return this.initial(id);
    const scale = this.result.meta.checks?.t0ScaleKg ?? Number.NaN;
    if (id === 'scaleWeight') return scale;
    const fm = this.initial('fatMass');
    return id === 'leanMass' ? scale - fm : (100 * fm) / scale;
  }

  /** Raw daily aggregate of day d. */
  day(id: SeriesId, d: number): number {
    return this.result.daily[id]?.[d] ?? Number.NaN;
  }

  /** Value after n complete days (see the time convention in the file header). */
  after(id: SeriesId, n: number): number {
    const a = this.result.daily[id];
    if (!a || n < 1) return n === 0 ? this.initial(id) : Number.NaN;
    const agg = seriesDef(id).agg;
    if (agg === 'wake') return a[Math.min(n, a.length - 1)] ?? Number.NaN;
    return a[Math.min(n - 1, a.length - 1)] ?? Number.NaN;
  }

  /** after(n) − initial. */
  delta(id: SeriesId, n: number): number {
    return this.after(id, n) - this.initial(id);
  }

  /** 100·(after(n)/initial − 1). */
  pct(id: SeriesId, n: number): number {
    return 100 * (this.after(id, n) / this.initial(id) - 1);
  }

  /** Mean of the raw daily values over days [from, to). */
  mean(id: SeriesId, from: number, to: number): number {
    const a = this.result.daily[id];
    if (!a) return Number.NaN;
    const hi = Math.min(to, a.length);
    if (hi <= from) return Number.NaN;
    let s = 0;
    for (let d = from; d < hi; d++) s += a[d]!;
    return s / (hi - from);
  }

  sum(id: SeriesId, from: number, to: number): number {
    const a = this.result.daily[id];
    if (!a) return Number.NaN;
    const hi = Math.min(to, a.length);
    let s = 0;
    for (let d = from; d < hi; d++) s += a[d]!;
    return s;
  }

  min(id: SeriesId, from = 0, to = Number.POSITIVE_INFINITY): number {
    const a = this.result.daily[id];
    if (!a) return Number.NaN;
    let m = Number.POSITIVE_INFINITY;
    for (let d = from; d < Math.min(to, a.length); d++) m = Math.min(m, a[d]!);
    return m;
  }

  max(id: SeriesId, from = 0, to = Number.POSITIVE_INFINITY): number {
    const a = this.result.daily[id];
    if (!a) return Number.NaN;
    let m = Number.NEGATIVE_INFINITY;
    for (let d = from; d < Math.min(to, a.length); d++) m = Math.max(m, a[d]!);
    return m;
  }

  /** Day index of the maximum over [from, to). */
  argmax(id: SeriesId, from = 0, to = Number.POSITIVE_INFINITY): number {
    const a = this.result.daily[id];
    if (!a) return Number.NaN;
    let best = Number.NEGATIVE_INFINITY;
    let at = Number.NaN;
    for (let d = from; d < Math.min(to, a.length); d++) if (a[d]! > best) [best, at] = [a[d]!, d];
    return at;
  }

  /** Last recorded value of a series. */
  final(id: SeriesId): number {
    return this.result.final[id] ?? Number.NaN;
  }

  /** Hourly value at absolute hour index h (record 'full' only). */
  hour(id: SeriesId, h: number): number {
    return this.result.hourly[id]?.[h] ?? Number.NaN;
  }

  /** Mean of an hourly series over absolute hours [h0, h1). */
  hourMean(id: SeriesId, h0: number, h1: number): number {
    const a = this.result.hourly[id];
    if (!a) return Number.NaN;
    let s = 0;
    const hi = Math.min(h1, a.length);
    for (let h = h0; h < hi; h++) s += a[h]!;
    return hi > h0 ? s / (hi - h0) : Number.NaN;
  }

  /** Number of events of a type in [day0, day1). */
  countEvents(type: string, day0 = 0, day1 = Number.POSITIVE_INFINITY): number {
    let n = 0;
    for (const e of this.result.events) if (e.type === type && e.day >= day0 && e.day < day1) n++;
    return n;
  }

  /** True when the warning rule (e.g. 'W-E01') fired at least once. */
  hasWarning(ruleId: string): boolean {
    return this.result.warnings.some((w) => w.id === ruleId);
  }

  /** Baseline (t = 0 profile) values used for percentage targets. */
  get fm0Kg(): number {
    return this.profile.fm0Kg;
  }
  get ffm0Kg(): number {
    return this.profile.ffm0Kg;
  }
  get bw0Kg(): number {
    return this.profile.weightKg;
  }

  /** Kept so a series id can be validated by callers. */
  static hasSeries(id: string): id is SeriesId {
    return id in SERIES_INDEX;
  }
}
