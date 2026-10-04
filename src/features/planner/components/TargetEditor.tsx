import { MeasureStepper, Stepper } from '@/components';
import type { GoalDraft } from '@/state/plannerStore';
import type { GoalMetric, ModeSpec } from '../catalogue';

export interface TargetEditorProps {
  metric: GoalMetric;
  mode: ModeSpec;
  goal: GoalDraft;
  onChange: (amount: number) => void;
  disabled?: boolean;
}

/**
 * Unit-aware target amount (planner-goals.md §6/§7 "Edit target"): masses and lengths follow Settings › Units
 * (kg ↔ lb, cm ↔ in) through `MeasureStepper` while the stored value stays metric; other targets use a plain
 * `Stepper` in the metric's unit. The sign comes from the goal type ("lose" 10 kg is stored as amount 10, sent as −10).
 * ⇧ + arrow steps ×10; typing is allowed; out-of-range typing shows the range and is not committed.
 */
export function TargetEditor({ metric, mode, goal, onChange, disabled }: TargetEditorProps) {
  const t = metric.target;
  if (!t) return null;
  const verb = mode.target === 'absolute' ? 'target' : mode.label;
  const name = `${metric.label.toLowerCase()} ${verb === 'target' ? 'target' : `to ${verb}`}`;
  const value = goal.amount ?? t.fallback;
  if (t.quantity === 'mass' || t.quantity === 'length') {
    return (
      <MeasureStepper
        className="lp-target"
        quantity={t.quantity}
        value={value}
        onChange={(v) => onChange(Math.round(v / 0.01) * 0.01)}
        min={t.min}
        max={t.max}
        name={name}
        disabled={disabled}
      />
    );
  }
  return (
    <Stepper
      className="lp-target"
      value={value}
      onChange={onChange}
      min={t.min}
      max={t.max}
      step={t.step}
      decimals={t.decimals}
      unit={t.unit}
      unitText={t.unitText}
      name={name}
      disabled={disabled}
    />
  );
}
