import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { dispatch, resetBusState, resetHistory } from '@/commands';
import { createDocumentStore, createMemoryBackend } from '@/store';
import { getDocumentStore, setDocumentStore } from '@/state/runtime';
import { TrainingSetupProvider, createStoreTrainingSetup, useTrainingSetup } from '../setup';

beforeEach(async () => {
  setDocumentStore(createDocumentStore({ backend: createMemoryBackend({ device: 'TESTDEVICE000001' }), device: 'TESTDEVICE000001' }));
  resetHistory();
  resetBusState();
  await getDocumentStore().ready;
});

describe('store-backed training setup', () => {
  it('serves the person’s own equipment once it is added', async () => {
    const src = createStoreTrainingSetup();
    const { result } = renderHook(() => useTrainingSetup(), { wrapper: ({ children }) => <TrainingSetupProvider value={src}>{children}</TrainingSetupProvider> });
    await waitFor(() => expect(result.current.catalogue.equipment.length).toBeGreaterThan(0));
    const before = result.current.catalogue.equipment.length;
    const r = await dispatch('catalogue.addEquipment', { equipment: { name: 'Sandbag ZZ' } });
    expect(r.ok).toBe(true);
    await waitFor(() => expect(result.current.catalogue.equipment.some((e) => e.name === 'Sandbag ZZ')).toBe(true));
    expect(result.current.catalogue.equipment.length).toBeGreaterThanOrEqual(before);
  });
});
