import { act, configure, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '@/app/App';
import { KJ_PER_KCAL } from '@/components';
import { DEFAULTS } from '@/engine/core/defaults';
import { seedClearedSafety } from '@/features/onboarding/testing';
import { flushBodyPersistence, useProfileStore } from '@/state/profileStore';
import { useSettingsStore } from '@/state/settingsStore';

vi.setConfig({ testTimeout: 30_000 });
configure({ asyncUtilTimeout: 15_000 });

window.scrollTo = (() => undefined) as typeof window.scrollTo;
Element.prototype.scrollIntoView = function scrollIntoView() {};

const store = () => useProfileStore.getState();

beforeEach(() => {
  localStorage.clear();
  act(() => useSettingsStore.getState().set({ units: 'metric', showFigure: true, energyUnit: 'kJ' }));
  seedClearedSafety();
  act(() => {
    store().resetBody();
    store().setSex('male');
    store().setAge(36);
    store().setHeight(178);
    store().setWeight(84.9);
    store().setSetup('done');
  });
});

afterEach(() => {
  flushBodyPersistence();
  act(() => useSettingsStore.getState().set({ energyUnit: 'kcal' }));
});

describe('Your body with Settings › energy in kJ', () => {
  it('shows maintenance in kJ and the fibre density per 1 000 kJ (stored per 1 000 kcal)', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/body'] });
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { level: 1, name: 'Your body' });
    expect(screen.getAllByText('kJ/day').length).toBeGreaterThan(0);
    expect(screen.queryByText('kcal/day')).toBeNull();

    const habits = document.getElementById('body-habits') ?? document.querySelector<HTMLElement>('.lm-body-habits-face')!;
    fireEvent.click(within(habits).getByRole('button', { name: 'Edit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'advanced · optional' }));
    const unit = screen.getByText('g per 1 000 kJ');
    expect(screen.queryByText('g per 1 000 kcal')).toBeNull();
    const well = unit.closest('.lm-stepper')!.querySelector('input')!;
    expect(Number(well.value)).toBeCloseTo(Math.round((DEFAULTS.fibreGPer1000Kcal / KJ_PER_KCAL) * 10) / 10, 5);
  });
});
