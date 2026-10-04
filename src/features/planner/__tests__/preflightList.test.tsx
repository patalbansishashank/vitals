import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PreflightList } from '../components/PreflightList';

describe('<PreflightList> while the reach estimate is computing', () => {
  it('says it is checking instead of "nothing to flag"', () => {
    const { rerender } = render(<PreflightList hints={[]} onAction={vi.fn()} pending />);
    expect(screen.getByRole('status')).toHaveTextContent('Checking what a safe rate can reach in this horizon…');
    expect(screen.getByText('checking')).toBeInTheDocument();
    expect(screen.queryByText(/No obvious conflicts/)).toBeNull();
    rerender(<PreflightList hints={[]} onAction={vi.fn()} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText(/No obvious conflicts/)).toBeInTheDocument();
  });
});
