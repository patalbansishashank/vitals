/** The Ring routes (`src/app/routes.tsx` mounts them). Link with these helpers. */
import { energyPaths } from '@/features/living/energy/paths';
import { livingPaths } from '@/features/living/paths';

export type RingTab = 'overview' | 'sleep' | 'scores';

const q = (date?: string) => (date ? `?date=${date}` : '');

export const ringPaths = {
  root: '/ring',
  /**
   * A Ring tab on a day. `'activity'` is not a Ring tab any more: steps and activities live in Activity › Movement, and
   * a link that still asks for it gets that page (as the old `/ring/activity` address does).
   */
  tab: (tab: RingTab | 'activity', date?: string) => (tab === 'activity' ? livingPaths.movement(date) : `${tab === 'overview' ? '/ring' : `/ring/${tab}`}${q(date)}`),
  /** Activity › Movement, where the ring's steps and activities are shown. */
  movement: livingPaths.movement,
  signal: (kind: string, date?: string) => `/ring/signals/${encodeURIComponent(kind)}${q(date)}`,
  /** A Gauge workout; `activity`: the approved activity it is evidence for (its decided window and booked energy). */
  workout: (id: string, date?: string, activity?: string) => `/ring/workouts/${encodeURIComponent(id)}${q(date)}${activity ? `${date ? '&' : '?'}activity=${encodeURIComponent(activity)}` : ''}`,
  /** (social-time) The Social time page; `/ring/short-videos` redirects here. */
  social: (date?: string) => `/ring/social${q(date)}`,
  /** (r070) The ring this phone talks to (Android app with the engine only). */
  device: '/ring/device',
} as const;

/** The Energy page (Activity › Energy): what the day burned and what it is made of. */
export const energyPath = energyPaths.day;

/** The sleep page (`/sleep[/:date]`, `src/features/living/routes.tsx`): the same sections as Ring › Sleep. */
export const sleepPath = (date?: string) => (date ? `/sleep/${date}` : '/sleep');
