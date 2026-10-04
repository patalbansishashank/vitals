/**
 * Settings: a projection of the synced `settings` document (units, energy and glucose units, date style, week start)
 * and the device-local `deviceSettings` document (theme, motion, chart patterns, figure, last export). Boot cache and
 * export key `vitals.settings`. Every change goes through `settings.update`.
 */
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
  type SettingsState,
  type SettingsValues,
} from './internal/settingsModel';

export {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  SETTINGS_VERSION,
  isSettingsState,
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
  merge: (persisted, current) => ({ ...current, ...pickValues((persisted ?? {}) as Partial<SettingsValues>) }),
  binding: {
    owns: ['settings', 'deviceSettings'],
    toDocs: (v) => [
      { col: 'settings', id: 'me', body: pick(v, SYNCED_SETTING_KEYS) },
      { col: 'deviceSettings', id: 'me', body: pick(v, DEVICE_SETTING_KEYS) },
    ],
    fromDocs: (read) => {
      const synced = read.get('settings', 'me');
      const device = read.get('deviceSettings', 'me');
      if (!synced && !device) return null;
      return pickValues({ ...(synced ?? {}), ...(device ?? {}) } as Partial<SettingsValues>);
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
