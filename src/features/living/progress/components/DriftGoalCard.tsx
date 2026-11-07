/**
 * One drift verdict per ranked goal (living-mode.md §8.2 Goals; docs/SUITE_SPEC.md §3.8): a status mark and a word
 * (ahead / on track / behind / unclear — never red), the goal date range with its shift when it moved by 3 days or more,
 * and exactly one action: keep going (no key) · See easier options · Re-plan the rest.
 * D5-02: no cause is inferred from the logs (no causal shares, no "mostly adherence" paragraph). What the card may add
 * is observed or labelled: the model correction (an unexplained balance residual, kcal/day, with its range when it has
 * one), never a statement about expenditure or metabolism. Insufficient data reads "unclear", never on track.
 * C6: the goal date is a plain range ("goal date 21–30 Dec"), never "likely". What the correction is (a balance/model
 * residual, not measured expenditure), its warrant and limits open in the Explain sheet from the correction line
 * (`residual.detailsRef`); nothing of it is written on the card.
 */
import { useId, useState } from 'react';
import { Key, StatusMark, formatEnergy } from '@/components';
import { ExplainDrawer } from '@/features/evidence';
import type { ExplainStatus } from '@/features/evidence/ExplainDrawer';
import type { DriftGoal } from '@/living';
import { INTERPRETABLE_STATUSES } from '@/lib/bodyContracts';
import { useEnergyUnit, type EnergyUnit } from '@/state/settingsStore';
import type { DriftCard } from '../../data/types';
import { fmtDateRange } from '../../format';
import { PROGRESS_COPY as C } from '../copy';

const MARK = { ahead: 'ok', onTrack: 'ok', behind: 'info' } as const;

/** "goal date 21–30 Dec": the forecast's date range as a plain range (C6: no "likely", no probability). */
export const goalDateText = (range: string): string => `goal date ${range}`;

/** The drift contract's optional fields, when the source carries them on the card (D5-02). */
export type DriftCardView = DriftCard & Partial<Pick<DriftGoal, 'certainty' | 'residual' | 'loggedIntakeDiff'>>;

/**
 * "correction +120 kcal/day" or "correction +60 to +180 kcal/day" (energy in the person's unit); "correction at limit"
 * when the controller bound held it (D5-03: the ±300 kcal/day controller default, a status, not a measured value); null
 * when not readable.
 */
export function correctionText(residual: DriftGoal['residual'] | undefined, eu: EnergyUnit = 'kcal'): string | null {
  if (!residual || !INTERPRETABLE_STATUSES.has(residual.status)) return null;
  if (residual.reasonCode === 'correctionAtLimit') return 'correction at limit';
  const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatEnergy(Math.abs(v), eu, { withUnit: false })}`;
  if (residual.range) return `correction ${signed(residual.range[0])} to ${signed(residual.range[1])} ${eu}/day`;
  if (residual.value !== undefined && Number.isFinite(residual.value)) return `correction ${signed(residual.value)} ${eu}/day`;
  return null;
}

const CORRECTION_REASON: Readonly<Record<string, string>> = {
  balanceModelResidual: 'an unexplained balance residual between logged intake and the weight trend, not measured expenditure',
  correctionAtLimit: 'held at the controller bound',
  correctionStepLimited: 'limited by the largest change one weekly decision may make',
};

/**
 * What the correction sheet says (C4/D5-03, info sheet only): its status and reason, that its range is a conditional
 * residual (not a full prediction interval), and the controller defaults that bound it — engineering bounds, not
 * physiology.
 */
export function correctionStatus(residual: DriftGoal['residual'] | undefined, eu: EnergyUnit = 'kcal'): ExplainStatus | null {
  if (!residual) return null;
  const unit = `${eu}/day`;
  const bound = (kcal: number) => formatEnergy(kcal, eu, { withUnit: false });
  const reason = CORRECTION_REASON[residual.reasonCode];
  return {
    status: residual.status,
    uncertaintyKind: residual.uncertaintyKind,
    ...(reason ? { reason } : {}),
    details: [{ label: 'Controller bounds', value: `±${bound(300)} ${unit} · at most ${bound(100)} ${unit} change per weekly decision (engineering defaults)` }],
  };
}

export interface DriftGoalCardProps {
  card: DriftCardView;
  /** The one action of the verdict (keepGoing has none). */
  onAction: (action: 'easeOptions' | 'replan') => void;
  busy?: boolean;
  quiet?: boolean;
  /** A parent Goal card hosts corrections in its information panel. */
  showCorrection?: boolean;
}

export function DriftGoalCard({ card, onAction, busy, quiet = false, showCorrection = true }: DriftGoalCardProps) {
  const titleId = useId();
  const range = card.goalDate.range;
  const shift = card.goalDate.shiftDays;
  const eu = useEnergyUnit();
  const unclear = card.certainty === 'unclear';
  const correction = quiet || !showCorrection ? null : correctionText(card.residual, eu);
  const details = card.residual?.detailsRef;
  const [explain, setExplain] = useState(false);
  return (
    <article className="lv-prog-goal" aria-labelledby={titleId}>
      <h3 id={titleId} className="lv-prog-goal__title">
        {card.label}
      </h3>
      <p className="lv-prog-goal__state">
        <StatusMark severity={unclear ? 'info' : MARK[card.state]} size={16} />
        <span>{unclear ? 'unclear' : C.drift[card.state]}</span>
      </p>
      {range && !quiet ? (
        <p className="lv-prog-goal__date">
          {goalDateText(fmtDateRange(range[0], range[1]))}
          {shift !== null && Math.abs(shift) >= 3 ? `, ${C.moved(shift, card.goalDate.shiftSd ?? 0)}` : ''}
        </p>
      ) : null}
      {correction && details ? (
        <p className="lv-prog-goal__date lm-num">
          <Key size="sm" variant="text" onClick={() => setExplain(true)} aria-haspopup="dialog">
            {correction}
          </Key>
        </p>
      ) : correction ? (
        <p className="lv-prog-goal__date lm-num">{correction}</p>
      ) : null}
      {details && explain ? <ExplainDrawer open onClose={() => setExplain(false)} mechanismIds={[details]} title="Correction" status={correctionStatus(card.residual, eu)} /> : null}
      {card.action === 'keepGoing' ? (
        <p className="lv-prog-goal__keep">{C.keepGoing}</p>
      ) : (
        <div className="lv-prog-goal__act">
          <Key size="sm" variant="action" loading={busy} onClick={() => onAction(card.action === 'replan' ? 'replan' : 'easeOptions')}>
            {card.action === 'replan' ? C.replanRest : C.seeEasier}
          </Key>
        </div>
      )}
    </article>
  );
}

/** The correction remains behind the Goal's (i), with its existing evidence drawer. */
export function DriftCorrection({ card, quiet = false }: { card: DriftCardView; quiet?: boolean }) {
  const eu = useEnergyUnit();
  const [open, setOpen] = useState(false);
  const text = quiet ? null : correctionText(card.residual, eu);
  if (!text) return null;
  const details = card.residual?.detailsRef;
  return (
    <>
      {details ? <Key variant="text" size="sm" aria-haspopup="dialog" onClick={() => setOpen(true)}>{text}</Key> : <p>{text}</p>}
      {details && open ? <ExplainDrawer open onClose={() => setOpen(false)} mechanismIds={[details]} title="Correction" status={correctionStatus(card.residual, eu)} /> : null}
    </>
  );
}
