// V1h: the safety limits and the plan locks state energy in the person's unit (they stayed in kcal in kJ mode).
import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '@/state/settingsStore';
import { LimitsList } from '../Disclaimer';
import { lockLines } from '../SafetySummary';
import type { PlannerLock } from '../safetyRules';

afterEach(() => act(() => useSettingsStore.getState().set({ energyUnit: 'kcal' })));

describe('safety limits in kJ', () => {
  it('the limits list converts every kcal figure', () => {
    act(() => useSettingsStore.getState().set({ energyUnit: 'kJ' }));
    const { container } = render(<MemoryRouter><LimitsList /></MemoryRouter>);
    expect(container.textContent).not.toMatch(/kcal/);
    expect(container.textContent).toMatch(/3[\s\u2009\u202f]?350[\s\u2009\u202f]?kJ/); // 800 kcal
  });

  it('lock lines take the unit', () => {
    const lock = { id: 'no-vled' } as unknown as PlannerLock;
    expect(lockLines([lock])[0]).toMatch(/800.kcal/);
    expect(lockLines([lock], 'kJ')[0]).toMatch(/3.350.kJ/);
  });
});
