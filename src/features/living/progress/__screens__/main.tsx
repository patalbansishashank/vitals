/*
 * Screenshot harness (dev only) for package V4e: Progress with the activity cards and Settings › Heart rate inside the
 * real app shell, on the in-memory Living stand-in and synthetic data (labelled synthetic). Open
 *   /src/features/living/progress/__screens__/screens.html?page=progress|heart|body[&quiet=1]
 * Nothing here ships: no route links to it and the production build has no entry for it.
 */
import '@/styles/index.css';
import { StrictMode, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AppShell } from '@/app/shell';
import { LivingClockContext, fixedClock } from '../../clock';
import { LivingActionsProvider } from '../../data/actions';
import { LivingDataProvider } from '../../data/source';
import { createStubLiving, fixedPlanControl } from '../../data/stub';
import { FIXTURE_TODAY, fixturePlan } from '../../data/fixtures';
import { resetActivePlan, useActivePlanStore } from '../../activePlan';
import ProgressPage from '../ProgressPage';
import SettingsPage from '@/features/settings/SettingsPage';
import { setProgressActuals } from '../v3Adapter';
import { setProgressGauge } from '../data/gauge';
import { demoActualsAdapter, demoGauge } from '../__fixtures__/activity';
import { setHrEvidence, updateHeartSettings } from '@/features/settings/heart/v3Adapter';
import { useSettingsStore } from '@/state/settingsStore';
import { useProfileStore } from '@/state/profileStore';

const q = new URLSearchParams(location.search);
const page = q.get('page') ?? 'progress';
const clock = fixedClock(`${FIXTURE_TODAY}T13:00:00`);
const plan = fixturePlan(FIXTURE_TODAY);
const scene = q.get('scene');
const stub = createStubLiving({ clock, plan: fixedPlanControl(scene === 'empty' ? null : plan) });
const source =
  scene === 'no-weigh-in'
    ? {
        ...stub.source,
        trend: (...args: Parameters<typeof stub.source.trend>) => {
          const data = stub.source.trend(...args);
          return data ? { ...data, weighIns: [], trend: data.trend.map(() => Number.NaN) } : null;
        },
      }
    : stub.source;
resetActivePlan();
if (scene !== 'empty') useActivePlanStore.getState().setPlan(plan);
if (q.get('quiet')) {
  useSettingsStore.getState().set({ quietMode: true });
  void stub.actions.setQuietMode(true);
}
const profile = useProfileStore.getState();
profile.setSex('male');
profile.setAge(38);
profile.setHeight(178);
profile.setWeight(84);

setProgressActuals(scene === 'empty' ? null : demoActualsAdapter(FIXTURE_TODAY));
setProgressGauge(demoGauge());
// three recorded workouts held 30 s above the age estimate (38 y: 208 − 0.7·38 = 181 bpm)
const t0 = Date.parse(`${FIXTURE_TODAY}T07:00:00Z`);
setHrEvidence({
  hrMaxEvidenceBouts: () =>
    [189, 191, 186].map((bpm, i) => {
      const start = t0 - (i + 1) * 9 * 86_400_000;
      return {
        id: `bout-${i}`,
        window: { start, end: start + 40 * 60_000 },
        quality: true,
        segments: Array.from({ length: 6 }, (_, k) => ({
          start: start + 600_000 + k * 10_000,
          end: start + 600_000 + (k + 1) * 10_000,
          bpm,
        })),
      };
    }),
});
void updateHeartSettings({ hrProfile: { hrRestOverride: q.get('rest') ? Number(q.get('rest')) : null } });

const wrap = (el: ReactElement) => (
  <LivingClockContext.Provider value={clock}>
    <LivingDataProvider value={source}>
      <LivingActionsProvider value={stub.actions}>{el}</LivingActionsProvider>
    </LivingDataProvider>
  </LivingClockContext.Provider>
);

const router = createMemoryRouter(
  [
    {
      element: <AppShell />,
      children: [
        { path: '/progress', element: wrap(<ProgressPage />) },
        { path: '/settings/:section', element: <SettingsPage /> },
        { path: '/settings', element: <SettingsPage /> },
      ],
    },
  ],
  {
    initialEntries: [page === 'heart' ? '/settings/heart' : page === 'settings' ? '/settings' : '/progress'],
  },
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
