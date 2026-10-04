import { describe, expect, it } from 'vitest';
import { createRingService } from '../ringService';
import { devicePorts, FakeClock, FakeRing, SharedStore } from './fakes';

const R02_KEY = 'ble:colmi/R02/serial:C-RINGX-R02';
const R06_KEY = 'ble:colmi/R06/serial:C-RINGX-R06';

function setup(model: string | undefined, ringId = '', platformId = 'C-RINGX-web') {
  const store = new SharedStore();
  const clock = new FakeClock();
  const ring = new FakeRing({ driverId: 'colmi', ringId, history: [], platformIds: [platformId] });
  const ports = devicePorts({ store, clock, rings: [ring], deviceId: 'C-RINGX-DEVICE', label: 'Test device', canReconnect: false });
  ports.connector.adopt = async () => {
    const session = ring.open(platformId, clock);
    session.identity.model = model ?? '';
    return session;
  };
  return { store, ring, service: createRingService(ports) };
}

describe('C-RINGX model-aware ring aliases', () => {
  it('refuses an unidentified R06 when the stored ring is R02', async () => {
    const { store, ring, service } = setup('R06');
    store.addRingSource(R02_KEY, 'colmi');
    await service.start();
    await expect(service.syncLink({} as never, 'colmi')).rejects.toThrow(/cannot tell which ring/);
    expect([...store.sources.keys()]).toEqual([R02_KEY]);
    expect(ring.held).toBeNull();
  });

  it.each([false, true])('aliases the sole matching model (another model stored=%s)', async (anotherModel) => {
    const { store, service } = setup('R02');
    store.addRingSource(R02_KEY, 'colmi');
    if (anotherModel) store.addRingSource(R06_KEY, 'colmi');
    await service.start();
    expect((await service.syncLink({} as never, 'colmi')).sourceKey).toBe(R02_KEY);
    expect(store.sources.size).toBe(anotherModel ? 2 : 1);
    await service.stop();
  });

  it.each(['serial', 'address'])('keeps an exact %s match despite a different model', async (basis) => {
    const address = '00:00:00:00:00:01';
    const { store, service } = setup('R06', basis === 'serial' ? 'serial:C-RINGX-R02' : '', basis === 'address' ? address : undefined);
    store.addRingSource(R02_KEY, 'colmi', { ble: { driver: 'colmi', ringId: 'serial:C-RINGX-R02', address } });
    await service.start();
    expect((await service.syncLink({} as never, 'colmi')).sourceKey).toBe(R02_KEY);
    expect(store.sources.size).toBe(1);
    await service.stop();
  });

  it('asks for a choice when a legacy source has no canonical model', async () => {
    const { store, ring, service } = setup('R02');
    store.addRingSource('ble:colmi|synthetic', 'colmi');
    await service.start();
    await expect(service.syncLink({} as never, 'colmi')).rejects.toThrow(/Which ring/);
    expect(store.sources.size).toBe(1);
    expect(ring.held).toBeNull();
  });

  it('asks for a choice when the unidentified reader has no model', async () => {
    const { store, ring, service } = setup(undefined);
    store.addRingSource(R02_KEY, 'colmi');
    await service.start();
    await expect(service.syncLink({} as never, 'colmi')).rejects.toThrow(/Which ring/);
    expect(store.sources.size).toBe(1);
    expect(ring.held).toBeNull();
  });
});
