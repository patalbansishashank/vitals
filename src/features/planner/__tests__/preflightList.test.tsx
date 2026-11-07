import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PreflightList } from '../components/PreflightList';

describe('<PreflightList>', () => {
  it('says it is checking while the reach estimate computes, and shows no card once there is nothing to flag', () => {
    const { rerender, container } = render(<PreflightList hints={[]} onAction={vi.fn()} pending />);
    expect(screen.getByRole('status')).toHaveTextContent('Checking what a safe rate can reach in this horizon…');
    expect(screen.getByText('checking')).toBeInTheDocument();
    rerender(<PreflightList hints={[]} onAction={vi.fn()} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText('Before you run')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it('lists each hint as a row with its one remedy, no boxed notices', async () => {
    const onAction = vi.fn();
    render(
      <PreflightList
        hints={[{ id: 'h', severity: 'caution', title: 'Fat mass needs about 22 weeks.', body: 'Expect about 4 kg in this horizon.', action: { kind: 'extend', weeks: 22, label: 'Extend to 22 weeks' } }]}
        onAction={onAction}
      />,
    );
    expect(screen.getByText('1 note')).toBeInTheDocument();
    expect(screen.getByText('Fat mass needs about 22 weeks.').closest('li')).toHaveAttribute('data-severity', 'caution');
    expect(document.querySelector('.lm-notice')).toBeNull();
    screen.getByRole('button', { name: 'Extend to 22 weeks' }).click();
    expect(onAction).toHaveBeenCalledWith({ kind: 'extend', weeks: 22, label: 'Extend to 22 weeks' });
  });
});
