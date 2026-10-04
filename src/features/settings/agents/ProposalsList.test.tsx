import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { dispatch, outputOf, settleCommits } from '@/commands';
import { freshState, MCP } from '@/commands/__tests__/harness';
import { getDocumentStore } from '@/state/runtime';
import { useProfileStore } from '@/state/profileStore';
import { agentProductName, ProposalsList, proposalDetail, proposerName } from './ProposalsList';

const LONG = { timeout: 4000 };

async function stage(weightKg: number) {
  const r = await dispatch('profile.patch', { weightKg }, { actor: MCP, idempotencyKey: `stage-${weightKg}` });
  expect(r.ok && 'pending' in r).toBe(true);
  await settleCommits();
  return r.ok && 'pending' in r ? r.pending.pendingId : '';
}

beforeEach(() => {
  freshState({ cleared: true });
});

describe('Settings › Agents › proposals', () => {
  it('says so quietly when nothing waits', async () => {
    render(<ProposalsList />);
    expect(await screen.findByText('No proposals waiting.')).toBeInTheDocument();
  });

  it('lists a staged agent proposal, and Apply applies it as the person', async () => {
    const before = useProfileStore.getState().weightKg;
    await stage(77);
    expect(useProfileStore.getState().weightKg).toBe(before);
    const user = userEvent.setup();
    render(<ProposalsList />);
    const list = await screen.findByRole('list', { name: 'Proposals waiting' });
    const row = within(list).getByRole('listitem');
    expect(row).toHaveTextContent('claude-desktop through your server');
    expect(row).toHaveTextContent('weight kg 77');
    expect(row).toHaveTextContent(/valid until/);
    await user.click(within(row).getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText('No proposals waiting.', {}, LONG)).toBeInTheDocument();
    expect(useProfileStore.getState().weightKg).toBe(77);
    expect(outputOf(await dispatch('coach.pending', {}))).toHaveLength(0);
  });

  it('Dismiss discards it without changing anything', async () => {
    const before = useProfileStore.getState().weightKg;
    const pendingId = await stage(76);
    const user = userEvent.setup();
    render(<ProposalsList />);
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(await screen.findByText('No proposals waiting.', {}, LONG)).toBeInTheDocument();
    await settleCommits();
    expect(getDocumentStore().peek<{ status: string }>('pendingChanges', pendingId)?.status).toBe('discarded');
    expect(useProfileStore.getState().weightKg).toBe(before);
  });

  it('shows the reason plainly when a proposal went stale', async () => {
    await dispatch('profile.patch', { weightKg: 80 });
    await settleCommits();
    await stage(75);
    await dispatch('profile.patch', { weightKg: 81 });
    await settleCommits();
    const user = userEvent.setup();
    render(<ProposalsList />);
    await user.click(await screen.findByRole('button', { name: 'Apply' }));
    expect(await screen.findByText(/edited since/, {}, LONG)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('No proposals waiting.')).toBeInTheDocument(), LONG);
  });

  it('says what a proposal would change, from its input', () => {
    expect(proposalDetail({ kind: 'busy', from: '2026-10-02', to: '2026-10-02', note: 'away' })).toBe('kind busy · from 2026-10-02 · to 2026-10-02 · note away');
    expect(proposalDetail({ date: '2026-10-02', patch: { note: 'x', kcal: 2000 }, scope: 'day' })).toBe('date 2026-10-02 · note x · kcal 2000 · scope day');
    expect(proposalDetail({ source: { scenarioId: 's1' }, startDate: '2026-10-02' })).toBe('scenario id s1 · start date 2026-10-02');
    expect(proposalDetail({})).toBe('');
    expect(proposalDetail({ note: 'a'.repeat(300) })).toHaveLength(200);
  });

  it('names the proposer plainly', () => {
    expect(proposerName({ kind: 'ai', id: 'test-preset' })).toBe('the Coach');
    expect(proposerName({ kind: 'mcp', id: 'codex' })).toBe('codex through your server');
    expect(proposerName({ kind: 'webmcp', id: 'webmcp' })).toBe('an agent in this browser');
  });

  it('names MCP clients by product, not by raw client id (Q5-02)', () => {
    expect(proposerName({ kind: 'mcp', id: 'codex-mcp-client' })).toBe('Codex or the ChatGPT app through your server');
    expect(proposerName({ kind: 'mcp', id: 'cli' })).toBe('OpenCode through your server');
    expect(proposerName({ kind: 'mcp', id: 'opencode' })).toBe('OpenCode through your server');
    expect(proposerName({ kind: 'mcp', id: 'claude-code' })).toBe('Claude Code through your server');
    expect(proposerName({ kind: 'companion', id: 'chatgpt' })).toBe('ChatGPT through your server');
    expect(proposerName({ kind: 'mcp', id: 'my-agent' })).toBe('my-agent through your server');
    expect(agentProductName('constructor')).toBe('constructor');
  });

  it('picks up a proposal staged while it is open', async () => {
    render(<ProposalsList />);
    await screen.findByText('No proposals waiting.');
    await stage(74);
    expect(await screen.findByRole('button', { name: 'Apply' }, LONG)).toBeInTheDocument();
  });
});
