/*
 * V4d screenshot harness (dev only, never in the app's routes): the real Food and Train pages inside the real app shell,
 * on the in-memory Living stand-in with the fixture plan ("Spring cut", today Thursday 1 October 2026, 13:00), a few
 * logged meals and steps, and a stand-in for V3's `activity.logManual` (it is not on the bus yet).
 *   /src/features/living/train/__screens__/screens.html?path=/train
 * Driven by ./render.mjs.
 */
import '@/styles/index.css';
import { StrictMode, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AppShell } from '@/app/shell/AppShell';
import { LivingClockContext, fixedClock } from '../../clock';
import { LivingActionsProvider } from '../../data/actions';
import { LivingDataProvider } from '../../data/source';
import { createStubLiving, fixedPlanControl } from '../../data/stub';
import { FIXTURE_TODAY, STUB_STIMULUS_CONTEXT, STUB_TRAINING_PROFILE, fixturePlan } from '../../data/fixtures';
import { resetActivePlan, useActivePlanStore } from '../../activePlan';
import FoodPage from '../../food/FoodPage';
import TrainPage from '../TrainPage';
import { TrainingSetupProvider, fixedTrainingSetup } from '../setup';
import { ManualCheckProvider, ManualLogProvider, fixedManualCheck, type LogManualActivity } from '../v3Adapter';

const q = new URLSearchParams(location.search);
const path = q.get('path') ?? '/train';
const quiet = q.get('quiet') === '1';

const clock = fixedClock(`${FIXTURE_TODAY}T13:00:00`);
const plan = fixturePlan(FIXTURE_TODAY);
const stub = createStubLiving({ clock, plan: fixedPlanControl(plan) });
resetActivePlan();
useActivePlanStore.getState().setPlan(plan);

// what the person logged today by 13:00 (synthetic): breakfast as planned (an estimate with its band), a typed lunch,
// and steps imported so far
async function seed() {
  await stub.actions.logMeal(FIXTURE_TODAY, { slot: 'breakfast', clockH: 8.5, asPlanned: true, components: [{ name: 'Besan chilla with curd', energyKcal: 520, proteinG: 34, carbG: 48, fatG: 18 }] });
  await stub.actions.logMeal(FIXTURE_TODAY, { slot: 'lunch', clockH: 12.75, components: [{ name: 'Rajma chawal', energyKcal: 640, proteinG: 26, carbG: 96, fatG: 14 }, { name: 'Cucumber raita', energyKcal: 110, proteinG: 6, carbG: 8, fatG: 5 }] });
  await stub.actions.logSteps(FIXTURE_TODAY, 6420);
  if (quiet) await stub.actions.setQuietMode(true);
}

// V3's `activity.logManual` stand-in: accepts and offers Undo
const logManual: LogManualActivity = async () => ({ ok: true, undo: async () => ({ ok: true }) });

const setup = fixedTrainingSetup(STUB_TRAINING_PROFILE, { ...STUB_STIMULUS_CONTEXT, rmrKcalPerDay: 1780, ageYears: 38 });

const wrap = (el: ReactElement) => (
  <LivingClockContext.Provider value={clock}>
    <LivingDataProvider value={stub.source}>
      <LivingActionsProvider value={stub.actions}>
        <TrainingSetupProvider value={setup}>
          <ManualLogProvider value={logManual}>
            {/* the log's check over the fixture person (the app reads the stored weigh-ins and recordings) */}
            <ManualCheckProvider value={fixedManualCheck({ massKg: STUB_STIMULUS_CONTEXT.bodyMassKg, ageY: 38, sex: null, rmrKcalPerDay: 1780 })}>{el}</ManualCheckProvider>
          </ManualLogProvider>
        </TrainingSetupProvider>
      </LivingActionsProvider>
    </LivingDataProvider>
  </LivingClockContext.Provider>
);

const router = createMemoryRouter(
  [
    {
      path: '/',
      element: wrap(<AppShell />),
      children: [
        { path: 'food', element: <FoodPage /> },
        { path: 'food/:date', element: <FoodPage /> },
        { path: 'train', element: <TrainPage /> },
        { path: 'train/:date', element: <TrainPage /> },
        { path: '*', element: <TrainPage /> },
      ],
    },
  ],
  { initialEntries: [path] },
);

void seed().then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  ),
);
