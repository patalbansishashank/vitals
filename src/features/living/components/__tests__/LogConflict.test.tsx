import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from '@/components';
import { LivingActionsProvider, type LivingActions } from '../../data/actions';
import { LogConflict } from '../LogConflict';

const conflict = {
  parentId: 'original',
  kind: 'meal' as const,
  versions: [
    { id: 'newer', label: 'Rice and lentils', source: 'user', energyKcal: 350 },
    { id: 'other', label: 'Soup and bread', source: 'mcp', energyKcal: 400 },
  ],
};

function mount(retract: LivingActions['retract'], quiet = false) {
  render(
    <LivingActionsProvider value={{ retract } as unknown as LivingActions}>
      <LogConflict conflict={conflict} quiet={quiet} />
      <Toaster />
    </LivingActionsProvider>,
  );
}

it('shows both meal versions and retracts only the one the person does not keep', async () => {
  const retract = vi.fn<LivingActions['retract']>().mockResolvedValue({ ok: true });
  mount(retract);
  expect(screen.getByText('This meal was changed on two devices. Keep which one?')).toBeInTheDocument();
  expect(screen.getByText('Rice and lentils')).toBeInTheDocument();
  expect(screen.getByText('Soup and bread')).toBeInTheDocument();
  expect(screen.getByText('2 versions · one counted in totals until you choose')).toBeInTheDocument();

  await userEvent.setup().click(screen.getByRole('button', { name: 'Keep version 2: Soup and bread' }));
  expect(retract).toHaveBeenCalledOnce();
  expect(retract).toHaveBeenCalledWith('newer', 'other');
});

it('hides meal energy in quiet mode while keeping both choices readable', () => {
  mount(vi.fn<LivingActions['retract']>(), true);
  expect(screen.getByText('Rice and lentils')).toBeInTheDocument();
  expect(screen.getByText('Soup and bread')).toBeInTheDocument();
  expect(screen.queryByText('350 kcal')).not.toBeInTheDocument();
  expect(screen.queryByText('400 kcal')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Keep version 1: Rice and lentils' })).toBeEnabled();
});

it('keeps the choices visible with a clear error if the retraction fails', async () => {
  const retract = vi.fn<LivingActions['retract']>().mockResolvedValue({ ok: false, message: 'Could not save while offline.' });
  mount(retract);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Keep version 1: Rice and lentils' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save while offline.');
  expect(screen.getByRole('button', { name: 'Keep version 1: Rice and lentils' })).toBeEnabled();
});

it('offers undo if resolving three versions stops after one retraction', async () => {
  const undo = vi.fn().mockResolvedValue({ ok: true });
  const retract = vi.fn<LivingActions['retract']>()
    .mockResolvedValueOnce({ ok: true, undo })
    .mockResolvedValueOnce({ ok: false, message: 'The entry changed again.' });
  render(
    <LivingActionsProvider value={{ retract } as unknown as LivingActions}>
      <LogConflict conflict={{ ...conflict, versions: [...conflict.versions, { id: 'third', label: 'Fruit', source: 'user' }] }} />
      <Toaster />
    </LivingActionsProvider>,
  );
  await userEvent.setup().click(screen.getByRole('button', { name: 'Keep version 1: Rice and lentils' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('The entry changed again. Earlier changes can be undone.');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Undo' }));
  expect(undo).toHaveBeenCalledOnce();
});
