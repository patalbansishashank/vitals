/**
 * Shared set-up of the Ring screen tests (r071: `screens.test.tsx` was split by area, one file per page group, so each
 * file can change with its own cards). `setupScreens()` registers the file-level hooks, `ringHooks()` the fixture and
 * command set-up every `describe` starts from.
 */
import './clock';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { screen } from '@testing-library/react';
import { routes } from '@/app/App';
import { freshState } from '@/commands/__tests__/harness';
import { resetActivePlan } from '@/features/living/activePlan';
import { resetSleepEntries } from '@/features/living/sleep/entry';
import { createGaugeCommandsController } from '@/state/gaugeCommands';
import { setGaugeApi } from '../api';
import { makeCommandsFixture, setRingCommands } from '../commands';
import { makeGaugeFixture } from '../fixtures';
import { setRingActivitySource } from '../useActivities';
import { calendarDate } from '../model';
import { resetRingMonitorCache } from '../monitor/store';
import type { RingApi } from '../types';

/** The file-level set-up: jsdom has no scrollTo, and the app's routes and pages load lazily (the first render waits for them). */
export function setupScreens(): void {
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
  beforeAll(async () => {
    await import('@/commands');
    await import('../RingPage');
    await import('@/features/living/sleep/SleepPage');
  }, 120_000);
  vi.setConfig({ testTimeout: 30_000 });
}

export function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

export const header = () => document.querySelector<HTMLElement>('.lm-ctx-slot')!;
export const today = calendarDate(Date.now());
export const card = (name: string | RegExp) => screen.getByRole('heading', { level: 2, name }).closest('section')!;

/** An empty server: it answers, but Gauge never uploaded. */
export function emptyServer(): RingApi {
  const base = makeGaugeFixture();
  return {
    ...base,
    availability: async () => ({
      ...(await base.availability())!,
      categories: [],
      shortVideoDays: 0,
      workoutSessions: 0,
    }),
  };
}

export const commands = (o: Parameters<typeof makeCommandsFixture>[0] = {}) =>
  createGaugeCommandsController({
    api: makeCommandsFixture({ delayMs: 5, ...o }),
    local: { probe: async () => false, run: async () => ({ kind: 'fallback' }) },
  });

/** The hooks every Ring screens `describe` starts from: a cleared first run, the demo Gauge fixture, the command fixture. */
export function ringHooks(): void {
  beforeEach(() => {
    freshState({ cleared: true });
    resetActivePlan();
    resetSleepEntries();
    resetRingMonitorCache();
    setGaugeApi(makeGaugeFixture({ uploadedMinutesAgo: 4 }));
    setRingCommands(commands());
  });
  afterEach(() => {
    setGaugeApi(null);
    setRingCommands(null);
    setRingActivitySource(null);
  });
}

/** No digit in the element's text, its accessible names and descriptions, or its values. */
export function expectWordsOnly(el: HTMLElement): void {
  const text = el.textContent ?? '';
  expect(text, `${el.querySelector('h2')?.textContent}: ${text}`).not.toMatch(/\d/);
  for (const node of [el, ...el.querySelectorAll('*')]) {
    for (const attr of ['aria-label', 'aria-valuetext', 'aria-valuenow', 'aria-description', 'title', 'alt']) {
      const v = node.getAttribute(attr);
      if (v) expect(v, `${el.querySelector('h2')?.textContent} [${attr}]`).not.toMatch(/\d/);
    }
  }
}
