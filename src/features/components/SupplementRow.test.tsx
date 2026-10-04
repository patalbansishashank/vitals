import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SupplementRow as Row } from '@/catalogues/supplements';
import { SupplementRow } from './SupplementRow';

const creatine: Row = { supplementId: 'creatine_monohydrate', state: 'taking', dose: 5, unit: 'g', timesOfDay: ['morning'] };

function Harness({ initial, spy, ...rest }: { initial: Row; spy?: (r: Row) => void } & Partial<Parameters<typeof SupplementRow>[0]>) {
  const [row, setRow] = useState(initial);
  return (
    <SupplementRow
      {...rest}
      row={row}
      onChange={(r) => {
        spy?.(r);
        setRow(r);
      }}
    />
  );
}

describe('SupplementRow', () => {
  it('is a group named by the supplement with the dose field, unit, four time toggles and the state bank', () => {
    render(<Harness initial={creatine} />);
    const g = screen.getByRole('group', { name: 'Creatine monohydrate' });
    expect(within(g).getByRole('spinbutton', { name: 'Creatine monohydrate dose, grams' })).toHaveValue('5.0');
    expect(within(g).getByRole('combobox', { name: 'Creatine monohydrate unit' })).toBeInTheDocument();
    const times = within(g).getByRole('group', { name: 'When you take Creatine monohydrate' });
    expect(within(times).getAllByRole('button').map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false']);
    expect(within(g).getByRole('radiogroup', { name: 'Creatine monohydrate: taking' })).toBeInTheDocument();
    expect(within(g).getByText('3–5 g a day')).toBeInTheDocument();
  });

  it('toggles times of day (several allowed) and shows the daily amount', async () => {
    const spy = vi.fn();
    render(<Harness initial={creatine} spy={spy} />);
    await userEvent.click(screen.getByRole('button', { name: 'Creatine monohydrate at night' }));
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ timesOfDay: ['morning', 'night'] }));
    expect(screen.getByText('10 g a day')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Creatine monohydrate in the morning' }));
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ timesOfDay: ['night'] }));
  });

  it('have it, don’t take: hides dose and times and says the Coach may use it first; taking brings them back', async () => {
    render(<Harness initial={creatine} />);
    await userEvent.click(screen.getByRole('radio', { name: 'have it, don’t take' }));
    expect(screen.queryByRole('spinbutton')).toBeNull();
    expect(screen.getByText(/the Coach may suggest using it before buying anything/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'taking' }));
    expect(screen.getByRole('spinbutton')).toHaveValue('5.0');
    expect(screen.getByRole('button', { name: 'Creatine monohydrate in the morning' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('not for me collapses the row to name and state', async () => {
    render(<Harness initial={creatine} />);
    await userEvent.click(screen.getByRole('radio', { name: 'not for me' }));
    expect(screen.queryByRole('spinbutton')).toBeNull();
    expect(screen.getByText(/never suggested/)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Creatine monohydrate' })).toHaveAttribute('data-state', 'notForMe');
  });

  it('edits the dose and the unit; shows errors only when asked', async () => {
    const spy = vi.fn();
    const { rerender } = render(<Harness initial={{ ...creatine, timesOfDay: [] }} spy={spy} />);
    expect(screen.queryByText('Choose when you take it')).toBeNull();
    rerender(<Harness initial={{ ...creatine, timesOfDay: [] }} spy={spy} showErrors />);
    expect(screen.getByText('Choose when you take it')).toBeInTheDocument();
    const f = screen.getByRole('spinbutton', { name: /dose/ });
    await userEvent.clear(f);
    await userEvent.type(f, '3.5{Enter}');
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ dose: 3.5, unit: 'g' }));
  });

  it('warns above the upper limit without blocking', () => {
    render(<Harness initial={{ supplementId: 'vitamin_d3', state: 'taking', dose: 5000, unit: 'IU', timesOfDay: ['morning'] }} showErrors />);
    expect(screen.getByText(/above the usual upper limit of 4000 IU a day/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('free-text rows say they were added by you and can be removed', async () => {
    const onRemove = vi.fn();
    render(<Harness initial={{ supplementId: null, text: 'shilajit', state: 'onHand', timesOfDay: [] }} onRemove={onRemove} />);
    expect(screen.getByText('added by you')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove shilajit' }));
    expect(onRemove).toHaveBeenCalled();
  });

  it('today variant: dose line, Taken and Edit (turns into the edit row in place)', async () => {
    const onTaken = vi.fn();
    render(<Harness initial={{ ...creatine, timesOfDay: ['morning', 'night'] }} variant="today" onTaken={onTaken} />);
    expect(screen.getByText('5 g · morning, night')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mark Creatine monohydrate as taken today' }));
    expect(onTaken).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('spinbutton', { name: /dose/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('spinbutton')).toBeNull();
  });
});
