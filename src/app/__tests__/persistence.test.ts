import { act } from '@testing-library/react';
import {
  EXPORT_FORMAT_VERSION,
  eraseAll,
  exportAll,
  exportFileName,
  importAll,
  listStoredKeys,
  migrateLegacyKeys,
  parseImport,
  registerStore,
  serializeExport,
} from '@/state/persistence';
import { SETTINGS_KEY, useSettingsStore } from '@/state/settingsStore';

describe('persistence registry', () => {
  beforeEach(async () => {
    localStorage.clear();
    await act(() => useSettingsStore.persist.rehydrate());
  });

  it('round-trips every vitals.* key through export → erase → import', async () => {
    act(() => useSettingsStore.getState().set({ units: 'imperial', theme: 'dark', chartPatterns: true }));
    localStorage.setItem('vitals.scenarios', JSON.stringify({ state: { list: ['Spring cut'] }, version: 3 }));
    localStorage.setItem('vitals.raw', 'plain text');
    localStorage.setItem('other.app', 'not ours');

    const file = serializeExport(exportAll(new Date('2026-09-30T10:00:00Z')));
    const parsed = JSON.parse(file) as { vitalsVersion: string; stores: Record<string, unknown> };
    expect(parsed.vitalsVersion).toBe(EXPORT_FORMAT_VERSION);
    expect(Object.keys(parsed.stores).sort()).toEqual(['vitals.raw', 'vitals.scenarios', SETTINGS_KEY].sort());

    await eraseAll();
    expect(listStoredKeys()).toEqual([]);
    expect(localStorage.getItem('other.app')).toBe('not ours');

    const result = await act(() => importAll(file, 'replace'));
    expect(result.written.sort()).toEqual(['vitals.raw', 'vitals.scenarios', SETTINGS_KEY].sort());
    expect(localStorage.getItem('vitals.raw')).toBe('plain text');
    expect(JSON.parse(localStorage.getItem('vitals.scenarios')!)).toEqual({ state: { list: ['Spring cut'] }, version: 3 });
    // the registered settings store rehydrated from the imported file
    expect(useSettingsStore.getState().units).toBe('imperial');
    expect(useSettingsStore.getState().theme).toBe('dark');
    expect(useSettingsStore.getState().chartPatterns).toBe(true);
  });

  it('refuses files that are not Vitals exports or come from a newer version', () => {
    expect(parseImport('not json')).toMatchObject({ ok: false, code: 'not-json' });
    expect(parseImport('{"hello":1}')).toMatchObject({ ok: false, code: 'not-export' });
    const newer = parseImport(JSON.stringify({ vitalsVersion: '9', appVersion: '9.0.0', stores: {} }));
    expect(newer).toMatchObject({ ok: false, code: 'newer-version' });
    expect(newer.ok ? '' : newer.message).toContain('newer Vitals (9.0.0)');
    expect(parseImport(JSON.stringify({ vitalsVersion: '1', stores: {} }))).toMatchObject({ ok: false, code: 'empty' });
    // a version field without any data is not "missing the vitalsVersion field"
    const noData = parseImport(JSON.stringify({ vitalsVersion: '1' }));
    expect(noData).toMatchObject({ ok: false, code: 'not-export' });
    expect(noData.ok === false && noData.message).toMatch(/no data section/);
  });

  it('validates each store and offers to import the rest of a partly damaged file', async () => {
    const off = registerStore('vitals.goals', 2, { label: 'goals', validate: (s) => Array.isArray(s) });
    const file = JSON.stringify({
      vitalsVersion: '1',
      exportedAt: '2026-08-12T09:00:00Z',
      appVersion: '0.1.0',
      stores: {
        [SETTINGS_KEY]: { version: 2, state: { units: 'imperial' } },
        'vitals.goals': { version: 2, state: 'broken' },
        'vitals.future': { state: 1 },
        'evil.key': { state: 1 },
      },
    });
    const preview = parseImport(file);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.entries.map((e) => e.key).sort()).toEqual(['vitals.future', SETTINGS_KEY]);
    expect(preview.damaged.map((d) => d.key).sort()).toEqual(['evil.key', 'vitals.goals']);
    expect(preview.exportedAt?.toISOString()).toBe('2026-08-12T09:00:00.000Z');
    await act(() => importAll(preview, 'replace'));
    expect(localStorage.getItem('vitals.goals')).toBeNull();
    expect(localStorage.getItem('evil.key')).toBeNull();
    off();
  });

  it('merge keeps existing data unless the store defines a merge rule', async () => {
    const off = registerStore('vitals.notes', 1, { label: 'notes', merge: (a, b) => [...(a as string[]), ...(b as string[])] });
    localStorage.setItem('vitals.notes', JSON.stringify({ state: ['here'], version: 1 }));
    localStorage.setItem('vitals.kept', JSON.stringify({ state: 'mine', version: 1 }));
    const file = JSON.stringify({
      vitalsVersion: '1',
      stores: {
        'vitals.notes': { version: 1, state: ['imported'] },
        'vitals.kept': { version: 1, state: 'theirs' },
        'vitals.new': { version: 1, state: 'fresh' },
      },
    });
    const res = await importAll(file, 'merge');
    expect(res.kept).toEqual(['vitals.kept']);
    expect(JSON.parse(localStorage.getItem('vitals.notes')!).state).toEqual(['here', 'imported']);
    expect(JSON.parse(localStorage.getItem('vitals.kept')!).state).toBe('mine');
    expect(JSON.parse(localStorage.getItem('vitals.new')!).state).toBe('fresh');
    off();
  });

  it('names export files by local date', () => {
    expect(exportFileName(new Date(2026, 8, 30, 12))).toBe('vitals-2026-09-30.json');
  });

  it('copies data saved under the former lumen.* keys once', () => {
    localStorage.setItem('lumen.settings', JSON.stringify({ state: { units: 'imperial' }, version: 3 }));
    localStorage.setItem('lumen.raw', 'plain text');
    localStorage.setItem('other.app', 'not ours');

    expect(migrateLegacyKeys().sort()).toEqual(['vitals.raw', SETTINGS_KEY].sort());
    expect(localStorage.getItem('vitals.raw')).toBe('plain text');
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).state.units).toBe('imperial');
    expect(localStorage.getItem('other.app')).toBe('not ours');

    // once vitals.* data exists the migration never copies again (nothing erased or replaced is copied back)
    localStorage.setItem('lumen.raw', 'plain text');
    localStorage.removeItem('vitals.raw');
    expect(migrateLegacyKeys()).toEqual([]);
    expect(localStorage.getItem('vitals.raw')).toBeNull();
  });

  it('legacy lumen keys are removed after the copy', () => {
    localStorage.setItem('lumen.settings', JSON.stringify({ state: { units: 'imperial' }, version: 3 }));
    localStorage.setItem('lumen.raw', 'plain text');
    migrateLegacyKeys();
    expect(localStorage.getItem('lumen.settings')).toBeNull();
    expect(localStorage.getItem('lumen.raw')).toBeNull();

    // an install that copied before this version: the stale old key goes; one without a vitals.* twin stays
    localStorage.setItem('lumen.settings', JSON.stringify({ state: { units: 'metric' }, version: 3 }));
    localStorage.setItem('lumen.notes', 'erased since');
    expect(migrateLegacyKeys()).toEqual([]);
    expect(localStorage.getItem('lumen.settings')).toBeNull();
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).state.units).toBe('imperial');
    expect(localStorage.getItem('lumen.notes')).toBe('erased since');
  });

  it('imports files exported before the rename and erases the old keys with everything else', async () => {
    const preview = parseImport(JSON.stringify({ lumenVersion: '1', app: 'lumen', stores: { 'lumen.notes': { version: 1, state: ['old'] } } }));
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.entries.map((e) => e.key)).toEqual(['vitals.notes']);
    expect(preview.data).toMatchObject({ vitalsVersion: '1', app: 'vitals' });
    await importAll(preview, 'merge');
    expect(JSON.parse(localStorage.getItem('vitals.notes')!).state).toEqual(['old']);

    localStorage.setItem('lumen.notes', 'left from before the rename');
    await eraseAll();
    expect(localStorage.getItem('lumen.notes')).toBeNull();
    expect(listStoredKeys()).toEqual([]);
  });
});
