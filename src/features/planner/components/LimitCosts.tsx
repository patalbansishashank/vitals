import type { IdealPlanV2, RankedGoal } from '@/engine/planner/domain/types';
import type { EnergyUnit, UnitSystem } from '@/state/settingsStore';
import { IDEAL_KEEPS, NOTHING_BINDS_LEAD, NOTHING_BINDS_TAIL, idealCosts, limitCostView, type LimitCostView } from '../ladder';

export function LimitCostRow({ row }: { row: LimitCostView }) {
  const [before, after] = splitStrong(row.lead, row.strong);
  return (
    <li className="lp-lcost" data-group={row.group}>
      <span className="lp-lcost__lead">
        {before}
        <strong>{row.strong}</strong>
        {after}
      </span>
      {row.deltas.length ? <span className="lp-lcost__deltas lm-num">{row.deltas.join(' · ')}</span> : null}
      {row.effort ? <span className="lp-lcost__effort lm-num">{row.effort}</span> : null}
    </li>
  );
}

function splitStrong(text: string, strong: string): [string, string] {
  const i = strong ? text.indexOf(strong) : -1;
  if (i < 0) return [text, ''];
  return [text.slice(0, i), text.slice(i + strong.length)];
}

export interface LimitCostsProps {
  ideal: IdealPlanV2;
  goals: readonly RankedGoal[];
  units: UnitSystem;
  energy: EnergyUnit;
  /** Card: top 3; Limits tab: all. */
  all?: boolean;
  /** The Ideal's relaxed list, advised list and what it keeps (card and Limits tab). */
  extras?: boolean;
}

/**
 * What your limits cost (plan-ladder.md §6.3; COMPONENTS §13.7 LimitCostRow): the top limit groups by goal priority with
 * what relaxing each alone would buy, the "together, through interactions" remainder, then what the Ideal changes, the
 * advised-only items (never counted in the numbers, set apart) and what it keeps.
 */
export function LimitCosts({ ideal, goals, units, energy, all = false, extras = true }: LimitCostsProps) {
  const top = all ? Math.max(3, ideal.limitCosts.length) : 3;
  const c = idealCosts(ideal, goals, units, energy, top);
  const nothing = ideal.nothingBinds || c.rows.length === 0;
  return (
    <div className="lp-lcosts">
      {nothing ? (
        <p className="lp-lcosts__none">
          <strong>{NOTHING_BINDS_LEAD}</strong> {NOTHING_BINDS_TAIL}
        </p>
      ) : (
        <ul className="lp-lcosts__list">
          {c.rows.map((r) => (
            <LimitCostRow key={r.group} row={r} />
          ))}
          {c.remainder ? <li className="lp-lcost lp-lcost--rest">{c.remainder}</li> : null}
        </ul>
      )}
      {!all && c.more > 0 ? <p className="lp-lcosts__more">{`${c.more} more in the limits tab`}</p> : null}
      {extras ? (
        <>
          {ideal.relaxed.length ? (
            <div className="lp-lcosts__block">
              <p className="lm-eng">what it changes</p>
              <p className="lp-lcosts__text">{ideal.relaxed.map((r) => `${r.from} → ${r.to}`).join(' · ')}</p>
            </div>
          ) : null}
          {ideal.advised.length ? (
            <div className="lp-lcosts__block lp-lcosts__advised">
              <p className="lm-eng">also advised, not counted in the numbers</p>
              <p className="lp-lcosts__text">{ideal.advised.map((a) => a.text).join(' · ')}</p>
            </div>
          ) : null}
          <div className="lp-lcosts__block">
            <p className="lm-eng">what it keeps</p>
            <p className="lp-lcosts__text">{IDEAL_KEEPS}</p>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** One limit group's cost as plain text (Limits tab rows of a rung). */
export function limitCostSentence(...args: Parameters<typeof limitCostView>): string {
  const v = limitCostView(...args);
  return [v.lead, ...v.deltas, v.effort].filter(Boolean).join(' · ');
}
