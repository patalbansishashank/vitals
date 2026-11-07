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
import { NoticesRegion } from '@/app/shell/notices';

function WithMock({
  status,
  onReady,
}: {
  status?: CoachStatusKind;
  onReady?: (a: MockCoachAdapter) => void;
}) {
  const clock = useLivingClock();
  const actions = useLivingActions();
  const source = useLivingSource();
  const [adapter] = useState(() =>
    createMockCoachAdapter({ clock, actions, source, ...(status ? { status } : {}) }),
  );
  useEffect(() => {
    onReady?.(adapter);
  }, [adapter, onReady]);
  return (
    <CoachAdapterContext.Provider value={adapter}>
      <NoticesRegion />
      <CoachPage />
    </CoachAdapterContext.Provider>
  );
}

const field = () => screen.getByRole('textbox', { name: 'Message to the Coach' });

/** The header's one ⋯: open it and list its items. */
async function moreItems(user: ReturnType<typeof userEvent.setup>): Promise<string[]> {
  await user.click(screen.getByRole('button', { name: 'More' }));
  return screen.getAllByRole('menuitem').map((m) => m.textContent ?? '');
}

async function say(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(field());
  await user.keyboard(text.replace(/[{[]/g, (c) => c + c));
  await user.keyboard('{Enter}');
}

describe('CoachPage', () => {
  it('renders starter cards, provider status and the composer with one ⋯', () => {
    renderLiving(<WithMock />, { path: '/coach', route: 'coach' });
    expect(screen.getByRole('heading', { level: 1, name: 'Coach' })).toBeInTheDocument();
    expect(screen.queryByText('Claude Sonnet 5.5 · your key')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'More' })).toHaveLength(1);
    expect(screen.getByRole('log', { name: 'Conversation with the Coach' })).toHaveAttribute(
      'aria-live',
      'off',
    );
    expect(screen.getByRole('button', { name: 'Log a meal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask about your weight' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change the plan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'About Coach' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Suggestions' })).not.toBeInTheDocument();
    expect(field()).toBeEnabled();
  });

  it('a starter prefills a message; sending it removes the starters', async () => {
    const user = userEvent.setup();
    const h = renderLiving(<WithMock />, { path: '/coach', route: 'coach' });
    await user.click(screen.getByRole('button', { name: 'Log a meal' }));
    expect(field()).toHaveValue('had dal, rice and two eggs for lunch');
    expect(h.stub.inspect().entries).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByRole('article', { name: 'Logged lunch · 13:00' });
    expect(screen.queryByRole('button', { name: 'Log a meal' })).not.toBeInTheDocument();
  });

  it('food text streams a reply and an applied log card; Undo retracts the entry, Redo logs it again', async () => {
    const user = userEvent.setup();
    const h = renderLiving(<WithMock />, { path: '/coach', route: 'coach' });
    await say(user, 'had dal, rice and two eggs for lunch');

    const card = await screen.findByRole('article', { name: 'Logged lunch · 13:00' });
    // r068 C2: every card in the Coach is the Coach's; no source tag on it
    expect(within(card).queryByText('Coach · text')).not.toBeInTheDocument();
    expect(within(card).getByRole('img', { name: '≈ 640 kcal (510–780)' })).toBeInTheDocument();
    expect(within(card).getByText('protein 33 g (25–41)')).toBeInTheDocument();
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
    expect(
      screen.getByText('This is what that would do. Nothing changes until you apply it.'),
    ).toBeInTheDocument();
    expect(screen.getByText('expires in 24 h')).toBeInTheDocument();
    await user.click(apply);
    expect(
      await screen.findByRole('button', { name: 'Undo proposal: no training Thu–Sat' }),
    ).toBeInTheDocument();
  });

  it('a proposal scrolled out of view puts a "proposals waiting" icon in the header; it scrolls back to it and leaves once seen', async () => {
    // jsdom lays nothing out: a stand-in IntersectionObserver lets the test say what is on screen
    const observers: Array<{ cb: IntersectionObserverCallback; els: Element[] }> = [];
    class FakeIO {
      els: Element[] = [];
      constructor(cb: IntersectionObserverCallback) {
        observers.push({ cb, els: this.els });
      }
      observe(el: Element) {
        this.els.push(el);
      }
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal('IntersectionObserver', FakeIO);
    try {
      const user = userEvent.setup();
      renderLiving(<WithMock />, { path: '/coach', route: 'coach' });
      await say(user, 'I’m busy Thu to Sat, no training');
      await screen.findByRole('button', { name: 'Apply proposal: no training Thu–Sat' });
      const bar = () => within(document.querySelector<HTMLElement>('.lm-ctx')!);
      expect(bar().queryByRole('button', { name: /proposals? waiting/ })).toBeNull();
      const watch = observers.findLast((o) => o.els.some((e) => (e as HTMLElement).dataset.cardId))!;
      const card = watch.els.find((e) => (e as HTMLElement).dataset.cardId) as HTMLElement;
      const seen = (isIntersecting: boolean) =>
        act(() =>
          watch.cb(
            [{ target: card, isIntersecting } as unknown as IntersectionObserverEntry],
            {} as IntersectionObserver,
          ),
        );
      seen(false);
      const icon = bar().getByRole('button', { name: '1 proposal waiting' });
      expect(icon).toHaveClass('lm-status-icon');
      expect(icon.querySelector('.lm-status-icon__dot')).not.toBeNull();
      const scrolled = vi.fn();
      card.scrollIntoView = scrolled;
      await user.click(icon);
      expect(scrolled).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
      seen(true);
      expect(bar().queryByRole('button', { name: /proposals? waiting/ })).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
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
    expect(
      await screen.findByRole('article', { name: 'Not allowed by your safety settings · a 48-hour fast' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Plan a 24-hour fast instead' }));
    expect(
      await screen.findByRole('article', { name: 'Proposal · a 24-hour fast on Sat 3 Oct' }),
    ).toBeInTheDocument();
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
    expect(screen.getByText('Photo attached')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(
      await screen.findByText('Sent to Anthropic for this message only; the photo stays on this device.'),
    ).toBeInTheDocument();
    const card = await screen.findByRole('article', { name: 'Logged lunch · 13:00' });
    expect(within(card).queryByText('Coach · photo')).not.toBeInTheDocument();
    expect(within(card).getByText('looks glossy: about 2 tsp oil added')).toBeInTheDocument();
    expect(within(card).getByRole('img', { name: '≈ 720 kcal (470–970)' })).toBeInTheDocument();
    // alt text from the "what I saw" summary
    expect(screen.getAllByRole('img', { name: 'Your photo: dal tadka, rice, roti' }).length).toBeGreaterThan(
      0,
    );
    expect(h.stub.inspect().entries).toHaveLength(1);

    await user.click(
      within(card).getByRole('button', { name: 'Change dal tadka: 1 katori ≈ 150 g (100–210)' }),
    );
    const grams = within(card).getByLabelText('dal tadka, grams');
    await user.clear(grams);
    await user.type(grams, '180{Enter}');
    expect(await within(card).findByText('Coach · photo + your grams')).toBeInTheDocument();
    expect(within(card).getByRole('img', { name: '≈ 768 kcal (650–880)' })).toBeInTheDocument();
    expect(within(card).getByText('protein 26 g (21–31)')).toBeInTheDocument();
    expect(h.stub.inspect().entries).toHaveLength(1);
  });

  it('Stop ends the stream; proposals already made stay', async () => {
    renderLiving(<WithMock />, { path: '/coach', route: 'coach' });
    fireEvent.change(field(), { target: { value: 'busy Thu to Sat' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    const stop = screen.getByRole('button', { name: 'Stop the Coach' });
    fireEvent.click(stop);
    expect(
      await screen.findByText('Stopped. Proposals already made are still waiting below.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument());
  });

  it('no provider: one line and one action, the composer honestly disabled, nothing about the briefing', async () => {
    renderLiving(<CoachPage />, { path: '/coach', route: 'coach' });
    expect(screen.getByRole('heading', { level: 1, name: 'Coach' })).toBeInTheDocument();
    expect(screen.getByText('Connect an AI provider to use the Coach.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set up a provider' })).toHaveAttribute(
      'href',
      '/settings/coach',
    );
    expect(screen.queryByText(/log everything by hand/)).not.toBeInTheDocument();
    expect(screen.queryByRole('log')).not.toBeInTheDocument();
    expect(field()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Add a PDF report' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Suggestions' })).not.toBeInTheDocument();
    // "What the Coach knows" only once a provider is connected: with no page action left, no ⋯ at all (r068 U14)
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'What the Coach knows' })).toBeNull();
  });

  it('works without a plan (Planning mode): planning prompts, and nothing is logged', async () => {
    const user = userEvent.setup();
    const h = renderLiving(<WithMock />, { plan: null, path: '/coach', route: 'coach' });
    expect(screen.getByRole('heading', { level: 1, name: 'Coach' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Help me choose a plan' })).toBeInTheDocument();
    await say(user, 'had dal for lunch');
    expect(
      await screen.findByText(/No plan is running, so there’s nothing to log against yet/),
    ).toBeInTheDocument();
    expect(h.stub.inspect().entries).toHaveLength(0);
  });

  it('renders without a plan and without a provider', () => {
    renderLiving(<CoachPage />, { plan: null, path: '/coach', route: 'coach' });
    expect(screen.getByRole('heading', { level: 1, name: 'Coach' })).toBeInTheDocument();
    expect(screen.getByText('Connect an AI provider to use the Coach.')).toBeInTheDocument();
  });

  it('sends a draft handed over in the navigation state once, then clears it', async () => {
    const h = renderLiving(<WithMock />, { path: '/coach', route: 'coach' });
    await act(() =>
      h.router.navigate('/coach', { state: { draft: { text: 'had dal, rice and two eggs for lunch' } } }),
    );
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
    await act(() =>
      h.router.navigate('/coach', {
        state: {
          draft: { text: 'Options to swap boat today?', context: { date: '2026-03-15', screen: 'train' } },
        },
      }),
    );
    await waitFor(() => expect(sendSpy).toHaveBeenCalled());
    expect(sendSpy.mock.calls[0]![0]).toMatchObject({
      text: 'Options to swap boat today?',
      context: { screen: 'train', date: '2026-03-15' },
    });
  });

  it('a prefill draft fills the composer, and its slot and date go with the message when sent (Q4-10)', async () => {
    const user = userEvent.setup();
    let adapter: MockCoachAdapter | null = null;
    const h = renderLiving(<WithMock onReady={(a) => (adapter = a)} />, { path: '/coach', route: 'coach' });
    await waitFor(() => expect(adapter).not.toBeNull());
    const sendSpy = vi.spyOn(adapter!, 'send');
    await act(() =>
      h.router.navigate('/coach', {
        state: {
          draft: {
            text: 'poha and chai',
            prefill: true,
            context: { date: '2026-03-15', screen: 'food', slot: 'meal2', slotName: 'lunch' },
          },
        },
      }),
    );
    await waitFor(() => expect(field()).toHaveValue('poha and chai'));
    expect(sendSpy).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(1));
    expect(sendSpy.mock.calls[0]![0]).toMatchObject({
      text: 'poha and chai',
      context: { screen: 'food', slot: 'meal2', slotName: 'lunch', date: '2026-03-15' },
    });
  });

  it('What the Coach knows opens from ?briefing=1 and says what is sent where', async () => {
    renderLiving(<WithMock />, { path: '/coach?briefing=1', route: 'coach' });
    expect(await screen.findByText('What the Coach knows')).toBeInTheDocument();
    expect(screen.getByText('Spring cut · day 15 of 84')).toBeInTheDocument();
    expect(screen.getByText(/^Anthropic \(Claude Sonnet 5\.5\): this conversation/)).toBeInTheDocument();
    expect(screen.getByText(/It can’t change your safety answers/)).toBeInTheDocument();
  });

  it('What the Coach knows opens from the header ⋯ in a slide-in panel; Close and Escape close it', async () => {
    const user = userEvent.setup();
    renderLiving(<WithMock />, { path: '/coach', route: 'coach' });
    expect(await moreItems(user)).toEqual(expect.arrayContaining(['What the Coach knows']));
    await user.click(screen.getByRole('menuitem', { name: 'What the Coach knows' }));
    expect(await screen.findByText('Still to ask')).toBeInTheDocument();
    const panel = screen.getByText('Still to ask').closest<HTMLElement>('.lm-panel__body')!.parentElement!;
    await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));
    await user.click(within(panel).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByText('Still to ask')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: 'More' })).toHaveFocus());
    await moreItems(user);
    await user.click(screen.getByRole('menuitem', { name: 'What the Coach knows' }));
    expect(await screen.findByText('Still to ask')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('Still to ask')).not.toBeInTheDocument());
  });

  it('quiet mode: one fact line at the start of the conversation, and Show numbers in the ⋯', async () => {
    const user = userEvent.setup();
    const h = renderLiving(<WithMock />, { path: '/coach', route: 'coach' });
    await act(() => h.stub.actions.setQuietMode(true));
    const line = 'Quiet mode: the Coach talks about portions, not calories or scores.';
    expect(await screen.findByText(line)).toBeInTheDocument();
    await moreItems(user);
    await user.click(screen.getByRole('menuitem', { name: 'Show numbers' }));
    await waitFor(() => expect(screen.queryByText(line)).not.toBeInTheDocument());
    expect(await moreItems(user)).toContain('Hide numbers');
  });

  it('offline: an offline icon in the header; the message is kept with Send now disabled until the connection is back', async () => {
    const user = userEvent.setup();
    let adapter: MockCoachAdapter | null = null;
    renderLiving(<WithMock status="offline" onReady={(a) => (adapter = a)} />, {
      path: '/coach',
      route: 'coach',
    });
    const offline = within(document.querySelector<HTMLElement>('.lm-ctx')!).getByRole('button', {
      name: 'You’re offline',
    });
    expect(offline).toHaveClass('lm-status-icon');
    // nothing to open: a press shows what it means
    await user.click(offline);
    expect(screen.getByRole('tooltip')).toHaveTextContent('You’re offline');
    await say(user, 'had dal for lunch');
    expect(screen.getByText('Not sent yet')).toBeInTheDocument();
    const sendNow = screen.getByRole('button', { name: 'Send now' });
    expect(sendNow).toHaveAttribute('aria-disabled', 'true');
    act(() => adapter!.setStatus('ready'));
    expect(screen.queryByRole('button', { name: 'You’re offline' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send now' }));
    expect(await screen.findByRole('article', { name: 'Logged lunch · 13:00' })).toBeInTheDocument();
    expect(screen.queryByText('Not sent yet')).not.toBeInTheDocument();
  });

  it('a provider that could not be set up shows what went wrong and links to the AI provider settings', () => {
    act(() => setCoachProblem('No API key is saved for this provider.'));
    try {
      renderLiving(<CoachPage />, { path: '/coach', route: 'coach' });
      const alert = screen.getByRole('alert');
      expect(within(alert).getByText('The Coach couldn’t start with your AI provider.')).toBeInTheDocument();
      expect(within(alert).getByText('No API key is saved for this provider.')).toBeInTheDocument();
      expect(within(alert).getByRole('link', { name: 'Check the AI provider' })).toHaveAttribute(
        'href',
        '/settings/coach',
      );
      expect(screen.queryByText('Connect an AI provider to use the Coach.')).not.toBeInTheDocument();
      expect(field()).toBeDisabled();
    } finally {
      act(() => setCoachProblem(null));
    }
  });

  it.each([
    ['keyRefused', 'Your key was refused by Anthropic. Check it in Settings › Coach.'],
    ['outOfCredit', 'Your provider says you’re out of credit (or at your plan’s limit). Nothing was logged.'],
    [
      'cors',
      'No answer from Anthropic: it may not be running or reachable, or it may not accept requests from a web page.',
    ],
  ] as const)(
    'state %s: the banner under the header says what failed, one key to Settings; the composer is disabled',
    (status, text) => {
      renderLiving(<WithMock status={status} />, { path: '/coach', route: 'coach' });
      const banner = screen.getByText(text).closest<HTMLElement>('.lm-notices')!;
      expect(banner).not.toBeNull();
      expect(within(banner).getByRole('link', { name: 'Open Settings' })).toHaveAttribute(
        'href',
        '/settings/coach',
      );
      expect(screen.getByRole('log').contains(screen.getByText(text))).toBe(false);
      expect(field()).toBeDisabled();
    },
  );

  it('state rateLimited: a status icon in the header counts down to the retry in its name, its dot breathing', () => {
    renderLiving(<WithMock status="rateLimited" />, { path: '/coach', route: 'coach' });
    const busy = screen.getByRole('button', { name: 'Provider busy: retrying in 20 s' });
    expect(busy.querySelector('.lm-status-icon__dot')).toHaveAttribute('data-pulse', 'true');
    expect(field()).toBeEnabled();
  });

  it.each([
    ['noTools', 'This model can’t change anything in Vitals. Logs it suggests wait for you to confirm.'],
    ['basic', 'This model can log and answer questions, but not change your plan or run simulations.'],
    [
      'safetyNoPlanning',
      'Your safety mode doesn’t allow plan changes here. The Coach can still log and explain.',
    ],
  ] as const)('state %s: one fact line at the start of the conversation', (status, text) => {
    renderLiving(<WithMock status={status} />, { path: '/coach', route: 'coach' });
    const log = screen.getByRole('log', { name: 'Conversation with the Coach' });
    expect(log.firstElementChild).toHaveTextContent(text);
    expect(document.querySelector('.lm-notices')).toBeNull();
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
