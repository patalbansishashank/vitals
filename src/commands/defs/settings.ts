/** `settings.*` (SUITE_SPEC §1.9). The AI may change display settings only. */
import { AI_SETTING_KEYS } from '@/state/internal/settingsModel';
import { settingsValues, updateSettings } from '@/state/internal/settings';
import { defineCommand, fail } from '../registry';
import { T } from '../schema';
import { ALL, UNDO } from './_shared';

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
  },
  { description: 'Synced settings (units, date style, week start, quiet mode) and this device’s settings (theme, motion, charts, figure). Quiet mode is changed by the person only.' },
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
