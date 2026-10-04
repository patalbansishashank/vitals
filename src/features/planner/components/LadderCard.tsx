import type { KeyboardEvent, ReactNode } from 'react';
import { Key, RangeBar, StatusMark } from '@/components';
import type { PlannerRequestV2, PlannerResultV2, RankedGoal, ShoppingItemV2 } from '@/engine/planner/domain/types';
import type { EnergyUnit, UnitSystem } from '@/state/settingsStore';
import {
  IDEAL_CAPTION,
  RUNG_TITLE,
  SAME_AS_HARD_LINE,
  burdenRows,
  carriedNote,
  effortValue,
  goalDelta,
  liftedText,
  outcomeView,
  type LadderPlan,
  type LiftedLimit,
  type OutcomeView,
  type PlanKind,
} from '../ladder';
import type { PhaseFact } from '../planFacts';
import { BurdenScale } from './BurdenScale';
import { FastingLine } from './FastingLine';
import { LimitCosts } from './LimitCosts';
import { PhaseTimeline, StatusGlyph, safetyCounts, safetyItemsOf } from './PlanParts';
import { RungKey } from './RungKey';
import { RungBecauseChips } from '@/markers/ui/ladder'; // E20: markers

/** Row ids shared by every card, so the same row lines up across cards (CSS subgrid). */
export const cardRows = (goals: number): string[] => ['head', 'phases', 'goals-h', ...Array.from({ length: goals }, (_, i) => `goal-${i}`), 'effort', 'daytoday', 'fasting', 'buy', 'limits', 'safety', 'cost', 'actions'];

export interface LadderCardProps {
  kind: PlanKind;
  plan: LadderPlan;
  v2: PlannerResultV2;
  request: PlannerRequestV2;
  phases: readonly PhaseFact[];
  /** "hunger: high on fast days · 4 h training a week · window 8 h (12:00–20:00) · 3 meals". */
  dayToDay: string;
  units: UnitSystem;
  energy: EnergyUnit;
  selected: boolean;
  gentle?: boolean;
  /** Gentle mode: weight-type numbers revealed for this view. */
  showNumbers?: boolean;
  onShowNumbers?: () => void;
  /** Hard only, when the Ideal is this same plan: the limits lifted without effect (the Ideal draws no card). */
  sameAsIdeal?: readonly LiftedLimit[] | null;
  /** A goal row opens the Explain drawer for its metric. */
  onExplain?: (metric: string) => void;
  onSelect: () => void;
  onKeyNav?: (e: KeyboardEvent<HTMLElement>) => void;
  setToggleEl?: (el: HTMLButtonElement | null) => void;
  onSafety?: () => void;
  onOpenInSimulator?: () => void;
  onAdopt?: () => void;
  /** The Start key (rungs only; on the selected card). */
  start?: ReactNode;
  /** The plan uses something the current safety settings no longer allow: Start is disabled with this reason. */
  outsideSafety?: string | null;
  /** Standalone (no-safe-plan state): the card is not part of the aligned grid. */
  standalone?: boolean;
}

const spoken = (t: string) =>
  t
    .replace(/−/g, 'minus ')
    .replace(/^\+/, 'plus ')
    .replace(/\u2009?kg\b/, ' kilograms')
    .replace(/\u2009?lb\b/, ' pounds')
    .replace(/\u2009?cm\b/, ' centimetres')
    .replace(/\s+/g, ' ')
    .trim();

/** "₹₹" / "$$": the price tier in the person's currency sign (0 = free). */
export function priceTier(n: number): string {
  if (!(n > 0)) return 'free';
  const lang = typeof navigator !== 'undefined' ? navigator.language : 'en';
  return (/-IN$/i.test(lang) ? '₹' : '$').repeat(Math.min(5, Math.round(n)));
}

function ShoppingRow({ item, goals, units, energy }: { item: ShoppingItemV2; goals: readonly RankedGoal[]; units: UnitSystem; energy: EnergyUnit }) {
  const b = item.benefit[0];
  return (
    <li className="lp-buy" data-required={item.required || undefined}>
      <span className="lp-buy__name">{item.name}</span>
      <span className="lp-buy__meta">
        {[priceTier(item.priceTier), b ? `adds ${goalDelta(b, goals, units, energy).replace(/^\+/, '')}` : null, item.required ? 'needed' : null].filter(Boolean).join(' · ')}
      </span>
    </li>
  );
}

function GoalBody({ v, hidden, onShow }: { v: OutcomeView; hidden: boolean; onShow?: () => void }) {
  return (
    <>
      <span className="lp-lgoal__main">
        <span className="lp-lgoal__rank lm-num">{v.rank}</span>
        <span className="lp-lgoal__name">{v.name}</span>
        {hidden ? (
          <button
            type="button"
            className="lp-lgoal__show"
            onClick={(e) => {
              e.stopPropagation();
              onShow?.();
            }}
          >
            show numbers
          </button>
        ) : (
          <span className="lp-lgoal__value lm-num">{v.value}</span>
        )}
      </span>
      {!hidden && v.bar ? (
        <RangeBar low={v.bar.low} high={v.bar.high} value={v.bar.value} width={88} className="lp-lgoal__bar">
          <span className="lp-lgoal__range lm-num">{v.range?.replace(/^likely /, 'likely ')}</span>
        </RangeBar>
      ) : null}
      <span className="lp-lgoal__verdict">
        <StatusGlyph status={v.status} />
        <span>{v.verdict}</span>
      </span>
      {v.vsHard && !hidden ? <span className="lp-lgoal__vs lm-num">{v.vsHard}</span> : null}
    </>
  );
}

/**
 * One goal row. With `onExplain` (and its numbers shown) the whole row is a button that opens the Explain drawer for the
 * goal's metric, and only then does it take the row hover (COMPONENTS §14.1); otherwise it is plain text.
 */
function GoalRow({ v, hidden, onShow, onExplain }: { v: OutcomeView; hidden: boolean; onShow?: () => void; onExplain?: () => void }) {
  if (onExplain && !hidden)
    return (
      <button
        type="button"
        className="lp-lgoal lp-rowbtn"
        data-status={v.status}
        aria-label={`${v.name}: ${spoken(v.value)}${v.range ? `, ${v.range}` : ''}, ${v.verdict}. Explain`}
        onClick={(e) => {
          e.stopPropagation();
          onExplain();
        }}
      >
        <GoalBody v={v} hidden={false} />
      </button>
    );
  return (
    <div className="lp-lgoal" data-status={v.status}>
      <GoalBody v={v} hidden={hidden} onShow={onShow} />
    </div>
  );
}

/**
 * LadderCard (COMPONENTS §13.6, plan-ladder.md §6.2-6.3): rung key, title, effort and the engine's measurable subtitle;
 * goals in rank order with likely ranges and time to target; the seven burdens; day to day; fasting; things to buy;
 * limits it presses; safety; and the actions. The Ideal adds what your limits cost and is never startable. Each card
 * is an `article`; its title row is the selection toggle (`aria-pressed`).
 */
export function LadderCard({ setToggleEl, ...p }: LadderCardProps) {
  const { kind, plan, request, units, energy } = p;
  const s = plan.summary;
  const ideal = kind === 'ideal';
  const title = RUNG_TITLE[kind];
  const effort = effortValue(s.difficulty);
  const goals = request.goals;
  const views = goals.map((g, i) => {
    const o = s.outcomes.find((x) => x.goal === i);
    return o ? outcomeView(o, g, kind, units, { energy, roundChance: p.v2.provenance.tier === 'S' }) : null;
  });
  const g1 = views[0];
  const g1Hidden = !!(g1 && p.gentle && g1.weightType && !p.showNumbers);
  const label = ideal
    ? `Select Ideal, a reference without your practical limits; it can’t be started`
    : `Select ${title} plan: ${g1 && !g1Hidden ? `${g1.name} ${spoken(g1.value)}, ` : ''}effort ${effort} of 100`;
  const items = safetyItemsOf({ safetyItems: s.safetyItems, safetyNotes: [] });
  const counts = safetyCounts(items);
  const flagged = counts.danger + counts.caution;
  // rows never hover as a whole: only a control inside a row (a goal row's button, the fasting "why", safety) does
  const row = (id: string, children: ReactNode, className?: string) => (
    <div key={id} className={className ? `lp-lcard__row ${className}` : 'lp-lcard__row'} data-row={id}>
      {children}
    </div>
  );
  const overflow = ideal && burdenRows(s.difficulty, { ideal: true, gentle: p.gentle }).some((r) => r.over > 0);
  const carried = plan.kind === 'ideal' ? null : carriedNote(plan);
  const lifted = kind === 'hard' ? (p.sameAsIdeal ?? null) : null;
  const section = (name: string) => <p className="lp-lcard__sec lm-eng">{name}</p>;
  const stop = (fn?: () => void) => (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    fn?.();
  };
  const noPurchases = !(request.training && request.training.purchaseAllowance.maxItems > 0);
  const buy = [...s.equipment.required, ...s.equipment.optional];

  return (
    <article
      className="lp-lcard"
      data-rung={kind}
      data-selected={p.selected || undefined}
      data-carried={carried ? true : undefined}
      data-standalone={p.standalone || undefined}
      aria-labelledby={`lp-lcard-${kind}`}
      onClick={p.onSelect}
    >
      {row(
        'head',
        <>
          <button
            ref={setToggleEl}
            type="button"
            className="lp-lcard__toggle"
            aria-pressed={p.selected}
            aria-label={label}
            onClick={stop(p.onSelect)}
            onKeyDown={p.onKeyNav}
          >
            <RungKey kind={kind} pressed={p.selected} />
            <span id={`lp-lcard-${kind}`} className="lp-lcard__title">
              {title}
            </span>
            <span className="lp-lcard__effort lm-num">effort {effort}</span>
          </button>
          {carried ? <p className="lp-lcard__carried lm-eng">{carried}</p> : null}
          <p className="lp-lcard__subtitle">{s.subtitle}</p>
          {ideal ? <p className="lp-lcard__caption lm-eng">{IDEAL_CAPTION}</p> : null}
          {lifted ? (
            <div className="lp-lcard__same" onClick={(e) => e.stopPropagation()}>
              <p className="lp-lcard__same-line">{SAME_AS_HARD_LINE}</p>
              {lifted.length ? (
                <details className="lp-lcard__lifted">
                  <summary>{`${lifted.length} limit${lifted.length === 1 ? '' : 's'} lifted without effect`}</summary>
                  <ul>
                    {lifted.map((l) => (
                      <li key={`${l.label}-${l.from}`}>{liftedText(l)}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}
        </>,
        'lp-lcard__head',
      )}
      {row('phases', p.phases.length ? <PhaseTimeline phases={p.phases} days={request.horizonDays} /> : null)}
      {row('goals-h', section('goals'))}
      {views.map((v, i) =>
        row(
          `goal-${i}`,
          v ? (
            <GoalRow
              v={v}
              hidden={!!(p.gentle && v.weightType && !p.showNumbers)}
              onShow={p.onShowNumbers}
              onExplain={p.onExplain && goals[i] ? () => p.onExplain!(goals[i]!.metric) : undefined}
            />
          ) : (
            <p className="lp-lcard__line">—</p>
          ),
        ),
      )}
      {row(
        'effort',
        <>
          {section(overflow ? 'effort (past your limits)' : 'effort')}
          <BurdenScale difficulty={s.difficulty} compact ideal={ideal} gentle={p.gentle} header={false} />
        </>,
      )}
      {row(
        'daytoday',
        <>
          {section('day to day')}
          <p className="lp-lcard__line">{p.dayToDay}</p>
        </>,
      )}
      {row(
        'fasting',
        <>
          {section('fasting')}
          {p.gentle ? <p className="lp-lcard__line">not shown in gentle mode</p> : <FastingLine verdict={s.fasting} run={p.v2.fasting} goals={goals} units={units} energy={energy} />}
        </>,
      )}
      {row(
        'buy',
        <>
          {section('to make it work')}
          {buy.length ? (
            <ul className="lp-buys">
              {buy.map((it) => (
                <ShoppingRow key={it.equipmentId} item={it} goals={goals} units={units} energy={energy} />
              ))}
            </ul>
          ) : (
            <p className="lp-lcard__line">{noPurchases && !ideal ? 'uses only what you have' : 'nothing to buy'}</p>
          )}
        </>,
      )}
      {row(
        'limits',
        <>
          {section(ideal ? 'limits it removes' : 'limits it presses')}
          <p className="lp-lcard__line">
            {ideal
              ? p.v2.ideal?.relaxed.length
                ? `${p.v2.ideal.relaxed.length} practical limit${p.v2.ideal.relaxed.length === 1 ? '' : 's'} lifted`
                : 'none'
              : s.bindingLimits.length
                ? s.bindingLimits.map((b) => b.text || b.label).join(' · ')
                : 'none'}
          </p>
          {/* E20: markers — "because your LDL was … on …" on the rungs a blood-marker note touches */}
          <RungBecauseChips request={request} plan={plan} />
        </>,
      )}
      {row(
        'safety',
        <>
          {section('safety')}
          {p.outsideSafety ? (
            <p className="lp-lcard__safety">
              <StatusMark severity="caution" size={16} />
              <span>{p.outsideSafety}</span>
            </p>
          ) : flagged ? (
            <button type="button" className="lp-lcard__safety lp-lcard__safety--btn" onClick={stop(p.onSafety)}>
              <StatusMark severity={counts.danger ? 'danger' : 'caution'} size={16} />
              <span>{[counts.danger ? `${counts.danger} danger${counts.danger === 1 ? '' : 's'}` : null, counts.caution ? `${counts.caution} caution${counts.caution === 1 ? '' : 's'}` : null].filter(Boolean).join(', ')}</span>
            </button>
          ) : (
            <p className="lp-lcard__safety">
              <StatusMark severity="ok" size={16} />
              <span>within safety limits</span>
            </p>
          )}
        </>,
      )}
      {row(
        'cost',
        ideal && p.v2.ideal ? (
          <>
            {section('what your limits cost')}
            <LimitCosts ideal={p.v2.ideal} goals={goals} units={units} energy={energy} />
          </>
        ) : null,
      )}
      {row(
        'actions',
        ideal ? (
          p.onAdopt ? (
            <Key size="sm" onClick={stop(p.onAdopt)}>
              Adopt some of these limits
            </Key>
          ) : null
        ) : p.selected ? (
          <>
            {p.start ? (
              <span className="lp-lcard__start" onClick={(e) => e.stopPropagation()}>
                {p.start}
              </span>
            ) : null}
            {p.onOpenInSimulator ? (
              <Key size="sm" variant="quiet" onClick={stop(p.onOpenInSimulator)}>
                Open in Simulator
              </Key>
            ) : null}
          </>
        ) : null,
        'lp-lcard__actions',
      )}
    </article>
  );
}

/**
 * A rung the ladder could not fill (plan-ladder.md §12.3): a compact chip in the row under the ladder graph with the
 * rung's name and the engine's reason, written out in full (it wraps; never a full-height column).
 */
export function CollapsedChip({ kind, title, text }: { kind: PlanKind; title: string; text: string }) {
  return (
    <li className="lp-lchip" data-rung={kind}>
      <RungKey kind={kind} size="sm" />
      <span className="lp-lchip__text">
        <span className="lm-eng">{title}</span> · {text}
      </span>
    </li>
  );
}
