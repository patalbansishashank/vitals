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
 */
import { useMemo, useSyncExternalStore } from 'react';
import type { GaugeLocalSnapshot } from '@/platform/gaugeLocal';
import { engineLocalSnapshot, useGaugeEngine } from '@/state/gaugeEngine';
import { gaugeLive, onGaugeLive, type GaugeLive } from '@/state/gaugePulse';
import type { StepsHeadline } from './day';
import type { GaugeStepDay } from './types';

/** A local snapshot older than this says nothing about the queue now. */
export const LOCAL_FRESH_MS = 5 * 60_000;

/**
 * The live pulse and the phone's local snapshot, re-read when either changes. (r070) With the ring engine active its own
 * upload state is the local snapshot, live (no 60 s read): "Gauge sent hh:mm" is the engine's `upload.lastSentAt`.
 */
export function useGaugeLive(): GaugeLive {
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
export function withLocalSteps(
  headline: StepsHeadline | null,
  i: { date: string; local: GaugeLocalSnapshot | null; stepsDay?: Pick<GaugeStepDay, 'ringDailyTotal' | 'headlinePolicy'> | null; serverRing?: number | null },
): StepsHeadline | null {
  const t = i.local?.today;
  if (!t || t.date !== i.date || t.ringSteps === null) return headline;
  if (i.stepsDay?.headlinePolicy === 'located') return headline;
  const ring = i.stepsDay?.ringDailyTotal ?? i.serverRing ?? null;
  // the server already has this ring total (or a newer one): its headline stands
  if (ring !== null && t.ringSteps <= ring) return headline;
  if (headline && headline.value >= t.ringSteps) return headline;
  return { value: t.ringSteps, lineage: headline?.lineage ?? 'ring', provisional: true };
}
