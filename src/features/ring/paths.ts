/** The Ring routes (`src/app/routes.tsx` mounts them). Link with these helpers. */
export type RingTab = 'overview' | 'sleep' | 'activity' | 'scores';

const q = (date?: string) => (date ? `?date=${date}` : '');

export const ringPaths = {
  root: '/ring',
  tab: (tab: RingTab, date?: string) => `${tab === 'overview' ? '/ring' : `/ring/${tab}`}${q(date)}`,
  signal: (kind: string, date?: string) => `/ring/signals/${encodeURIComponent(kind)}${q(date)}`,
  /** A Gauge workout; `activity`: the approved activity it is evidence for (its decided window and booked energy). */
  workout: (id: string, date?: string, activity?: string) => `/ring/workouts/${encodeURIComponent(id)}${q(date)}${activity ? `${date ? '&' : '?'}activity=${encodeURIComponent(activity)}` : ''}`,
  shortVideos: (date?: string) => `/ring/short-videos${q(date)}`,
  /** (r070) The ring this phone talks to (Android app with the engine only). */
  device: '/ring/device',
} as const;

/** The Energy page (`/energy`, owned by Today and Energy): what the day burned and what it is made of. */
export const energyPath = (date?: string) => `/energy${q(date)}`;

/** The sleep page (`/sleep[/:date]`, `src/features/living/routes.tsx`): the same sections as Ring › Sleep. */
export const sleepPath = (date?: string) => (date ? `/sleep/${date}` : '/sleep');
