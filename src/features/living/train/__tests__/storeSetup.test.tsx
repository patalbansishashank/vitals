import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { dispatch, resetBusState, resetHistory } from '@/commands';
import { createDocumentStore, createMemoryBackend } from '@/store';
import { getDocumentStore, setDocumentStore } from '@/state/runtime';
import { TrainingSetupProvider, createStoreTrainingSetup, useTrainingSetup } from '../setup';
import { STUB_STIMULUS_CONTEXT } from '../../data/fixtures';
import { bodyBasisNow, loadCatalogueModules, trainingSetupNow } from '@/commands/catalogue/setup';
import { useProfileStore } from '@/state/profileStore';
import { withSystemWrite } from '@/state/scope';

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
    // (0.6.3 A33) while the person's setup loads there is no body context: never the fixture's 83.4 kg
    expect(result.current).toMatchObject({ status: 'loading', ctx: null, profile: null });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.ctx?.bodyMassKg).not.toBe(STUB_STIMULUS_CONTEXT.bodyMassKg);
    await waitFor(() => expect(result.current.catalogue.equipment.length).toBeGreaterThan(0));
    const before = result.current.catalogue.equipment.length;
    const r = await dispatch('catalogue.addEquipment', { equipment: { name: 'Sandbag ZZ' } });
    expect(r.ok).toBe(true);
    await waitFor(() => expect(result.current.catalogue.equipment.some((e) => e.name === 'Sandbag ZZ')).toBe(true));
    expect(result.current.catalogue.equipment.length).toBeGreaterThanOrEqual(before);
  });

  // (0.6.3 INT, S2) the composing body context may hold typical values (the engine profile fills what nobody entered); they
  // never pass for the person's: the typical mass is flagged, and there is no resting metabolism without age and height
  it('flags a typical body and keeps a typical resting metabolism out of the context', async () => {
    withSystemWrite(() => useProfileStore.setState({ weightKg: null, ageYears: null, heightCm: null }));
    const m = await loadCatalogueModules();
    const none = trainingSetupNow(m);
    expect(none.typicalBody).toBe(true);
    expect(none.ctx.rmrKcalPerDay).toBeUndefined();
    expect(bodyBasisNow()).toEqual({ massTypical: true, rmrTypical: true });
    // a weight, no age or height: the mass is theirs, the resting metabolism still is not
    withSystemWrite(() => useProfileStore.setState({ weightKg: 92 }));
    const weight = trainingSetupNow(m);
    expect(weight.typicalBody).toBe(false);
    expect(weight.ctx.bodyMassKg).toBe(92);
    expect(weight.ctx.rmrKcalPerDay).toBeUndefined();
    withSystemWrite(() => useProfileStore.setState({ ageYears: 38, heightCm: 180 }));
    const all = trainingSetupNow(m);
    expect(all.typicalBody).toBe(false);
    expect(all.ctx.rmrKcalPerDay).toBeGreaterThan(1000);
    // the store-backed source hands the flag to Train
    withSystemWrite(() => useProfileStore.setState({ weightKg: null, ageYears: null, heightCm: null }));
    const src = createStoreTrainingSetup();
    const { result } = renderHook(() => useTrainingSetup(), { wrapper: ({ children }) => <TrainingSetupProvider value={src}>{children}</TrainingSetupProvider> });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.typicalBody).toBe(true);
  });
});
