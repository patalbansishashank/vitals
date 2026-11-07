/**
 * (r063 FX2, final review sR05/aR06) Gauge's exact HR segments for the day's Heart Points: the raw readings with each
 * one's `hr-support/1` interval (S2 `hr-intervals`), so a minute of 30 s at 110 bpm and 30 s at 150 counts as those two
 * halves, as the bout's own points count it, not as one minute at 130.
 *
 * Only the span of the day's minutes where exact HR can change the points is asked for: supported Gauge HR (not a Health
 * Connect minute: `hr-intervals` holds Gauge's readings only) in a minute that is eligible at all (inside an approved
 * bout's moving parts, or with supported locomotion, cadence ≥ 60, §V2.3). A day without such a minute asks nothing.
 * An answer stands only when it is complete and covers the span; otherwise the day keeps its minute means (null), and a
 * failed read never keeps an older answer. Answers expire like the timelines' and are dropped on a pairing change or an
 * import.
 */
import { gaugeApi, type GaugeHrIntervals } from '@/net/gauge';
import { onGaugeDataChanged, onGaugeIdentityChange } from '@/net/gaugeIdentity';
import { isOtherHrSource, segmentsFromHrIntervals, sp, type HrSegment, type Interval, type Ms } from '@/living/sensors';
import type { TimelineMinute } from './timelines';

export type HrIntervalsSource = (from: string, to: string) => Promise<GaugeHrIntervals | null>;

const defaultSource: HrIntervalsSource = (from, to) => (gaugeApi.hrIntervals ? gaugeApi.hrIntervals(from, to).catch(() => null) : Promise.resolve(null));
let source: HrIntervalsSource = defaultSource;

/** A recent span (it ends within two days of now) is asked again after this long; older ones after half an hour (P). */
const RECENT_TTL_MS = 5 * 60_000;
const PAST_TTL_MS = 30 * 60_000;
/** A span the server could not answer is asked again after this long (its answer is null meanwhile, never an old one). */
const NULL_RETRY_MS = 60_000;
const CONCURRENCY = 4;

const cache = new Map<string, { until: number; value: HrSegment[] | null }>();
let gen = 0;

export function clearHrExact(): void {
  cache.clear();
  gen++;
}

/** Tests: read `hr-intervals` from here (null restores the server). Drops the cache. */
export function setHrExactSource(s: HrIntervalsSource | null): void {
  source = s ?? defaultSource;
  clearHrExact();
}

onGaugeIdentityChange(() => clearHrExact());
onGaugeDataChanged(() => {
  const since = Date.now() - 3 * 86_400_000;
  for (const [k, hit] of cache) if (Number(k.split('|')[1]) >= since || hit.value === null) cache.delete(k);
});

/**
 * The span of [start, end) whose minutes can earn on exact HR: Gauge-supported HR in a minute inside one of `parts` (the
 * approved bouts' moving parts) or with supported locomotion. Null when there is none.
 */
export function hrExactSpan(i: { start: Ms; end: Ms; minuteAt: (t: Ms) => TimelineMinute | undefined; parts: readonly Interval[] }): Interval | null {
  let lo: number | null = null;
  let hi: number | null = null;
  const moving = sp('hrEligibleCadence');
  for (let t = i.start; t < i.end; t += 60_000) {
    const m = i.minuteAt(t);
    if (!m?.hr || isOtherHrSource(m.hr.source)) continue;
    const loco = m.support === 'minute' && m.steps !== null && m.steps >= moving;
    if (!loco && !i.parts.some((p) => p.start < t + 60_000 && p.end > t)) continue;
    lo ??= t;
    hi = Math.min(t + 60_000, i.end);
  }
  return lo !== null && hi !== null && hi > lo ? { start: lo, end: hi } : null;
}

/** The exact segments of one span, clipped to it; null when the answer cannot stand for it. */
async function readSpan(span: Interval, now: number): Promise<HrSegment[] | null> {
  const key = `${span.start}|${span.end}`;
  const hit = cache.get(key);
  if (hit && now < hit.until) return hit.value;
  const g = gen;
  // a minute either side: a reading's support reaches up to 30 s past its own minute
  const r = await source(new Date(span.start - 60_000).toISOString(), new Date(span.end + 60_000).toISOString()).catch(() => null);
  let value: HrSegment[] | null = null;
  if (r && !r.truncated && Array.isArray(r.intervals) && Date.parse(r.from) <= span.start && Date.parse(r.to) >= span.end) {
    value = segmentsFromHrIntervals(r.intervals).flatMap((s) => {
      const a = Math.max(s.start, span.start);
      const b = Math.min(s.end, span.end);
      return b > a ? [{ start: a, end: b, bpm: s.bpm }] : [];
    });
  }
  if (g === gen) cache.set(key, { until: now + (value === null ? NULL_RETRY_MS : span.end > now - 2 * 86_400_000 ? RECENT_TTL_MS : PAST_TTL_MS), value });
  return value;
}

/** The exact segments of each keyed span (null span: nothing asked), at most `CONCURRENCY` reads at once. */
export async function hrExactFor<K>(spans: ReadonlyArray<{ key: K; span: Interval | null }>, now: number = Date.now()): Promise<Map<K, HrSegment[] | null>> {
  const out = new Map<K, HrSegment[] | null>();
  const ask = spans.filter((s) => s.span !== null);
  for (const s of spans) if (s.span === null) out.set(s.key, null);
  let next = 0;
  const worker = async () => {
    while (next < ask.length) {
      const s = ask[next++]!;
      out.set(s.key, await readSpan(s.span!, now));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ask.length) }, worker));
  return out;
}

/** A cheap signature of a day's exact segments (the day memo's key). */
export function hrExactSignature(x: readonly HrSegment[] | null | undefined): string {
  if (!x) return '-';
  let ms = 0;
  let sum = 0;
  for (const g of x) {
    ms += g.end - g.start;
    sum += (g.end - g.start) * g.bpm;
  }
  return `${x.length}:${ms}:${Math.round(sum)}`;
}
