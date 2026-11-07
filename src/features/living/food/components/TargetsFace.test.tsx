/**
 * C1/D5-01: the Targets card states the day's food status and offers the one optional day report; only that report makes
 * a day complete or a confirmed zero. Logged amounts stay exact.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PrescribedDaySnapshot, TodayView } from '@/living';
import { LivingActionsProvider, type LivingActions } from '../../data/actions';
import { LivingClockContext, fixedClock } from '../../clock';
import { TargetsFace } from './TargetsFace';

const rx = { energyKcal: 2000, macros: { proteinG: 150, carbG: 200, fatG: 60, fibreG: 30 } } as unknown as PrescribedDaySnapshot;
const est = (value: number) => ({ value, sd: 0 });
const totals = { energyKcal: est(600), proteinG: est(30), carbG: est(0), fatG: est(0) } as unknown as TodayView['logged']['totals'];

function renderFace(over: Partial<Parameters<typeof TargetsFace>[0]> = {}, confirmDayIntake?: LivingActions['confirmDayIntake']) {
  const actions = { confirmDayIntake } as unknown as LivingActions;
  return render(
    <LivingClockContext.Provider value={fixedClock('2026-10-02T13:00:00')}>
      <LivingActionsProvider value={actions}>
        <TargetsFace rx={rx} totals={totals} logged quiet={false} {...over} />
      </LivingActionsProvider>
    </LivingClockContext.Provider>,
  );
}

describe('TargetsFace shared intake pictures', () => {
  it('draws energy on the shared ring, with its target and remaining amount', () => {
    const { container } = renderFace();
    const energy = screen.getByRole('meter', { name: 'Energy' });
    expect(energy).toHaveAttribute('aria-valuenow', '600');
    expect(energy.getAttribute('aria-valuetext')).toMatch(/eaten 600 of 2.000 kcal, 1.400 kcal left/);
    expect(container.querySelector('.lmz-radial')).not.toBeNull();
    expect(container.querySelector('.lv-ebar')).toBeNull();
  });

  it('keeps an estimate’s range on the ring and as a readable fact', () => {
    renderFace({ totals: { ...totals, energyKcal: { value: 640, sd: 100 } } as never });
    expect(screen.getByRole('meter', { name: 'Energy' }).getAttribute('aria-valuetext')).toMatch(/about 640 of 2.000 kcal \(range 512.768\)/);
    expect(screen.getByText(/Likely 512.768/)).toBeInTheDocument();
  });

  it('a future day has an unlit ring, planned status, and no inferred zero', () => {
    renderFace({ date: '2026-10-05', logged: false, totals: { ...totals, energyKcal: est(0), proteinG: est(0) } });
    expect(screen.getByText('Planned')).toBeInTheDocument();
    const energy = screen.getByRole('meter', { name: 'Energy' });
    expect(energy).not.toHaveAttribute('aria-valuenow');
    expect(energy.getAttribute('aria-valuetext')).toMatch(/nothing logged yet/);
  });

  it('uses four tracks, states the protein floor and preserves partial coverage', () => {
    const { container } = renderFace({ coverage: { energy: 'complete', protein: 'partial', carbohydrate: 'complete', fat: 'complete' } as never });
    expect(container.querySelectorAll('[data-intake]')).toHaveLength(4);
    expect(screen.getByRole('meter', { name: 'Protein' }).getAttribute('aria-valuetext')).toMatch(/at least 30/);
    expect(container.querySelector('[data-intake="protein"]')).toHaveAttribute('data-kind', 'floor');
  });

  it('quiet mode keeps the ratio and hides all nutrient numbers and the table', () => {
    const { container } = renderFace({ quiet: true });
    expect(container.textContent).not.toMatch(/\d|kcal|protein|carbs|fat|fibre/i);
    expect(screen.getByRole('meter', { name: 'Energy' })).not.toHaveAttribute('aria-valuenow');
    expect(screen.queryByRole('meter', { name: 'Protein' })).toBeNull();
  });
});

describe('TargetsFace day food status', () => {
  it('logged food without a day report reads Partial and keeps the exact amount', () => {
    renderFace();
    expect(screen.getByText('Partial')).toBeInTheDocument();
    expect(screen.getAllByText('600').length).toBeGreaterThan(0);
  });

  it('the day report sends the attestation; "No intake" is a choice, never inferred', () => {
    const confirm = vi.fn(async () => ({ ok: true }));
    renderFace({ date: '2026-10-02' }, confirm);
    fireEvent.click(screen.getByRole('radio', { name: 'All logged' }));
    expect(confirm).toHaveBeenCalledWith('2026-10-02', 'complete');
  });

  it('no report control without a date, on a future day, or when the actions lack it', () => {
    renderFace({ date: '2026-10-05' }, vi.fn(async () => ({ ok: true })));
    expect(screen.queryByRole('radio', { name: 'All logged' })).toBeNull();
  });

  it('an attested complete day reads Complete', () => {
    renderFace({ intake: 'complete' });
    expect(screen.getByText('Complete')).toBeInTheDocument();
  });
});
