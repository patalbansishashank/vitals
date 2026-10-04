import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ScheduleRaster, type ScheduleRasterProps } from '../components/ScheduleRaster';
import { buildScheduleModel } from '../useScheduleModel';
import { RP, schedule } from './fixtures';

function setup(over: Partial<ScheduleRasterProps> = {}) {
  const s = schedule(14, [0, 1, 0, 1, 0, 1, 2]);
  const model = buildScheduleModel(s, RP);
  const props: ScheduleRasterProps = {
    model,
    armed: null,
    selection: new Set([0]),
    anchor: 0,
    focusDay: 0,
    editorDay: null,
    onSelect: vi.fn(),
    onFocusDay: vi.fn(),
    onOpenDay: vi.fn(),
    onPaint: vi.fn(),
    onStrokeEnd: vi.fn(),
    onCommand: vi.fn(),
    onSelectPhase: vi.fn(),
    ...over,
  };
  render(<ScheduleRaster {...props} />);
  return props;
}

describe('<ScheduleRaster>', () => {
  it('is an ARIA grid with labelled cells (energy printed, fast labelled)', () => {
    setup();
    const grid = screen.getByRole('grid');
    expect(grid).toHaveAttribute('aria-rowcount', '3');
    const cells = screen.getAllByRole('gridcell').filter((c) => c.hasAttribute('data-day'));
    expect(cells).toHaveLength(14);
    expect(cells[0]).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/^Monday 5 October, program A training day, 85 percent energy/),
    );
    expect(cells[6]).toHaveAttribute('aria-label', expect.stringMatching(/water-only fast/));
    expect(cells[6]!.textContent).toMatch(/36 h/);
    expect(cells[0]).toHaveAttribute('tabindex', '0');
    expect(cells[1]).toHaveAttribute('tabindex', '-1');
  });

  it('arrow keys move and extend the selection; Enter opens; P, Delete, letters and 0 are commands', () => {
    const p = setup({ selection: new Set([8]), anchor: 8, focusDay: 8 });
    const cell = screen.getAllByRole('gridcell').find((c) => c.dataset.day === '8')!;
    fireEvent.keyDown(cell, { key: 'ArrowUp' });
    expect(p.onSelect).toHaveBeenLastCalledWith([1], 1);
    fireEvent.keyDown(cell, { key: 'ArrowRight', shiftKey: true });
    expect(p.onSelect).toHaveBeenLastCalledWith([8, 9], 8);
    fireEvent.keyDown(cell, { key: 'Enter' });
    expect(p.onOpenDay).toHaveBeenCalledWith(8);
    fireEvent.keyDown(cell, { key: 'p' });
    expect(p.onCommand).toHaveBeenLastCalledWith({ kind: 'paintSelection' });
    fireEvent.keyDown(cell, { key: 'Delete' });
    expect(p.onCommand).toHaveBeenLastCalledWith({ kind: 'clearSelection' });
    fireEvent.keyDown(cell, { key: 'b' });
    expect(p.onCommand).toHaveBeenLastCalledWith({ kind: 'arm', program: 1 });
    fireEvent.keyDown(cell, { key: '0' });
    expect(p.onCommand).toHaveBeenLastCalledWith({ kind: 'arm', program: null });
    fireEvent.keyDown(cell, { key: 'c', ctrlKey: true });
    expect(p.onCommand).toHaveBeenLastCalledWith({ kind: 'copyWeek', row: 1 });
  });

  it('the week label selects its week', () => {
    const p = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Select week 2' }));
    expect(p.onSelect).toHaveBeenLastCalledWith([7, 8, 9, 10, 11, 12, 13], 7);
  });
});
