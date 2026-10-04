/**
 * Frame (`profile.figure.frame`, body-figure-v2.md §5.4): the drawing-only figure setting that replaced the v1
 * "figure base" (female / neutral / male). Covers the sanitiser and the v1 → v2 migration of the boot cache, legacy
 * `profile/me` documents, `profile.patch`, and v1 / v2 imports.
 *
 * The document-store cases boot a fresh module graph (`vi.resetModules`) over seeded localStorage, the way the app
 * starts (same set-up as documents.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BODY_VERSION,
  DEFAULT_BODY,
  FRAME_RANGE,
  defaultFigureFrame,
  figureFrameOf,
  frameOfLegacyBase,
  migrateBody,
  migrateProfileDocBody,
  pickBodyValues,
} from '@/state/internal/profileModel';

const NOW = '2026-10-01T09:00:00.000Z';

/** A v1 body state (before Frame): `figureBase` instead of `figure`. */
const V1_BODY = {
  sex: 'female',
  figureBase: 'male',
  ageYears: 41,
  heightCm: 168,
  weightKg: 71.5,
  ethnicity: null,
  shape: { bodyFatPct: 31 },
  waist: { use: true, cm: 84, neckCm: null, hipCm: 101 },
  knownBodyFat: { use: false, pct: null, source: 'dxa' },
  training: { years: 2, quality: 'regular' },
  habits: { typicalSteps: 7200, sessionsPerWeek: 2 },
  cycle: { tracking: false },
  menopause: 'peri',
  labs: { ldlMmolL: 3.4 },
  setup: 'done',
  shapeSkipped: false,
  habitsSkipped: true,
  updatedAt: '2026-09-30T08:00:00.000Z',
  revision: 12,
};

async function boot(backend?: unknown) {
  vi.resetModules();
  const store = await import('@/store');
  const runtime = await import('@/state/runtime');
  const be = (backend as ReturnType<typeof store.createMemoryBackend>) ?? store.createMemoryBackend({ device: 'TESTDEVICE000001' });
  runtime.setDocumentStore(store.createDocumentStore({ backend: be, device: 'TESTDEVICE000001' }));
  const report = await runtime.bootDocuments();
  const docs = runtime.getDocumentStore();
  const { useProfileStore, flushBodyPersistence } = await import('@/state/profileStore');
  return { store, runtime, report, docs, backend: be, useProfileStore, flushBodyPersistence };
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Frame: defaults', () => {
  it('"Match my basics" follows the sex choice', () => {
    expect(FRAME_RANGE).toEqual([0, 1]);
    expect(defaultFigureFrame('female')).toBe(0);
    expect(defaultFigureFrame('male')).toBe(1);
    expect(defaultFigureFrame('unspecified')).toBe(0.5);
    expect(defaultFigureFrame(null)).toBe(0.5);
    expect(DEFAULT_BODY.figure).toEqual({ frame: null });
  });

  it('figureFrameOf: the stored frame wins, else the default for the sex', () => {
    expect(figureFrameOf({ sex: 'female', figure: { frame: null } })).toBe(0);
    expect(figureFrameOf({ sex: 'male', figure: { frame: null } })).toBe(1);
    expect(figureFrameOf({ sex: 'unspecified', figure: { frame: null } })).toBe(0.5);
    expect(figureFrameOf({ sex: null, figure: { frame: null } })).toBe(0.5);
    expect(figureFrameOf({ sex: 'male', figure: { frame: 0.25 } })).toBe(0.25);
    expect(figureFrameOf({ sex: 'female', figure: { frame: 0 } })).toBe(0);
    expect(figureFrameOf({ sex: 'female', figure: { frame: 7 } })).toBe(1);
    expect(figureFrameOf({ sex: 'male', figure: { frame: -1 } })).toBe(0);
  });
});

describe('Frame: sanitiser and v1 → v2 migration', () => {
  it('maps a v1 figure base onto the frame, keeping "match my basics" when it was the default', () => {
    expect(migrateBody({ ...V1_BODY, figureBase: 'male', sex: 'female' }, 1).figure).toEqual({ frame: 1 });
    expect(migrateBody({ ...V1_BODY, figureBase: 'female', sex: 'female' }, 1).figure).toEqual({ frame: null });
    expect(migrateBody({ ...V1_BODY, figureBase: 'neutral', sex: 'unspecified' }, 1).figure).toEqual({ frame: null });
    expect(migrateBody({ ...V1_BODY, figureBase: 'neutral', sex: null }, 1).figure).toEqual({ frame: null });
    expect(migrateBody({ ...V1_BODY, figureBase: 'neutral', sex: 'male' }, 1).figure).toEqual({ frame: 0.5 });
    expect(migrateBody({ ...V1_BODY, figureBase: 'female', sex: 'male' }, 1).figure).toEqual({ frame: 0 });
    expect(migrateBody({ ...V1_BODY, figureBase: null }, 1).figure).toEqual({ frame: null });
    const { figureBase: _base, ...noBase } = V1_BODY;
    expect(migrateBody(noBase, 1).figure).toEqual({ frame: null });
    expect(migrateBody({ ...V1_BODY, figureBase: 'robot' }, 1).figure).toEqual({ frame: null });
  });

  it('never carries figureBase forward', () => {
    expect(migrateBody(V1_BODY, 1)).not.toHaveProperty('figureBase');
    expect(pickBodyValues(V1_BODY)).not.toHaveProperty('figureBase');
    expect(Object.keys(migrateBody(V1_BODY, 0)).sort()).toEqual(Object.keys(DEFAULT_BODY).sort());
  });

  it('pickBodyValues maps old states (boot caches, documents) without `figure` the same way', () => {
    expect(pickBodyValues(V1_BODY).figure).toEqual({ frame: 1 });
    expect(pickBodyValues({ sex: 'male', figureBase: 'male' }).figure).toEqual({ frame: null });
    expect(pickBodyValues({}).figure).toEqual({ frame: null });
    // a `figure` object wins over a leftover figureBase
    expect(pickBodyValues({ ...V1_BODY, figure: { frame: 0.2 } }).figure).toEqual({ frame: 0.2 });
    expect(pickBodyValues({ ...V1_BODY, figure: { frame: null } }).figure).toEqual({ frame: null });
  });

  it('sanitises garbage frames', () => {
    const frameOf = (frame: unknown) => pickBodyValues({ sex: 'female', figure: { frame } }).figure.frame;
    expect(frameOf(Number.NaN)).toBeNull();
    expect(frameOf(Number.POSITIVE_INFINITY)).toBeNull();
    expect(frameOf('0.4')).toBeNull();
    expect(frameOf(undefined)).toBeNull();
    expect(frameOf(7)).toBe(1);
    expect(frameOf(-1)).toBe(0);
    expect(frameOf(0.123456)).toBe(0.123);
    expect(pickBodyValues({ figure: 'big' }).figure).toEqual({ frame: null });
    expect(pickBodyValues({ figure: [0.4] }).figure).toEqual({ frame: null });
  });

  it('frameOfLegacyBase and the document migration', () => {
    expect(frameOfLegacyBase('male', 'female')).toBe(1);
    expect(frameOfLegacyBase('male', 'male')).toBeNull();
    expect(frameOfLegacyBase('neutral', 'robot')).toBeNull();
    expect(frameOfLegacyBase(undefined, 'female')).toBeNull();
    const doc = { sex: 'female', figureBase: 'neutral', weightKg: 70, shape: { belly: 0.2 }, revision: 3 };
    expect(migrateProfileDocBody(doc)).toEqual({ sex: 'female', weightKg: 70, shape: { belly: 0.2 }, revision: 3, figure: { frame: 0.5 } });
    expect(migrateProfileDocBody({ sex: 'male', figure: { frame: 0.3 }, figureBase: 'female' })).toEqual({ sex: 'male', figure: { frame: 0.3 } });
  });
});

describe('Frame: documents', { timeout: 30_000 }, () => {
  it('migrates a v1 boot cache into profile/me and rewrites the cache at the current version', async () => {
    localStorage.setItem('vitals.body', JSON.stringify({ version: 1, state: V1_BODY }));
    const { report, docs, useProfileStore, flushBodyPersistence } = await boot();
    expect(report.migrated).toBe(true);
    expect(useProfileStore.getState().figure).toEqual({ frame: 1 });
    expect(useProfileStore.getState()).not.toHaveProperty('figureBase');
    const doc = docs.peek('profile', 'me');
    expect(doc).toMatchObject({ sex: 'female', weightKg: 71.5, figure: { frame: 1 } });
    expect(doc).not.toHaveProperty('figureBase');
    flushBodyPersistence();
    const cache = JSON.parse(localStorage.getItem('vitals.body')!) as { version: number; state: Record<string, unknown> };
    expect(BODY_VERSION).toBe(2);
    expect(cache.version).toBe(2);
    expect(cache.state.figure).toEqual({ frame: 1 });
    expect(cache.state).not.toHaveProperty('figureBase');
  });

  it('hydrates the projection from a legacy profile/me document (an app not yet updated)', async () => {
    const { backend, useProfileStore } = await boot();
    backend.remote({
      _id: 'me',
      _col: 'profile',
      _schema: 1,
      _rev: '9999999999999-0000-REMOTEDEVICE0001',
      _device: 'REMOTEDEVICE0001',
      _created: NOW,
      _updated: NOW,
      value: { ...V1_BODY, sex: 'male', figureBase: 'female', weightKg: 69 },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(useProfileStore.getState().weightKg).toBe(69);
    expect(useProfileStore.getState().figure).toEqual({ frame: 0 });
  });

  it('profile.patch sets, clamps-by-schema and resets the frame, one revision per patch', async () => {
    localStorage.setItem('vitals.body', JSON.stringify({ version: 2, state: { ...V1_BODY, figureBase: undefined, figure: { frame: null } } }));
    const { docs, useProfileStore } = await boot();
    const { dispatch, settleCommits } = await import('@/commands');
    const rev = () => useProfileStore.getState().revision;
    const frameDoc = () => (docs.peek('profile', 'me') as { figure?: unknown } | null)?.figure;

    let before = rev();
    let r = await dispatch('profile.patch', { figure: { frame: 0.42 } });
    expect(r.ok).toBe(true);
    await settleCommits();
    expect(useProfileStore.getState().figure).toEqual({ frame: 0.42 });
    expect(frameDoc()).toEqual({ frame: 0.42 });
    expect(rev()).toBe(before + 1);
    if (r.ok && 'output' in r) expect(r.output.profile).toMatchObject({ figure: { frame: 0.42 } });

    before = rev();
    r = await dispatch('profile.patch', { figure: { frame: 3 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalid_input');
    expect(useProfileStore.getState().figure).toEqual({ frame: 0.42 });
    expect(rev()).toBe(before);

    before = rev();
    r = await dispatch('profile.patch', { figure: { frame: 0.123456 } });
    expect(r.ok).toBe(true);
    expect(useProfileStore.getState().figure).toEqual({ frame: 0.123 });
    expect(rev()).toBe(before + 1);

    before = rev();
    r = await dispatch('profile.patch', { figure: { frame: null } });
    expect(r.ok).toBe(true);
    await settleCommits();
    expect(useProfileStore.getState().figure).toEqual({ frame: null });
    expect(frameDoc()).toEqual({ frame: null });
    expect(rev()).toBe(before + 1);

    await dispatch('profile.patch', { figure: { frame: 0.7 } });
    before = rev();
    r = await dispatch('profile.patch', { figure: null });
    expect(r.ok).toBe(true);
    await settleCommits();
    expect(useProfileStore.getState().figure).toEqual({ frame: null });
    expect(frameDoc()).toEqual({ frame: null });
    expect(rev()).toBe(before + 1);

    // the frame and another field in one patch are one change
    before = rev();
    r = await dispatch('profile.patch', { figure: { frame: 0.6 }, heightCm: 170 });
    expect(r.ok).toBe(true);
    expect(useProfileStore.getState()).toMatchObject({ figure: { frame: 0.6 }, heightCm: 170 });
    expect(rev()).toBe(before + 1);

    // resetting the shape does not reset the frame
    await dispatch('profile.resetShape', {});
    expect(useProfileStore.getState().figure).toEqual({ frame: 0.6 });

    // the store action dispatches the same command
    useProfileStore.getState().setFigureFrame(0.25);
    expect(useProfileStore.getState().figure).toEqual({ frame: 0.25 });
    useProfileStore.getState().setFigureFrame(1.0000001);
    expect(useProfileStore.getState().figure).toEqual({ frame: 1 });
    useProfileStore.getState().setFigureFrame(null);
    expect(useProfileStore.getState().figure).toEqual({ frame: null });
    await settleCommits();
    expect(frameDoc()).toEqual({ frame: null });
  });
});

describe('Frame: import', { timeout: 30_000 }, () => {
  it('imports a v1 export carrying figureBase', async () => {
    const { runtime, useProfileStore } = await boot();
    const p = await import('@/state/persistence');
    const file = {
      vitalsVersion: '1',
      app: 'vitals',
      appVersion: '0.1.0',
      exportedAt: NOW,
      stores: { 'vitals.body': { version: 1, state: V1_BODY } },
    };
    const preview = p.parseImport(JSON.stringify(file));
    expect(preview.ok).toBe(true);
    await p.importAll(preview, 'replace');
    expect(useProfileStore.getState().figure).toEqual({ frame: 1 });
    expect(useProfileStore.getState()).not.toHaveProperty('figureBase');
    await runtime.settleUnscopedWrites();
    expect(runtime.getDocumentStore().peek('profile', 'me')).toMatchObject({ figure: { frame: 1 } });
    expect(runtime.getDocumentStore().peek('profile', 'me')).not.toHaveProperty('figureBase');
  });

  it('imports a v2 export whose profile document carries figureBase', async () => {
    const { runtime, useProfileStore } = await boot();
    const p = await import('@/state/persistence');
    const { setup: _setup, shapeSkipped: _s, habitsSkipped: _h, ...profileBody } = V1_BODY;
    const file = {
      vitalsVersion: '2',
      app: 'vitals',
      collections: { profile: [{ _id: 'me', _col: 'profile', _schema: 1, ...profileBody }] },
    };
    const preview = p.parseImport(JSON.stringify(file));
    expect(preview.ok).toBe(true);
    await p.importAll(preview, 'replace');
    expect(useProfileStore.getState().figure).toEqual({ frame: 1 });
    expect(useProfileStore.getState().weightKg).toBe(71.5);
    await runtime.settleUnscopedWrites();
    expect(runtime.getDocumentStore().peek('profile', 'me')).toMatchObject({ figure: { frame: 1 } });
  });
});
