/**
 * Where a reading sits (r071): the scale each ring signal is drawn on (`RangeScale`), one place for the Signals rows, the
 * Ring glance on Today, the Overnight card and the signal pages. Heart rate, blood oxygen and stress read against FIXED
 * bands (`BANDS`, the words' edges are ticks); HRV and skin temperature read against the person's OWN usual night (S2's
 * `/baselines`, ready after seven nights): HRV on the usual stretch (its median and spread), skin temperature as the
 * difference from the usual night's median, centred on zero with the 0.5 degree limits. A baseline still forming gives
 * `calibrating` (dashed ticks, "Building baseline"), never a usual stretch that is not there. Pure: no React.
 */
import type { RangeBand, RangeState } from '@/components';
import { BANDS, TEMP_CAUTION_C, baselineReady, decimalsOf, deltaToDisplay, hrvThresholdMs, hrvUsualMs, tempDelta, unitOf, type PersonalBaselines, type RingMetric, type UnitPrefs } from './model';

export interface MetricScale {
  /** What the marker shows: the reading (HRV, hr, blood oxygen, stress) or, for skin temperature, its difference from the usual night. */
  value: number | null;
  min: number;
  max: number;
  bands: RangeBand[];
  /** The person's usual stretch (HRV: median ± one spread; temperature: ± the 0.5 degree limit). */
  usual?: [number, number];
  unit: string;
  spokenUnit: string;
  decimals: number;
  state: RangeState;
  /** The fixed-band signals print their band edges (`bands`); the personal ones a plain scale. */
  ticks: 'bands' | number;
  /** The scale's value is a difference from usual (skin temperature): read it with a sign. */
  delta: boolean;
}

const FIXED: Partial<Record<RingMetric, { min: number; max: number }>> = {
  hr: { min: 40, max: 160 },
  spo2: { min: 85, max: 100 },
  stress: { min: 0, max: 100 },
};

const SPOKEN_UNIT: Record<string, string> = { bpm: 'beats per minute', ms: 'milliseconds', '%': 'percent', 'ring index': 'ring index', '°C': 'degrees Celsius', '°F': 'degrees Fahrenheit' };

const toBands = (kind: RingMetric): RangeBand[] => (BANDS[kind] ?? []).map((b) => ({ from: b.from, word: b.word, severity: b.severity }));

/**
 * The scale of one signal for one reading (server units for `reading`: bpm, ms, %, ring index, °C). `stale` is the reading's
 * own staleness (the marker turns hollow and the age is shown). Pure.
 */
export function metricScale(kind: RingMetric, reading: number | null, base: PersonalBaselines, prefs: UnitPrefs, o: { stale?: boolean } = {}): MetricScale {
  const unit = unitOf(kind, prefs);
  const common = { unit, spokenUnit: SPOKEN_UNIT[unit] ?? unit, decimals: decimalsOf(kind) };
  const live: RangeState = reading === null ? 'none' : o.stale ? 'stale' : 'normal';
  const fixed = FIXED[kind];
  if (fixed) return { ...common, value: reading, ...fixed, bands: toBands(kind), ticks: 'bands', delta: false, state: live };

  if (kind === 'hrv') {
    const c = hrvUsualMs(base);
    const h = base?.hrvBaseline;
    if (!baselineReady('hrv', base) || c === null || !h) return { ...common, value: reading, min: 0, max: 120, bands: [], ticks: 41, delta: false, state: 'calibrating' };
    const s = Math.max(1, c * (Math.exp(h.s) - 1));
    const t = hrvThresholdMs(c);
    const lo = Math.max(0, Math.min(c - 3 * s, reading ?? Infinity) - 0.05 * c);
    const hi = Math.max(c + 3 * s, reading ?? -Infinity) + 0.05 * c;
    return {
      ...common,
      value: reading,
      min: Math.floor(lo),
      max: Math.ceil(hi),
      usual: [Math.max(0, c - s), c + s],
      bands: [
        { from: -Infinity, word: 'Below usual', severity: 'caution' },
        { from: c - t, word: 'Near usual', severity: 'ok' },
        { from: c + t, word: 'Above usual', severity: 'ok' },
      ],
      ticks: 41,
      delta: false,
      state: live,
    };
  }

  // skin temperature: the difference from the usual night, centred on zero
  const limit = deltaToDisplay('temp', TEMP_CAUTION_C, prefs);
  const edge = Math.round(limit * 30) / 10; // three limits either side
  const delta = reading === null ? null : tempDelta(reading, base);
  const ready = baselineReady('temp', base);
  return {
    ...common,
    value: delta === null ? null : Math.round(deltaToDisplay('temp', delta, prefs) * 10) / 10,
    min: -edge,
    max: edge,
    usual: [-limit, limit],
    bands: [
      { from: -Infinity, word: 'Below usual', severity: 'caution' },
      { from: -limit, word: 'Near usual', severity: 'ok' },
      { from: limit, word: 'Above usual', severity: 'caution' },
    ],
    ticks: 41,
    delta: true,
    state: !ready ? 'calibrating' : live,
  };
}
