/**
 * Living-mode routes (design/INFORMATION_ARCHITECTURE.md §2.1; docs/SUITE_SPEC.md §6.2), spread into the app's gated
 * route list by `src/app/routes.tsx`. Each screen is its own lazy chunk, and so is the live scores provider (it loads the
 * biometrics document index, which a first-run user never needs); the shell's Suspense shows the page fallback meanwhile.
 */
import { lazy } from 'react';
import { Outlet, type RouteObject } from 'react-router';
import { LivingGuard } from './LivingGuard';

const TodayPage = lazy(() => import('./today/TodayPage'));
const FoodPage = lazy(() => import('./food/FoodPage'));
const PantryPage = lazy(() => import('@/features/food/PantryPage'));
const TrainPage = lazy(() => import('./train/TrainPage'));
const CoachPage = lazy(() => import('./coach/CoachPage'));
const ProgressPage = lazy(() => import('./progress/ProgressPage'));
const PlanDetailsPage = lazy(() => import('./plan/PlanDetailsPage'));
const LiveScoresProvider = lazy(() => import('./scores/LiveScoresProvider').then((m) => ({ default: m.LiveScoresProvider })));

/** The Living screens' outlet: live scores (I1-B) under every Living screen. */
const outlet = (
  <LiveScoresProvider>
    <Outlet />
  </LiveScoresProvider>
);

export const livingRoutes: RouteObject[] = [
  {
    element: <LivingGuard need="plan">{outlet}</LivingGuard>,
    children: [
      { path: 'today', element: <TodayPage /> },
      { path: 'today/:date', element: <TodayPage /> },
      { path: 'food', element: <FoodPage /> },
      { path: 'food/pantry', element: <PantryPage /> },
      { path: 'food/:date', element: <FoodPage /> },
      { path: 'train', element: <TrainPage /> },
      { path: 'train/:date', element: <TrainPage /> },
      { path: 'plan/active', element: <PlanDetailsPage /> },
      { path: 'plan/active/versions/:n', element: <PlanDetailsPage /> },
    ],
  },
  {
    element: <LivingGuard need="none">{outlet}</LivingGuard>,
    children: [
      { path: 'progress', element: <ProgressPage /> },
      { path: 'progress/:metric', element: <ProgressPage /> },
    ],
  },
  {
    element: <LivingGuard need="none" clearsOverride={false}>{outlet}</LivingGuard>,
    children: [
      { path: 'coach', element: <CoachPage /> },
      { path: 'coach/:conversationId', element: <CoachPage /> },
    ],
  },
];
