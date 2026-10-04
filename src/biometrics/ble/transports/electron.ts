/**
 * Electron transport (the desktop app): Chromium's Web Bluetooth in the page, with the device list answered through
 * the desktop bridge (`apps/desktop/src/ble/`) because Electron has no chooser window. The bridge shape is declared
 * here structurally (the page does not import desktop code).
 */
import { requestDevice, webBluetoothAvailability, type WebBluetoothLink } from '../webBluetooth';
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

/** How long a reconnect waits on the kept device's `gatt.connect()` before it looks for the ring with a new request. */
export const REOPEN_MS = 10_000;

/** A Bluetooth address in one form (case, dashes), so an id kept by another layer still matches the bridge's. */
const addressKey = (id: string): string | undefined => {
  const m = id.trim().toUpperCase().replace(/-/g, ':');
  return /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(m) ? m : undefined;
};
const sameId = (a: string, b: string): boolean => a === b || (addressKey(a) !== undefined && addressKey(a) === addressKey(b));
const keyOf = (id: string): string => addressKey(id) ?? id;

export function createElectronTransport(bridge: () => DesktopBluetoothBridge | undefined = desktopBridge): BleTransport {
  /** Chromium holds one request per page and the bridge one answer slot, so requests run one after another. */
  let queue: Promise<unknown> = Promise.resolve();
  /** Requests given up before Chromium listed anything; Chromium's late first list is theirs (answered with a cancel). */
  let abandoned = 0;
  /** Their listeners, let go when the next request opens: Chromium ends an open request when a new one starts. */
  const late = new Set<() => void>();
  /**
   * The links this page was given, by the bridge's id. A reconnect first tries `gatt.connect()` on the kept device:
   * after a Disconnect or a drop the ring may not be listed by a new request for a long while (BlueZ still holds the
   * link, or sees no change in a ring it already knows), but connecting to a device the page already has needs no list.
   */
  const known = new Map<string, WebBluetoothLink>();

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
    let gaveUp = false;
    let giveUp: ((e: Error) => void) | undefined;
    let deferred: { id: string | null } | undefined;
    let sent: { id: string | null } | undefined;
    let chosenId: string | null = null;
    const chooser = wanted ? undefined : opts.chooser;
    const reason = (): 'cancelled' | 'not_found' => (opts.signal?.aborted || (chooser && seen > 0) ? 'cancelled' : 'not_found');
    const send = (id: string | null): void => {
      chosenId = id;
      sent = { id };
      b.choose(id);
    };
    const stopWaiting = (): void => {
      if (!waitingLate) return;
      waitingLate = false;
      late.delete(stopWaiting);
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
        late.add(stopWaiting);
        gaveUp = true;
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
      // another list after the answer: the answer went to a list Chromium had already replaced (a late one), so this
      // request is still open; answer it again
      if (sent) return send(sent.id);
      seen = list.length;
      if (!listed) {
        // still an abandoned request's list
        if (abandoned > 0) return;
        listed = true;
        if (deferred) return send(deferred.id);
      }
      if (wanted) {
        // answered with the bridge's own form of the id
        const hit = list.find((d) => sameId(d.id, wanted));
        if (hit) answer(hit.id);
      } else if (chooser) chooser.update(list);
      else if (list[0]) answer(list[0].id);
    });
    void chooser?.chosen.then(answer, () => answer(null));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = (): void => (sent ? giveUpSent() : answer(null));
    // answered, yet Chromium never resolved: the list was a stale one (its callback dead) and no list of this request's
    // own came. Nothing but the next request can end it; give up so the queue moves on, and let its link go if one lands
    const giveUpSent = (): void => {
      gaveUp = true;
      giveUp?.(new NoDeviceError(reason()));
    };
    try {
      // a reconnect at start has no click behind it, and a slow first request may have outlived the click's few seconds
      await b.activate?.();
      // stopped (or the list closed) while waiting: open no request at all
      if (opts.signal?.aborted || answered) throw new NoDeviceError('cancelled');
      timer = setTimeout(() => (sent ? giveUpSent() : answer(null)), opts.scanMs ?? 20_000);
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      opened = true;
      // Chromium ends the requests given up before (their late lists cannot come any more): every list is this one's
      for (const stop of [...late]) stop();
      // Chromium filters the list by the query, so every device the bridge reports already matches the driver
      const pending = requestDevice({ requestOptions: queryOf(query) });
      // Chromium ending the abandoned request on its own (or for the next one) leaves no late list to answer. A late list
      // taken for the next request's may still have answered this one with a ring: nobody owns that link, let it go
      pending.then((link) => {
        if (gaveUp) void link.disconnect().catch(() => {});
        stopWaiting();
      }, stopWaiting);
      const link = await Promise.race([pending, new Promise<never>((_, reject) => (giveUp = reject))]);
      // the bridge's id (the Bluetooth address on Linux and Windows) is stable; the page's `device.id` is per origin
      if (chosenId) {
        link.platformId = chosenId;
        known.set(keyOf(chosenId), link);
      }
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
    reconnect: (deviceId, query, opts = {}) =>
      serial(async () => {
        const kept = known.get(keyOf(deviceId));
        if (kept && bridge() && (await webBluetoothAvailability())) {
          if (opts.signal?.aborted) throw new NoDeviceError('cancelled');
          try {
            const link = await kept.reopen(REOPEN_MS, opts.signal);
            link.platformId = kept.platformId ?? deviceId;
            known.set(keyOf(deviceId), link);
            return link;
          } catch {
            if (opts.signal?.aborted) throw new NoDeviceError('cancelled');
            // out of reach for now, or the platform forgot the device: look for it with a new request
          }
        }
        return request(query, { ...opts, scanMs: 15_000 }, deviceId);
      }),
  };
}

export const electronTransport: BleTransport = createElectronTransport();
