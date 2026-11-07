/**
 * The fused minute timelines (S2 `timeline?date`, energy SPEC §2.2) that Progress's Heart Points and energy allocation and
 * the HRmax suggestion's evidence read, one cached answer per local date. Today and yesterday are asked again after a few
 * minutes because the ring is still uploading them; older days after half an hour (r063 S27/A29: a late correction shows
 * without a reload). A new fusion context (r063 S6: approved bouts, corrections, step settings) drops them all. A date
 * the server cannot answer is null (no coverage, never zeros) and is asked again after a minute.
 *
 * (0.6.3 FX1, sR15) A refused read (401/403, not paired) is not an offline one: every day kept is dropped, never shown
 * again from before the refusal.
 */
import { gaugeApi, onFusionContextChange, type GaugeProblem, type GaugeTimeline } from '@/net/gauge';
import { onGaugeDataChanged, onGaugeIdentityChange } from '@/net/gaugeIdentity';
import { addDays, compareDates, localToInstant } from '@/living/dates';
import type { LocalDate } from '@/living';
import type { Ms } from '@/living/sensors';

export type TimelineSource = (date: LocalDate) => Promise<GaugeTimeline | null>;

const defaultSource: TimelineSource = (date) => (gaugeApi.timeline ? gaugeApi.timeline(date).catch(() => null) : Promise.resolve(null));
let source: TimelineSource = defaultSource;
/** (FX1) Why the source's last read got nothing (the Gauge client's status by default). */
export type TimelineProblem = () => GaugeProblem | null;
const defaultProblem: TimelineProblem = () => {
  try {
    return gaugeApi.status().problem;
  } catch {
    return null;
  }
};
let problemOf: TimelineProblem = defaultProblem;
const refused = (p: GaugeProblem | null) => p === 'unauthorized' || p === 'not_paired';

/** Recent dates are asked again after this long (P). */
const RECENT_TTL_MS = 5 * 60_000;
/** (r063 S27/A29) Older dates too, less often: a late correction or upload on the server shows without a reload (P). */
const PAST_TTL_MS = 30 * 60_000;
/** (r063 S27/A29) A date the server could not answer (null) is asked again after this long, never kept for the session. */
const NULL_RETRY_MS = 60_000;
/** At most this many requests at once. */
const CONCURRENCY = 6;

/** Each date's answer and until when it stands (r063 S27/A29: every answer expires). */
const cache = new Map<LocalDate, { until: number; value: GaugeTimeline | null }>();
const inflight = new Map<LocalDate, Promise<GaugeTimeline | null>>();

/**
 * Tests and the screenshot harness: read timelines from here (null restores the server), with why a read got nothing
 * (`problem`; default: never refused for a custom source, the Gauge client's status for the server). Drops the cache.
 */
export function setTimelineSource(s: TimelineSource | null, problem?: TimelineProblem): void {
  source = s ?? defaultSource;
  problemOf = problem ?? (s ? () => null : defaultProblem);
  clearTimelines();
}

/** Bumped when the cache is dropped: an answer for an older generation is not kept. */
let gen = 0;

export function clearTimelines(): void {
  cache.clear();
  inflight.clear();
  gen++;
}

// (r063 S6) a new fusion context on the server changes every fused minute: the past days' cache is dropped too
onFusionContextChange(() => clearTimelines());
// (0.6.3 A30) another server or person (or an unpairing) holds other minutes: nothing kept before stands
onGaugeIdentityChange(() => clearTimelines());
// (0.6.3 S28) an import brought new minutes: the recent dates are asked again on the next read
onGaugeDataChanged(() => {
  const t = new Date(Date.now() - 3 * 86_400_000);
  const since = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  for (const [d, hit] of cache) if (d >= since || hit.value === null) cache.delete(d);
});

function fresh(date: LocalDate, now: number): boolean {
  const hit = cache.get(date);
  return !!hit && now < hit.until;
}

const ttlOf = (date: LocalDate, today: LocalDate) => (compareDates(date, addDays(today, -1)) < 0 ? PAST_TTL_MS : RECENT_TTL_MS);

/** The timelines of `dates` (deduplicated; future dates are null without a request). */
export async function timelinesFor(dates: readonly LocalDate[], today: LocalDate, now: number = Date.now()): Promise<Map<LocalDate, GaugeTimeline | null>> {
  const want = [...new Set(dates)];
  const ask = want.filter((d) => compareDates(d, today) <= 0 && !fresh(d, now));
  let next = 0;
  const worker = async () => {
    while (next < ask.length) {
      const d = ask[next++]!;
      let p = inflight.get(d);
      if (!p) {
        const g = gen;
        p = source(d)
          .catch(() => null)
          .then((v) => {
            if (g !== gen) return v ?? null;
            if (!v && refused(problemOf())) {
              // (FX1, sR15) refused: nothing kept from before stands (this day and every other)
              clearTimelines();
              cache.set(d, { until: now + NULL_RETRY_MS, value: null });
              return null;
            }
            const prev = cache.get(d)?.value ?? null;
            // a failed re-read keeps the day it had (and is asked again after the short wait)
            const t = now;
            cache.set(d, v ? { until: t + ttlOf(d, today), value: v } : { until: t + NULL_RETRY_MS, value: prev });
            inflight.delete(d);
            return v ?? prev;
          });
        inflight.set(d, p);
      }
      await p;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ask.length) }, worker));
  return new Map(want.map((d) => [d, cache.get(d)?.value ?? null] as const));
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
