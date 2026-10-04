/**
 * The installed Coach adapter (null until the AI layer provides one; `useCoachAdapter` then falls back to the
 * no-provider adapter). Its own module so the app root (src/ai/coach/CoachRuntimeProvider.tsx) can provide it without
 * loading the adapter's defaults, the briefing and the Living data source into the initial bundle.
 */
import { createContext } from 'react';
import type { CoachAdapter } from './adapter';

export const CoachAdapterContext = createContext<CoachAdapter | null>(null);
