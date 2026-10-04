import type { ComponentType } from 'react';
import { screen } from '@testing-library/react';
import { renderLiving } from '../testing';
import TodayPage from '../today/TodayPage';
import FoodPage from '../food/FoodPage';
import TrainPage from '../train/TrainPage';
import CoachPage from '../coach/CoachPage';
import ProgressPage from '../progress/ProgressPage';
import PlanDetailsPage from '../plan/PlanDetailsPage';

window.scrollTo = (() => undefined) as typeof window.scrollTo;

/** Emulate a viewport for `useMediaQuery` (jsdom has no layout): width in px. */
function viewport(width: number) {
  const em = 16;
  window.matchMedia = ((query: string) => {
    const min = /min-width:\s*([\d.]+)(rem|px)/.exec(query);
    const max = /max-width:\s*([\d.]+)(rem|px)/.exec(query);
    const px = (m: RegExpExecArray) => Number(m[1]) * (m[2] === 'rem' ? em : 1);
    const matches = (!min || width >= px(min)) && (!max || width <= px(max)) && !/pointer: coarse/.test(query);
    return { matches, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
}

const original = window.matchMedia;
afterEach(() => {
  window.matchMedia = original;
});

const screens: Array<[string, ComponentType, string, string]> = [
  ['Today', TodayPage, '/today', 'today'],
  ['Today (past date)', TodayPage, '/today/2026-09-30', 'today/:date'],
  ['Food', FoodPage, '/food', 'food'],
  ['Train', TrainPage, '/train/2026-09-30', 'train/:date'],
  ['Coach', CoachPage, '/coach', 'coach'],
  ['Progress', ProgressPage, '/progress', 'progress'],
  ['Plan details', PlanDetailsPage, '/plan/active', 'plan/active'],
];

describe.each([
  ['mobile 375', 375],
  ['desktop 1440', 1440],
])('Living screens render at %s', (_label, width) => {
  it.each(screens)('%s', async (_name, Page, path, route) => {
    viewport(width);
    renderLiving(<Page />, { path, route });
    const h1s = await screen.findAllByRole('heading', { level: 1 }, { timeout: 4000 });
    expect(h1s).toHaveLength(1);
    // no yellow keys on Living screens (COMPONENTS §13 shared rules): no signal keys, no Run key
    expect(document.querySelector('[data-variant="signal"], .lm-runkey')).toBeNull();
  });
});
