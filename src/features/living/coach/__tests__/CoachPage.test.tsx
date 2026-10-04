import { useEffect, useState } from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderLiving } from '../../testing';
import { useLivingClock } from '../../clock';
import { useLivingActions } from '../../data/actions';
import { useLivingSource } from '../../data/source';
import CoachPage from '../CoachPage';
import { CoachAdapterContext, type CoachStatusKind } from '../adapter';
import { createMockCoachAdapter, type MockCoachAdapter } from '../mockAdapter';
import { setCoachProblem } from '../availability';

function WithMock({ status, onReady }: { status?: CoachStatusKind; onReady?: (a: MockCoachAdapter) => void }) {
  const clock = useLivingClock();
  const actions = useLivingActions();
  const source = useLivingSource();
  const [adapter] = useState(() => createMockCoachAdapter({ clock, actions, source, ...(status ? { status } : {}) }));
  useEffect(() => {
    onReady?.(adapter);
  }, [adapter, onReady]);
  return (
    <CoachAdapterContext.Provider value={adapter}>
      <CoachPage />
    </CoachAdapterContext.Provider>
  );
}

const field = () => screen.getByRole('textbox', { name: 'Message to the Coach' });

async function say(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(field());
  await user.keyboard(text.replace(/[{[]/g, (c) => c + c));
  await user.keyboard('{Enter}');
}

describe('CoachPage', () => {
  it('renders the conversation with the model line and the log region', () => {
    renderLiving(<WithMock />, { path: '/coach', route: 'coach' });
    expect(screen.getByRole('heading', { level: 1, name: 'Coach' })).toBeInTheDocument();
    expect(screen.getByText('Claude Sonnet 5.5 · your key')).toBeInTheDocument();
    expect(screen.getByRole('log', { name: 'Conversation with the Coach' })).toHaveAttribute('aria-live', 'off');
    // prompt chips from today's view
    expect(screen.getByRole('group', { name: 'Suggestions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'why is my weight up?' })).toBeInTheDocument();
  });

  it('food text streams a reply and an applied log card; Undo retracts the entry, Redo logs it again', async () => {
    const user = userEvent.setup();
    const h = renderLiving(<WithMock />, { path: '/coach', route: 'coach' });
    await say(user, 'had dal, rice and two eggs for lunch');

    const card = await screen.findByRole('article', { name: 'Logged lunch · 13:00' });
    expect(within(card).getByText('Coach · text')).toBeInTheDocument();
    expect(within(card).getByText('≈ 640 kcal (510–780) · protein 33 g (25–41)')).toBeInTheDocument();
    expect(await screen.findByText(/^Logged\. That puts you at about 640 kcal so far/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /looked at · today’s log · plan v3/ })).toBeInTheDocument();
    expect(h.stub.inspect().entries).toHaveLength(1);
    // the completed reply is announced once, from a separate live region
    await waitFor(() => expect(screen.getByText(/^The Coach replied: Logged\./)).toBeInTheDocument());

    await user.click(within(card).getByRole('button', { name: 'Undo logged lunch' }));
    await waitFor(() => expect(h.stub.inspect().entries).toHaveLength(0));
    expect(await within(card).findByRole('button', { name: 'Redo logged lunch' })).toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: 'Redo logged lunch' }));
    await waitFor(() => expect(h.stub.inspect().entries).toHaveLength(1));
  });

  it('keeps the newest turn in view after sending', async () => {
    const seen: Element[] = [];
    // jsdom has no scrollIntoView
    const proto = Element.prototype as { scrollIntoView?: unknown };
    const had = proto.scrollIntoView;
    proto.scrollIntoView = function (this: Element) {
      seen.push(this);
    };
    const user = userEvent.setup();
    renderLiving(<WithMock />, { path: '/coach', route: 'coach' });
    await say(user, 'had dal, rice and two eggs for lunch');
    await screen.findByRole('article', { name: 'Logged lunch · 13:00' });
    const log = screen.getByRole('log', { name: 'Conversation with the Coach' });
    await waitFor(() => expect(seen.at(-1)).toBe(log.lastElementChild));
    proto.scrollIntoView = had;
  });

  it('a proposal waits for Apply (never pre-focused) and can be undone after', async () => {
    const user = userEvent.setup();
    renderLiving(<WithMock />, { path: '/coach', route: 'coach' });
    await say(user, 'I’m busy Thu to Sat, no training');
    const apply = await screen.findByRole('button', { name: 'Apply proposal: no training Thu–Sat' });
    expect(apply).not.toHaveFocus();
    expect(screen.getByText('Here’s what that would do. Nothing changes until you apply it.')).toBeInTheDocument();
    expect(screen.getByText('expires in 24 h')).toBeInTheDocument();
    await user.click(apply);
    expect(await screen.findByRole('button', { name: 'Undo proposal: no training Thu–Sat' })).toBeInTheDocument();
  });

  it('"end my plan" gives a confirm card; only the typed dialog ends the plan', async () => {
    const user = userEvent.setup();
    const h = renderLiving(<WithMock />, { path: '/coach', route: 'coach' });
    const end = vi.spyOn(h.stub.actions, 'end');
    await say(user, 'end my plan');
    const card = await screen.findByRole('article', { name: 'Needs your confirmation · end Spring cut' });
    expect(end).not.toHaveBeenCalled();

    await user.click(within(card).getByRole('button', { name: 'Review and confirm: end Spring cut' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'End Spring cut?' });
    await user.type(within(dialog).getByLabelText('Type end to confirm.'), 'end');
    await user.click(within(dialog).getByRole('button', { name: 'End plan' }));

    await waitFor(() => expect(end).toHaveBeenCalledWith('end'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(within(card).queryByRole('button', { name: /Review and confirm/ })).not.toBeInTheDocument();
  });

  it('a blocked request offers the allowed alternative, which becomes a proposal', async () => {
    const user = userEvent.setup();
    renderLiving(<WithMock />, { path: '/coach', route: 'coach' });
    await say(user, 'plan a 48 hour fast this weekend');
    expect(await screen.findByRole('article', { name: 'Not allowed by your safety settings · a 48-hour fast' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Plan a 24-hour fast instead' }));
    expect(await screen.findByRole('article', { name: 'Proposal · a 24-hour fast on Sat 3 Oct' })).toBeInTheDocument();
  });

  it('settings only the person can change get a link, not an action', async () => {
    const user = userEvent.setup();
    renderLiving(<WithMock />, { path: '/coach', route: 'coach' });
    await say(user, 'turn off sync');
    const card = await screen.findByRole('article', { name: 'Only you can change that · sync' });
    expect(within(card).getByRole('link', { name: 'Open Settings' })).toHaveAttribute('href', '/settings');
  });

  it('a photo shows the thumbnail note and a "what I saw" card; your grams narrow the range', async () => {
    const user = userEvent.setup();
    const h = renderLiving(<WithMock />, { path: '/coach', route: 'coach' });
    const file = new File(['x'], 'lunch.jpg', { type: 'image/jpeg' });
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input).toHaveAttribute('accept', 'image/*,application/pdf');
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText('photo attached')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Sent to Anthropic for this message only; the photo stays on this device.')).toBeInTheDocument();
    const card = await screen.findByRole('article', { name: 'Logged lunch · 13:00' });
    expect(within(card).getByText('Coach · photo')).toBeInTheDocument();
    expect(within(card).getByText('looks glossy: about 2 tsp oil added')).toBeInTheDocument();
    expect(within(card).getByText('≈ 720 kcal (470–970) · protein 24 g (12–36)')).toBeInTheDocument();
    // alt text from the "what I saw" summary
    expect(screen.getAllByRole('img', { name: 'Your photo: dal tadka, rice, roti' }).length).toBeGreaterThan(0);
    expect(h.stub.inspect().entries).toHaveLength(1);

    await user.click(within(card).getByRole('button', { name: 'Change dal tadka: 1 katori ≈ 150 g (100–210)' }));
    const grams = within(card).getByLabelText('dal tadka, grams');
    await user.clear(grams);
    await user.type(grams, '180{Enter}');
    expect(await within(card).findByText('Coach · photo + your grams')).toBeInTheDocument();
    expect(within(card).getByText('≈ 768 kcal (650–880) · protein 26 g (21–31)')).toBeInTheDocument();
    expect(h.stub.inspect().entries).toHaveLength(1);
  });

  it('Stop ends the stream; proposals already made stay', async () => {
    renderLiving(<WithMock />, { path: '/coach', route: 'coach' });
    fireEvent.change(field(), { target: { value: 'busy Thu to Sat' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    const stop = screen.getByRole('button', { name: 'Stop the Coach' });
    fireEvent.click(stop);
    expect(await screen.findByText('Stopped. Proposals already made are still waiting below.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument());
  });

  it('no provider: the setup copy, and the composer explains why it cannot send', async () => {
    const user = userEvent.setup();
    renderLiving(<CoachPage />, { path: '/coach', route: 'coach' });
    expect(screen.getByText('The Coach needs an AI provider.')).toBeInTheDocument();
    expect(screen.getByText('Use your own OpenAI, Anthropic or other key, or a model on your computer.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set up a provider' })).toHaveAttribute('href', '/settings/coach');
    expect(screen.getByText('You can log everything by hand on Today, Food and Train.')).toBeInTheDocument();
    await say(user, 'had oats');
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Connect an AI provider in Settings to chat. You can still log everything by hand.');
    expect(within(status).getByRole('link', { name: 'Open Settings' })).toHaveAttribute('href', '/settings/coach');
    // the field stays usable and keeps the text
    expect(field()).toHaveValue('had oats');
  });

  it('works without a plan (Planning mode): planning prompts, and nothing is logged', async () => {
    const user = userEvent.setup();
    const h = renderLiving(<WithMock />, { plan: null, path: '/coach', route: 'coach' });
    expect(screen.getByRole('heading', { level: 1, name: 'Coach' })).toBeInTheDocument();
    expect(screen.getByText('No plan is running. Ask about your body, a what-if, or how to choose a plan.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'help me choose a plan' })).toBeInTheDocument();
    await say(user, 'had dal for lunch');
    expect(await screen.findByText(/No plan is running, so there’s nothing to log against yet/)).toBeInTheDocument();
    expect(h.stub.inspect().entries).toHaveLength(0);
  });

  it('renders without a plan and without a provider', () => {
    renderLiving(<CoachPage />, { plan: null, path: '/coach', route: 'coach' });
    expect(screen.getByRole('heading', { level: 1, name: 'Coach' })).toBeInTheDocument();
    expect(screen.getByText('The Coach needs an AI provider.')).toBeInTheDocument();
  });

  it('sends a draft handed over in the navigation state once, then clears it', async () => {
    const h = renderLiving(<WithMock />, { path: '/coach', route: 'coach' });
    await act(() => h.router.navigate('/coach', { state: { draft: { text: 'had dal, rice and two eggs for lunch' } } }));
    expect(await screen.findByRole('article', { name: 'Logged lunch · 13:00' })).toBeInTheDocument();
    await waitFor(() => expect(h.router.state.location.state).toBeNull());
    expect(screen.getAllByText('had dal, rice and two eggs for lunch')).toHaveLength(1);
    expect(h.stub.inspect().entries).toHaveLength(1);
  });

  it('a draft from a tab is sent with that tab as its screen, not "coach" (Q4-15)', async () => {
    let adapter: MockCoachAdapter | null = null;
    const h = renderLiving(<WithMock onReady={(a) => (adapter = a)} />, { path: '/coach', route: 'coach' });
    await waitFor(() => expect(adapter).not.toBeNull());
    const sendSpy = vi.spyOn(adapter!, 'send');
    await act(() => h.router.navigate('/coach', { state: { draft: { text: 'Options to swap boat today?', context: { date: '2026-03-15', screen: 'train' } } } }));
    await waitFor(() => expect(sendSpy).toHaveBeenCalled());
    expect(sendSpy.mock.calls[0]![0]).toMatchObject({ text: 'Options to swap boat today?', context: { screen: 'train', date: '2026-03-15' } });
  });

  it('a prefill draft fills the composer, and its slot and date go with the message when sent (Q4-10)', async () => {
    const user = userEvent.setup();
    let adapter: MockCoachAdapter | null = null;
    const h = renderLiving(<WithMock onReady={(a) => (adapter = a)} />, { path: '/coach', route: 'coach' });
    await waitFor(() => expect(adapter).not.toBeNull());
    const sendSpy = vi.spyOn(adapter!, 'send');
    await act(() => h.router.navigate('/coach', { state: { draft: { text: 'poha and chai', prefill: true, context: { date: '2026-03-15', screen: 'food', slot: 'meal2', slotName: 'lunch' } } } }));
    await waitFor(() => expect(field()).toHaveValue('poha and chai'));
    expect(sendSpy).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(1));
    expect(sendSpy.mock.calls[0]![0]).toMatchObject({ text: 'poha and chai', context: { screen: 'food', slot: 'meal2', slotName: 'lunch', date: '2026-03-15' } });
  });

  it('What the Coach knows opens from ?briefing=1 and says what is sent where', async () => {
    renderLiving(<WithMock />, { path: '/coach?briefing=1', route: 'coach' });
    expect(await screen.findByText('What the Coach knows')).toBeInTheDocument();
    expect(screen.getByText('Spring cut · medium · day 15 of 84')).toBeInTheDocument();
    expect(screen.getByText(/^Anthropic \(Claude Sonnet 5\.5\): this conversation/)).toBeInTheDocument();
    expect(screen.getByText(/It can’t change your safety answers/)).toBeInTheDocument();
  });

  it('the briefing key toggles the panel', async () => {
    const user = userEvent.setup();
    renderLiving(<WithMock />, { path: '/coach', route: 'coach' });
    const key = screen.getByRole('button', { name: 'what it knows' });
    expect(key).toHaveAttribute('aria-pressed', 'false');
    await user.click(key);
    expect(key).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByText('Body signals it can see')).toBeInTheDocument();
  });

  it('offline: the message is kept with Send now disabled until the connection is back', async () => {
    const user = userEvent.setup();
    let adapter: MockCoachAdapter | null = null;
    renderLiving(<WithMock status="offline" onReady={(a) => (adapter = a)} />, { path: '/coach', route: 'coach' });
    expect(screen.getByText('You’re offline. Your message is kept; send it when you’re back.')).toBeInTheDocument();
    await say(user, 'had dal for lunch');
    expect(screen.getByText('not sent yet')).toBeInTheDocument();
    const sendNow = screen.getByRole('button', { name: 'Send now' });
    expect(sendNow).toHaveAttribute('aria-disabled', 'true');
    act(() => adapter!.setStatus('ready'));
    await user.click(screen.getByRole('button', { name: 'Send now' }));
    expect(await screen.findByRole('article', { name: 'Logged lunch · 13:00' })).toBeInTheDocument();
    expect(screen.queryByText('not sent yet')).not.toBeInTheDocument();
  });

  it('a provider that could not be set up shows what went wrong and links to the AI provider settings', () => {
    act(() => setCoachProblem('No API key is saved for this provider.'));
    try {
      renderLiving(<CoachPage />, { path: '/coach', route: 'coach' });
      expect(screen.getByText('The Coach couldn’t start with your AI provider.')).toBeInTheDocument();
      expect(screen.getByText('What went wrong: No API key is saved for this provider.')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Check the AI provider' })).toHaveAttribute('href', '/settings/coach');
      expect(screen.queryByText('The Coach needs an AI provider.')).not.toBeInTheDocument();
    } finally {
      act(() => setCoachProblem(null));
    }
  });

  it.each([
    ['keyRefused', 'Your key was refused by Anthropic. Check it in Settings › AI provider.'],
    ['outOfCredit', 'Your provider says you’re out of credit (or at your plan’s limit). Nothing was logged.'],
    ['rateLimited', 'The provider is busy — trying again in 20 s.'],
    ['cors', 'No answer from Anthropic: it may not be running or reachable, or it may not accept requests from a web page.'],
    ['noTools', 'This model can answer and suggest logs, but can’t change anything in Vitals. Logs it suggests appear as cards for you to confirm.'],
    ['basic', 'This model can log and answer questions, but not change your plan or run simulations.'],
    ['safetyNoPlanning', 'In your current safety mode, plans can’t be changed here. I can still log and explain.'],
  ] as const)('state %s shows its notice', (status, text) => {
    renderLiving(<WithMock status={status} />, { path: '/coach', route: 'coach' });
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('a model without tools suggests logs as cards to confirm', async () => {
    const user = userEvent.setup();
    const h = renderLiving(<WithMock status="noTools" />, { path: '/coach', route: 'coach' });
    await say(user, 'had dal for lunch');
    const logIt = await screen.findByRole('button', { name: /^Log lunch/ });
    expect(h.stub.inspect().entries).toHaveLength(0);
    await user.click(logIt);
    await waitFor(() => expect(h.stub.inspect().entries).toHaveLength(1));
    expect(await screen.findByRole('article', { name: 'Logged lunch · 13:00' })).toBeInTheDocument();
  });
});
