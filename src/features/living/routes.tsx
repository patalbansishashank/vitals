/**
 * Living-mode routes (design/INFORMATION_ARCHITECTURE.md §2.1; docs/SUITE_SPEC.md §6.2), spread into the app's gated
 * route list by `src/app/routes.tsx`. Each screen is its own lazy chunk; the shell's Suspense shows the page fallback
 * meanwhile.
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
const SleepPage = lazy(() => import('./sleep/SleepPage'));
const EnergyPage = lazy(() => import('./energy/EnergyPage'));

const outlet = <Outlet />;

export const livingRoutes: RouteObject[] = [
  {
    element: <LivingGuard need="plan">{outlet}</LivingGuard>,
    children: [
      { path: 'food', element: <FoodPage /> },
      { path: 'food/pantry', element: <PantryPage /> },
      { path: 'food/:date', element: <FoodPage /> },
      { path: 'plan/active', element: <PlanDetailsPage /> },
      { path: 'plan/active/versions/:n', element: <PlanDetailsPage /> },
    ],
  },
  {
    element: <LivingGuard need="none">{outlet}</LivingGuard>,
    children: [
      // Today is home in every mode (0.6.3): without a plan it shows the ring's day and the way to a plan
      { path: 'today', element: <TodayPage /> },
      { path: 'today/:date', element: <TodayPage /> },
      { path: 'progress', element: <ProgressPage /> },
      // (0.6.3 S24/A7) Train is the activity hub too: logging, recording and review work without a plan (its sessions
      // and plan matching appear when one runs)
      { path: 'train', element: <TrainPage /> },
      { path: 'train/:date', element: <TrainPage /> },
      // the night's sleep (the same sections as Ring › Sleep), with or without a plan
      { path: 'sleep', element: <SleepPage /> },
      { path: 'sleep/:date', element: <SleepPage /> },
      // (r069 D4) all the energy a day burned and when, with or without a plan
      { path: 'energy', element: <EnergyPage /> },
      { path: 'energy/:date', element: <EnergyPage /> },
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
