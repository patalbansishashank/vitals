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
  /** Hard's own note (the Ideal is this same plan): under Hard's column head, never between the cards. */
  hardNote?: string | null;
}

/**
 * The comparison table (`cards · table`, plan-ladder.md §6.9): rows × plans in the contract's effort-first order, sticky
 * row labels and header, the selected plan's column edged in ink; the Ideal column alone adds what your limits cost.
 * On phones (r068 W2-8) it reads as one block per measure — the measure, then each plan's name and value — with no
 * sideways scroll.
 */
export function LadderTable({ v2, goals, units, energy, selected, onSelect, gentle = false, hardNote = null }: LadderTableProps) {
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
                {k === 'hard' && hardNote ? <span className="lp-ltable__note">{hardNote}</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} data-row={r.id} data-group={r.group}>
              <th scope="row">{r.label}</th>
              {kinds.map((k) => (
                <td key={k} data-rung={k} data-selected={k === selected || undefined} data-label={r.label}>
                  {/* phones read the table as one block per measure: each plan's name leads its value */}
                  <span className="lp-ltable__plan" aria-hidden="true">
                    <RungKey kind={k} size="sm" pressed={k === selected} />
                    {RUNG_TITLE[k]}
                  </span>
                  <span className="lp-ltable__val">{r.cells[k] ?? '—'}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {hardNote ? <p className="lp-ltable__foot">{hardNote}</p> : null}
    </div>
  );
}
