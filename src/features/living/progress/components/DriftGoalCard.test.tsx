/**
 * D5-02: the drift card states the verdict (unclear when the data cannot classify it), the goal date and at most a
 * labelled model correction — never a cause inferred from the logs or an "expenditure"/"plan updated" sentence.
 */
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { statusValue } from '@/lib/bodyContracts';
import { useSettingsStore } from '@/state/settingsStore';
import { DriftGoalCard, correctionText, type DriftCardView } from './DriftGoalCard';

afterEach(() => act(() => useSettingsStore.getState().set({ energyUnit: 'kcal' })));

const base: DriftCardView = {
  goal: 1,
  metric: 'scaleWeight',
  label: 'Body weight',
  state: 'behind',
  goalDate: { range: ['2026-12-21', '2026-12-30'], shiftDays: null, shiftSd: null },
  causes: [{ cause: 'expenditure', share: 0.8, text: 'Your body is burning about 200 kcal a day less than assumed; the plan has been updated.' }],
  action: 'keepGoing',
  text: 'Behind the forecast. Mostly adherence.',
};

describe('DriftGoalCard (D5-02)', () => {
  it('shows no causal share, no expenditure sentence and no updated-plan wording', () => {
    const { container } = render(<DriftGoalCard card={base} onAction={() => undefined} />);
    expect(screen.getByText('behind')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/burning|expenditure|plan has been updated|Mostly adherence/i);
  });

  it('reads "unclear" when the drift cannot be classified (never on track)', () => {
    render(<DriftGoalCard card={{ ...base, state: 'onTrack', certainty: 'unclear' }} onAction={() => undefined} />);
    expect(screen.getByText('unclear')).toBeInTheDocument();
    expect(screen.queryByText('on track')).toBeNull();
  });

  it('shows the model correction with its range, in the energy unit', () => {
    const residual = statusValue({ status: 'estimated', value: 120, range: [60, 180], unit: 'kcal/d', uncertaintyKind: 'conditionalResidual' });
    render(<DriftGoalCard card={{ ...base, residual }} onAction={() => undefined} />);
    expect(screen.getByText('correction +60 to +180 kcal/day')).toBeInTheDocument();
    act(() => useSettingsStore.getState().set({ energyUnit: 'kJ' }));
    expect(correctionText(residual, 'kJ')).toMatch(/kJ\/day$/);
  });

  it('a correction whose status forbids reading it is not shown', () => {
    expect(correctionText(statusValue({ status: 'unknown', unit: 'kcal/d' }))).toBeNull();
    expect(correctionText(statusValue({ status: 'estimated', value: -90, unit: 'kcal/d' }))).toBe('correction −90 kcal/day');
  });

  it('reads the goal date as a plain range, never "likely" (C6)', () => {
    const { container } = render(<DriftGoalCard card={base} onAction={() => undefined} />);
    expect(screen.getByText('goal date 21–30 Dec')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/likely|chance|%/);
  });

  it('opens what the correction is in the Explain sheet from its line (detailsRef), with nothing written on the card', async () => {
    const user = userEvent.setup();
    const residual = statusValue({ status: 'estimated', value: 120, range: [60, 180], unit: 'kcal/d', uncertaintyKind: 'conditionalResidual', detailsRef: '24-energy-balance-bias' });
    const { container } = render(
      <MemoryRouter>
        <DriftGoalCard card={{ ...base, residual }} onAction={() => undefined} />
      </MemoryRouter>,
    );
    expect(container.textContent).not.toMatch(/residual|expenditure|metabolism/i);
    await user.click(screen.getByRole('button', { name: 'correction +60 to +180 kcal/day' }));
    const sheet = await screen.findByRole('dialog', { name: 'Correction' });
    expect(within(sheet).getAllByText('Correction').length).toBeGreaterThan(0);
  });
});
