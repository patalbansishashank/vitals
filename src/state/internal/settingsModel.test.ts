/**
 * r079 settings keys: `todayCards` and `widgetWeight` are device-local. There is no `glow`
 * setting (SPEC Q6). The keys need a default, a place in exactly one of the two stores, a guard for imports, and a
 * sanitiser so a corrupt saved or legacy shared document can never break Today.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  DEVICE_SETTING_KEYS,
  SYNCED_SETTING_KEYS,
  AI_SETTING_KEYS,
  TODAY_CARDS_MAX,
  TODAY_CARD_ENTRY_MAX,
  formatCardEntry,
  isSettingsState,
  parseCardEntry,
  pickValues,
  sanitizeTodayCards,
} from './settingsModel';

describe('defaults and where each key lives', () => {
  it('todayCards is null (follows app defaults) and widgetWeight is off', () => {
    expect(DEFAULT_SETTINGS.todayCards).toBeNull();
    expect(DEFAULT_SETTINGS.widgetWeight).toBe(false);
  });

  it('todayCards and widgetWeight are device-only, and there is no glow setting', () => {
    expect(SYNCED_SETTING_KEYS).not.toContain('todayCards');
    expect(DEVICE_SETTING_KEYS).toContain('todayCards');
    expect(DEVICE_SETTING_KEYS).toContain('widgetWeight');
    expect(SYNCED_SETTING_KEYS as readonly string[]).not.toContain('widgetWeight');
    expect(Object.keys(DEFAULT_SETTINGS)).not.toContain('glow');
  });

  it('every setting is stored in exactly one place', () => {
    const all = Object.keys(DEFAULT_SETTINGS);
    for (const k of all) {
      const places = [(SYNCED_SETTING_KEYS as readonly string[]).includes(k), (DEVICE_SETTING_KEYS as readonly string[]).includes(k)].filter(Boolean).length;
      expect(places, k).toBe(1);
    }
  });

  it('neither is an AI setting: the person chooses what Today shows and what a home screen shows', () => {
    expect(AI_SETTING_KEYS).not.toContain('todayCards');
    expect(AI_SETTING_KEYS).not.toContain('widgetWeight');
  });
});

describe('the stored entry: "id" or "id:size"', () => {
  it('parses and formats', () => {
    expect(parseCardEntry('steps')).toEqual({ id: 'steps' });
    expect(parseCardEntry('steps:card')).toEqual({ id: 'steps', size: 'card' });
    expect(parseCardEntry('energy-balance:tile')).toEqual({ id: 'energy-balance', size: 'tile' });
    expect(formatCardEntry({ id: 'steps', size: 'card' })).toBe('steps:card');
    expect(formatCardEntry({ id: 'sleep' })).toBe('sleep');
    expect(formatCardEntry({ id: 'sleep', size: null })).toBe('sleep');
  });

  it('refuses anything else', () => {
    for (const bad of ['', ':card', 'Steps', 'steps:', 'steps:card:tile', 'steps card', 'a'.repeat(TODAY_CARD_ENTRY_MAX + 1), 42, null, undefined, {}]) expect(parseCardEntry(bad), String(bad)).toBeNull();
    expect(parseCardEntry('a'.repeat(TODAY_CARD_ENTRY_MAX))).not.toBeNull();
  });
});

describe('sanitizeTodayCards', () => {
  it('keeps order, drops what is not an entry, and keeps the first place of a card listed twice', () => {
    expect(sanitizeTodayCards(['eaten', 'energy:card', 'bad entry', 3, 'eaten:tile', 'sleep', 'energy'])).toEqual(['eaten', 'energy:card', 'sleep']);
  });

  it('an empty list stays empty (the person removed everything); anything else that is not an array is the default set', () => {
    expect(sanitizeTodayCards([])).toEqual([]);
    for (const v of [null, undefined, 'steps', 7, {}]) expect(sanitizeTodayCards(v)).toBeNull();
  });

  it('holds at most 40', () => {
    const many = Array.from({ length: 60 }, (_, i) => `card-${i}`);
    expect(sanitizeTodayCards(many)).toHaveLength(TODAY_CARDS_MAX);
    expect(sanitizeTodayCards(many)?.[0]).toBe('card-0');
  });

  it('pickValues applies it, so a corrupt synced document is harmless', () => {
    expect(pickValues({ todayCards: ['steps', 'oops!', 'steps:card'] }).todayCards).toEqual(['steps']);
    expect(pickValues({ todayCards: 'steps' as never }).todayCards).toBeNull();
    expect(pickValues({}).todayCards).toBeNull();
    expect(pickValues({ widgetWeight: true }).widgetWeight).toBe(true);
    expect(pickValues({}).widgetWeight).toBe(false);
  });
});

describe('isSettingsState (import validation)', () => {
  it('accepts null, an empty list, a list of entries, and both booleans', () => {
    expect(isSettingsState({ todayCards: null })).toBe(true);
    expect(isSettingsState({ todayCards: [] })).toBe(true);
    expect(isSettingsState({ todayCards: ['eaten', 'steps:card'] })).toBe(true);
    expect(isSettingsState({ widgetWeight: true })).toBe(true);
    expect(isSettingsState({ widgetWeight: false })).toBe(true);
    expect(isSettingsState({})).toBe(true);
  });

  it('refuses a string, a non-entry, a list over 40, an entry over 40 characters', () => {
    expect(isSettingsState({ todayCards: 'steps' })).toBe(false);
    expect(isSettingsState({ todayCards: ['steps', 7] })).toBe(false);
    expect(isSettingsState({ todayCards: ['Not An Entry'] })).toBe(false);
    expect(isSettingsState({ todayCards: Array.from({ length: TODAY_CARDS_MAX + 1 }, (_, i) => `c${i}`) })).toBe(false);
    expect(isSettingsState({ todayCards: ['a'.repeat(TODAY_CARD_ENTRY_MAX + 1)] })).toBe(false);
    expect(isSettingsState({ widgetWeight: 'yes' })).toBe(false);
  });
});
