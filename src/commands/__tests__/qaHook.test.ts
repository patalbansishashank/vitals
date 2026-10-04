/** The read-only QA hook (Q3): reads go through the bus, writes are refused, opt-in by `?qa=1` only. */
import { beforeEach, describe, expect, it } from 'vitest';
import { useProfileStore } from '@/state/profileStore';
import { qaRequested } from '@/app/qaFlag';
import { installQaHook } from '../qaHook';
import { freshState } from './harness';

beforeEach(() => {
  freshState({ cleared: true });
});

describe('qa hook', () => {
  it('is installed only when the tab asked for it', () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    };
    expect(qaRequested('', storage)).toBe(false);
    expect(qaRequested('?qa=0', storage)).toBe(false);
    expect(qaRequested('?x=1&qa=1', storage)).toBe(true);
    expect(qaRequested('', storage)).toBe(true);
  });

  it('runs read commands and refuses writes', async () => {
    const target: Record<string, unknown> = {};
    const hook = installQaHook(target);
    expect(target.__vitals).toBe(hook);
    expect(hook.commands()).toContain('profile.get');
    expect(hook.commands()).not.toContain('profile.patch');
    expect((await hook.read('profile.get')).ok).toBe(true);
    const before = useProfileStore.getState();
    const w = await hook.read('profile.patch', { weightKg: 50 });
    expect(w).toMatchObject({ ok: false, error: { code: 'surface_forbidden' } });
    expect(useProfileStore.getState()).toBe(before);
    expect((await hook.read('nope.nothing')).ok).toBe(false);
  });
});
