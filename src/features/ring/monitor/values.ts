/**
 * The value of each monitor entry on one day, for the Signals rows and the Edit signals sheet ("Heart rate · 58 bpm"). Pure.
 * An entry waiting on a baseline says "Calibrating"; one with no value that day gives null (the row shows "—").
 */
import { baselineReady, clockOf, distanceParts, hrvUsualMs, usualStatus, minutesText, readingAge, sleepBand, type PersonalBaselines, type ReadingAgeView, type RingMetric, type Status, type UnitPrefs, unitOf, valueText } from '../model';
import { continuityShown, type NightView } from '@/features/living/sleep/model';
import type { RingScores } from '../indices';
import type { GaugeBaselines, GaugeDaily } from '../types';
import { formatEnergy, formatNumber, type EnergyUnitChoice } from '@/components';
import type { RingLoad } from '../load';
import type { StepsHeadline } from '../day';

export interface MonitorCtx {
  daily: GaugeDaily | null;
  baselines: GaugeBaselines | null;
  night: NightView | null;
  scores: RingScores | null;
  steps: StepsHeadline | null;
  /**
   * Day zone seconds from the APPROVED activities (V2 `dayZones`): Z1–Z3 and Z4–Z5; `toReview` pending ones apart (never
   * counted).
   */
  zones: { z13S: number; z45S: number; toReview?: { z13S: number; z45S: number; count: number } | null } | null;
  prefs: UnitPrefs;
  now: number;
  /** (0.6.3 S23) The day's energy (kcal; the engine's day), `byBedtime` when today's figure includes the plan's remainder. */
  energy?: { totalKcal: number | null; activeKcal: number | null; byBedtime: boolean } | null;
  /** The person's energy unit (display only; values stay kcal). */
  energyUnit?: EnergyUnitChoice;
  /** (0.6.3 S21) The day's training load. */
  load?: RingLoad | null;
}

export interface EntryValue {
  /** A ring reading (the `latest` entries): its raw value for the level bar. */
  reading: number | null;
  text: string | null;
  unit: string | null;
  chip: Status | null;
  calibrating: boolean;
  age: ReadingAgeView | null;
}

const none: EntryValue = { reading: null, text: null, unit: null, chip: null, calibrating: false, age: null };
/** (Claude UI P2-9) an overnight entry before the night's aggregate exists: said, never a daytime stand-in. */
const NO_NIGHT: Status = { word: 'No overnight value', severity: 'info' };
const n0 = (v: number) => formatNumber(v, 0);

export function personal(b: GaugeBaselines | null): PersonalBaselines {
  return b ? { hrvBaseline: b.hrvBaseline, tempBaseline: b.tempBaseline, learning: b.learning } : null;
}

/** What a training load without a value waits on. */
const LOAD_WAITS: Record<NonNullable<RingLoad['missing']> | 'noHr', string> = {
  noWakingRest: 'Needs your resting heart rate (Settings › Heart rate)',
  sexUnknown: 'Needs your sex in Body',
  noHrMax: 'Needs your age or a maximum heart rate',
  noHr: 'No heart rate in your activities',
};

export function entryValue(id: string, c: MonitorCtx): EntryValue {
  const m = c.night?.metrics ?? null;
  const j = c.night?.joined ?? null;
  const learning = c.night?.learning ?? null;
  const calib: Status | null = learning ? { word: `Calibrating · night ${learning.nights} of ${learning.needed}`, severity: 'info' } : null;
  const latest = (kind: RingMetric): EntryValue => {
    const dm = c.daily?.metrics?.[kind];
    const l = dm && 'latest' in dm && dm.latest && 'value' in dm.latest ? dm.latest : null;
    if (!l || l.value == null) return none;
    const age = readingAge(l.at, dm?.medianGapS ?? null, c.now);
    const calibrating = (kind === 'hrv' || kind === 'temp') && !baselineReady(kind, personal(c.baselines));
    return { reading: l.value, text: valueText(kind, l.value, c.prefs), unit: unitOf(kind, c.prefs), chip: null, calibrating, age };
  };
  const d = c.daily?.derived;
  switch (id) {
    case 'hr':
    case 'spo2':
    case 'stress':
      return latest(id);
    // HRV and skin temperature are the night's values (`hrvNightlyMs`, `skinTempNightC`): S2's baselines are nightly, so
    // a daytime reading is never shown under the overnight label nor read against them (Codex UI #11). Until the night's
    // aggregate exists the entry has no value.
    case 'hrv': {
      if (m?.hrvNightlyMs == null) return { ...none, chip: NO_NIGHT };
      const pb = personal(c.baselines);
      return { ...none, reading: m.hrvNightlyMs, text: valueText('hrv', m.hrvNightlyMs, c.prefs), unit: 'ms', chip: usualStatus('hrv', j?.vsUsual, hrvUsualMs(pb)), calibrating: !baselineReady('hrv', pb) };
    }
    case 'temp': {
      if (m?.skinTempNightC == null) return { ...none, chip: NO_NIGHT };
      const pb = personal(c.baselines);
      return { ...none, reading: m.skinTempNightC, text: valueText('temp', m.skinTempNightC, c.prefs), unit: unitOf('temp', c.prefs), chip: usualStatus('temp', j?.vsUsual), calibrating: !baselineReady('temp', pb) };
    }
    case 'sleepLowHr': {
      if (m?.nightlyLowHrP10 == null) return none;
      const w = j?.vsUsual.lowHrWord;
      return { ...none, text: n0(m.nightlyLowHrP10), unit: 'bpm', chip: w ? { word: w, severity: w === 'Near usual' ? 'ok' : 'caution' } : calib, calibrating: !!learning };
    }
    case 'peakHr':
      return d?.peakHr ? { ...none, text: n0(d.peakHr.bpm), unit: 'bpm', chip: { word: `at ${clockOf(d.peakHr.at)}`, severity: 'info' } } : none;
    case 'avgWorkoutHr':
      return d?.avgWorkoutHr ? { ...none, text: n0(d.avgWorkoutHr.bpm), unit: 'bpm', chip: { word: `${minutesText(d.avgWorkoutHr.workoutS / 60)} recorded`, severity: 'info' } } : none;
    case 'nonExerciseHr':
      return d?.nonExerciseHr ? { ...none, text: n0(d.nonExerciseHr.median), unit: 'bpm', chip: { word: `${d.nonExerciseHr.n} readings`, severity: 'info' } } : none;
    case 'sleepDuration':
      return c.night ? { ...none, text: c.night.tstText, chip: j ? { word: j.vsGoal.text, severity: j.vsGoal.word === 'short' ? 'caution' : 'ok' } : null } : none;
    case 'fellAsleep':
      return m?.onset ? { ...none, text: clockOf(m.onset) } : none;
    case 'woke':
      return m?.finalWake ? { ...none, text: clockOf(m.finalWake) } : none;
    case 'midpoint':
      return m?.midpoint ? { ...none, text: clockOf(m.midpoint) } : none;
    case 'continuity': {
      // (r069) an incomplete night: its bounds, never a dash
      const c = continuityShown(m ?? null);
      return c ? { ...none, text: c.text, unit: '%', ...(c.range ? { chip: { word: 'Incomplete night', severity: 'info' as const } } : {}) } : none;
    }
    case 'restorative':
      return m?.restorativeEstimatedMin != null ? { ...none, text: minutesText(m.restorativeEstimatedMin), chip: { word: 'Estimated', severity: 'info' } } : none;
    case 'settle':
      return m?.leadingWakeMin != null ? { ...none, text: n0(m.leadingWakeMin), unit: 'min' } : none;
    case 'wakeUps':
      return m?.wakeUps != null ? { ...none, text: n0(m.wakeUps) } : none;
    case 'steps':
      return c.steps ? { ...none, text: n0(c.steps.value) } : none;
    case 'distance': {
      const dm = c.daily?.activity?.distanceM;
      if (dm == null) return none;
      const p = distanceParts(dm, c.prefs.units);
      // (0.6.3 FX5) a day the ring gave none: Health Connect's (one app), said so
      return { ...none, text: p.value, unit: p.unit, ...(c.daily?.activity?.distanceSource === 'healthConnect' ? { chip: { word: 'Health Connect', severity: 'info' as const } } : {}) };
    }
    case 'activeTime':
      return c.daily?.activity?.activeMinutes != null ? { ...none, text: n0(c.daily.activity.activeMinutes), unit: 'min' } : none;
    case 'zone13':
    case 'zone45': {
      if (!c.zones) return none;
      const s = id === 'zone13' ? c.zones.z13S : c.zones.z45S;
      const r = c.zones.toReview;
      const pend = r ? (id === 'zone13' ? r.z13S : r.z45S) : 0;
      return { ...none, text: n0(s / 60), unit: 'min', chip: { word: pend >= 30 ? `From counted activities · ${n0(pend / 60)} min not counted yet` : 'From counted activities', severity: 'info' } };
    }
    case 'activeEnergy':
    case 'totalEnergy': {
      const e = c.energy;
      const v = e ? (id === 'activeEnergy' ? e.activeKcal : e.totalKcal) : null;
      if (v === null || v === undefined) return none;
      const u = c.energyUnit ?? 'kcal';
      const what = id === 'activeEnergy' ? 'Above your resting burn' : 'Gross, the whole day';
      return { ...none, text: formatEnergy(v, u, { withUnit: false, step: u === 'kJ' ? 10 : 1 }), unit: u, chip: { word: e!.byBedtime ? `${what} · estimated by bedtime` : `${what} · estimated`, severity: 'info' } };
    }
    case 'trainingLoad': {
      const l = c.load;
      if (!l) return none;
      const m = l.load.method;
      const sum = m ? l.load.byMethod[m] : null;
      if (!m || !sum) return { ...none, chip: { word: LOAD_WAITS[l.missing ?? 'noHr'], severity: 'info' } };
      const method = m === 'trimp' ? 'TRIMP' : 'Session effort';
      const word = l.load.learning ? 'Learning your usual' : (sum.word ?? 'Learning your usual');
      return { ...none, text: n0(sum.dayLoad), unit: 'AU', chip: { word: `${method} · ${word}`, severity: sum.word === 'Above usual' ? 'caution' : 'info' } };
    }
    case 'dayScore': {
      const v = c.scores?.day.value;
      return typeof v === 'number' ? { ...none, text: n0(v), unit: '/ 100', chip: { word: sleepBand(v), severity: 'ok' } } : none;
    }
    default:
      return none;
  }
}

/** "58 bpm" for the Edit signals sheet row. */
export const entryText = (v: EntryValue): string | null => (v.text === null ? null : v.unit ? `${v.text} ${v.unit}` : v.text);
