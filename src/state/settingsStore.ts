/**
 * Settings: a projection of the synced `settings` document (units, energy and glucose units, date style, week start,
 * quiet mode) and device-local preferences (`deviceSettings`, plus protected Today layout fields in `uiPrefs`).
 * Boot cache and
 * export key `vitals.settings`. Every change goes through `settings.update`.
 */
import { bodyOf, deepEqual, mintWriteToken, revokeWriteToken, type DocumentStore } from '@/store';
import { readMirror } from './bridge';
import { createScope, currentScope, runInScope, type WriteScope } from './scope';
import { currentRestoreEpoch } from './writeBarrier';
import { dispatchSync } from '@/commands/bus';
import '@/commands/defs/settings'; // registers the commands the actions below dispatch
import { registerStore } from './persistence';
import { createProjection } from './projection';
import { inSafetyModeR1, useSafetyStore } from './safetyStore';
import {
  DEFAULT_SETTINGS,
  DEVICE_SETTING_KEYS,
  SETTINGS_KEY,
  SETTINGS_VERSION,
  SYNCED_SETTING_KEYS,
  effectiveQuietMode,
  isSettingsState,
  pickValues,
  sanitizeTodayCards,
  type SettingsState,
  type SettingsValues,
} from './internal/settingsModel';

export {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  SETTINGS_VERSION,
  isSettingsState,
  formatCardEntry,
  parseCardEntry,
  sanitizeTodayCards,
  type DateStyle,
  type EnergyUnit,
  type GlucoseUnit,
  type MotionChoice,
  type SettingsState,
  type SettingsValues,
  type ThemeChoice,
  type UnitSystem,
  type WeekStart,
} from './internal/settingsModel';

const pick = (v: SettingsValues, keys: readonly (keyof SettingsValues)[]): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = v[k];
  return out;
};

// 0.7.8 writes deviceSettings/me wholesale. Keep the new local choice in shared-field
// uiPrefs instead, where older writers preserve fields they do not own.
const LOCAL_CARDS_SET = 'todayCardsLocalSet';
const LOCAL_CARDS = 'todayCardsLocal';
const LOCAL_CARD_FIELDS = [LOCAL_CARDS_SET, LOCAL_CARDS] as const;
const DEVICE_DOCUMENT_KEYS = DEVICE_SETTING_KEYS.filter((key) => key !== 'todayCards');
const hasCards = (value: unknown): value is { todayCards: unknown } => !!value && typeof value === 'object' && Object.hasOwn(value, 'todayCards');
const hadSavedLayoutAtHydration = hasCards(readMirror(SETTINGS_KEY)?.state);
let localLayoutReady = false;
const explicitLayoutWrites = new WeakSet<WriteScope>();

/** Only a real canonical layout edit may write before asynchronous document boot finishes. */
export function markTodayCardsLocalEdit(): void {
  const scope = currentScope();
  if (scope && scope.kind !== 'dryRun') explicitLayoutWrites.add(scope);
}

function localCards(ui: Record<string, unknown> | null): string[] | null | undefined {
  // The marker is durable even when JSON merge-patch removes an explicit null value.
  return ui?.[LOCAL_CARDS_SET] === true ? sanitizeTodayCards(ui[LOCAL_CARDS]) : undefined;
}

/** Prepare after documents/recovery load; commit after ordinary settings reconciliation. */
export function prepareLocalTodayCardsMigration(store: DocumentStore): () => Promise<void> {
  const mirror = readMirror(SETTINGS_KEY);
  const legacy = store.peek<Record<string, unknown>>('settings', 'me');
  const mirrored = mirror?.state;
  const seed = hadSavedLayoutAtHydration && hasCards(mirrored) && (mirror?.restoreEpoch ?? null) === currentRestoreEpoch()
    ? sanitizeTodayCards(mirrored.todayCards)
    : sanitizeTodayCards(legacy?.todayCards);
  return async () => {
    let layout = seed;
    const token = mintWriteToken('migration', { label: 'Today layout stays on this device' });
    try {
      await store.transact(token, async (tx) => {
        const ui = await tx.get<Record<string, unknown>>('uiPrefs', 'me');
        const existing = localCards(ui ? bodyOf(ui) : null);
        if (existing !== undefined) layout = existing;
        else await tx.patch('uiPrefs', 'me', { [LOCAL_CARDS_SET]: true, [LOCAL_CARDS]: layout });
      });
    } finally { revokeWriteToken(token); }
    localLayoutReady = true;
    runInScope(createScope('sync', { label: 'read this device’s Today layout' }), () => {
      if (!deepEqual(useSettingsStore.getState().todayCards, layout)) useSettingsStore.setState({ todayCards: layout });
      else useSettingsStore.binding.capture();
    });
  };
}

export const useSettingsStore = createProjection<SettingsState, SettingsValues>({
  name: 'settings',
  key: SETTINGS_KEY,
  version: SETTINGS_VERSION,
  persistedFields: Object.keys(DEFAULT_SETTINGS) as Array<keyof SettingsValues & string>,
  creator: () => ({
    ...DEFAULT_SETTINGS,
    setUnits: (units) => void dispatchSync('settings.update', { patch: { units } }),
    setTheme: (theme) => void dispatchSync('settings.update', { patch: { theme } }),
    set: (patch) => void dispatchSync('settings.update', { patch }),
  }),
  partialize: (s) => pickValues(s),
  // v1 stored { units, theme }; v2 adds the rest with defaults; v3 hands `allowLongFasts` to the safety
  // store, which asks for the new fasting acknowledgements before longer fasts apply again.
  migrate: (persisted, version) => {
    if (version < 3 && (persisted as { allowLongFasts?: unknown } | null)?.allowLongFasts === true) useSafetyStore.getState().adoptLegacyLongFasts();
    return pickValues((persisted ?? {}) as Partial<SettingsValues>);
  },
  migrateImport: (persisted) => pickValues((persisted ?? {}) as Partial<SettingsValues>),
  merge: (persisted, current) => ({ ...current, ...pickValues((persisted ?? {}) as Partial<SettingsValues>) }),
  binding: {
    prepareBoot: prepareLocalTodayCardsMigration,
    owns: ['deviceSettings'],
    shares: [
      { col: 'settings', id: 'me', fields: SYNCED_SETTING_KEYS },
      { col: 'uiPrefs', id: 'me', fields: LOCAL_CARD_FIELDS, reconcileClock: false },
    ],
    toDocs: (v) => {
      const scope = currentScope();
      return [
        { col: 'settings', id: 'me', body: pick(v, SYNCED_SETTING_KEYS), fields: SYNCED_SETTING_KEYS },
        { col: 'deviceSettings', id: 'me', body: pick(v, DEVICE_DOCUMENT_KEYS) },
        ...(localLayoutReady || (scope && explicitLayoutWrites.has(scope))
          ? [{ col: 'uiPrefs' as const, id: 'me', body: { [LOCAL_CARDS_SET]: true, [LOCAL_CARDS]: v.todayCards }, fields: LOCAL_CARD_FIELDS }]
          : []),
      ];
    },
    fromDocs: (read) => {
      const synced = read.get('settings', 'me');
      const device = read.get('deviceSettings', 'me');
      const local = localCards(read.get('uiPrefs', 'me'));
      if (!synced && !device && local === undefined) return null;
      return pickValues({ ...(synced ?? {}), ...(device ?? {}), ...(local !== undefined ? { todayCards: local } : {}) } as Partial<SettingsValues>);
    },
  },
});

registerStore(SETTINGS_KEY, SETTINGS_VERSION, {
  label: 'settings',
  describe: () => 'settings',
  validate: isSettingsState,
  merge: (current) => current, // merging keeps this device's settings
  rehydrate: () => useSettingsStore.persist.rehydrate(),
});

/** The energy display unit (kcal or kJ) — for components that format energy with `formatEnergy`. */
export function useEnergyUnit(): SettingsValues['energyUnit'] {
  return useSettingsStore((s) => s.energyUnit);
}

/**
 * Quiet mode in effect (SUITE_SPEC §3.7): `on`, and `byDefault` when it is on only because the safety answers put the
 * person in safety mode R1 and they have not set it themselves.
 */
export function useQuietMode(): { on: boolean; byDefault: boolean } {
  const quietMode = useSettingsStore((s) => s.quietMode);
  const quietModeSet = useSettingsStore((s) => s.quietModeSet);
  const r1 = useSafetyStore((s) => inSafetyModeR1(s.answers));
  const on = effectiveQuietMode({ quietMode, quietModeSet }, r1);
  return { on, byDefault: on && !quietModeSet && !quietMode };
}
