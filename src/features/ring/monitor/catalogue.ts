/**
 * The Ring monitor catalogue (SPEC A.1.3 #46, DATAVIZ P10): every signal the Signals card can show, in the default
 * order (26; the first 12 on by default). Entries are `{id, label, unit, aggregate, source, available}`.
 *
 * - HRV and skin temperature are the night's values against S2's nightly baselines (A.2 #5); the catalogue lists
 *   skin temperature under `latest`, but a daytime reading against a nightly usual would always read low (DECISIONS).
 * - `available` says whether this build and this ring can supply it. An entry it cannot supply is never listed: the
 *   energy entries need the engine's day (Today's run: a plan, or Your body without one), training load an approved
 *   activity in the last 28 days (V2 `train-load/1`; its value then says when it waits on a resting heart rate); breathing
 *   rate and tosses and turns are not here at all (A.1.6).
 * - Quiet mode does not offer energy or scores.
 */
import type { Domain } from '@/components';
import { Activity, Clock3, Droplet, Flame, Footprints, Gauge, HeartPulse, Hourglass, Moon, MoonStar, Route, Sunrise, Thermometer, Timer, TrendingUp, Waves, Zap, type LucideIcon } from 'lucide-react';

export type MonitorAggregate = 'latest' | 'nightLow' | 'nightMedian' | 'dayMax' | 'day' | 'mainSleep' | 'total';
export type MonitorSource = 'metrics' | 'sleep' | 'derived' | 'activity' | 'energyDay' | 'dayZones' | 'trainingLoad' | 'indices';

export interface MonitorEntry {
  id: string;
  label: string;
  unit: string | null;
  aggregate: MonitorAggregate;
  source: MonitorSource;
  /** The ring metric of a `latest` entry (its Signals row is a level bar and opens the signal page). */
  metric?: 'hr' | 'hrv' | 'spo2' | 'stress' | 'temp';
  icon: LucideIcon;
  /** Energy or a score: hidden in quiet mode. */
  quietHidden?: boolean;
}

export const MONITOR_CATALOGUE: readonly MonitorEntry[] = [
  { id: 'hr', label: 'Heart rate', unit: 'bpm', aggregate: 'latest', source: 'metrics', metric: 'hr', icon: HeartPulse },
  { id: 'sleepLowHr', label: 'Sleeping low HR', unit: 'bpm', aggregate: 'nightLow', source: 'sleep', icon: Moon },
  { id: 'hrv', label: 'HRV overnight', unit: 'ms', aggregate: 'nightMedian', source: 'sleep', metric: 'hrv', icon: Waves },
  { id: 'spo2', label: 'Blood oxygen', unit: '%', aggregate: 'latest', source: 'metrics', metric: 'spo2', icon: Droplet },
  { id: 'stress', label: 'Stress', unit: 'ring index', aggregate: 'latest', source: 'metrics', metric: 'stress', icon: Gauge },
  { id: 'temp', label: 'Skin temperature overnight', unit: '°C', aggregate: 'nightMedian', source: 'sleep', metric: 'temp', icon: Thermometer },
  { id: 'peakHr', label: 'Highest reading', unit: 'bpm', aggregate: 'dayMax', source: 'derived', icon: TrendingUp },
  { id: 'avgWorkoutHr', label: 'Average workout HR', unit: 'bpm', aggregate: 'day', source: 'derived', icon: Activity },
  { id: 'nonExerciseHr', label: 'Non-exercise HR', unit: 'bpm', aggregate: 'day', source: 'derived', icon: HeartPulse },
  { id: 'sleepDuration', label: 'Sleep duration', unit: null, aggregate: 'mainSleep', source: 'sleep', icon: MoonStar },
  { id: 'fellAsleep', label: 'Fell asleep', unit: null, aggregate: 'mainSleep', source: 'sleep', icon: Moon },
  { id: 'woke', label: 'Woke', unit: null, aggregate: 'mainSleep', source: 'sleep', icon: Sunrise },
  { id: 'midpoint', label: 'Sleep midpoint', unit: null, aggregate: 'mainSleep', source: 'sleep', icon: Clock3 },
  { id: 'continuity', label: 'Window continuity', unit: '%', aggregate: 'mainSleep', source: 'sleep', icon: Waves },
  { id: 'restorative', label: 'Deep and REM', unit: null, aggregate: 'mainSleep', source: 'sleep', icon: MoonStar },
  { id: 'settle', label: 'Settle time', unit: 'min', aggregate: 'mainSleep', source: 'sleep', icon: Hourglass },
  { id: 'wakeUps', label: 'Wake-ups', unit: null, aggregate: 'mainSleep', source: 'sleep', icon: Sunrise },
  { id: 'steps', label: 'Steps', unit: null, aggregate: 'total', source: 'activity', icon: Footprints },
  { id: 'distance', label: 'Distance', unit: null, aggregate: 'total', source: 'activity', icon: Route },
  { id: 'activeTime', label: 'Active time', unit: 'min', aggregate: 'total', source: 'activity', icon: Timer },
  { id: 'activeEnergy', label: 'Active energy', unit: 'kcal', aggregate: 'total', source: 'energyDay', icon: Flame, quietHidden: true },
  { id: 'totalEnergy', label: 'Total energy', unit: 'kcal', aggregate: 'total', source: 'energyDay', icon: Flame, quietHidden: true },
  { id: 'zone13', label: 'Zone 1 to 3', unit: 'min', aggregate: 'total', source: 'dayZones', icon: Activity },
  { id: 'zone45', label: 'Zone 4 to 5', unit: 'min', aggregate: 'total', source: 'dayZones', icon: Zap },
  { id: 'trainingLoad', label: 'Training load', unit: null, aggregate: 'total', source: 'trainingLoad', icon: TrendingUp, quietHidden: true },
  { id: 'dayScore', label: 'Day score', unit: null, aggregate: 'total', source: 'indices', icon: Gauge, quietHidden: true },
];

/** (r068 O06) The default set: the six readings. The rest (sleep times, workout heart rate, energy…) repeat the cards around it and are one tap away in Edit. */
export const MONITOR_DEFAULT: readonly string[] = ['hr', 'sleepLowHr', 'hrv', 'spo2', 'stress', 'temp'];

/**
 * What this build can supply: the sources that exist here. `dayZones` needs S2's timeline; `energyDay` the engine's day
 * (0.6.3 S23); `trainingLoad` an approved activity in the load window (0.6.3 S21).
 */
export function availableSources(o: { timeline: boolean; energy?: boolean; load?: boolean }): ReadonlySet<MonitorSource> {
  const s = new Set<MonitorSource>(['metrics', 'sleep', 'derived', 'activity', 'indices']);
  if (o.timeline) s.add('dayZones');
  if (o.energy) s.add('energyDay');
  if (o.load) s.add('trainingLoad');
  return s;
}

/** The entries offered: supplied by this build, and in quiet mode no energy or scores. */
export function offeredEntries(sources: ReadonlySet<MonitorSource>, quiet: boolean): MonitorEntry[] {
  return MONITOR_CATALOGUE.filter((e) => sources.has(e.source) && !(quiet && e.quietHidden));
}

export const entryOf = (id: string): MonitorEntry | undefined => MONITOR_CATALOGUE.find((e) => e.id === id);

/**
 * The ids to show: the stored list when it has any offered entry, else the default set (an absent or empty list shows
 * the default; the card then offers "Add signals" for an empty one). Unknown and unoffered ids drop out.
 */
export function shownIds(stored: readonly string[] | null, offered: readonly MonitorEntry[]): string[] {
  const ok = new Set(offered.map((e) => e.id));
  const list = (stored ?? []).filter((id) => ok.has(id));
  return list.length ? list : MONITOR_DEFAULT.filter((id) => ok.has(id));
}

// ---------------------------------------------------------------------------------------------------------------
// (r071) The Edit sheet's groups: the 26 entries fall into five, each a domain (its hue dot and icon tint) so the Add list
// reads by what a signal is about, not by where the ring got it (AUDIT card 3).

export type MonitorGroup = 'Heart' | 'Recovery' | 'Sleep' | 'Move' | 'Energy';

/** The groups in the order the Add list shows them. */
export const MONITOR_GROUPS: ReadonlyArray<{ group: MonitorGroup; domain: Domain; ids: readonly string[] }> = [
  { group: 'Heart', domain: 'heart', ids: ['hr', 'spo2', 'peakHr', 'avgWorkoutHr', 'nonExerciseHr', 'zone13', 'zone45'] },
  { group: 'Recovery', domain: 'recovery', ids: ['hrv', 'stress', 'temp', 'dayScore'] },
  { group: 'Sleep', domain: 'sleep', ids: ['sleepLowHr', 'sleepDuration', 'fellAsleep', 'woke', 'midpoint', 'continuity', 'restorative', 'settle', 'wakeUps'] },
  { group: 'Move', domain: 'steps', ids: ['steps', 'distance', 'activeTime', 'trainingLoad'] },
  { group: 'Energy', domain: 'energy', ids: ['activeEnergy', 'totalEnergy'] },
];

/** The group and domain of a catalogue entry (every entry has one: a test fails when a new entry has not). */
export function groupOf(id: string): { group: MonitorGroup; domain: Domain } | undefined {
  const g = MONITOR_GROUPS.find((x) => x.ids.includes(id));
  return g ? { group: g.group, domain: g.domain } : undefined;
}

/** The entries in the Add list's order: by group, then as the catalogue lists them. */
export function entriesByGroup(entries: readonly MonitorEntry[]): MonitorEntry[] {
  const rank = (id: string) => {
    const g = MONITOR_GROUPS.findIndex((x) => x.ids.includes(id));
    return g < 0 ? MONITOR_GROUPS.length : g;
  };
  return entries.map((e, i) => ({ e, i })).sort((a, b) => rank(a.e.id) - rank(b.e.id) || a.i - b.i).map((x) => x.e);
}
