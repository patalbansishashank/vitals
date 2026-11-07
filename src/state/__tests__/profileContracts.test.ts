/**
 * 2026-10-18 contracts through the real store path: `profile.patch` keeps measurement provenance and habit context end
 * to end (projection and `profile/me` document), null clears a field, an invalid value is refused by the schema; exports
 * carry the contract stamp and imports report whether derived artifacts are stale (C7, D1-03, D3-05, D3-07). The
 * sanitizers keep valid provenance and habit context, drop invalid values (never inventing them), and read legacy data
 * unchanged and idempotently across reload, import and sync.
 */
import { describe, expect, it, vi } from 'vitest';
import { CONTRACT_FINGERPRINT, CONTRACT_VERSIONS } from '@/lib/bodyContracts';
import { DEFAULT_BODY, migrateBody, pickBodyValues, pickHabits } from '@/state/internal/profileModel';

async function boot() {
  vi.resetModules();
  const store = await import('@/store');
  const runtime = await import('@/state/runtime');
  const be = store.createMemoryBackend({ device: 'TESTDEVICE000001' });
  runtime.setDocumentStore(store.createDocumentStore({ backend: be, device: 'TESTDEVICE000001' }));
  await runtime.bootDocuments();
  const docs = runtime.getDocumentStore();
  const { useProfileStore } = await import('@/state/profileStore');
  return { runtime, docs, useProfileStore };
}

describe('profile model adapters (D1-03, D3-05, D3-07)', () => {
  const withMeta = {
    ...DEFAULT_BODY,
    sex: 'female',
    ageYears: 41,
    heightCm: 168,
    weightKg: 71.5,
    waist: { use: true, cm: 84, neckCm: 33, hipCm: 101, observationId: 'girth-1', measuredOn: '2026-10-02', landmark: 'iliacCrest', protocol: 'NHANES' },
    knownBodyFat: { use: true, pct: 24, source: 'dxa', observationId: 'dxa-1', measuredOn: '2026-10-01T08:30:00+05:30', device: 'Hologic Horizon', parentIds: ['scan-raw-1'], scanMassKg: 71.2, scanFatMassKg: 17.1 },
    habits: { typicalSteps: 7200, stepsScope: 'totalDay', trainingGrowthState: 'plateaued', trainingGrowthStateSource: 'user' },
  };

  it('keeps valid provenance on waist and known body fat, and the habit context fields', () => {
    const v = pickBodyValues(withMeta);
    expect(v.waist).toEqual(withMeta.waist);
    expect(v.knownBodyFat).toEqual(withMeta.knownBodyFat);
    expect(v.habits).toMatchObject({ stepsScope: 'totalDay', trainingGrowthState: 'plateaued', trainingGrowthStateSource: 'user' });
  });

  it('drops invalid provenance instead of inventing or coercing it', () => {
    const v = pickBodyValues({
      ...withMeta,
      waist: { ...withMeta.waist, landmark: 'kneecap', measuredOn: 'yesterday', observationId: '' },
      knownBodyFat: { ...withMeta.knownBodyFat, scanMassKg: 9000, scanFatMassKg: -2, parentIds: [3, 'ok'], device: 'x'.repeat(65) },
      habits: { stepsScope: 'some', trainingGrowthState: 'gaining' },
    });
    expect(v.waist).toEqual({ use: true, cm: 84, neckCm: 33, hipCm: 101, protocol: 'NHANES' });
    expect(v.knownBodyFat).toEqual({ use: true, pct: 24, source: 'dxa', observationId: 'dxa-1', measuredOn: '2026-10-01T08:30:00+05:30', parentIds: ['ok'] });
    expect(v.habits).toEqual({});
    // a scan fat mass larger than the scan mass is rejected
    expect(pickBodyValues({ ...withMeta, knownBodyFat: { ...withMeta.knownBodyFat, scanMassKg: 60, scanFatMassKg: 61 } }).knownBodyFat.scanFatMassKg).toBeUndefined();
  });

  it('legacy data without provenance reads unchanged; the adapters are idempotent across reload, import and sync', () => {
    const legacy = { ...DEFAULT_BODY, waist: { use: true, cm: 84, neckCm: null, hipCm: 101 }, knownBodyFat: { use: false, pct: null, source: 'dxa' }, habits: { typicalSteps: 7200 } };
    const once = pickBodyValues(legacy);
    expect(once.waist).toEqual(legacy.waist);
    expect(once.knownBodyFat).toEqual(legacy.knownBodyFat);
    expect(once.habits).not.toHaveProperty('stepsScope');
    expect(once.habits).not.toHaveProperty('trainingGrowthState');
    const meta = pickBodyValues(withMeta);
    expect(pickBodyValues(meta)).toEqual(meta);
    expect(migrateBody(meta, 2)).toEqual(meta);
    expect(migrateBody(JSON.parse(JSON.stringify(meta)), 1)).toEqual(meta);
    expect(pickHabits(pickHabits(withMeta.habits))).toEqual(pickHabits(withMeta.habits));
  });
});

describe('profile.patch with measurement provenance', { timeout: 30_000 }, () => {
  it('keeps, clears and refuses provenance fields as one change per patch', async () => {
    const { docs, useProfileStore } = await boot();
    const { dispatch, settleCommits } = await import('@/commands');
    let r = await dispatch('profile.patch', {
      sex: 'male',
      ageYears: 40,
      heightCm: 180,
      weightKg: 82,
      knownBodyFat: { use: true, pct: 21.5, source: 'dxa', observationId: 'dxa-1', measuredOn: '2026-10-01', device: 'Hologic', scanMassKg: 81.6, scanFatMassKg: 17.5 },
      waist: { use: true, cm: 88, landmark: 'iliacCrest', measuredOn: '2026-10-02', observationId: 'girth-1' },
      habits: { stepsScope: 'totalDay', trainingGrowthState: 'plateaued' },
    });
    expect(r.ok).toBe(true);
    await settleCommits();
    const s = useProfileStore.getState();
    expect(s.knownBodyFat).toEqual({ use: true, pct: 21.5, source: 'dxa', observationId: 'dxa-1', measuredOn: '2026-10-01', device: 'Hologic', scanMassKg: 81.6, scanFatMassKg: 17.5 });
    expect(s.waist).toMatchObject({ use: true, cm: 88, landmark: 'iliacCrest', measuredOn: '2026-10-02', observationId: 'girth-1' });
    expect(s.habits).toMatchObject({ stepsScope: 'totalDay', trainingGrowthState: 'plateaued' });
    const doc = docs.peek('profile', 'me') as Record<string, unknown> | null;
    expect(doc).toMatchObject({ knownBodyFat: { observationId: 'dxa-1', scanMassKg: 81.6 }, waist: { landmark: 'iliacCrest' }, habits: { stepsScope: 'totalDay' } });

    // null clears one field and keeps the rest
    r = await dispatch('profile.patch', { knownBodyFat: { measuredOn: null }, habits: { trainingGrowthState: null } });
    expect(r.ok).toBe(true);
    expect(useProfileStore.getState().knownBodyFat).toEqual({ use: true, pct: 21.5, source: 'dxa', observationId: 'dxa-1', device: 'Hologic', scanMassKg: 81.6, scanFatMassKg: 17.5 });
    expect(useProfileStore.getState().habits).not.toHaveProperty('trainingGrowthState');
    expect(useProfileStore.getState().habits).toMatchObject({ stepsScope: 'totalDay' });

    // an invalid landmark is refused before anything changes
    const before = useProfileStore.getState().revision;
    r = await dispatch('profile.patch', { waist: { landmark: 'kneecap' } } as never);
    expect(r.ok).toBe(false);
    expect(useProfileStore.getState().revision).toBe(before);
  });
});

describe('export/import contract stamp (C7)', { timeout: 30_000 }, () => {
  it('exports carry the contract versions; files without them (or from other versions) mark derived artifacts stale', async () => {
    await boot();
    const p = await import('@/state/persistence');
    const ex = p.exportAll(new Date('2026-10-18T10:00:00Z'));
    expect(ex.contracts).toEqual({ fingerprint: CONTRACT_FINGERPRINT, versions: { ...CONTRACT_VERSIONS } });
    const current = p.parseImport(p.serializeExport({ ...ex, stores: { 'vitals.notes': { version: null, state: ['x'] } } }));
    expect(current.ok && current.derivedStale).toBe(false);
    if (current.ok) expect(current.data.contracts?.fingerprint).toBe(CONTRACT_FINGERPRINT);
    const legacy = p.parseImport(JSON.stringify({ vitalsVersion: '2', app: 'vitals', stores: { 'vitals.notes': { version: null, state: ['x'] } } }));
    expect(legacy.ok && legacy.derivedStale).toBe(true);
    const other = p.parseImport(JSON.stringify({ vitalsVersion: '2', app: 'vitals', stores: { 'vitals.notes': { version: null, state: ['x'] } }, contracts: { fingerprint: 'older', versions: { observation: 0, bogus: 'x' } } }));
    expect(other.ok && other.derivedStale).toBe(true);
    if (other.ok) expect(other.data.contracts).toEqual({ fingerprint: 'older', versions: { observation: 0 } });
  });
});
