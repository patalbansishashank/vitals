/**
 * "Add a ring" inside the Android app: the service's connector is `chooserFactory` over the Capacitor transport
 * (`appConnector`). The tapped ring is answered through the scan that is still open, so the Devices screen keeps the
 * scan open until `pair` has the ring (L-DESKTOP's "No ring chosen", the same on the desktop's chooser).
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { jstyle2301 } from '../../../../packages/rings/src/jstyle2301/family';
import { loadSessions } from '../../../../packages/rings/src/testing';
import type { Advertisement } from '../../../../packages/rings/src/types';
import { createCapacitorTransport } from '@/biometrics/ble/transports/capacitor';
import { chooserFactory } from '@/biometrics/ble/transports/rings';
import { FakeCapClient, ringFrom } from '@/biometrics/ble/transports/__tests__/peripheralFakes';

const REPO = join(__dirname, '../../../..');
const fixture = await loadSessions(REPO, 'jstyle2301');
const session = fixture.sessions.find((x) => x.name.startsWith('v0525 handshake and one HR page'))!;
const MAC = 'E2:80:00:00:00:01';

describe('the Android app chooser path', () => {
  it('a ring tapped while the scan is open is connected through that scan (one scan, one connect)', async () => {
    const client = new FakeCapClient(ringFrom(session), { deviceId: MAC });
    const factory = chooserFactory(createCapacitorTransport(async () => client), 'electron');
    const ctl = new AbortController();
    let first!: (ad: Advertisement) => void;
    const listed = new Promise<Advertisement>((r) => (first = r));
    const scanned = factory.scan([jstyle2301], (ad) => first(ad), ctl.signal);
    const ad = await listed;
    expect(ad.platformId).toBe(MAC);
    expect(ctl.signal.aborted).toBe(false);
    const transport = await factory.connect({ platformId: ad.platformId! }, jstyle2301);
    expect(transport).toBeDefined();
    await scanned;
    expect(client.scans).toBe(1);
    expect(client.connects).toEqual([MAC]);
    ctl.abort();
  });
});
