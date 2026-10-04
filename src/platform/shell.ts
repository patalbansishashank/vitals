import { androidShell } from './androidShell';
import { detectPlatform } from './detect';

/*
 * What the ring service asks of the shell around it. On the website and the PWA every call is a no-op or a browser
 * event; the desktop and Android shells replace this with their own bridge.
 */

export interface ShellBridge {
  /** Android: foreground service. Desktop: tray status. Web: nothing. */
  keepAlive(on: boolean, text: string): Promise<void>;
  notify(n: { kind: 'battery_low' | 'ring_disconnected'; title: string; text: string }): Promise<void>;
  onBluetoothState(cb: (on: boolean) => void): () => void;
  onResume(cb: () => void): () => void;
}

interface BluetoothEvents {
  addEventListener(type: 'availabilitychanged', cb: (e: Event & { value?: boolean }) => void): void;
  removeEventListener(type: 'availabilitychanged', cb: (e: Event & { value?: boolean }) => void): void;
}

const none = (): (() => void) => () => undefined;

export const webShell: ShellBridge = {
  keepAlive: () => Promise.resolve(),
  notify: () => Promise.resolve(),
  onBluetoothState(cb) {
    const bt = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { bluetooth?: BluetoothEvents }).bluetooth;
    if (!bt?.addEventListener) return none();
    const on = (e: Event & { value?: boolean }) => cb(e.value === true);
    bt.addEventListener('availabilitychanged', on);
    return () => bt.removeEventListener('availabilitychanged', on);
  },
  onResume(cb) {
    if (typeof document === 'undefined') return none();
    const on = () => {
      if (document.visibilityState === 'visible') cb();
    };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  },
};

export function shell(): ShellBridge {
  return detectPlatform() === 'android' ? androidShell() : webShell;
}
