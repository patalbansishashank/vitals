/**
 * Today selection/order/desktop widths and widget weight stay on this device. The schema bounds every entry;
 * Today uses protected uiPrefs fields, widget weight uses deviceSettings. null selects defaults, [] stays empty,
 * and an agent may change neither.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { bootDocuments, getDocumentStore } from '@/state/runtime';
import { useSettingsStore } from '@/state/settingsStore';
import { dispatch } from '..';
import { AI, MCP, freshState } from './harness';

beforeEach(async () => {
  freshState({ cleared: true });
  await bootDocuments();
});

const synced = () => getDocumentStore().peek<{ todayCards?: string[] | null; widgetWeight?: boolean }>('settings', 'me');
const device = () => getDocumentStore().peek<{ todayCards?: unknown; widgetWeight?: boolean }>('deviceSettings', 'me');

const localLayout = () => getDocumentStore().peek<{ todayCardsLocalSet?: boolean; todayCardsLocal?: string[] }>('uiPrefs', 'me');

describe('todayCards (this device)', () => {
  it('persists selection, order and widths only in protected local preferences', async () => {
    const r = await dispatch('settings.update', { patch: { todayCards: ['eaten', 'energy:card', 'steps:tile'] } });
    expect(r.ok).toBe(true);
    expect(useSettingsStore.getState().todayCards).toEqual(['eaten', 'energy:card', 'steps:tile']);
    expect(localLayout()).toMatchObject({ todayCardsLocalSet: true, todayCardsLocal: ['eaten', 'energy:card', 'steps:tile'] });
    expect(synced()?.todayCards).toBeUndefined();
    expect(device()?.todayCards).toBeUndefined();
  });

  it('null goes back to the default set; an empty list is a person who removed everything', async () => {
    await dispatch('settings.update', { patch: { todayCards: ['eaten'] } });
    expect((await dispatch('settings.update', { patch: { todayCards: [] } })).ok).toBe(true);
    expect(useSettingsStore.getState().todayCards).toEqual([]);
    expect((await dispatch('settings.update', { patch: { todayCards: null } })).ok).toBe(true);
    expect(useSettingsStore.getState().todayCards).toBeNull();
    expect(localLayout()?.todayCardsLocalSet).toBe(true);
    expect(localLayout()?.todayCardsLocal).toBeUndefined();
    expect(synced()?.todayCards).toBeUndefined();
  });

  it('settings.get reports it', async () => {
    await dispatch('settings.update', { patch: { todayCards: ['sleep'] } });
    const r = await dispatch('settings.get', {});
    if (!r.ok || !('output' in r)) throw new Error(JSON.stringify(r));
    expect((r.output as { todayCards: string[] | null }).todayCards).toEqual(['sleep']);
  });

  it('the schema bounds it: at most 40 entries of 1 to 40 characters, strings only', async () => {
    const bad: unknown[] = [Array.from({ length: 41 }, (_, i) => `c${i}`), ['x'.repeat(41)], [''], [7], 'steps', {}];
    for (const todayCards of bad) {
      const r = await dispatch('settings.update', { patch: { todayCards } as never });
      expect(r.ok, JSON.stringify(todayCards).slice(0, 40)).toBe(false);
    }
    expect(useSettingsStore.getState().todayCards).toBeNull();
    expect((await dispatch('settings.update', { patch: { todayCards: Array.from({ length: 40 }, (_, i) => `c${i}`) } })).ok).toBe(true);
  });

  it('an agent cannot change it', async () => {
    for (const actor of [AI, MCP]) {
      const r = await dispatch('settings.update', { patch: { todayCards: ['sleep'] } }, { actor });
      expect(r.ok).toBe(false);
    }
    expect(useSettingsStore.getState().todayCards).toBeNull();
  });
});

describe('widgetWeight (this device)', () => {
  it('is off by default, lands in deviceSettings and never in the synced document', async () => {
    expect(useSettingsStore.getState().widgetWeight).toBe(false);
    const r = await dispatch('settings.update', { patch: { widgetWeight: true } });
    expect(r.ok).toBe(true);
    expect(useSettingsStore.getState().widgetWeight).toBe(true);
    expect(device()?.widgetWeight).toBe(true);
    expect(synced()?.widgetWeight).toBeUndefined();
  });

  it('is a boolean and an agent cannot turn it on', async () => {
    expect((await dispatch('settings.update', { patch: { widgetWeight: 'yes' as never } })).ok).toBe(false);
    expect((await dispatch('settings.update', { patch: { widgetWeight: true } }, { actor: AI })).ok).toBe(false);
    expect(useSettingsStore.getState().widgetWeight).toBe(false);
  });
});
