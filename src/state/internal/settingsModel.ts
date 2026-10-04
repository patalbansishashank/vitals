/** Settings model (pure): values, defaults, the synced / device-local split and import validation. */

export type UnitSystem = 'metric' | 'imperial';
export type ThemeChoice = 'system' | 'light' | 'dark';
/** Reduce motion: follow the OS, force on, or force off. */
export type MotionChoice = 'system' | 'on' | 'off';
export type EnergyUnit = 'kcal' | 'kJ';
export type GlucoseUnit = 'mmol' | 'mgdl';
export type DateStyle = 'day-month' | 'month-day';
export type WeekStart = 'monday' | 'sunday';

export interface SettingsValues {
  /** Body measurements. Stored values everywhere stay metric; this only changes display and entry. */
  units: UnitSystem;
  energyUnit: EnergyUnit;
  glucoseUnit: GlucoseUnit;
  dateStyle: DateStyle;
  weekStart: WeekStart;
  theme: ThemeChoice;
  reduceMotion: MotionChoice;
  /** Hatching in bands and bars so charts read without colour. */
  chartPatterns: boolean;
  /** Show the body figure; off = numbers only. */
  showFigure: boolean;
  /** ISO time of the last data export (null = never). */
  lastExportAt: string | null;
  /** Quiet mode (SUITE_SPEC §3.7): words instead of numbers for scores, energy left and trend weight; the Coach skips calorie talk. */
  quietMode: boolean;
  /**
   * The person set quiet mode themselves (the Settings switch or Living's setQuietMode). Until then quiet mode is on by
   * default in safety mode R1 (SUITE_SPEC §3.7); see `effectiveQuietMode`.
   */
  quietModeSet: boolean;
}

export interface SettingsState extends SettingsValues {
  setUnits: (units: UnitSystem) => void;
  setTheme: (theme: ThemeChoice) => void;
  /** Patch any settings. */
  set: (patch: Partial<SettingsValues>) => void;
}

export const SETTINGS_KEY = 'vitals.settings';
/** v3: the interim `allowLongFasts` moved to the safety store (vitals.safety) as a legacy opt-in request. */
export const SETTINGS_VERSION = 3;

export const DEFAULT_SETTINGS: SettingsValues = {
  units: 'metric',
  energyUnit: 'kcal',
  glucoseUnit: 'mmol',
  dateStyle: 'day-month',
  weekStart: 'monday',
  theme: 'system',
  reduceMotion: 'system',
  chartPatterns: false,
  showFigure: true,
  lastExportAt: null,
  quietMode: false,
  quietModeSet: false,
};

/** Synced across devices (`settings`). */
export const SYNCED_SETTING_KEYS = ['units', 'energyUnit', 'glucoseUnit', 'dateStyle', 'weekStart', 'quietMode', 'quietModeSet'] as const satisfies ReadonlyArray<keyof SettingsValues>;
/** This device only (`deviceSettings`). */
export const DEVICE_SETTING_KEYS = ['theme', 'reduceMotion', 'chartPatterns', 'showFigure', 'lastExportAt'] as const satisfies ReadonlyArray<keyof SettingsValues>;
/** What an AI may change (display only, SUITE_SPEC §1.9 `settings.update`); quiet mode is the person's own choice. */
export const AI_SETTING_KEYS: ReadonlyArray<keyof SettingsValues> = ['units', 'energyUnit', 'glucoseUnit', 'dateStyle', 'weekStart', 'theme', 'reduceMotion', 'chartPatterns', 'showFigure'];

/**
 * The quiet mode in effect: the person's own choice once they made one; before that, on in safety mode R1 (SUITE_SPEC
 * §3.7, "on by default in safety mode R1"). A stored `true` from before `quietModeSet` existed stays on.
 */
export const effectiveQuietMode = (v: Pick<SettingsValues, 'quietMode' | 'quietModeSet'>, r1: boolean): boolean => (v.quietModeSet ? v.quietMode : v.quietMode || r1);

export const pickValues = (s: Partial<SettingsValues>): SettingsValues => {
  const out = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS) as Array<keyof SettingsValues>) {
    if (s[k] !== undefined) (out as Record<string, unknown>)[k] = s[k];
  }
  return out;
};

/** Accepts anything shaped like settings (import validation). */
export function isSettingsState(x: unknown): boolean {
  if (!x || typeof x !== 'object') return false;
  const s = x as Record<string, unknown>;
  const oneOf = (k: string, vals: readonly unknown[]) => s[k] === undefined || vals.includes(s[k]);
  return oneOf('units', ['metric', 'imperial']) && oneOf('theme', ['system', 'light', 'dark']) && oneOf('reduceMotion', ['system', 'on', 'off']);
}
