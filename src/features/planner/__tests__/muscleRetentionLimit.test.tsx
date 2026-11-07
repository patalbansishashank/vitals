import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ConstraintDraft } from '@/state/plannerStore';
import { LimitsPanel } from '../components/LimitsPanel';
import { defaultConstraints, toPracticalConstraints } from '../request';

function Limits({ onChange }: { onChange?: (patch: Partial<ConstraintDraft>) => void } = {}) {
  const [c, setC] = useState(defaultConstraints({}));
  return (
    <LimitsPanel
      c={c}
      customised={false}
      safetyMaxFastH={24}
      onChange={(patch: Partial<ConstraintDraft>) => {
        onChange?.(patch);
        setC((old) => ({ ...old, ...patch }));
      }}
    />
  );
}
describe('modeled whole-plan muscle-loss limit', () => {
  it('is opt-in, enables a 5% budget and can be explicitly disabled', async () => {
    const user = userEvent.setup();
    render(<Limits />);
    const toggle = screen.getByRole('switch', { name: 'Limit modeled muscle loss' });
    expect(toggle).not.toBeChecked();
    expect(screen.queryByRole('slider', { name: 'Whole-plan loss budget' })).toBeNull();
    await user.click(toggle);
    expect(toggle).toBeChecked();
    expect(screen.getByRole('slider', { name: 'Whole-plan loss budget' })).toHaveValue('5');
    await user.click(toggle);
    expect(screen.queryByRole('slider', { name: 'Whole-plan loss budget' })).toBeNull();
  });

  it('lets a short cardio cap coexist with longer lifting sessions', async () => {
    const user = userEvent.setup();
    render(<Limits />);
    const cardio = screen.getByRole('spinbutton', { name: 'longest cardio session' });
    await user.clear(cardio);
    await user.type(cardio, '15{Enter}');
    expect(cardio).toHaveAttribute('aria-valuenow', '15');
    expect(screen.getByRole('spinbutton', { name: 'longest session' })).toHaveAttribute('aria-valuenow', '75');
  });

  it('lets the user select 2% and then 5% without resetting the chosen budget', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Limits onChange={onChange} />);
    await user.click(screen.getByRole('switch', { name: 'Limit modeled muscle loss' }));
    const slider = screen.getByRole('slider', { name: 'Whole-plan loss budget' });
    slider.focus();
    await user.keyboard('{ArrowLeft>6/}');
    expect(slider).toHaveValue('2');
    expect(onChange).toHaveBeenLastCalledWith({ maxMuscleLossPct: 2 });
    expect(toPracticalConstraints({ ...defaultConstraints({}), ...onChange.mock.lastCall![0] }).muscleRetention).toEqual({ maxLossPct: 2 });
    await user.keyboard('{ArrowRight>6/}');
    expect(slider).toHaveValue('5');
    expect(onChange).toHaveBeenLastCalledWith({ maxMuscleLossPct: 5 });
  });

  it('passes the chosen budget and explicit disabling to the engine without adding a default for other users', () => {
    const c = defaultConstraints({});
    expect(toPracticalConstraints(c).muscleRetention).toBeUndefined();
    expect(toPracticalConstraints({ ...c, maxMuscleLossPct: 5 }).muscleRetention).toEqual({ maxLossPct: 5 });
    expect(toPracticalConstraints({ ...c, maxMuscleLossPct: null }).muscleRetention).toBeNull();
    expect(toPracticalConstraints({ ...c, maxSessionMin: 60, maxCardioSessionMin: 15 })).toMatchObject({ maxSessionMin: 60, maxCardioSessionMin: 15 });
  });
});
