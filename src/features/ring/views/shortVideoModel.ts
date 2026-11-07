/**
 * Short videos, said neutrally (r071, SPEC Q13): where today's count sits against the person's own daily limit, in plain
 * words that never judge: no mascot, no "wilted" or "rotten", no joke. The six steps are Gauge's own (a share of the limit:
 * under 25, 50, 75, 100 and 150 %), so the number the count crosses is the same; only the words differ. Pure.
 */
import { brainStage } from '../model';
import type { EngineState } from '@/platform/gaugeEngine';
import type { GaugeShortVideoDay } from '../types';

export const LIMIT_WORDS = ['Well under your limit', 'Under your limit', 'About half your limit', 'Close to your limit', 'At your limit', 'Well past your limit'] as const;

/** The step of the day's count against its limit (0 to 5), `limit` null or 0 meaning the default of 30. */
export const limitStep = (count: number, limit: number | null): number => brainStage(count, limit).stage;

/** "Close to your limit": the day's count against the limit, in words. */
export const limitWord = (count: number, limit: number | null): string => LIMIT_WORDS[limitStep(count, limit)]!;

/** Same current-day source for the overview and detail. A disabled limit must never become the default. */
export function displayVideoDay(date: string, remote: GaugeShortVideoDay | null, local: EngineState['shortVideo'] | null | undefined, reportedLimit?: number | null): GaugeShortVideoDay | null {
  if (local) return { date, total: local.today.instagram + local.today.youtube, counts: local.today, limit: local.enabled ? local.dailyLimit : null, limitHits: null, cancels: null };
  return remote ? { ...remote, limit: reportedLimit !== undefined ? reportedLimit : remote.limit } : null;
}
