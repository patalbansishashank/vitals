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
  /**
   * D5-06 opt-in: a ready weekly check-in whose decision needs no review is confirmed without asking. Off by default;
   * the person's own choice (never an AI's).
   */
  checkInAutoConfirm: boolean;
  /**
   * S1: bring the ring's steps and main sleep in from the home server (the Gauge import, `@/state/gaugeImport`). On by
   * default; synced, so off stops every device. The person's own choice (never an AI's).
   */
  gaugeImport: boolean;
  // ---- energy SPEC §V3.9 and Addendum A.1.7 (V3): the person's own choices (never an AI's); recommended defaults
  /** D6: HRmax and a WAKING resting HR the person set; the sleeping low is an HRR proxy only when opted in. */
  hrProfile: HrProfileSetting;
  /** D2: book Keytel (population HR calories) in its domain; off = MET booked, Keytel kept as a comparison. */
  keytelEnabled: boolean;
  /** D1: step lineage preference when both observe an interval (the server's `steps-fuse/1` reads it). */
  stepsPreference: StepsLineage[];
  /** D1: the sole-sustained-gait context rule (the treadmill case). */
  soleSustainedGait: boolean;
  /** D3: the day steps headline when ring detail is incomplete. */
  stepsHeadline: 'atLeast' | 'located';
  /** D13: import Health Connect weight as device measurements (manual entries win). */
  importHcWeight: boolean;
  /** D8: show pending candidates hatched as provisional on Today (never in the plan projection until approved). */
  provisionalOverlay: boolean;
  /** A.1.7: the Ring monitor's signals in order; empty = the default set. */
  ringMonitor: string[];
  /** A.1.7 / D17: the Day score target (no adaptive rule). */
  dayScoreTarget: number;
  /** A.1.7 / D20: a user-set active-energy goal, kcal; null = none (no goal tick unless the plan sets one). */
  activeEnergyGoalKcal: number | null;
  /**
   * §V4.7 (DECISIONS V4e-07): the measured HRmax suggestion the person declined, bpm; a suggestion shows again only above
   * it. null = none declined. The person's own choice (never an AI's).
   */
  hrMaxSuggestionDeclinedBpm: number | null;
  /**
   * r071 (AUDIT §2.6): the cards the person chose for Today, in order, each `"id"` or `"id:size"` (`"steps:card"`). `null`
   * means "the default set, and later changes to the default reach me"; a list is the person's own and is the whole
   * resolved list (the hero is implicit and never stored), so a card a later release adds to the default never appears by
   * itself. Entries are lower-case ids, at most 40 of at most 40 characters. Availability (a ring, a plan, quiet mode) is
   * decided when Today draws, never when this is written: a card for a missing ring stays stored. Selection, order and
   * desktop widths are device-local; they never follow another device's shared settings. Never an AI's choice.
   */
  todayCards: string[] | null;
  /**
   * r071 (Q9): show the person's weight on the Android home-screen widgets. This device only, off by default: a weight is
   * not something to leave on a screen anyone can see.
   */
  widgetWeight: boolean;
}

export type StepsLineage = 'ring' | 'phone' | 'hc-other';

export interface HrProfileSetting {
  hrMaxOverride: number | null;
  hrRestOverride: number | null;
  useSleepLowAsRest: boolean;
}

export const DEFAULT_HR_PROFILE: HrProfileSetting = { hrMaxOverride: null, hrRestOverride: null, useSleepLowAsRest: false };

export interface SettingsState extends SettingsValues {
  setUnits: (units: UnitSystem) => void;
  setTheme: (theme: ThemeChoice) => void;
  /** Patch any settings. */
  set: (patch: Partial<SettingsValues>) => void;
}

export const SETTINGS_KEY = 'vitals.settings';
/** v3 moved interim fasting consent to safety. r079 changes document ownership, not this mirror's shape/version. */
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
  checkInAutoConfirm: false,
  gaugeImport: true,
  hrProfile: DEFAULT_HR_PROFILE,
  keytelEnabled: true,
  stepsPreference: ['ring', 'phone'],
  soleSustainedGait: true,
  stepsHeadline: 'atLeast',
  importHcWeight: true,
  provisionalOverlay: true,
  ringMonitor: [],
  dayScoreTarget: 70,
  activeEnergyGoalKcal: null,
  hrMaxSuggestionDeclinedBpm: null,
  todayCards: null,
  widgetWeight: false,
};

/** Synced across devices (`settings`). */
export const SYNCED_SETTING_KEYS = [
  'units', 'energyUnit', 'glucoseUnit', 'dateStyle', 'weekStart', 'quietMode', 'quietModeSet', 'checkInAutoConfirm', 'gaugeImport',
  'hrProfile', 'keytelEnabled', 'stepsPreference', 'soleSustainedGait', 'stepsHeadline', 'importHcWeight', 'provisionalOverlay', 'ringMonitor', 'dayScoreTarget', 'activeEnergyGoalKcal',
  'hrMaxSuggestionDeclinedBpm',
] as const satisfies ReadonlyArray<keyof SettingsValues>;
/** This device only (`deviceSettings`, with Today layout in protected `uiPrefs` fields). */
export const DEVICE_SETTING_KEYS = ['theme', 'reduceMotion', 'chartPatterns', 'showFigure', 'lastExportAt', 'widgetWeight', 'todayCards'] as const satisfies ReadonlyArray<keyof SettingsValues>;
/** What an AI may change (display only, SUITE_SPEC §1.9 `settings.update`); quiet mode is the person's own choice. */
export const AI_SETTING_KEYS: ReadonlyArray<keyof SettingsValues> = ['units', 'energyUnit', 'glucoseUnit', 'dateStyle', 'weekStart', 'theme', 'reduceMotion', 'chartPatterns', 'showFigure'];

/**
 * The quiet mode in effect: the person's own choice once they made one; before that, on in safety mode R1 (SUITE_SPEC
 * §3.7, "on by default in safety mode R1"). A stored `true` from before `quietModeSet` existed stays on.
 */
export const effectiveQuietMode = (v: Pick<SettingsValues, 'quietMode' | 'quietModeSet'>, r1: boolean): boolean => (v.quietModeSet ? v.quietMode : v.quietMode || r1);

/** Most entries a stored Today list holds, and the longest entry (the command schema's bounds). */
export const TODAY_CARDS_MAX = 40;
export const TODAY_CARD_ENTRY_MAX = 40;

/** One stored Today entry: a card id (lower-case words joined by hyphens), optionally `:size` (`steps:card`). */
const CARD_ENTRY = /^([a-z0-9][a-z0-9-]*)(?::([a-z]+))?$/;

/** `"steps:card"` → `{ id: 'steps', size: 'card' }`; `null` for anything that is not an entry. */
export function parseCardEntry(entry: unknown): { id: string; size?: string } | null {
  if (typeof entry !== 'string' || entry.length === 0 || entry.length > TODAY_CARD_ENTRY_MAX) return null;
  const m = CARD_ENTRY.exec(entry);
  if (!m) return null;
  return m[2] ? { id: m[1]!, size: m[2] } : { id: m[1]! };
}

/** `{ id: 'steps', size: 'card' }` → `"steps:card"`; no size → `"steps"`. */
export const formatCardEntry = (e: { id: string; size?: string | null }): string => (e.size ? `${e.id}:${e.size}` : e.id);

/**
 * A stored Today list made safe to draw from (a corrupt saved or legacy document must never break Today): entries that
 * are not `id` or `id:size` are dropped, a card listed twice keeps its first place, at most 40 remain. Anything that is not
 * an array is `null`, the default set. The ids themselves are the registry's to judge (an id a later release removes is
 * dropped there, silently).
 */
export function sanitizeTodayCards(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    const e = parseCardEntry(entry);
    if (!e || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(formatCardEntry(e));
    if (out.length >= TODAY_CARDS_MAX) break;
  }
  return out;
}

export const pickValues = (s: Partial<SettingsValues>): SettingsValues => {
  const out = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS) as Array<keyof SettingsValues>) {
    if (s[k] !== undefined) (out as Record<string, unknown>)[k] = s[k];
  }
  out.todayCards = sanitizeTodayCards(out.todayCards);
  // Field-owned settings use JSON merge patch: a cleared nested override may be
  // absent in the document, while the public settings contract still returns null.
  if (!out.hrProfile || Object.keys(DEFAULT_HR_PROFILE).some((key) => !Object.hasOwn(out.hrProfile, key))) {
    out.hrProfile = { ...DEFAULT_HR_PROFILE, ...out.hrProfile };
  }
  return out;
};

/** Accepts anything shaped like settings (import validation). */
export function isSettingsState(x: unknown): boolean {
  if (!x || typeof x !== 'object') return false;
  const s = x as Record<string, unknown>;
  const oneOf = (k: string, vals: readonly unknown[]) => s[k] === undefined || vals.includes(s[k]);
  return (
    oneOf('checkInAutoConfirm', [false, true]) &&
    oneOf('gaugeImport', [false, true]) &&
    oneOf('keytelEnabled', [false, true]) &&
    oneOf('soleSustainedGait', [false, true]) &&
    oneOf('importHcWeight', [false, true]) &&
    oneOf('provisionalOverlay', [false, true]) &&
    oneOf('stepsHeadline', ['atLeast', 'located']) &&
    (s.dayScoreTarget === undefined || (typeof s.dayScoreTarget === 'number' && s.dayScoreTarget >= 0 && s.dayScoreTarget <= 100)) &&
    (s.hrMaxSuggestionDeclinedBpm === undefined || s.hrMaxSuggestionDeclinedBpm === null || (typeof s.hrMaxSuggestionDeclinedBpm === 'number' && s.hrMaxSuggestionDeclinedBpm >= 100 && s.hrMaxSuggestionDeclinedBpm <= 240)) &&
    (s.ringMonitor === undefined || (Array.isArray(s.ringMonitor) && s.ringMonitor.every((x) => typeof x === 'string'))) &&
    (s.todayCards === undefined || s.todayCards === null || (Array.isArray(s.todayCards) && s.todayCards.length <= TODAY_CARDS_MAX && s.todayCards.every((x) => parseCardEntry(x) !== null))) &&
    oneOf('widgetWeight', [false, true]) &&
    oneOf('units', ['metric', 'imperial']) &&
    oneOf('theme', ['system', 'light', 'dark']) &&
    oneOf('reduceMotion', ['system', 'on', 'off'])
  );
}
