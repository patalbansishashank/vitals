/**
 * C6/D5-02: the weekly check-in is a decision the person confirms. The header is Cancel · title · Check in; closing or
 * cancelling never records it; only the verb does, once. No cause inferred from the logs is shown.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import TodayPage from '../TodayPage';
import { renderLiving } from '../../testing';
import { statusValue } from '@/lib/bodyContracts';
import { CHECK_IN_VERB, driftWord, foodDaysText, goalDateLine } from './CheckInSheet';
import { correctionText } from '../../progress/components/DriftGoalCard';

window.scrollTo = (() => undefined) as typeof window.scrollTo;

describe('Weekly check-in sheet', () => {
  it('cancelling never confirms; the header verb confirms once', async () => {
    const user = userEvent.setup();
    const h = renderLiving(<TodayPage />, { path: '/today', route: 'today' });
    const checkIn = vi.spyOn(h.stub.actions, 'checkIn');
    await user.click(await screen.findByRole('button', { name: 'Weekly check-in ready' }));
    let sheet = await screen.findByRole('dialog', { name: 'Weekly check-in' });
    await within(sheet).findByRole('heading', { name: 'This week' });
    expect(within(sheet).queryByText(/Mostly adherence/)).toBeNull();
    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Weekly check-in' })).not.toBeInTheDocument());
    expect(checkIn).not.toHaveBeenCalled();

    await user.click(await screen.findByRole('button', { name: 'Weekly check-in ready' }));
    sheet = await screen.findByRole('dialog', { name: 'Weekly check-in' });
    await user.click(within(sheet).getByRole('button', { name: CHECK_IN_VERB }));
    expect(checkIn).toHaveBeenCalledTimes(1);
  });

  it('an unclear drift reads "unclear", never on track', () => {
    expect(driftWord('onTrack', 'unclear')).toBe('unclear');
    expect(driftWord('onTrack')).toBe('on track');
  });

  it('the goal date is a plain range; complete food days and the correction are facts, never a cause (C6, D5-01, D5-02)', () => {
    expect(goalDateLine('21–30 Dec')).toBe('Goal date 21–30 Dec');
    expect(goalDateLine('21–30 Dec')).not.toMatch(/likely/);
    expect(foodDaysText({ kcalPerDay: 120, quantDays: 3, daysInWindow: 7 })).toBe('complete food days 3/7');
    expect(foodDaysText(null)).toBeNull();
    expect(foodDaysText({ kcalPerDay: 0, quantDays: 0, daysInWindow: 0 })).toBeNull();
    expect(correctionText(statusValue({ status: 'estimated', value: 120, range: [40, 200], unit: 'kcal/day', uncertaintyKind: 'conditionalResidual' }))).toBe('correction +40 to +200 kcal/day');
    // a residual the provider marks unknown (no confirmed check-in yet) is not shown
    expect(correctionText(statusValue({ status: 'unknown', unit: 'kcal/day', reasonCode: 'noConfirmedCheckIn' }))).toBeNull();
  });
});
