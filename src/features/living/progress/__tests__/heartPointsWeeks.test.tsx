/**
 * r087 C3: Progress's Heart Points asked for its 8 weeks as one window and showed nothing until all of it had loaded
 * (about 55 timelines). Each week is now its own window: the current week (the one Today's card reads) shows first, the
 * older weeks fill in as they arrive, and the numbers are the ones the single window gave.
 */
import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { addDays } from '@/living/dates';
import { useSettingsStore } from '@/state/settingsStore';
import { FIXTURE_TODAY } from '../../data/fixtures';
import { renderLiving } from '../../testing';
import { demoActuals } from '../__fixtures__/activity';
import { pointsWeeks, weekStarts } from '../activityModel';
import { HeartPointsSection } from '../sections/HeartPointsSection';
import { setProgressActuals } from '../v3Adapter';

afterEach(() => {
  cleanup();
  setProgressActuals(null);
});

/** The weeks drawn: a week without an answer (or without coverage) has no bar. */
const drawn = () => document.querySelectorAll('.lv-lane__bar').length;

it('shows the current week at once and fills in the older weeks; a week is whole or absent', async () => {
  const weekStart = useSettingsStore.getState().weekStart;
  const starts = weekStarts(FIXTURE_TODAY, 8, weekStart);
  const all = demoActuals(FIXTURE_TODAY, 120);
  const asked: string[] = [];
  let loaded = 1;
  const install = () =>
    setProgressActuals({
      progressActuals: (from, to) => {
        asked.push(`${from}:${to}`);
        // the newest `loaded` weeks have arrived; an older week is still loading
        const i = starts.indexOf(from);
        return i >= starts.length - loaded ? all.filter((a) => a.date >= from && a.date <= to) : null;
      },
    });
  install();
  renderLiving(<HeartPointsSection today={FIXTURE_TODAY} quiet={false} />);
  await screen.findByRole('heading', { level: 2, name: 'Heart Points' });
  // one window per week, the current week first; the current week ends today, a past week on its seventh day
  expect(asked.slice(0, 8)).toEqual([...starts].reverse().map((s, k) => `${s}:${k === 0 ? FIXTURE_TODAY : addDays(s, 6)}`));
  const full = pointsWeeks(all, FIXTURE_TODAY, weekStart);
  const hero = () => document.querySelector('.lm-hero')!.getAttribute('aria-label');
  expect(hero()).toContain(String(Math.round(full[7]!.points!)));
  const known = (n: number) => full.slice(-n).filter((w) => w.points !== null).length;
  expect(drawn()).toBe(known(1));
  // three more weeks arrive
  loaded = 4;
  await act(async () => install());
  expect(drawn()).toBe(known(4));
  // all of them: the same weeks the single 8-week window gave
  loaded = 8;
  await act(async () => install());
  expect(known(8)).toBe(8);
  expect(drawn()).toBe(8);
  expect(hero()).toContain(String(Math.round(full[7]!.points!)));
});
