/**
 * One drift verdict per ranked goal (living-mode.md §8.2 Goals; docs/SUITE_SPEC.md §3.8): a status mark and a word
 * (ahead / on track / behind — never red), the goal date range with its shift when it moved by 3 days or more, the cause
 * sentence and exactly one action: keep going (no key) · See easier options · Re-plan the rest.
 */
import { useId } from 'react';
import { Key, StatusMark, energyInText } from '@/components';
import { useEnergyUnit } from '@/state/settingsStore';
import type { DriftCard } from '../../data/types';
import { fmtDateRange } from '../../format';
import { PROGRESS_COPY as C } from '../copy';

const MARK = { ahead: 'ok', onTrack: 'ok', behind: 'info' } as const;

export interface DriftGoalCardProps {
  card: DriftCard;
  /** The one action of the verdict (keepGoing has none). */
  onAction: (action: 'easeOptions' | 'replan') => void;
  busy?: boolean;
}

export function DriftGoalCard({ card, onAction, busy }: DriftGoalCardProps) {
  const titleId = useId();
  const range = card.goalDate.range;
  const shift = card.goalDate.shiftDays;
  const eu = useEnergyUnit();
  const cause = energyInText([...card.causes].sort((a, b) => b.share - a.share)[0]?.text ?? card.text, eu);
  return (
    <article className="lv-prog-goal" aria-labelledby={titleId}>
      <h3 id={titleId} className="lv-prog-goal__title">
        {card.label}
      </h3>
      <p className="lv-prog-goal__state">
        <StatusMark severity={MARK[card.state]} size={16} />
        <span>{C.drift[card.state]}</span>
      </p>
      {range ? (
        <p className="lv-prog-goal__date">
          {C.goalDate(fmtDateRange(range[0], range[1]))}
          {shift !== null && Math.abs(shift) >= 3 ? `, ${C.moved(shift, card.goalDate.shiftSd ?? 0)}` : ''}
        </p>
      ) : null}
      {cause ? <p className="lv-prog-goal__cause">{cause}</p> : null}
      {card.action === 'keepGoing' ? (
        <p className="lv-prog-goal__keep">{C.keepGoing}</p>
      ) : (
        <div className="lv-prog-goal__act">
          <Key size="sm" loading={busy} onClick={() => onAction(card.action === 'replan' ? 'replan' : 'easeOptions')}>
            {card.action === 'replan' ? C.replanRest : C.seeEasier}
          </Key>
        </div>
      )}
    </article>
  );
}
