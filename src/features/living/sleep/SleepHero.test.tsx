import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { GaugeSleepMetrics, GaugeSleepSession } from '@/features/ring/types';
import { SleepHero, sleepHeroFacts, sleepHeroParts } from './SleepHero';
import { nightView, type NightView } from './model';

const metrics = (o: Partial<GaugeSleepMetrics> = {}): GaugeSleepMetrics =>
  ({
    version: 'sleep-metrics/1', K: 476, A: 21, U: 0, G: 85, tstLowerMin: 476, tstUpperMin: 476, incomplete: false, namedCoveragePct: 100, windowContinuityPct: 95,
    wasoMin: 27, wakeUps: 3, awakeningRuns: 3, leadingWakeMin: 12, onset: '2026-10-29T23:14:00+05:30', finalWake: '2026-10-30T07:37:00+05:30',
    stageMinutes: { deep: 105, light: 278, rem: 93, asleepUnspecified: 0, awake: 27, unknown: 0, gap: 0 }, trace5min: [], ...o,
  }) as unknown as GaugeSleepMetrics;

const view = (o: Partial<GaugeSleepMetrics> = {}): NightView =>
  nightView({
    session: { wakingDate: '2026-10-30', start: '2026-10-29T23:10:00+05:30', end: '2026-10-30T07:40:00+05:30', asleepMinutes: 476, minutes: { deep: 105, light: 278, rem: 93, awake: 27, unknown: 0 }, blocks: [], metrics: metrics(o) } as unknown as GaugeSleepSession,
    baselines: null,
    plan: null,
  });

describe('SleepHero (r071)', () => {
  it('the number as hours and minutes, each its own part', () => {
    expect(sleepHeroParts(476)).toEqual([{ value: 7, unit: 'h' }, { value: 56, unit: 'm' }]);
    expect(sleepHeroParts(480)).toEqual([{ value: 8, unit: 'h' }]);
    expect(sleepHeroParts(485)).toEqual([{ value: 8, unit: 'h' }, { value: '05', unit: 'm' }]);
    expect(sleepHeroParts(45)).toEqual([{ value: 45, unit: 'min' }]);
  });

  it('lg: the ring against the goal with the number inside, and when the night began and ended beside it', () => {
    render(<SleepHero v={view()} goalMin={480} size="lg" />);
    // the number sits inside the ring, which says it all to assistive technology: the number is its decoration
    expect(screen.getByRole('img', { name: '7 hours 56 minutes asleep', hidden: true })).toBeInTheDocument();
    const ring = screen.getByRole('meter', { name: 'Asleep' });
    expect(ring.getAttribute('aria-valuetext')).toMatch(/Asleep: 7 h 56, goal 8 h/);
    expect(screen.getByText('Of 8 h')).toBeInTheDocument();
    expect(screen.getByText('Fell asleep 23:14')).toBeInTheDocument();
    expect(screen.getByText('Woke 07:37')).toBeInTheDocument();
  });

  it('md and compact: one concise timing line, with the goal left to the parent card foot', () => {
    const { rerender } = render(<SleepHero v={view()} goalMin={480} size="md" />);
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.queryByText(/^Of 8 h/, { selector: '.lm-overflow__item' })).toBeNull();
    expect(screen.getByText('Fell asleep 23:14 · Woke 07:37', { selector: '.lm-overflow__item' })).toBeInTheDocument();
    rerender(<SleepHero v={view()} goalMin={480} size="compact" />);
    expect(screen.queryByText(/^Of 8 h/, { selector: '.lm-overflow__item' })).toBeNull();
    expect(screen.getByText('Fell asleep 23:14 · Woke 07:37', { selector: '.lm-overflow__item' })).toBeInTheDocument();
  });

  it('an incomplete night shows its lower bound with the range under it, never a number the ring did not see', () => {
    render(<SleepHero v={view({ tstLowerMin: 430, tstUpperMin: 460, incomplete: true })} goalMin={480} size="lg" />);
    expect(screen.getByRole('img', { name: '7 hours 10 minutes to 7 hours 40 minutes asleep', hidden: true })).toBeInTheDocument();
    expect(screen.getByText('Between 7 h 10 and 7 h 40')).toBeInTheDocument();
  });

  it('quiet: the goal in words, the times as parts of the day, no digit in the text or the names', () => {
    const { container } = render(<SleepHero v={view()} goalMin={480} size="lg" quiet />);
    expect(screen.getByRole('img', { name: 'Just short of the goal', hidden: true })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\d/);
    for (const el of container.querySelectorAll('[aria-label], [aria-valuetext]')) {
      expect(`${el.getAttribute('aria-label') ?? ''}${el.getAttribute('aria-valuetext') ?? ''}`).not.toMatch(/\d/);
    }
    expect(sleepHeroFacts(view(), true)[0]).toMatch(/^Fell asleep (in the|early|late)/);
  });
});
