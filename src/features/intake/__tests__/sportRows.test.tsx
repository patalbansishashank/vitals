import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SportRowsWidget } from '../components/widgets/activity';

describe('sport rows', () => {
  it('names every control of a row, also before a sport is typed', async () => {
    render(<SportRowsWidget {...({ value: undefined, onCommit: () => undefined, labelledBy: 'q' } as unknown as Parameters<typeof SportRowsWidget>[0])} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add one' }));
    expect(screen.getByRole('textbox', { name: 'sport or hobby 1' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'sport or hobby 1: intensity' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove sport or hobby 1' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^what/)).toBeNull();
    await userEvent.type(screen.getByRole('textbox', { name: 'sport or hobby 1' }), 'badminton');
    expect(screen.getByRole('radiogroup', { name: 'badminton: intensity' })).toBeInTheDocument();
  });
});
