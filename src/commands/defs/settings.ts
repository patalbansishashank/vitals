/** `settings.*` (SUITE_SPEC §1.9). The AI may change display settings only. */
import { AI_SETTING_KEYS, TODAY_CARDS_MAX, TODAY_CARD_ENTRY_MAX } from '@/state/internal/settingsModel';
import { settingsValues, updateSettings } from '@/state/internal/settings';
import { defineCommand, fail } from '../registry';
import { T } from '../schema';
import { ALL, UNDO } from './_shared';

const HrProfile = T.Object({
  hrMaxOverride: T.Nullable(T.Number({ minimum: 100, maximum: 240 })),
  hrRestOverride: T.Nullable(T.Number({ minimum: 30, maximum: 120, description: 'A WAKING resting heart rate the person measured; never the sleeping low.' })),
  useSleepLowAsRest: T.Boolean(),
});

const SettingsPatch = T.Object(
  {
    units: T.Optional(T.Enum(['metric', 'imperial'])),
    energyUnit: T.Optional(T.Enum(['kcal', 'kJ'])),
    glucoseUnit: T.Optional(T.Enum(['mmol', 'mgdl'])),
    dateStyle: T.Optional(T.Enum(['day-month', 'month-day'])),
    weekStart: T.Optional(T.Enum(['monday', 'sunday'])),
    theme: T.Optional(T.Enum(['system', 'light', 'dark'])),
    reduceMotion: T.Optional(T.Enum(['system', 'on', 'off'])),
    chartPatterns: T.Optional(T.Boolean()),
    showFigure: T.Optional(T.Boolean()),
    lastExportAt: T.Optional(T.Nullable(T.Instant())),
    quietMode: T.Optional(T.Boolean()),
    checkInAutoConfirm: T.Optional(T.Boolean()),
    gaugeImport: T.Optional(T.Boolean()),
    // energy SPEC §V3.9, Addendum A.1.7: the person's own choices (never an AI's)
    hrProfile: T.Optional(HrProfile),
    keytelEnabled: T.Optional(T.Boolean()),
    stepsPreference: T.Optional(T.Array(T.Enum(['ring', 'phone', 'hc-other']), { minItems: 1, maxItems: 3 })),
    soleSustainedGait: T.Optional(T.Boolean()),
    stepsHeadline: T.Optional(T.Enum(['atLeast', 'located'])),
    importHcWeight: T.Optional(T.Boolean()),
    provisionalOverlay: T.Optional(T.Boolean()),
    ringMonitor: T.Optional(T.Array(T.String({ minLength: 1, maxLength: 40 }), { maxItems: 40 })),
    dayScoreTarget: T.Optional(T.Number({ minimum: 0, maximum: 100 })),
    activeEnergyGoalKcal: T.Optional(T.Nullable(T.Number({ minimum: 0, maximum: 5000 }))),
    hrMaxSuggestionDeclinedBpm: T.Optional(T.Nullable(T.Number({ minimum: 100, maximum: 240, description: 'The measured maximum-heart-rate suggestion the person declined; a suggestion shows again only above it.' }))),
    // r071: the person's own display choices (never an AI's)
    todayCards: T.Optional(T.Nullable(T.Array(T.String({ minLength: 1, maxLength: TODAY_CARD_ENTRY_MAX }), { maxItems: TODAY_CARDS_MAX, description: 'The cards this device shows on Today, in order, each "id" or "id:size". Stored only on this device; null is the default set.' }))),
    widgetWeight: T.Optional(T.Boolean({ description: 'Show weight on this device’s Android widgets.' })),
  },
  {
    description:
      'Synced settings (units, date style, week start, quiet mode, check-in auto-confirm, ring data from the phone, heart-rate profile, HR calories, step source, step headline, Health Connect weight, provisional activities, Ring monitor, Day score target, active-energy goal, a declined maximum-heart-rate suggestion) and this device’s settings (theme, motion, charts, figure, weight on widgets, the cards on Today). Only display settings may be changed by an agent.',
  },
);

export const SettingsView = T.Object({
  units: T.Enum(['metric', 'imperial']),
  energyUnit: T.Enum(['kcal', 'kJ']),
  glucoseUnit: T.Enum(['mmol', 'mgdl']),
  dateStyle: T.Enum(['day-month', 'month-day']),
  weekStart: T.Enum(['monday', 'sunday']),
  theme: T.Enum(['system', 'light', 'dark']),
  reduceMotion: T.Enum(['system', 'on', 'off']),
  chartPatterns: T.Boolean(),
  showFigure: T.Boolean(),
  lastExportAt: T.Nullable(T.String()),
  quietMode: T.Boolean(),
  checkInAutoConfirm: T.Boolean(),
  gaugeImport: T.Boolean(),
  hrProfile: HrProfile,
  keytelEnabled: T.Boolean(),
  stepsPreference: T.Array(T.Enum(['ring', 'phone', 'hc-other'])),
  soleSustainedGait: T.Boolean(),
  stepsHeadline: T.Enum(['atLeast', 'located']),
  importHcWeight: T.Boolean(),
  provisionalOverlay: T.Boolean(),
  ringMonitor: T.Array(T.String()),
  dayScoreTarget: T.Number(),
  activeEnergyGoalKcal: T.Nullable(T.Number()),
  hrMaxSuggestionDeclinedBpm: T.Nullable(T.Number()),
  todayCards: T.Nullable(T.Array(T.String())),
  widgetWeight: T.Boolean(),
});

/** The view: settings in effect, without the internal "the person chose quiet mode" marker. */
const settingsView = () => {
  const { quietModeSet: _set, ...view } = settingsValues();
  return view;
};

export const settingsGet = defineCommand({
  id: 'settings.get',
  version: 1,
  title: 'Read settings',
  description: 'Display settings: measurement units (metric or imperial; values are always stored metric), energy unit (kcal or kJ), glucose unit, date style, week start, theme, reduced motion, chart patterns, figure on/off, quiet mode (words instead of numbers).',
  input: T.Object({}),
  output: SettingsView,
  perm: 'read',
  surfaces: ALL,
  excludedReason: { ui: 'the screens read the projection hooks directly' },
  undo: UNDO.none,
  idempotency: 'none',
  sideEffects: [],
  execute: () => settingsView(),
});

export const settingsUpdate = defineCommand({
  id: 'settings.update',
  version: 1,
  title: 'Change settings',
  description: 'Change display settings, e.g. { patch: { units: "imperial" } }. Only the fields given change. Units change display and entry only; stored values stay metric.',
  input: T.Object({ patch: SettingsPatch }),
  output: SettingsView,
  perm: 'write',
  impact: 'low',
  surfaces: ALL,
  undo: UNDO.IP,
  idempotency: 'natural',
  sideEffects: ['docs', 'ui'],
  execute: (ctx, input) => {
    if (ctx.actor.kind !== 'user' && ctx.actor.kind !== 'system') {
      const other = Object.keys(input.patch).filter((k) => !AI_SETTING_KEYS.includes(k as never));
      if (other.length) fail('surface_forbidden', 'Only display settings can be changed from here.', { path: `/patch/${other[0]}` });
    }
    const patch = Object.fromEntries(Object.entries(input.patch).filter(([, v]) => v !== undefined));
    if (Object.keys(patch).length) updateSettings(patch);
    return settingsView();
  },
});

declare module '../types' {
  interface CommandMap {
    'settings.get': typeof settingsGet;
    'settings.update': typeof settingsUpdate;
  }
}
