/* Deterministic sample data for the viz gallery and the render harness. Times are UTC. */
import type { DayArc } from '../DayDisc';
import type { MonitorItem } from '../MonitorSheet';
import type { TracePoint } from '../OvernightTrace';
import type { StateSegment } from '../StateStrip';
import type { ArcBand } from '../ArcRuler';

export const TZ = 'UTC';
const T = (hhmm: string, day = '2026-10-26') => Date.parse(`${day}T${hhmm}:00Z`);

export const NIGHT = { from: T('02:25'), to: T('11:15') };

/** A sleeping heart rate: 69 at onset, settling into the low 50s, a spike while awake near 07:30, low 49 at 09:55, 59 at wake. */
export function nightHr(): TracePoint[] {
  const pts: TracePoint[] = [];
  const step = 5.5 * 60_000;
  for (let t = NIGHT.from; t <= NIGHT.to; t += step) {
    const h = (t - NIGHT.from) / 3_600_000;
    let v = 53 + 16 * Math.exp(-h * 2.2) + 2.2 * Math.sin(h * 3.1) + 1.4 * Math.sin(h * 7.3 + 1);
    if (h > 4.9 && h < 5.4) v += 18 * Math.sin(((h - 4.9) / 0.5) * Math.PI);
    if (h > 7.2 && h < 7.7) v -= 3.5 * Math.sin(((h - 7.2) / 0.5) * Math.PI);
    if (h > 7.75) v += (h - 7.75) * 5.2;
    if (Math.abs(t - T('04:40')) < 9 * 60_000) continue; // a short gap: the line breaks
    pts.push({ t: Math.round(t), v: Math.round(v) });
  }
  return pts;
}

export const NIGHT_LOW: TracePoint = (() => {
  const p = nightHr().reduce((a, b) => (b.v < a.v ? b : a));
  return p;
})();

export const NIGHT_AWAKE = [{ from: T('07:20'), to: T('07:45') }];

export const SPARSE_HR: TracePoint[] = [
  { t: T('03:10'), v: 61 },
  { t: T('05:40'), v: 55 },
  { t: T('08:05'), v: 52 },
  { t: T('10:30'), v: 57 },
];

export const DAY = { from: T('00:00'), to: T('00:00', '2026-10-27'), now: T('16:20') };

export const STRESS_LABELS = ['Calm', 'Normal', 'Elevated', 'High'];
export const STRESS: StateSegment[] = [
  { from: T('02:20'), to: T('06:40'), state: 0 },
  { from: T('06:40'), to: T('09:30'), state: 1 },
  { from: T('09:30'), to: T('10:50'), state: 0 },
  { from: T('11:15'), to: T('12:40'), state: 2 },
  { from: T('13:00'), to: T('14:10'), state: 3 },
  { from: T('14:10'), to: T('14:14'), state: 2 },
  { from: T('14:14'), to: T('14:18'), state: 1 },
  { from: T('14:18'), to: T('14:22'), state: 3 },
];

export const DAY_LABELS = ['Sleep', 'Fast', 'Eating window', 'Session'];
export const PLAN_DAY: StateSegment[] = [
  { from: T('00:00'), to: T('06:45'), state: 0 },
  { from: T('06:45'), to: T('12:00'), state: 1 },
  { from: T('12:00'), to: T('17:30'), state: 2 },
  { from: T('17:30'), to: T('18:30'), state: 3, text: 'Session: easy run' },
  { from: T('18:30'), to: T('20:00'), state: 2 },
  { from: T('20:00'), to: T('23:00'), state: 1 },
  { from: T('23:00'), to: T('00:00', '2026-10-27'), state: 0 },
];

export const STRESS_BANDS: ArcBand[] = [
  { from: -Infinity, word: 'Calm', severity: 'ok' },
  { from: 26, word: 'Normal', severity: 'ok' },
  { from: 51, word: 'Elevated', severity: 'caution' },
  { from: 76, word: 'High', severity: 'caution' },
];

export const DAY_ARCS: DayArc[] = [
  { id: 'recovery', label: 'Recovery', score: 71, confidence: 'high' },
  { id: 'activity', label: 'Activity', score: 92, confidence: 'high' },
  { id: 'sleep', label: 'Sleep', score: 88, confidence: 'medium' },
];

export const DAY_ARCS_LEARNING: DayArc[] = [
  { id: 'recovery', label: 'Recovery', score: null, needs: 'needs 3 more nights' },
  { id: 'activity', label: 'Activity', score: 92, confidence: 'high' },
  { id: 'sleep', label: 'Sleep', score: 64, confidence: 'low' },
];

export const MONITOR_ALL: MonitorItem[] = [
  { id: 'hrv', label: 'HRV', valueText: '70 ms' },
  { id: 'rhr', label: 'Sleeping low HR', valueText: '53 bpm' },
  { id: 'temp', label: 'Skin temperature', calibrating: true },
  { id: 'spo2', label: 'SpO2', valueText: '95 %' },
  { id: 'sleep', label: 'Asleep', valueText: '7 h 32' },
  { id: 'steps', label: 'Steps', valueText: '9 664' },
  { id: 'mid', label: 'Sleep midpoint', valueText: '06:21' },
  { id: 'stress', label: 'Stress', valueText: '89 / 100' },
  { id: 'hp', label: 'Heart Points', valueText: '42' },
  { id: 'distance', label: 'Distance', valueText: '7.5 km' },
];
export const MONITOR_DEFAULT = ['hrv', 'rhr', 'temp', 'spo2', 'sleep', 'steps'];

/** (r064) A raw night of minute epochs in the ring's texture: 1–3 minute flips, Mixed, a short and a long gap. */
export const RAW_NIGHT: { from: number; to: number; spans: Array<{ from: number; to: number; state: number | 'mixed' | null }> } = (() => {
  const from = T('02:25');
  const cycle: Array<[number | 'mixed' | null, number]> = [
    [2, 14], [3, 2], [2, 3], [3, 28], [2, 2], [3, 9], [2, 11], ['mixed', 2], [2, 6], [1, 3], [2, 2], [1, 14], [0, 2], [1, 6],
  ];
  const spans: Array<{ from: number; to: number; state: number | 'mixed' | null }> = [{ from, to: from + 9 * 60_000, state: 0 }];
  let t = from + 9 * 60_000;
  for (let c = 0; c < 5; c++) {
    for (const [state, m] of cycle) {
      spans.push({ from: t, to: t + m * 60_000, state });
      t += m * 60_000;
    }
    t += (c === 1 ? 7 : c === 3 ? 38 : 0) * 60_000; // a short hole (bridged) and a long one (one hatched band)
  }
  spans.push({ from: t, to: t + 6 * 60_000, state: 0 });
  return { from, to: t + 6 * 60_000, spans };
})();
