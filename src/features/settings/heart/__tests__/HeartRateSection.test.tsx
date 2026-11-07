// Package V4e (energy SPEC §V4.7): Settings › Heart rate — how maximum and resting heart rate are estimated, the zones
// as they would freeze into the next approved workout, the measured upward HRmax suggestion (accept or decline), the D6
// sleeping-low opt-in and the D1/D2/D3 switches.
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freshState } from '@/commands/__tests__/harness';
import { useProfileStore } from '@/state/profileStore';
import { useSettingsStore } from '@/state/settingsStore';
import { withSystemWrite } from '@/state/scope';
import { setProgressGauge } from '@/features/living/progress/data/gauge';
import { demoGauge } from '@/features/living/progress/__fixtures__/activity';
import { hrProfile, type HrMaxEvidenceBout } from '@/living/sensors';
import SettingsPage from '../../SettingsPage';
import { profileOf, suggestionOf, zoneRows, zonesOf } from '../model';
import { HEART_SETTINGS_DEFAULTS, readHeartSettings, resetHeartSettings, setHrEvidence } from '../v3Adapter';

const NOW = Date.parse('2026-10-01T12:00:00Z');

function bout(i: number, bpm: number, daysAgo = 10 * (i + 1)): HrMaxEvidenceBout {
  const start = NOW - daysAgo * 86_400_000;
  return {
    id: `b${i}`,
    window: { start, end: start + 2_400_000 },
    quality: true,
    segments: Array.from({ length: 4 }, (_, k) => ({
      start: start + k * 10_000,
      end: start + (k + 1) * 10_000,
      bpm,
    })),
  };
}

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/:section" element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  freshState();
  resetHeartSettings();
  setProgressGauge(demoGauge());
  act(() => {
    const p = useProfileStore.getState();
    p.setSex('male');
    p.setAge(40);
    p.setHeight(178);
    p.setWeight(84);
  });
});

afterEach(() => {
  setHrEvidence(null);
  setProgressGauge(null);
  resetHeartSettings();
});

describe('heart model', () => {
  it('zones: %HRmax (Tanaka) until a waking resting HR is entered (D6); reserve under 40 bpm falls back', () => {
    const pct = profileOf(HEART_SETTINGS_DEFAULTS, 40, 52);
    expect(pct.basis).toBe('pctMax');
    expect(pct.hrRest).toBeNull(); // the sleeping low is never silently resting HR
    expect(zoneRows(zonesOf(pct)).map((z) => [z.fromBpm, z.toBpm])).toEqual([
      [90, 108],
      [108, 126],
      [126, 144],
      [144, 162],
      [162, 180],
    ]);
    const hrr = profileOf({ ...HEART_SETTINGS_DEFAULTS, hrProfile: { ...HEART_SETTINGS_DEFAULTS.hrProfile, hrRestOverride: 60 } }, 40, 52);
    expect(hrr.basis).toBe('hrr');
    expect(zoneRows(zonesOf(hrr))[0]).toMatchObject({ fromBpm: 120, toBpm: 132 });
    const proxy = profileOf(
      {
        ...HEART_SETTINGS_DEFAULTS,
        hrProfile: { ...HEART_SETTINGS_DEFAULTS.hrProfile, useSleepLowAsRest: true },
      },
      40,
      52,
    );
    expect(proxy.hrRest).toEqual({ bpm: 52, source: 'proxySleepLow' });
    expect(zoneRows(zonesOf(hrProfile({ ageY: null })))).toEqual([]);
  });

  it('the suggestion needs 3 quality bouts above the maximum and stays hidden at or under a declined value', () => {
    const p = profileOf(HEART_SETTINGS_DEFAULTS, 40, null);
    expect(suggestionOf(p, [bout(0, 188), bout(1, 190)], NOW, null)).toBeNull();
    const s = suggestionOf(p, [bout(0, 188), bout(1, 190), bout(2, 186)], NOW, null)!;
    expect(s).toMatchObject({ suggestedBpm: 186, currentBpm: 180 });
    expect(suggestionOf(p, [bout(0, 188), bout(1, 190), bout(2, 186)], NOW, 186)).toBeNull();
    expect(suggestionOf(p, [bout(0, 188), bout(1, 190), bout(2, 186, 200)], NOW, null)).toBeNull(); // older than 180 days
  });
});

describe('Settings › Heart rate', () => {
  it('is a section of the index (General) with its own page', async () => {
    at('/settings');
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).getByRole('link', { name: /^Heart rate/ })).toHaveAttribute('href', '/settings/heart');
    at('/settings/heart');
    expect(await screen.findByRole('heading', { level: 1, name: 'Heart rate' })).toBeInTheDocument();
  });

  it('says how the maximum is made, shows the zones and the freeze rule, and explains the estimates', async () => {
    at('/settings/heart');
    expect(await screen.findByText('Estimated from your age, ±10 bpm')).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: /maximum heart rate/i })).toHaveValue('180');
    expect(screen.getByText('Share of maximum')).toBeInTheDocument();
    expect(screen.getByText('Until you enter a resting heart rate')).toBeInTheDocument();
    const zones = screen.getByRole('table', { name: 'Heart-rate zones' });
    expect(within(zones).getAllByRole('row')).toHaveLength(6);
    expect(within(zones).getByRole('row', { name: /Zone 1 90 to under 108 bpm 50 to under 60 %/ })).toBeInTheDocument();
    // no two zones share an edge: the top zone alone ends at the maximum
    expect(within(zones).getByRole('row', { name: /Zone 5 162–180 bpm 90–100 %/ })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: /maximum heart rate/i })).toHaveAttribute('aria-valuemin', '100');
    expect(screen.getByText(/A workout keeps the zones it was approved with/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'About How zones are made' }));
    expect(screen.getByText(/208 − 0\.7 × age/)).toBeInTheDocument();
    expect(screen.getByText(/never lowers it by itself/)).toBeInTheDocument();
  });

  it('accepting the suggestion raises the maximum; declining keeps it and hides that value', async () => {
    setHrEvidence({
      hrMaxEvidenceBouts: () =>
        [bout(0, 188), bout(1, 190), bout(2, 186)].map((b) => ({
          ...b,
          window: { start: Date.now() - 5 * 86_400_000, end: Date.now() - 5 * 86_400_000 + 2_400_000 },
          segments: b.segments.map((s, k) => ({
            ...s,
            start: Date.now() - 5 * 86_400_000 + k * 10_000,
            end: Date.now() - 5 * 86_400_000 + (k + 1) * 10_000,
          })),
        })),
    });
    const view = at('/settings/heart');
    expect(await screen.findByText('Your workouts reached 186 bpm')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep 180 bpm' }));
    expect(readHeartSettings().hrMaxSuggestionDeclinedBpm).toBe(186);
    expect(screen.queryByText('Your workouts reached 186 bpm')).toBeNull();
    expect(readHeartSettings().hrProfile.hrMaxOverride).toBeNull();
    view.unmount();
    resetHeartSettings();
    at('/settings/heart');
    await userEvent.click(await screen.findByRole('button', { name: 'Raise to 186 bpm' }));
    expect(readHeartSettings().hrProfile.hrMaxOverride).toBe(186);
    expect(screen.getAllByText('Set by you')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Use the estimate' }));
    expect(readHeartSettings().hrProfile.hrMaxOverride).toBeNull();
  });

  it('a waking resting HR switches the basis to the reserve; the sleeping low is an opt-in with its own number', async () => {
    at('/settings/heart');
    expect(await screen.findByText(/Sleeping low 53 bpm sits below a waking resting rate/)).toBeInTheDocument();
    const sw = screen.getByRole('switch', { name: 'Use sleeping low as resting' });
    expect(sw).not.toBeChecked();
    const rest = screen.getByRole('spinbutton', { name: /resting heart rate/i });
    await userEvent.type(rest, '60{Enter}');
    expect(readHeartSettings().hrProfile.hrRestOverride).toBe(60);
    expect(await screen.findByText('Heart-rate reserve')).toBeInTheDocument();
    expect(screen.getByText('From resting 60 bpm to maximum 180 bpm')).toBeInTheDocument();
    expect(screen.getByText('Your entered resting rate is used instead')).toBeInTheDocument();
  });

  it('keeps the D2 calories switch here and the D1/D3 step rules in Settings › Steps, with their recommended defaults', async () => {
    const heart = at('/settings/heart');
    expect(await screen.findByRole('switch', { name: 'Heart-rate calories' })).toBeChecked();
    // r068 S20: the step rules left Heart rate for a section of their own
    expect(screen.queryByRole('switch', { name: 'One device walking alone wins' })).toBeNull();
    await userEvent.click(screen.getByRole('switch', { name: 'Heart-rate calories' }));
    expect(readHeartSettings().keytelEnabled).toBe(false);
    heart.unmount();
    at('/settings/steps');
    expect(await screen.findByRole('heading', { level: 1, name: 'Steps' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'One device walking alone wins' })).toBeChecked();
    expect(
      within(screen.getByRole('radiogroup', { name: 'When ring and phone both count' })).getByRole('radio', {
        name: 'Ring',
      }),
    ).toBeChecked();
    const day = screen.getByRole('radiogroup', { name: 'Day total' });
    expect(within(day).getByRole('radio', { name: 'At least' })).toBeChecked();
    await userEvent.click(within(day).getByRole('radio', { name: 'Placed in time' }));
    expect(readHeartSettings().stepsHeadline).toBe('located');
    await userEvent.click(
      within(screen.getByRole('radiogroup', { name: 'When ring and phone both count' })).getByRole('radio', {
        name: 'Phone',
      }),
    );
    expect(readHeartSettings().stepsPreference).toEqual(['phone', 'ring']);
  });

  it('quiet mode hides derived readings and their accessible twin, keeps typed inputs and uses words in the explanation', async () => {
    act(() =>
      withSystemWrite(() => {
        useSettingsStore.setState({
          quietMode: true,
          quietModeSet: true,
          hrProfile: { ...HEART_SETTINGS_DEFAULTS.hrProfile, hrMaxOverride: 185, hrRestOverride: 62 },
        });
      }),
    );
    at('/settings/heart');
    expect(await screen.findByRole('spinbutton', { name: /maximum heart rate/i })).toHaveValue('185');
    expect(screen.getByRole('spinbutton', { name: /resting heart rate/i })).toHaveValue('62');
    expect(screen.queryByRole('table', { name: 'Heart-rate zones' })).toBeNull();
    expect(document.querySelector('.settings-zbar__ticks')).toBeNull();
    expect(document.querySelector('.settings-zbar__names')).toHaveTextContent('Very lightLightModerateHardMaximum');
    expect(document.querySelector('.settings-section')?.textContent).not.toMatch(/\d/);
    await userEvent.click(screen.getByRole('button', { name: 'About How zones are made' }));
    expect(screen.getByRole('dialog').textContent).not.toMatch(/\d/);
  });

  it('quiet mode leaves an inferred maximum blank and preserves the raise and decline actions in words', async () => {
    act(() => withSystemWrite(() => useSettingsStore.setState({ quietMode: true, quietModeSet: true })));
    setHrEvidence({
      hrMaxEvidenceBouts: () =>
        [bout(0, 188), bout(1, 190), bout(2, 186)].map((b) => ({
          ...b,
          window: { start: Date.now() - 5 * 86_400_000, end: Date.now() - 5 * 86_400_000 + 2_400_000 },
          segments: b.segments.map((s, k) => ({
            ...s,
            start: Date.now() - 5 * 86_400_000 + k * 10_000,
            end: Date.now() - 5 * 86_400_000 + (k + 1) * 10_000,
          })),
        })),
    });
    at('/settings/heart');
    expect(await screen.findByRole('spinbutton', { name: /maximum heart rate/i })).toHaveValue('');
    expect(screen.getByText('Your workouts went above your maximum')).toBeInTheDocument();
    expect(document.querySelector('.settings-section')?.textContent).not.toMatch(/\d/);
    await userEvent.click(screen.getByRole('button', { name: 'Raise maximum' }));
    expect(readHeartSettings().hrProfile.hrMaxOverride).toBe(186);
  });

  it('draws the zones as one bar with their bpm edges, the unit stated once', async () => {
    at('/settings/heart');
    await screen.findByText('Share of maximum');
    const bar = document.querySelector<HTMLElement>('.settings-zbar')!;
    expect(bar).toHaveAttribute('aria-hidden', 'true');
    expect([...bar.querySelectorAll('.settings-zbar__ticks > span')].map((t) => t.textContent)).toEqual(['90', '108', '126', '144', '162', '180']);
    expect(bar.querySelectorAll('.settings-zbar__track > span')).toHaveLength(5);
    expect(within(bar).getAllByText(/bpm/)).toHaveLength(1);
  });
});
