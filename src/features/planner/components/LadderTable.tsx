import type { PlannerResultV2, RankedGoal } from '@/engine/planner/domain/types';
import type { EnergyUnit, UnitSystem } from '@/state/settingsStore';
import { RUNG_TITLE, comparisonRows, presentKinds, type PlanKind } from '../ladder';
import { RungKey } from './RungKey';

export interface LadderTableProps {
  v2: PlannerResultV2;
  goals: readonly RankedGoal[];
  units: UnitSystem;
  energy: EnergyUnit;
  selected: PlanKind;
  onSelect: (kind: PlanKind) => void;
  gentle?: boolean;
}

/**
 * The comparison table (`cards · table`, plan-ladder.md §6.9): rows × plans in the contract's effort-first order, sticky
 * row labels and header, the selected plan's column edged in ink; the Ideal column alone adds what your limits cost.
 * On phones the table scrolls sideways inside its own box.
 */
export function LadderTable({ v2, goals, units, energy, selected, onSelect, gentle = false }: LadderTableProps) {
  const kinds = presentKinds(v2);
  const rows = comparisonRows(v2, goals, units, { energy, gentle });
  return (
    <div className="lp-ltable-wrap" role="region" aria-label="Plans compared" tabIndex={0}>
      <table className="lp-ltable">
        <caption className="lm-sr">The plans side by side: effort, each goal, time to target, hunger, training time, eating window, fasting, things to buy, limits and safety.</caption>
        <thead>
          <tr>
            <th scope="col" className="lp-ltable__corner">
              <span className="lm-sr">Measure</span>
            </th>
            {kinds.map((k) => (
              <th key={k} scope="col" data-rung={k} data-selected={k === selected || undefined}>
                <button type="button" className="lp-ltable__head" aria-pressed={k === selected} onClick={() => onSelect(k)}>
                  <RungKey kind={k} size="sm" pressed={k === selected} />
                  <span>{RUNG_TITLE[k]}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} data-row={r.id} data-group={r.group}>
              <th scope="row">{r.label}</th>
              {kinds.map((k) => (
                <td key={k} data-rung={k} data-selected={k === selected || undefined}>
                  {r.cells[k] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
