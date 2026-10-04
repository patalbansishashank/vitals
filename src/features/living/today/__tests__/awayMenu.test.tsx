import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from '@/components';
import { renderLiving } from '../../testing';
import { FIXTURE_TODAY, fixturePlan } from '../../data/fixtures';
import { TodayMenu } from '../components/TodayMenu';

window.scrollTo = (() => undefined) as typeof window.scrollTo;

// the fixture's today is Thu 1 Oct 2026
function renderMenu() {
  const plan = fixturePlan(FIXTURE_TODAY);
  return renderLiving(
    <>
      <TodayMenu plan={plan} today={FIXTURE_TODAY} onCheckIn={() => undefined} />
      <Toaster />
    </>,
  );
}

async function openAway(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Today menu' }));
  await user.click(await screen.findByRole('menuitem', { name: 'I’m busy or away…' }));
  return screen.findByRole('dialog', { name: 'Busy or away' });
}

describe('Today menu · I’m busy or away…', () => {
  it('tells the plan about busy days (tomorrow to the day after by default) and the proposal shows as a change card', async () => {
    const user = userEvent.setup();
    const h = renderMenu();
    const declare = vi.spyOn(h.stub.actions, 'declareEvent');
    const sheet = await openAway(user);
    expect(within(sheet).getByLabelText('from')).toHaveValue('2026-10-02');
    expect(within(sheet).getByLabelText('to')).toHaveValue('2026-10-03');
    await user.click(within(sheet).getByRole('button', { name: 'Tell the plan' }));
    expect(declare).toHaveBeenCalledWith({ kind: 'busy', from: '2026-10-02', to: '2026-10-03' });
    expect(await screen.findByText('Busy days: no training, food as planned. A proposal is waiting on Today.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Busy or away' })).not.toBeInTheDocument());
    const cards = h.stub.source.changes('today').filter((c) => c.state === 'pending' && /^Proposal · busy /.test(c.title));
    expect(cards).toHaveLength(1);
    expect(cards[0]!.impact?.goalDates.length).toBeGreaterThan(0);
  });

  it('a meal out is one day, with a note', async () => {
    const user = userEvent.setup();
    const h = renderMenu();
    const declare = vi.spyOn(h.stub.actions, 'declareEvent');
    const sheet = await openAway(user);
    await user.click(within(sheet).getByRole('radio', { name: 'a meal out' }));
    expect(within(sheet).queryByLabelText('to')).toBeNull();
    await user.type(within(sheet).getByLabelText(/^note/), 'birthday dinner');
    await user.click(within(sheet).getByRole('button', { name: 'Tell the plan' }));
    expect(declare).toHaveBeenCalledWith({ kind: 'socialMeal', from: '2026-10-02', to: '2026-10-02', note: 'birthday dinner' });
  });

  it('pushing the plan back by those days dispatches a shift instead', async () => {
    const user = userEvent.setup();
    const h = renderMenu();
    const shift = vi.spyOn(h.stub.actions, 'shift');
    const declare = vi.spyOn(h.stub.actions, 'declareEvent');
    const sheet = await openAway(user);
    await user.click(within(sheet).getByRole('checkbox', { name: /^Push the plan back by these days instead/ }));
    expect(within(sheet).getByText('Your usual days on those dates; the plan ends 2 days later.')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Tell the plan' }));
    expect(shift).toHaveBeenCalledWith({ from: '2026-10-02', days: 2, mode: 'pushBack' });
    expect(declare).not.toHaveBeenCalled();
    expect(await screen.findByText('A proposal is waiting on Today.')).toBeInTheDocument();
    expect(h.stub.source.changes('today').some((c) => c.title === 'Proposal · push the plan back 2 days')).toBe(true);
  });

  it('says why when the plan refuses, and keeps the sheet open', async () => {
    const user = userEvent.setup();
    const h = renderMenu();
    vi.spyOn(h.stub.actions, 'declareEvent').mockResolvedValue({ ok: false, message: 'There is no safe plan from here, so nothing changed.' });
    const sheet = await openAway(user);
    await user.click(within(sheet).getByRole('button', { name: 'Tell the plan' }));
    expect(await screen.findByText('There is no safe plan from here, so nothing changed.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Busy or away' })).toBeInTheDocument();
  });

  it('Re-plan the rest says what the re-plan did', async () => {
    const user = userEvent.setup();
    const h = renderMenu();
    vi.spyOn(h.stub.actions, 'replanRest').mockResolvedValue({ ok: true, message: 'The plan already fits, so nothing changed.' });
    await user.click(screen.getByRole('button', { name: 'Today menu' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Re-plan the rest (same goals)' }));
    expect(await screen.findByText('The plan already fits, so nothing changed.')).toBeInTheDocument();
  });
});
