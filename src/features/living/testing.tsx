/**
 * Test harness for Living screens: a fixed clock, a fixture plan, the in-memory stand-in as source and actions, and a
 * memory router. `renderLiving(<TodayPage />, { path: '/today', route: 'today' })`.
 */
import type { ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import { LivingClockContext, fixedClock, type LivingClock } from './clock';
import { LivingActionsProvider } from './data/actions';
import { LivingDataProvider, type LivingDataSource } from './data/source';
import { createStubLiving, fixedPlanControl, type StubLiving } from './data/stub';
import { FIXTURE_TODAY, fixturePlan } from './data/fixtures';
import { resetActivePlan, useActivePlanStore, type ActivePlan } from './activePlan';

export interface LivingHarness {
  stub: StubLiving;
  clock: LivingClock;
  plan: ActivePlan | null;
  router: ReturnType<typeof createMemoryRouter>;
  result: RenderResult;
}

export interface RenderLivingOptions {
  /** Initial URL (default "/"). */
  path?: string;
  /** Route pattern the element is mounted at (default: matches everything). */
  route?: string;
  /** Extra routes (e.g. a target page for navigation assertions). */
  routes?: RouteObject[];
  /** Local wall time of "now" (default 2026-10-01 13:00, the fixture's today). */
  now?: string;
  /** The live plan (default: the fixture "Spring cut", day 15 of 84). `null` = no plan. */
  plan?: ActivePlan | null;
  /** Also put the plan into the app's active-plan store (the shell and `useAppMode` read it). Default true. */
  syncStore?: boolean;
  /** Wrap or replace the stand-in's source (e.g. serve a hand-written TodayView for one date). */
  source?: (stub: StubLiving) => LivingDataSource;
}

export function renderLiving(ui: ReactElement, o: RenderLivingOptions = {}): LivingHarness {
  const clock = fixedClock(o.now ?? `${FIXTURE_TODAY}T13:00:00`);
  const plan = o.plan === undefined ? fixturePlan(FIXTURE_TODAY) : o.plan;
  const control = fixedPlanControl(plan);
  const stub = createStubLiving({ clock, plan: control });
  const source = o.source ? o.source(stub) : stub.source;
  if (o.syncStore !== false) {
    resetActivePlan();
    if (plan) useActivePlanStore.getState().setPlan(plan);
  }
  const wrap = (el: ReactElement) => (
    <LivingClockContext.Provider value={clock}>
      <LivingDataProvider value={source}>
        <LivingActionsProvider value={stub.actions}>{el}</LivingActionsProvider>
      </LivingDataProvider>
    </LivingClockContext.Provider>
  );
  const router = createMemoryRouter([{ path: o.route ?? '*', element: wrap(ui) }, ...(o.routes ?? []).map((r) => ({ ...r, element: r.element ? wrap(r.element as ReactElement) : r.element }))], {
    initialEntries: [o.path ?? '/'],
  });
  const result = render(<RouterProvider router={router} />);
  return { stub, clock, plan, router, result };
}
