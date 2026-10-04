/**
 * Electron transport (the desktop app): Chromium's Web Bluetooth in the page, with the device list answered through
 * the desktop bridge (`apps/desktop/src/ble/`) because Electron has no chooser window. The bridge shape is declared
 * here structurally (the page does not import desktop code).
 */
import { requestDevice, webBluetoothAvailability } from '../webBluetooth';
import { isChooserCancel } from './web';
import { NoDeviceError, queryOf, type BleTransport, type DeviceQuery, type FoundDevice, type RequestOptions, type RingLink } from './types';

export interface DesktopBluetoothBridge {
  onDevices(cb: (list: FoundDevice[]) => void): () => void;
  choose(id: string | null): void;
  /** Gives the page a click's worth of activation; Chromium refuses `requestDevice` without one (R21a). */
  activate?(): Promise<void>;
}

/** The desktop preload's `window.vitalsDesktop.bluetooth`, when running in the desktop app. */
export function desktopBridge(): DesktopBluetoothBridge | undefined {
  return (globalThis as { vitalsDesktop?: { bluetooth?: DesktopBluetoothBridge } }).vitalsDesktop?.bluetooth;
}

export function createElectronTransport(bridge: () => DesktopBluetoothBridge | undefined = desktopBridge): BleTransport {
  /** Chromium holds one request per page and the bridge one answer slot, so requests run one after another. */
  let queue: Promise<unknown> = Promise.resolve();
  /** Requests given up before Chromium listed anything; Chromium's late first list is theirs (answered with a cancel). */
  let abandoned = 0;

  /** Opens Chromium's request and answers the bridge's lists: the wanted id, the chooser's pick, or the first ring. */
  async function request(query: DeviceQuery, opts: RequestOptions, wanted?: string): Promise<RingLink> {
    const b = bridge();
    if (!b || !(await webBluetoothAvailability())) throw new NoDeviceError('unavailable');
    if (opts.signal?.aborted) throw new NoDeviceError('cancelled');
    let seen = 0;
    let listed = false;
    let answered = false;
    let opened = false;
    let waitingLate = false;
    let giveUp: ((e: Error) => void) | undefined;
    let deferred: { id: string | null } | undefined;
    let chosenId: string | null = null;
    const chooser = wanted ? undefined : opts.chooser;
    const reason = (): 'cancelled' | 'not_found' => (opts.signal?.aborted || (chooser && seen > 0) ? 'cancelled' : 'not_found');
    const send = (id: string | null): void => {
      chosenId = id;
      b.choose(id);
    };
    const stopWaiting = (): void => {
      if (!waitingLate) return;
      waitingLate = false;
      off();
      abandoned--;
    };
    const answer = (id: string | null): void => {
      if (answered) return;
      answered = true;
      if (listed) send(id);
      // Electron raises no list until a device is found, so a cancel cannot reach Chromium yet: give up now, answer
      // the late first list with a cancel, and let the next request run
      else if (id === null && opened) {
        waitingLate = true;
        abandoned++;
        giveUp?.(new NoDeviceError(reason()));
      } else deferred = { id };
    };
    const off = b.onDevices((list) => {
      if (waitingLate) {
        send(null);
        // after every listener has seen this list, so a later request does not take it for its own
        queueMicrotask(stopWaiting);
        return;
      }
      seen = list.length;
      if (!listed) {
        // still an abandoned request's list
        if (abandoned > 0) return;
        listed = true;
        if (deferred) return send(deferred.id);
      }
      if (wanted) {
        if (list.some((d) => d.id === wanted)) answer(wanted);
      } else if (chooser) chooser.update(list);
      else if (list[0]) answer(list[0].id);
    });
    void chooser?.chosen.then(answer, () => answer(null));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = (): void => answer(null);
    try {
      // a reconnect at start has no click behind it, and a slow first request may have outlived the click's few seconds
      await b.activate?.();
      // stopped (or the list closed) while waiting: open no request at all
      if (opts.signal?.aborted || answered) throw new NoDeviceError('cancelled');
      timer = setTimeout(() => answer(null), opts.scanMs ?? 20_000);
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      opened = true;
      // Chromium filters the list by the query, so every device the bridge reports already matches the driver
      const pending = requestDevice({ requestOptions: queryOf(query) });
      // Chromium ending the abandoned request on its own (or for the next one) leaves no late list to answer
      pending.then(stopWaiting, stopWaiting);
      const link = await Promise.race([pending, new Promise<never>((_, reject) => (giveUp = reject))]);
      // the bridge's id (the Bluetooth address on Linux and Windows) is stable; the page's `device.id` is per origin
      if (chosenId) link.platformId = chosenId;
      return link;
    } catch (e) {
      if (isChooserCancel(e)) throw new NoDeviceError(reason());
      throw e;
    } finally {
      answered = true;
      if (!waitingLate) off();
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }

  const serial = (f: () => Promise<RingLink>): Promise<RingLink> => {
    const job = queue.then(f, f);
    queue = job.catch(() => {});
    return job;
  };

  return {
    kind: 'electron',
    isAvailable: async () => bridge() !== undefined && webBluetoothAvailability(),
    requestDevice: (query, opts = {}) => serial(() => request(query, opts)),
    reconnect: (deviceId, query, opts = {}) => serial(() => request(query, { ...opts, scanMs: 15_000 }, deviceId)),
  };
}

export const electronTransport: BleTransport = createElectronTransport();
