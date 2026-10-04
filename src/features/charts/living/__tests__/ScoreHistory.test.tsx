import '../../test/setupDom';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ScoreHistory } from '../ScoreHistory';
import { scoreFixture } from './fixtures';

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
};

afterEach(() => cleanup());

describe('<ScoreHistory>', () => {
  it('renders version changes as engraved lines with their labels', async () => {
    const { container } = render(<ScoreHistory data={scoreFixture()} label="Heart-rate variability" />);
    await flush();
    const versions = container.querySelectorAll('[data-mark="version"]');
    expect(versions).toHaveLength(1);
    expect(versions[0]!.textContent).toBe('v1.3 from 20 Oct');
    expect(versions[0]!.querySelector('line')).not.toBeNull();
  });

  it('draws nights as dots, the mean with a dashed join at a new device, the normal band and the comparison', async () => {
    const { container } = render(<ScoreHistory data={scoreFixture()} />);
    await flush();
    expect(container.querySelectorAll('[data-mark="night"]')).toHaveLength(26);
    expect(container.querySelectorAll('[data-mark="device-join"]')).toHaveLength(1);
    expect(container.querySelector('[data-mark="device"]')?.textContent).toBe('new ring');
    expect(container.querySelector('[data-mark="normal"]')?.getAttribute('d')).toMatch(/Z$/);
    expect(container.querySelector('[data-mark="compare"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-mark="y-tick"]').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('compare with v1.2')).toBeInTheDocument();
  });

  it('uses the category hue for its line (recovery sky, performance green)', async () => {
    const { container, rerender } = render(<ScoreHistory data={scoreFixture()} />);
    await flush();
    expect((container.firstChild as HTMLElement).style.getPropertyValue('--lmc-sh-hue')).toBe('var(--lm-cat-recovery)');
    rerender(<ScoreHistory data={scoreFixture({ category: 'performance' })} />);
    expect((container.firstChild as HTMLElement).style.getPropertyValue('--lmc-sh-hue')).toBe('var(--lm-cat-performance)');
  });

  it('has a summary and a table twin', async () => {
    render(<ScoreHistory data={scoreFixture()} label="Heart-rate variability" />);
    await flush();
    expect(screen.getByRole('img', { name: /^Heart-rate variability, 7-day mean .*v1\.3 from 20 Oct; new ring on 3 October/ })).toHaveAttribute('tabindex', '0');
    fireEvent.click(screen.getByRole('button', { name: 'table' }));
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(29);
    expect(within(table).getByText('new ring')).toBeInTheDocument();
  });
});
