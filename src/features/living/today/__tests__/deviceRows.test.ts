/**
 * Q10: the contract's checklist drops steps and sleep once a device has measured the day; Today's rows keep them, so a
 * device-fed stream still shows its value and the Correct action (the rows PrescriptionRows renders as "fed by").
 */
import { describe, expect, it } from 'vitest';
import { todayRows } from '../model';
import { todayViewFixture } from './todayView.fixture';

describe('Today rows on a day a device measured', () => {
  it('keeps the steps and sleep rows when the checklist left them out', () => {
    const base = todayViewFixture();
    const view = { ...base, checklist: base.checklist.filter((c) => c.kind !== 'steps' && c.kind !== 'sleep') };
    const rows = todayRows(view);
    expect(rows.find((r) => r.glyph === 'steps')).toMatchObject({ itemId: 'steps', untimed: true });
    expect(rows.find((r) => r.glyph === 'sleep')).toMatchObject({ itemId: 'sleep', untimed: true });
    expect(rows.filter((r) => r.glyph === 'steps')).toHaveLength(1);
  });

  it('adds no steps row when the plan sets no steps target', () => {
    const base = todayViewFixture();
    const view = { ...base, prescription: { ...base.prescription!, steps: undefined }, checklist: base.checklist.filter((c) => c.kind !== 'steps') };
    expect(todayRows(view).some((r) => r.glyph === 'steps')).toBe(false);
  });

  it('does not duplicate rows the checklist already has', () => {
    const view = todayViewFixture();
    const rows = todayRows(view);
    expect(rows.filter((r) => r.glyph === 'steps')).toHaveLength(view.checklist.filter((c) => c.kind === 'steps').length);
    expect(rows.filter((r) => r.glyph === 'sleep')).toHaveLength(Math.max(1, view.checklist.filter((c) => c.kind === 'sleep').length));
  });
});
