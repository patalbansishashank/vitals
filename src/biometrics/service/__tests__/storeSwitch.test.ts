/**
 * Pairing or joining sync replaces the app's document store mid-session (`installPersistenceBackend`). The ring
 * service's ports must follow it: sources and the lease are read from, and written to, the store the ingest uses.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { freshState } from '@/commands/__tests__/harness';
import { getDocumentStore, installPersistenceBackend, setDocumentStore } from '@/state/runtime';
import { createMemoryBackend } from '@/store';
import { appLocalPort, appStorePort } from '../app';

const KEY = 'ble:jstyle2301/2301/serial:SWITCH1';
const SRC = { driverId: 'jstyle2301', label: 'J-Style 2301', streams: ['hr' as const], channel: KEY, maker: 'J-Style', model: '2301' };

afterEach(() => setDocumentStore(null));

describe('the app ports follow a document store switch', () => {
  it('reads the new store, tells the service to look again, and writes there', async () => {
    freshState();
    const port = appStorePort();
    const local = appLocalPort();
    await port.ready();
    let changes = 0;
    const off = port.subscribe(() => changes++);
    await port.ensureSource(KEY, SRC);
    expect(port.source(KEY)?.label).toBe('J-Style 2301');
    const first = getDocumentStore();

    await installPersistenceBackend(createMemoryBackend({ device: 'TESTDEVICE000001' }), { copy: false });
    expect(getDocumentStore()).not.toBe(first);
    await port.ready();
    await new Promise((r) => setTimeout(r, 0));
    const seen = changes;
    expect(seen).toBeGreaterThan(0);
    // the new store has not seen the ring yet
    expect(port.source(KEY)).toBeUndefined();

    await port.ensureSource(KEY, SRC);
    await port.patchLease(KEY, { heartbeatAt: '2026-10-04T08:00:00.000Z' });
    expect(port.source(KEY)).toBeDefined();
    expect(port.lease(KEY)?.heartbeatAt).toBe('2026-10-04T08:00:00.000Z');
    expect(changes).toBeGreaterThan(seen);
    await local.set(KEY, { cursor: { hr: 'j1|x' } });
    expect((await local.get(KEY))?.cursor).toEqual({ hr: 'j1|x' });
    expect(getDocumentStore().peek('deviceSettings', `ringCursor:${KEY}`)).toBeDefined();
    off();
  });
});

describe('the master switch is remembered for rings added later (J7-01, through the service port)', () => {
  it('with ring data off, a newly added ring starts with everything off', async () => {
    freshState();
    const { dispatch, settleCommits } = await import('@/commands');
    const { ringSharing } = await import('@/biometrics/core/policy');
    const r = await dispatch('bio.setRingSharing', { on: false });
    expect(r.ok).toBe(true);
    await settleCommits();
    const port = appStorePort();
    await port.ready();
    await port.ensureSource(KEY, SRC);
    expect(ringSharing([port.source(KEY)!])).toBe('off');
  });
});
