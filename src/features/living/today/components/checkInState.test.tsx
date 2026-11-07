/**
 * W3 living surfaces (C6 inline grammar): the check-in's one state word (D5-06), the trend as its estimate range
 * (D5-02/D5-04), the correction at its controller bound (D5-03), recorded days as coverage (D5-08), a macro whose
 * coverage lags the day's energy (D6-02/D6-03), and a weigh-in whose context is the person's answer, never assumed
 * "morning, fasted" (D5-04).
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { statusValue } from '@/lib/bodyContracts';
import { renderLiving } from '../../testing';
import { correctionText } from '../../progress/components/DriftGoalCard';
import { recordedDaysText } from '../../progress/sections/AdherenceSection';
import { macroLags } from '../../food/components/TargetsFace';
import { checkInStateWord, energyAvailabilityText, trendRangeText, wellbeingText } from './CheckInSheet';
import { WeighSheet } from './WeighSheet';
import { FIXTURE_TODAY } from '../../data/fixtures';

window.scrollTo = (() => undefined) as typeof window.scrollTo;

describe('check-in and trend words', () => {
  it('one state word: change ready, check-in ready or estimate updated (D5-06)', () => {
    expect(checkInStateWord({ due: true, proposal: true })).toBe('Change ready');
    expect(checkInStateWord({ due: true, proposal: false })).toBe('Check-in ready');
    expect(checkInStateWord({ due: false, proposal: false })).toBe('Estimate updated');
    // a review (changed screening, blocked status or an entered concern) outranks the routine words; a proposal stays first
    expect(checkInStateWord({ due: true, proposal: false, review: true })).toBe('Review');
    expect(checkInStateWord({ due: true, proposal: true, review: true })).toBe('Change ready');
    // a version that took effect since the last check-in, with nothing due
    expect(checkInStateWord({ due: false, proposal: false, planChanged: true })).toBe('Plan changed');
    expect(checkInStateWord({ due: true, proposal: false, planChanged: true })).toBe('Check-in ready');
  });

  it('energy availability is a value in kcal/kg FFM/day, a lower bound, or Incomplete; never a verdict (D4-04/D8-04)', () => {
    const t = (x: string | null) => x?.replace(/[\u2009\u202f\u00a0]/g, ' ') ?? null;
    expect(energyAvailabilityText(null)).toBeNull();
    expect(energyAvailabilityText({ status: 'unknown', covered: 0, days: 0 })).toBeNull();
    expect(t(energyAvailabilityText({ status: 'estimated', value: 32.4, covered: 7, days: 7 }))).toBe('energy availability 32 kcal/kg FFM/day');
    expect(t(energyAvailabilityText({ status: 'scenario', value: 32.4, covered: 7, days: 7 }))).toBe('energy availability 32 kcal/kg FFM/day · Scenario');
    expect(t(energyAvailabilityText({ status: 'partial', lowerBound: 27.6, covered: 5, days: 7 }))).toBe('energy availability ≥ 28 kcal/kg FFM/day · Partial');
    expect(energyAvailabilityText({ status: 'unknown', covered: 3, days: 7 })).toBe('energy availability Incomplete');
    // quiet mode: no number
    expect(energyAvailabilityText({ status: 'estimated', value: 32.4, covered: 7, days: 7 }, true)).toBeNull();
    expect(energyAvailabilityText({ status: 'unknown', covered: 3, days: 7 }, true)).toBe('energy availability Incomplete');
  });

  it('wellbeing reads entered ratings only: hunger 0–10 and the concern word (D2-06/D8-09)', () => {
    expect(wellbeingText(null)).toBeNull();
    expect(wellbeingText({ status: 'unknown', hunger: null })).toBeNull();
    expect(wellbeingText({ status: 'noFlag', hunger: 6 })).toBe('hunger 6/10 · No flagged concern');
    expect(wellbeingText({ status: 'review', hunger: null })).toBe('Review');
    expect(wellbeingText({ status: 'noFlag', hunger: 6 }, true)).toBe('No flagged concern');
    expect(wellbeingText({ status: 'noFlag', hunger: null, mood: 7 })).toBe('mood 7/10 · No flagged concern');
  });

  it('the trend reads as its 10th–90th percentile range when the filter gives its SD, else the value', () => {
    expect(trendRangeText(88.7, 0.25).replace(/[\u2009\u202f\u00a0]/g, ' ')).toBe('88.4–89.0');
    expect(trendRangeText(88.7, null)).toBe('88.7');
  });

  it('a correction held at its controller bound reads "correction at limit" (D5-03)', () => {
    const at = statusValue({ status: 'estimated', value: 300, range: [220, 380], unit: 'kcal/day', uncertaintyKind: 'conditionalResidual', reasonCode: 'correctionAtLimit' });
    expect(correctionText(at)).toBe('correction at limit');
    const free = statusValue({ status: 'estimated', value: 120, unit: 'kcal/day', reasonCode: 'balanceModelResidual' });
    expect(correctionText(free)).toBe('correction +120 kcal/day');
  });

  it('recorded days are coverage over the last week (D5-08)', () => {
    expect(recordedDaysText(4)).toBe('recorded 4/7 days');
    expect(recordedDaysText(9)).toBe('recorded 7/7 days');
  });

  it('a macro lagging the day’s energy coverage is partial; without a coverage map nothing is claimed (D6-02/D6-03)', () => {
    expect(macroLags({ energy: 'complete', protein: 'partial' }, 'protein')).toBe(true);
    expect(macroLags({ energy: 'partial', protein: 'partial' }, 'protein')).toBe(false);
    expect(macroLags({ energy: 'complete' }, 'fat')).toBe(true);
    expect(macroLags(undefined, 'protein')).toBe(false);
  });
});

describe('weigh-in context (C4/D5-04)', () => {
  it('an unanswered context is unknown; a stated one is sent as stated', async () => {
    const user = userEvent.setup();
    const h = renderLiving(<WeighSheet open date={FIXTURE_TODAY} lastKg={88} onClose={() => undefined} />, { path: '/x', route: 'x' });
    const log = vi.spyOn(h.stub.actions, 'logMeasurement');
    const weight = vi.spyOn(h.stub.actions, 'logWeight');
    const sheet = await screen.findByRole('dialog');
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(log).toHaveBeenCalledTimes(1));
    expect(log.mock.calls[0]![1]).toEqual({ metric: 'weightKg', value: 88, method: 'scale' });
    expect(weight).not.toHaveBeenCalled();
  });

  it('"On waking" is sent as the morning context', async () => {
    const user = userEvent.setup();
    const h = renderLiving(<WeighSheet open date={FIXTURE_TODAY} lastKg={88} onClose={() => undefined} />, { path: '/x', route: 'x' });
    const log = vi.spyOn(h.stub.actions, 'logMeasurement');
    const sheet = await screen.findByRole('dialog');
    await user.click(within(sheet).getByRole('radio', { name: 'On waking' }));
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(log).toHaveBeenCalledTimes(1));
    expect(log.mock.calls[0]![1]).toMatchObject({ context: 'morningFasted' });
  });
});
