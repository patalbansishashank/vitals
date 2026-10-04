import { useMemo, useState } from 'react';
import { Checkbox, Key, KeyBank, ResponsivePanel, Stepper, formatNumber } from '@/components';
import type { IdealPlanV2, LimitCost, RankedGoal } from '@/engine/planner/domain/types';
import type { ConstraintDraft } from '@/state/plannerStore';
import type { EnergyUnit, UnitSystem } from '@/state/settingsStore';
import { adoptKnob, adoptPatch, limitCostView, mergePatches, type AdoptKnob } from '../ladder';

export interface AdoptLimitsPanelProps {
  open: boolean;
  onClose: () => void;
  ideal: IdealPlanV2;
  /** The goal screen's current limits (the "from" side of every row). */
  current: ConstraintDraft;
  goals: readonly RankedGoal[];
  units: UnitSystem;
  energy: EnergyUnit;
  /** Apply the chosen limits on the goal screen (one undoable change) and find plans with them. */
  onAdopt: (patch: Partial<ConstraintDraft>) => void;
  disabledReason?: string;
}

interface RowState {
  on: boolean;
  value: number | null;
}

/**
 * "Adopt some of these limits" (plan-ladder.md §6.8): one checkbox per limit group the Ideal relaxed, with its cost,
 * an intermediate value where the group has one (bounded by the Ideal's value), and the yellow "Find plans with these
 * limits" key — a planner run with the goal screen's limits updated (visible there, undoable).
 */
export function AdoptLimitsPanel({ open, onClose, ideal, current, goals, units, energy, onAdopt, disabledReason }: AdoptLimitsPanelProps) {
  const rows = useMemo(
    () =>
      ideal.limitCosts.map((c) => ({
        cost: c,
        view: limitCostView(c, goals, units, energy),
        patch: adoptPatch(c.adopt, current),
        knob: adoptKnob(c, current),
      })),
    [ideal.limitCosts, goals, units, energy, current],
  );
  const [state, setState] = useState<Record<string, RowState>>({});
  const get = (c: LimitCost, knob: AdoptKnob | null): RowState => state[c.group] ?? { on: false, value: knob ? knob.max : null };
  const set = (g: string, s: Partial<RowState>, knob: AdoptKnob | null) =>
    setState((cur) => ({ ...cur, [g]: { ...(cur[g] ?? { on: false, value: knob ? knob.max : null }), ...s } }));
  const chosen = rows.filter((r) => get(r.cost, r.knob).on && Object.keys(r.patch).length > 0);
  const patch = mergePatches(
    chosen.map((r) => {
      const s = get(r.cost, r.knob);
      return r.knob && s.value !== null ? r.knob.patch(s.value) : r.patch;
    }),
  );
  const footer = (
    <>
      <Key onClick={onClose}>Cancel</Key>
      <Key
        variant="signal"
        shape="pill"
        onClick={() => onAdopt(patch)}
        disabledReason={disabledReason ?? (chosen.length === 0 ? 'Choose at least one limit to change.' : undefined)}
      >
        Find plans with these limits
      </Key>
    </>
  );
  return (
    <ResponsivePanel open={open} onClose={onClose} title="Which limits could you change?" footer={footer}>
      <div className="lp-adopt">
        <p className="lp-plain">Each row is one of your limits the Ideal goes past, with what changing it alone would add. Pick the ones you could live with; the Planner then finds a new ladder inside them.</p>
        <ul className="lp-adopt__rows">
          {rows.map(({ cost, view, patch: p, knob }) => {
            const s = get(cost, knob);
            const adoptable = Object.keys(p).length > 0;
            const detail = [...view.deltas, view.effort].filter(Boolean).join(' · ');
            return (
              <li key={cost.group} className="lp-adopt__row" data-on={s.on || undefined}>
                <Checkbox
                  checked={s.on && adoptable}
                  disabled={!adoptable}
                  onChange={(on) => set(cost.group, { on }, knob)}
                  label={
                    <span className="lp-adopt__label">
                      <span>
                        {cost.label}: {cost.current} → <strong>{cost.relaxedTo}</strong>
                      </span>
                      {detail ? <span className="lp-adopt__detail lm-num">{detail}</span> : null}
                    </span>
                  }
                  help={adoptable ? undefined : cost.group === 'equipment' ? 'Equipment comes from your training profile; change it there.' : 'This limit is not set on the goals screen.'}
                />
                {s.on && knob ? (
                  <div className="lp-adopt__knob">
                    {knob.options ? (
                      <KeyBank
                        size="sm"
                        label={knob.label}
                        value={String(s.value ?? knob.max)}
                        onChange={(v) => set(cost.group, { value: Number(v) }, knob)}
                        options={knob.options.map((h) => ({ value: String(h), label: `${formatNumber(h, 0)} ${knob.unit}` }))}
                      />
                    ) : (
                      <Stepper
                        name={knob.label}
                        value={s.value ?? knob.max}
                        onChange={(v) => set(cost.group, { value: Math.min(knob.max, Math.max(knob.min, v)) }, knob)}
                        min={knob.min}
                        max={knob.max}
                        step={knob.step}
                        decimals={knob.decimals}
                        unit={knob.unit}
                      />
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </ResponsivePanel>
  );
}
