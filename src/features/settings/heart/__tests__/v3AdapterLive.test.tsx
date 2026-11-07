/**
 * Settings › Heart rate over V3's synced settings and the approved-bout evidence (energy SPEC §V4.7, §V3.9, §V2.1):
 * changes go through `settings.update` into the synced `settings` document; the declined suggestion is a validated synced
 * field; V4e's device-kept values move into the synced settings once; the HRmax evidence is the approved device bouts'
 * supported HR from the fused timeline (a pending candidate never counts).
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatch, settleCommits, type CommandResult } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { addDays, localToInstant } from '@/living';
import type { ReviewSheetModel } from '@/living/activityCandidates';
import type { GaugeTimeline } from '@/net/gauge';
import { getDocumentStore } from '@/state/runtime';
import { useProfileStore } from '@/state/profileStore';
import { isSettingsState, useSettingsStore } from '@/state/settingsStore';
import { setProgressGauge } from '@/features/living/progress/data/gauge';
import { setTimelineSource } from '@/features/living/progress/data/timelines';
import { demoGauge } from '@/features/living/progress/__fixtures__/activity';
import SettingsPage from '../../SettingsPage';
import { HEART_SETTINGS_KEY, hrMaxEvidenceBouts, migrateLegacyHeartSettings, readHeartSettings, resetHeartMigration, updateHeartSettings } from '../v3Adapter';

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const TODAY = '2026-10-21';
const SYS = { actor: { kind: 'system' as const, id: 'gauge-import' } };
const ms = (date: string, h: number) => Date.parse(localToInstant(date, h, TZ));
const out = <T,>(r: CommandResult): T => {
  if (!r.ok || !('output' in r)) throw new Error(JSON.stringify(r));
  return r.output as T;
};

/** Four 30-min runs at 18:00 on the four days before today, each holding the given HR for its first 10 minutes. */
const RUNS: Array<{ date: string; bpm: number }> = [
  { date: addDays(TODAY, -1), bpm: 190 },
  { date: addDays(TODAY, -2), bpm: 188 },
  { date: addDays(TODAY, -3), bpm: 186 },
  { date: addDays(TODAY, -4), bpm: 200 }, // left pending: must not count
];

function timeline(date: string): GaugeTimeline | null {
  const run = RUNS.find((r) => r.date === date);
  if (!run) return null;
  const first = ms(date, 0);
  const n = 1440;
  const bpm: Array<number | null> = new Array(n).fill(null);
  const supportedS: Array<number | null> = new Array(n).fill(null);
  const k0 = Math.round((ms(date, 18) - first) / 60_000);
  for (let k = k0; k < k0 + 10; k++) {
    bpm[k] = run.bpm;
    supportedS[k] = 60;
  }
  return { date, tz: TZ, start: new Date(first).toISOString(), minutes: n, steps: { selected: new Array(n).fill(null), source: [], ring: [], phone: [] }, hr: { bpm, supportedS }, sleep: { stage: new Array(n).fill(null) }, sessions: [], hcExercise: [], acquisition: { ring: [], phone: [] } } as unknown as GaugeTimeline;
}

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings/:section" element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>,
  );

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(ms(TODAY, 12)));
});
afterAll(() => vi.useRealTimers());

beforeEach(async () => {
  freshState({ cleared: true });
  await getDocumentStore().ready;
  setProgressGauge(demoGauge());
  setTimelineSource(async (d) => timeline(d));
  act(() => {
    const p = useProfileStore.getState();
    p.setSex('male');
    p.setAge(40);
    p.setHeight(178);
    p.setWeight(84);
  });
});
afterEach(() => {
  setTimelineSource(null);
  setProgressGauge(null);
});

async function importAndApprove(): Promise<void> {
  out(await dispatch('activity.fromGauge', { gaugeSessions: RUNS.map((r, i) => ({ id: `g-run-${i}`, revision: 'r1', start: ms(r.date, 18), end: ms(r.date, 18.5), type: 'run', kcal: 330 })), hcSessions: [] }, SYS));
  await settleCommits();
  const m = out<ReviewSheetModel>(await dispatch('activity.candidates', { from: addDays(TODAY, -7), to: TODAY }));
  expect(m.rows).toHaveLength(4);
  for (const r of m.rows.filter((x) => x.date !== RUNS[3]!.date)) out(await dispatch('activity.approve', { id: r.id, revision: r.revision }));
  await settleCommits();
}

async function evidence(now: number) {
  hrMaxEvidenceBouts(now);
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 5));
    const b = hrMaxEvidenceBouts(now);
    if (b.length > 0) return b;
  }
  return hrMaxEvidenceBouts(now);
}

describe('Settings › Heart rate over the synced settings', () => {
  it('writes through settings.update into the synced document; the declined value is a validated synced field', async () => {
    expect(readHeartSettings()).toMatchObject({ keytelEnabled: true, stepsPreference: ['ring', 'phone'], hrMaxSuggestionDeclinedBpm: null, hrProfile: { hrMaxOverride: null, hrRestOverride: null, useSleepLowAsRest: false } });
    expect(await updateHeartSettings({ hrProfile: { hrRestOverride: 58 }, keytelEnabled: false, stepsPreference: ['phone', 'ring'], hrMaxSuggestionDeclinedBpm: 186 })).toBe(true);
    await settleCommits();
    const s = useSettingsStore.getState();
    // the rest of the profile is kept, not dropped
    expect(s.hrProfile).toEqual({ hrMaxOverride: null, hrRestOverride: 58, useSleepLowAsRest: false });
    expect(s).toMatchObject({ keytelEnabled: false, stepsPreference: ['phone', 'ring'], hrMaxSuggestionDeclinedBpm: 186 });
    const doc = getDocumentStore().peek<Record<string, unknown>>('settings', 'me');
    expect(doc).toMatchObject({ hrMaxSuggestionDeclinedBpm: 186, keytelEnabled: false });
    expect(readHeartSettings()).toMatchObject({ hrMaxSuggestionDeclinedBpm: 186, stepsPreference: ['phone', 'ring'], hrProfile: { hrRestOverride: 58 } });

    // out of range is refused; an agent cannot change it (the person's own choice)
    const bad = await dispatch('settings.update', { patch: { hrMaxSuggestionDeclinedBpm: 50 } });
    expect(bad.ok).toBe(false);
    const ai = await dispatch('settings.update', { patch: { hrMaxSuggestionDeclinedBpm: 190 } }, { actor: { kind: 'mcp', id: 'claude-desktop' } });
    expect(ai.ok).toBe(false);
    expect(isSettingsState({ hrMaxSuggestionDeclinedBpm: 300 })).toBe(false);
    expect(isSettingsState({ hrMaxSuggestionDeclinedBpm: null })).toBe(true);
    // a settings view without the field (an older document) reads the default
    expect((await dispatch('settings.get', {})).ok).toBe(true);
  });

  it('keeps another step lineage behind ring and phone', async () => {
    await dispatch('settings.update', { patch: { stepsPreference: ['hc-other', 'ring', 'phone'] } });
    expect(readHeartSettings().stepsPreference).toEqual(['ring', 'phone']);
    await updateHeartSettings({ stepsPreference: ['phone', 'ring'] });
    expect(useSettingsStore.getState().stepsPreference).toEqual(['phone', 'ring', 'hc-other']);
  });

  it('moves the device-kept values into the synced settings once and deletes the key', async () => {
    localStorage.setItem(HEART_SETTINGS_KEY, JSON.stringify({ hrProfile: { hrMaxOverride: 192, useSleepLowAsRest: true }, stepsHeadline: 'located', soleSustainedGait: true }));
    resetHeartMigration();
    await migrateLegacyHeartSettings();
    expect(localStorage.getItem(HEART_SETTINGS_KEY)).toBeNull();
    expect(useSettingsStore.getState()).toMatchObject({ hrProfile: { hrMaxOverride: 192, hrRestOverride: null, useSleepLowAsRest: true }, stepsHeadline: 'located' });
  });
});

describe('the HRmax suggestion’s evidence', () => {
  it('is the approved device bouts with supported HR; a pending candidate never counts', async () => {
    await importAndApprove();
    const bouts = await evidence(Date.now());
    expect(bouts).toHaveLength(3);
    expect(bouts.every((b) => b.quality && b.segments.length === 10)).toBe(true);
    expect(bouts.map((b) => b.segments[0]!.bpm).sort()).toEqual([186, 188, 190]);

    // on screen: the 3rd highest sustained peak of the approved bouts (186), not the pending 200's
    at('/settings/heart');
    expect(await screen.findByText('Your workouts reached 186 bpm')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep 180 bpm' }));
    await act(async () => settleCommits());
    expect(useSettingsStore.getState().hrMaxSuggestionDeclinedBpm).toBe(186);
    expect(screen.queryByText('Your workouts reached 186 bpm')).toBeNull();
  });

  it('has no bouts without approvals', async () => {
    out(await dispatch('activity.fromGauge', { gaugeSessions: [{ id: 'g', revision: 'r1', start: ms(RUNS[0]!.date, 18), end: ms(RUNS[0]!.date, 18.5), type: 'run' }], hcSessions: [] }, SYS));
    await settleCommits();
    expect(await evidence(Date.now())).toEqual([]);
  });
});
