/**
 * Today from your ring (design/screens/ring-pages.md §5.4): the rows, their readouts and secondary lines, from the
 * resolved days (corrections win, SUITE_SPEC §14.6), the person's normals and the newest heart-rate reading. Pure: the
 * time and every input are arguments.
 *
 * Rules: sleep uses the reference night (§7.1), everything else the calendar day; a missing value keeps its row and
 * says "no data yet today" ("reading…" while the ring is connected and not read yet today); missing is never zero; a
 * row whose newest sample is over 3 h old ends its secondary line with the age; tier C signals (heart-rate variability,
 * blood oxygen, skin temperature) lead with the change from the person's normal once it has formed; the ring's own
 * scores appear only when vendor scores are on, as "(their estimate)", always last.
 */
import { formatNumber, formatSigned, THIN_SPACE } from '@/components/lib/format';
import type { DailyRecord, ResolvedDay, SleepRecord } from '@/biometrics/core/types';
import type { LocalDate } from '@/living';
import { spo2Normal } from '@/features/signals/charts/heartModels';
import { clockAt, localOffsetS, nightDates, nightModel } from '@/features/signals/charts/ringData';
import { referenceDay, signalsHref, type SignalsTab } from '@/features/signals/models';
import type { SignalBaseline, SignalsPerson } from '@/features/signals/data';
import type { RingCaps } from './data';
import { RING_SECTIONS_COPY } from './copySections';

const C = RING_SECTIONS_COPY.today;
const HOUR = 3_600_000;
/** A row's newest sample older than this gets its age appended (§5.4 freshness). */
export const FRESH_MS = 3 * HOUR;

export type TodayRowId = 'sleep' | 'heart' | 'hrv' | 'spo2' | 'skin_temp' | 'activity' | 'vendor';
export type RingMeasure = NonNullable<RingCaps['measures']>[number];

export interface TodayMeter {
  key: 'steps' | 'activeMin' | 'activeKcal';
  label: string;
  value: number | null;
  goal?: number;
  unit: string;
}

export interface TodayRow {
  id: TodayRowId;
  /** Engraved, lowercase. */
  label: string;
  /** Its Body signals tab at period=day. */
  href: string;
  /** The readout; null when the row is missing or shows meters. */
  readout: string | null;
  /** "no data yet today" / "reading…" / a more precise line; null when there is a value. */
  missing: string | null;
  /** 13 px ink-2 line under the row; ends with the age when stale. */
  secondary: string | null;
  /** Activity: the three mini goal meters (steps, active minutes, active energy). */
  meters?: TodayMeter[];
}

export interface HeartReading {
  bpm: number;
  /** ms */
  at: number;
}

export interface TodayInput {
  today: LocalDate;
  /** ms */
  now: number;
  /** Resolved days around today (the last ~3, so the reference night is found), any order. */
  days: readonly ResolvedDay[];
  /** null while loading. */
  baselines: readonly SignalBaseline[] | null;
  person: SignalsPerson;
  /** Signals the ring measures (`RingCaps.measures`); undefined = all. */
  measures?: readonly RingMeasure[];
  /** Live heart rate while the page is visible and the ring connected. */
  live: HeartReading | null;
  /** Newest heart-rate sample today (when not live). */
  lastHr: HeartReading | null;
  /** Newest steps sample today (ms), for the activity row's freshness. */
  stepsNewestAt: number | null;
  /** The ring is connected and has not been read yet today: missing rows say "reading…". */
  reading: boolean;
}

/* ------------------------------------------------------------------------------------------------ formatting */

/** "7 h 12 min", "45 min", "8 h". */
export function fmtDuration(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  const T = THIN_SPACE;
  if (h === 0) return `${r}${T}min`;
  return r === 0 ? `${h}${T}h` : `${h}${T}h ${r}${T}min`;
}

/** HH:MM of an instant in the browser's zone. */
export const clockOf = (t: number): string => clockAt(t, localOffsetS(t));

/** "4 h ago", "yesterday", "3 days ago"; null when the sample is fresh (≤ 3 h). */
export function ageText(now: number, t: number): string | null {
  const d = now - t;
  if (!(d > FRESH_MS)) return null;
  if (d < 24 * HOUR) return C.ago.hours(Math.floor(d / HOUR));
  if (d < 48 * HOUR) return C.ago.yesterday;
  return C.ago.days(Math.floor(d / (24 * HOUR)));
}

const withAge = (line: string | null, now: number, t: number | null): string | null => {
  const age = t === null ? null : ageText(now, t);
  if (!age) return line;
  return line ? `${line} · ${age}` : age;
};

const n0 = (v: number) => formatNumber(v, 0);
const join = (...parts: Array<string | null | undefined | false>) => parts.filter(Boolean).join(' · ') || null;

/* ------------------------------------------------------------------------------------------------ rows */

const MEASURE_OF: Record<Exclude<TodayRowId, 'vendor'>, RingMeasure> = {
  sleep: 'sleep', heart: 'hr', hrv: 'hrv', spo2: 'spo2', skin_temp: 'skin_temp', activity: 'activity',
};
const TAB_OF: Record<TodayRowId, SignalsTab> = {
  sleep: 'sleep', heart: 'heart', hrv: 'heart', spo2: 'heart', skin_temp: 'heart', activity: 'activity', vendor: 'heart',
};

const hrefOf = (id: TodayRowId) => signalsHref({ tab: TAB_OF[id], period: 'day' });

function baselineOf(list: readonly SignalBaseline[] | null, metric: string): SignalBaseline | null {
  return list?.find((b) => b.metric === metric) ?? null;
}

/** Every row the ring measures, in the §5.4 order; "your ring says" last when vendor scores are on. */
export function todayRows(input: TodayInput): TodayRow[] {
  const { today, now, days, baselines, person, measures, live, lastHr, stepsNewestAt, reading } = input;
  const byDate = new Map(days.map((d) => [d.localDate, d]));
  const day = byDate.get(today);
  const daily: DailyRecord | undefined = day?.daily;
  const todaySleep: SleepRecord | undefined = day?.mainSleep;
  const missingWord = reading ? C.reading : C.noData;
  const measured = (id: Exclude<TodayRowId, 'vendor'>) => !measures || measures.includes(MEASURE_OF[id]);
  const rows: TodayRow[] = [];
  const row = (id: TodayRowId, r: Omit<TodayRow, 'id' | 'label' | 'href'>) => rows.push({ id, label: C.label[id], href: hrefOf(id), ...r });
  const missing = (id: TodayRowId, secondary: string | null = null, word: string = missingWord) => row(id, { readout: null, missing: word, secondary });

  // sleep: the reference night (wake date of the newest main night ≤ today)
  const refDate = referenceDay('sleep', today, nightDates([...days]));
  const refDay = byDate.get(refDate);
  if (measured('sleep')) {
    const night = refDay?.mainSleep ? nightModel(refDay.mainSleep) : null;
    if (!night) missing('sleep');
    else {
      const unknown = night.minutes.unknown;
      const line = join(C.inBed(clockAt(night.start, night.offsetS), clockAt(night.end, night.offsetS)), unknown > 0 && C.unknown(fmtDuration(unknown)));
      row('sleep', { readout: C.asleep(fmtDuration(night.asleepMin)), missing: null, secondary: withAge(line, now, refDate < today ? night.end : null) });
    }
  }

  // heart: resting for the day; now (live) or the last reading with its time
  if (measured('heart')) {
    const hrLine = live ? C.now(n0(live.bpm), clockOf(live.at)) : lastHr ? withAge(C.lastReading(n0(lastHr.bpm), clockOf(lastHr.at)), now, lastHr.at) : null;
    const rest = daily?.resting_hr_bpm;
    if (typeof rest === 'number') row('heart', { readout: C.resting(n0(rest)), missing: null, secondary: hrLine });
    else if (hrLine) missing('heart', hrLine, C.restingMissing);
    else missing('heart');
  }

  // heart-rate variability (tier C): change from the normal once it has formed, then last night's value
  if (measured('hrv')) {
    const hrv = daily?.hrv;
    if (!hrv) missing('hrv');
    else {
      const base = baselineOf(baselines, 'hrv_rmssd_ms');
      const normal = base && !base.forming && hrv.metric === 'rmssd' ? base : null;
      const value = C.valueLastNight(n0(hrv.value_ms), 'ms');
      if (normal) row('hrv', { readout: C.fromNormal(formatSigned(hrv.value_ms - normal.mean, 0), 'ms'), missing: null, secondary: join(value, C.tierC) });
      else row('hrv', { readout: value, missing: null, secondary: join(base?.forming && hrv.metric === 'rmssd' && C.forming(base.nights), C.tierC) });
    }
  }

  // blood oxygen (tier C): the night's average as change from the normal once it has formed, else the average itself
  if (measured('spo2')) {
    const avg = daily?.spo2_avg_pct ?? todaySleep?.night?.spo2_avg_pct;
    if (typeof avg !== 'number') missing('spo2');
    else {
      const normal = spo2Normal(baselines, []);
      if (normal && !normal.forming) row('spo2', { readout: C.spo2FromNormal(formatSigned(avg - normal.mean, 0)), missing: null, secondary: join(C.lastNight, C.tierC) });
      else row('spo2', { readout: C.spo2Night(n0(avg)), missing: null, secondary: join(normal?.forming && C.forming(normal.nights), C.tierC) });
    }
  }

  // skin temperature (tier C): change from the normal
  if (measured('skin_temp')) {
    const f = person.tempUnit === 'F';
    const unit = f ? '°F' : '°C';
    const dScale = (c: number) => (f ? (c * 9) / 5 : c);
    const delta = daily?.skin_temp_delta_c ?? todaySleep?.night?.skin_temp_delta_c;
    const abs = daily?.skin_temp_c;
    const base = baselineOf(baselines, 'skin_temp_delta_c');
    const normal = base && !base.forming ? base : null;
    const sub = join(C.lastNight, base?.forming && C.forming(base.nights));
    if (typeof delta === 'number' && normal) row('skin_temp', { readout: C.fromNormal(formatSigned(dScale(delta - normal.mean), 1), unit), missing: null, secondary: sub });
    else if (typeof delta === 'number') row('skin_temp', { readout: `${formatSigned(dScale(delta), 1)}${THIN_SPACE}${unit}`, missing: null, secondary: sub });
    else if (typeof abs === 'number') row('skin_temp', { readout: `${formatNumber(f ? (abs * 9) / 5 + 32 : abs, 1)}${THIN_SPACE}${unit}`, missing: null, secondary: sub });
    else missing('skin_temp');
  }

  // activity: three mini goal meters + one line
  if (measured('activity')) {
    const steps = typeof daily?.steps === 'number' ? daily.steps : null;
    const am = daily?.active_min;
    const activeMin = am ? Math.round(am.light + am.moderate + am.vigorous) : null;
    const kcal = typeof daily?.active_kcal === 'number' ? Math.round(daily.active_kcal) : null;
    if (steps === null && activeMin === null && kcal === null) missing('activity');
    else {
      const g = person.goals;
      const meters: TodayMeter[] = [
        { key: 'steps', label: C.meter.steps, value: steps, ...(g.steps ? { goal: g.steps } : {}), unit: C.meterUnit.steps },
        { key: 'activeMin', label: C.meter.activeMin, value: activeMin, ...(g.activeMin ? { goal: g.activeMin } : {}), unit: C.meterUnit.activeMin },
        { key: 'activeKcal', label: C.meter.activeKcal, value: kcal, ...(g.activeKcal ? { goal: g.activeKcal } : {}), unit: C.meterUnit.activeKcal },
      ];
      const line = join(steps !== null && C.steps(n0(steps)), activeMin !== null && C.activeMin(n0(activeMin)), kcal !== null && C.kcal(n0(kcal)));
      row('activity', { readout: null, missing: null, secondary: withAge(line, now, stepsNewestAt), meters });
    }
  }

  // the ring's own scores: only when vendor scores are on, never on top
  if (person.vendorScores) {
    const sleepScore = refDay?.daily?.vendor?.sleep ?? daily?.vendor?.sleep;
    const stress = !measures || measures.includes('stress') ? daily?.vendor?.stress?.value : undefined;
    const text = join(typeof sleepScore === 'number' && C.sleepScore(n0(sleepScore)), typeof stress === 'number' && C.stress(n0(stress)));
    if (text) row('vendor', { readout: text, missing: null, secondary: C.theirEstimate });
  }
  return rows;
}
