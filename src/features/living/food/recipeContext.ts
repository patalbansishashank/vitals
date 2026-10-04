/**
 * The installed recipe provider (null until the AI layer provides one; `useRecipeProvider` then falls back to
 * `noRecipeProvider`). Its own module so the app root (src/ai/coach/CoachRuntimeProvider.tsx) can provide it without
 * loading the Food copy and the mock dishes into the initial bundle.
 */
import { createContext } from 'react';
import type { RecipeProvider } from './recipes';

export const RecipeProviderContext = createContext<RecipeProvider | null>(null);
