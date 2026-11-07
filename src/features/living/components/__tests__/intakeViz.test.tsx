/**
 * IntakeRing and IntakeTrack (r071 0B): the ring and the tracks of what was eaten. Each reads one IntakeChannel, says one
 * sentence, never draws a figure for an unknown, says a lower bound as one, and draws no digit in quiet mode.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IntakeRing, IntakeTrack, intakeGoalText, intakeValueText, spokenIntake } from '../IntakeViz';
import { intakeModel, type IntakeRx, type IntakeView } from '../../model/intake';

const est = (value: number, sd = 0) => ({ value, sd });
const RX: IntakeRx = { energyKcal: 2050, macros: { proteinG: 150, carbG: 200, fatG: 70, fibreG: 30 } };
const day = (o: { kcal?: [number, number?]; protein?: [number, number?]; carbs?: [number, number?]; meal?: boolean; coverage?: Record<string, string> } = {}): IntakeView =>
  ({
    logged: { entries: o.meal === false ? [] : [{ kind: 'meal' }], totals: { energyKcal: est(...(o.kcal ?? [0])), proteinG: est(...(o.protein ?? [0])), carbG: est(...(o.carbs ?? [0])), fatG: est(0), fibreG: est(0) } },
    coverage: o.coverage,
  }) as unknown as IntakeView;
const digits = (el: Element) => (el.textContent ?? '').replace(/\u00a0/g, ' ');

describe('the words', () => {
  it('the goal is its bare words (the pictures add "goal" or "at least" from the kind); an unknown shows a dash', () => {
    const m = intakeModel(day({ kcal: [750], protein: [32] }), RX);
    expect(intakeGoalText(m.energy)).toBe('2,050 kcal');
    expect(intakeGoalText(m.protein)).toBe('150 g');
    expect(intakeValueText(m.energy)).toBe('750');
    expect(intakeValueText(intakeModel(day({ meal: false }), RX).energy)).toBe('—');
  });

  it('the sentence: exact reads exactly, an estimate says about with its range, a lower bound says at least', () => {
    const exact = intakeModel(day({ kcal: [750], protein: [32] }), RX);
    expect(spokenIntake(exact.energy)).toBe('Energy: eaten 750 of 2,050 kcal, 1,300 kcal left');
    expect(spokenIntake(exact.protein)).toBe('Protein: eaten 32 of at least 150 g');
    const rough = intakeModel(day({ kcal: [750, 100] }), RX);
    expect(spokenIntake(rough.energy)).toBe('Energy: eaten about 750 of 2,050 kcal (range 622–878), 1,300 kcal left');
    const lower = intakeModel(day({ kcal: [750], protein: [32], coverage: { energy: 'complete', protein: 'partial' } }), RX);
    expect(spokenIntake(lower.protein)).toBe('Protein: eaten at least 32 of at least 150 g');
    expect(spokenIntake(intakeModel(day({ kcal: [2250] }), RX).energy)).toContain('200 kcal over');
  });

  it('an unknown says why and the target; quiet says words and not one digit', () => {
    const none = intakeModel(day({ meal: false }), RX);
    expect(spokenIntake(none.energy)).toBe('Energy: nothing logged yet, target 2,050 kcal');
    expect(spokenIntake(none.protein)).toBe('Protein: nothing logged yet, at least 150 g');
    const m = intakeModel(day({ kcal: [750], protein: [32] }), RX);
    expect(spokenIntake(m.energy, true)).toBe('Energy: about a third of today’s food');
    expect(spokenIntake(m.energy, true)).not.toMatch(/\d/);
    expect(spokenIntake(none.energy, true)).not.toMatch(/\d/);
  });
});

describe('IntakeRing', () => {
  it('is the foundation ring: a meter named by the sentence, the number in its centre, the target a mark', () => {
    const m = intakeModel(day({ kcal: [750] }), RX);
    const { container } = render(<IntakeRing channel={m.energy} animate={false} />);
    const meter = screen.getByRole('meter', { name: 'Energy' });
    expect(meter.getAttribute('aria-valuetext')).toBe('Energy: eaten 750 of 2,050 kcal, 1,300 kcal left');
    expect(digits(container)).toContain('750');
    expect(container.textContent).toContain('kcal');
  });

  it('an unknown draws no number: its words say why', () => {
    const m = intakeModel(day({ meal: false }), RX);
    const { container } = render(<IntakeRing channel={m.energy} animate={false} />);
    expect(container.textContent).toContain('Nothing logged yet');
    expect(container.querySelector('.lm-hero')).toBeNull();
  });

  it('a lower bound says "At least" in the centre', () => {
    const m = intakeModel(day({ kcal: [750], protein: [32], coverage: { energy: 'complete', protein: 'partial' } }), RX);
    const { container } = render(<IntakeRing channel={m.protein} animate={false} />);
    expect(container.textContent).toContain('At least');
  });

  it('quiet: no digit anywhere, DOM or aria; the word is the centre', () => {
    const m = intakeModel(day({ kcal: [750] }), RX);
    const { container } = render(<IntakeRing channel={m.energy} quiet animate={false} />);
    expect(container.textContent).toContain('about a third of today’s food');
    expect(container.textContent).not.toMatch(/\d/);
    const meter = screen.getByRole('meter');
    for (const a of ['aria-valuenow', 'aria-valuemin', 'aria-valuemax']) expect(meter).not.toHaveAttribute(a);
    expect(meter.getAttribute('aria-valuetext') ?? '').not.toMatch(/\d/);
  });

  it('a small ring has no centre number (the sentence says it)', () => {
    const m = intakeModel(day({ kcal: [750] }), RX);
    const { container } = render(<IntakeRing channel={m.energy} size="sm" animate={false} />);
    expect(container.querySelector('.lm-hero')).toBeNull();
  });
});

describe('IntakeTrack', () => {
  it('is the foundation track with its row: name left, "32 / 150 g" right, "At least" beside a floor', () => {
    const m = intakeModel(day({ kcal: [750], protein: [32] }), RX);
    const { container } = render(<IntakeTrack channel={m.protein} animate={false} />);
    const row = container.querySelector('.lv-intake') as HTMLElement;
    expect(row).toHaveAttribute('data-intake', 'protein');
    expect(row).toHaveAttribute('data-kind', 'floor');
    expect(digits(within(row).getByText('32 / 150 g'))).toBe('32 / 150 g');
    expect(within(row).getByText('At least')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Protein' }).getAttribute('aria-valuetext')).toBe('Protein: 32 g, at least 150 g');
  });

  it('a lower bound and a lagging macro say so and draw provisional (dashed) dots', () => {
    const lower = intakeModel(day({ kcal: [750], protein: [32], coverage: { energy: 'complete', protein: 'partial' } }), RX);
    const a = render(<IntakeTrack channel={lower.protein} animate={false} />);
    expect(a.container.textContent).toContain('At least 32 / 150 g');
    expect(a.container.querySelector('.lmz-track')).toHaveAttribute('data-state', 'provisional');
    a.unmount();
    const lag = intakeModel(day({ kcal: [750], carbs: [60], coverage: { energy: 'asPlannedEstimate', carbohydrate: 'partial' } }), RX);
    expect(lag.carbs.state).toBe('partial');
    const b = render(<IntakeTrack channel={lag.carbs} animate={false} />);
    expect(b.container.textContent).toContain('Partial');
    expect(b.container.querySelector('.lmz-track')).toHaveAttribute('data-state', 'provisional');
  });

  it('unknown: the words, no thumb', () => {
    const m = intakeModel(day({ meal: false }), RX);
    const { container } = render(<IntakeTrack channel={m.protein} animate={false} />);
    expect(container.textContent).toContain('Nothing logged yet');
    expect(container.querySelector('.lmz-track__thumb')).toBeNull();
    expect(container.querySelector('.lmz-track')).toHaveAttribute('data-state', 'unknown');
  });

  it('quiet draws nothing: a macro in grams is a number', () => {
    const m = intakeModel(day({ kcal: [750], protein: [32] }), RX);
    const { container } = render(<IntakeTrack channel={m.protein} quiet animate={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('over the goal the track says nothing celebratory: the figure is the figure', () => {
    const m = intakeModel(day({ kcal: [750], protein: [180] }), RX);
    const { container } = render(<IntakeTrack channel={m.protein} animate={false} />);
    expect(container.textContent).toContain('180 / 150 g');
    expect(container.innerHTML).not.toMatch(/danger/);
  });
});
