/**
 * A1-001 (C5; D4-01/D4-03) — the start sheet reads the same startability as the lifecycle command. Unchecked is never
 * permission by itself:
 *  - a mandatory bound the plan cannot be checked against (unsupported or unresolved) and a failed safety audit block the
 *    Start key before any write, with the concrete next step (Review limits · Find plans again);
 *  - an optional, irrelevant unsupported preference never blocks (no global lock);
 *  - a command refusal at start keeps the sheet open, disables Start (no silent retry), shows the boundary's word and offers
 *    the step that can change the answer; nothing is written.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { Toaster } from '@/components';
import { fixtureRequest, fixtureResult } from '@/features/planner/__tests__/fixtures';
import { freshState } from '@/commands/__tests__/harness';
import { installLivingPorts } from '@/commands/livingWiring';
import type { OptionSafety, PlanOption } from '@/engine/planner/domain/types';
import type { ConstraintEvaluation } from '@/lib/bodyContracts';
import type { LifecycleRevalidation } from '@/living';
import { EMPTY_RUN, usePlannerStore } from '@/state/plannerStore';
import { withSystemWrite } from '@/state/scope';
import { LivingClockContext, fixedClock } from '../../clock';
import { resetActivePlan } from '../../activePlan';
import { getActivePlanSource, installDocumentPlanSource } from '../../mode';
import { SAFETY_AUDIT_FAILED, SAFETY_BLOCK, SAFETY_UNCHECKABLE, StartPlanEntry, refusedStartAction, startSafetyGate } from '../StartPlanSheet';

installDocumentPlanSource();

const WALL = '2026-10-02T13:00:00';

const satfat = (over: Partial<ConstraintEvaluation> = {}): ConstraintEvaluation => ({
  constraintId: 'clinician:satfat',
  key: 'satfat-cap',
  status: 'unchecked',
  capability: 'unsupported',
  mandatory: true,
  margin: null,
  unit: '%E',
  ...over,
});
const pass = (over: Partial<ConstraintEvaluation> = {}): ConstraintEvaluation => ({ constraintId: 'energy-floor', key: 'energy-floor', status: 'pass', capability: 'enforced', mandatory: true, margin: 12, unit: '% of maintenance', ...over });

describe('startSafetyGate (pure, A1-001)', () => {
  it('blocks a mandatory unsupported or unresolved bound with Review limits', () => {
    expect(startSafetyGate({ status: 'unchecked', evaluations: [pass(), satfat()] })).toEqual({ blocked: SAFETY_UNCHECKABLE, action: 'reviewLimits' });
    // supported but unresolved on this plan (its exposure could not be resolved): still no check
    expect(startSafetyGate({ status: 'unchecked', evaluations: [satfat({ capability: 'enforced' })] })).toEqual({ blocked: SAFETY_UNCHECKABLE, action: 'reviewLimits' });
  });

  it('an optional irrelevant unsupported preference never blocks; a verified, audited plan is startable', () => {
    expect(startSafetyGate({ status: 'verified', evaluations: [pass(), satfat({ mandatory: false })] })).toBeNull();
    expect(startSafetyGate({ status: 'verified', evaluations: [pass()], audit: { status: 'pass' } as OptionSafety['audit'] })).toBeNull();
  });

  it('a failed audit blocks (a new planning attempt, never a retry); violation and conflict block', () => {
    expect(startSafetyGate({ status: 'review', audit: { status: 'fail' } as OptionSafety['audit'] })).toEqual({ blocked: SAFETY_AUDIT_FAILED, action: 'findPlans' });
    expect(startSafetyGate({ status: 'review', certificate: { status: 'failed' } as OptionSafety['certificate'] })).toEqual({ blocked: SAFETY_AUDIT_FAILED, action: 'findPlans' });
    expect(startSafetyGate({ status: 'violation' })).toEqual({ blocked: SAFETY_BLOCK, action: 'findPlans' });
    expect(startSafetyGate({ status: 'conflict' })).toEqual({ blocked: SAFETY_BLOCK, action: 'findPlans' });
  });

  it('a missing record or a missing certificate is left to the command’s current check (never a pass by label)', () => {
    expect(startSafetyGate(undefined)).toBeNull();
    expect(startSafetyGate({ status: 'unchecked', evaluations: [pass()] })).toBeNull();
  });

  it('a refusal offers the step that can change it', () => {
    expect(refusedStartAction('unchecked', false)).toBe('reviewLimits');
    expect(refusedStartAction('review', false)).toBe('findPlans');
    expect(refusedStartAction('violation', true)).toBe('editScenario');
  });
});

function renderEntry(option: PlanOption) {
  const result = fixtureResult();
  const router = createMemoryRouter(
    [
      {
        path: '/plan/results',
        element: (
          <LivingClockContext.Provider value={fixedClock(WALL)}>
            <StartPlanEntry option={option} request={fixtureRequest()} provenance={result.provenance} name={option.name} />
            <Toaster />
          </LivingClockContext.Provider>
        ),
      },
      { path: '/today', element: <h1>Today</h1> },
      { path: '/settings/:section', element: <h1>Settings</h1> },
      { path: '/plan/goals', element: <h1>Goals</h1> },
    ],
    { initialEntries: ['/plan/results'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

async function openSheet() {
  fireEvent.click(screen.getByRole('button', { name: 'Start this plan' }));
  return screen.findByRole('dialog', { name: 'Start Hard' });
}

describe('Start sheet × startability (A1-001)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(WALL));
    freshState({ cleared: true });
    resetActivePlan();
    withSystemWrite(() => usePlannerStore.setState({ run: { ...EMPTY_RUN, status: 'done', request: fixtureRequest(), result: fixtureResult() } }));
  });
  afterEach(() => vi.useRealTimers());

  it('a mandatory unsupported limit: Start is disabled with the reason, nothing is written, Review limits opens the limits', async () => {
    const revalidate = vi.fn(async () => ({ status: 'verified', certificateValid: true, startable: true }) as LifecycleRevalidation);
    installLivingPorts({ revalidate });
    const router = renderEntry({ ...fixtureResult().options[0]!, safety: { status: 'unchecked', evaluations: [pass(), satfat()] } });
    const sheet = await openSheet();
    expect(within(sheet).getByText(/^Safety · Unchecked/)).toBeInTheDocument();
    const start = within(sheet).getByRole('button', { name: 'Start plan' });
    expect(start).toHaveAttribute('aria-disabled', 'true');
    await act(async () => fireEvent.click(start));
    expect(revalidate).not.toHaveBeenCalled();
    expect(getActivePlanSource().get().plan).toBeFalsy();
    expect(screen.getByText(SAFETY_UNCHECKABLE)).toBeInTheDocument();
    await act(async () => fireEvent.click(within(sheet).getByRole('button', { name: 'Review limits' })));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/safety'));
  });

  it('a failed audit reads Review and cannot be started; the next step is a new planning attempt', async () => {
    installLivingPorts({ revalidate: async () => ({ status: 'verified', certificateValid: true, startable: true }) as LifecycleRevalidation });
    const router = renderEntry({ ...fixtureResult().options[0]!, safety: { status: 'review', audit: { status: 'fail' } as OptionSafety['audit'] } });
    const sheet = await openSheet();
    expect(within(sheet).getByText(/^Safety · Review/)).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Start plan' })).toHaveAttribute('aria-disabled', 'true');
    expect(getActivePlanSource().get().plan).toBeFalsy();
    // the next step is a new planning attempt from the goals (current safety), never a retry of this audit
    await act(async () => fireEvent.click(within(sheet).getByRole('button', { name: 'Find plans again' })));
    await waitFor(() => expect(router.state.location.pathname).toBe('/plan/goals'));
  });

  it('an optional irrelevant unsupported preference does not block: with a valid current check the plan starts', async () => {
    installLivingPorts({ revalidate: async () => ({ status: 'verified', certificateValid: true, startable: true }) as LifecycleRevalidation });
    const router = renderEntry({ ...fixtureResult().options[0]!, safety: { status: 'verified', evaluations: [pass(), satfat({ mandatory: false })] } });
    const sheet = await openSheet();
    const start = within(sheet).getByRole('button', { name: 'Start plan' });
    expect(start).not.toHaveAttribute('aria-disabled', 'true');
    await act(async () => fireEvent.click(start));
    await waitFor(() => expect(router.state.location.pathname).toBe('/today'));
    expect(getActivePlanSource().get().plan).toBeTruthy();
  });

  it('a refusal at start keeps the sheet, writes nothing, disables Start (no retry) and offers the next step', async () => {
    const revalidate = vi.fn(async () => ({ status: 'review', certificateValid: false, reasons: ['Safety needs review.'] }) as LifecycleRevalidation);
    installLivingPorts({ revalidate });
    const router = renderEntry({ ...fixtureResult().options[0]!, safety: { status: 'unchecked' } });
    const sheet = await openSheet();
    const start = within(sheet).getByRole('button', { name: 'Start plan' });
    await act(async () => fireEvent.click(start));
    await waitFor(() => expect(within(sheet).getByText(/^Safety · Review/)).toBeInTheDocument());
    expect(router.state.location.pathname).toBe('/plan/results');
    expect(getActivePlanSource().get().plan).toBeFalsy();
    expect(within(sheet).getByRole('button', { name: 'Start plan' })).toHaveAttribute('aria-disabled', 'true');
    expect(within(sheet).getByRole('button', { name: 'Find plans again' })).toBeInTheDocument();
    const calls = revalidate.mock.calls.length;
    await act(async () => fireEvent.click(within(sheet).getByRole('button', { name: 'Start plan' })));
    expect(revalidate.mock.calls.length).toBe(calls);
  });
});
