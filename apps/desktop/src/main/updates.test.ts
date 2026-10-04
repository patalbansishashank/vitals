import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateState } from '../shared/bridge';
import { CHECK_EVERY_MS, createUpdates, type AutoUpdaterLike, type PackageKind } from './updates';

class FakeUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit: boolean | undefined;
  feed: unknown;
  installs = 0;
  checks = 0;
  /** What a check does: emit events, or throw. */
  onCheck: () => Promise<void> | void = () => void this.emit('update-not-available');
  setFeedURL(o: unknown): void {
    this.feed = o;
  }
  async checkForUpdates(): Promise<unknown> {
    this.checks++;
    await this.onCheck();
    return null;
  }
  quitAndInstall(): void {
    this.installs++;
  }
}

function setup(kind: PackageKind, feedUrl?: string) {
  const updater = new FakeUpdater();
  const states: UpdateState[] = [];
  const updates = createUpdates({
    updater: updater as unknown as AutoUpdaterLike,
    packageKind: kind,
    downloadUrl: 'https://example.invalid/releases',
    onState: (s) => states.push(s),
    feedUrl,
  });
  return { updater, states, updates, names: () => states.map((s) => s.state) };
}

describe('updates', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each([
    ['appimage', true],
    ['nsis', true],
    ['deb', false],
    ['dmg', false],
  ] as const)('%s: autoDownload is %s', (kind, auto) => {
    const { updater } = setup(kind);
    expect(updater.autoDownload).toBe(auto);
  });

  it.each(['appimage', 'nsis'] as const)('%s: idle -> checking -> downloading -> ready, then restart installs', async (kind) => {
    const { updater, updates, states } = setup(kind);
    updater.onCheck = () => void updater.emit('update-available', { version: '0.5.0' });
    await updates.check();
    expect(updates.state()).toEqual({ state: 'downloading', version: '0.5.0' });
    updates.restart();
    expect(updater.installs).toBe(0);
    updater.emit('update-downloaded', { version: '0.5.0' });
    expect(updates.state()).toEqual({ state: 'ready', version: '0.5.0' });
    updates.restart();
    expect(updater.installs).toBe(1);
    expect(states.map((s) => s.state)).toEqual(['checking', 'downloading', 'ready']);
  });

  it.each(['deb', 'dmg'] as const)('%s: a newer version gives manual with the download link', async (kind) => {
    const { updater, updates } = setup(kind);
    updater.onCheck = () => void updater.emit('update-available', { version: '0.5.0' });
    await updates.check();
    expect(updates.state()).toEqual({ state: 'manual', version: '0.5.0', url: 'https://example.invalid/releases' });
    updates.restart();
    expect(updater.installs).toBe(0);
  });

  it('no newer version goes back to idle', async () => {
    const { updates, names } = setup('appimage');
    await updates.check();
    expect(names()).toEqual(['checking', 'idle']);
  });

  it('a check with no event at all ends idle', async () => {
    const { updater, updates } = setup('deb');
    updater.onCheck = () => undefined;
    await updates.check();
    expect(updates.state().state).toBe('idle');
  });

  it('a failed check becomes error and does not throw; the next check can recover', async () => {
    const { updater, updates } = setup('appimage');
    updater.onCheck = () => {
      throw new Error('offline');
    };
    await expect(updates.check()).resolves.toBeUndefined();
    expect(updates.state()).toEqual({ state: 'error' });
    updater.onCheck = () => void updater.emit('update-not-available');
    await updates.check();
    expect(updates.state().state).toBe('idle');
  });

  it('an error event while downloading becomes error; a ready update is kept', async () => {
    const { updater, updates } = setup('nsis');
    updater.onCheck = () => void updater.emit('update-available', { version: '0.5.0' });
    await updates.check();
    updater.emit('error', new Error('network'));
    expect(updates.state()).toEqual({ state: 'error' });
    updater.emit('update-downloaded', { version: '0.5.0' });
    updater.emit('error', new Error('late'));
    expect(updates.state().state).toBe('ready');
  });

  it('does not check again while downloading or ready', async () => {
    const { updater, updates } = setup('appimage');
    updater.onCheck = () => void updater.emit('update-available', { version: '0.5.0' });
    await updates.check();
    await updates.check();
    expect(updater.checks).toBe(1);
    updater.emit('update-downloaded', { version: '0.5.0' });
    await updates.check();
    expect(updater.checks).toBe(1);
  });

  it('dev never checks and stays idle', async () => {
    const { updater, updates, states } = setup('dev');
    updates.start();
    await updates.check();
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 2);
    expect(updater.checks).toBe(0);
    expect(states).toEqual([]);
    expect(updates.state()).toEqual({ state: 'idle' });
  });

  it('feedUrl sets a generic feed; without it the builder config is left alone', () => {
    expect(setup('appimage', 'http://127.0.0.1:9/feed').updater.feed).toEqual({ provider: 'generic', url: 'http://127.0.0.1:9/feed' });
    expect(setup('appimage').updater.feed).toBeUndefined();
  });

  it('start checks at once and every 6 hours; stop ends it', async () => {
    const { updater, updates } = setup('deb');
    updates.start();
    updates.start(); // a second start adds no second timer
    await vi.advanceTimersByTimeAsync(0);
    expect(updater.checks).toBe(1);
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS - 1);
    expect(updater.checks).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(updater.checks).toBe(2);
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(updater.checks).toBe(3);
    updates.stop();
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 3);
    expect(updater.checks).toBe(3);
  });

  it('a throwing state listener does not stop the check', async () => {
    const updater = new FakeUpdater();
    const updates = createUpdates({
      updater: updater as unknown as AutoUpdaterLike,
      packageKind: 'deb',
      downloadUrl: 'x',
      onState: () => {
        throw new Error('boom');
      },
    });
    await expect(updates.check()).resolves.toBeUndefined();
    expect(updates.state().state).toBe('idle');
  });
});
