import './clock';
import { render, screen, waitFor } from '@testing-library/react';
import { SleepHero } from '@/features/living/sleep/SleepHero';
import { nightView } from '@/features/living/sleep/model';
import { SignalHero } from '../components/SignalRows';
import { entryOf } from '../monitor/catalogue';
import type { GaugeRawPoint } from '../types';
import { makeGaugeFixture } from '../fixtures';
import { sleepGoalWord } from '../quiet';
import { setGaugeApi } from '../api';
import { ringHooks, today } from './screenKit';

// These regressions preserve missing data instead of drawing false certainty.
describe('Ring card clarity', () => {
  ringHooks();
  it('keeps both bounds of an incomplete night outside the radial centre', async () => {
    const api = makeGaugeFixture({ texture: 'raw', lastNight: { asleepMin: 431, lowHr: 57, hrvMs: 61 } });
    const data = await api.sleep(today, today);
    const session = data!.sessions.find(s => s.wakingDate === today)!;
    const v = nightView({ session, baselines: null, plan: null });
    expect(v.tstUpper).toBeGreaterThan(v.tstLower);
    const { container } = render(<SleepHero v={v} goalMin={480} size="lg" animate={false} />);
    const range = container.querySelector('.sl-hero__range')!;
    expect(range).toHaveTextContent(/^Between .+ and .+/);
    expect(range.closest('.lmz-radial')).toBeNull();
    expect(screen.getByRole('meter', { name: 'Asleep' }).getAttribute('aria-valuetext')).toMatch(/ to /);
  });
  it('keeps goal uncertainty in quiet mode when an incomplete night straddles the goal', () => {
    expect(sleepGoalWord(436, 480, 483)).toBe('Goal unclear');
    expect(sleepGoalWord(436, 480, 470)).toBe('Short of the goal');
    expect(sleepGoalWord(480, 480, 490)).toBe('Goal met');
  });
  it('does not join a missing interval in the overview signal spark', async () => {
    const api = makeGaugeFixture();
    const at = (minute: number) => `${today}T10:${String(minute).padStart(2, '0')}:00`;
    const provenance: GaugeRawPoint['provenance'] = 'device';
    setGaugeApi({ ...api, series: async q => ({ ...(await api.series(q))!, points: [
      { provenance, at: at(0), value: 60 }, { provenance, at: at(1), value: 61 }, { provenance, at: at(2), value: null },
      { provenance, at: at(3), value: 65 }, { provenance, at: at(4), value: 64 },
    ], count: 5 }) });
    const { container } = render(<SignalHero entry={entryOf('hr')!} value={{ reading: 64, text: '64', unit: 'bpm', chip: null, calibrating: false, age: null }} status={{ word: 'Normal', severity: 'ok' }} date={today} today={today} base={null} prefs={{ units: 'metric' }} quiet={false} />);
    await waitFor(() => expect(container.querySelectorAll('path.lmz-line__main')).toHaveLength(2));
  });
});
