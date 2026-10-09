import { lazy, Suspense, type ComponentType } from 'react';
import { Navigate, type RouteObject } from 'react-router';
import { OnboardingGate } from '@/features/onboarding/OnboardingGate';
import { livingRoutes } from '@/features/living/routes';
import { useAppMode, useLivePlanReady } from '@/features/living/mode';
import { AppShell, NotFound, PageFallback, RootError, RouteError } from './shell';
import { lastRoute } from './lastRoute';

/*
 * Feature entry points are lazy and live at stable paths:
 *   src/features/<name>/<Name>Page.tsx  (default export)
 * A page component serves every path of its feature and reads params with
 * useParams() / useMatch() (e.g. SimulatePage for /simulate, /simulate/:sid/schedule
 * and /simulate/:sid/results). "/simulate" and "/plan" are redirect entries the
 * feature resolves (active scenario / finished run).
 */
const BodyPage = lazy(() => import('@/features/body/BodyPage'));
const SimulatePage = lazy(() => import('@/features/simulator/SimulatePage'));
const PlannerPage = lazy(() => import('@/features/planner/PlannerPage'));
const EvidencePage = lazy(() => import('@/features/evidence/EvidencePage'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));
const SignalsPage = lazy(() => import('@/features/signals/SignalsPage'));
const ComponentGalleryPage = lazy(() => import('./dev/ComponentGalleryPage'));
const PickerDemoPage = lazy(() => import('@/features/components/PickerDemo'));
// First run + safety (design/screens/onboarding-safety.md): /welcome sits outside the shell (no tab bar).
const WelcomePage = lazy(() => import('@/features/onboarding/WelcomePage'));
const SafetyLimitsPage = lazy(() => import('@/features/onboarding/SafetyLimitsPage'));
const SafetyDemoPage = lazy(() => import('@/features/onboarding/SafetyDemoPage'));
const AvatarDemoPage = lazy(() => import('@/features/body/avatar/AvatarDemoPage'));
const DevFigurePage = lazy(() => import('@/features/body/figure3d/DevFigurePage'));
const ErrorTestPage = lazy(() => import('./dev/ErrorTestPage'));
const ValidationReportPage = lazy(() => import('@/features/evidence/ValidationReportPage'));

// Guarded: the chart engineer's demo is mounted only once the file exists, so the build never breaks without it.
const chartDemoModules = import.meta.glob<{ default: ComponentType }>('/src/features/charts/ChartsDemoPage.tsx');
const chartDemoLoader = Object.values(chartDemoModules)[0];
const ChartsDemoPage = chartDemoLoader ? lazy(chartDemoLoader) : null;

function RootRedirect() {
  // Living mode (a plan scheduled, active or paused) is home on Today; Planning returns to the last route (IA §2.1).
  const { mode } = useAppMode();
  // the plan documents are still loading: "no plan" is not known yet
  if (!useLivePlanReady()) return <PageFallback />;
  return <Navigate to={mode === 'living' ? '/today' : (lastRoute() ?? '/body')} replace />;
}

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RootError />,
    children: [
      {
        errorElement: <RouteError />,
        children: [
          {
            // Safety gate: first run → /welcome, under 18 → hard stop, outdated consent → re-consent.
            // Evidence, Settings and Safety & limits stay outside it (open to everyone).
            element: <OnboardingGate />,
            children: [
              { index: true, element: <RootRedirect /> },
              { path: 'body', element: <BodyPage /> },
              // the ring page is Body signals now (owner, 9 Oct): the old address lands there
              { path: 'ring', element: <Navigate to="/signals" replace /> },
              { path: 'signals', element: <SignalsPage /> },
              { path: 'simulate', element: <SimulatePage /> },
              { path: 'simulate/:sid', element: <Navigate to="schedule" replace /> },
              { path: 'simulate/:sid/schedule', element: <SimulatePage /> },
              { path: 'simulate/:sid/results', element: <SimulatePage /> },
              { path: 'plan', element: <PlannerPage /> },
              { path: 'plan/goals', element: <PlannerPage /> },
              { path: 'plan/run', element: <PlannerPage /> },
              { path: 'plan/results', element: <PlannerPage /> },
              // Intake v2 (design/screens/onboarding-intake-v2.md): /onboarding/{activity,training,diet,kitchen,supplements,devices,summary}
              { path: 'onboarding', element: <Navigate to="activity" replace /> },
              { path: 'onboarding/:section', HydrateFallback: PageFallback, lazy: () => import('@/features/intake/IntakePage').then((m) => ({ Component: m.default })) },
              // Living mode: Today · Food · Train · Coach · Progress · plan details (src/features/living/routes.tsx)
              ...livingRoutes,
            ],
          },
          { path: 'safety', element: <SafetyLimitsPage /> },
          { path: 'evidence', element: <EvidencePage /> },
          { path: 'evidence/validation', element: <ValidationReportPage /> },
          { path: 'evidence/:mechanismId', element: <EvidencePage /> },
          { path: 'evidence/topics', element: <Navigate to="/evidence?group=topic" replace /> },
          { path: 'evidence/topics/:topicSlug', element: <EvidencePage /> },
          { path: 'settings', element: <SettingsPage /> },
          { path: 'settings/:section', element: <SettingsPage /> },
          // friendly aliases
          { path: 'profile', element: <Navigate to="/body" replace /> },
          { path: 'simulator', element: <Navigate to="/simulate" replace /> },
          { path: 'planner', element: <Navigate to="/plan" replace /> },
          { path: 'library', element: <Navigate to="/evidence" replace /> },
          // developer surfaces: built, lazy, never in navigation
          { path: 'dev/components', element: <ComponentGalleryPage /> },
          { path: 'dev/picker', element: <PickerDemoPage /> },
          { path: 'dev/safety', element: <SafetyDemoPage /> },
          { path: 'dev/avatar', element: <AvatarDemoPage /> },
          { path: 'dev/figure', element: <DevFigurePage /> },
          { path: 'dev/error', element: <ErrorTestPage /> },
          ...(ChartsDemoPage ? [{ path: 'dev/charts', element: <ChartsDemoPage /> }] : []),
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
  {
    path: '/welcome',
    errorElement: <RootError />,
    element: (
      <Suspense fallback={<PageFallback />}>
        <WelcomePage />
      </Suspense>
    ),
  },
];
