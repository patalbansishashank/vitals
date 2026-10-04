/**
 * Whether a Coach provider is connected, readable from screens outside Living mode without pulling in the Coach
 * (the intake's "Answer by chatting instead", design/screens/onboarding-intake-v2.md §2, IA §4.6), and the navigation
 * state that opens the Coach with a prefilled message (the Coach page sends `state.draft` once, then clears it).
 * The Coach runtime (src/ai/coach/runtime.ts) calls `setCoachAvailable` with whether the configured provider can use tools.
 */
import { useSyncExternalStore } from 'react';

let available = false;
const listeners = new Set<() => void>();

export function setCoachAvailable(on: boolean): void {
  if (available === on) return;
  available = on;
  listeners.forEach((l) => l());
}

export function isCoachAvailable(): boolean {
  return available;
}

export function useCoachAvailable(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => available,
    () => available,
  );
}

let problem: string | null = null;
const problemListeners = new Set<() => void>();

/** The configured provider couldn't be set up (the runtime's reason, in plain words); null once it works or is removed. */
export function setCoachProblem(next: string | null): void {
  if (problem === next) return;
  problem = next;
  problemListeners.forEach((l) => l());
}

export function useCoachProblem(): string | null {
  return useSyncExternalStore(
    (l) => {
      problemListeners.add(l);
      return () => problemListeners.delete(l);
    },
    () => problem,
    () => problem,
  );
}

export interface CoachDraftState {
  draft: { text: string; context?: Record<string, string> };
}

/** Navigation state that opens the Coach with `text` sent as the first message (`navigate('/coach', { state })`). */
export function coachDraftState(text: string, context?: Record<string, string>): CoachDraftState {
  return { draft: { text, ...(context ? { context } : {}) } };
}
