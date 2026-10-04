import type { RingEvent } from './types';

const optionalRange = (n: number | undefined, max: number): boolean => n === undefined || (Number.isFinite(n) && n >= 0 && n <= max);

/** Daily limits match canonical ingestion; bucket and battery limits match Kotlin's RingEventBridge. */
export function plausibleAggregate(e: RingEvent): boolean {
  if (e.type === 'dailyTotal') return optionalRange(e.steps, 200_000) && optionalRange(e.distanceM, 1_000_000) && optionalRange(e.kcal, 20_000) && optionalRange(e.activeS, 86_400);
  if (e.type === 'activityBucket') return optionalRange(e.steps, 5_000) && optionalRange(e.distanceM, 6_000) && optionalRange(e.kcal, 20_000);
  if (e.type === 'status' && e.key === 'battery') return typeof e.value === 'number' && optionalRange(e.value, 100);
  if (e.type === 'vendor') {
    const max: Record<string, number> = { daily_steps: 200_000, daily_distance: 1_000_000, daily_kcal: 20_000, active_minutes: 1_440 };
    if (max[e.key] !== undefined) return optionalRange(e.value, max[e.key]!);
  }
  return true;
}
