import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlanDetailsPage, { planTitle } from '../PlanDetailsPage';
import { renderLiving } from '../../testing';
import { FIXTURE_TODAY, fixturePlan } from '../../data/fixtures';
import { useActivePlanStore } from '../../activePlan';
import { EXPERIMENTAL_TRACKING_NOTE } from '@/lib/experimentalTracking';
import type { PlanDoc, PlanVersionDoc } from '@/living/types';

const routes = [
  { path: 'plan/goals', element: <h1>goals</h1> },
  { path: 'plan', element: <h1>planner</h1> },
  { path: 'today', element: <h1>today</h1> },
];

/** Opens the header's one ⋯ ("More") and returns its menu. */
async function openMore(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'More' }));
  return screen.findByRole('menu');
}

describe('planTitle', () => {
  it('keeps a name the person gave the plan', () => {
    expect(planTitle({ name: 'Spring cut', rung: 'medium' })).toBe('Spring cut');
    expect(planTitle({ name: 'My cut', rung: 'custom' })).toBe('My cut');
  });
  it('turns an internal tag into plain words', () => {
    expect(planTitle({ name: 'Coach: medium', rung: 'medium' })).toBe('Medium plan');
    expect(planTitle({ name: 'planner:hard', rung: 'hard' })).toBe('Hard plan');
    expect(planTitle({ name: 'easy', rung: 'easy' })).toBe('Easy plan');
  });
  it('names an unnamed plan by its rung, or "Your plan"', () => {
    expect(planTitle({ name: '  ', rung: 'medium' })).toBe('Medium plan');
    expect(planTitle({ name: '', rung: 'custom' })).toBe('Your plan');
  });
});

describe('Plan details', () => {
  it('keeps experimental disclosures collapsed and identifies the tracking mode without a Verified claim', async () => {
    const plan = fixturePlan(FIXTURE_TODAY);
    renderLiving(<PlanDetailsPage />, { path: '/plan/active', route: 'plan/active', routes, plan: {
      ...plan,
      doc: { request: { constraints: { experimentalTracking: true } } } as unknown as PlanDoc & { id: string },
      version: { experimentalWarnings: [EXPERIMENTAL_TRACKING_NOTE, 'HC-E3: preset deficit limit exceeded.'], forecast: { fromDay: 0, asPrescribed: {}, realistic: {}, goals: [], warnings: [] } } as unknown as PlanVersionDoc,
    } });
    expect(await screen.findByText('Experimental tracking')).toBeInTheDocument();
    const summary = screen.getByText('Experimental model notes');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    expect(screen.getByText(EXPERIMENTAL_TRACKING_NOTE)).not.toBeVisible();
    expect(screen.queryByText(/^Safety · Verified$/)).not.toBeInTheDocument();
  });

  it('shows a plan-day track, compact facts, the ease switch and version timeline', async () => {
    renderLiving(<PlanDetailsPage />, { path: '/plan/active', route: 'plan/active', routes });
    expect(await screen.findByRole('heading', { level: 1, name: 'Plan details' })).toBeInTheDocument();
    // a pushed page: Back follows history
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Spring cut' })).toBeInTheDocument();
    // a running plan shows no status row; day, end and check-in are plain rows
    expect(screen.queryByText('Running')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Day \d+ of \d+/ })).toBeInTheDocument();
    const tracks = screen.getAllByRole('meter', { name: 'Day' });
    expect(tracks).toHaveLength(2);
    expect(tracks[0]).toHaveAttribute(
      'aria-valuetext',
      expect.stringMatching(/Day \d+ of \d+, week \d+ of \d+/),
    );
    expect(screen.getAllByText(/Week \d+ of \d+/)).toHaveLength(2);
    expect(screen.getByText(/^[A-Z][a-z]+days$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'About Spring cut' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'About Versions' })).toBeInTheDocument();
    const sw = screen.getByRole('switch', { name: 'Let the plan ease itself' });
    expect(sw).toBeChecked();
    expect(screen.getAllByText('Let the plan ease itself')).toHaveLength(1);
    // no helper paragraph under the switch: when it applies is the switch's accessible description only
    expect(sw).toHaveAccessibleDescription(
      'After a missed day, lighter changes apply straight away, with Undo.',
    );
    expect(
      screen.getByText('After a missed day, lighter changes apply straight away, with Undo.'),
    ).toHaveClass('lm-sr');
    // the lifecycle is not a card of keys on the page: it lives in the header ⋯
    expect(screen.queryByRole('heading', { name: 'Change the plan' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^(Pause plan|Re-plan|End plan…)$/ }),
    ).not.toBeInTheDocument();
    // no device-data paragraph, no disambiguation note, no "going easier" label
    expect(screen.queryByText(/poor sleep|signs of strain/)).not.toBeInTheDocument();
    expect(screen.queryByText(/small plan edits/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'going easier' })).not.toBeInTheDocument();
    // no dead intentions section, no "coming soon" key
    expect(screen.queryByRole('button', { name: 'Edit intentions' })).not.toBeInTheDocument();
    expect(screen.queryByText(/No intentions set|coming soon/)).not.toBeInTheDocument();
    // nothing waiting → no "Waiting for you" section
    expect(screen.queryByText('Nothing is waiting for you.')).not.toBeInTheDocument();
    // version rows: plain, the planner's sentence is gone
    expect(
      screen.getByRole('link', { name: /^v3 · \w{3} \d{1,2} \w{3} · Thursday lift moved to Friday/ }),
    ).toHaveAttribute('href', '/plan/active/versions/3');
    const v1 = screen.getByRole('link', { name: /^v1 · / });
    expect(v1.textContent).not.toMatch(/This plan reaches|started/);
  });

  it('titles a plan stored under an internal tag in plain words', async () => {
    const plan = fixturePlan(FIXTURE_TODAY);
    renderLiving(<PlanDetailsPage />, {
      path: '/plan/active',
      route: 'plan/active',
      routes,
      plan: { ...plan, name: 'Coach: medium', rung: 'medium' },
    });
    expect(await screen.findByRole('heading', { level: 2, name: 'Medium plan' })).toBeInTheDocument();
    expect(screen.queryByText('Coach: medium')).not.toBeInTheDocument();
  });

  it('puts the plan’s own actions in the header ⋯, and only those (places are in the navigation, r068 U14)', async () => {
    const user = userEvent.setup();
    renderLiving(<PlanDetailsPage />, { path: '/plan/active', route: 'plan/active', routes });
    await screen.findByRole('heading', { level: 1, name: 'Plan details' });
    const menu = await openMore(user);
    const names = within(menu)
      .getAllByRole('menuitem')
      .map((el) => el.textContent);
    expect(names.slice(0, 4)).toEqual([
      'Pause plan',
      'Re-plan the rest (same goals)',
      'Re-plan from scratch',
      'End plan…',
    ]);
    expect(names).not.toContain('Settings');
    expect(within(menu).getByRole('menuitem', { name: 'End plan…' })).toHaveAttribute('data-tone', 'danger');
  });

  it('lists the intentions as rows when the plan has them', async () => {
    const plan = fixturePlan(FIXTURE_TODAY);
    renderLiving(<PlanDetailsPage />, {
      path: '/plan/active',
      route: 'plan/active',
      routes,
      plan: {
        ...plan,
        intentions: { weighInClockH: 7, trainingWeekdays: [0, 2, 4], missedSessionPlan: 'nextDay' },
      },
    });
    expect(await screen.findByText('Weigh-in')).toBeInTheDocument();
    expect(screen.getByText('07:00')).toBeInTheDocument();
    expect(screen.getByText('Training')).toBeInTheDocument();
    expect(screen.getByText('Missed session')).toBeInTheDocument();
    expect(screen.getByText('moves to the next day')).toBeInTheDocument();
  });

  it('turns the ease switch off through the actions', async () => {
    const user = userEvent.setup();
    const h = renderLiving(<PlanDetailsPage />, { path: '/plan/active', route: 'plan/active', routes });
    const sw = await screen.findByRole('switch', { name: 'Let the plan ease itself' });
    await user.click(sw);
    expect(sw).not.toBeChecked();
    expect(h.stub.inspect().autoEase).toBe(false);
  });

  it('pauses and resumes the plan', async () => {
    const user = userEvent.setup();
    renderLiving(<PlanDetailsPage />, { path: '/plan/active', route: 'plan/active', routes });
    await screen.findByRole('heading', { level: 1, name: 'Plan details' });
    await user.click(within(await openMore(user)).getByRole('menuitem', { name: 'Pause plan' }));
    const sheet = await screen.findByRole('dialog', { name: 'Pause plan' });
    expect(within(sheet).getByText('You resume')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    await user.type(within(sheet).getByLabelText('Reason (optional)'), 'travel');
    await user.click(within(sheet).getByRole('button', { name: 'Pause' }));
    expect(await screen.findByText('Paused')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Pause plan' })).not.toBeInTheDocument());
    // a paused plan resumes from its Paused row; the ⋯ has nothing to pause meanwhile
    const menu = await openMore(user);
    expect(within(menu).queryByRole('menuitem', { name: 'Pause plan' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Resume plan' }));
    await waitFor(() => expect(screen.queryByText('Paused')).not.toBeInTheDocument());
    expect(within(await openMore(user)).getByRole('menuitem', { name: 'Pause plan' })).toBeInTheDocument();
  });

  it('ends the plan after a plain confirm', async () => {
    const user = userEvent.setup();
    renderLiving(<PlanDetailsPage />, { path: '/plan/active', route: 'plan/active', routes });
    await screen.findByRole('heading', { level: 1, name: 'Plan details' });
    await user.click(within(await openMore(user)).getByRole('menuitem', { name: 'End plan…' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'End plan?' });
    expect(within(dialog).getByText('You can restore it for 7 days.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
    // Cancel keeps the plan
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'planner' })).not.toBeInTheDocument();
    await user.click(within(await openMore(user)).getByRole('menuitem', { name: 'End plan…' }));
    const again = await screen.findByRole('alertdialog', { name: 'End plan?' });
    await user.click(within(again).getByRole('button', { name: 'End plan' }));
    expect(await screen.findByRole('heading', { name: 'planner' })).toBeInTheDocument();
  });

  it('re-plans from scratch: opens the goals with the plan prefilled and turns the planning override on', async () => {
    const user = userEvent.setup();
    const h = renderLiving(<PlanDetailsPage />, { path: '/plan/active', route: 'plan/active', routes });
    await screen.findByRole('heading', { level: 1, name: 'Plan details' });
    await user.click(within(await openMore(user)).getByRole('menuitem', { name: 'Re-plan from scratch' }));
    expect(await screen.findByRole('heading', { name: 'goals' })).toBeInTheDocument();
    expect(h.router.state.location.pathname).toBe('/plan/goals');
    expect(h.router.state.location.search).toBe('?from=active');
    expect(useActivePlanStore.getState().planningOverride).toBe(true);
  });

  it('re-plans the rest: a proposal waits on Today', async () => {
    const user = userEvent.setup();
    const h = renderLiving(<PlanDetailsPage />, { path: '/plan/active', route: 'plan/active', routes });
    await screen.findByRole('heading', { level: 1, name: 'Plan details' });
    await user.click(
      within(await openMore(user)).getByRole('menuitem', { name: 'Re-plan the rest (same goals)' }),
    );
    expect(await screen.findByRole('heading', { name: 'today' })).toBeInTheDocument();
    expect(h.stub.inspect().changes.some((c) => c.title.startsWith('Proposal · re-plan the remaining'))).toBe(
      true,
    );
  });

  it('shows version changes as rows and keeps their table in its information panel', async () => {
    const user = userEvent.setup();
    renderLiving(<PlanDetailsPage />, {
      path: '/plan/active/versions/3',
      route: 'plan/active/versions/:n',
      routes,
    });
    expect(
      await screen.findByRole('heading', { level: 1, name: /^Version 3 · \w{3} \d{1,2} \w{3}$/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to Plan details' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'All versions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Day' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Before → after' })).toBeInTheDocument();
    expect(within(table).getByText('Thu lift 45 min → Fri lift 45 min')).toBeInTheDocument();
    expect(within(table).getByText('Thursday sessions were done 1 time in 4')).toBeInTheDocument();
  });

  it('the first version reads as the plan as first chosen, in one line', async () => {
    renderLiving(<PlanDetailsPage />, {
      path: '/plan/active/versions/1',
      route: 'plan/active/versions/:n',
      routes,
    });
    expect(await screen.findByRole('heading', { level: 1, name: /^Version 1 · / })).toBeInTheDocument();
    expect(screen.queryByText(/This plan reaches/)).not.toBeInTheDocument();
  });

  it('opens the plan explanation without changing the plan', async () => {
    const user = userEvent.setup();
    const h = renderLiving(<PlanDetailsPage />, { path: '/plan/active', route: 'plan/active', routes });
    await user.click(await screen.findByRole('button', { name: 'About Spring cut' }));
    expect(await screen.findByRole('dialog', { name: 'Your plan' })).toBeInTheDocument();
    expect(screen.getByText(/The plan runs day by day/)).toBeInTheDocument();
    expect(h.stub.inspect().autoEase).toBe(true);
  });

  it('keeps the training week as labelled day marks', async () => {
    const plan = fixturePlan(FIXTURE_TODAY);
    renderLiving(<PlanDetailsPage />, {
      path: '/plan/active',
      route: 'plan/active',
      routes,
      plan: { ...plan, intentions: { trainingWeekdays: [0, 2, 4] } },
    });
    expect(await screen.findByRole('img', { name: 'Training days: Mon · Wed · Fri' })).toBeInTheDocument();
  });

  it('keeps plan facts in quiet mode and hides forecast outcome dates and the numeric table', async () => {
    renderLiving(<PlanDetailsPage />, {
      path: '/plan/active/versions/3',
      route: 'plan/active/versions/:n',
      routes,
      source: (stub) => ({
        ...stub.source,
        today: (date) => {
          const view = stub.source.today(date);
          return view ? { ...view, quietMode: true } : view;
        },
      }),
    });
    expect(await screen.findByRole('meter', { name: 'Day' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Table' })).not.toBeInTheDocument();
    expect(screen.queryByText('Goal dates')).not.toBeInTheDocument();
  });

  it('says so when a version does not exist', async () => {
    renderLiving(<PlanDetailsPage />, {
      path: '/plan/active/versions/9',
      route: 'plan/active/versions/:n',
      routes,
    });
    expect(await screen.findByText('That version doesn’t exist.')).toBeInTheDocument();
  });
  it('a version address that is not a number has no "Version NaN" title', async () => {
    renderLiving(<PlanDetailsPage />, {
      path: '/plan/active/versions/abc',
      route: 'plan/active/versions/:n',
      routes,
    });
    expect(await screen.findByText('That version doesn’t exist.')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });
});
