/**
 * QA release check 2026-10-01: a day inside a fast shows as fasted in the day editor (no kcal, no meals, the fast's
 * span and refeed), and edits or paint on fasted days explain that the fast overrides the program.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Schedule } from '@/engine';
import { DayEditor } from '../components/DayEditor';
import { dayFastInfo, refeedRamp } from '../lib/fasts';
import { buildScheduleModel } from '../useScheduleModel';
import { RP, schedule } from './fixtures';

/** A every day (meals 08:00, 14:00, 20:00); a 72 h fast from day 1 20:00 to day 4 20:00 with a graded refeed. */
function fastSchedule(refeed: 'auto' | 'none' = 'auto'): Schedule {
  const s = schedule(14, [0]);
  return { ...s, events: [{ kind: 'fast', startDay: 1, startH: 20, durationH: 72, refeed }] };
}

function editor(day: number, scope: 'day' | 'block' | 'all' = 'day', refeed: 'auto' | 'none' = 'auto') {
  const model = buildScheduleModel(fastSchedule(refeed), RP);
  const onScope = vi.fn();
  render(
    <DayEditor sid="x" model={model} target={{ day, program: 0 }} scope={scope} onScope={onScope} onNavigate={vi.fn()} />,
  );
  return { model, onScope };
}

describe('fast days in the day editor', () => {
  it('derives fasted, partly fasted and refeed days from the compiled schedule', () => {
    const m = buildScheduleModel(fastSchedule(), RP);
    const d2 = dayFastInfo(m.compiled, m.spans, 2, false);
    expect(d2.fasted).toBe(true);
    expect(d2.overridden).toBe(true);
    expect(d2.span?.eventIndex).toBe(0);
    expect(d2.span?.refeed).toBe('auto');
    const d4 = dayFastInfo(m.compiled, m.spans, 4, false);
    expect(d4.fasted).toBe(false);
    expect(d4.droppedMeals).toBeGreaterThan(0);
    const ramp = refeedRamp(m.compiled, d2.span!);
    expect(ramp.length).toBeGreaterThan(0);
    expect(ramp.every((f) => f > 0 && f < 1)).toBe(true);
    expect(dayFastInfo(m.compiled, m.spans, 10, false)).toMatchObject({ fasted: false, overridden: false, refeed: null });
  });

  it('shows a day inside the fast as fasted: no kcal, no meals, the span and the refeed', () => {
    editor(2);
    const note = screen.getByRole('note', { name: '' });
    expect(note).toHaveTextContent('fasted');
    expect(note).toHaveTextContent(/Inside the 72 h fast/);
    expect(note).toHaveTextContent(/The fast overrides program A on this day/);
    // the program's energy slider and macros are not offered on a fasted day
    expect(screen.queryByRole('slider', { name: /% of maintenance/ })).toBeNull();
    expect(screen.queryByText('Macros')).toBeNull();
    expect(screen.getByText(/0 kcal · fasted · fast 72 h/)).toBeInTheDocument();
    expect(screen.getByText(/This day is inside a 72 h fast/)).toBeInTheDocument();
    expect(screen.getByText(/^Refeed from .*of the planned energy, then the program as painted\.$/)).toBeInTheDocument();
    // the event itself stays editable
    expect(screen.getByRole('button', { name: /Remove this fast/ })).toBeInTheDocument();
  });

  it('says there is no graded refeed when the fast has none', () => {
    editor(2, 'day', 'none');
    expect(screen.getByText(/^No graded refeed: food restarts at the planned amount at /)).toBeInTheDocument();
  });

  it('explains dropped meals and the refeed on the day the fast ends', () => {
    editor(4);
    expect(screen.getByText(/The fast drops \d of this day’s 3 meals/)).toBeInTheDocument();
    expect(screen.getByText(/Refeed day 1 of \d+ after the fast: \d+ % of the planned energy/)).toBeInTheDocument();
    expect(screen.getAllByText(/dropped \(inside the fast\)/).length).toBeGreaterThan(0);
  });

  it('warns that edits to all A days do not reach the fasted days', () => {
    editor(2, 'all');
    expect(screen.getByRole('note')).toHaveTextContent(/of these 14 days are inside a fast: the fast overrides their food/);
    // the program's own fields stay editable in this scope
    expect(screen.getByRole('slider', { name: /% of maintenance/ })).toBeInTheDocument();
    expect(within(screen.getByRole('note')).queryByText('fasted')).toBeNull();
  });
});
