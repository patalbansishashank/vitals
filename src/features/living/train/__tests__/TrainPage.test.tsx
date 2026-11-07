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
import { useSettingsStore } from '@/state/settingsStore';

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

/** Emulate a viewport for `useMediaQuery` (jsdom has no layout): width in px. */
function viewport(width: number) {
  window.matchMedia = ((query: string) => {
    const min = /min-width:\s*([\d.]+)(rem|px)/.exec(query);
    const matches = !!min && width >= Number(min[1]) * (min[2] === 'rem' ? 16 : 1);
    return { matches, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}
const originalMatchMedia = window.matchMedia;

/** Open the header's one ⋯ and pick one of the page's items. */
async function headerMenu(user: ReturnType<typeof userEvent.setup>, item: string) {
  await user.click(await screen.findByRole('button', { name: 'More' }));
  await user.click(await screen.findByRole('menuitem', { name: item }));
}

function wedSession() {
  return fixturePrescription(fixturePlan('2026-10-01'), WED).sessions[0]!;
}

function sessionItem(h: ReturnType<typeof renderTrain>, date: string, slotKey: string) {
  return h.stub.source.today(date)?.logged.items.find((i) => i.itemId === `rtSession:${slotKey}`);
}

describe('TrainPage', () => {
  beforeEach(() => clearStoredSwaps());
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('keeps a swap on reload (LIV-11)', async () => {
    const user = userEvent.setup();
    const first = renderTrain(`/train/${WED}`);
    await user.click(await screen.findByRole('button', { name: 'Dand (Hindu push-up)' }));
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
    // the header: the destination's name, the date once under it
    expect(await screen.findByRole('heading', { level: 1, name: 'Train' })).toBeInTheDocument();
    expect(screen.getByText('Wednesday, 30 September')).toBeInTheDocument();
    const session = screen.getByRole('region', { name: /^Lift · \d+ min · home$/ });
    const names = within(session)
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent);
    expect(names).toEqual(wedSession().concrete!.items.map((i) => i.name));
    expect(names[0]).toBe('Dand (Hindu push-up)');
    // r068 T14: the effort cue the rep work shares is said once under the title, not on every row
    expect(session.querySelector('[data-text="4 × 20 · rest 120 s"]')).not.toBeNull();
    expect(within(session).getAllByText('leave 2 reps in the tank')).toHaveLength(1);
    // the session facts name duration, estimated energy, range and effort.
    expect(within(session).queryByText(/^with your /)).toBeNull();
    expect(within(session).getByText(/^≈ \d+\s*kcal$/)).toBeInTheDocument();
    fireEvent.click(within(session).getByRole('button', { name: 'About Lift' }));
    const energyInfo = await screen.findByRole('dialog');
    expect(energyInfo).toHaveTextContent(/Likely \d+–\d+ kcal/);
    fireEvent.click(within(energyInfo).getByRole('button', { name: /close/i }));
    expect(within(session).queryByText(/^\(\d+–\d+\)$/)).toBeNull();
    expect(within(session).queryByText(/^\d+ exercises?$/)).toBeNull();
    // one done key for the session, one per exercise; the timer is an icon key in the card head
    expect(within(session).getAllByRole('button', { name: 'Session done' })).toHaveLength(1);
    expect(within(session).getByRole('button', { name: 'Mark dand as done as planned' })).toHaveAttribute('data-segmented', 'true');
    expect(within(session).getByRole('button', { name: 'Start timer' })).toBeInTheDocument();
    // one ⋯ on the screen (the header's): no ⋯ on the card or its rows; an exercise's name opens its swap sheet
    expect(screen.getAllByRole('button', { name: /^More/ })).toHaveLength(1);
    expect(within(session).queryByRole('button', { name: /^More/ })).toBeNull();
    const dand = within(session).getByRole('button', { name: 'Dand (Hindu push-up)' });
    expect(dand).toHaveAttribute('aria-haspopup', 'dialog');
    expect(dand).toHaveAccessibleDescription('to do. Swap or skip');
    // set-based exercises: the log-by switch is offered
    expect(within(session).getByRole('radiogroup', { name: 'Log by' })).toBeInTheDocument();
    // no injury footnote, no equipment card, no view switch on the page
    expect(screen.queryByText(/are left out/)).toBeNull();
    expect(screen.queryByRole('region', { name: 'Your equipment' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'week' })).toBeNull();
  });

  it('gives a one-exercise session one done key, a labelled minutes field and its actions in the header ⋯', async () => {
    const user = userEvent.setup();
    renderTrain('/train/2026-09-29');
    const session = await screen.findByRole('region', { name: /^Brisk walking · \d+ min/ });
    // logged: the header ⋯ has no session actions until the session is reopened
    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(await screen.findByRole('menuitem', { name: 'Equipment' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'I did something else' })).toBeNull();
    await user.keyboard('{Escape}');
    await user.click(within(session).getByRole('button', { name: 'Change what you did' }));
    expect(within(session).getAllByRole('button', { name: 'Session done' })).toHaveLength(1);
    // no per-row Done, and no ⋯ on the card: the header's is the screen's one
    expect(within(session).queryByRole('button', { name: /^Mark .+ as done as planned$/ })).toBeNull();
    expect(within(session).queryByRole('button', { name: /^More/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^More/ })).toHaveLength(1);
    // a minutes exercise: the log-by switch would change nothing; the field is labelled and states the dose once
    expect(within(session).queryByRole('radiogroup', { name: 'Log by' })).toBeNull();
    const minutes = within(session).getByRole('spinbutton', { name: /minutes$/ });
    expect(minutes.closest('.lm-field')).toHaveTextContent(/^Minutes/);
    expect(session.querySelector('.lv-rd')).toBeNull();
    // swap, something else and skipped lead the header ⋯, before the page's other items
    await user.click(screen.getByRole('button', { name: 'More' }));
    const items = (await screen.findAllByRole('menuitem')).map((i) => i.textContent);
    expect(items.slice(0, 6)).toEqual(['Swap for another exercise…', 'I did something else', 'Skipped the brisk walking', 'Log an activity', 'This week', 'Equipment']);
    await user.click(screen.getByRole('menuitem', { name: 'Swap for another exercise…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Swap brisk walking' });
    // the session's only exercise is skipped from the header ⋯, not from its swap sheet
    expect(within(sheet).queryByRole('button', { name: /^Skip / })).toBeNull();
  });

  it('swaps the first exercise for an equivalent one and logs the session with the catalogue’s credit', async () => {
    const user = userEvent.setup();
    const h = renderTrain(`/train/${WED}`);
    await user.click(await screen.findByRole('button', { name: 'Dand (Hindu push-up)' }));
    const sheet = await screen.findByRole('dialog', { name: 'Swap dand' });
    // every option carries a meter with a percentage and verdict words
    const meters = within(sheet).getAllByRole('meter', { name: 'same stimulus' });
    expect(meters.length).toBeGreaterThan(2);
    for (const m of meters) expect(m.getAttribute('aria-valuetext')).toMatch(/^\d+ %, (counts as Wednesday’s dand|partly — .+|different work — credited to .+)$/);
    // r068 T9: one thin bar per option, its share and verdict in words beside it
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
    expect(await screen.findByText(/^Proposal waiting on Today · keeps \d+ %$/)).toBeInTheDocument();
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
    // the exercise's name opens its swap sheet, which also skips it
    await user.click(await screen.findByRole('button', { name: /^Reverse lunge/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Swap reverse lunge' });
    await user.click(within(sheet).getByRole('button', { name: 'Skip reverse lunge' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Swap reverse lunge' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Undo skipping reverse lunge' })).toBeInTheDocument();
    // once skipped, its sheet no longer offers the skip (the row's Undo takes it back)
    await user.click(screen.getByRole('button', { name: /^Reverse lunge/ }));
    expect(within(await screen.findByRole('dialog', { name: 'Swap reverse lunge' })).queryByRole('button', { name: 'Skip reverse lunge' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Close' }));
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
    const meter = screen.getByRole('meter', { name: 'Session progress' });
    const ring = meter.closest('.lmz-radial')!;
    expect(ring.querySelectorAll('.lmz-radial__t')).toHaveLength(10);
    expect(ring.querySelectorAll('.lmz-radial__t[data-lit]')).toHaveLength(4);
    expect(ring.querySelectorAll('.lmz-radial__t[data-major]')).toHaveLength(0);
    expect(within(chips).getAllByRole('button', { pressed: true })).toHaveLength(4);
    // un-tick one set: the exercise is now partly done and offers Done again
    await user.click(within(chips).getByRole('button', { name: 'set 4, 20 reps' }));
    expect(screen.getByRole('button', { name: 'Mark dand as done as planned' })).toBeInTheDocument();
    expect(chips.closest('li')).toHaveAttribute('data-state', 'partial');
    expect(ring.querySelectorAll('.lmz-radial__t[data-lit]')).toHaveLength(3);
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
    await screen.findByRole('region', { name: /^Lift · / });
    await headerMenu(user, 'Skipped the lift');
    await waitFor(() => expect(sessionItem(h, WED, WED_SLOT)?.status).toBe('skipped'));
    expect(sessionItem(h, WED, WED_SLOT)?.credit).toBe(0);
    expect(await screen.findByText('Wednesday’s lift is marked as skipped.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change what you did' })).toBeInTheDocument();
  });

  it('logs something else typed as free text, resolved into what it trains', async () => {
    const user = userEvent.setup();
    const h = renderTrain(`/train/${WED}`);
    await screen.findByRole('region', { name: /^Lift · / });
    await headerMenu(user, 'I did something else');
    const panel = await screen.findByRole('dialog', { name: 'Something else' });
    const field = within(panel).getByRole('textbox', { name: 'What did you do?' });
    expect(field).toHaveAttribute('placeholder', 'e.g. rollouts 3 × 10');
    // Save sits in the sheet's header and waits for a pick
    expect(within(panel).getByRole('button', { name: 'Save' })).toHaveAttribute('aria-disabled', 'true');
    await user.type(field, 'wooden wheel rollouts 3 × 10');
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
    expect(await screen.findByText('Thursday, 1 October')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Rest day' })).toBeInTheDocument();
    // A.3.3: the step target is a dotted fill of the steps so far; none counted yet is no value, never zero
    const steps = screen.getByRole('meter', { name: 'Steps' });
    expect(steps).not.toHaveAttribute('aria-valuenow');
    expect(steps).toHaveAttribute('aria-valuetext', 'Steps, no value yet');
    expect(screen.getByRole('button', { name: 'Log an activity' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Session done' })).not.toBeInTheDocument();
  });

  it('a future rest day keeps the step target as its fact line and offers no log', async () => {
    renderTrain('/train/2026-10-08');
    expect(await screen.findByRole('heading', { level: 2, name: 'Rest day' })).toBeInTheDocument();
    expect(screen.getByText(/^Target 9,000 steps$/)).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Steps' })).not.toHaveAttribute('aria-valuenow');
    expect(screen.queryByRole('button', { name: 'Log an activity' })).toBeNull();
  });

  it('lists the week from the header ⋯ on phones and opens a day from it', async () => {
    const user = userEvent.setup();
    renderTrain(`/train/${WED}`);
    // the date strip is the week on the page; the list is one tap away in the ⋯
    expect(screen.queryByRole('list', { name: 'This week' })).toBeNull();
    await headerMenu(user, 'This week');
    const sheet = await screen.findByRole('dialog', { name: 'This week' });
    const list = within(sheet).getByRole('list', { name: 'This week' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(7);
    // r068 T4: the rows read in sentence case ("Lift · 33 min")
    expect(rows[0]).toHaveTextContent(/Mon 28 Sep.*Lift · \d+ min/);
    // a one-exercise session is named by its exercise
    expect(rows[1]).toHaveTextContent(/Tue 29 Sep.*Brisk walking · \d+ min/);
    expect(rows[2]).toHaveTextContent(/Wed 30 Sep.*Lift · \d+ min.*not logged/);
    expect(rows[3]).toHaveTextContent(/Thu 1 Oct.*Rest day/);
    expect(rows[4]).toHaveTextContent(/Fri 2 Oct.*Lift · \d+ min.*planned/);
    await user.click(within(rows[0]!).getByRole('button'));
    expect(await screen.findByText('Monday, 28 September')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'This week' })).not.toBeInTheDocument());
  });

  it('keeps the week beside the day on desktop, with no week item in the ⋯', async () => {
    viewport(1440);
    const user = userEvent.setup();
    renderTrain(`/train/${WED}`);
    const list = await screen.findByRole('list', { name: 'This week' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(7);
    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(await screen.findByRole('menuitem', { name: 'Equipment' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'This week' })).toBeNull();
  });

  it('opens another day from the date control, and the week list follows that day (no week keys)', async () => {
    const user = userEvent.setup();
    renderTrain(`/train/${WED}`);
    const control = await screen.findByRole('button', { name: /, choose a day$/ });
    expect(control).toHaveAccessibleName('Yesterday · Wed 30 Sep, choose a day');
    expect(screen.queryByRole('button', { name: 'Next week' })).toBeNull();
    await user.click(control);
    const sheet = await screen.findByRole('dialog', { name: 'Choose a day' });
    await user.click(within(sheet).getByRole('button', { name: 'Next month' }));
    await user.click(within(sheet).getByRole('button', { name: /^Wed 7 Oct/ }));
    expect(await screen.findByText('Wednesday, 7 October')).toBeInTheDocument();
    await headerMenu(user, 'This week');
    const week = await screen.findByRole('dialog', { name: 'Week of 5 Oct' });
    expect(within(within(week).getByRole('list', { name: 'Week of 5 Oct' })).getAllByRole('listitem')[0]).toHaveTextContent(/Mon 5 Oct/);
  });

  it('shows a future day as a read-only preview, with no note about it', async () => {
    renderTrain('/train/2026-10-02');
    expect(await screen.findByText('Friday, 2 October')).toBeInTheDocument();
    expect(screen.queryByText(/^Preview/)).toBeNull();
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
    await screen.findByText('Wednesday, 30 September');
    fireEvent.keyDown(document, { key: ']' });
    expect(await screen.findByText('Thursday, 1 October')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: '[' });
    fireEvent.keyDown(document, { key: '[' });
    expect(await screen.findByText('Tuesday, 29 September')).toBeInTheDocument();
  });

  it('marks a paused day in the header, not in the page', async () => {
    const h = renderTrain(`/train/${WED}`);
    await screen.findByRole('region', { name: /^Lift · / });
    await act(async () => {
      await h.stub.actions.pause('2026-09-28');
    });
    // a pause icon among the header's status icons, opening Plan details
    const icon = await screen.findByRole('link', { name: 'Plan paused' });
    expect(icon).toHaveClass('lm-status-icon');
    expect(icon).toHaveAttribute('href', '/plan/active');
    expect(screen.queryByText(/this is your usual day/)).toBeNull();
  });

  it('keeps the session fact list in the selected energy unit', async () => {
    const unit = useSettingsStore.getState().energyUnit;
    try {
      act(() => useSettingsStore.getState().set({ energyUnit: 'kJ' }));
      renderTrain(`/train/${WED}`);
      const session = await screen.findByRole('region', { name: /^Lift · / });
      const facts = session.querySelector('.lv-train-session__summary')!;
      expect(facts.textContent).toMatch(/kJ/);
      expect(facts.textContent).not.toMatch(/kcal/);
      expect(facts.textContent).not.toMatch(/^Sets/);
    } finally {
      act(() => useSettingsStore.getState().set({ energyUnit: unit }));
    }
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
    expect(session.querySelector('[data-text="4 × 20 · rest 120 s"]')).not.toBeNull();
    await headerMenu(user, 'Show numbers');
    expect(within(session).queryAllByText(/kcal/).length).toBeGreaterThan(0);
  });

  it('asks for equipment in the Equipment sheet when none was answered, and never footnotes injuries', async () => {
    const user = userEvent.setup();
    renderTrain(`/train/${WED}`, { profile: { ...STUB_TRAINING_PROFILE, owned: [], access: [], loadsKg: {}, injuries: ['shoulder'] } });
    await screen.findByRole('region', { name: /^Lift · / });
    expect(screen.queryByText(/are left out/)).toBeNull();
    await headerMenu(user, 'Equipment');
    const sheet = await screen.findByRole('dialog', { name: 'Equipment' });
    expect(within(sheet).getByText('No equipment listed · sessions use body weight')).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: 'Add equipment' })).toHaveAttribute('href', '/onboarding/training');
  });

  it('lists your equipment and places in the Equipment sheet, off the day’s page', async () => {
    const user = userEvent.setup();
    renderTrain(`/train/${WED}`);
    await screen.findByRole('region', { name: /^Lift · / });
    expect(screen.queryByText('Mudgar, single heavy (two-hand) · 10 kg')).toBeNull();
    await headerMenu(user, 'Equipment');
    const sheet = await screen.findByRole('dialog', { name: 'Equipment' });
    expect(within(within(sheet).getByRole('list', { name: 'Your equipment' })).getByText('Mudgar, single heavy (two-hand) · 10 kg')).toBeInTheDocument();
    expect(within(within(sheet).getByRole('list', { name: 'Places and days' })).getByText('home · every day')).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: 'Edit equipment' })).toHaveAttribute('href', '/onboarding/training');
    expect(within(sheet).getByText('Would help')).toBeInTheDocument();
  });

  it('lists what would help as plain facts, with no key that pretends to save a purchase', async () => {
    const user = userEvent.setup();
    const matOnly: TrainingProfile = { ...STUB_TRAINING_PROFILE, owned: ['floor_mat'], access: [{ place: 'home', equipment: ['floor_mat'], weekdays: [0, 1, 2, 3, 4, 5, 6] }], loadsKg: {} };
    renderTrain(`/train/${WED}`, { profile: matOnly });
    await headerMenu(user, 'Equipment');
    const sheet = await screen.findByRole('dialog', { name: 'Equipment' });
    const rows = within(within(sheet).getByRole('list', { name: 'Would help' })).getAllByRole('listitem');
    expect(rows.length).toBeGreaterThan(0);
    expect(within(sheet).getAllByText(/^(free|price ₹+)$/).length).toBe(rows.length);
    expect(within(sheet).queryByRole('button', { name: /^Bought / })).toBeNull();
    expect(within(sheet).queryByText(/shorter or closer to the plan/)).toBeNull();
    expect(matOnly.owned).toEqual(['floor_mat']);
  });

  it('runs an optional timer from the card head while the session is open', async () => {
    const user = userEvent.setup();
    renderTrain(`/train/${WED}`);
    const session = await screen.findByRole('region', { name: /^Lift · / });
    await user.click(within(session).getByRole('button', { name: 'Start timer' }));
    expect(within(session).getByText('0:00 elapsed')).toBeInTheDocument();
    // no second Session done in a bar while the timer runs
    expect(screen.getAllByRole('button', { name: 'Session done' })).toHaveLength(1);
    await user.click(within(session).getByRole('button', { name: 'Stop timer' }));
    expect(within(session).getByRole('button', { name: 'Start timer' })).toBeInTheDocument();
  });
});
