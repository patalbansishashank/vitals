/**
 * Which boundaries a Ring workout's zones use (Codex UI #2): the ones frozen into its approved session entry, else the
 * person's current HR profile (Settings › Heart rate, the profile age and S2's sleeping low). Reads the stored activity
 * candidates and session entries straight from the document store and re-renders when either changes.
 */
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { bodyOf } from '@/store';
import { getDocumentStore } from '@/state/runtime';
import { useBodyValues } from '@/state/profileStore';
import { useSettingsStore } from '@/state/settingsStore';
import { restingProxyOf } from '@/net/gauge';
import type { HrProfile, ZoneBoundaries } from '@/living/sensors';
import { useBaselines } from './data';
import type { GaugeWorkout } from './types';
import { currentHrProfile, frozenBoundariesFor, zoneSourceOf, type ZoneCandidate, type ZoneSource } from './zones';

let stamp = 0;
const listeners = new Set<() => void>();
let watching = false;

function watchStore(): void {
  if (watching) return;
  watching = true;
  try {
    const store = getDocumentStore();
    const bump = () => {
      stamp++;
      for (const l of listeners) l();
    };
    store.watch('activityCandidates', {}, bump);
    store.watch('dailyLogs', {}, bump);
  } catch {
    watching = false;
  }
}

const subscribe = (l: () => void) => {
  watchStore();
  listeners.add(l);
  return () => void listeners.delete(l);
};
const getStamp = () => stamp;

/** The frozen boundaries of a Gauge session from the store now (null when undecided, or the store is not ready). */
export function storedFrozenBoundaries(workoutId: string): ZoneBoundaries | null {
  try {
    const store = getDocumentStore();
    const candidates = store.peekAll<ZoneCandidate>('activityCandidates').map((d) => bodyOf<ZoneCandidate>(d));
    return frozenBoundariesFor(workoutId, candidates, (id) => {
      const d = store.peek<{ zones?: ZoneBoundaries }>('dailyLogs', id);
      return d && !(d as { _deleted?: boolean })._deleted ? bodyOf<{ zones?: ZoneBoundaries }>(d).zones : null;
    });
  } catch {
    return null;
  }
}

/** The person's HR profile now (Settings › Heart rate, the profile age, S2's sleeping low of `date`). */
export function useCurrentHrProfile(date: string): HrProfile {
  const ageY = useBodyValues().ageYears;
  const hp = useSettingsStore((s) => s.hrProfile);
  const b = useBaselines(date);
  // (0.6.3 FX5) the ring's sleeping low when ready, else Health Connect's resting HR (the import's own choice)
  const low = restingProxyOf(b.data)?.bpm ?? null;
  return useMemo(() => currentHrProfile({ ageY: typeof ageY === 'number' && Number.isFinite(ageY) ? ageY : null, hp, sleepingLowHr: low }), [ageY, hp, low]);
}

/** Resolves each workout's zone source (frozen at approval, else the profile now). */
export function useZoneSources(date: string): (w: GaugeWorkout) => ZoneSource {
  const rev = useSyncExternalStore(subscribe, getStamp, getStamp);
  const profile = useCurrentHrProfile(date);
  return useCallback(
    (w: GaugeWorkout) => {
      void rev;
      return zoneSourceOf(storedFrozenBoundaries(w.id), profile);
    },
    [rev, profile],
  );
}
