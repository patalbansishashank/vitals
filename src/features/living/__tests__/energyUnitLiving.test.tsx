// V1h: the daily screens honour Settings › Units › energy (kJ was ignored on Today, Food and Train).
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PrescribedDaySnapshot } from '@/living';
import { useSettingsStore } from '@/state/settingsStore';
import { EstimateReadout } from '../components/Estimate';
import { TargetsFace } from '../food/components/TargetsFace';
import { TodayDial } from '../today/components/TodayDial';

const rx = {
  energyKcal: 2000,
  macros: { proteinG: 150, carbG: 200, fatG: 60, fibreG: 30 },
  window: { startH: 9, endH: 19 },
  meals: [{ slot: 'lunch', clockH: 13, energyKcal: 600, proteinG: 45, carbG: 60, fatG: 20 }],
  sessions: [],
} as unknown as PrescribedDaySnapshot;
const totals = { energyKcal: { value: 1000, sd: 0 }, proteinG: { value: 70, sd: 0 }, carbG: { value: 90, sd: 0 }, fatG: { value: 30, sd: 0 } } as never;

const setUnit = (u: 'kcal' | 'kJ') => act(() => useSettingsStore.getState().set({ energyUnit: u }));
afterEach(() => setUnit('kcal'));

describe('energy unit on the daily screens', () => {
  it('an estimate in kcal reads in kJ when kJ is chosen, range and unit text included', () => {
    setUnit('kJ');
    const { container } = render(<EstimateReadout value={600} sd={50} unit="of 2 000 kcal" approx short />);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/kcal/);
    expect(text).toMatch(/≈ 2[\s\u2009\u202f]?510 of 8[\s\u2009\u202f]?370 kJ/);
  });

  it('kcal mode is unchanged', () => {
    const { container } = render(<EstimateReadout value={600} unit="kcal" />);
    expect(container.textContent).toMatch(/^600 kcal$/);
  });

  it('Food targets and the dial summary follow the setting', () => {
    setUnit('kJ');
    const { container } = render(
      <>
        <TargetsFace rx={rx} totals={totals} logged quiet={false} />
        <TodayDial rx={rx} nowH={10} centre={{ primary: '' }} />
      </>,
    );
    expect(container.textContent).not.toMatch(/kcal/);
    expect(screen.getByText(/^Eat 09:00/).textContent).toMatch(/2[\s\u2009\u202f]?510 kJ/);
  });
});
