/**
 * The small pictures of the home-screen widgets, as data (r071 W1): pure helpers that turn what a card already holds
 * (hours of steps, the day's cumulative energy, the night's stage blocks, heart-rate minutes, the weight trend) into the
 * short series a widget draws. A series is values in 0..1 inside its own range (never a unit), at most `SERIES_MAX`
 * of them, and a gap is `null`: never interpolated, never zero. The native painters draw only what they are given.
 */
import { smoothStages, STAGE_SMOOTHING, type RawStageSpan } from '@/components';
import { WIDGET_SERIES_MAX, type WidgetSeries, type WidgetStageSpan } from '@/platform/widgets';

/** The longest series a widget takes (bars: 24 hours or 7 days). */
export const SERIES_MAX = WIDGET_SERIES_MAX;

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const round3 = (x: number): number => Math.round(x * 1000) / 1000;

/**
 * Values scaled into 0..1 over `[lo, hi]` (default: the data's own minimum and maximum, kept `pad` away from the edges so
 * the line never touches the frame). Unknown values stay `null`. A flat series sits at the middle.
 */
export function scaleSeries(values: ReadonlyArray<number | null | undefined>, o: { lo?: number; hi?: number; pad?: number } = {}): Array<number | null> {
  const known = values.filter(finite);
  if (known.length === 0) return values.map(() => null);
  const lo0 = o.lo ?? Math.min(...known);
  const hi0 = o.hi ?? Math.max(...known);
  const pad = o.pad ?? 0;
  const span = hi0 - lo0;
  return values.map((v) => {
    if (!finite(v)) return null;
    if (!(span > 0)) return 0.5;
    const t = (v - lo0) / span;
    return round3(Math.min(1, Math.max(0, pad + t * (1 - 2 * pad))));
  });
}

/** At most `max` points, each the mean of its bucket of neighbours (a bucket with no reading stays `null`). */
export function downsample(values: ReadonlyArray<number | null>, max = SERIES_MAX): Array<number | null> {
  if (values.length <= max) return [...values];
  const out: Array<number | null> = [];
  for (let i = 0; i < max; i++) {
    const a = Math.floor((i * values.length) / max);
    const b = Math.max(a + 1, Math.floor(((i + 1) * values.length) / max));
    const xs = values.slice(a, b).filter(finite);
    out.push(xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  }
  return out;
}

/**
 * The day's running burn as a line and its forecast (Energy): `bins` are the day display's equal bins (kcal in each, in
 * order, `binMs` long), `nowMs` splits them. The line is the cumulative burn up to now, scaled by the day's likely total
 * so it ends near 1 at midnight; `ahead` is the forecast from now on, starting at the live end so the dotted tail joins
 * it. Both have the same length (`SERIES_MAX` points spread evenly over the day, the burn inside a bin spread evenly) and
 * `now` is the live end's index. Pure.
 */
export function cumulativeBurn(bins: ReadonlyArray<{ start: number; kcal: number }>, binMs: number, nowMs: number): WidgetSeries | null {
  const bs = bins.filter((b) => finite(b.start) && finite(b.kcal) && b.kcal >= 0);
  if (bs.length < 2 || !(binMs > 0)) return null;
  const total = bs.reduce((s, b) => s + b.kcal, 0);
  if (!(total > 0)) return null;
  const from = bs[0]!.start;
  const to = bs[bs.length - 1]!.start + binMs;
  const cumAt = (t: number): number => bs.reduce((c, b) => c + b.kcal * Math.min(1, Math.max(0, (t - b.start) / binMs)), 0);
  const n = SERIES_MAX;
  const at = (i: number) => from + ((to - from) * i) / (n - 1);
  const nowIdx = Math.min(n - 1, Math.max(0, Math.round(((nowMs - from) / (to - from)) * (n - 1))));
  const y: Array<number | null> = [];
  const ahead: Array<number | null> = [];
  for (let i = 0; i < n; i++) {
    const v = round3(Math.min(1, cumAt(at(i)) / total));
    y.push(i <= nowIdx ? v : null);
    ahead.push(i >= nowIdx ? v : null);
  }
  return { y, now: nowIdx, ahead };
}

/** Hourly steps as bars scaled to the busiest hour; an hour with no reading stays `null` (never a zero bar). */
export function hourlyBars(hours: ReadonlyArray<number | null>, nowHour: number | null): WidgetSeries | null {
  if (hours.length === 0 || hours.length > SERIES_MAX) return null;
  const max = Math.max(0, ...hours.filter(finite));
  if (!(max > 0)) return null;
  return { y: hours.map((v) => (finite(v) ? round3(Math.max(0, v) / max) : null)), now: nowHour !== null && nowHour >= 0 && nowHour < hours.length ? nowHour : null };
}

/**
 * A line over a day or a range: scaled to its own range, at most `SERIES_MAX` points, the live end last. Gaps stay `null`.
 * The last point is the latest reading itself (a bucket's mean would move the live dot off the figure beside it).
 */
export function lineOf(values: ReadonlyArray<number | null>, o: { pad?: number; lo?: number; hi?: number } = {}): WidgetSeries | null {
  const ds = downsample(values, SERIES_MAX);
  if (!ds.some(finite)) return null;
  let lastKnown = -1;
  values.forEach((v, i) => {
    if (finite(v)) lastKnown = i;
  });
  // the bucket that holds the latest reading: the last whose start (floor(i * length / max)) is not after it
  if (ds.length < values.length && lastKnown >= 0) ds[Math.min(ds.length - 1, Math.ceil(((lastKnown + 1) * ds.length) / values.length) - 1)] = values[lastKnown]!;
  let last = -1;
  ds.forEach((v, i) => {
    if (finite(v)) last = i;
  });
  return { y: scaleSeries(ds, { pad: 0.1, ...o }), now: last };
}

// ------------------------------------------------------------------------------------------------ the night

/** The hypnogram's levels as the app draws them (0 awake, 1 REM, 2 light, 3 deep) and 4 for a night the ring did not stage. */
const STAGE_LEVEL: Record<string, number | 'mixed'> = { awake: 0, rem: 1, light: 2, deep: 3, asleepUnspecified: 'mixed' };

export interface StageBlock {
  start: string;
  end: string;
  stage: string;
}

/**
 * A night's stage blocks as the spans a widget draws: positions in 0..1 of the recorded window, a level 0 to 4. The same
 * display smoothing as the app's hypnogram (Mixed takes its neighbours' stage, short holes are bridged, runs under a
 * minimum fold into a neighbour), with the minimum the width of a widget needs. A night with no named stage at all is
 * drawn as one band of level 4 ("asleep, not staged"), never as a stage. Stretches with no reading are left out.
 */
export function stageSpans(blocks: ReadonlyArray<StageBlock>, from: number, to: number): WidgetStageSpan[] {
  if (!(to > from)) return [];
  const staged = blocks.some((b) => b.stage === 'rem' || b.stage === 'light' || b.stage === 'deep');
  const raw: RawStageSpan[] = blocks.map((b) => ({
    from: Date.parse(b.start),
    to: Date.parse(b.end),
    state: b.stage === 'asleepUnspecified' && !staged ? 4 : (STAGE_LEVEL[b.stage] ?? null),
  }));
  const minMs = Math.max(STAGE_SMOOTHING.minMs, (to - from) / 60);
  const out: WidgetStageSpan[] = [];
  for (const s of smoothStages(raw, { from, to, minMs })) {
    if (s.state === null) continue;
    const a = round3((s.from - from) / (to - from));
    const b = round3((s.to - from) / (to - from));
    if (b > a) out.push([a, b, s.state as 0 | 1 | 2 | 3 | 4]);
  }
  return out;
}
