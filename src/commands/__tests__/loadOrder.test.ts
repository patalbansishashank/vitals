/**
 * (0.6.5) The production bundle may evaluate an executor module before the `./defs/*` module that declares its stubs
 * (a screen imports a helper from `commands/living/activity`). The executors used to be dropped silently, so Approve,
 * Approve all and Log answered "This isn't available in this version of Vitals yet." on the phone and the desktop.
 */
import { describe, expect, it, vi } from 'vitest';

const ACTIVITY = [
  'activity.candidates',
  'activity.approve',
  'activity.approveAll',
  'activity.edit',
  'activity.reject',
  'activity.logManual',
  'activity.fromGauge',
  'activity.autoAccept',
];

describe('executor modules evaluated before their stubs', () => {
  it('still replace the stubs (the activity commands are implemented, nothing waits)', async () => {
    vi.resetModules();
    // the production order: a screen's helper import first, the command index after
    await import('@/commands/living/activity');
    const { getCommand } = await import('@/commands/registry');
    await import('@/commands');
    const { pendingImplementations } = await import('@/commands/implement');
    for (const id of ACTIVITY) expect(getCommand(id)?.notImplemented, id).toBeUndefined();
    expect(pendingImplementations()).toEqual([]);
  }, 60_000);

  it('the usual order is unchanged', async () => {
    vi.resetModules();
    await import('@/commands');
    const { getCommand } = await import('@/commands/registry');
    for (const id of ACTIVITY) expect(getCommand(id)?.notImplemented, id).toBeUndefined();
  }, 60_000);
});
