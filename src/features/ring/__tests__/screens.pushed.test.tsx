/** Signal and workout details use the shared r071 pictures and keep the raw tables in (i). */
import './clock';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useProfileStore } from '@/state/profileStore';
import { dispatch } from '@/commands/bus';
import { makeGaugeFixture } from '../fixtures';
import { shiftDate } from '../model';
import { ringHooks, setupScreens, renderAt, today, expectWordsOnly } from './screenKit';
import { act } from '@testing-library/react';
import { resetGaugeEngineStoreForTests, startGaugeEngine, type EngineReadings } from '@/state/gaugeEngine';
import { baseState, fakeEngine } from '../engine/__tests__/fakeEngine';

setupScreens();

describe('Ring screens: pushed', () => {
  ringHooks();

  it('a workout: a duration or distance hero, one zone stack and exact rows, with the method and tables in (i)', async () => {
    useProfileStore.getState().setAge(36);
    const api = makeGaugeFixture();
    const w = (await api.workouts(shiftDate(today, -6), today))!.sessions.find((s) => s.type === 'run')!;
    renderAt(`/ring/workouts/${w.id}?date=${w.date}`);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Run' }, { timeout: 8000 }),
    ).toBeInTheDocument();
    const zones = await screen.findByRole('list', { name: 'Heart-rate zones' }, { timeout: 5000 });
    expect(within(zones).getAllByRole('listitem')[0]!.textContent).toMatch(/^Zone \d · \d+–\d+ bpm/);
    expect(screen.queryByRole('img', { name: /^Zones over time:/ })).toBeNull();
    expect(screen.getByRole('img', { name: /^Heart-rate zones:/ })).toBeInTheDocument();
    expect(screen.queryByText(/^Phone \(legacy, 220 − age\)/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'About Heart rate' }));
    expect(await screen.findByText(/^Phone \(legacy, 220 − age\)/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Heart rate during the workout table' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Heart-rate zones table' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Route of 48 GPS points/ })).toBeInTheDocument();
  });

  it('quiet mode: workout zones, shares and route carry no digits', async () => {
    useProfileStore.getState().setAge(36);
    await dispatch('settings.update', { patch: { quietMode: true } });
    const api = makeGaugeFixture();
    const w = (await api.workouts(shiftDate(today, -6), today))!.sessions.find((s) => s.type === 'run')!;
    renderAt(`/ring/workouts/${w.id}?date=${w.date}`);
    const zones = await screen.findByRole('list', { name: 'Heart-rate zones' }, { timeout: 8000 });
    expect(within(zones).getAllByRole('listitem')[0]!.textContent).toMatch(
      /^(Very light|Light|Moderate|Hard|Maximum) zone/,
    );
    expectWordsOnly(zones);
    expectWordsOnly(screen.getByRole('img', { name: /^Heart-rate zones:/ }));
    expect(screen.getByRole('img', { name: /^Route,/ }).getAttribute('aria-label')).not.toMatch(/\d/);
  });

  it('Stress: latest ring-index hero, range scale, discrete readings and supported time', async () => {
    renderAt('/ring/signals/stress');
    const scale = await screen.findByRole('meter', { name: 'Stress' }, { timeout: 8000 });
    await waitFor(() => expect(scale.getAttribute('aria-valuetext')).toMatch(/ring index/));
    expect(await screen.findByRole('img', { name: /^Latest Stress .*ring index/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Stress on / })).toHaveAttribute(
      'aria-label',
      expect.stringContaining('uncovered time'),
    );
    expect(document.querySelector('.rg-stress__plot path')).toBeNull();
    expect(screen.getByRole('img', { name: /^Stress on / })).toBeInTheDocument();
    expect(screen.getByText(/elevated( or high)?$/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'About Stress' }));
    expect(await screen.findByText(/not a clinical measure/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /^Stress on .* table$/ })).toBeInTheDocument();
  });

  it('HRV: latest and overnight readings are named separately; periods show daily means as bars', async () => {
    renderAt('/ring/signals/hrv');
    const scale = await screen.findByRole('meter', { name: 'HRV' }, { timeout: 8000 });
    await waitFor(() => expect(scale.getAttribute('aria-valuetext')).toMatch(/milliseconds/));
    expect(await screen.findByText('Overnight 70 ms')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Latest HRV / })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Week' }));
    expect(await screen.findByRole('img', { name: /^HRV, daily mean, 7 days:/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Average HRV / })).toBeInTheDocument();
    expect(screen.getByText(/^Avg per day · \d of 7 days$/)).toBeInTheDocument();
  });

  it('a heart-rate page leads with the phone\'s newer reading; its lowest and highest stay the server\'s', async () => {
    const f = fakeEngine();
    startGaugeEngine({ plugin: () => f.plugin, credentials: () => null, onPairing: () => () => undefined, visible: () => true });
    try {
      renderAt('/ring/signals/hr');
      await screen.findByRole('img', { name: /^Heart rate on / }, { timeout: 8000 });
      const readings: EngineReadings = { latestHr: { bpm: 199, at: new Date(Date.now() + 1000).toISOString() } };
      act(() => f.set({ ...baseState(), ...readings }));
      await waitFor(() => expect(screen.getByRole('meter', { name: 'Heart rate' }).getAttribute('aria-valuetext')).toMatch(/\b199 beats per minute/));
      fireEvent.click(screen.getByRole('button', { name: 'About Heart rate' }));
      const highest = (await screen.findByText('Highest reading')).parentElement!;
      expect(highest.textContent).toMatch(/Highest reading.*bpm/);
      expect(highest.textContent).not.toMatch(/199/);
    } finally {
      resetGaugeEngineStoreForTests();
    }
  });

  it('a heart-rate page keeps Measure now and puts its fixed bands in (i)', async () => {
    renderAt('/ring/signals/hr');
    expect(
      await screen.findByRole('img', { name: /^Heart rate on / }, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Measure now' })).toBeInTheDocument();
    const scale = screen.getByRole('meter', { name: 'Heart rate' });
    expect(scale.getAttribute('aria-valuetext')).toMatch(/beats per minute/);
    fireEvent.click(screen.getByRole('button', { name: 'About Heart rate' }));
    expect(await screen.findByText(/Normal: 50–89 bpm/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /^Heart rate on .* table$/ })).toBeInTheDocument();
  });
});
