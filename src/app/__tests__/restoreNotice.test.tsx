import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { startRestoreNotice, RESTORE_NOTICE_ID } from '../restoreNotice';
import { useNoticeStore, showNotice, NoticesRegion, ANDROID_UPDATE_NOTICE_ID } from '../shell/notices';

const state = vi.hoisted(() => ({ invalidated: false, listeners: new Set<() => void>() }));
vi.mock('@/state/writeBarrier', () => ({ externalRestoreRequired: () => state.invalidated, onExternalRestore: (f: () => void) => { state.listeners.add(f); return () => state.listeners.delete(f); } }));
vi.mock('@/agents/activity', () => ({ useAgentActive: () => false }));
afterEach(() => { state.invalidated = false; state.listeners.clear(); useNoticeStore.setState({ notices: [] }); });
it('keeps a persistent Reload action and respects danger and update priorities', () => {
  const reload = vi.fn();
  const stop = startRestoreNotice(reload);
  render(<NoticesRegion />);
  act(() => { state.invalidated = true; state.listeners.forEach(f => f()); });
  expect(screen.getByText('Data was replaced in another window. Reload to continue.')).toBeVisible();
  expect(useNoticeStore.getState().notices[0]).toMatchObject({ id: RESTORE_NOTICE_ID, dismissible: false, collapsible: false });
  fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
  expect(reload).toHaveBeenCalledTimes(1);
  act(() => showNotice({ id: 'pwa-update', severity: 'info', priority: 1, title: 'Update available' }));
  expect(useNoticeStore.getState().notices[0]?.id).toBe('pwa-update');
  act(() => showNotice({ id: ANDROID_UPDATE_NOTICE_ID, severity: 'caution', priority: 0, title: 'Phone update' }));
  expect(useNoticeStore.getState().notices[0]?.id).toBe(ANDROID_UPDATE_NOTICE_ID);
  act(() => showNotice({ id: 'danger', severity: 'danger', title: 'Safety notice' }));
  expect(useNoticeStore.getState().notices[0]?.id).toBe('danger');
  act(stop);
  expect(useNoticeStore.getState().notices.some(n => n.id === RESTORE_NOTICE_ID)).toBe(false);
});
it('shows an invalidation that arrived before the shell mounted', () => {
  state.invalidated = true;
  const stop = startRestoreNotice(vi.fn());
  expect(useNoticeStore.getState().notices[0]?.id).toBe(RESTORE_NOTICE_ID);
  stop();
});
