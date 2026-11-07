import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { dispatch } from '@/commands';
import type * as Commands from '@/commands';
import { ResetDialog } from '../ResetDialog';

vi.mock('@/commands', async (original) => ({
  ...await original<typeof Commands>(),
  dispatch: vi.fn(),
}));

const execute = vi.mocked(dispatch);

beforeEach(() => { execute.mockReset(); });

function renderReset() {
  return render(<MemoryRouter><ResetDialog open onClose={vi.fn()} contents={['your plans']} /></MemoryRouter>);
}

it('keeps the reset dialog and shows a refused erase, then allows a retry', async () => {
  execute.mockResolvedValue({ ok: false, error: { code: 'precondition_failed', message: 'A data import is in progress. Try again when it finishes.' } });
  const user = userEvent.setup();
  renderReset();
  await user.type(screen.getByRole('textbox', { name: 'Type reset to confirm' }), 'reset');
  await user.click(screen.getByRole('button', { name: 'Delete planning data' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('A data import is in progress. Try again when it finishes.');
  expect(screen.getByRole('alertdialog')).toBeVisible();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Delete planning data' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: 'Delete planning data' }));
  expect(execute).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('textbox', { name: 'Type reset to confirm' })).toHaveValue('reset');
});

it('recovers from an unexpected erase rejection without dismissing the confirmation', async () => {
  execute.mockRejectedValue(new Error('storage failed'));
  const user = userEvent.setup();
  renderReset();
  await user.type(screen.getByRole('textbox', { name: 'Type reset to confirm' }), 'reset');
  await user.click(screen.getByRole('button', { name: 'Delete planning data' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not reset this device. Try again.');
  expect(screen.getByRole('alertdialog')).toBeVisible();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Delete planning data' })).toBeEnabled());
});
