/**
 * The realised schedule (docs/SUITE_SPEC.md §3.4-3.5): the plan version's engine `Schedule` with the days that already
 * happened replaced by what was done (`LoggedDay.inputs`, built by the living plan), so the replay simulates the logged
 * past and the prescribed future or an explicit scenario dose path. Pure.
 *
 * Each replaced day becomes its own program (identical templates share one), so overrides never merge with the
 * prescription's fields by accident. Fast events: the base schedule's events that START before `eventsReplacedBefore`
 * are dropped and the logged fasts (`events`) are added; later prescribed fasts stay unless a realised fast (resolved in
 * absolute time by the living plan's shared history, C2/D5-05) overlaps them: the realised one wins, never both.
 */
import type { DayTemplate, FastEvent, Schedule } from '../types/schedule';

export interface RealisedDay {
  /** Plan-day index. */
  day: number;
  /** What the engine should simulate for that day (logged inputs, or an explicit scenario dose path). */
  template: DayTemplate;
}

export interface RealisedScheduleInput {
  base: Schedule;
  days: readonly RealisedDay[];
  /** Logged/expected fasts of the replaced period (plan-day indices). */
  events?: readonly FastEvent[];
  /** Base events starting before this day are replaced by `events` (default: one past the last replaced day). */
  eventsReplacedBefore?: number;
  /** Extend (or cut) the horizon; extra days repeat the base's last week pattern. Default: base horizon. */
  horizonDays?: number;
}

/** Stable JSON (sorted keys) for de-duplicating identical templates. */
function stableKey(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableKey).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined && k !== 'id' && k !== 'label')
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableKey(o[k])}`)
    .join(',')}}`;
}

export function buildRealisedSchedule(i: RealisedScheduleInput): Schedule {
  const base = i.base;
  const H = Math.max(1, Math.floor(i.horizonDays ?? base.horizonDays));
  const programs: DayTemplate[] = base.programs.map((p) => p);
  const keyToIndex = new Map<string, number>();
  const days = Array.from({ length: H }, (_, d) => {
    if (d < base.days.length) return { ...base.days[d]! };
    // beyond the base horizon: repeat the last week of the base (habitual-like continuation)
    const src = base.days[Math.max(0, base.days.length - 7 + ((d - base.days.length) % 7))] ?? base.days[base.days.length - 1]!;
    return { program: src.program };
  });
  let lastReplaced = -1;
  for (const rd of [...i.days].sort((a, b) => a.day - b.day)) {
    if (rd.day < 0 || rd.day >= H) continue;
    const key = stableKey(rd.template);
    let idx = keyToIndex.get(key);
    if (idx === undefined) {
      idx = programs.length;
      programs.push({ ...rd.template, id: `realised-${idx}`, label: rd.template.label || 'as logged' });
      keyToIndex.set(key, idx);
    }
    days[rd.day] = { program: idx };
    if (rd.day > lastReplaced) lastReplaced = rd.day;
  }
  const cut = i.eventsReplacedBefore ?? lastReplaced + 1;
  const events: FastEvent[] = [];
  const realised = (i.events ?? []).filter((e) => e.startDay < H);
  const span = (e: FastEvent): [number, number] => [e.startDay * 24 + e.startH, e.startDay * 24 + e.startH + e.durationH];
  const overlapsRealised = (e: FastEvent): boolean => {
    const [a, b] = span(e);
    return realised.some((r) => {
      const [c, d] = span(r);
      return a < d && c < b;
    });
  };
  for (const e of base.events ?? []) if (e.kind === 'fast' && e.startDay >= cut && e.startDay < H && !overlapsRealised(e)) events.push(e);
  for (const e of realised) events.push(e);
  events.sort((a, b) => a.startDay - b.startDay || a.startH - b.startH);
  const blocks = base.blocks?.filter((b) => b.startDay < H).map((b) => ({ ...b, endDay: Math.min(b.endDay, H) }));
  return {
    ...base,
    horizonDays: H,
    programs,
    days,
    ...(blocks ? { blocks } : {}),
    events,
  };
}

// ------------------------------------------------------------------------------------------- observation sample times (D2-08, C4)
/**
 * Where on the replay's time axis an observation is sampled (C4/D2-08): an exact instant becomes plan day + fractional
 * local clock hour; an interval keeps its hour span; a date-only (or legacy, untimed) reading keeps its day and NO clock —
 * it is never compared with an hourly endpoint or an hourly mean as if its time were known.
 */
export interface ObservationSample {
  day: number;
  precision: 'instant' | 'interval' | 'dateOnly' | 'unknown';
  /** Local clock hour 0–24 of an exact instant. */
  hour?: number;
  /** Start/end hour (relative to `day`, may exceed 24) of an interval. */
  hourSpan?: readonly [number, number];
}

/** Structural occurrence (C1 `OccurrenceTime`): only the fields the sampler reads. */
export interface SampleOccurrence {
  precision: 'exact' | 'interval' | 'dateOnly' | 'unknown';
  at?: string;
  interval?: { start: string; end: string };
  date?: string;
}

const DAY_MS = 86_400_000;

/** Local calendar date and clock hour of an instant in `tz` (Intl; deterministic for the same inputs). */
function localParts(instant: string, tz: string): { date: string; hour: number } | null {
  const t = Date.parse(instant);
  if (!Number.isFinite(t)) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t));
    const get = (k: string): string => parts.find((p) => p.type === k)?.value ?? '00';
    return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) + Number(get('minute')) / 60 + Number(get('second')) / 3600 };
  } catch {
    return null;
  }
}

const dayIndex = (start: string, date: string): number => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS);

/** Sample time of one observation relative to the schedule start (see `ObservationSample`). */
export function observationSampleTime(scheduleStartDate: string, entryDate: string, occurrence: SampleOccurrence | undefined, tz: string): ObservationSample {
  if (occurrence?.precision === 'exact' && occurrence.at) {
    const p = localParts(occurrence.at, tz);
    if (p) return { day: dayIndex(scheduleStartDate, p.date), precision: 'instant', hour: p.hour };
  }
  if (occurrence?.precision === 'interval' && occurrence.interval) {
    const a = localParts(occurrence.interval.start, tz);
    const b = localParts(occurrence.interval.end, tz);
    if (a && b) {
      const day = dayIndex(scheduleStartDate, a.date);
      return { day, precision: 'interval', hourSpan: [a.hour, b.hour + 24 * (dayIndex(scheduleStartDate, b.date) - day)] };
    }
  }
  const date = occurrence?.date ?? entryDate;
  return { day: dayIndex(scheduleStartDate, date), precision: occurrence?.precision === 'unknown' && !occurrence.date ? 'unknown' : 'dateOnly' };
}

/** Structural ketone reading (the living `MeasurementEntry` fields the sampler needs). */
export interface KetoneReading {
  id: string;
  date: string;
  value: number;
  specimen?: 'capillaryBlood' | 'venousBlood' | 'urine' | 'breath';
  occurrence?: SampleOccurrence;
}

/**
 * (D2-08) Ketone readings placed on the replay's time axis with their observation semantics: blood D-BHB with a known
 * instant compares with the model's ENDPOINT concentration at that instant (`point`); a blood reading without a time
 * compares with nothing finer than its day (`day`); urine or breath readings (or an unstated specimen) are kept but have no
 * blood-BHB operator (`none`): they are never converted into mmol/L blood D-BHB.
 */
export function ketoneSamples(scheduleStartDate: string, readings: readonly KetoneReading[], tz: string): Array<{ id: string; value: number; sample: ObservationSample; operator: 'bhbEndpoint' | null; comparable: 'point' | 'day' | 'none' }> {
  return readings
    .filter((r) => Number.isFinite(r.value))
    .map((r) => {
      const blood = r.specimen === 'capillaryBlood' || r.specimen === 'venousBlood';
      const sample = observationSampleTime(scheduleStartDate, r.date, r.occurrence, tz);
      const comparable: 'point' | 'day' | 'none' = !blood ? 'none' : sample.precision === 'instant' ? 'point' : 'day';
      return { id: r.id, value: r.value, sample, operator: blood ? ('bhbEndpoint' as const) : null, comparable };
    })
    .sort((a, b) => a.sample.day - b.sample.day || (a.sample.hour ?? 0) - (b.sample.hour ?? 0) || (a.id < b.id ? -1 : 1));
}
