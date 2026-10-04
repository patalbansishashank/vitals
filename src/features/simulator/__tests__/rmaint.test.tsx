/**
 * R-MAINT in the schedule builder: cells, phases, the summary strip and the program keys read energy against the
 * maintenance reference at the plan's planned activity; the week scrubber for long horizons.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { balanceKind, balanceLabel } from '../lib/energy';
import { SCRUBBER_MIN_WEEKS, rowDays } from '../lib/calendar';
import { activitySentence, summarise } from '../lib/summary';
import { buildScheduleModel } from '../useScheduleModel';
import { WeekScrubber } from '../components/WeekScrubber';
import { summariseProgram } from '../components/ProgramTray';
import { A, RP, schedule } from './fixtures';

describe('true planned balance (R-MAINT)', () => {
  it('labels balance plainly', () => {
    expect(balanceLabel(82)).toBe('deficit 18 %');
    expect(balanceLabel(106, 180)).toBe('surplus 6 % · +180 kcal');
    expect(balanceLabel(101)).toBe('maintenance');
    expect(balanceLabel(0)).toBe('water-only');
    expect(balanceKind(97.5)).toBe('maintenance');
  });

  it('reads cells, phases and the summary against each day’s maintenance reference', () => {
    const m = buildScheduleModel(schedule(28, [0, 1]), RP);
    const d0 = m.compiled.days[0]!;
    const ref = Number.isFinite(d0.maintenanceKcal) ? d0.maintenanceKcal : RP.tdee0Kcal;
    expect(m.cells[0]!.maintKcal).toBeCloseTo(ref, 6);
    expect(m.cells[0]!.pct).toBeCloseTo((100 * d0.energyKcal) / ref, 6);
    // program A is 85 % of its reference
    expect(m.cells[0]!.pct).toBeCloseTo(85, 0);
    expect(m.cells[0]!.balanceKcal).toBeCloseTo(d0.energyKcal - ref, 0);
    const s = summarise(m.compiled, RP, [0, 1, 2, 3, 4, 5, 6]);
    expect(s.energyPct).toBeCloseTo((4 * 85 + 3 * 75) / 7, 1);
    expect(s.balanceKcal).toBeLessThan(0);
    expect(m.phases[0]!.balanceKcal).toBeLessThan(0);
    // the % a program key shows is the requested share of its reference, with the resolved kcal beside it
    const key = summariseProgram(A, RP, m.programMaintKcal[0]);
    expect(key.text.startsWith('85 %')).toBe(true);
    expect(key.kcalText).toMatch(/kcal · maint\. /);
  });

  it('says once, plainly, when the plan trains more or less than the usual week', () => {
    expect(activitySentence(310)).toMatch(/adds ≈ 310 kcal a day of training/);
    expect(activitySentence(-120)).toMatch(/≈ 120 kcal a day less activity/);
    expect(activitySentence(12)).toBeNull();
  });
});

describe('week scrubber', () => {
  it('jumps to a week by keyboard and names its balance', () => {
    const m = buildScheduleModel(schedule(182, [0, 1, 1]), RP);
    expect(m.grid.rows).toBeGreaterThanOrEqual(SCRUBBER_MIN_WEEKS);
    const rowPct = Array.from({ length: m.grid.rows }, (_, r) => {
      const days = rowDays(m.grid, r);
      return days.reduce((a, d) => a + m.cells[d]!.pct, 0) / days.length;
    });
    const onJump = vi.fn();
    render(<WeekScrubber model={m} rowPct={rowPct} focusDay={0} onJump={onJump} />);
    const slider = screen.getByRole('slider', { name: 'weeks' });
    expect(slider).toHaveAttribute('aria-valuetext', expect.stringMatching(/^week 1 of \d+, deficit \d+/));
    fireEvent.keyDown(slider, { key: 'End' });
    expect(onJump).toHaveBeenLastCalledWith(m.grid.rows - 1);
    fireEvent.keyDown(slider, { key: 'ArrowRight', shiftKey: true });
    expect(onJump).toHaveBeenLastCalledWith(4);
  });
});
