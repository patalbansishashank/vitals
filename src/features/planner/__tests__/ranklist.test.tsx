import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EMPTY_RUN, pickPlannerValues, usePlannerStore } from '@/state/plannerStore';
import { GoalRankList } from '../components/GoalRankList';
import { GOALS } from './fixtures';
import { withSystemWrite } from '@/state/scope';

function Harness() {
  const goals = usePlannerStore((s) => s.goals);
  const st = usePlannerStore.getState();
  return <GoalRankList goals={goals} onMove={st.moveGoal} onUpdate={st.updateGoal} onRemove={st.removeGoal} />;
}

const order = () => usePlannerStore.getState().goals.map((g) => g.metric);
const live = () => document.querySelector('[aria-live="polite"]')!.textContent;

beforeEach(() => {
  localStorage.clear();
  withSystemWrite(() => usePlannerStore.setState({ ...pickPlannerValues({}), goals: GOALS.map((g) => ({ ...g })), run: EMPTY_RUN }));
});

describe('GoalRankList', () => {
  it('numbers ranks and labels each handle with its rank', () => {
    render(<Harness />);
    const list = screen.getByRole('list', { name: /Goals in priority order, 3 of 6/ });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Reorder Autophagy signal, rank 3 of 3' })).toBeInTheDocument();
  });

  it('reorders with the keyboard: space picks up, arrows move, space drops — each move announced', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByRole('button', { name: 'Reorder Autophagy signal, rank 3 of 3' }).focus();
    await user.keyboard(' ');
    expect(live()).toMatch(/picked up, rank 3 of 3/);
    await user.keyboard('{ArrowUp}');
    expect(order()).toEqual(['fatMass', 'autophagyIdx', 'leanTissue']);
    expect(live()).toBe('Autophagy signal moved to rank 2 of 3.');
    await user.keyboard('{ArrowUp}');
    expect(order()).toEqual(['autophagyIdx', 'fatMass', 'leanTissue']);
    // focus stays on the moved handle
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reorder Autophagy signal, rank 1 of 3' }));
    await user.keyboard(' ');
    expect(live()).toBe('Autophagy signal dropped at rank 1 of 3.');
    // arrows do nothing once dropped
    await user.keyboard('{ArrowDown}');
    expect(order()[0]).toBe('autophagyIdx');
  });

  it('Escape cancels a keyboard move', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByRole('button', { name: 'Reorder Fat mass, rank 1 of 3' }).focus();
    await user.keyboard(' {ArrowDown}{ArrowDown}');
    expect(order()).toEqual(['leanTissue', 'autophagyIdx', 'fatMass']);
    await user.keyboard('{Escape}');
    expect(order()).toEqual(['fatMass', 'leanTissue', 'autophagyIdx']);
    expect(live()).toMatch(/Reorder cancelled. Fat mass is back at rank 1 of 3/);
  });

  it('offers a move menu as the non-drag path', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Move Fat mass and more' }));
    expect(screen.getByRole('menuitem', { name: 'Move up' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('menuitem', { name: 'Move to bottom' }));
    expect(order()).toEqual(['leanTissue', 'autophagyIdx', 'fatMass']);
  });

  it('removes a goal and changes its type', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Remove Lean tissue (protein-based)' }));
    expect(order()).toEqual(['fatMass', 'autophagyIdx']);
    await user.click(within(screen.getByRole('radiogroup', { name: 'Fat mass: goal type' })).getByRole('radio', { name: 'gain' }));
    expect(usePlannerStore.getState().goals[0]).toMatchObject({ mode: 'gain', amount: 5 });
  });

  it('shows the grade-D helper and the mandatory autophagy caveat on the row', () => {
    render(<Harness />);
    expect(screen.getByText('exploratory')).toBeInTheDocument();
    expect(screen.getByText(/Autophagy cannot be measured in your organs by any routine test/)).toBeInTheDocument();
    expect(screen.getByText(/weights it lightly/)).toBeInTheDocument();
  });
});
