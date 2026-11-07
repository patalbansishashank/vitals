/**
 * The Coach page while paired (server-coach contract): no "connect a provider", the reply streams from the server, a
 * proposal is a pending card with Apply, the chat's expiry is the one fact line, and the ⋯ holds the server's chats.
 */
import { useState } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createServerCoachAdapter } from '@/ai/coach/serverAdapter';
import { memoryStorage } from '@/features/settings/server/__tests__/fakeServer';
import { createServerCoachClient } from '@/net/coach';
import { setServerClientForTests } from '@/net/server';
import { coachClientOn, fakeCoachServer } from '@/net/__tests__/fakeCoachServer';
import { renderLiving } from '../../testing';
import CoachPage from '../CoachPage';
import { CoachAdapterContext } from '../adapter';

afterEach(() => setServerClientForTests(null));

function setup(overrides: Parameters<typeof fakeCoachServer>[0] = {}) {
  const server = fakeCoachServer(overrides);
  const { client } = coachClientOn(server);
  setServerClientForTests(client);
  const applied: unknown[] = [];
  const adapter = createServerCoachAdapter({
    client: createServerCoachClient({ server: client }),
    bus: {
      dispatch: async (id, input) => {
        if (id === 'coach.applyPending') applied.push(input);
        return { ok: true, output: id === 'coach.pending' ? [] : { applied: true } } as never;
      },
    },
    storage: memoryStorage(),
    recheckMs: 0,
  });
  function WithServer() {
    const [a] = useState(() => adapter);
    return (
      <CoachAdapterContext.Provider value={a}>
        <CoachPage />
      </CoachAdapterContext.Provider>
    );
  }
  return { server, adapter, applied, WithServer };
}

const field = () => screen.getByRole('textbox', { name: 'Message to the Coach' });

describe('CoachPage with the Coach on the server', () => {
  it('paired, before the server adapter is there: no "connect a provider", the composer waits', () => {
    setServerClientForTests(coachClientOn(fakeCoachServer()).client);
    renderLiving(<CoachPage />, { path: '/coach', route: 'coach' });
    expect(screen.queryByText('Connect an AI provider to use the Coach.')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Set up a provider' })).toBeNull();
    expect(field()).toBeDisabled();
  });

  it('streams the reply, shows the proposal with Apply, and the chat’s expiry as one line', async () => {
    const user = userEvent.setup();
    const { WithServer, adapter, applied } = setup({
      script: () => [{ type: 'delta', text: 'Moving Friday’s fast is fine.' }, { type: 'proposal', id: 'pend-7', summary: 'Move the fast to Saturday' }, { type: 'done' }],
    });
    await adapter.refreshStatus();
    renderLiving(<WithServer />, { path: '/coach', route: 'coach' });
    await waitFor(() => expect(field()).toBeEnabled());
    await user.click(field());
    await user.keyboard('move my fast{Enter}');
    expect(await screen.findByText('Moving Friday’s fast is fine.')).toBeInTheDocument();
    const card = await screen.findByRole('article', { name: /Proposal · move the fast to Saturday/ });
    await user.click(within(card).getByRole('button', { name: /Apply/ }));
    await waitFor(() => expect(applied).toEqual([{ pendingId: 'pend-7' }]));
    expect(screen.getByText(/^On your server until /)).toBeInTheDocument();
  });

  it('the server can’t answer: its reason is the one line, the composer is disabled, no Settings banner', async () => {
    const { WithServer, adapter } = setup({ status: { available: false, backend: 'codex', retentionHours: 24, reason: 'The server’s AI is not signed in' } });
    await adapter.refreshStatus();
    renderLiving(<WithServer />, { path: '/coach', route: 'coach' });
    expect(screen.getByText('The server’s AI is not signed in')).toBeInTheDocument();
    expect(field()).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Open Settings' })).toBeNull();
  });

  it('the ⋯ lists the chats on the server, keeps and deletes the open one', async () => {
    const user = userEvent.setup();
    const { WithServer, adapter, server } = setup();
    await adapter.refreshStatus();
    renderLiving(<WithServer />, { path: '/coach', route: 'coach' });
    await waitFor(() => expect(field()).toBeEnabled());
    await user.click(field());
    await user.keyboard('hello{Enter}');
    expect(await screen.findByText(/^You said: hello/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'More' }));
    const items = screen.getAllByRole('menuitem').map((m) => m.textContent);
    expect(items).toEqual(expect.arrayContaining(['Chats on your server', 'New chat', 'Keep 24 h longer', 'Delete this chat']));
    await user.click(screen.getByRole('menuitem', { name: 'Chats on your server' }));
    expect(await screen.findByText('Open now')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete this chat' }));
    await waitFor(() => expect(server.state.sessions.size).toBe(0));
    expect(screen.queryByText(/^You said: hello/)).toBeNull();
  });
});
