/**
 * The fused minute timelines (S2 `timeline?date`, energy SPEC §2.2) that Progress's Heart Points and energy allocation, the
 * HRmax suggestion's evidence and the Ring's training load read: one kept answer per local date, shared by every screen
 * that needs the day (`./dayStore.ts` holds the rules). Today and yesterday are asked again after a few minutes and when
 * new data is announced, because the ring is still uploading them; an older day is kept for hours and then asked again a
 * couple at a time (r063 S27/A29: a late correction still shows without a reload; r087 C3: never as a burst of requests).
 * A new fusion context (r063 S6: approved bouts, corrections, step settings) drops them all. A date the server cannot
 * answer is null (no coverage, never zeros) and is asked again after a wait that grows with each failure.
 *
 * (0.6.3 FX1, sR15) A refused read (401/403, not paired) is not an offline one: every day kept is dropped, never shown
 * again from before the refusal.
 */
import type { GaugeProblem, GaugeTimeline } from '@/net/gauge';
import { localToInstant } from '@/living/dates';
import type { LocalDate } from '@/living';
import type { Ms } from '@/living/sensors';
import { createDayStore, type DayStore } from './dayStore';

export type TimelineSource = (date: LocalDate) => Promise<GaugeTimeline | null>;
/** (FX1) Why the source's last read got nothing (the Gauge client's status by default). */
export type TimelineProblem = () => GaugeProblem | null;

/** The days' timelines, one store for every reader. */
export const timelineDays: DayStore<GaugeTimeline> = createDayStore<GaugeTimeline>({
  read: (api, date) => (api.timeline ? api.timeline(date) : Promise.resolve(null)),
  signature: (t) => timelineSignature(t),
});

/**
 * Tests and the screenshot harness: read timelines from here (null restores the server), with why a read got nothing
 * (`problem`; default: never refused for a custom source, the read's own status for the server). Drops the cache.
 */
export function setTimelineSource(s: TimelineSource | null, problem?: TimelineProblem): void {
  timelineDays.setSource(s, problem);
}

export function clearTimelines(): void {
  timelineDays.clear();
}

/**
 * The timelines of `dates` (deduplicated; future dates are null without a request). Waits for the days not held yet and
 * for today's and yesterday's when they are due; an older day past its keep time answers what is held and is asked
 * again in the background (`onTimelinesChanged` tells when it changed). `reader` names who asks (a screen's window), for
 * the turns of the shared queue.
 */
export function timelinesFor(dates: readonly LocalDate[], today: LocalDate, now: number = Date.now(), reader?: string): Promise<Map<LocalDate, GaugeTimeline | null>> {
  return timelineDays.load(dates, today, now, reader);
}

/** Hear when a day that had an answer got another one (the day's date). */
export function onTimelinesChanged(listener: (date: LocalDate) => void): () => void {
  return timelineDays.onChange(listener);
}

/* ---- one minute of the fused timeline, by absolute time ------------------------------------------------------------ */

export interface TimelineMinute {
  /** `asleep` a known sleep stage; `awake` a known awake label; `unknownLabel` an unknown label; `none` no sleep record. */
  sleep: 'asleep' | 'awake' | 'unknownLabel' | 'none';
  /** Selected fused steps; null = no coverage. */
  steps: number | null;
  support: 'minute' | 'coarse' | null;
  /**
   * Supported HR of the minute (`hr-support/1`); null = none. `source` (r063 FX2): the origin the server took it from
   * (`gauge`, or `hc:<package>` for a Health Connect minute); absent from an older server (= Gauge's).
   */
  hr: { bpm: number; supportedS: number; source?: string | null } | null;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The first minute's UTC start of a timeline (its `start`, else local midnight of its date in its zone). */
export function timelineStart(t: GaugeTimeline, tz: string): Ms {
  const s = t.start ? Date.parse(t.start) : Number.NaN;
  return Number.isFinite(s) ? s : Date.parse(localToInstant(t.date, 0, t.tz || tz));
}

/** A lookup of the minute holding an instant over several timelines (undefined: no timeline covers it). */
export function minuteIndex(timelines: readonly (GaugeTimeline | null | undefined)[], tz: string): (t: Ms) => TimelineMinute | undefined {
  const spans = timelines.filter((x): x is GaugeTimeline => !!x).map((t) => ({ t, first: timelineStart(t, tz) }));
  return (ms) => {
    for (const { t, first } of spans) {
      const k = Math.floor((ms - first) / 60_000);
      if (k < 0 || k >= t.minutes) continue;
      const stage = t.sleep?.stage?.[k] ?? null;
      const steps = t.steps?.selected?.[k];
      const sup = t.steps?.support?.[k] ?? null;
      const bpm = t.hr?.bpm?.[k];
      const s = t.hr?.supportedS?.[k];
      const src = Array.isArray(t.hr?.source) ? t.hr.source[k] : undefined;
      return {
        sleep: stage === null ? 'none' : stage === 'awake' ? 'awake' : stage === 'unknown' ? 'unknownLabel' : 'asleep',
        steps: isNum(steps) ? steps : null,
        support: !isNum(steps) ? null : sup === 'minute' ? 'minute' : 'coarse',
        hr: isNum(bpm) && isNum(s) && s > 0 ? { bpm, supportedS: s, ...(typeof src === 'string' ? { source: src } : {}) } : null,
      };
    }
    return undefined;
  };
}

/** A cheap signature of a timeline's content (its inputs hash when the server sends one). */
export function timelineSignature(t: GaugeTimeline | null | undefined): string {
  if (!t) return '-';
  if (t.inputsHash) return t.inputsHash;
  let steps = 0;
  let hr = 0;
  for (const v of t.steps?.selected ?? []) if (isNum(v)) steps += v;
  for (const v of t.hr?.supportedS ?? []) if (isNum(v)) hr += v;
  return `${t.minutes}:${steps}:${hr}`;
}
