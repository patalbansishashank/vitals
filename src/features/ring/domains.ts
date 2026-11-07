/**
 * The Ring's domains (r071, `tokens.css`): which hue and glow each card and signal wears. One card, one domain: the Day
 * score and the recovery signals (HRV, stress, skin temperature) are `recovery`, heart rate and blood oxygen `heart`,
 * sleep `sleep`, steps and workouts `steps`, the short-video count `videos` (library only), the device `neutral`.
 */
import type { Domain } from '@/components';
import type { RingMetric } from './model';

export const RING_DOMAIN = {
  dayScore: 'recovery',
  signals: 'heart',
  sleep: 'sleep',
  activity: 'steps',
  workout: 'steps',
  workoutHeart: 'heart',
  videos: 'videos',
  device: 'neutral',
} as const satisfies Record<string, Domain>;

/** A signal's domain: heart rate and blood oxygen `heart`, HRV, stress and skin temperature `recovery`. */
export function metricDomain(kind: RingMetric): Domain {
  return kind === 'hr' || kind === 'spo2' ? 'heart' : 'recovery';
}

/** The three indices of the Day score, each in its own domain (their arcs, rows and cards wear it). */
export const INDEX_DOMAIN = { recovery: 'recovery', activity: 'steps', sleep: 'sleep' } as const satisfies Record<string, Domain>;
