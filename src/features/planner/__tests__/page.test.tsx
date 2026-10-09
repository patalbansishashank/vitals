import '@/features/charts/test/setupDom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { PlannerProgressV2, PlannerRequest, PlannerResultV2 } from '@/engine/planner/domain/types';
import { seedClearedSafety } from '@/features/onboarding/testing';
import { EMPTY_RUN, pickPlannerValues, usePlannerStore } from '@/state/plannerStore';
import { useProfileStore } from '@/state/profileStore';
import { useScheduleStore } from '@/state/scheduleStore';
import { useSettingsStore } from '@/state/settingsStore';
import PlannerPage from '../PlannerPage';
import { GOALS, fixtureLadder, fixtureLadderCase } from './fixtures';
import { withSystemWrite } from '@/state/scope';
import { ladderSummary } from '@/commands/defs/planner';
import { startPlannerRun, stopPlannerRun } from '../run';

type PlanOpts = { onProgress?: (p: PlannerProgressV2) => void; signal?: AbortSignal; tier?: string };
const client = vi.hoisted(() => ({
  calls: [] as Array<{ request: PlannerRequest; opts: PlanOpts; resolve: (r: PlannerResultV2) => void; reject: (e: unknown) => void }>,
  cancelPlanning: vi.fn(),
}));

vi.mock('../plannerClient', () => ({
  planLadder: (request: PlannerRequest, opts: PlanOpts) =>
    new Promise<PlannerResultV2>((resolve, reject) => {
      client.calls.push({ request, opts, resolve, reject });
    }),
  resumeLadder: () => Promise.reject(new Error('not in these tests')),
  checkpointFor: () => Promise.resolve({ state: 'none' }),
  discardCheckpoint: () => Promise.resolve(),
  cancelPlanning: () => {
    client.cancelPlanning();
    client.calls.at(-1)?.reject(new DOMException('Planning cancelled', 'AbortError'));
  },
  // the Goals screen's pre-run reach estimate (R-TTT): nothing to flag in these tests
  estimateTargetsAsync: () => Promise.resolve([]),
}));

let router: ReturnType<typeof createMemoryRouter>;
const where = () => `${router.state.location.pathname}${router.state.location.search}`;

function renderAt(url: string) {
  const page = <PlannerPage />;
  router = createMemoryRouter(
    [
      { path: '/plan', element: page },
      { path: '/plan/goals', element: page },
      { path: '/plan/run', element: page },
      { path: '/plan/results', element: page },
      { path: '/simulate/:sid/schedule', element: <p>schedule screen</p> },
      { path: '*', element: <p>elsewhere</p> },
    ],
    { initialEntries: [url] },
  );
  render(<RouterProvider router={router} />);
}

const progress = (fraction: number, pct: number, kinds: Array<'hard' | 'medium' | 'easy' | 'ideal'> = ['hard']): PlannerProgressV2 => ({
  stage: 'stages.1',
  fraction,
  euUsed: Math.round(fraction * 3000),
  euBudget: 3000,
  score: 0.5,
  provisional: Object.fromEntries(kinds.map((k) => [k, { structureId: 's', title: 'Deficit 22 % · 4 sessions', D: 0.6, percentOfAchievable: [pct, 50, 10], schedule: fixtureLadder().rungs.hard!.schedule }])),
  changed: true,
});

async function startRun(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByRole('button', { name: /Find plans/ })[0]!);
  await waitFor(() => expect(where()).toBe('/plan/run'));
  expect(client.calls).toHaveLength(1);
  return client.calls[0]!;
}

beforeEach(() => {
  localStorage.clear();
  client.calls.length = 0;
  client.cancelPlanning.mockClear();
  seedClearedSafety();
  withSystemWrite(() => useSettingsStore.setState({ units: 'metric' }));
  withSystemWrite(() => useProfileStore.setState({ sex: 'male', ageYears: 38, heightCm: 180, weightKg: 92, setup: 'done' }));
  withSystemWrite(() => usePlannerStore.setState({ ...pickPlannerValues({ horizonDays: 28, startDate: '2026-10-05' }), goals: GOALS.map((g) => ({ ...g })), run: EMPTY_RUN }));
});

afterEach(() => {
  // leave no pending run between tests
  withSystemWrite(() => usePlannerStore.setState({ run: EMPTY_RUN }));
});

describe('Goals screen', () => {
  it('adds the goal named by ?add= (Evidence "Use as a goal") and clears the param', async () => {
    withSystemWrite(() => usePlannerStore.setState({ goals: [] }));
    renderAt('/plan/goals?add=hunger');
    await waitFor(() => expect(usePlannerStore.getState().goals.map((g) => g.metric)).toEqual(['hunger']));
    await waitFor(() => expect(where()).toBe('/plan/goals'));
    expect(screen.getByRole('button', { name: 'Reorder Hunger pressure, rank 1 of 1' })).toBeInTheDocument();
  });

  it('refuses a seventh goal and metrics that cannot be goals', async () => {
    const six = ['fatMass', 'leanTissue', 'autophagyIdx', 'vo2max', 'strength', 'ldl'];
    withSystemWrite(() => usePlannerStore.setState({ goals: six.map((m, i) => ({ key: `k${i}`, metric: m as never, mode: 'raise', amount: null, strength: 'should', functional: null })) }));
    renderAt('/plan/goals?add=hunger');
    await waitFor(() => expect(where()).toBe('/plan/goals'));
    expect(usePlannerStore.getState().goals).toHaveLength(6);
    expect(screen.getByRole('button', { name: /Add a goal/ })).toHaveAttribute('aria-disabled', 'true');

    withSystemWrite(() => usePlannerStore.setState({ goals: [] }));
    await act(() => router.navigate('/plan/goals?add=leanMass'));
    await waitFor(() => expect(where()).toBe('/plan/goals'));
    expect(usePlannerStore.getState().goals).toHaveLength(0);
  });

  it('folds the Standard-mode safety summary to one line so the goals come first', async () => {
    renderAt('/plan/goals');
    const summary = await screen.findByText('Safety settings');
    const details = summary.closest('details')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('.lp-safety__line')!.textContent).toMatch(/^Standard mode · deficits up to 25\s%\s· fasts up to 24\sh$/);
    // the opt-ins stay reachable inside it
    expect(within(details).getByText(/allow fasts over 24 hours in plans/i)).toBeInTheDocument();
  });

  it('edits a mass target in the user units and stores kilograms', async () => {
    withSystemWrite(() => useSettingsStore.setState({ units: 'imperial' }));
    renderAt('/plan/goals');
    const input = screen.getByLabelText('fat mass to lose') as HTMLInputElement;
    expect(input.value).toBe('11.0'); // 5 kg shown in lb
    fireEvent.change(input, { target: { value: '22' } });
    fireEvent.blur(input);
    await waitFor(() => expect(usePlannerStore.getState().goals[0]!.amount).toBeCloseTo(9.98, 1));
  });

  it('shows pre-flight conflicts from the catalogue before running', () => {
    renderAt('/plan/goals');
    expect(screen.getAllByText('Before you run').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/pull apart/).length).toBeGreaterThan(0);
  });
});

describe('Run → results state machine (mocked planner client)', () => {
  it('shows Hard early, stops on request, keeps what was found and marks the results stale after an edit', async () => {
    const user = userEvent.setup();
    renderAt('/plan/goals');
    const call = await startRun(user);
    expect(call.request.goals.map((g) => g.metric)).toEqual(['fatMass', 'leanTissue', 'autophagyIdx']);
    expect(screen.getByText('Finding plans…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    // four slots in ladder order, never letters
    const slots = within(screen.getByRole('list', { name: 'Plan slots' })).getAllByRole('listitem');
    expect(slots.map((li) => li.querySelector('.lp-slot__name')!.textContent)).toEqual(['Hard', 'Medium', 'Easy', 'Ideal']);

    act(() => call.opts.onProgress!(progress(0.3, 80)));
    act(() => call.opts.onProgress!(progress(0.32, 82)));
    expect(screen.getByText('provisional')).toBeInTheDocument();
    expect(screen.getByText(/goal 1 at 82 %/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stop and keep what’s found' }));
    expect(call.opts.signal!.aborted).toBe(true);

    await act(async () => call.resolve(fixtureLadder({ complete: false }, { rungs: ['hard'] })));
    await waitFor(() => expect(where()).toBe('/plan/results'));
    expect(screen.getByText(/Stopped at 32 %/)).toBeInTheDocument();
    expect(screen.getByText(/Hard is ready; range checks were skipped/)).toBeInTheDocument();
    expect(screen.getByText(/Some limit costs weren’t checked/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Select Hard plan: fat mass minus 5\.2 kilograms, effort 64 of 100$/ })).toHaveAttribute('aria-pressed', 'true');

    act(() => usePlannerStore.getState().updateGoal('g1', { amount: 7 }));
    expect(await screen.findByText(/Your goals or limits changed since these plans were found/)).toBeInTheDocument();
    // the notice names the body when the body is what changed
    act(() => usePlannerStore.getState().updateGoal('g1', { amount: 5 }));
    act(() => withSystemWrite(() => useProfileStore.setState({ weightKg: 95 })));
    expect(await screen.findByText(/Your body changed since these plans were found/)).toBeInTheDocument();
  });

  it('cancels before any plan exists (hard stop) and offers to try again', async () => {
    const user = userEvent.setup();
    renderAt('/plan/goals');
    await startRun(user);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(client.cancelPlanning).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Stopped before a plan was found.')).toBeInTheDocument();
    expect(usePlannerStore.getState().run.status).toBe('cancelled');
  });

  it('reports a worker crash without losing the goals', async () => {
    const user = userEvent.setup();
    renderAt('/plan/goals');
    const call = await startRun(user);
    await act(async () => call.reject(new Error('worker crashed')));
    expect(await screen.findByText('The Planner stopped unexpectedly.')).toBeInTheDocument();
    expect(usePlannerStore.getState().goals).toHaveLength(3);
  });

  it('sends the same request (and hash) for the same inputs — deterministic runs; the store keeps the v1 view with the ladder on it', async () => {
    const user = userEvent.setup();
    renderAt('/plan/goals');
    const first = await startRun(user);
    await act(async () => first.resolve(fixtureLadder()));
    await waitFor(() => expect(where()).toBe('/plan/results'));
    const stored = usePlannerStore.getState().run.result!;
    expect(stored.options.map((o) => o.id)).toEqual(['A', 'B', 'C']);
    expect(stored.v2?.rungs.medium?.summary.subtitle).toBe('Deficit 12 % · 3 sessions · 24-h fast weekly');
    const hash = usePlannerStore.getState().run.requestHash;
    await act(() => router.navigate('/plan/goals'));
    await user.click(screen.getAllByRole('button', { name: /Find plans/ })[0]!);
    await waitFor(() => expect(client.calls).toHaveLength(2));
    // the same request, plus the last ladder of this request so its Medium and Easy can be carried forward (and its
    // Hard weighed if that search is stopped early)
    const { previous, ...again } = client.calls[1]!.request as PlannerRequest & { previous?: { rungs: Record<string, unknown> } };
    expect(again).toEqual(first.request);
    expect(Object.keys(previous?.rungs ?? {}).sort()).toEqual(['easy', 'hard', 'medium']);
    expect(usePlannerStore.getState().run.requestHash).toBe(hash);
  });
});

describe('Results: the plan ladder', () => {
  async function showResults(result: PlannerResultV2) {
    const user = userEvent.setup();
    renderAt('/plan/goals');
    const call = await startRun(user);
    await act(async () => call.resolve(result));
    await waitFor(() => expect(where()).toBe('/plan/results'));
    return user;
  }
  const card = (rung: string) => document.querySelector<HTMLElement>(`article.lp-lcard[data-rung="${rung}"]`)!;
  // the card's title row (the ladder strip's markers are the same toggles)
  const toggle = (name: RegExp) => screen.getAllByRole('button', { name }).find((b) => b.classList.contains('lp-lcard__toggle'))!;

  it('lays out Hard · Medium · Easy ‖ Ideal and selects Medium first; goals in rank order with ranges, time to target and the difference to Hard', async () => {
    await showResults(fixtureLadder());
    const cards = screen.getAllByRole('article');
    expect(cards.map((c) => c.getAttribute('data-rung'))).toEqual(['hard', 'medium', 'easy', 'ideal']);
    expect(toggle(/^Select Medium plan/)).toHaveAttribute('aria-pressed', 'true');
    expect(toggle(/^Select Hard plan/)).toHaveAttribute('aria-pressed', 'false');
    expect(toggle(/^Select Ideal, a reference without your practical limits; it can’t be started$/)).toBeInTheDocument();
    // the limits rule sits between Easy and the Ideal
    expect(screen.getByText('beyond your limits')).toBeInTheDocument();

    const hard = card('hard');
    expect(within(hard).getByText('Deficit 22 % · 4 sessions')).toBeInTheDocument();
    expect(within(hard).getByText('effort 64')).toBeInTheDocument();
    const goals = Array.from(hard.querySelectorAll<HTMLElement>('.lp-lgoal'));
    expect(goals.map((g) => g.querySelector('.lp-lgoal__name')!.textContent)).toEqual(['fat mass', 'lean tissue (protein-based)', 'autophagy signal']);
    expect(within(goals[0]!).getByText(/^−5\.2\s?kg$/)).toBeInTheDocument();
    expect(within(goals[0]!).getByText(/likely 4\.6–5\.8\s?kg/)).toBeInTheDocument();
    expect(within(goals[0]!).getByText(/reached in about 3 weeks · 80 % chance/)).toBeInTheDocument();
    expect(within(goals[1]!).getByText('kept')).toBeInTheDocument();
    expect(within(goals[2]!).getByText('↑ 62 % of what’s possible')).toBeInTheDocument();
    const medium = card('medium').querySelector<HTMLElement>('.lp-lgoal')!;
    expect(within(medium).getByText(/about 6 weeks at this plan’s effort/)).toBeInTheDocument();
    expect(within(medium).getByText(/^1\.1\s?kg less lost than Hard$/)).toBeInTheDocument();

    // the seven burdens, fixed order
    const labels = Array.from(hard.querySelectorAll('.lp-burden__label')).map((x) => x.textContent);
    expect(labels).toEqual(['deficit', 'hunger', 'training time', 'fasting load', 'eating window', 'daily decisions', 'change from now']);
    // fasting line, limits it presses, safety
    expect(within(hard).getByRole('button', { name: /no fast · a plan with 24-hour fasts was considered: why/ })).toBeInTheDocument();
    expect(within(card('medium')).getByText('24-hour fasts')).toBeInTheDocument();
    expect(within(hard).getByText('3 training days (on 71 % of days)')).toBeInTheDocument();
    expect(within(hard).getByText('within safety limits')).toBeInTheDocument();
    // Start this plan only on the selected rung; never on the Ideal
    expect(within(card('medium')).getByRole('button', { name: 'Start this plan' })).toBeInTheDocument();
    expect(within(hard).queryByRole('button', { name: 'Start this plan' })).toBeNull();
    // the planner disclaimer is printed once under the cards; why a fast was or was not used at run level
    expect(screen.getAllByText(/This plan stays inside published safety limits/)).toHaveLength(1);
    expect(screen.getByText(/Fasting was considered because the autophagy signal is one of your goals/)).toBeInTheDocument();
  });

  it('the Ideal is never startable: its card and the action adopt limits instead, and adopting runs the Planner again with them', async () => {
    const user = await showResults(fixtureLadder());
    const ideal = card('ideal');
    expect(within(ideal).getByText(/scientific ceiling/)).toBeInTheDocument();
    expect(within(ideal).getByText('what your limits cost')).toBeInTheDocument();
    expect(within(ideal).getByText(/together, through interactions: \+0\.3\s?kg fat mass loss/)).toBeInTheDocument();
    expect(within(ideal).getByText(/sleep midpoint around 03:00/)).toBeInTheDocument();
    expect(within(ideal).getByText(/Your food rules, allergies, safety answers and opt-ins still apply/)).toBeInTheDocument();
    await user.click(toggle(/^Select Ideal/));
    await waitFor(() => expect(where()).toContain('rung=ideal'));
    expect(screen.queryByRole('button', { name: 'Start this plan' })).toBeNull();

    await user.click(within(ideal).getByRole('button', { name: 'Adopt some of these limits' }));
    const panel = await screen.findByRole('dialog', { name: 'Which limits could you change?' });
    // equipment is set elsewhere: shown, not adoptable here
    expect(within(panel).getByRole('checkbox', { name: /equipment/ })).toBeDisabled();
    await user.click(within(panel).getByRole('checkbox', { name: /training days: 3 training days → 5 training days/ }));
    await user.click(within(panel).getByRole('button', { name: 'Find plans with these limits' }));
    await waitFor(() => expect(client.calls).toHaveLength(2));
    expect(usePlannerStore.getState().constraints.trainingDays).toEqual([2, 5]);
    expect(client.calls[1]!.request.constraints?.trainingDaysPerWeek).toEqual({ min: 2, max: 5 });
    await waitFor(() => expect(where()).toBe('/plan/run'));
  });

  it('shows a collapsed rung as a chip under the graph with the engine’s sentence, never as a column', async () => {
    await showResults(fixtureLadder({}, { rungs: ['hard', 'easy'] }));
    expect(screen.getAllByRole('article').map((c) => c.getAttribute('data-rung'))).toEqual(['hard', 'easy', 'ideal']);
    const chip = document.querySelector<HTMLElement>('.lp-ladder-face .lp-lchip[data-rung="medium"]')!;
    expect(chip.textContent).toBe('M' + 'medium · not distinct · Easy already reaches 95 % of Hard’s fat loss; a harder plan buys little.');
    expect(document.querySelector('.lp-ladder [data-col="medium"]')).toBeNull();
    // without Medium, Hard is selected first
    expect(toggle(/^Select Hard plan/)).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches to the comparison table in the contract’s order', async () => {
    const user = await showResults(fixtureLadder());
    const bank = screen.getByRole('radiogroup', { name: 'Show the plans as' });
    await user.click(within(bank).getByRole('radio', { name: 'table' }));
    await waitFor(() => expect(where()).toContain('view=table'));
    const table = screen.getByRole('table', { name: /The plans side by side/ });
    const rowLabels = within(table)
      .getAllByRole('rowheader')
      .map((th) => th.textContent);
    expect(rowLabels).toEqual([
      'effort',
      'deficit',
      'hunger',
      'training time',
      'fasting load',
      'eating window',
      'daily decisions',
      'change from now',
      '1 · fat mass',
      '2 · lean tissue (protein-based)',
      '3 · autophagy signal',
      'time to target',
      'hunger',
      'weekly training time',
      'eating window',
      'fasting',
      'things to buy',
      'limits it presses',
      'safety',
      'what your limits cost',
    ]);
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Measure', 'HHard', 'MMedium', 'EEasy', 'IIdeal']);
  });

  it('selects with the keyboard, prescribes a training day and a water-only day, and prints by rung name', async () => {
    const user = await showResults(fixtureLadder());
    toggle(/^Select Medium plan/).focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(where()).toContain('rung=easy'));
    expect(toggle(/^Select Easy plan/)).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    await waitFor(() => expect(where()).toContain('rung=hard'));

    await user.click(screen.getByRole('tab', { name: 'days' }));
    await waitFor(() => expect(where()).toContain('tab=days'));
    const table = screen.getByRole('table', { name: /Hard plan, week 1/ });
    const dayButtons = within(table).getAllByRole('button');
    expect(dayButtons).toHaveLength(7);
    await user.click(dayButtons[0]!);
    const mon = screen.getByRole('region', { name: /Prescription for Mon 5 Oct/ });
    expect(within(mon).getByText(/resistance · \d+ hard sets · 18:00 · 60 min/)).toBeInTheDocument();
    expect(within(mon).getByText('protein').nextElementSibling!.textContent).toMatch(/^180/);
    await user.click(dayButtons[3]!);
    const thu = screen.getByRole('region', { name: /Prescription for Thu 8 Oct/ });
    expect(within(thu).getByText(/no food today/)).toBeInTheDocument();

    const print = vi.fn();
    const orig = window.print;
    window.print = print;
    try {
      await user.click(screen.getByRole('button', { name: 'Print day by day' }));
      await waitFor(() => expect(print).toHaveBeenCalled());
      const sheet = document.querySelector<HTMLElement>('.lp-print-root')!;
      expect(sheet.querySelector('h1')!.textContent).toBe('Hard plan: Deficit 22 % · 4 sessions');
      // the one-page ladder summary comes first
      expect(sheet.querySelector('.lp-print__ladder')!.textContent).toMatch(/HardMediumEasyIdeal/);
      expect(sheet.textContent).not.toMatch(/\bPlan [ABC]\b/);
      act(() => {
        window.dispatchEvent(new Event('afterprint'));
      });
      await waitFor(() => expect(document.querySelector('.lp-print-root')).toBeNull());
    } finally {
      window.print = orig;
    }
  });

  it('opens a rung in the Simulator as a scenario named after the rung', async () => {
    const user = await showResults(fixtureLadder());
    await user.click(toggle(/^Select Hard plan/));
    const before = useScheduleStore.getState().scenarios.length;
    await user.click(within(card('hard')).getByRole('button', { name: 'Open in Simulator' }));
    const sc = useScheduleStore.getState().scenarios;
    expect(sc).toHaveLength(before + 1);
    const created = sc[sc.length - 1]!;
    expect(created.name).toBe('Hard plan · Deficit 22 % · 4 sessions');
    expect(created.provenance).toMatch(/^from the Hard plan · /);
    expect(useScheduleStore.getState().activeId).toBe(created.id);
    await waitFor(() => expect(where()).toBe(`/simulate/${created.id}/schedule`));
  });

  it('explains a result with no safe plan, shows what blocks it from the Ideal and offers the horizon it needs', async () => {
    const base = fixtureLadder();
    await showResults({
      ...base,
      status: 'noSafePlan',
      rungs: {},
      feasibility: [{ ...base.feasibility[0]!, status: 'unattainable', bestAchievable: 21.4, requiredWeeks: 9, text: 'The fastest safe plan reaches 3.6 kg.' }],
      noSafePlanReasons: ['no fasts over 16 h'],
    });
    expect(screen.getByText(/No safe plan reaches fat mass lose 5\.0\s?kg in 4 weeks within your limits\./)).toBeInTheDocument();
    expect(screen.getByText('no fasts over 16 h')).toBeInTheDocument();
    expect(screen.getByText(/Without your practical limits it’s reachable/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Extend to 9 weeks' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Adopt some of these limits' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Start this plan' })).toBeNull();
  });

  it('shows planner energy in kJ when Settings say kJ', async () => {
    withSystemWrite(() => useSettingsStore.setState({ energyUnit: 'kJ' }));
    try {
      const user = await showResults(fixtureLadder());
      await user.click(screen.getByRole('tab', { name: 'days' }));
      const table = screen.getByRole('table', { name: /Medium plan, week 1/ });
      expect(within(table).getByRole('columnheader', { name: /energy kJ/ })).toBeInTheDocument();
      expect(document.querySelector('.lp-days-tab')!.textContent).not.toMatch(/kcal/);
      await user.click(screen.getByRole('tab', { name: 'safety' }));
      expect(screen.getByText(/A weekly average under 5\s020\skJ \(women\) or 6\s280\skJ \(men\)/)).toBeInTheDocument();
    } finally {
      withSystemWrite(() => useSettingsStore.setState({ energyUnit: 'kcal' }));
    }
  });

  it('never names a plan by a letter: copy, labels, URLs, tabs', async () => {
    const user = await showResults(fixtureLadder());
    const LETTER = /\b(?:[Pp]lans?|[Oo]ptions?) [ABC]\b|\b[ABC]\/[ABC]\b/;
    const check = () => {
      expect(document.body.textContent).not.toMatch(LETTER);
      for (const el of Array.from(document.querySelectorAll('[aria-label], [title]')))
        expect(`${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`).not.toMatch(LETTER);
      expect(where()).not.toMatch(/[?&]plan=/);
    };
    check();
    for (const t of ['overview', 'days', 'curves', 'limits', 'safety']) {
      await user.click(screen.getByRole('tab', { name: t }));
      check();
    }
    await user.click(toggle(/^Select Ideal/));
    for (const t of ['overview', 'curves', 'limits']) {
      await user.click(screen.getByRole('tab', { name: t }));
      check();
    }
    // curves: direct end labels by rung name, the Ideal dashed
    await user.click(screen.getByRole('tab', { name: 'curves' }));
    expect(document.querySelector('.lp-curve__line[data-rung="ideal"]')).not.toBeNull();
    expect(Array.from(document.querySelectorAll('.lp-curve__end')).map((e) => e.textContent!.split(' ')[0])).toEqual(expect.arrayContaining(['Hard', 'Medium', 'Easy', 'Ideal']));
  });
});

describe('Results: the ladder at every size (all four, three, Ideal equals Hard, Hard only)', () => {
  async function showResults(result: PlannerResultV2) {
    const user = userEvent.setup();
    renderAt('/plan/goals');
    const call = await startRun(user);
    await act(async () => call.resolve(result));
    await waitFor(() => expect(where()).toBe('/plan/results'));
    return user;
  }
  const cards = () => Array.from(document.querySelectorAll<HTMLElement>('.lp-ladder article.lp-lcard')).map((c) => c.getAttribute('data-rung'));
  const chips = () => Array.from(document.querySelectorAll<HTMLElement>('.lp-lchip')).map((c) => [c.getAttribute('data-rung'), c.querySelector('.lp-lchip__text')!.textContent]);
  const CAPTION = 'The Ideal is not meant to be harder, only free of your practical limits.';
  const SAME = 'None of your limits is binding; the Ideal is this same plan.';

  /** Every card: the compact "now · your limit" legend and the effort footer with its own number. */
  function expectEffortParts() {
    for (const c of Array.from(document.querySelectorAll<HTMLElement>('.lp-ladder article.lp-lcard'))) {
      expect(c.querySelector('.lp-burden__legend')!.textContent).toMatch(/^nowyour limit/);
      const effort = c.querySelector('.lp-lcard__effort')!.textContent!.replace('effort ', '');
      expect(c.querySelector('.lp-burden__foot')!.textContent).toBe(`effort ${effort} is the average of these seven parts.`);
    }
  }
  /** The grid holds only the cards: one column per card, the rule only with an Ideal card. */
  function expectGrid(n: number, inside: number, ideal: boolean) {
    const grid = document.querySelector<HTMLElement>('.lp-ladder')!;
    expect(grid.getAttribute('data-n')).toBe(String(n));
    expect(grid.style.getPropertyValue('--lp-inside')).toBe(String(inside));
    expect(grid.hasAttribute('data-ideal')).toBe(ideal);
    expect(grid.querySelectorAll('.lp-ladder__col')).toHaveLength(n);
    expect(grid.querySelectorAll('.lp-ladder__rule')).toHaveLength(ideal ? 1 : 0);
  }

  it('all four: four cards, no chips, the ladder graph on the worded effort axis, the caption', async () => {
    await showResults(fixtureLadderCase('four'));
    expect(cards()).toEqual(['hard', 'medium', 'easy', 'ideal']);
    expectGrid(4, 3, true);
    expect(chips()).toEqual([]);
    expect(document.querySelector('.lp-scale')!.getAttribute('data-mode')).toBe('ladder');
    expect(document.querySelector('.lp-scale__xlabel')!.textContent).toBe('Effort (0 = how you live now, 100 = your limits)');
    expect(document.querySelector('.lp-scale__axis')!.textContent).not.toMatch(/effort/);
    expect(document.querySelector('.lp-scale__how')!.textContent).toContain(CAPTION);
    expectEffortParts();
    expect(screen.queryByText(SAME)).toBeNull();
    // the Ideal runs past your limit here: it says so (section label, legend, accessible text)
    const ideal = document.querySelector<HTMLElement>('article[data-rung="ideal"]')!;
    expect(within(ideal).getByText('effort (past your limits)')).toBeInTheDocument();
    expect(ideal.querySelector('.lp-burden__legend')!.textContent).toContain('past your limit');
    expect(ideal.querySelectorAll('.lp-burden__over').length).toBeGreaterThan(0);
    for (const k of ['hard', 'medium', 'easy']) {
      const c = document.querySelector<HTMLElement>(`article[data-rung="${k}"]`)!;
      expect(c.querySelectorAll('.lp-burden__over')).toHaveLength(0);
      expect(within(c).getByText('effort')).toBeInTheDocument();
    }
  });

  it('three: Hard, Easy (carried from the quick search) and the Ideal, with a Medium chip and its reason', async () => {
    const user = await showResults(fixtureLadderCase('three'));
    expect(cards()).toEqual(['hard', 'easy', 'ideal']);
    expectGrid(3, 2, true);
    expect(chips()).toEqual([['medium', 'medium · It would repeat Hard or Easy with small changes.']]);
    const easy = document.querySelector<HTMLElement>('article[data-rung="easy"]')!;
    expect(easy.hasAttribute('data-carried')).toBe(true);
    expect(within(easy).getByText('from the quick search')).toBeInTheDocument();
    expect(document.querySelector('article[data-rung="hard"] .lp-lcard__carried')).toBeNull();
    expectEffortParts();
    // an exhaustive search ran: the graph opens on its convergence curve; "ladder · search" switches to the rungs
    const scale = document.querySelector<HTMLElement>('.lp-scale')!;
    expect(scale.getAttribute('data-mode')).toBe('search');
    expect(scale.querySelector('polyline.lp-scale__search')!.getAttribute('points')!.split(' ').length).toBeGreaterThan(10);
    expect(scale.querySelector('.lp-scale__xlabel')!.textContent).toBe('plans searched');
    const view = within(scale).getByRole('radiogroup', { name: 'Show the graph as' });
    await user.click(within(view).getByRole('radio', { name: 'ladder' }));
    expect(scale.getAttribute('data-mode')).toBe('ladder');
    expect(scale.querySelector('.lp-scale__xlabel')!.textContent).toBe('Effort (0 = how you live now, 100 = your limits)');
    await user.click(within(view).getByRole('radio', { name: 'search' }));
    expect(scale.getAttribute('data-mode')).toBe('search');
  });

  it('a quick search (tier S) with two or more markers has no graph switch', async () => {
    await showResults(fixtureLadderCase('four'));
    expect(document.querySelector('.lp-scale')!.getAttribute('data-mode')).toBe('ladder');
    expect(screen.queryByRole('radiogroup', { name: 'Show the graph as' })).toBeNull();
  });

  it('a stopped search that skipped the Ideal says so in the stopped notice', async () => {
    const v2 = fixtureLadderCase('hardOnly');
    await showResults({ ...v2, complete: false, stoppedAt: 'S3', ideal: null, idealSkipped: 'stopped' });
    expect(screen.getByText(/The Ideal \(your plan without the practical limits\) wasn’t searched\./)).toBeInTheDocument();
    expect(document.querySelector('.lp-scale')!.getAttribute('data-mode')).toBe('search');
  });

  it('Ideal equals Hard: no Ideal card; Hard says so in one line and lists the limits lifted without effect', async () => {
    const user = await showResults(fixtureLadderCase('sameAsHard'));
    expect(cards()).toEqual(['hard']);
    expectGrid(1, 1, false);
    expect(screen.queryByText('beyond your limits')).toBeNull();
    expect(chips().map((c) => c[0])).toEqual(['medium', 'easy']);
    const hard = document.querySelector<HTMLElement>('article[data-rung="hard"]')!;
    expect(within(hard).getByText(SAME)).toBeInTheDocument();
    const lifted = hard.querySelector<HTMLDetailsElement>('details.lp-lcard__lifted')!;
    expect(lifted.querySelector('summary')!.textContent).toBe('3 limits lifted without effect');
    expect(Array.from(lifted.querySelectorAll('li')).map((li) => li.textContent)).toEqual([
      'training days: 3 → up to 6',
      'eating window: 8 h → wake + 30 min to 3 h before bed',
      'longest fast: 24 h → 72 h',
    ]);
    // one line only: no second bar set anywhere
    expect(document.querySelectorAll('.lp-ladder .lp-burden')).toHaveLength(1);
    expect(screen.getAllByText(SAME)).toHaveLength(1);
    // the graph: the search's convergence (one rung marker), the ceiling is Hard's own value
    expect(document.querySelector('.lp-scale')!.getAttribute('data-mode')).toBe('search');
    expect(document.querySelector('.lp-scale__ceil-text')!.textContent).toMatch(/^ceiling = Hard −5\.2/);
    expect(document.querySelector('.lp-scale__how')!.textContent).toContain(CAPTION);
    // ?rung=ideal lands on Hard; the table drops the Ideal column and carries the line above it
    expect(screen.queryByRole('button', { name: /^Select Ideal/ })).toBeNull();
    const bank = screen.getByRole('radiogroup', { name: 'Show the plans as' });
    await user.click(within(bank).getByRole('radio', { name: 'table' }));
    await waitFor(() => expect(where()).toContain('view=table'));
    const table = screen.getByRole('table', { name: /The plans side by side/ });
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Measure', 'HHard']);
    expect(within(table).queryByRole('rowheader', { name: 'what your limits cost' })).toBeNull();
    expect(screen.getByText(SAME)).toBeInTheDocument();
  });

  it('an older result that only says nothing binds reads the same way (the relaxed list)', async () => {
    const v2 = fixtureLadderCase('sameAsHard');
    const { sameAsHard: _s, ...ideal } = v2.ideal!;
    await showResults({ ...v2, ideal });
    expect(cards()).toEqual(['hard']);
    const items = Array.from(document.querySelectorAll('details.lp-lcard__lifted li')).map((li) => li.textContent);
    expect(items).toEqual(['training days: 3 → up to 6', 'eating window: 8 h → wake + 30 min to 3 h before bed']);
  });

  it('Hard only: one full-width card, two chips with their reasons, the graph still a curve with worded axes', async () => {
    await showResults(fixtureLadderCase('hardOnly'));
    expect(cards()).toEqual(['hard']);
    expectGrid(1, 1, false);
    expect(chips()).toEqual([
      ['medium', 'medium · It would repeat Hard or Easy with small changes.'],
      ['easy', 'easy · No plan with less effort than Hard reaches half of Hard’s fat loss: the closest reached 41 % at effort 22.'],
    ]);
    expectEffortParts();
    const scale = document.querySelector<HTMLElement>('.lp-scale')!;
    expect(scale.getAttribute('data-mode')).toBe('search');
    const line = scale.querySelector('polyline.lp-scale__search')!;
    expect(line.getAttribute('points')!.split(' ').length).toBeGreaterThan(10);
    expect(scale.querySelector('.lp-scale__xlabel')!.textContent).toBe('plans searched');
    expect(scale.querySelector('.lp-scale__title')!.textContent).toContain('goal 1 · fat mass');
    expect(scale.textContent).toMatch(/The search tried 240\s000 plans; the best result stopped improving after about 160\s000 at −5\.2 kg\./);
    expect(within(scale).getByRole('button', { name: /^Select Hard plan/ })).toBeInTheDocument();
    // no Ideal: no caption about it
    expect(scale.querySelector('.lp-scale__how')!.textContent).not.toContain(CAPTION);
  });

  it('row hover only where a row does something: goal rows open Explain; nothing paints the other rows', async () => {
    const user = await showResults(fixtureLadderCase('four'));
    const hard = document.querySelector<HTMLElement>('article[data-rung="hard"]')!;
    expect(hard.querySelectorAll('[data-hover]')).toHaveLength(0);
    const goalRows = hard.querySelectorAll('button.lp-lgoal.lp-rowbtn');
    expect(goalRows).toHaveLength(3);
    fireEvent.mouseEnter(goalRows[0]!);
    expect(document.querySelectorAll('[data-hover]')).toHaveLength(0);
    await user.click(goalRows[0]!);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(where()).toContain('rung=hard'));
  });
});

// Q7 (Q3-J4-09 follow-up): "Stopping keeps the plans found so far" — a long search stopped early with a result worse
// than or less complete than the quick search's ladder leaves that ladder on screen and says the search was stopped
describe('Results: a stopped long search keeps the quick search’s ladder', () => {
  async function quickThenLong(stoppedWith: (quick: PlannerResultV2) => PlannerResultV2) {
    const user = userEvent.setup();
    renderAt('/plan/goals');
    const first = await startRun(user);
    const quick = fixtureLadder();
    await act(async () => first.resolve(quick));
    await waitFor(() => expect(where()).toBe('/plan/results'));
    const { request, requestHash } = usePlannerStore.getState().run;
    // "Start the long search" (desktop only on the page): the same request at tier X
    let long: Promise<void> = Promise.resolve();
    act(() => {
      long = startPlannerRun(request!, requestHash!, { tier: 'X' });
    });
    await waitFor(() => expect(client.calls).toHaveLength(2));
    expect(client.calls[1]!.opts.tier).toBe('X');
    expect(Object.keys((client.calls[1]!.request as { previous?: { rungs: object } }).previous?.rungs ?? {}).sort()).toEqual(['easy', 'hard', 'medium']);
    act(() => stopPlannerRun());
    await waitFor(() => expect(client.calls[1]!.opts.signal!.aborted).toBe(true));
    await act(async () => client.calls[1]!.resolve(stoppedWith(quick)));
    await act(() => long);
    await waitFor(() => expect(usePlannerStore.getState().run.status).toBe('done'));
    return quick;
  }
  const cards = () => Array.from(document.querySelectorAll<HTMLElement>('.lp-ladder article.lp-lcard')).map((c) => c.getAttribute('data-rung'));
  const KEPT = 'The long search was stopped; showing the plans from the quick search.';
  const stoppedX = (quick: PlannerResultV2, over: Partial<PlannerResultV2>, rungs: Array<'hard' | 'medium' | 'easy'>) =>
    fixtureLadder({ complete: false, stoppedAt: 'S0', ideal: null, idealSkipped: 'stopped', provenance: { ...quick.provenance, tier: 'X' }, ...over }, { rungs, ideal: false });

  it('a near-empty Hard alone (stopped in the first phase) leaves Hard, Medium, Easy and the Ideal of the quick search, and says so', async () => {
    const quick = await quickThenLong((q) => {
      const v2 = stoppedX(q, {}, ['hard']);
      const h = v2.rungs.hard!;
      // the barely searched start point: 0.1 kg of fat instead of the quick Hard's 5.2
      v2.rungs.hard = { ...h, genome: { structureId: 's-early', x: [0.1] }, scorecard: h.scorecard.map((s, i) => (i === 0 ? { ...s, value: 24.9, change: -0.1, met: false, verdict: 'notReached' as const } : s)) };
      return v2;
    });
    await waitFor(() => expect(screen.getByText(KEPT)).toBeInTheDocument());
    expect(screen.getByText('It had found fewer plans than these.')).toBeInTheDocument();
    expect(cards()).toEqual(['hard', 'medium', 'easy', 'ideal']);
    // the kept ladder is the quick search's, complete: no "Stopped at" notice
    expect(screen.queryByText(/Stopped at/)).toBeNull();
    const kept = usePlannerStore.getState().run.result!;
    expect(kept.options).toHaveLength(3);
    expect(kept.v2!.rungs.hard!.genome).toEqual(quick.rungs.hard!.genome);
    expect(kept.v2!.ideal).not.toBeNull();
    expect(kept.v2!.keptAfterStop).toEqual({ tier: 'X', stoppedAt: 'S0', why: 'fewerRungs' });
    // planner.result (additive): the same ladder, and which search was stopped
    const summary = ladderSummary(kept)!;
    expect(summary.tier).toBe('S');
    expect(summary.rungs.map((r) => r.kind)).toEqual(['hard', 'medium', 'easy']);
    expect(summary.ideal).not.toBeNull();
    expect(summary.keptAfterStop).toBe('X');
  });

  it('every rung but a weaker Hard: the quick ladder stays (Hard is compared on goal 1)', async () => {
    await quickThenLong((q) => {
      const v2 = stoppedX(q, { stoppedAt: 'S3' }, ['hard', 'medium', 'easy']);
      const h = v2.rungs.hard!;
      v2.rungs.hard = { ...h, genome: { structureId: 's-x', x: [0.2] }, scorecard: h.scorecard.map((s, i) => (i === 0 ? { ...s, value: 21, change: -4 } : s)) };
      return v2;
    });
    await waitFor(() => expect(screen.getByText(KEPT)).toBeInTheDocument());
    expect(usePlannerStore.getState().run.result!.v2!.keptAfterStop?.why).toBe('weakerHard');
  });

  it('a stopped long search with a better Hard and every rung replaces the ladder (stopped notice, no kept notice)', async () => {
    await quickThenLong((q) => {
      const v2 = stoppedX(q, { stoppedAt: 'S4' }, ['hard', 'medium', 'easy']);
      const h = v2.rungs.hard!;
      v2.rungs.hard = { ...h, genome: { structureId: 's-x', x: [0.9] }, scorecard: h.scorecard.map((s, i) => (i === 0 ? { ...s, value: 19.2, change: -5.8 } : s)) };
      return v2;
    });
    await waitFor(() => expect(screen.getByText(/Stopped at/)).toBeInTheDocument());
    expect(screen.queryByText(KEPT)).toBeNull();
    const r = usePlannerStore.getState().run.result!;
    expect(r.v2!.keptAfterStop).toBeUndefined();
    expect(r.v2!.rungs.hard!.genome.structureId).toBe('s-x');
    expect(r.v2!.idealSkipped).toBe('stopped');
  });
});
