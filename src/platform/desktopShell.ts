/*
 * The desktop shell bridge (SUITE_SPEC §15.6, §15.8), owned by L-DESKTOP: the page side of the Electron app's preload
 * (`window.vitalsDesktop`, apps/desktop/src/shared/bridge.ts). keepAlive sets the tray's status line and keeps the app
 * running with its window hidden; notices are the system's own notifications; "resume" is the window being shown again
 * or becoming visible. Outside the desktop app every call resolves and does nothing.
 */

/** §15.8's `ShellBridge`, declared here with the same shape: `shell()` returns `desktopShell()` on the desktop app. */
export interface DesktopShellBridge {
  keepAlive(on: boolean, text: string): Promise<void>;
  notify(n: { kind: 'battery_low' | 'ring_disconnected'; title: string; text: string }): Promise<void>;
  onBluetoothState(cb: (on: boolean) => void): () => void;
  onResume(cb: () => void): () => void;
}

/** The part of the preload's `vitalsDesktop` this file uses. */
interface DesktopGlobal {
  keepAlive?(on: boolean, text: string): void;
  onShow?(cb: () => void): () => void;
  onSyncNow?(cb: () => void): () => void;
}

interface BluetoothEvents {
  getAvailability?(): Promise<boolean>;
  addEventListener?(type: 'availabilitychanged', cb: (e: Event & { value?: boolean }) => void): void;
  removeEventListener?(type: 'availabilitychanged', cb: (e: Event & { value?: boolean }) => void): void;
}

const none = (): (() => void) => () => undefined;

function desktop(): DesktopGlobal | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { vitalsDesktop?: DesktopGlobal }).vitalsDesktop;
}

/** One notice per kind at a time: a newer one replaces the older (`tag`). */
function showNotice(n: { kind: string; title: string; text: string }): void {
  if (typeof Notification === 'undefined') return;
  const show = () => void new Notification(n.title, { body: n.text, tag: `vitals-${n.kind}`, silent: n.kind === 'battery_low' });
  if (Notification.permission === 'granted') show();
  else if (Notification.permission === 'default') void Notification.requestPermission().then((p) => (p === 'granted' ? show() : undefined));
}

export const desktopShellBridge: DesktopShellBridge = {
  keepAlive(on, text) {
    desktop()?.keepAlive?.(on, text);
    return Promise.resolve();
  },
  notify(n) {
    try {
      showNotice(n);
    } catch {
      // a notice is a courtesy; the Ring page shows the same state
    }
    return Promise.resolve();
  },
  onBluetoothState(cb) {
    const bt = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { bluetooth?: BluetoothEvents }).bluetooth;
    if (!bt?.addEventListener || !bt.removeEventListener) return none();
    const on = (e: Event & { value?: boolean }) => cb(e.value === true);
    bt.addEventListener('availabilitychanged', on);
    return () => bt.removeEventListener?.('availabilitychanged', on);
  },
  onResume(cb) {
    const offShow = desktop()?.onShow?.(cb) ?? none();
    if (typeof document === 'undefined') return offShow;
    const onVisible = () => {
      if (document.visibilityState === 'visible') cb();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      offShow();
      document.removeEventListener('visibilitychange', onVisible);
    };
  },
};

export function desktopShell(): DesktopShellBridge {
  return desktopShellBridge;
}

/** The tray's "Sync now": the sync layer subscribes once at boot (a no-op outside the desktop app). */
export function onDesktopSyncNow(cb: () => void): () => void {
  return desktop()?.onSyncNow?.(cb) ?? none();
}
