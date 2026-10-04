import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlanDetailsPage from '../PlanDetailsPage';
import { renderLiving } from '../../testing';
import { useActivePlanStore } from '../../activePlan';

const routes = [
  { path: 'plan/goals', element: <h1>goals</h1> },
  { path: 'plan', element: <h1>planner</h1> },
  { path: 'today', element: <h1>today</h1> },
];

describe('Plan details', () => {
  it('shows the plan, the ease switch with its copy, and the versions', async () => {
    renderLiving(<PlanDetailsPage />, { path: '/plan/active', route: 'plan/active', routes });
    expect(await screen.findByRole('heading', { level: 1, name: 'Plan details' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Spring cut' })).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
    const sw = screen.getByRole('switch', { name: 'Let the plan ease itself' });
    expect(sw).toBeChecked();
    // Q6-14: the words appear once — the section has its own label, the switch keeps its name
    expect(screen.getAllByText('Let the plan ease itself')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 3, name: 'going easier' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'When your data says to go easier — poor sleep, signs of strain, a missed day — the plan makes the lighter change at once and shows it on Today with Undo. Off: every change waits for you.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/not the Coach’s “small plan edits” switch in Settings › AI provider/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /v3 · weekly check-in · .* — Thursday lift moved to Friday/ })).toHaveAttribute('href', '/plan/active/versions/3');
    expect(screen.getByRole('button', { name: 'Edit intentions' })).toHaveAttribute('aria-disabled', 'true');
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
    await user.click(await screen.findByRole('button', { name: 'Pause plan' }));
    const sheet = await screen.findByRole('dialog', { name: 'Pause the plan' });
    expect(within(sheet).getByText('you resume — from Today or here')).toBeInTheDocument();
    await user.type(within(sheet).getByLabelText('reason (optional)'), 'travel');
    await user.click(within(sheet).getByRole('button', { name: 'Pause plan' }));
    expect(await screen.findByText('paused')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Pause the plan' })).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Resume plan' }));
    expect(await screen.findByText('running')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause plan' })).toBeInTheDocument();
  });

  it('needs the typed word before ending the plan', async () => {
    const user = userEvent.setup();
    renderLiving(<PlanDetailsPage />, { path: '/plan/active', route: 'plan/active', routes });
    await user.click(await screen.findByRole('button', { name: 'End plan…' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'End Spring cut?' });
    expect(within(dialog).getByText('It ends today. Your logs and versions are kept, and you can restore it for 7 days.')).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: 'End plan' });
    expect(confirm).toHaveAttribute('aria-disabled', 'true');
    await user.click(confirm);
    expect(screen.queryByRole('heading', { name: 'planner' })).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Type end to confirm.'), 'end');
    const ready = within(dialog).getByRole('button', { name: 'End plan' });
    expect(ready).not.toHaveAttribute('aria-disabled');
    await user.click(ready);
    expect(await screen.findByRole('heading', { name: 'planner' })).toBeInTheDocument();
  });

  it('re-plans from scratch: opens the goals with the plan prefilled and turns the planning override on', async () => {
    const user = userEvent.setup();
    const h = renderLiving(<PlanDetailsPage />, { path: '/plan/active', route: 'plan/active', routes });
    await user.click(await screen.findByRole('button', { name: 'Re-plan' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Re-plan from scratch' }));
    expect(await screen.findByRole('heading', { name: 'goals' })).toBeInTheDocument();
    expect(h.router.state.location.pathname).toBe('/plan/goals');
    expect(h.router.state.location.search).toBe('?from=active');
    expect(useActivePlanStore.getState().planningOverride).toBe(true);
  });

  it('re-plans the rest: a proposal waits on Today', async () => {
    const user = userEvent.setup();
    const h = renderLiving(<PlanDetailsPage />, { path: '/plan/active', route: 'plan/active', routes });
    await user.click(await screen.findByRole('button', { name: 'Re-plan' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Re-plan the rest (same goals)' }));
    expect(await screen.findByRole('heading', { name: 'today' })).toBeInTheDocument();
    expect(h.stub.inspect().changes.some((c) => c.title.startsWith('Proposal · re-plan the remaining'))).toBe(true);
  });

  it('shows a version’s diff table and goal dates', async () => {
    renderLiving(<PlanDetailsPage />, { path: '/plan/active/versions/3', route: 'plan/active/versions/:n', routes });
    expect(await screen.findByRole('heading', { level: 1, name: 'Version 3' })).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'before → after' })).toBeInTheDocument();
    expect(within(table).getByText('Thu lift 45 min → Fri lift 45 min')).toBeInTheDocument();
    expect(within(table).getByText('Thursday sessions were done 1 time in 4')).toBeInTheDocument();
  });

  it('says so when a version does not exist', async () => {
    renderLiving(<PlanDetailsPage />, { path: '/plan/active/versions/9', route: 'plan/active/versions/:n', routes });
    expect(await screen.findByText('That version doesn’t exist.')).toBeInTheDocument();
  });
  it('a version address that is not a number has no "Version NaN" title', async () => {
    renderLiving(<PlanDetailsPage />, { path: '/plan/active/versions/abc', route: 'plan/active/versions/:n', routes });
    expect(await screen.findByText('That version doesn’t exist.')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });
});
