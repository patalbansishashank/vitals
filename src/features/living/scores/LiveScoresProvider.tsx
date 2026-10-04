/**
 * Mounts the live `ScoresSource` (./liveScores.ts) for the Living screens, replacing the synthetic stand-in. One
 * source per app (module singleton), so every screen shares its caches.
 */
import type { ReactNode } from 'react';
import { ScoresSourceContext } from '../data/scores';
import { createLiveScoresSource } from './liveScores';

let shared: ReturnType<typeof createLiveScoresSource> | null = null;

/** The app's live scores source (created on first use). */
export function liveScoresSource(): ReturnType<typeof createLiveScoresSource> {
  return (shared ??= createLiveScoresSource());
}

export function LiveScoresProvider({ children }: { children: ReactNode }) {
  return <ScoresSourceContext.Provider value={liveScoresSource()}>{children}</ScoresSourceContext.Provider>;
}
