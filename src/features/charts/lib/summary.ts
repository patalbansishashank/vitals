/* ==========================================================================
   Generated accessible summaries (CHART_SPEC §9):
   "Fat mass, kilograms, grade A. Falls from 24.1 to 19.8 (likely 18.6 to 21.0)
    over 12 weeks; fastest in weeks 1 to 2. Press T for the data table."
   ========================================================================== */
import type { ChartSeries, Goal, PlanSeriesSet } from '../types';
import { formatNumber, formatSigned } from './format';
import { baselineOf } from './series';

const UNIT_WORDS: Record<string, string> = {
  kg: 'kilograms',
  g: 'grams',
  lb: 'pounds',
  cm: 'centimetres',
  in: 'inches',
  '%': 'percent',
  index: 'index, 0 to 100',
  'mmol/L': 'millimoles per litre',
  'mg/dL': 'milligrams per decilitre',
  'g/L': 'grams per litre',
  'ng/mL': 'nanograms per millilitre',
  'pg/mL': 'picograms per millilitre',
  mmHg: 'millimetres of mercury',
  'kcal/d': 'kilocalories per day',
  kcal: 'kilocalories',
  'kJ/d': 'kilojoules per day',
  kJ: 'kilojoules',
  'mL/kg/min': 'millilitres per kilogram per minute',
};

export const unitWords = (unit: string): string => UNIT_WORDS[unit] ?? unit;

/** Plain number for speech: ASCII minus is announced as "minus" by screen readers. */
const say = (v: number, d: number) => formatNumber(v, d, { thousands: ',' }).replace('−', 'minus ');

function durationWords(days: number): string {
  if (days % 7 === 0 && days >= 14) return `${days / 7} weeks`;
  return `${days} days`;
}

export function laneSummary(s: ChartSeries, opts: { tableHint?: boolean } = {}): string {
  const v = s.daily.values;
  const n = v.length;
  const d = s.format.decimals;
  const start = baselineOf(s);
  const end = v[n - 1]!;
  const parts: string[] = [`${s.label}, ${unitWords(s.unit)}, grade ${s.grade}.`];
  const tol = Math.max(10 ** -d / 2, Math.abs(start) * 0.005);
  const delta = end - start;
  const verb = Math.abs(delta) <= tol ? 'Stays about the same at' : delta > 0 ? 'Rises from' : 'Falls from';
  let sentence =
    verb === 'Stays about the same at' ? `${verb} ${say(end, d)}` : `${verb} ${say(start, d)} to ${say(end, d)}`;
  const b = s.daily.band;
  if (b) sentence += ` (likely ${say(b.lo[n - 1]!, d)} to ${say(b.hi[n - 1]!, d)})`;
  sentence += ` over ${durationWords(n)}`;

  // fastest two-week stretch in the direction of travel
  if (n >= 21 && verb !== 'Stays about the same at') {
    const weeks = Math.floor(n / 7);
    let best = -Infinity;
    let bestW = 0;
    for (let w = 0; w + 1 < weeks; w++) {
      const a = w === 0 ? start : v[w * 7 - 1]!;
      const c = v[Math.min(n - 1, w * 7 + 13)]!;
      const ch = (c - a) * Math.sign(delta);
      if (ch > best) {
        best = ch;
        bestW = w;
      }
    }
    sentence += `; fastest in weeks ${bestW + 1} to ${bestW + 2}`;
  }
  // a clear peak or trough in between
  let maxI = 0;
  let minI = 0;
  for (let i = 1; i < n; i++) {
    if (v[i]! > v[maxI]!) maxI = i;
    if (v[i]! < v[minI]!) minI = i;
  }
  const range = v[maxI]! - v[minI]!;
  if (range > 0 && maxI > 2 && maxI < n - 3 && v[maxI]! - Math.max(start, end) > range * 0.25)
    sentence += `; peaks at ${say(v[maxI]!, d)} in week ${Math.floor(maxI / 7) + 1}`;
  else if (range > 0 && minI > 2 && minI < n - 3 && Math.min(start, end) - v[minI]! > range * 0.25)
    sentence += `; lowest at ${say(v[minI]!, d)} in week ${Math.floor(minI / 7) + 1}`;
  parts.push(sentence + '.');
  if (s.grade === 'D') parts.push('Exploratory: based on animal and cell studies.');
  if (opts.tableHint !== false) parts.push('Press T for the data table.');
  return parts.join(' ');
}

/** "Plan A reaches −10.4 kg, plan B −10.1, plan C −6.2; target −10." */
export function comparisonSummary(goal: Goal, plans: PlanSeriesSet[]): string {
  const bits: string[] = [];
  let unit = '';
  let d = 1;
  let start = NaN;
  plans.forEach((p, k) => {
    const s = p.series.find((x) => x.id === goal.metricId);
    if (!s) return;
    unit = s.unit === 'index' ? '' : ` ${s.unit}`;
    d = s.format.decimals;
    start = baselineOf(s);
    const end = s.daily.values[s.daily.values.length - 1]!;
    const ch = formatSigned(end - start, d).replace('−', 'minus ');
    bits.push(k === 0 ? `Plan ${p.id} changes by ${ch}${unit}` : `plan ${p.id} ${ch}`);
  });
  let out = `${goal.rank}. ${goal.text}. ${bits.join(', ')}`;
  // the label already reads "target −10 kg" (types.ts Goal.target.label)
  if (goal.target && Number.isFinite(start)) out += `; ${/^target\b/i.test(goal.target.label) ? goal.target.label : `target ${goal.target.label}`}`;
  return out + '.';
}
