/**
 * r063 FX3 (sR10/aR10): quiet mode is words only on every Ring detail page a quiet card opens, assistive technology
 * included — each signal (heart rate, HRV, blood oxygen, stress, skin temperature) over a day and over a period with its
 * reference card, the Measure key's answer, one workout, and the short-video page. Calendar dates in titles stay (they
 * are not health figures, as on every date strip).
 */
import './clock';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '@/app/App';
import { freshState } from '@/commands/__tests__/harness';
import { dispatch } from '@/commands/bus';
import { resetActivePlan } from '@/features/living/activePlan';
import { fmtDay } from '@/features/living/format';
import { expectWordsOnly } from '@/features/living/__tests__/wordsOnly';
import { createGaugeCommandsController } from '@/state/gaugeCommands';
import { useProfileStore } from '@/state/profileStore';
import type { LocalDate } from '@/living';
import { setGaugeApi } from '../api';
import { makeCommandsFixture, setRingCommands } from '../commands';
import { makeGaugeFixture } from '../fixtures';
import { calendarDate, shiftDate, METRIC_ORDER } from '../model';
import { resetRingMonitorCache } from '../monitor/store';
import { setRingActivitySource } from '../useActivities';

window.scrollTo = (() => undefined) as typeof window.scrollTo;
vi.setConfig({ testTimeout: 30_000 });

beforeAll(async () => {
  await import('@/commands');
  await import('../RingPage');
}, 120_000);

const today = calendarDate(Date.now());
const page = () => document.querySelector<HTMLElement>('.rg-page')!;
const header = () => document.querySelector<HTMLElement>('.lm-ctx-slot');
const commands = () =>
  createGaugeCommandsController({ api: makeCommandsFixture({ delayMs: 5 }), local: { probe: async () => false, run: async () => ({ kind: 'fallback' }) } });

function renderAt(path: string) {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />);
}

describe('quiet mode on the Ring detail pages (r063 FX3)', () => {
  beforeEach(async () => {
    freshState({ cleared: true });
    resetActivePlan();
    resetRingMonitorCache();
    useProfileStore.getState().setAge(36);
    setGaugeApi(makeGaugeFixture({ uploadedMinutesAgo: 4 }));
    setRingCommands(commands());
    await dispatch('settings.update', { patch: { quietMode: true } });
  });
  afterEach(() => {
    setGaugeApi(null);
    setRingCommands(null);
    setRingActivitySource(null);
  });

  for (const kind of METRIC_ORDER) {
    it(`${kind}: the day, a period and the reference card carry no digits (aria too)`, async () => {
      renderAt(`/ring/signals/${kind}`);
      await waitFor(() => expect(page().querySelector('.rg-detail__reading, .rg-none')).not.toBeNull(), { timeout: 8000 });
      // (r068) the words' ranges and the usual night sit in the one card now: wait for them (or the dial) before the check
      await waitFor(() => expect(page().querySelector('.lmz-scale')).not.toBeNull(), { timeout: 5000 });
      expectWordsOnly(page(), `${kind} day`, [fmtDay(today as LocalDate)]);
      if (header()) expectWordsOnly(header()!, `${kind} header`);
      fireEvent.click(screen.getByRole('radio', { name: 'Week' }));
      await waitFor(() => expect(page().querySelector('.lmv-skeleton, [aria-busy="true"]')).toBeNull(), { timeout: 5000 });
      await screen.findByText('The past week');
      expectWordsOnly(page(), `${kind} week`);
    });
  }

  it('the Measure key’s answer is a word, never the bpm', async () => {
    renderAt('/ring/signals/hr');
    const key = await screen.findByRole('button', { name: 'Measure now' }, { timeout: 8000 });
    fireEvent.click(key);
    await waitFor(() => expect(document.querySelector('.rg-measure__words')!.textContent).toMatch(/^Measured/), { timeout: 5000 });
    expectWordsOnly(document.querySelector('.rg-measure')!, 'measure');
  });

  it('one workout: summary, route and heart rate carry no digits (aria too)', async () => {
    const api = makeGaugeFixture();
    const w = (await api.workouts(shiftDate(today, -6), today))!.sessions.find((s) => s.type === 'run')!;
    renderAt(`/ring/workouts/${w.id}?date=${w.date}`);
    await screen.findByRole('list', { name: 'Heart-rate zones' }, { timeout: 8000 });
    expectWordsOnly(page(), 'workout', [fmtDay(w.date as LocalDate)]);
  });

  it('the short-video page carries no digits outside the limit editor’s own fields', async () => {
    renderAt('/ring/short-videos');
    await waitFor(() => expect(page().querySelector('.rgv-day, .rg-none')).not.toBeNull(), { timeout: 8000 });
    expectWordsOnly(page(), 'short videos', [fmtDay(today as LocalDate)]);
  });
});
