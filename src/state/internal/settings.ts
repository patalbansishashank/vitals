/** Settings store actions (importable only from `src/commands/**`). */
import { inSafetyModeR1 } from '../safetyStore';
import { useSettingsStore } from '../settingsStore';
import { effectiveQuietMode, pickValues, type SettingsValues } from './settingsModel';

/** A patch that sets quiet mode records that the person chose it (it then no longer follows the R1 default). */
export function updateSettings(patch: Partial<SettingsValues>): void {
  useSettingsStore.setState(typeof patch.quietMode === 'boolean' ? { ...patch, quietModeSet: true } : patch);
}

/** The settings in effect: `quietMode` is the effective value (on by default in safety mode R1, SUITE_SPEC §3.7). */
export function settingsValues(): SettingsValues {
  const v = pickValues(useSettingsStore.getState());
  return { ...v, quietMode: effectiveQuietMode(v, inSafetyModeR1()) };
}
