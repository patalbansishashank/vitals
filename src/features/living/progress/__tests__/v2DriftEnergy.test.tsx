// Review V2 (V1c "for other areas"): the drift card's energy number comes from the data layer in kcal; in kJ mode it reads
// kJ. Since D5-02 that number is the labelled balance/model correction (`residual`, kcal/day); causes are never shown.
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '@/state/settingsStore';
import { DriftGoalCard } from '../components/DriftGoalCard';
import type { DriftCard } from '../../data/types';

afterEach(() => act(() => useSettingsStore.getState().set({ energyUnit: 'kcal' })));

const card = {
  goal: 'g1',
  metric: 'scaleWeight',
  state: 'behind',
  goalDate: { range: ['2026-12-01', '2026-12-20'], shiftDays: null, shiftSd: null },
  causes: [],
  residual: { status: 'estimated', value: -200, range: [-260, -140], unit: 'kcal/day', uncertaintyKind: 'conditionalResidual', coverageStatus: 'unvalidated', reasonCode: 'balanceModelResidual' },
  action: 'keepGoing',
  text: '',
  label: 'Body weight',
} as unknown as DriftCard;

describe('drift correction in the energy unit', () => {
  it('shows kJ in kJ mode', () => {
    act(() => useSettingsStore.getState().set({ energyUnit: 'kJ' }));
    const { container } = render(<DriftGoalCard card={card} onAction={() => {}} />);
    expect(container.textContent).toMatch(/correction −1,090 to −590 kJ\/day/);
    expect(container.textContent).not.toMatch(/kcal/);
  });
  it('shows kcal in kcal mode', () => {
    const { container } = render(<DriftGoalCard card={card} onAction={() => {}} />);
    expect(container.textContent).toMatch(/correction −260 to −140 kcal\/day/);
  });
});
