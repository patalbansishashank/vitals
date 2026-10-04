/**
 * Web Bluetooth transport (browsers): the browser shows its own chooser, so a `chooser` option is ignored. No
 * reconnect: `getDevices()` is still behind a flag in Chrome (R21), so every session starts from a click.
 */
import { requestDevice, webBluetoothAvailability } from '../webBluetooth';
import { NoDeviceError, queryOf, type BleTransport, type DeviceQuery, type RingLink } from './types';

/** The chooser closed without a choice: Chrome rejects with a NotFoundError. */
export const isChooserCancel = (e: unknown): boolean => (e as { name?: string } | null)?.name === 'NotFoundError';

export const webTransport: BleTransport = {
  kind: 'web',
  isAvailable: webBluetoothAvailability,
  async requestDevice(query: DeviceQuery): Promise<RingLink> {
    // checked before the chooser opens, so a switched-off adapter reads as "Bluetooth is off", not as a failure
    if (!(await webBluetoothAvailability())) throw new NoDeviceError('unavailable');
    try {
      return await requestDevice({ requestOptions: queryOf(query) });
    } catch (e) {
      if (isChooserCancel(e)) throw new NoDeviceError('cancelled');
      throw e;
    }
  },
};
