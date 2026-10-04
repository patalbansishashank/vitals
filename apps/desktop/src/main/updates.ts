/**
 * Auto-update (SUITE_SPEC §15.6) with electron-updater. AppImage and Windows installs download in the background and
 * restart into the new version; deb and unsigned macOS only check, and show "A new version is ready" with the download
 * link. A development run never checks. A check never throws: a failure becomes the state `error`.
 */
import type { UpdateState } from '../shared/bridge';

export type PackageKind = 'appimage' | 'deb' | 'nsis' | 'dmg' | 'dev';

/** The slice of electron-updater's `autoUpdater` used here. */
export interface AutoUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit?: boolean;
  on(event: string, listener: (...args: any[]) => void): unknown; // eslint-disable-line @typescript-eslint/no-explicit-any
  removeListener?(event: string, listener: (...args: any[]) => void): unknown; // eslint-disable-line @typescript-eslint/no-explicit-any
  setFeedURL(options: { provider: 'generic'; url: string }): void;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(): void;
}

export interface Updates {
  /** Checks now and then every 6 hours. */
  start(): void;
  check(): Promise<void>;
  /** Restarts into the downloaded version; does nothing unless the state is `ready`. */
  restart(): void;
  state(): UpdateState;
  stop(): void;
}

export interface UpdatesOptions {
  updater: AutoUpdaterLike;
  packageKind: PackageKind;
  /** Where the person downloads a new version (kinds that cannot update in place). */
  downloadUrl: string;
  onState(s: UpdateState): void;
  /** Env VITALS_UPDATE_FEED: a generic feed, used by tests. */
  feedUrl?: string;
  log?(line: string): void;
}

export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export function createUpdates(o: UpdatesOptions): Updates {
  const inPlace = o.packageKind === 'appimage' || o.packageKind === 'nsis';
  const dev = o.packageKind === 'dev';
  const u = o.updater;
  let current: UpdateState = { state: 'idle' };
  let timer: ReturnType<typeof setInterval> | null = null;
  let running: Promise<void> | null = null;
  const listeners: Array<[string, (...a: any[]) => void]> = []; // eslint-disable-line @typescript-eslint/no-explicit-any

  const set = (s: UpdateState): void => {
    current = s;
    try {
      o.onState({ ...s });
    } catch {
      /* a broken listener must not stop updates */
    }
  };
  const fail = (e: unknown): void => {
    if (current.state === 'ready') return; // a downloaded update stays offered
    o.log?.(`update check failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    set({ state: 'error' });
  };
  const on = (event: string, fn: (...a: any[]) => void): void => { // eslint-disable-line @typescript-eslint/no-explicit-any
    listeners.push([event, fn]);
    u.on(event, fn);
  };

  if (!dev) {
    u.autoDownload = inPlace;
    u.autoInstallOnAppQuit = inPlace;
    if (o.feedUrl) u.setFeedURL({ provider: 'generic', url: o.feedUrl });
    on('update-available', (info?: { version?: string }) => {
      const version = info?.version;
      set(inPlace ? { state: 'downloading', version } : { state: 'manual', version, url: o.downloadUrl });
    });
    on('update-not-available', () => set({ state: 'idle' }));
    on('update-downloaded', (info?: { version?: string }) => set({ state: 'ready', version: info?.version ?? current.version }));
    on('error', fail);
  }

  async function check(): Promise<void> {
    if (dev) return;
    if (current.state === 'ready' || current.state === 'downloading') return;
    if (running) return running;
    running = (async () => {
      set({ state: 'checking' });
      try {
        await u.checkForUpdates();
        if (current.state === 'checking') set({ state: 'idle' });
      } catch (e) {
        fail(e);
      } finally {
        running = null;
      }
    })();
    return running;
  }

  return {
    start() {
      if (dev || timer) return;
      timer = setInterval(() => void check(), CHECK_EVERY_MS);
      timer.unref?.();
      void check();
    },
    check,
    restart() {
      if (current.state !== 'ready') return;
      try {
        u.quitAndInstall();
      } catch (e) {
        o.log?.(`restart to update failed: ${e instanceof Error ? e.message : 'unknown error'}`);
      }
    },
    state: () => ({ ...current }),
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      for (const [event, fn] of listeners.splice(0)) u.removeListener?.(event, fn);
    },
  };
}
