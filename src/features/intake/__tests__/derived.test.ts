/** Saved intake answers reach the catalogue ("something else" equipment) and the biometric policies (devices matrix). */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { dispatch as Dispatch } from '@/commands/bus';
import '@/commands';
import { resetBusState, resetHistory } from '@/commands';
import { createDocumentStore, createMemoryBackend } from '@/store';
import { getDocumentStore, setDocumentStore } from '@/state/runtime';
import { EMPTY_INTAKE } from '../types';

vi.mock('@/commands/bus', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown> & { dispatch: typeof Dispatch }>();
  return { ...orig, dispatch: vi.fn(orig.dispatch) };
});

import { dispatch } from '@/commands/bus';
import { applyDerived } from '../persist';

beforeEach(() => {
  setDocumentStore(createDocumentStore({ backend: createMemoryBackend({ device: 'TESTDEVICE000001' }), device: 'TESTDEVICE000001' }));
  resetHistory();
  resetBusState();
  vi.mocked(dispatch).mockClear();
});

const ids = () => vi.mocked(dispatch).mock.calls.map((c) => c[0]);

describe('intake hooks', () => {
  it('adds new "something else" equipment to the catalogue, once', async () => {
    const training = (names: string[]) => ({ training: { prefs: { customEquipment: names } } });
    await applyDerived('training', { ...EMPTY_INTAKE, ...training(['sandbag']) } as never, training(['sandbag', 'Gym Wheel']));
    const adds = vi.mocked(dispatch).mock.calls.filter((c) => c[0] === 'catalogue.addEquipment');
    expect(adds.map((c) => (c[1] as { equipment: { name: string } }).equipment.name)).toEqual(['Gym Wheel']);
    const docs = getDocumentStore().peekAll<{ kind: string }>('catalogueCustom');
    expect(docs.filter((d) => d.kind === 'equipment')).toHaveLength(1);
  });

  it('sets the biometric policy of changed device streams only', async () => {
    const row = (stream: string, imported: boolean) => ({ stream, imported, coach: 'hidden', engine: imported, scores: imported });
    await applyDerived('devices', { ...EMPTY_INTAKE, devices: { streams: [row('steps', true)] } } as never, { devices: { streams: [row('steps', true), row('hrv', true)] } });
    const calls = vi.mocked(dispatch).mock.calls.filter((c) => c[0] === 'bio.setPolicy').map((c) => (c[1] as { stream: string }).stream);
    expect(calls.sort()).toEqual(['hrv', 'ibi']);
    expect(ids().every((i) => i === 'bio.setPolicy')).toBe(true);
  });
});
