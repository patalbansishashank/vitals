import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import type { ServerChat, ServerCoachControls } from '../adapter';
import { ServerChatsPanel } from '../components/ServerChats';

const now = new Date('2026-10-31T10:00:00Z');
const row = (id: string): ServerChat => ({ id, title: id, createdAt: now.toISOString(), expiresAt: now.toISOString() });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const controls = (over: Partial<ServerCoachControls> = {}): ServerCoachControls => ({
  current: () => null,
  retentionHours: () => 24,
  list: async () => [row('first')],
  open: async () => ({ ok: true }),
  keep: async () => ({ ok: true }),
  remove: async () => ({ ok: true }),
  fresh: () => undefined,
  ...over,
});
const panel = (c: ServerCoachControls, open = true, onOpened = vi.fn()) =>
  <ServerChatsPanel open={open} onClose={() => undefined} controls={c} now={now} onOpened={onOpened} />;

describe('Server chats panel requests', () => {
  it('clears old rows and errors on reopen or control identity change, and ignores late lists', async () => {
    const pending = deferred<ServerChat[]>();
    const first = controls({ list: () => pending.promise });
    const next = controls({ list: async () => [row('new account')] });
    const view = render(panel(first));
    view.rerender(panel(first, false));
    view.rerender(panel(next));
    expect(screen.queryByText('first')).toBeNull();
    await screen.findByText('new account');
    await act(async () => pending.resolve([row('stale')]));
    expect(screen.queryByText('stale')).toBeNull();

    view.rerender(panel(next, false));
    view.rerender(panel(first));
    expect(screen.queryByText('new account')).toBeNull();
  });

  it.each(['sync', 'async'] as const)('shows a %s list failure without retaining old rows', async (kind) => {
    const broken = controls({ list: kind === 'sync' ? (() => { throw new Error('offline'); }) : (() => Promise.reject(new Error('offline'))) });
    const view = render(panel(controls()));
    await screen.findByText('first');
    view.rerender(panel(broken));
    expect(screen.queryByText('first')).toBeNull();
    expect(await screen.findByText('Couldn’t read the chats on your server.')).toBeInTheDocument();
  });

  it.each(['open', 'delete'] as const)('shows a rejected %s action, clears busy, and allows retry', async (kind) => {
    const rejected = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ok: true });
    const c = controls(kind === 'open' ? { open: rejected } : { remove: rejected });
    const onOpened = vi.fn();
    render(panel(c, true, onOpened));
    await screen.findByText('first');
    const button = screen.getByRole('button', { name: `${kind === 'open' ? 'Open' : 'Delete'} first` });
    fireEvent.click(button);
    expect(await screen.findByText('Couldn’t read the chats on your server.')).toBeInTheDocument();
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    if (kind === 'open') await waitFor(() => expect(onOpened).toHaveBeenCalledTimes(1));
    else await waitFor(() => expect(screen.queryByText('first')).toBeNull());
  });

  it('ignores a late action after the panel changes controls', async () => {
    const opening = deferred<{ ok: boolean }>();
    const removing = deferred<{ ok: boolean }>();
    const old = controls({ open: () => opening.promise, remove: () => removing.promise });
    const next = controls({ list: async () => [row('new account')] });
    const onOpened = vi.fn();
    const view = render(panel(old, true, onOpened));
    await screen.findByText('first');
    fireEvent.click(screen.getByRole('button', { name: 'Open first' }));
    view.rerender(panel(next, true, onOpened));
    await screen.findByText('new account');
    await act(async () => opening.resolve({ ok: true }));
    expect(onOpened).not.toHaveBeenCalled();

    view.rerender(panel(old, true, onOpened));
    await screen.findByText('first');
    fireEvent.click(screen.getByRole('button', { name: 'Delete first' }));
    view.rerender(panel(next, true, onOpened));
    await screen.findByText('new account');
    await act(async () => removing.resolve({ ok: true }));
    expect(screen.getByText('new account')).toBeInTheDocument();
  });

  it('uses the current onOpened callback when it changes during an open action', async () => {
    const opening = deferred<{ ok: boolean }>();
    const c = controls({ open: () => opening.promise });
    const oldCallback = vi.fn();
    const newCallback = vi.fn();
    const view = render(panel(c, true, oldCallback));
    await screen.findByText('first');
    fireEvent.click(screen.getByRole('button', { name: 'Open first' }));
    view.rerender(panel(c, true, newCallback));
    await act(async () => opening.resolve({ ok: true }));
    expect(oldCallback).not.toHaveBeenCalled();
    expect(newCallback).toHaveBeenCalledTimes(1);
  });
});
