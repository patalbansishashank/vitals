// Review V2 (V1c "for other areas"): the drift cause sentence comes from the data layer in kcal; in kJ mode it reads kJ.
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
  causes: [{ cause: 'expenditure', share: 0.8, text: 'Your body is burning about 200 kcal a day less than assumed; the plan has been updated.' }],
  action: 'keepGoing',
  text: '',
  label: 'Body weight',
} as unknown as DriftCard;

describe('drift cause in the energy unit', () => {
  it('shows kJ in kJ mode', () => {
    act(() => useSettingsStore.getState().set({ energyUnit: 'kJ' }));
    const { container } = render(<DriftGoalCard card={card} onAction={() => {}} />);
    expect(container.textContent).toMatch(/kJ/);
    expect(container.textContent).not.toMatch(/kcal/);
  });
});
