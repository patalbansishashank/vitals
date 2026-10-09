import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { sessionEquivalence, swapOptions, type TrainingProfile } from '@/catalogues';
import { SEED_CATALOGUE } from '@/content/catalogues';
import { Toaster } from '@/components';
import { renderLiving, type RenderLivingOptions } from '../../testing';
import { STUB_STIMULUS_CONTEXT, STUB_TRAINING_PROFILE, fixturePlan, fixturePrescription } from '../../data/fixtures';
import { TrainingSetupProvider, fixedTrainingSetup } from '../setup';
import TrainPage from '../TrainPage';
import { clearStoredSwaps } from '../swapStore';

// The fixture plan lifts Mon/Wed/Fri and walks Tue/Sat; 2026-10-01 (the fixture's today) is a Thursday rest day.
const WED = '2026-09-30';
const WED_SLOT = '13:0';

function renderTrain(path: string, o: RenderLivingOptions & { profile?: TrainingProfile } = {}) {
  const page: ReactElement = o.profile ? (
    <TrainingSetupProvider value={fixedTrainingSetup(o.profile)}>
      <TrainPage />
    </TrainingSetupProvider>
  ) : (
    <TrainPage />
  );
  return renderLiving(
    <>
      {page}
      <Toaster />
    </>,
    { route: 'train/:date', routes: [{ path: 'coach', element: <h1>coach page</h1> }, { path: 'onboarding/training', element: <h1>setup page</h1> }], ...o, path },
  );
}

function wedSession() {
  return fixturePrescription(fixturePlan('2026-10-01'), WED).sessions[0]!;
}

function sessionItem(h: ReturnType<typeof renderTrain>, date: string, slotKey: string) {
  return h.stub.source.today(date)?.logged.items.find((i) => i.itemId === `rtSession:${slotKey}`);
}

describe('TrainPage', () => {
  beforeEach(() => clearStoredSwaps());

  it('keeps a swap on reload (LIV-11)', async () => {
    const user = userEvent.setup();
    const first = renderTrain(`/train/${WED}`);
    await user.click(await screen.findByRole('button', { name: 'More for dand' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Swap for another exercise…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Swap dand' });
    await user.click(within(sheet).getByRole('button', { name: 'Use Dand with gar nal (neck ring)' }));
    expect(await screen.findByRole('heading', { level: 3, name: 'Dand with gar nal (neck ring)' })).toBeInTheDocument();
    first.result.unmount();
    renderTrain(`/train/${WED}`);
    expect(await screen.findByRole('heading', { level: 3, name: 'Dand with gar nal (neck ring)' })).toBeInTheDocument();
    expect(screen.getByText('instead of dand')).toBeInTheDocument();
    // undoing the swap forgets it
    await user.click(screen.getByRole('button', { name: /^Undo the swap for/ }));
    expect(await screen.findByRole('heading', { level: 3, name: 'Dand (Hindu push-up)' })).toBeInTheDocument();
    expect(localStorage.getItem('vitals.train.swaps.v1')).toBeNull();
  });

  it('renders the composed lift with exercise rows in plain words', async () => {
    renderTrain(`/train/${WED}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Train · Wed 30 Sep' })).toBeInTheDocument();
    const session = screen.getByRole('region', { name: /^Lift · \d+ min · home$/ });
    const names = within(session)
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent);
    expect(names).toEqual(wedSession().concrete!.items.map((i) => i.name));
    expect(names[0]).toBe('Dand (Hindu push-up)');
    expect(session.querySelector('[data-text="4 × 20 · rest 120 s · leave 2 reps in the tank"]')).not.toBeNull();
    expect(within(session).getByText('with your 8 kg backpack')).toBeInTheDocument();
    // energy with its likely range
    expect(within(session).getByText(/^\(\d+–\d+\)$/)).toBeInTheDocument();
    expect(within(session).getByRole('button', { name: 'Session done' })).toBeInTheDocument();
    expect(within(session).getByRole('button', { name: 'Mark dand as done as planned' })).toHaveTextContent('Done');
    expect(within(session).getByRole('button', { name: 'More for dand' })).toBeInTheDocument();
  });

  it('swaps the first exercise for an equivalent one and logs the session with the catalogue’s credit', async () => {
    const user = userEvent.setup();
    const h = renderTrain(`/train/${WED}`);
    await user.click(await screen.findByRole('button', { name: 'More for dand' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Swap for another exercise…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Swap dand' });
    // every option carries a meter with a percentage and verdict words
    const meters = within(sheet).getAllByRole('meter', { name: 'same stimulus' });
    expect(meters.length).toBeGreaterThan(2);
    for (const m of meters) expect(m.getAttribute('aria-valuetext')).toMatch(/^\d+ %, (counts as Wednesday’s dand|partly — .+|different work — credited to .+)$/);
    expect(within(sheet).getByText('counts as Wednesday’s dand')).toBeInTheDocument();
    expect(within(sheet).getAllByText(/^partly — /).length).toBeGreaterThan(0);

    await user.click(within(sheet).getByRole('button', { name: 'Use Dand with gar nal (neck ring)' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Swap dand' })).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { level: 3, name: 'Dand with gar nal (neck ring)' })).toBeInTheDocument();
    expect(screen.getByText('instead of dand')).toBeInTheDocument();
    // the swapped row keeps its credit in view
    expect(screen.getAllByRole('meter', { name: 'same stimulus' }).length).toBeGreaterThan(0);
    // making it permanent is a proposal (a change card on Today), never an instant plan change
    const swapEveryWeek = vi.spyOn(h.stub.actions, 'swapExercise');
    await user.click(screen.getByRole('button', { name: 'Use this swap on every Wednesday' }));
    expect(await screen.findByText(/^It keeps \d+ % of the prescribed stimulus\. A proposal is waiting on Today; nothing changes until you apply it\.$/)).toBeInTheDocument();
    // from a past Wednesday the proposal starts on the next one
    expect(swapEveryWeek).toHaveBeenCalledWith('2026-10-07', { slotKey: WED_SLOT, from: wedSession().concrete!.items[0]!.exerciseId, to: expect.objectContaining({ exerciseId: 'dand_garnal' }), everyWeek: true });
    expect(h.stub.source.changes('all').filter((c) => c.title === 'Proposal · use this swap every Wednesday' && c.state === 'pending')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Session done' }));
    const save = screen.queryByRole('button', { name: 'Save' });
    if (save) await user.click(save);

    // expected credit: the catalogue's equivalence of what was done against the prescription
    const rx = wedSession();
    const items = rx.concrete!.items;
    const option = swapOptions(items[0]!.perf, { profile: STUB_TRAINING_PROFILE, catalogue: SEED_CATALOGUE, ctx: STUB_STIMULUS_CONTEXT, weekday: 3, startH: rx.startH, limit: 8 }).find((o) => o.exerciseId === 'dand_garnal')!;
    const expected = sessionEquivalence(
      items.map((i) => i.perf),
      [{ ...option.perf, equipmentUsed: option.equipment }, ...items.slice(1).map((i) => i.perf)],
      SEED_CATALOGUE,
      STUB_STIMULUS_CONTEXT,
    );
    await waitFor(() => expect(['done', 'partial']).toContain(sessionItem(h, WED, WED_SLOT)?.status));
    expect(sessionItem(h, WED, WED_SLOT)?.credit).toBeCloseTo(expected.credit, 6);
    const entry = h.stub.inspect().entries.find((e) => e.kind === 'session' && e.itemId === WED_SLOT);
    expect(entry && entry.kind === 'session' ? entry.performed[0]?.exerciseId : null).toBe('dand_garnal');
    expect((await screen.findAllByText(/^(Counts as Wednesday’s lift · \d+ %|Partly · .+)$/)).length).toBeGreaterThan(0);
    // the logged session lists what was done, not the plan's exercise (LIV-11)
    expect(screen.getByRole('heading', { level: 3, name: 'Dand with gar nal (neck ring)' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3, name: 'Dand (Hindu push-up)' })).not.toBeInTheDocument();
  });

  it('shows the partial summary before saving when an exercise is left out', async () => {
    const user = userEvent.setup();
    const h = renderTrain(`/train/${WED}`);
    await user.click(await screen.findByRole('button', { name: 'More for reverse lunge' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Skip this one' }));
    await user.click(screen.getByRole('button', { name: 'Session done' }));
    expect(screen.getByText(/^2 of 3 exercises · counted \d+ %$/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sessionItem(h, WED, WED_SLOT)?.status).toBe('partial'));
    expect(sessionItem(h, WED, WED_SLOT)?.credit).toBeLessThan(1);
  });

  it('ticks an exercise as planned and logs sets with the quick chips', async () => {
    const user = userEvent.setup();
    const h = renderTrain(`/train/${WED}`);
    await user.click(await screen.findByRole('button', { name: 'Mark dand as done as planned' }));
    // done: the row's one key turns into Undo, every set reads done
    expect(screen.getByRole('button', { name: 'Undo dand done' })).toBeInTheDocument();
    const chips = screen.getByRole('group', { name: 'Sets of dand' });
    expect(within(chips).getAllByRole('button', { pressed: true })).toHaveLength(4);
    // un-tick one set: the exercise is now partly done and offers Done again
    await user.click(within(chips).getByRole('button', { name: 'set 4, 20 reps' }));
    expect(screen.getByRole('button', { name: 'Mark dand as done as planned' })).toBeInTheDocument();
    expect(chips.closest('li')).toHaveAttribute('data-state', 'partial');
    await user.click(screen.getByRole('button', { name: 'Session done' }));
    expect(screen.getByText(/^3 of 3 exercises · counted \d+ %$/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sessionItem(h, WED, WED_SLOT)?.status).not.toBe('unknown'));
    const entry = h.stub.inspect().entries.find((e) => e.kind === 'session' && e.itemId === WED_SLOT);
    expect(entry && entry.kind === 'session' ? entry.performed[0] : null).toMatchObject({ exerciseId: 'dand', setCount: 3 });
  });

  it('marks a session as skipped with no credit', async () => {
    const user = userEvent.setup();
    const h = renderTrain(`/train/${WED}`);
    await user.click(await screen.findByRole('button', { name: 'More session options' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Skipped the lift' }));
    await waitFor(() => expect(sessionItem(h, WED, WED_SLOT)?.status).toBe('skipped'));
    expect(sessionItem(h, WED, WED_SLOT)?.credit).toBe(0);
    expect(await screen.findByText('Wednesday’s lift is marked as skipped.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change what you did' })).toBeInTheDocument();
  });

  it('logs something else typed as free text, resolved into what it trains', async () => {
    const user = userEvent.setup();
    const h = renderTrain(`/train/${WED}`);
    await user.click(await screen.findByRole('button', { name: 'More session options' }));
    await user.click(await screen.findByRole('menuitem', { name: 'I did something else' }));
    const panel = await screen.findByRole('dialog', { name: 'What did you do instead?' });
    await user.type(within(panel).getByRole('textbox', { name: 'What did you do?' }), 'wooden wheel rollouts 3 × 10');
    await user.click(within(panel).getByRole('button', { name: 'Use “wooden wheel rollouts” as you typed it' }));
    expect(within(panel).getByRole('meter', { name: 'same stimulus' })).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sessionItem(h, WED, WED_SLOT)?.status).not.toBe('unknown'));
    const entry = h.stub.inspect().entries.find((e) => e.kind === 'session' && e.itemId === WED_SLOT);
    const performed = entry && entry.kind === 'session' ? entry.performed[0] : undefined;
    expect(performed?.freeText).toBe('wooden wheel rollouts 3 × 10');
    expect(performed?.setCount).toBe(3);
    expect(performed?.reps).toBe(10);
  });

  it('shows the rest day on Thursday', async () => {
    renderTrain('/train/2026-10-01');
    expect(await screen.findByRole('heading', { level: 1, name: 'Train · Thu 1 Oct' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Today’s training' })).toBeInTheDocument();
    expect(screen.getByText(/^Rest day\. Steps target 9\s000\.$/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Session done' })).not.toBeInTheDocument();
  });

  it('lists the week and opens a day from it', async () => {
    const user = userEvent.setup();
    renderTrain(`/train/${WED}`);
    await user.click(await screen.findByRole('radio', { name: 'week' }));
    const list = screen.getByRole('list', { name: 'This week' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(7);
    expect(rows[0]).toHaveTextContent(/Mon 28 Sep.*lift · \d+ min/);
    expect(rows[1]).toHaveTextContent(/Tue 29 Sep.*walk · \d+ min/);
    expect(rows[2]).toHaveTextContent(/Wed 30 Sep.*lift · \d+ min.*not logged/);
    expect(rows[3]).toHaveTextContent(/Thu 1 Oct.*rest day/);
    expect(rows[4]).toHaveTextContent(/Fri 2 Oct.*lift · \d+ min.*planned/);
    await user.click(within(rows[0]!).getByRole('button'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Train · Mon 28 Sep' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'today' })).toHaveAttribute('aria-checked', 'true');
  });

  it('moves the strip and the week list a week at a time without changing the day', async () => {
    const user = userEvent.setup();
    renderTrain(`/train/${WED}`);
    await user.click(await screen.findByRole('radio', { name: 'week' }));
    await user.click(screen.getByRole('button', { name: 'Next week' }));
    const list = screen.getByRole('list', { name: 'Week of 5 Oct' });
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent(/Mon 5 Oct/);
    expect(screen.getByRole('heading', { level: 1, name: 'Train · Wed 30 Sep' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^Mon 5 Oct/ })).toBeInTheDocument();
  });

  it('shows a future day as a read-only preview', async () => {
    renderTrain('/train/2026-10-02');
    expect(await screen.findByText('Preview · the plan may still change')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Session done' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Swap / })).not.toBeInTheDocument();
  });

  it('opens the swap sheet from the URL', async () => {
    renderTrain(`/train/${WED}?swap=${WED_SLOT}:0`);
    expect(await screen.findByRole('dialog', { name: 'Swap dand' })).toBeInTheDocument();
  });

  it('asks the Coach for options with a drafted question', async () => {
    const user = userEvent.setup();
    const h = renderTrain(`/train/${WED}?swap=${WED_SLOT}:0`);
    await user.click(await screen.findByRole('button', { name: 'Ask the Coach for options' }));
    expect(await screen.findByRole('heading', { name: 'coach page' })).toBeInTheDocument();
    expect(h.router.state.location.state).toEqual({ draft: { text: 'Options to swap dand today?', context: { date: '2026-09-30', screen: 'train' } } });
  });

  it('moves one day with [ and ]', async () => {
    renderTrain(`/train/${WED}`);
    await screen.findByRole('heading', { level: 1, name: 'Train · Wed 30 Sep' });
    fireEvent.keyDown(document, { key: ']' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Train · Thu 1 Oct' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: '[' });
    fireEvent.keyDown(document, { key: '[' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Train · Tue 29 Sep' })).toBeInTheDocument();
  });

  it('hides energy numbers in quiet mode until "show numbers"', async () => {
    const user = userEvent.setup();
    const h = renderTrain(`/train/${WED}`);
    const session = await screen.findByRole('region', { name: /^Lift · / });
    expect(within(session).queryAllByText(/kcal/).length).toBeGreaterThan(0);
    await act(async () => {
      await h.stub.actions.setQuietMode(true);
    });
    expect(within(session).queryAllByText(/kcal/)).toHaveLength(0);
    // sets and reps stay
    expect(session.querySelector('[data-text="4 × 20 · rest 120 s · leave 2 reps in the tank"]')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'show numbers' }));
    expect(within(session).queryAllByText(/kcal/).length).toBeGreaterThan(0);
  });

  it('notes the injury filter and asks for equipment when none was answered', async () => {
    renderTrain(`/train/${WED}`, { profile: { ...STUB_TRAINING_PROFILE, owned: [], access: [], loadsKg: {}, injuries: ['shoulder'] } });
    expect(await screen.findByText('Exercises that don’t suit your shoulder are left out (your setup).')).toBeInTheDocument();
    expect(screen.getByText('You haven’t told us what you have yet. Sessions use your body weight.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tell us what you have' })).toHaveAttribute('href', '/onboarding/training');
  });

  it('lists your equipment and places', async () => {
    renderTrain(`/train/${WED}`);
    const face = await screen.findByRole('region', { name: 'Your equipment' });
    expect(within(face).getByText('Mudgar, single heavy (two-hand) · 10 kg')).toBeInTheDocument();
    expect(within(face).getByText('home · every day')).toBeInTheDocument();
    expect(within(face).getByRole('link', { name: 'Edit your equipment' })).toHaveAttribute('href', '/onboarding/training');
    expect(within(face).getByText('Would help')).toBeInTheDocument();
  });

  it('turns "Bought it" into a proposal, never a change to your equipment', async () => {
    const user = userEvent.setup();
    const matOnly: TrainingProfile = { ...STUB_TRAINING_PROFILE, owned: ['floor_mat'], access: [{ place: 'home', equipment: ['floor_mat'], weekdays: [0, 1, 2, 3, 4, 5, 6] }], loadsKg: {} };
    renderTrain(`/train/${WED}`, { profile: matOnly });
    const face = await screen.findByRole('region', { name: 'Your equipment' });
    const keys = within(face).getAllByRole('button', { name: /^Bought / });
    expect(keys.length).toBeGreaterThan(0);
    expect(within(face).getAllByText(/^· (free|price ₹+)$/).length).toBe(keys.length);
    await user.click(keys[0]!);
    expect(await screen.findByText('Added. Using it would change your sessions — that comes as a proposal.')).toBeInTheDocument();
    expect(matOnly.owned).toEqual(['floor_mat']);
  });

  it('runs an optional timer while the session is open', async () => {
    const user = userEvent.setup();
    renderTrain(`/train/${WED}`);
    await user.click(await screen.findByRole('button', { name: 'Start session' }));
    expect(screen.getByText('0:00 elapsed')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stop timer' }));
    expect(screen.getByRole('button', { name: 'Start session' })).toBeInTheDocument();
  });
});
