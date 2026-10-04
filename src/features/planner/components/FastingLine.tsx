import { ChevronRight } from 'lucide-react';
import { Icon, Popover, usePopover } from '@/components';
import type { FastingVerdict, PlannerResultV2, RankedGoal } from '@/engine/planner/domain/types';
import type { EnergyUnit, UnitSystem } from '@/state/settingsStore';
import { fastingLine, rivalRows } from '../ladder';

/** "with the fast vs this plan": goal deltas, hunger peak and lean tissue, each a signed number with unit. */
export function RivalTable({ verdict, goals, units, energy }: { verdict: FastingVerdict; goals: readonly RankedGoal[]; units: UnitSystem; energy: EnergyUnit }) {
  const rows = rivalRows(verdict, goals, units, energy);
  if (!rows.length) return null;
  return (
    <table className="lp-rival">
      <caption>with the fast vs this plan</caption>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <th scope="row">{r.label}</th>
            <td className="lm-num">{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export interface FastingLineProps {
  verdict: FastingVerdict;
  run: PlannerResultV2['fasting'] | null;
  goals: readonly RankedGoal[];
  units: UnitSystem;
  energy: EnergyUnit;
}

/**
 * The card's fasting line (plan-ladder.md §6.2, §6.5): what the plan does about fasting in one line; when a fast was
 * considered and rejected, the › opens a popover with the engine's full sentence and the mini table.
 */
export function FastingLine({ verdict, run, goals, units, energy }: FastingLineProps) {
  const line = fastingLine(verdict, run);
  const pop = usePopover();
  if (!line.rival) return <p className="lp-lcard__line">{line.text}</p>;
  return (
    <>
      <button
        type="button"
        className="lp-lcard__line lp-lcard__line--btn"
        {...pop.triggerProps}
        onClick={(e) => {
          e.stopPropagation();
          pop.triggerProps.onClick();
        }}
        aria-label={`${line.text}: why`}
      >
        <span>{line.text}</span>
        <Icon icon={ChevronRight} size={16} />
      </button>
      <Popover open={pop.open} onOpenChange={pop.setOpen} anchorRef={pop.anchorRef} label="Why there is no fast" placement="bottom-start">
        <div className="lp-rival-pop" onClick={(e) => e.stopPropagation()}>
          <p className="lp-plain">{verdict.text}</p>
          <RivalTable verdict={verdict} goals={goals} units={units} energy={energy} />
        </div>
      </Popover>
    </>
  );
}
