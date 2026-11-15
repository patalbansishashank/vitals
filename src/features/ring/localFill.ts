/**
 * (r069 sync) What Gauge on this phone knows that the server does not have yet, and how it meets the server's answers.
 *
 * The server stays the one source of every fused and derived figure. Gauge's local snapshot (`@/platform/gaugeLocal`,
 * read by `@/state/gaugePulse`) only fills in, and each rule supersedes itself once the server catches up:
 *
 * - "Gauge sent": the newest of the server's last upload (availability), the pulse's and Gauge's own record. Times
 *   only, so nothing can be counted twice.
 * - Readings waiting on the phone: only Gauge knows its queue; shown while its snapshot is recent.
 * - Today's steps: the server's D3 headline is `max(located, ringDailyTotal)` (`atLeast`). When Gauge's ring count for
 *   today is above the ring total the server used, the server has not had the ring's newest total yet: the headline is
 *   that same rule with the newer total, marked `provisional`. When the server's ring total reaches Gauge's (the upload
 *   landed) the server's headline is shown as it is. Never a sum, so a step is never counted twice; never under a
 *   `located` headline (the ring's day total is not placed in time).
 * - (r087) The latest heart rate: with the ring engine in this app, its newest reading reaches the screen with the
 *   engine's `state` event, before the upload and the server's answer. It stands in for the day's `latest` (and as the
 *   last point of the day's series) only while it is newer than the one the server answered with; the day's count,
 *   mean, lowest and highest stay the server's. Heart rate surfaces read it through `useLocalHeartRate`, so they
 *   agree.
 */
import { useMemo, useSyncExternalStore } from 'react';
import type { GaugeLocalSnapshot } from '@/platform/gaugeLocal';
import { engineLocalSnapshot, useGaugeEngine, type LocalHeartRate } from '@/state/gaugeEngine';
import { gaugeLive, onGaugeLive, type GaugeLive } from '@/state/gaugePulse';
import type { StepsHeadline } from './day';
import { calendarDate } from './model';
import type { GaugeDaily, GaugeRawPoint, GaugeStepDay, GaugeValueMetric } from './types';

/** A local snapshot older than this says nothing about the queue now. */
export const LOCAL_FRESH_MS = 5 * 60_000;

/** The phone's local snapshot as the Ring screens read it: Gauge's, and the engine's newest heart rate when it sends one. */
export type RingLocal = GaugeLocalSnapshot & { latestHr?: LocalHeartRate | null };

export interface RingLive extends GaugeLive {
  local: RingLocal | null;
}

/**
 * The live pulse and the phone's local snapshot, re-read when either changes. (r070) With the ring engine active its own
 * state is the local snapshot, live (no 60 s read): "Gauge sent hh:mm" is the engine's `upload.lastSentAt`, and (r087)
 * today's ring steps and the newest heart rate are the engine's own.
 */
export function useGaugeLive(): RingLive {
  const live = useSyncExternalStore(onGaugeLive, gaugeLive, gaugeLive);
  const eng = useGaugeEngine();
  return useMemo(() => {
    const local = engineLocalSnapshot(eng);
    // the engine pushes every change, so its state is never "old": it always counts as fresh
    return local ? { ...live, local, localAt: Number.MAX_SAFE_INTEGER } : live;
  }, [live, eng]);
}

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** When Gauge last sent (ISO): the newest of the server's record, the pulse's and Gauge's own; null when none. */
export function lastSentOf(server: string | null | undefined, live: Pick<GaugeLive, 'pulse' | 'local'>): string | null {
  let best: { at: number; iso: string } | null = null;
  for (const iso of [server, live.pulse?.lastUploadAt, live.local?.upload.lastSentAt]) {
    const at = ms(iso);
    if (at !== null && iso && (!best || at > best.at)) best = { at, iso };
  }
  return best?.iso ?? null;
}

/** Readings Gauge holds on this phone, not yet on the server (0 without a recent snapshot). */
export function waitingOf(live: Pick<GaugeLive, 'local' | 'localAt'>, now: number): number {
  if (!live.local || live.localAt === null || now - live.localAt > LOCAL_FRESH_MS) return 0;
  return live.local.upload.paired ? live.local.upload.pending : 0;
}

/**
 * Today's steps headline with Gauge's newer ring count (see the file comment): the server's headline, or a provisional
 * one when the phone's ring total is ahead of the server's. `serverRing` is the ring total the server used
 * (`stepsDay.ringDailyTotal`, else the daily summary's ring steps).
 */
export function withLocalSteps(headline: StepsHeadline | null, i: LocalStepsInput): StepsHeadline | null {
  const ahead = ringAhead(i);
  if (!ahead) return headline;
  if (headline && headline.value >= ahead.steps) return headline;
  return { value: ahead.steps, lineage: headline?.lineage ?? 'ring', provisional: true };
}

interface LocalStepsInput {
  date: string;
  local: GaugeLocalSnapshot | null;
  stepsDay?: Pick<GaugeStepDay, 'ringDailyTotal' | 'headlinePolicy'> | null;
  serverRing?: number | null;
}

/** The phone's ring count for `date` while the server has not had it yet (see the file comment), else null. */
function ringAhead(i: LocalStepsInput): { steps: number; at: number | null } | null {
  const t = i.local?.today;
  if (!t || t.date !== i.date || t.ringSteps === null) return null;
  if (i.stepsDay?.headlinePolicy === 'located') return null;
  const ring = i.stepsDay?.ringDailyTotal ?? i.serverRing ?? null;
  // the server already has this ring total (or a newer one): its headline stands
  if (ring !== null && t.ringSteps <= ring) return null;
  return { steps: t.ringSteps, at: ms(t.ringStepsAt) };
}

/**
 * (r087) When the steps were last updated, with the phone's newer ring count: the time the phone wrote that count while
 * it is the one shown (`withLocalSteps`, against the server's own headline for the day), else the server's time. So the
 * card's "Updated hh:mm" belongs to the total beside it.
 */
export function stepsUpdatedAt(
  serverAt: number | null,
  i: { date: string; local: GaugeLocalSnapshot | null; stepsDay?: Pick<GaugeStepDay, 'ringDailyTotal' | 'headlinePolicy' | 'headline'> | null },
): number | null {
  const ahead = ringAhead(i);
  if (!ahead || ahead.at === null) return serverAt;
  if (i.stepsDay && i.stepsDay.headline >= ahead.steps) return serverAt;
  return serverAt === null ? ahead.at : Math.max(serverAt, ahead.at);
}

/**
 * (r087) The phone's newest heart-rate reading when it is of `date`, else null. The one reading every Heart rate
 * surface fills in from: a day summary through `withLocalHeartRate`, a day's series through `withLocalHeartPoint`.
 * The same object until the reading changes.
 */
export function useLocalHeartRate(date: string): LocalHeartRate | null {
  const hr = useGaugeLive().local?.latestHr ?? null;
  const bpm = hr?.bpm ?? null;
  const at = hr?.at ?? null;
  return useMemo(() => {
    const t = ms(at);
    return bpm !== null && at !== null && t !== null && calendarDate(t) === date ? { bpm, at } : null;
  }, [date, bpm, at]);
}

/**
 * The server answered with the phone's reading, or a newer one. The server gives its times in whole seconds and the
 * phone's carry milliseconds, so the two are compared by the second: a reading the server has is never held to be newer
 * for the fraction it lost on the way.
 */
const answered = (phoneAt: number, serverAt: number | null): boolean =>
  serverAt !== null && Math.floor(phoneAt / 1000) <= Math.floor(serverAt / 1000);

/** The day's latest heart rate when it is the phone's own reading, not yet in the server's answer. */
export interface LocalLatest {
  at: string;
  value: number;
  provisional: true;
}

const NO_HR: Omit<GaugeValueMetric, 'latest'> = { unit: 'bpm', count: 0, mean: null, min: null, max: null };

/**
 * (r087) The day summary with the phone's newer heart-rate reading as its `latest` (see the file comment): the server's
 * summary as it is when the reading is of another day, or the server already answered with it or a newer one. Only
 * `latest` is replaced, marked `provisional`; nothing else in the day is touched.
 */
export function withLocalHeartRate(
  daily: GaugeDaily | null,
  i: { date: string; latestHr: LocalHeartRate | null | undefined },
): GaugeDaily | null {
  const at = ms(i.latestHr?.at);
  if (!daily || !i.latestHr || at === null || calendarDate(at) !== i.date) return daily;
  const m = daily.metrics?.hr;
  if (m && !('mean' in m)) return daily;
  if (answered(at, ms(m?.latest?.at))) return daily;
  const latest: LocalLatest = { at: i.latestHr.at, value: i.latestHr.bpm, provisional: true };
  return { ...daily, metrics: { ...daily.metrics, hr: { ...(m ?? NO_HR), latest } } };
}

/**
 * (r087) The day's latest heart rate as a surface shows it: the day summary's (`withLocalHeartRate`), and while there
 * is no day summary yet (the server has not answered) the phone's own reading of that day, marked `provisional`, so the
 * surface agrees with the Heart rate page, which shows it at once. null when neither has a reading.
 */
export function latestHeartRateOf(
  daily: GaugeDaily | null,
  i: { date: string; latestHr: LocalHeartRate | null | undefined },
): { at: string; value: number; provisional?: true } | null {
  if (!daily) {
    const at = ms(i.latestHr?.at);
    if (!i.latestHr || at === null || calendarDate(at) !== i.date) return null;
    return { at: i.latestHr.at, value: i.latestHr.bpm, provisional: true };
  }
  const m = withLocalHeartRate(daily, i)?.metrics?.hr;
  const l = m && 'latest' in m ? m.latest : null;
  if (!l || !('value' in l) || typeof l.value !== 'number') return null;
  return 'provisional' in l && l.provisional === true ? { at: l.at, value: l.value, provisional: true } : { at: l.at, value: l.value };
}

/** A point of the day's heart-rate series that is the phone's own reading, not yet in the server's answer. */
export type LocalRawPoint = GaugeRawPoint & { value: number; provisional: true };

/**
 * (r087) A day's raw heart-rate points with the phone's newer reading after them, marked `provisional`: the same rule
 * as `withLocalHeartRate`, against the newest point the server answered with. The same array when there is nothing to
 * add; the server's points are never changed. `hr` is the reading of the day shown (`useLocalHeartRate`).
 */
export function withLocalHeartPoint(points: readonly GaugeRawPoint[], hr: LocalHeartRate | null): readonly GaugeRawPoint[] {
  const at = ms(hr?.at);
  if (!hr || at === null) return points;
  let newest: number | null = null;
  for (const p of points) {
    const t = ms(p.at);
    if (t !== null && (newest === null || t > newest)) newest = t;
  }
  if (answered(at, newest)) return points;
  const point: LocalRawPoint = { at: hr.at, value: hr.bpm, provenance: null, provisional: true };
  return [...points, point];
}
